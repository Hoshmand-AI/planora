import { randomUUID } from 'crypto'
import { publicApi, json, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { can } from '@/lib/server/permissions'
import { hit } from '@/lib/server/rate-limit'
import { clientIp, runWithRequest } from '@/lib/server/context'
import { isRestrictedClassification } from '@/lib/server/classification'
import { resolveWorkspaceAccess } from '@/lib/server/workspaces'
import { INBOX_LIMITS, MAX_INBOUND_BYTES, markInboxUsed, resolveInboxToken } from '@/lib/server/project-inbox'
import { getScheduleById, getScheduleSeries, query } from '@/lib/db'
import { orderSeries } from '@/lib/analysis/compare'
import { projectClassification, auditTarget } from '@/lib/rag/scope'
import { ingestDocument } from '@/lib/rag/store'
import { DocumentRejected } from '@/lib/rag/extract'
import { emailSubject } from '@/lib/rag/correspondence-files'
import { fmtDate } from '@/lib/format'
import type { DocType } from '@/lib/rag/types'

/**
 * A project inbox (src/lib/server/project-inbox.ts). No session: the caller presents the inbox token
 * as a bearer token, and the message becomes a document of that inbox's project.
 *
 *   Content-Type: message/rfc822          a raw email (.eml)
 *   Content-Type: text/vtt                a meeting transcript (Teams, Zoom, Meet); application/x-subrip for .srt
 *   Content-Type: text/plain              notes or a daily report; X-RunF9-Type: email | meeting | daily_report
 *   Content-Type: application/json        { type, title?, text, from?, to?, date?, subject? }
 *
 * The title comes from X-RunF9-Title, the JSON title, or the email's subject. The same message sent
 * twice is stored once. The inbox can only add documents; it cannot read anything.
 */
const TYPES = new Set<DocType>(['email', 'meeting', 'daily_report'])
const LABEL: Record<string, string> = { email: 'Email', meeting: 'Meeting', daily_report: 'Daily report' }
const str = (v: unknown, max: number) => (typeof v === 'string' ? v : '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max)
const oneLine = (v: unknown, max: number) => str(v, max * 2).replace(/\s+/g, ' ').trim().slice(0, max)

export const POST = publicApi(async req => {
  const ip = clientIp(req.headers) || 'unknown'
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  const inbox = token ? await resolveInboxToken(token) : null
  if (!inbox) {
    // Guessing is slowed per network; a valid token is never counted here.
    const bad = await hit(`inbox:bad:${ip}`, INBOX_LIMITS.badTokenPerIp.limit, INBOX_LIMITS.badTokenPerIp.windowSec)
    if (!bad.ok) throw new ApiError(429, 'Too many attempts. Try again later.', 'rate_limited', { retryAfterSec: bad.retryAfterSec })
    throw new ApiError(401, 'Send the inbox token as "Authorization: Bearer <token>".', 'unauthorized')
  }
  for (const [key, l] of [[`inbox:${inbox.id}`, INBOX_LIMITS.perInbox], [`inbox:org:${inbox.orgId}`, INBOX_LIMITS.perOrg]] as const) {
    const q = await hit(key, l.limit, l.windowSec)
    if (!q.ok) throw new ApiError(429, 'This inbox has received too many messages this hour. Try again later.', 'rate_limited', { retryAfterSec: q.retryAfterSec })
  }

  // The inbox acts as the member who created it: they must still be an active member who may add documents.
  const u = (await query('SELECT id, email, name, role FROM users WHERE id=$1 AND org_id=$2 AND disabled_at IS NULL', [inbox.createdBy, inbox.orgId])).rows[0]
  if (!u || !can(u.role, 'schedule.write')) throw new ApiError(403, 'This inbox is no longer active: the member who created it cannot add documents. Create a new inbox.', 'forbidden')

  if (Number(req.headers.get('content-length') || 0) > MAX_INBOUND_BYTES) throw new ApiError(413, `Messages up to ${MAX_INBOUND_BYTES / 1024 / 1024} MB are accepted.`, 'too_large')
  const raw = Buffer.from(await req.arrayBuffer())
  if (!raw.length) throw new ApiError(400, 'The message is empty.')
  if (raw.length > MAX_INBOUND_BYTES) throw new ApiError(413, `Messages up to ${MAX_INBOUND_BYTES / 1024 / 1024} MB are accepted.`, 'too_large')

  const ctype = (req.headers.get('content-type') || '').toLowerCase()
  const asked = (req.headers.get('x-runf9-type') || '').toLowerCase()
  let docType: DocType = TYPES.has(asked as DocType) ? (asked as DocType) : 'email'
  let title = oneLine(req.headers.get('x-runf9-title'), 160)
  let content = raw
  let ext = 'txt'
  if (ctype.startsWith('application/json')) {
    let b: Record<string, unknown>
    try { b = JSON.parse(raw.toString('utf8')) } catch { throw new ApiError(400, 'The body is not valid JSON.') }
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new ApiError(400, 'Send a JSON object with "type" and "text".')
    if (typeof b.type === 'string' && TYPES.has(b.type as DocType)) docType = b.type as DocType
    const text = str(b.text, MAX_INBOUND_BYTES).trim()
    if (!text) throw new ApiError(400, 'Give the message in "text".')
    title = oneLine(b.title, 160) || oneLine(b.subject, 160) || title
    const head = [['From', b.from], ['To', b.to], ['Date', b.date], ['Subject', b.subject]].map(([k, v]) => (oneLine(v, 300) ? `${k}: ${oneLine(v, 300)}` : null)).filter(Boolean)
    content = Buffer.from(head.length ? `${head.join('\n')}\n\n${text}` : text, 'utf8')
  } else if (ctype.startsWith('message/rfc822')) {
    docType = 'email'; ext = 'eml'
    title = title || emailSubject(raw.toString('utf8')).slice(0, 160)
  } else if (ctype.startsWith('text/vtt')) {
    docType = TYPES.has(asked as DocType) ? docType : 'meeting'; ext = 'vtt'
  } else if (ctype.startsWith('application/x-subrip')) {
    docType = TYPES.has(asked as DocType) ? docType : 'meeting'; ext = 'srt'
  } else if (!ctype.startsWith('text/plain')) {
    throw new ApiError(415, 'Send message/rfc822 (a raw email), text/vtt, application/x-subrip, text/plain or application/json.', 'unsupported_media_type')
  }
  title = title || `${LABEL[docType]} received ${fmtDate(new Date().toISOString().slice(0, 10))}`

  const access = await resolveWorkspaceAccess({ userId: u.id, orgId: inbox.orgId, role: u.role })
  const info = { requestId: randomUUID(), method: 'POST', path: '/api/inbound', ip, userAgent: req.headers.get('user-agent'), userId: String(u.id), email: String(u.email), name: String(u.name), orgId: inbox.orgId, role: String(u.role), workspaceAccess: async () => access }
  return runWithRequest(info, async () => {
    // The project's latest upload the member can still see (workspace access applies).
    const series = orderSeries(await getScheduleSeries(inbox.orgId, inbox.projectKey))
    const schedule = series[series.length - 1] ?? await getScheduleById(inbox.scheduleId, inbox.orgId)
    if (!schedule) throw new ApiError(410, 'The project this inbox belongs to is no longer available.', 'gone')
    const classification = await projectClassification(schedule.id, inbox.orgId)
    if (isRestrictedClassification(classification)) throw new ApiError(409, 'CUI and classified projects do not accept messages through an inbox.', 'classification')
    try {
      const r = await ingestDocument({
        orgId: inbox.orgId, scope: 'project', scheduleId: schedule.id, title, fileName: `inbox-${inbox.id.slice(0, 8)}.${ext}`,
        docType, classification, uploadedBy: String(u.id), content, whyNoAi: null,
      })
      const d = r.document
      await markInboxUsed(inbox.orgId, inbox.id)
      await audit({ orgId: inbox.orgId, action: 'document.received', actor: { id: null, email: `inbox:${inbox.name}` }, ...auditTarget(d), detail: {
        documentId: d.id, inboxId: inbox.id, inbox: inbox.name, title: d.title, docType: d.docType, format: d.format, sha256: d.sha256, sizeBytes: d.sizeBytes, passages: d.chunkCount, flaggedPassages: d.flaggedCount,
      } })
      return json({ received: true, documentId: d.id, title: d.title, docType: d.docType, passages: d.chunkCount })
    } catch (err) {
      // The same message again (a retry, or a rule that fired twice) is not an error for the sender.
      if (err instanceof DocumentRejected && err.code === 'duplicate') return json({ received: true, duplicate: true })
      if (err instanceof DocumentRejected) throw new ApiError(err.code === 'too_large' ? 413 : 422, err.message, err.code)
      throw err
    }
  })
}, { optionalAuth: false })
