// Project mailbox: RunF9 reads one folder of a Microsoft 365 mailbox for a project.
//
// An organization admin signs in with Microsoft once (OAuth 2.0 authorization code + PKCE, with
// RunF9's Entra app registration and the delegated Mail.Read permission) and names a mail folder.
// RunF9 keeps the refresh token encrypted and, each morning before the Daily Brief and whenever
// someone presses "Sync now", copies the new messages of THAT FOLDER ONLY into the project's
// documents as emails. It never reads any other folder, never sends, changes or deletes mail.
//
// A mailbox acts as the admin who connected it, exactly as a project inbox does: their workspace
// access still applies and it stops when their account is disabled. Messages carrying CUI or
// classification markings are skipped, and CUI and classified projects have no mailbox.
//
// Test-only override (honoured only where custom storage endpoints are allowed): RUNF9_GRAPH_URL.

import { randomUUID } from 'crypto'
import { getScheduleById, getScheduleSeries, initSchema, query } from '@/lib/db'
import { orderSeries } from '@/lib/analysis/compare'
import { fmtDate } from '@/lib/format'
import { detectInjection } from '@/lib/rag/injection'
import { DocumentRejected } from '@/lib/rag/extract'
import { emailSubject } from '@/lib/rag/correspondence-files'
import { auditTarget, projectClassification } from '@/lib/rag/scope'
import { ingestDocument } from '@/lib/rag/store'
import { refreshOAuthToken, signInOptions } from '@/lib/storage/cloud-auth'
import { customEndpointsAllowed, StorageError } from '@/lib/storage/providers'
import { audit } from './audit'
import { hasControlMarkings, isRestrictedClassification } from './classification'
import { runWithRequest } from './context'
import { decrypt, encrypt } from './crypto'
import { egressProblem } from './egress'
import { log } from './log'
import { can } from './permissions'
import { MAX_INBOUND_BYTES } from './project-inbox'
import { parseRegisterKey } from './register'
import { resolveWorkspaceAccess } from './workspaces'

type Env = Record<string, string | undefined>

/** Delegated permission RunF9 asks for: read the signed-in person's mail. offline_access keeps it working. */
export const MAIL_SCOPE = 'https://graph.microsoft.com/Mail.Read offline_access'
/** Holds the in-progress mailbox sign-in (encrypted) between the start and the shared callback. */
export const MAIL_OAUTH_COOKIE = 'runf9-mail-oauth'
export const MAX_MAILBOXES_PER_PROJECT = 3
/** Messages copied per mailbox per sync; the rest follow at the next sync. */
export const SYNC_BATCH = 25
/** On connecting, RunF9 starts with the folder's mail from this many days back. */
export const FIRST_SYNC_DAYS = 30

export class MailboxError extends Error {}

export const mailboxSignInOffered = (env: Env = process.env): boolean => signInOptions(env).azure
const graphBase = (env: Env) => ((customEndpointsAllowed(env) && env.RUNF9_GRAPH_URL?.trim()) || 'https://graph.microsoft.com').replace(/\/+$/, '')

export interface ProjectMailbox {
  id: string; address: string; folderName: string; createdBy: string; createdAt: string
  lastSyncAt: string | null; lastStatus: string | null; received: number; revokedAt: string | null
}
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)
const rowToMailbox = (r: Record<string, unknown>): ProjectMailbox => ({
  id: String(r.id), address: String(r.address), folderName: String(r.folder_name), createdBy: String(r.created_by), createdAt: iso(r.created_at)!,
  lastSyncAt: iso(r.last_sync_at), lastStatus: (r.last_status as string) || null, received: Number(r.received_count || 0), revokedAt: iso(r.revoked_at),
})

/** A folder name as a person types it: trimmed, single spaces, at most 80 characters. */
export const cleanFolderName = (v: unknown): string => (typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim().slice(0, 80)

/** The folder with that display name (case and spacing do not matter); null when there is none. */
export function pickFolder(folders: { id?: unknown; displayName?: unknown }[], name: string): { id: string; name: string } | null {
  const want = cleanFolderName(name).toLowerCase()
  if (!want) return null
  for (const f of folders) {
    if (typeof f.id === 'string' && typeof f.displayName === 'string' && cleanFolderName(f.displayName).toLowerCase() === want) return { id: f.id, name: f.displayName }
  }
  return null
}

/** The Graph request for a folder's messages received after `since` (oldest first, one batch). */
export function messagesUrl(base: string, folderId: string, since: string): string {
  const q = new URLSearchParams({ $select: 'id,receivedDateTime', $orderby: 'receivedDateTime asc', $top: String(SYNC_BATCH), $filter: `receivedDateTime gt ${new Date(since).toISOString()}` })
  return `${base}/v1.0/me/mailFolders/${encodeURIComponent(folderId)}/messages?${q}`
}

async function graph(url: string, accessToken: string, env: Env, accept = 'application/json'): Promise<Response> {
  const problem = egressProblem(url, env)
  if (problem) throw new MailboxError(problem)
  let res: Response
  try {
    res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}`, accept }, redirect: 'manual', signal: AbortSignal.timeout(20_000), cache: 'no-store' })
  } catch { throw new MailboxError('Could not reach Microsoft 365.') }
  if (res.status === 401 || res.status === 403) throw new MailboxError('Microsoft 365 refused access to the mailbox. Disconnect it and connect it again.')
  if (res.status === 404) throw new MailboxError('The mail folder no longer exists. Disconnect the mailbox and connect it again.')
  if (!res.ok) throw new MailboxError(`Microsoft 365 answered with an error (${res.status}).`)
  return res
}

/** After sign-in: whose mailbox it is and the id of the folder they named. */
export async function describeMailbox(accessToken: string, folder: string, env: Env = process.env): Promise<{ address: string; folderId: string; folderName: string }> {
  const base = graphBase(env)
  const me = await (await graph(`${base}/v1.0/me?$select=mail,userPrincipalName`, accessToken, env)).json().catch(() => ({})) as Record<string, unknown>
  const address = String(me.mail || me.userPrincipalName || '').slice(0, 200)
  if (!address) throw new MailboxError('Microsoft 365 did not say whose mailbox this is.')
  const list = await (await graph(`${base}/v1.0/me/mailFolders?$top=200&$select=id,displayName`, accessToken, env)).json().catch(() => ({})) as { value?: unknown }
  const found = pickFolder(Array.isArray(list.value) ? list.value as { id?: unknown; displayName?: unknown }[] : [], folder)
  if (!found) throw new MailboxError(`${address} has no top-level mail folder named "${cleanFolderName(folder)}". Create that folder in Outlook, move or rule this project's emails into it, then connect again.`)
  return { address, folderId: found.id, folderName: found.name }
}

export async function listMailboxes(orgId: string, projectKey: string): Promise<ProjectMailbox[]> {
  await initSchema()
  const res = await query('SELECT * FROM project_mailboxes WHERE org_id=$1 AND project_key=$2 ORDER BY revoked_at IS NOT NULL, created_at DESC LIMIT 20', [orgId, projectKey])
  return res.rows.map(rowToMailbox)
}

export async function createMailbox(orgId: string, i: { projectKey: string; scheduleId: string; address: string; folderId: string; folderName: string; refreshToken: string; createdBy: string }): Promise<ProjectMailbox | { error: string }> {
  await initSchema()
  const live = await query('SELECT address, folder_id FROM project_mailboxes WHERE org_id=$1 AND project_key=$2 AND revoked_at IS NULL', [orgId, i.projectKey])
  if (live.rows.some(r => String(r.address).toLowerCase() === i.address.toLowerCase() && r.folder_id === i.folderId)) return { error: 'That folder of that mailbox is already connected to this project.' }
  if (live.rows.length >= MAX_MAILBOXES_PER_PROJECT) return { error: `A project can have ${MAX_MAILBOXES_PER_PROJECT} connected mailboxes. Disconnect one first.` }
  const res = await query(`INSERT INTO project_mailboxes (id, org_id, project_key, schedule_id, provider, address, folder_id, folder_name, secret, created_by, sync_cursor)
    VALUES ($1,$2,$3,$4,'microsoft',$5,$6,$7,$8,$9, NOW() - ($10 || ' days')::interval) RETURNING *`,
    [randomUUID(), orgId, i.projectKey, i.scheduleId, i.address, i.folderId, i.folderName, encrypt(JSON.stringify({ refreshToken: i.refreshToken })), i.createdBy, String(FIRST_SYNC_DAYS)])
  return rowToMailbox(res.rows[0])
}

/** Disconnects a mailbox: its stored sign-in is erased at once. */
export async function revokeMailbox(orgId: string, projectKey: string, id: string): Promise<ProjectMailbox | null> {
  await initSchema()
  const res = await query("UPDATE project_mailboxes SET revoked_at=NOW(), secret='' WHERE id=$1 AND org_id=$2 AND project_key=$3 AND revoked_at IS NULL RETURNING *", [id, orgId, projectKey])
  return res.rows[0] ? rowToMailbox(res.rows[0]) : null
}

export interface SyncResult { received: number; duplicates: number; skipped: number; status: string }

/**
 * Copies the folder's new messages into the project (one batch). Never throws: the outcome is in
 * `status`, which is also stored on the mailbox for the Documents tab.
 */
export async function syncMailbox(orgId: string, id: string, env: Env = process.env): Promise<SyncResult> {
  await initSchema()
  const row = (await query('SELECT * FROM project_mailboxes WHERE id=$1 AND org_id=$2 AND revoked_at IS NULL', [id, orgId])).rows[0]
  if (!row) return { received: 0, duplicates: 0, skipped: 0, status: 'This mailbox is no longer connected.' }
  const out: SyncResult = { received: 0, duplicates: 0, skipped: 0, status: '' }
  let cursor = new Date(row.sync_cursor as string).toISOString()
  const finish = async (status: string): Promise<SyncResult> => {
    out.status = status
    await query('UPDATE project_mailboxes SET last_sync_at=NOW(), last_status=$3, sync_cursor=$4, received_count=received_count+$5 WHERE id=$1 AND org_id=$2', [id, orgId, status.slice(0, 300), cursor, out.received])
    return out
  }
  try {
    // The mailbox acts as the admin who connected it: they must still be an active member who may add documents.
    const u = (await query('SELECT id, email, name, role FROM users WHERE id=$1 AND org_id=$2 AND disabled_at IS NULL', [row.created_by, orgId])).rows[0]
    if (!u || !can(u.role, 'schedule.write')) return await finish('Stopped: the member who connected this mailbox can no longer add documents. Connect it again.')

    let refreshToken: string
    try { refreshToken = String(JSON.parse(decrypt(String(row.secret))).refreshToken || '') } catch { refreshToken = '' }
    if (!refreshToken) return await finish('Stopped: the stored sign-in could not be read. Disconnect the mailbox and connect it again.')
    const t = await refreshOAuthToken('azure', refreshToken, env, MAIL_SCOPE)
    // Microsoft rotates refresh tokens: keep the newest, or the next sync would be refused.
    if (t.refreshToken && t.refreshToken !== refreshToken) await query('UPDATE project_mailboxes SET secret=$3 WHERE id=$1 AND org_id=$2', [id, orgId, encrypt(JSON.stringify({ refreshToken: t.refreshToken }))])

    const base = graphBase(env)
    const page = await (await graph(messagesUrl(base, String(row.folder_id), cursor), t.accessToken, env)).json().catch(() => ({})) as { value?: unknown }
    const messages = (Array.isArray(page.value) ? page.value : []).filter((m): m is { id: string; receivedDateTime: string } => !!m && typeof (m as { id?: unknown }).id === 'string' && typeof (m as { receivedDateTime?: unknown }).receivedDateTime === 'string')
    if (!messages.length) return await finish('Up to date: no new messages in the folder.')

    const access = await resolveWorkspaceAccess({ userId: u.id, orgId, role: u.role })
    const info = { requestId: randomUUID(), method: 'POST', path: '/api/mailbox-sync', ip: 'mailbox', userAgent: 'RunF9 mailbox sync', userId: String(u.id), email: String(u.email), name: String(u.name), orgId, role: String(u.role), workspaceAccess: async () => access }
    return await runWithRequest(info, async () => {
      // The project's latest upload the member can still see (workspace access applies).
      const at = parseRegisterKey(String(row.project_key))
      const series = at.projectKey ? orderSeries(await getScheduleSeries(orgId, at.projectKey, at.workspaceId)) : []
      const schedule = series[series.length - 1] ?? await getScheduleById(String(row.schedule_id), orgId)
      if (!schedule) return finish('Stopped: the project this mailbox belongs to is no longer available.')
      const classification = await projectClassification(schedule.id, orgId)
      if (isRestrictedClassification(classification)) return finish('Stopped: CUI and classified projects do not read a mailbox.')

      for (const m of messages) {
        const res = await graph(`${base}/v1.0/me/messages/${encodeURIComponent(m.id)}/$value`, t.accessToken, env, 'text/plain, message/rfc822, */*')
        const raw = Buffer.from(await res.arrayBuffer())
        const text = raw.toString('utf8')
        let title = emailSubject(text).slice(0, 160)
        if (!raw.length || raw.length > MAX_INBOUND_BYTES || hasControlMarkings(text) || hasControlMarkings(title)) {
          // Too large (attachments are not read), empty, or carrying CUI or classification markings: left in the mailbox.
          out.skipped++; cursor = m.receivedDateTime; continue
        }
        // The title is written into what a model reads; a subject that reads like instructions to an AI is not kept.
        if (title && detectInjection(title).length) title = ''
        title = title || `Email received ${fmtDate(m.receivedDateTime.slice(0, 10))}`
        try {
          const r = await ingestDocument({
            orgId, scope: 'project', scheduleId: schedule.id, title, fileName: `mailbox-${id.slice(0, 8)}.eml`,
            docType: 'email', classification, uploadedBy: String(u.id), content: raw, whyNoAi: null, source: 'inbox',
          })
          const d = r.document
          out.received++
          await audit({ orgId, action: 'document.received', actor: { id: null, email: `mailbox:${row.address}` }, ...auditTarget(d), detail: {
            documentId: d.id, mailboxId: id, mailbox: row.address, folder: row.folder_name, title: d.title, docType: d.docType, format: d.format, sha256: d.sha256, sizeBytes: d.sizeBytes, passages: d.chunkCount, flaggedPassages: d.flaggedCount,
          } })
        } catch (err) {
          if (err instanceof DocumentRejected && err.code === 'duplicate') out.duplicates++
          else if (err instanceof DocumentRejected && /too_many_documents|full/i.test(`${err.code} ${err.message}`)) return finish(`Stopped: ${err.message}`)
          else if (err instanceof DocumentRejected) out.skipped++
          else throw err
        }
        cursor = m.receivedDateTime
      }
      const more = messages.length >= SYNC_BATCH ? ' More are waiting for the next sync.' : ''
      return finish(`Read ${out.received} new ${out.received === 1 ? 'message' : 'messages'}${out.duplicates ? `, ${out.duplicates} already here` : ''}${out.skipped ? `, ${out.skipped} skipped (too large, empty or marked)` : ''}.${more}`)
    })
  } catch (err) {
    const known = err instanceof MailboxError || err instanceof StorageError
    if (!known) log('error', 'mailbox sync failed', { mailboxId: id, error: (err as Error).message })
    return finish(known ? `Stopped: ${(err as Error).message}` : 'Stopped: the mailbox could not be read. Try again later.')
  }
}

/** The scheduled pass: the mailboxes that have waited longest, a few at a time. */
export async function syncDueMailboxes(limit = 20): Promise<{ mailboxes: number; received: number }> {
  await initSchema()
  if (!mailboxSignInOffered()) return { mailboxes: 0, received: 0 }
  const due = await query(`SELECT id, org_id FROM project_mailboxes WHERE revoked_at IS NULL ORDER BY last_sync_at ASC NULLS FIRST LIMIT ${Math.max(1, Math.min(50, Math.floor(limit)))}`)
  let received = 0
  for (const r of due.rows) received += (await syncMailbox(String(r.org_id), String(r.id))).received
  return { mailboxes: due.rows.length, received }
}
