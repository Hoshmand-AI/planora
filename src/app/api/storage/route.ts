import { api, json, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { can } from '@/lib/server/permissions'
import { hit } from '@/lib/server/rate-limit'
import { customEndpointsAllowed, PROVIDERS, PROVIDER_LABEL, StorageError, storageClient, testStorage, validateConnection } from '@/lib/storage/providers'
import { createStorageConnection, listStorageConnections, openStorageConnection, removeStorageConnection, updateStorageStatus } from '@/lib/storage/store'

// Cloud storage connections (Organization > Cloud storage): Amazon S3, Azure Blob Storage, Google
// Cloud Storage, or S3-compatible storage. Everyone who can read sees which storages exist (to pick
// one when uploading); only owners and admins connect, test or remove them. Secrets never come back.

export const GET = api({ permission: 'read' }, async (_req, { auth }) => {
  const connections = await listStorageConnections(auth.orgId)
  const manage = can(auth.role, 'org.manage')
  return json({
    connections: connections.map(c => manage ? c : { id: c.id, provider: c.provider, providerLabel: c.providerLabel, name: c.name, location: c.location, canRead: c.canRead, canWrite: c.canWrite }),
    providers: PROVIDERS.filter(p => p !== 's3' || customEndpointsAllowed()).map(id => ({ id, label: PROVIDER_LABEL[id] })),
  })
})

type Body = { action?: string; id?: string; provider?: string; name?: string; config?: Record<string, unknown>; secret?: Record<string, unknown> }

export const POST = api({ permission: 'org.manage' }, async (req, { auth }) => {
  const body = (await req.json().catch(() => ({}))) as Body
  const rl = await hit(`storage:org:${auth.orgId}`, 30, 3600)
  if (!rl.ok) throw new ApiError(429, 'Too many storage changes this hour. Try again later.', 'rate_limited', { retryAfterSec: rl.retryAfterSec })

  if (body.action === 'connect') {
    const name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 80)
    if (!name) throw new ApiError(400, 'Give the connection a name, for example "Harbor client Azure".')
    let v
    try { v = validateConnection(String(body.provider), body.config ?? {}, body.secret ?? {}) } catch (e) {
      if (e instanceof StorageError) throw new ApiError(400, e.message)
      throw e
    }
    // Connect only what works: RunF9 lists and writes a check file before saving anything.
    const status = await testStorage(storageClient(v.provider, v.config, v.secret), v.config.prefix)
    if (!status.read && !status.write) {
      await audit({ action: 'storage.connect_failed', targetType: 'organization', targetId: auth.orgId, detail: { provider: v.provider, name } })
      throw new ApiError(400, `RunF9 could not use this storage: ${status.detail}`, 'storage_unreachable')
    }
    const connection = await createStorageConnection({ orgId: auth.orgId, provider: v.provider, name, config: v.config, secret: v.secret, canRead: status.read, canWrite: status.write, statusDetail: status.detail, createdBy: auth.userId })
    await audit({ action: 'storage.connected', targetType: 'storage_connection', targetId: connection.id, detail: { provider: v.provider, name, location: connection.location, canRead: status.read, canWrite: status.write } })
    return json({ connection })
  }

  const id = String(body.id || '')
  if (body.action === 'test') {
    const open = await openStorageConnection(auth.orgId, id)
    if (!open) throw new ApiError(404, 'Connection not found.', 'not_found')
    const status = await testStorage(open.client, open.connection.config.prefix)
    await updateStorageStatus(auth.orgId, id, { canRead: status.read, canWrite: status.write, statusDetail: status.detail })
    await audit({ action: 'storage.tested', targetType: 'storage_connection', targetId: id, detail: { canRead: status.read, canWrite: status.write } })
    return json({ status })
  }
  if (body.action === 'remove') {
    if (!(await removeStorageConnection(auth.orgId, id))) throw new ApiError(404, 'Connection not found.', 'not_found')
    await audit({ action: 'storage.removed', targetType: 'storage_connection', targetId: id })
    return json({ ok: true })
  }
  throw new ApiError(400, 'action must be connect, test or remove.')
})
