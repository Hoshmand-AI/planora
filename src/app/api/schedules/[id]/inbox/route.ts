import { api, body, json, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { isRestrictedClassification } from '@/lib/server/classification'
import { projectClassification, projectScope } from '@/lib/rag/scope'
import { seriesKey } from '@/lib/server/register'
import { createInbox, listInboxes, revokeInbox, MAX_INBOUND_BYTES } from '@/lib/server/project-inbox'
import { appOrigin } from '@/lib/server/email'

// A project's inboxes (src/lib/server/project-inbox.ts): where mail rules and meeting tools send the
// project's emails, transcripts and daily reports. Managing them needs schedule.write.

const address = (req: Request) => `${(process.env.APP_URL || appOrigin(req)).replace(/\/+$/, '')}/api/inbound`

export const GET = api<{ id: string }>({ permission: 'schedule.write' }, async (req, { params, auth }) => {
  const { schedule } = await projectScope(auth.orgId, params.id, { metadataOnly: true })
  return json({
    inboxes: await listInboxes(auth.orgId, seriesKey(schedule)), address: address(req), maxBytes: MAX_INBOUND_BYTES,
    available: !isRestrictedClassification(await projectClassification(schedule.id, auth.orgId)),
  })
})

/** Create an inbox: { name }. The token is in the response once and is never shown again. */
export const POST = api<{ id: string }>({ permission: 'schedule.write' }, async (req, { params, auth }) => {
  const { schedule } = await projectScope(auth.orgId, params.id)
  if (isRestrictedClassification(await projectClassification(schedule.id, auth.orgId))) throw new ApiError(409, 'CUI and classified projects have no inbox. Add their documents by hand.', 'classification')
  const b = await body<{ name?: unknown }>(req)
  const name = (typeof b.name === 'string' ? b.name : '').replace(/\s+/g, ' ').trim().slice(0, 80)
  if (!name) throw new ApiError(400, 'Give the inbox a name, such as "Project mailbox" or "Weekly meeting recorder".')
  const r = await createInbox(auth.orgId, { projectKey: seriesKey(schedule), scheduleId: schedule.id, name, createdBy: auth.userId })
  if ('error' in r) throw new ApiError(409, r.error, 'limit')
  await audit({ action: 'inbox.created', targetType: 'schedule', targetId: schedule.id, detail: { inboxId: r.inbox.id, name, schedule: schedule.name } })
  return json({ inbox: r.inbox, token: r.secret, address: address(req) })
})

/** Turn an inbox off: ?inboxId=. Its token stops working at once. */
export const DELETE = api<{ id: string }>({ permission: 'schedule.write' }, async (req, { params, auth }) => {
  const { schedule } = await projectScope(auth.orgId, params.id, { metadataOnly: true })
  const id = new URL(req.url).searchParams.get('inboxId') || ''
  const gone = id ? await revokeInbox(auth.orgId, seriesKey(schedule), id) : null
  if (!gone) throw new ApiError(404, 'Inbox not found')
  await audit({ action: 'inbox.revoked', targetType: 'schedule', targetId: schedule.id, detail: { inboxId: gone.id, name: gone.name, received: gone.received } })
  return json({ inboxes: await listInboxes(auth.orgId, seriesKey(schedule)) })
})
