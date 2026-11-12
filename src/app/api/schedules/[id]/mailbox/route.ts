import { NextResponse } from 'next/server'
import { api, body, json, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { isRestrictedClassification } from '@/lib/server/classification'
import { encrypt } from '@/lib/server/crypto'
import { appOrigin } from '@/lib/server/email'
import { can } from '@/lib/server/permissions'
import { cleanFolderName, FIRST_SYNC_DAYS, listMailboxes, MAIL_OAUTH_COOKIE, MAIL_SCOPE, mailboxSignInOffered, revokeMailbox, syncMailbox } from '@/lib/server/project-mailbox'
import { registerKey } from '@/lib/server/register'
import { projectClassification, projectScope } from '@/lib/rag/scope'
import { startOAuth } from '@/lib/storage/cloud-auth'
import { StorageError } from '@/lib/storage/providers'

// A project's connected Microsoft 365 mailboxes (src/lib/server/project-mailbox.ts): RunF9 reads one
// named mail folder and copies its new messages into the project's documents. Seeing them and
// pressing "Sync now" needs schedule.write; connecting and disconnecting needs org.manage, because
// connecting hands RunF9 a standing sign-in to someone's mail folder.

export const GET = api<{ id: string }>({ permission: 'schedule.write' }, async (_req, { params, auth }) => {
  const { schedule } = await projectScope(auth.orgId, params.id, { metadataOnly: true })
  return json({
    mailboxes: await listMailboxes(auth.orgId, registerKey(schedule)),
    offered: mailboxSignInOffered(),
    canConnect: can(auth.role, 'org.manage'),
    available: !isRestrictedClassification(await projectClassification(schedule.id, auth.orgId)),
    firstSyncDays: FIRST_SYNC_DAYS,
  })
})

/**
 * { action: 'connect_start', folder }  returns Microsoft's sign-in page; it comes back to the shared
 *                                      callback (/api/storage/oauth/callback), which saves the mailbox.
 * { action: 'sync', mailboxId }        reads the folder's new messages now.
 */
export const POST = api<{ id: string }>({ permission: 'schedule.write' }, async (req, { params, auth }) => {
  const { schedule } = await projectScope(auth.orgId, params.id)
  const b = await body<{ action?: unknown; folder?: unknown; mailboxId?: unknown }>(req)
  const key = registerKey(schedule)

  if (b.action === 'sync') {
    const id = typeof b.mailboxId === 'string' ? b.mailboxId : ''
    if (!(await listMailboxes(auth.orgId, key)).some(m => m.id === id && !m.revokedAt)) throw new ApiError(404, 'Mailbox not found')
    const r = await syncMailbox(auth.orgId, id)
    await audit({ action: 'mailbox.synced', targetType: 'schedule', targetId: schedule.id, detail: { mailboxId: id, received: r.received, duplicates: r.duplicates, skipped: r.skipped, status: r.status } })
    return json({ ...r, mailboxes: await listMailboxes(auth.orgId, key) })
  }

  if (b.action === 'connect_start') {
    if (!can(auth.role, 'org.manage')) throw new ApiError(403, 'An organization admin connects a mailbox.', 'forbidden')
    if (!mailboxSignInOffered()) throw new ApiError(400, 'Sign-in with Microsoft is not set up on this RunF9.')
    if (isRestrictedClassification(await projectClassification(schedule.id, auth.orgId))) throw new ApiError(409, 'CUI and classified projects do not read a mailbox. Add their documents by hand.', 'classification')
    const folder = cleanFolderName(b.folder)
    if (!folder) throw new ApiError(400, 'Name the mail folder RunF9 should read, such as "RunF9" or the project name.')
    const redirectUri = `${appOrigin(req)}/api/storage/oauth/callback`
    let start
    try { start = startOAuth('azure', redirectUri, process.env, auth.email, MAIL_SCOPE) } catch (e) {
      throw new ApiError(400, e instanceof StorageError ? e.message : 'Sign-in with Microsoft is not set up on this RunF9.')
    }
    const res = NextResponse.json({ url: start.url })
    res.cookies.set(MAIL_OAUTH_COOKIE, encrypt(JSON.stringify({ orgId: auth.orgId, userId: auth.userId, scheduleId: schedule.id, projectKey: key, folder, verifier: start.verifier, state: start.state, redirectUri, exp: Date.now() + 10 * 60_000 })),
      { httpOnly: true, secure: redirectUri.startsWith('https:'), sameSite: 'lax', path: '/api/storage/oauth', maxAge: 600 })
    return res
  }
  throw new ApiError(400, 'action must be connect_start or sync.')
})

/** Disconnect a mailbox: ?mailboxId=. Its stored sign-in is erased at once. */
export const DELETE = api<{ id: string }>({ permission: 'org.manage' }, async (req, { params, auth }) => {
  const { schedule } = await projectScope(auth.orgId, params.id, { metadataOnly: true })
  const id = new URL(req.url).searchParams.get('mailboxId') || ''
  const gone = id ? await revokeMailbox(auth.orgId, registerKey(schedule), id) : null
  if (!gone) throw new ApiError(404, 'Mailbox not found')
  await audit({ action: 'mailbox.disconnected', targetType: 'schedule', targetId: schedule.id, detail: { mailboxId: gone.id, mailbox: gone.address, folder: gone.folderName, received: gone.received } })
  return json({ mailboxes: await listMailboxes(auth.orgId, registerKey(schedule)) })
})
