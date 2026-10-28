import { api, json, ApiError } from '@/lib/server/api'
import { hit } from '@/lib/server/rate-limit'
import { checkKey, StorageError } from '@/lib/storage/providers'
import { openStorageConnection } from '@/lib/storage/store'

// Browse a connected cloud storage to pick a schedule or document to import: one folder level at a
// time (?prefix=folder/). Only people who can upload may browse.
export const GET = api<{ id: string }>({ permission: 'schedule.write' }, async (req, { params, auth }) => {
  const rl = await hit(`storage-browse:user:${auth.userId}`, 300, 3600)
  if (!rl.ok) throw new ApiError(429, 'Too many requests. Try again later.', 'rate_limited', { retryAfterSec: rl.retryAfterSec })
  const open = await openStorageConnection(auth.orgId, params.id)
  if (!open) throw new ApiError(404, 'Connection not found.', 'not_found')
  if (!open.connection.canRead) throw new ApiError(400, `RunF9 cannot read from ${open.connection.name}. Test the connection in Organization > Cloud storage.`)
  const base = open.connection.config.prefix ?? ''
  const raw = new URL(req.url).searchParams.get('prefix') ?? base
  // Stay inside the connection's folder.
  const prefix = raw && !raw.startsWith(base) ? base : raw
  if (prefix) { try { checkKey(prefix) } catch { throw new ApiError(400, 'That folder is not allowed.') } }
  try {
    const listing = await open.client.list(prefix)
    return json({ connection: { id: open.connection.id, name: open.connection.name, location: open.connection.location }, prefix, base, ...listing })
  } catch (e) {
    if (e instanceof StorageError) throw new ApiError(e.status < 500 ? 400 : 502, e.message, 'storage_error')
    throw e
  }
})
