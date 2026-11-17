// The browser side of a site capture: shrinking a photo before it is sent, recording a voice note, reading the
// phone's position, and keeping a capture on the phone when there is no signal so it can be sent later.
// Nothing here talks to anything but RunF9 itself and the device's own camera, microphone and location.

import type { CapturePosition, SiteCapture } from './capture'

/** Long side, in pixels, a photo is reduced to: enough to read a label on a panel, a few hundred kB as JPEG. */
export const PHOTO_MAX_SIDE = 1600

/**
 * Re-encodes a photo as a JPEG no larger than `maxSide` on its long side, upright (the phone's rotation is
 * applied). This also drops everything the camera embedded in the file (its own position, the device model):
 * what a capture records about place and time is what the person sees on the capture screen.
 */
export async function resizePhoto(file: Blob, maxSide = PHOTO_MAX_SIDE, quality = 0.82): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width; canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This browser cannot prepare the photo.')
    ctx.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob) throw new Error('This browser cannot prepare the photo.')
    return { blob, width, height }
  } finally { bitmap.close() }
}

/** The audio format this browser's recorder writes: Opus in WebM (Chrome, Android), AAC in MP4 (Safari). */
export function audioRecordingType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) if (MediaRecorder.isTypeSupported(t)) return t
  return ''
}
export const canRecordAudio = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && audioRecordingType() !== null

export interface Recording {
  /** Stops and gives the voice note (null when nothing was recorded). */
  stop(): Promise<{ blob: Blob; seconds: number } | null>
  /** Stops and throws the recording away. */
  cancel(): void
}

/**
 * Starts recording from the microphone. The browser asks the person the first time; its own indicator shows
 * while the microphone is on, and the microphone is released as soon as the recording stops.
 */
export async function startRecording(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
  const type = audioRecordingType()
  const recorder = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32_000 } : { audioBitsPerSecond: 32_000 })
  const parts: Blob[] = []
  const started = performance.now()
  recorder.addEventListener('dataavailable', e => { if (e.data.size) parts.push(e.data) })
  recorder.start(1000)
  const release = () => stream.getTracks().forEach(t => t.stop())
  return {
    stop: () => new Promise(resolve => {
      const seconds = (performance.now() - started) / 1000
      const done = () => { release(); resolve(parts.length ? { blob: new Blob(parts, { type: recorder.mimeType || type || 'audio/webm' }), seconds } : null) }
      if (recorder.state === 'inactive') return done()
      recorder.addEventListener('stop', done, { once: true })
      recorder.stop()
    }),
    cancel: () => { try { if (recorder.state !== 'inactive') recorder.stop() } catch { /* already stopped */ } release() },
  }
}

/**
 * The phone's position, with the accuracy the phone itself states. Null when the person says no, the phone has no
 * fix within the time allowed, or the browser has no location. Never throws: a capture is saved without a position.
 */
export function currentPosition(timeoutMs = 12_000): Promise<CapturePosition | null> {
  return new Promise(resolve => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      p => resolve({
        lat: p.coords.latitude, lng: p.coords.longitude,
        accuracyM: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null,
        altitudeM: p.coords.altitude ?? null,
        headingDeg: p.coords.heading != null && Number.isFinite(p.coords.heading) ? p.coords.heading : null,
      }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 20_000 },
    )
  })
}

/** How a position's accuracy reads to a person: "within 8 m", "within 60 m (rough)". */
export function accuracyLabel(accuracyM: number | null): string {
  if (accuracyM == null) return 'accuracy not stated'
  const m = accuracyM < 10 ? Math.max(1, Math.round(accuracyM)) : Math.round(accuracyM / 5) * 5
  return `within ${m.toLocaleString('en-US')} m${accuracyM > 30 ? ' (rough)' : ''}`
}

/* ─── Sending, and keeping a capture on the phone when it cannot be sent ─────────────────────────── */

/** A capture as the capture screen holds it before it is sent. */
export interface PendingCapture {
  id: string
  scheduleId: string
  /** The text fields of the form: status, note, activityCodes (JSON), level, room, placeSource, lat, lng, accuracyM, altitudeM, headingDeg, takenAt */
  fields: Record<string, string>
  photos: Blob[]
  audio: Blob | null
  audioSeconds: number | null
  savedAt: string
}

export type SendResult = { ok: true; capture: SiteCapture } | { ok: false; offline: boolean; error: string }

/** Sends one capture. `offline` is true when the request never reached RunF9 (no signal): the capture can wait. */
export async function sendCapture(p: PendingCapture): Promise<SendResult> {
  const fd = new FormData()
  for (const [k, v] of Object.entries(p.fields)) fd.set(k, v)
  p.photos.forEach((b, i) => fd.append('photo', b, `photo-${i + 1}.jpg`))
  if (p.audio) { fd.append('audio', p.audio, 'voice-note'); if (p.audioSeconds) fd.set('audioSeconds', String(Math.round(p.audioSeconds * 10) / 10)) }
  let res: Response
  try { res = await fetch(`/api/schedules/${encodeURIComponent(p.scheduleId)}/captures`, { method: 'POST', body: fd }) }
  catch { return { ok: false, offline: true, error: 'No connection. The capture is saved on this phone and will be sent when you are back online.' } }
  const data = await res.json().catch(() => null)
  if (res.ok && data?.capture) return { ok: true, capture: data.capture as SiteCapture }
  // A gateway answering for RunF9 while it cannot be reached is the same as no signal.
  const offline = res.status === 502 || res.status === 503 || res.status === 504
  return { ok: false, offline, error: data?.error || (res.status === 413 ? 'This capture is too large to send. Remove a photo and try again.' : 'The capture could not be saved. Try again.') }
}

const DB = 'runf9-site', STORE = 'outbox'
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' }) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Storage is not available.'))
  })
}
async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode)
      const req = run(t.objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('Storage failed.'))
    })
  } finally { db.close() }
}

/** Captures waiting on this phone (private browsing and blocked storage give an empty list, never an error). */
export async function outboxList(scheduleId?: string): Promise<PendingCapture[]> {
  try {
    const all = await tx<PendingCapture[]>('readonly', s => s.getAll() as IDBRequest<PendingCapture[]>)
    return all.filter(p => !scheduleId || p.scheduleId === scheduleId).sort((a, b) => a.savedAt.localeCompare(b.savedAt))
  } catch { return [] }
}
/** Keeps a capture on this phone. False when the browser will not store it (private browsing, storage full). */
export async function outboxAdd(p: PendingCapture): Promise<boolean> {
  try { await tx('readwrite', s => s.put(p)); return true } catch { return false }
}
export async function outboxRemove(id: string): Promise<void> {
  try { await tx('readwrite', s => s.delete(id)) } catch { /* nothing to remove */ }
}

/** Sends every waiting capture of a project, oldest first; stops at the first one that still cannot go. */
export async function outboxFlush(scheduleId: string): Promise<{ sent: number; left: number; error: string | null }> {
  const waiting = await outboxList(scheduleId)
  let sent = 0
  for (const p of waiting) {
    const r = await sendCapture(p)
    if (r.ok) { await outboxRemove(p.id); sent++; continue }
    // One the server refuses for good (too large, not allowed) would block the queue forever: it stays, and is reported.
    return { sent, left: waiting.length - sent, error: r.offline ? null : r.error }
  }
  return { sent, left: 0, error: null }
}
