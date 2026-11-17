// Site plans: a drawing of each level, the rooms marked on it, and how the drawing sits on the ground. This file
// is the pure part (no database, no network): the shapes, the validation of what the plan screens send, and the
// arithmetic that turns a phone's position into a point on a drawing and a short list of rooms it could be.
//
// What this does NOT do: tell one floor from another. A phone's position is a point on the ground with a stated
// uncertainty; identical rooms stacked on ten floors share it. The level is therefore taken from a posted room
// code, from the plan the person is looking at, or from the level they last used, and is always theirs to change.

import { distanceM, type CapturePosition } from './capture'

export const MAX_PLANS_PER_PROJECT = 40
export const MAX_ROOMS_PER_PLAN = 400
export const MAX_PLAN_BYTES = 6 * 1024 * 1024
/** Long side, in pixels, a drawing is reduced to on the device before it is sent. */
export const PLAN_MAX_SIDE = 3000
/** The largest drawing RunF9 stores: every phone that opens the map has to decode it. */
export const MAX_PLAN_PIXELS_SIDE = 6000
export const MAX_PLAN_NAME_CHARS = 80

/** A point on a drawing, as fractions of its width and height (0,0 is the top-left corner). */
export interface PlanPoint { x: number; y: number }
/** A point on the drawing matched to a point on the ground. */
export interface PlanControl extends PlanPoint { lat: number; lng: number }
export interface PlanRoom extends PlanPoint { id: string; name: string }

export interface SitePlan {
  id: string
  /** The level this drawing shows: "Level 2", "Roof", "Site" */
  level: string
  /** Pixel size of the stored drawing */
  width: number
  height: number
  /** Two or three matched points place the drawing on the ground; fewer and it is a drawing only. */
  controls: PlanControl[]
  rooms: PlanRoom[]
  sort: number
  updatedAt: string
}

const finite = (v: unknown): number | null => { const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN; return Number.isFinite(n) ? n : null }
const frac = (v: unknown): number | null => { const n = finite(v); return n === null || n < 0 || n > 1 ? null : Math.round(n * 1e5) / 1e5 }
const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

export function parseLevel(v: unknown): { level: string } | { error: string } {
  const level = clean(v, MAX_PLAN_NAME_CHARS)
  return level ? { level } : { error: 'Name the level this drawing shows, for example "Level 2".' }
}

/** Rooms as the plan screen sends them. Names are unique on a drawing (a room code has to mean one place). */
export function parseRooms(v: unknown): { rooms: PlanRoom[] } | { error: string } {
  if (!Array.isArray(v)) return { error: 'Rooms must be a list.' }
  if (v.length > MAX_ROOMS_PER_PLAN) return { error: `A drawing holds up to ${MAX_ROOMS_PER_PLAN} rooms.` }
  const rooms: PlanRoom[] = [], seen = new Set<string>()
  for (const r of v as Record<string, unknown>[]) {
    const name = clean(r?.name, MAX_PLAN_NAME_CHARS), x = frac(r?.x), y = frac(r?.y)
    if (!name || x === null || y === null) return { error: 'Each room needs a name and a place on the drawing.' }
    const key = name.toLowerCase()
    if (seen.has(key)) return { error: `"${name}" is on this drawing twice. Give each room its own name.` }
    seen.add(key)
    const id = typeof r.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(r.id) ? r.id : `r${rooms.length + 1}-${Math.round(x * 1e5)}-${Math.round(y * 1e5)}`
    rooms.push({ id, name, x, y })
  }
  return { rooms }
}

/** Matched points as the plan screen sends them: none (a drawing only), or two or three. */
export function parseControls(v: unknown): { controls: PlanControl[] } | { error: string } {
  if (!Array.isArray(v)) return { error: 'Matched points must be a list.' }
  if (v.length === 0) return { controls: [] }
  if (v.length < 2 || v.length > 3) return { error: 'Match two or three points of the drawing to the ground.' }
  const controls: PlanControl[] = []
  for (const c of v as Record<string, unknown>[]) {
    const x = frac(c?.x), y = frac(c?.y), lat = finite(c?.lat), lng = finite(c?.lng)
    if (x === null || y === null || lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) return { error: 'A matched point is not a valid place on the drawing and on the ground.' }
    controls.push({ x, y, lat: Math.round(lat * 1e7) / 1e7, lng: Math.round(lng * 1e7) / 1e7 })
  }
  return { controls }
}

/* ─── The drawing on the ground ───────────────────────────────────────────────────────────────── */

const RAD = Math.PI / 180, EARTH = 6_371_008.8

/** A drawing placed on the ground: both directions, its scale, and how well the matched points agree. */
export interface PlanFit {
  toPlan(p: { lat: number; lng: number }): PlanPoint
  toGeo(p: PlanPoint): { lat: number; lng: number }
  /** Ground metres across the drawing's width */
  widthM: number
  /** Degrees the drawing's "up" is turned clockwise from north */
  rotationDeg: number
  /** Largest disagreement, in metres, between the matched points and the fit (0 with two points) */
  residualM: number
}

/**
 * Places a drawing on the ground from its matched points. Two points fix position, turn and scale (the drawing
 * is assumed to be drawn to one scale); a third lets the two directions differ slightly (a photographed sheet).
 * Null when the points cannot place it: fewer than two, two on top of each other, three in a line, or a result
 * no building plan could have (mirrored, or a scale outside 1 mm to 100 m per pixel).
 */
export function fitPlan(plan: Pick<SitePlan, 'controls' | 'width' | 'height'>): PlanFit | null {
  const cs = plan.controls
  if (cs.length < 2 || !(plan.width > 0) || !(plan.height > 0)) return null
  const lat0 = cs[0].lat, lng0 = cs[0].lng, cos0 = Math.cos(lat0 * RAD)
  if (cos0 < 1e-6) return null
  // Ground: metres east and north of the first matched point. Drawing: pixels right and DOWN.
  const ground = (p: { lat: number; lng: number }) => ({ e: (p.lng - lng0) * RAD * EARTH * cos0, n: (p.lat - lat0) * RAD * EARTH })
  const px = (p: PlanPoint) => ({ u: p.x * plan.width, v: p.y * plan.height })
  const g = cs.map(ground), d = cs.map(px)
  // Affine map from drawing pixels to ground metres: e = a·u + b·v + c, n = d·u + f·v + h
  let a: number, b: number, c: number, dd: number, f: number, h: number
  if (cs.length === 2) {
    const du = d[1].u - d[0].u, dv = d[1].v - d[0].v, len2 = du * du + dv * dv
    if (len2 < 1) return null
    const de = g[1].e - g[0].e, dn = g[1].n - g[0].n
    if (de * de + dn * dn < 1e-4) return null
    // A similarity that keeps the drawing unmirrored: (u, -v) is a right-handed pair, like (east, north).
    const p = (de * du - dn * dv) / len2, q = (-de * dv - dn * du) / len2
    a = p; b = -q; dd = -q; f = -p
    c = g[0].e - a * d[0].u - b * d[0].v; h = g[0].n - dd * d[0].u - f * d[0].v
  } else {
    const [p0, p1, p2] = d
    const det = (p1.u - p0.u) * (p2.v - p0.v) - (p2.u - p0.u) * (p1.v - p0.v)
    if (Math.abs(det) < 1) return null
    const solve = (k0: number, k1: number, k2: number) => {
      const x = ((k1 - k0) * (p2.v - p0.v) - (k2 - k0) * (p1.v - p0.v)) / det
      const y = ((p1.u - p0.u) * (k2 - k0) - (p2.u - p0.u) * (k1 - k0)) / det
      return [x, y, k0 - x * p0.u - y * p0.v] as const
    }
    ;[a, b, c] = solve(g[0].e, g[1].e, g[2].e); [dd, f, h] = solve(g[0].n, g[1].n, g[2].n)
  }
  const det = a * f - b * dd
  // East grows with u and north falls with v on an unmirrored drawing, so the determinant is negative.
  if (!(det < 0)) return null
  const mPerPx = Math.sqrt(-det)
  if (mPerPx < 0.001 || mPerPx > 100) return null
  // A plan is drawn to one scale with square corners. Three points may bend that a little (a photographed
  // sheet); a third point that is misplaced or nearly in line with the others bends it a lot, and is refused.
  const su = Math.hypot(a, dd), sv = Math.hypot(b, f)
  if (su / sv > 1.25 || sv / su > 1.25) return null
  if (Math.abs(a * b + dd * f) / (su * sv) > 0.2) return null
  const toGeo = (p: PlanPoint) => { const { u, v } = px(p); const e = a * u + b * v + c, n = dd * u + f * v + h; return { lat: lat0 + n / EARTH / RAD, lng: lng0 + e / (EARTH * cos0) / RAD } }
  const toPlan = (p: { lat: number; lng: number }) => { const { e, n } = ground(p); const u = (f * (e - c) - b * (n - h)) / det, v = (a * (n - h) - dd * (e - c)) / det; return { x: u / plan.width, y: v / plan.height } }
  const residualM = Math.max(...cs.map(k => distanceM(k, toGeo(k))))
  // The drawing's "up" (−v) on the ground is (−b, −f); its bearing clockwise from north:
  const rotationDeg = ((Math.atan2(-b, -f) / RAD) % 360 + 360) % 360
  return { toPlan, toGeo, widthM: Math.hypot(a, dd) * plan.width, rotationDeg: Math.round(rotationDeg * 10) / 10, residualM: Math.round(residualM * 100) / 100 }
}

/** Level names are compared as a person reads them: "level 2" is "Level 2". */
export const sameLevel = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Whether a point lies on the sheet (with a small margin: a fix a step outside the outline is still "here"). */
export const onSheet = (p: PlanPoint, margin = 0.05): boolean => p.x >= -margin && p.x <= 1 + margin && p.y >= -margin && p.y <= 1 + margin

export interface RoomMatch { planId: string; level: string; room: string; distanceM: number }
export interface Located {
  /** Whether the position falls on any placed drawing of this project */
  onSite: boolean
  /** Where the position falls on each placed drawing it lies on */
  points: { planId: string; level: string; point: PlanPoint }[]
  /** Rooms the person could be standing in, nearest first, across the levels asked for */
  rooms: RoomMatch[]
  /**
   * The one room the position points to, when it does: the nearest room is within the fix's own uncertainty and
   * clearly nearer than the next. Null when two rooms are equally likely or the fix is too rough to say.
   */
  best: RoomMatch | null
}

/** A fix worse than this says which building, not which room (indoors a phone is often tens of metres off). */
export const ROOM_ACCURACY_LIMIT_M = 15

/**
 * Where a phone's position falls on the project's drawings. `level` narrows the answer to one level (the one the
 * person is on); without it every placed drawing is searched and the caller must still ask for the level.
 */
export function locate(plans: SitePlan[], position: Pick<CapturePosition, 'lat' | 'lng' | 'accuracyM'>, level?: string | null): Located {
  const points: Located['points'] = [], rooms: RoomMatch[] = []
  for (const plan of plans) {
    const fit = fitPlan(plan)
    if (!fit) continue
    const point = fit.toPlan(position)
    if (!onSheet(point)) continue
    points.push({ planId: plan.id, level: plan.level, point })
    if (level && !sameLevel(plan.level, level)) continue
    for (const r of plan.rooms) rooms.push({ planId: plan.id, level: plan.level, room: r.name, distanceM: Math.round(distanceM(position, fit.toGeo(r)) * 10) / 10 })
  }
  rooms.sort((a, b) => a.distanceM - b.distanceM)
  // Without the level there is no one room: a position cannot choose the floor, even when only one drawing is placed.
  if (!level) return { onSite: points.length > 0, points, rooms: rooms.slice(0, 6), best: null }
  const acc = position.accuracyM ?? ROOM_ACCURACY_LIMIT_M
  let best: RoomMatch | null = null
  const first = rooms[0]
  if (first && acc <= ROOM_ACCURACY_LIMIT_M && first.distanceM <= Math.max(acc, 5)) {
    // "Clearly nearer": the runner-up is further away by more than the fix's uncertainty, or is the same room on another level.
    const rival = rooms.find(r => r !== first && !(r.room === first.room && r.level !== first.level))
    if (!rival || rival.distanceM - first.distanceM > acc) best = first
  }
  return { onSite: points.length > 0, points, rooms: rooms.slice(0, 6), best }
}

/** Where a capture belongs on a drawing: where it was pinned, else where its position falls, else its room's mark. */
export function capturePoint(plan: SitePlan, fit: PlanFit | null, c: { level: string | null; room: string | null; position: { lat: number; lng: number } | null; pin?: { planId: string; x: number; y: number } | null }): { point: PlanPoint; by: 'pin' | 'position' | 'room' } | null {
  if (c.pin && c.pin.planId === plan.id) return { point: { x: c.pin.x, y: c.pin.y }, by: 'pin' }
  if (c.level && !sameLevel(c.level, plan.level)) return null
  if (c.level && c.room) { const r = plan.rooms.find(x => x.name.toLowerCase() === c.room!.toLowerCase()); if (r) return { point: { x: r.x, y: r.y }, by: 'room' } }
  if (c.level && c.position && fit) { const p = fit.toPlan(c.position); if (onSheet(p, 0)) return { point: p, by: 'position' } }
  return null
}

/** The room nearest a point on a drawing, when one is close (within a tenth of the sheet's long side). */
export function roomAt(plan: Pick<SitePlan, 'rooms' | 'width' | 'height'>, p: PlanPoint): PlanRoom | null {
  let best: PlanRoom | null = null, bestD = Infinity
  for (const r of plan.rooms) { const d = Math.hypot((r.x - p.x) * plan.width, (r.y - p.y) * plan.height); if (d < bestD) { bestD = d; best = r } }
  return best && bestD <= Math.max(plan.width, plan.height) * 0.1 ? best : null
}

/* ─── Aerial picture tiles (the standard web map grid) ────────────────────────────────────────── */

export const TILE_SIZE = 256
export const MAX_TILE_ZOOM = 22
/** Position of a place in the world map at a zoom level, in tile units (fractions included). */
export function worldXY(lat: number, lng: number, z: number): { x: number; y: number } {
  const n = 2 ** z, la = Math.max(-85.0511, Math.min(85.0511, lat)) * RAD
  return { x: ((lng + 180) / 360) * n, y: ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n }
}
export function worldToGeo(x: number, y: number, z: number): { lat: number; lng: number } {
  const n = 2 ** z
  return { lat: Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) / RAD, lng: (x / n) * 360 - 180 }
}
/** Ground metres per screen pixel at a latitude and zoom. */
// The web map grid is drawn on a sphere of the equatorial radius.
export const metersPerPixel = (lat: number, z: number): number => (Math.cos(lat * RAD) * 2 * Math.PI * 6_378_137) / (TILE_SIZE * 2 ** z)
export function validTile(z: number, x: number, y: number): boolean {
  return Number.isInteger(z) && Number.isInteger(x) && Number.isInteger(y) && z >= 0 && z <= MAX_TILE_ZOOM && x >= 0 && y >= 0 && x < 2 ** z && y < 2 ** z
}

/** The link a posted room code opens: a new capture with the level and room already filled in. */
export function roomCodePath(scheduleId: string, level: string, room: string): string {
  return `/dashboard/site?schedule=${encodeURIComponent(scheduleId)}&level=${encodeURIComponent(level)}&room=${encodeURIComponent(room)}&new=1`
}
