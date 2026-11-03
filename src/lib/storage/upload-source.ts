// Where an upload comes from and where its original file is kept, for schedule and document
// uploads. Form fields (multipart):
//   file                         a file from the user's computer, or
//   sourceConnectionId + sourceKey   a file in a connected cloud storage (Organization > Cloud storage)
//   keepIn                       'runf9' (default) or a connection id: keep the original file there
// The bytes are read and checked the same way whichever source they came from.

import { ApiError } from '@/lib/server/api'
import { openStorageConnection } from './store'
import { objectKeyFor, StorageError } from './providers'

export interface UploadSource {
  fileName: string
  bytes: Buffer
  /** Set when the file was imported from connected storage */
  from: { connectionId: string; key: string; location: string } | null
}

const asApiError = (e: unknown): never => {
  // The firm's storage refusing or missing something is a 400 for the caller; only unreachable storage is a 502.
  if (e instanceof StorageError) throw new ApiError(e.status === 413 ? 413 : e.status < 500 ? 400 : 502, e.message, e.status === 413 ? 'too_large' : 'storage_error')
  throw e
}

/** The uploaded bytes: from the computer, or imported from a connected storage. */
export async function readUploadSource(form: FormData, orgId: string, maxBytes: number, tooLarge: string): Promise<UploadSource | null> {
  const file = form.get('file')
  if (file && typeof file !== 'string') {
    if (file.size > maxBytes) throw new ApiError(413, tooLarge, 'too_large')
    return { fileName: file.name || 'file', bytes: Buffer.from(await file.arrayBuffer()), from: null }
  }
  const connectionId = String(form.get('sourceConnectionId') || '').trim()
  const key = String(form.get('sourceKey') || '').trim()
  if (!connectionId && !key) return null
  if (!connectionId || !key) throw new ApiError(400, 'Choose a file in the connected storage.')
  const open = await openStorageConnection(orgId, connectionId)
  if (!open) throw new ApiError(404, 'That cloud storage connection no longer exists.', 'not_found')
  if (!open.connection.canRead) throw new ApiError(400, `RunF9 cannot read from ${open.connection.name}. Test the connection in Organization > Cloud storage.`)
  try {
    const bytes = await open.client.get(key, maxBytes)
    return { fileName: key.split('/').pop() || 'file', bytes, from: { connectionId, key, location: open.connection.location } }
  } catch (e) {
    if (e instanceof StorageError && e.status === 413) throw new ApiError(413, tooLarge, 'too_large')
    return asApiError(e)
  }
}

/** The connection chosen to keep the original file in, checked before any work is done; null = RunF9. */
export async function keepInTarget(form: FormData, orgId: string) {
  const keepIn = String(form.get('keepIn') || 'runf9').trim()
  if (keepIn === 'runf9' || keepIn === 'none') return null
  const open = await openStorageConnection(orgId, keepIn)
  if (!open) throw new ApiError(404, 'That cloud storage connection no longer exists.', 'not_found')
  if (!open.connection.canWrite) throw new ApiError(400, `RunF9 cannot save files in ${open.connection.name}. Test the connection in Organization > Cloud storage.`)
  return open
}

/** Saves the original file in the firm's storage; returns where it went. */
export async function keepOriginal(target: NonNullable<Awaited<ReturnType<typeof keepInTarget>>>, kind: 'schedules' | 'documents', fileName: string, sha256: string, bytes: Buffer): Promise<{ connectionId: string; objectKey: string; location: string }> {
  const objectKey = objectKeyFor(target.connection.config.prefix, kind, fileName, sha256)
  try {
    await target.client.put(objectKey, bytes)
  } catch (e) { return asApiError(e) }
  return { connectionId: target.connection.id, objectKey, location: target.connection.location }
}
