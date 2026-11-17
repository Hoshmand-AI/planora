// Site captures: what someone saw on site. A photo, a spoken note and a few words, stamped with who, when and
// where, and tied to schedule activities. This file is the pure part (no database, no network): the shapes, the
// validation of what a phone sends, and the checks on the photo and audio bytes. It is shared by the server
// routes and the capture screen.
//
// What a capture is NOT: a measurement. A phone's position is good to a few metres outdoors and worse indoors, so
// the place recorded here is a site, a level and a room, with the position's own stated uncertainty beside it.

/**
 * Whether this deployment offers site captures. RUNF9_SITE_CAPTURE=off (set when the app is built) keeps the
 * camera, microphone and location blocked for every origin (next.config.js) and hides the feature.
 */
export const siteCaptureEnabled = (): boolean => process.env.RUNF9_SITE_CAPTURE !== 'off'

export const CAPTURE_STATUSES = ['progress', 'complete', 'not_started', 'issue'] as const
export type CaptureStatus = typeof CAPTURE_STATUSES[number]

/** What the person is saying about the work they are looking at. */
export const CAPTURE_STATUS_LABELS: Record<CaptureStatus, string> = {
  progress: 'In progress',
  complete: 'Done',
  not_started: 'Not started',
  issue: 'Problem',
}

/** How the place was set: picked from the list, read from a posted room code, or matched from the phone's position. */
export const PLACE_SOURCES = ['none', 'picked', 'code', 'position'] as const
export type PlaceSource = typeof PLACE_SOURCES[number]

export interface CapturePosition {
  lat: number
  lng: number
  /** The radius, in metres, the phone itself reports for this fix (68% confidence). */
  accuracyM: number | null
  altitudeM: number | null
  /** Compass direction the phone was pointing, degrees clockwise from north. */
  headingDeg: number | null
}

export interface CaptureFields {
  status: CaptureStatus
  note: string
  activityCodes: string[]
  level: string | null
  room: string | null
  placeSource: PlaceSource
  position: CapturePosition | null
  /** When the photo was taken, by the phone's clock (the server records when it arrived separately). */
  takenAt: string
  /** The id the phone gave this capture before sending it; sending the same one again is not a second capture */
  clientId?: string | null
}

export interface CaptureMediaInfo {
  id: string
  kind: 'photo' | 'audio'
  contentType: string
  sizeBytes: number
  width: number | null
  height: number | null
  seconds: number | null
}

/** An activity as the capture screen offers it: its ID, its name and where the schedule has it. */
export interface CaptureActivity { code: string; name: string; state: 'in_progress' | 'not_started' | 'complete'; start: string | null; finish: string | null }

/**
 * The pick list for "which activity is this?": work under way first, then what starts soonest, then the rest;
 * finished work last. A person on site is almost always looking at the first few.
 */
export function orderForCapture(list: CaptureActivity[]): CaptureActivity[] {
  const rank = { in_progress: 0, not_started: 1, complete: 2 } as const
  return [...list].sort((a, b) => rank[a.state] - rank[b.state] || (a.start ?? '9999').localeCompare(b.start ?? '9999') || a.code.localeCompare(b.code))
}

export interface SiteCapture extends CaptureFields {
  id: string
  scheduleId: string | null
  createdAt: string
  createdBy: string | null
  createdByName: string | null
  media: CaptureMediaInfo[]
}

export const MAX_NOTE_CHARS = 4000
export const MAX_PLACE_CHARS = 80
export const MAX_CAPTURE_ACTIVITIES = 20
export const MAX_PHOTOS_PER_CAPTURE = 4
/** A photo is resized on the phone to about 1600 px on its long side before it is sent: a few hundred kB. */
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024
/** A two-minute voice note is about 1 MB as AAC and half that as Opus. */
export const MAX_AUDIO_BYTES = 3 * 1024 * 1024
export const MAX_AUDIO_SECONDS = 180
/** Everything one capture sends, together (the platform's own request limit is applied on top of this). */
export const MAX_CAPTURE_BYTES = 8 * 1024 * 1024
export const MAX_CAPTURES_PER_PROJECT = 5000

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Validates what the capture screen sends. Returns the clean fields, or a sentence the person can act on.
 * `now` is passed in so the rule about the phone's clock can be tested.
 */
export function parseCaptureFields(b: Record<string, unknown>, now: Date = new Date()): { fields: CaptureFields } | { error: string } {
  if (!CAPTURE_STATUSES.includes(b.status as CaptureStatus)) return { error: `Say what you saw: ${CAPTURE_STATUSES.map(s => CAPTURE_STATUS_LABELS[s].toLowerCase()).join(', ')}.` }
  // A note keeps its line breaks (people dictate lists); runs of spaces inside a line are collapsed.
  const note = typeof b.note === 'string' ? b.note.split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_NOTE_CHARS) : ''

  let codes: unknown = b.activityCodes
  if (typeof codes === 'string') { const raw = codes; try { codes = JSON.parse(raw) } catch { codes = raw.split(',') } }
  if (codes !== undefined && codes !== null && !Array.isArray(codes)) return { error: 'Activities must be a list of activity IDs.' }
  const activityCodes = [...new Set(((codes as unknown[]) ?? []).map(x => String(x).trim().slice(0, 60)).filter(Boolean))].slice(0, MAX_CAPTURE_ACTIVITIES)

  const level = text(b.level, MAX_PLACE_CHARS) || null
  const room = text(b.room, MAX_PLACE_CHARS) || null
  let placeSource: PlaceSource = PLACE_SOURCES.includes(b.placeSource as PlaceSource) ? (b.placeSource as PlaceSource) : 'none'
  if (!level && !room) placeSource = 'none'
  else if (placeSource === 'none') placeSource = 'picked'

  let position: CapturePosition | null = null
  const lat = num(b.lat), lng = num(b.lng)
  if (lat !== null || lng !== null) {
    if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) return { error: 'The position sent by the phone is not a valid latitude and longitude.' }
    const acc = num(b.accuracyM), alt = num(b.altitudeM), head = num(b.headingDeg)
    position = {
      // Seven decimals is about a centimetre: finer than any phone, and it keeps stored values tidy.
      lat: Math.round(lat * 1e7) / 1e7, lng: Math.round(lng * 1e7) / 1e7,
      accuracyM: acc !== null && acc >= 0 && acc < 100_000 ? Math.round(acc * 10) / 10 : null,
      altitudeM: alt !== null && alt > -1000 && alt < 10_000 ? Math.round(alt * 10) / 10 : null,
      headingDeg: head !== null && head >= 0 && head <= 360 ? Math.round(head) % 360 : null,
    }
  }

  let takenAt = now.toISOString()
  if (typeof b.takenAt === 'string' && b.takenAt) {
    const t = Date.parse(b.takenAt)
    if (Number.isNaN(t)) return { error: 'The time the photo was taken is not a valid date.' }
    // A capture saved offline can arrive days later; one dated in the future is a wrong phone clock.
    if (t > now.getTime() + 24 * 3600_000) return { error: "The phone's clock is ahead of today. Check the date on the phone and try again." }
    if (t < Date.UTC(2000, 0, 1)) return { error: 'The time the photo was taken is not a valid date.' }
    takenAt = new Date(t).toISOString()
  }
  const clientId = typeof b.clientId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(b.clientId) ? b.clientId : null
  return { fields: { status: b.status as CaptureStatus, note, activityCodes, level, room, placeSource, position, takenAt, clientId } }
}

/** A capture has to say something: a photo, a voice note or a few words. */
export function captureIsEmpty(f: Pick<CaptureFields, 'note'>, mediaCount: number): boolean {
  return mediaCount === 0 && f.note.length < 3
}

export type MediaKind = 'photo' | 'audio'
const ascii = (b: Uint8Array, at: number, len: number) => String.fromCharCode(...b.subarray(at, at + len))

/**
 * What the bytes really are, from their first bytes (never from the file name or the type the browser claims).
 * Photos: JPEG, PNG, WebP. Voice notes: what phone browsers record (WebM/Opus, MP4/AAC, Ogg), plus WAV and MP3.
 * Anything else is refused, so the media route can never be made to serve HTML or a script.
 */
export function sniffMedia(bytes: Uint8Array): { kind: MediaKind; contentType: string } | null {
  if (bytes.length < 12) return null
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { kind: 'photo', contentType: 'image/jpeg' }
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') return { kind: 'photo', contentType: 'image/png' }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return { kind: 'photo', contentType: 'image/webp' }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') return { kind: 'audio', contentType: 'audio/wav' }
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return { kind: 'audio', contentType: 'audio/webm' }
  if (ascii(bytes, 0, 4) === 'OggS') return { kind: 'audio', contentType: 'audio/ogg' }
  // ISO base media (MP4 / M4A): a "ftyp" box at offset 4. A phone's recorder writes audio in it; a HEIC photo
  // has the same box with an image brand, and is not accepted (the capture screen converts photos to JPEG).
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4).toLowerCase()
    if (/^(heic|heix|hevc|heim|heis|mif1|msf1|avif)$/.test(brand)) return null
    return { kind: 'audio', contentType: 'audio/mp4' }
  }
  if (ascii(bytes, 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) !== 0)) return { kind: 'audio', contentType: 'audio/mpeg' }
  return null
}

/** Width and height of a JPEG, PNG or WebP from its header (null when the header is not understood). */
export function imageSize(bytes: Uint8Array, contentType: string): { width: number; height: number } | null {
  const u16 = (o: number) => (bytes[o] << 8) | bytes[o + 1]
  const u32 = (o: number) => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0
  try {
    if (contentType === 'image/png' && bytes.length >= 24) return { width: u32(16), height: u32(20) }
    if (contentType === 'image/jpeg') {
      let o = 2
      while (o + 9 < bytes.length) {
        if (bytes[o] !== 0xff) { o++; continue }
        const marker = bytes[o + 1]
        // Start-of-frame markers carry the size (C4, C8 and CC are tables, not frames).
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: u16(o + 5), width: u16(o + 7) }
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { o += 2; continue }
        o += 2 + u16(o + 2)
      }
      return null
    }
    if (contentType === 'image/webp' && bytes.length >= 30) {
      const fourcc = ascii(bytes, 12, 4)
      if (fourcc === 'VP8X') return { width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) }
      if (fourcc === 'VP8 ') return { width: (bytes[26] | (bytes[27] << 8)) & 0x3fff, height: (bytes[28] | (bytes[29] << 8)) & 0x3fff }
      if (fourcc === 'VP8L') { const v = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24); return { width: (v & 0x3fff) + 1, height: ((v >>> 14) & 0x3fff) + 1 } }
    }
  } catch { /* a truncated header */ }
  return null
}

/** "Level 2 · Data Hall 1", "Level 2", "Data Hall 1", or '' when no place was given. */
export function placeLabel(c: Pick<CaptureFields, 'level' | 'room'>): string {
  return [c.level, c.room].filter(Boolean).join(' · ')
}

/** The few words that stand for a capture in a list or a brief: its note's first sentence, else what it holds. */
export function captureSummary(c: Pick<SiteCapture, 'note' | 'media' | 'status'>, max = 160): string {
  const first = c.note.split('\n').find(l => l.trim())?.trim() ?? ''
  if (first) return first.length > max ? first.slice(0, max - 1).trimEnd() + '…' : first
  const photos = c.media.filter(m => m.kind === 'photo').length
  const audio = c.media.some(m => m.kind === 'audio')
  return [photos ? `${photos} photo${photos === 1 ? '' : 's'}` : '', audio ? 'voice note' : ''].filter(Boolean).join(' and ') || CAPTURE_STATUS_LABELS[c.status]
}

/** Great-circle distance in metres between two positions. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_008.8, rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}
