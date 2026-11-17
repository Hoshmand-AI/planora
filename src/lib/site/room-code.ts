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
 * The place a code names on this project, in the drawings' own spelling; null when the code is not this
 * project's. A code is this project's when it names a room marked on one of its drawings (a code printed before
 * a schedule update still names the same room), or when it names this upload. A code holds no more of the
 * project than that, so a code from elsewhere that names a room on these drawings reads as that room; any other
 * code is ignored. Only a code with both a level and a room counts: that is what RunF9 prints.
 */
export function resolveRoomCode(code: RoomCode, scheduleId: string, plans: Pick<SitePlan, 'level' | 'rooms'>[]): { level: string; room: string } | null {
  if (!code.level || !code.room) return null
  const wanted = code.room.toLowerCase()
  for (const p of plans) {
    if (!sameLevel(p.level, code.level)) continue
    const r = p.rooms.find(x => x.name.toLowerCase() === wanted)
    if (r) return { level: p.level, room: r.name }
  }
  return code.scheduleId && code.scheduleId === scheduleId ? { level: code.level, room: code.room } : null
}
export const roomCodeIsOurs = (code: RoomCode, scheduleId: string, plans: Pick<SitePlan, 'level' | 'rooms'>[]): boolean => !!resolveRoomCode(code, scheduleId, plans)
