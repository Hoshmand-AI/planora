// Cloud storage connections of an organization (table storage_connections, migration 20).
// Secrets are encrypted at rest and never leave the server: list/get return them only to the
// storage client, never to an API response.

import { randomUUID } from 'crypto'
import { initSchema, query } from '@/lib/db'
import { decrypt, encrypt } from '@/lib/server/crypto'
import { describeLocation, PROVIDER_LABEL, storageClient, type StorageClient, type StorageConfig, type StorageProvider, type StorageSecret } from './providers'

export interface StorageConnection {
  id: string
  provider: StorageProvider
  providerLabel: string
  name: string
  location: string
  config: StorageConfig
  canRead: boolean
  canWrite: boolean
  statusDetail: string | null
  checkedAt: string | null
  createdAt: string
}

const toConnection = (r: Record<string, unknown>): StorageConnection => {
  const provider = r.provider as StorageProvider
  const config = (r.config ?? {}) as StorageConfig
  return {
    id: String(r.id), provider, providerLabel: PROVIDER_LABEL[provider], name: String(r.name),
    location: describeLocation(provider, config), config,
    canRead: !!r.can_read, canWrite: !!r.can_write,
    statusDetail: (r.status_detail as string) ?? null,
    checkedAt: r.checked_at ? new Date(r.checked_at as string).toISOString() : null,
    createdAt: new Date(r.created_at as string).toISOString(),
  }
}

export async function listStorageConnections(orgId: string): Promise<StorageConnection[]> {
  await initSchema()
  const res = await query('SELECT * FROM storage_connections WHERE org_id=$1 AND deleted_at IS NULL ORDER BY created_at', [orgId])
  return res.rows.map(toConnection)
}

/** A live connection of this organization, with a client that can reach it; undefined if missing or removed. */
export async function openStorageConnection(orgId: string, id: string): Promise<{ connection: StorageConnection; client: StorageClient } | undefined> {
  await initSchema()
  const res = await query('SELECT * FROM storage_connections WHERE org_id=$1 AND id=$2 AND deleted_at IS NULL', [orgId, id])
  const r = res.rows[0]
  if (!r) return undefined
  const connection = toConnection(r)
  const secret = JSON.parse(decrypt(String(r.secret))) as StorageSecret
  return { connection, client: storageClient(connection.provider, connection.config, secret) }
}

/** Name and location of a connection, removed or not (for "kept in …" labels). */
export async function storageConnectionLabel(orgId: string, id: string): Promise<{ name: string; location: string; removed: boolean } | undefined> {
  await initSchema()
  const res = await query('SELECT * FROM storage_connections WHERE org_id=$1 AND id=$2', [orgId, id])
  const r = res.rows[0]
  if (!r) return undefined
  const c = toConnection(r)
  return { name: c.name, location: c.location, removed: !!r.deleted_at }
}

export async function createStorageConnection(c: { orgId: string; provider: StorageProvider; name: string; config: StorageConfig; secret: StorageSecret; canRead: boolean; canWrite: boolean; statusDetail: string; createdBy: string }): Promise<StorageConnection> {
  await initSchema()
  const res = await query(`INSERT INTO storage_connections (id, org_id, provider, name, config, secret, can_read, can_write, status_detail, checked_at, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),$10) RETURNING *`,
  [randomUUID(), c.orgId, c.provider, c.name, JSON.stringify(c.config), encrypt(JSON.stringify(c.secret)), c.canRead, c.canWrite, c.statusDetail, c.createdBy])
  return toConnection(res.rows[0])
}

export async function updateStorageStatus(orgId: string, id: string, s: { canRead: boolean; canWrite: boolean; statusDetail: string }): Promise<void> {
  await query('UPDATE storage_connections SET can_read=$3, can_write=$4, status_detail=$5, checked_at=NOW() WHERE org_id=$1 AND id=$2 AND deleted_at IS NULL',
    [orgId, id, s.canRead, s.canWrite, s.statusDetail])
}

/** Removes a connection: the secret is wiped; files already kept there stay in the firm's storage. */
export async function removeStorageConnection(orgId: string, id: string): Promise<boolean> {
  const res = await query(`UPDATE storage_connections SET deleted_at=NOW(), secret='' WHERE org_id=$1 AND id=$2 AND deleted_at IS NULL`, [orgId, id])
  return (res.rowCount ?? 0) > 0
}
