// Reading back an original file RunF9 kept in a firm's own cloud storage (schedule_files /
// project_documents with storage_connection_id + object_key). The bytes must match the SHA-256
// recorded at upload, so a file changed or replaced in the bucket is never used as the original.

import { createHash } from 'crypto'
import { openStorageConnection, storageConnectionLabel } from './store'
import { StorageError } from './providers'

export class KeptFileUnavailable extends Error {}

export async function fetchKeptOriginal(orgId: string, connectionId: string, objectKey: string, sha256: string, sizeBytes: number): Promise<Buffer> {
  const open = await openStorageConnection(orgId, connectionId)
  if (!open) {
    const label = await storageConnectionLabel(orgId, connectionId)
    throw new KeptFileUnavailable(`The original file is kept in ${label ? `${label.name} (${label.location})` : 'your cloud storage'}, which is no longer connected to RunF9.`)
  }
  let bytes: Buffer
  try {
    bytes = await open.client.get(objectKey, Math.max(sizeBytes, 1) + 1)
  } catch (e) {
    throw new KeptFileUnavailable(`The original file could not be read from ${open.connection.name}: ${e instanceof StorageError ? e.message : 'storage error'}`)
  }
  if (createHash('sha256').update(bytes).digest('hex') !== sha256) {
    throw new KeptFileUnavailable(`The file at ${objectKey} in ${open.connection.name} is not the one that was uploaded (its SHA-256 differs), so RunF9 does not use it.`)
  }
  return bytes
}
