// Site captures in the database. Every query is bounded by the organization and the project (the update series
// of a schedule the caller can see; routes resolve that schedule with getScheduleById first, which applies the
// workspace walls). The project key is the register's (registerKey), so a capture carries across uploads.
//
// A capture is never edited: what was seen, when and by whom stays as it was sent. It can be deleted, which
// erases its photos, its voice note and its words and leaves a dated tombstone.

import { createHash, randomUUID } from 'crypto'
import { initSchema, query, withTransaction } from '@/lib/db'
import {
  MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS, MAX_CAPTURES_PER_PROJECT, MAX_PHOTO_BYTES, MAX_PHOTOS_PER_CAPTURE,
  imageSize, sniffMedia, type CaptureFields, type CaptureMediaInfo, type CaptureStatus, type PlaceSource, type SiteCapture,
} from '@/lib/site/capture'

/** A photo or a voice note as it arrived, before it is checked. */
export interface IncomingMedia { bytes: Buffer; seconds?: number | null }
/** A photo or a voice note that passed the checks. */
export interface CheckedMedia { kind: 'photo' | 'audio'; contentType: string; bytes: Buffer; sha256: string; width: number | null; height: number | null; seconds: number | null }

export class CaptureRejected extends Error {
  constructor(message: string, public code: string) { super(message) }
}

/**
 * Checks the files of one capture: each must really be a photo or a voice note (by its first bytes), within the
 * size limits, with at most four photos and one voice note.
 */
export function checkMedia(files: IncomingMedia[]): CheckedMedia[] {
  const out: CheckedMedia[] = []
  for (const f of files) {
    if (!f.bytes.length) continue
    const sniffed = sniffMedia(f.bytes)
    if (!sniffed) throw new CaptureRejected('A capture holds photos (JPEG, PNG or WebP) and a voice note. One of the files sent is neither.', 'unsupported_media')
    if (sniffed.kind === 'photo' && f.bytes.length > MAX_PHOTO_BYTES) throw new CaptureRejected('A photo is too large. Take it again; the capture screen resizes photos before sending.', 'too_large')
    if (sniffed.kind === 'audio' && f.bytes.length > MAX_AUDIO_BYTES) throw new CaptureRejected(`A voice note can be up to ${MAX_AUDIO_SECONDS / 60} minutes. Record a shorter one.`, 'too_large')
    const size = sniffed.kind === 'photo' ? imageSize(f.bytes, sniffed.contentType) : null
    const seconds = sniffed.kind === 'audio' && typeof f.seconds === 'number' && Number.isFinite(f.seconds) && f.seconds > 0 ? Math.min(Math.round(f.seconds * 10) / 10, MAX_AUDIO_SECONDS) : null
    out.push({ ...sniffed, bytes: f.bytes, sha256: createHash('sha256').update(f.bytes).digest('hex'), width: size?.width ?? null, height: size?.height ?? null, seconds })
  }
  if (out.filter(m => m.kind === 'photo').length > MAX_PHOTOS_PER_CAPTURE) throw new CaptureRejected(`A capture holds up to ${MAX_PHOTOS_PER_CAPTURE} photos. Save this one and start another.`, 'too_many_photos')
  if (out.filter(m => m.kind === 'audio').length > 1) throw new CaptureRejected('A capture holds one voice note.', 'too_many_voice_notes')
  return out
}

const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : '')
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v))

function rowToCapture(r: Record<string, unknown>, media: CaptureMediaInfo[]): SiteCapture {
  return {
    id: String(r.id), scheduleId: (r.schedule_id as string) ?? null,
    status: r.status as CaptureStatus, note: String(r.note ?? ''),
    activityCodes: Array.isArray(r.activity_codes) ? (r.activity_codes as unknown[]).map(String) : [],
    level: (r.level as string) ?? null, room: (r.room as string) ?? null, placeSource: (r.place_source as PlaceSource) ?? 'none',
    position: r.lat === null || r.lat === undefined || r.lng === null || r.lng === undefined ? null
      : { lat: Number(r.lat), lng: Number(r.lng), accuracyM: numOrNull(r.accuracy_m), altitudeM: numOrNull(r.altitude_m), headingDeg: numOrNull(r.heading_deg) },
    takenAt: iso(r.taken_at), createdAt: iso(r.created_at), createdBy: (r.created_by as string) ?? null, createdByName: (r.created_by_name as string) ?? null,
    media,
  }
}
const rowToMedia = (m: Record<string, unknown>): CaptureMediaInfo => ({
  id: String(m.id), kind: m.kind === 'audio' ? 'audio' : 'photo', contentType: String(m.content_type), sizeBytes: Number(m.size_bytes),
  width: numOrNull(m.width), height: numOrNull(m.height), seconds: numOrNull(m.seconds),
})

// The columns of a capture without anything heavy; media bytes are only ever read one file at a time.
const CAPTURE_COLS = 'id, schedule_id, status, note, activity_codes, level, room, place_source, lat, lng, accuracy_m, altitude_m, heading_deg, taken_at, created_by, created_by_name, created_at'
const MEDIA_COLS = 'id, capture_id, kind, content_type, size_bytes, width, height, seconds'

async function withMedia(orgId: string, rows: Record<string, unknown>[]): Promise<SiteCapture[]> {
  if (!rows.length) return []
  const media = await query(`SELECT ${MEDIA_COLS} FROM site_capture_media WHERE org_id=$1 AND capture_id = ANY($2) ORDER BY kind DESC, created_at, id`, [orgId, rows.map(r => r.id)])
  const by = new Map<string, CaptureMediaInfo[]>()
  for (const m of media.rows) { const list = by.get(String(m.capture_id)) ?? []; list.push(rowToMedia(m)); by.set(String(m.capture_id), list) }
  return rows.map(r => rowToCapture(r, by.get(String(r.id)) ?? []))
}

/** The project's captures, newest first. `before` pages further back (the takenAt of the last one shown). */
export async function listCaptures(orgId: string, key: string, opts: { limit?: number; before?: string | null; since?: string | null } = {}): Promise<SiteCapture[]> {
  await initSchema()
  const limit = Math.max(1, Math.min(200, opts.limit ?? 60))
  const res = await query(
    `SELECT ${CAPTURE_COLS} FROM site_captures WHERE org_id=$1 AND project_key=$2 AND deleted_at IS NULL
       AND ($3::timestamptz IS NULL OR taken_at < $3) AND ($4::timestamptz IS NULL OR taken_at >= $4)
     ORDER BY taken_at DESC, id LIMIT ${limit}`,
    [orgId, key, opts.before || null, opts.since || null])
  return withMedia(orgId, res.rows)
}

export async function getCapture(orgId: string, key: string, id: string): Promise<SiteCapture | null> {
  await initSchema()
  const res = await query(`SELECT ${CAPTURE_COLS} FROM site_captures WHERE org_id=$1 AND project_key=$2 AND id=$3 AND deleted_at IS NULL`, [orgId, key, id])
  return (await withMedia(orgId, res.rows))[0] ?? null
}

/** How many captures the project holds, and the levels and rooms used so far (the capture screen offers them). */
export async function captureOverview(orgId: string, key: string): Promise<{ count: number; levels: string[]; rooms: { level: string | null; room: string }[] }> {
  await initSchema()
  const count = await query('SELECT COUNT(*)::int AS n FROM site_captures WHERE org_id=$1 AND project_key=$2 AND deleted_at IS NULL', [orgId, key])
  const places = await query(
    `SELECT level, room, MAX(taken_at) AS last FROM site_captures WHERE org_id=$1 AND project_key=$2 AND deleted_at IS NULL AND (level IS NOT NULL OR room IS NOT NULL)
     GROUP BY level, room ORDER BY last DESC LIMIT 300`, [orgId, key])
  const levels = [...new Set(places.rows.map(p => p.level as string | null).filter((l): l is string => !!l))]
  const rooms = places.rows.filter(p => p.room).map(p => ({ level: (p.level as string) ?? null, room: String(p.room) }))
  return { count: Number(count.rows[0]?.n ?? 0), levels, rooms }
}

/**
 * Stores a capture with its photos and voice note in one transaction. `full` when the project holds the most it
 * can. A capture the phone already sent (same clientId) is returned as it was stored, never stored twice;
 * `deleted` when that earlier one has since been deleted.
 */
export async function createCapture(orgId: string, key: string, scheduleId: string, f: CaptureFields, media: CheckedMedia[],
  by: { userId: string; name: string }, classification: string | null): Promise<{ capture: SiteCapture; duplicate: boolean } | 'full' | 'deleted'> {
  await initSchema()
  const earlier = async (): Promise<{ capture: SiteCapture; duplicate: boolean } | 'deleted' | null> => {
    if (!f.clientId) return null
    const res = await query('SELECT id, deleted_at FROM site_captures WHERE org_id=$1 AND project_key=$2 AND client_id=$3', [orgId, key, f.clientId])
    if (!res.rows[0]) return null
    if (res.rows[0].deleted_at) return 'deleted'
    const capture = await getCapture(orgId, key, String(res.rows[0].id))
    return capture ? { capture, duplicate: true } : 'deleted'
  }
  const sent = await earlier()
  if (sent) return sent
  const id = randomUUID()
  let created: boolean
  try {
    created = await withTransaction(async q => {
      const count = await q('SELECT COUNT(*)::int AS n FROM site_captures WHERE org_id=$1 AND project_key=$2 AND deleted_at IS NULL', [orgId, key])
      if (Number(count.rows[0]?.n) >= MAX_CAPTURES_PER_PROJECT) return false
      await q(`INSERT INTO site_captures (id, org_id, project_key, schedule_id, status, note, activity_codes, level, room, place_source, lat, lng, accuracy_m, altitude_m, heading_deg, taken_at, classification, created_by, created_by_name, client_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [id, orgId, key, scheduleId, f.status, f.note, JSON.stringify(f.activityCodes), f.level, f.room, f.placeSource,
          f.position?.lat ?? null, f.position?.lng ?? null, f.position?.accuracyM ?? null, f.position?.altitudeM ?? null, f.position?.headingDeg ?? null,
          f.takenAt, classification, by.userId, by.name, f.clientId ?? null])
      for (const m of media) {
        await q(`INSERT INTO site_capture_media (id, org_id, capture_id, kind, content_type, size_bytes, sha256, width, height, seconds, content)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [randomUUID(), orgId, id, m.kind, m.contentType, m.bytes.length, m.sha256, m.width, m.height, m.seconds, m.bytes])
      }
      return true
    })
  } catch (err) {
    // Two sends of the same capture at once: the second finds the first's row through the unique index.
    if ((err as { code?: string }).code === '23505') { const again = await earlier(); if (again) return again }
    throw err
  }
  if (!created) return 'full'
  const capture = await getCapture(orgId, key, id)
  if (!capture) throw new Error('The capture was stored and could not be read back.')
  return { capture, duplicate: false }
}

/** One photo or voice note of a capture in this project, with its bytes. */
export async function getCaptureMedia(orgId: string, key: string, captureId: string, mediaId: string): Promise<{ contentType: string; kind: 'photo' | 'audio'; bytes: Buffer; sha256: string } | null> {
  await initSchema()
  const res = await query(
    `SELECT m.content_type, m.kind, m.content, m.sha256 FROM site_capture_media m
       JOIN site_captures c ON c.id = m.capture_id AND c.org_id = m.org_id
     WHERE m.org_id=$1 AND c.project_key=$2 AND m.capture_id=$3 AND m.id=$4 AND c.deleted_at IS NULL`,
    [orgId, key, captureId, mediaId])
  const r = res.rows[0]
  return r ? { contentType: String(r.content_type), kind: r.kind === 'audio' ? 'audio' : 'photo', bytes: r.content as Buffer, sha256: String(r.sha256) } : null
}

/**
 * Deletes a capture: its photos and voice note are erased, its words and position are blanked, and the row
 * stays as a dated tombstone (who, when) so the record shows that something was removed.
 */
export async function deleteCapture(orgId: string, key: string, id: string): Promise<{ capture: SiteCapture; mediaDeleted: number } | null> {
  const before = await getCapture(orgId, key, id)
  if (!before) return null
  const mediaDeleted = await withTransaction(async q => {
    const del = await q('DELETE FROM site_capture_media WHERE org_id=$1 AND capture_id=$2', [orgId, id])
    await q(`UPDATE site_captures SET deleted_at=NOW(), note='', activity_codes='[]'::jsonb, level=NULL, room=NULL, place_source='none', lat=NULL, lng=NULL, accuracy_m=NULL, altitude_m=NULL, heading_deg=NULL
      WHERE org_id=$1 AND project_key=$2 AND id=$3`, [orgId, key, id])
    return del.rowCount ?? 0
  })
  return { capture: before, mediaDeleted }
}

/** Everything about the organization's captures except the photo and audio bytes (their sizes and SHA-256 are listed). */
export async function exportCaptures(orgId: string) {
  await initSchema()
  const caps = await query(`SELECT ${CAPTURE_COLS}, project_key, classification, deleted_at FROM site_captures WHERE org_id=$1 ORDER BY created_at`, [orgId])
  const media = await query('SELECT id, capture_id, kind, content_type, size_bytes, sha256, width, height, seconds, created_at FROM site_capture_media WHERE org_id=$1 ORDER BY created_at', [orgId])
  return caps.rows.map(c => ({ ...c, media: media.rows.filter(m => m.capture_id === c.id) }))
}
