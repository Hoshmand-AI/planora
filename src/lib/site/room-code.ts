// Reading a room code back. A code printed from RunF9 holds a link to the Site page with the level and the room
// (see roomCodePath). The phone's own camera opens that link; and when a code is in the frame of a site photo,
// the capture screen reads it from the photo and fills in the place, so the picture itself says where it was taken.

import { MAX_PLAN_NAME_CHARS, sameLevel, type SitePlan } from './plan'

export interface RoomCode { scheduleId: string | null; level: string | null; room: string | null }

/** What a scanned code says, when it is a RunF9 room code; null for any other code (a product label, a web address). */
export function parseRoomCode(text: string): RoomCode | null {
  let url: URL
  try { url = new URL(text.trim(), 'https://runf9.invalid') } catch { return null }
  if (url.pathname.replace(/\/+$/, '') !== '/dashboard/site') return null
  const clean = (v: string | null) => (v ? v.replace(/\s+/g, ' ').trim().slice(0, MAX_PLAN_NAME_CHARS) : '') || null
  const level = clean(url.searchParams.get('level')), room = clean(url.searchParams.get('room'))
  if (!level && !room) return null
  const schedule = url.searchParams.get('schedule')
  return { scheduleId: schedule && /^[A-Za-z0-9_-]{1,80}$/.test(schedule) ? schedule : null, level, room }
}

/**
 * Whether a code belongs to this project: it names this upload, or a room marked on one of the project's
 * drawings (a code printed before a schedule update still names the same room). A code from another project
 * is ignored rather than trusted.
 */
export function roomCodeIsOurs(code: RoomCode, scheduleId: string, plans: Pick<SitePlan, 'level' | 'rooms'>[]): boolean {
  if (code.scheduleId && code.scheduleId === scheduleId) return true
  if (!code.level || !code.room) return false
  const room = code.room.toLowerCase()
  return plans.some(p => sameLevel(p.level, code.level!) && p.rooms.some(r => r.name.toLowerCase() === room))
}
