import { describe, expect, it } from 'vitest'
import { distanceM } from './capture'
import { capturePoint, fitPlan, locate, metersPerPixel, parseControls, parseRooms, roomAt, roomCodePath, validTile, worldToGeo, worldXY, type SitePlan } from './plan'

// A 1000 × 500 px drawing of a building 100 m wide and 50 m deep, turned 30° clockwise from north, in Denver.
const LAT0 = 39.7392, LNG0 = -104.9903, RAD = Math.PI / 180, R = 6_371_008.8
function truth(x: number, y: number, turn = 30) {
  // Drawing metres: right = x·100, down = y·50. "Up" on the drawing points to bearing `turn`.
  const right = x * 100, up = -y * 50, t = turn * RAD
  const e = right * Math.cos(t) + up * Math.sin(t), n = -right * Math.sin(t) + up * Math.cos(t)
  return { lat: LAT0 + n / R / RAD, lng: LNG0 + e / (R * Math.cos(LAT0 * RAD)) / RAD }
}
const control = (x: number, y: number) => ({ x, y, ...truth(x, y) })
const plan = (over: Partial<SitePlan> = {}): SitePlan => ({
  id: 'p2', level: 'Level 2', width: 1000, height: 500, sort: 0, updatedAt: '2026-01-01T00:00:00Z',
  controls: [control(0.1, 0.1), control(0.9, 0.8)],
  rooms: [{ id: 'a', name: 'Unit 201 kitchen', x: 0.2, y: 0.3 }, { id: 'b', name: 'Unit 202 kitchen', x: 0.8, y: 0.3 }, { id: 'c', name: 'Corridor', x: 0.5, y: 0.6 }],
  ...over,
})

describe('placing a drawing on the ground', () => {
  it('two matched points recover position, turn and scale', () => {
    const fit = fitPlan(plan())!
    expect(fit.widthM).toBeCloseTo(100, 1)
    expect(fit.rotationDeg).toBeCloseTo(30, 0)
    expect(fit.residualM).toBeLessThan(0.01)
    for (const [x, y] of [[0, 0], [1, 1], [0.5, 0.25], [0.2, 0.9]]) {
      expect(distanceM(fit.toGeo({ x, y }), truth(x, y))).toBeLessThan(0.05)
      const back = fit.toPlan(truth(x, y))
      expect(back.x).toBeCloseTo(x, 4); expect(back.y).toBeCloseTo(y, 4)
    }
  })
  it('three matched points agree with two', () => {
    const fit = fitPlan(plan({ controls: [control(0.1, 0.1), control(0.9, 0.8), control(0.2, 0.9)] }))!
    expect(distanceM(fit.toGeo({ x: 0.7, y: 0.2 }), truth(0.7, 0.2))).toBeLessThan(0.05)
    expect(fit.rotationDeg).toBeCloseTo(30, 0)
  })
  it('north-up drawing has no turn', () => {
    const c = (x: number, y: number) => ({ x, y, ...truth(x, y, 0) })
    expect(fitPlan(plan({ controls: [c(0, 0), c(1, 1)] }))!.rotationDeg).toBeCloseTo(0, 0)
  })
  it('refuses points that cannot place a drawing', () => {
    expect(fitPlan(plan({ controls: [] }))).toBeNull()
    expect(fitPlan(plan({ controls: [control(0.1, 0.1)] }))).toBeNull()
    expect(fitPlan(plan({ controls: [control(0.1, 0.1), { ...control(0.9, 0.8), x: 0.1, y: 0.1 }] }))).toBeNull()
    // Three points in a line on the drawing
    expect(fitPlan(plan({ controls: [control(0.1, 0.1), control(0.5, 0.5), control(0.9, 0.9)] }))).toBeNull()
    // A mirrored match (two ground points swapped among three)
    const [a, b, c] = [control(0.1, 0.1), control(0.9, 0.1), control(0.1, 0.9)]
    expect(fitPlan(plan({ controls: [a, { ...b, lat: c.lat, lng: c.lng }, { ...c, lat: b.lat, lng: b.lng }] }))).toBeNull()
    // A third point that is badly misplaced would skew the sheet: refused, not accepted as a placement
    const off = control(0.2, 0.9)
    expect(fitPlan(plan({ controls: [control(0.1, 0.1), control(0.9, 0.8), { ...off, lat: off.lat + 0.0003 }] }))).toBeNull()
    // Both matched points at the same place on the ground
    expect(fitPlan(plan({ controls: [control(0.1, 0.1), { ...control(0.1, 0.1), x: 0.9, y: 0.9 }] }))).toBeNull()
  })
})

describe('which room a position points to', () => {
  it('names the room when the fix is good and one room is clearly nearest', () => {
    const at = truth(0.21, 0.31)
    const r = locate([plan()], { ...at, accuracyM: 6 }, 'Level 2')
    expect(r.onSite).toBe(true)
    expect(r.best?.room).toBe('Unit 201 kitchen')
    expect(r.rooms[0].distanceM).toBeLessThan(2)
  })
  it('does not choose between two rooms inside the same uncertainty', () => {
    const r = locate([plan({ rooms: [{ id: 'a', name: 'Bath A', x: 0.50, y: 0.5 }, { id: 'b', name: 'Bath B', x: 0.53, y: 0.5 }] })], { ...truth(0.51, 0.5), accuracyM: 10 }, 'Level 2')
    expect(r.best).toBeNull()
    expect(r.rooms.map(x => x.room)).toEqual(['Bath A', 'Bath B'])
  })
  it('never picks a floor: the same kitchen on two levels is offered on both', () => {
    const l2 = plan(), l3 = plan({ id: 'p3', level: 'Level 3' })
    const all = locate([l2, l3], { ...truth(0.2, 0.3), accuracyM: 5 })
    expect(all.best).toBeNull()
    expect(all.points.map(p => p.level)).toEqual(['Level 2', 'Level 3'])
    expect(new Set(all.rooms.slice(0, 2).map(r => r.level))).toEqual(new Set(['Level 2', 'Level 3']))
    // Once the person has said which level, the room is named
    expect(locate([l2, l3], { ...truth(0.2, 0.3), accuracyM: 5 }, 'Level 3').best).toMatchObject({ level: 'Level 3', room: 'Unit 201 kitchen' })
  })
  it('with no level given it names no room, even when only one drawing is placed', () => {
    const r = locate([plan()], { ...truth(0.21, 0.31), accuracyM: 5 })
    expect(r.best).toBeNull()
    expect(r.rooms[0].room).toBe('Unit 201 kitchen')
  })
  it('reads a level name as a person does', () => {
    expect(locate([plan()], { ...truth(0.21, 0.31), accuracyM: 5 }, ' level 2 ').best?.room).toBe('Unit 201 kitchen')
    expect(capturePoint(plan(), fitPlan(plan()), { level: 'LEVEL 2', room: 'Corridor', position: null })?.by).toBe('room')
  })
  it('a rough fix names no room', () => {
    expect(locate([plan()], { ...truth(0.2, 0.3), accuracyM: 60 }, 'Level 2').best).toBeNull()
  })
  it('a position off the sheet is not on site', () => {
    const r = locate([plan()], { ...truth(3, 3), accuracyM: 5 })
    expect(r.onSite).toBe(false); expect(r.rooms).toEqual([])
  })
  it('a drawing that is not placed takes no part', () => {
    expect(locate([plan({ controls: [] })], { ...truth(0.2, 0.3), accuracyM: 5 }).onSite).toBe(false)
  })
})

describe('where a capture is drawn', () => {
  const p = plan(), fit = fitPlan(p)
  it('a pin wins, then the room mark, then the position', () => {
    expect(capturePoint(p, fit, { level: 'Level 2', room: 'Corridor', position: truth(0.9, 0.9), pin: { planId: 'p2', x: 0.4, y: 0.4 } })).toEqual({ point: { x: 0.4, y: 0.4 }, by: 'pin' })
    expect(capturePoint(p, fit, { level: 'Level 2', room: 'corridor', position: truth(0.9, 0.9) })).toMatchObject({ by: 'room', point: { x: 0.5, y: 0.6 } })
    const byPos = capturePoint(p, fit, { level: 'Level 2', room: null, position: truth(0.9, 0.9) })!
    expect(byPos.by).toBe('position'); expect(byPos.point.x).toBeCloseTo(0.9, 3)
  })
  it('a capture of another level, or with no level, is not drawn from its position', () => {
    expect(capturePoint(p, fit, { level: 'Level 3', room: 'Corridor', position: truth(0.5, 0.5) })).toBeNull()
    expect(capturePoint(p, fit, { level: null, room: null, position: truth(0.5, 0.5) })).toBeNull()
  })
  it('finds the room under a tap', () => {
    expect(roomAt(p, { x: 0.22, y: 0.32 })?.name).toBe('Unit 201 kitchen')
    expect(roomAt(p, { x: 0.5, y: 0.05 })).toBeNull()
  })
})

describe('what the plan screens send', () => {
  it('rooms need a name and a place, and a name only once', () => {
    expect(parseRooms([{ name: ' Unit  201 ', x: 0.2, y: 0.3 }])).toMatchObject({ rooms: [{ name: 'Unit 201', x: 0.2, y: 0.3 }] })
    expect(parseRooms([{ name: 'A', x: 0.2, y: 0.3 }, { name: 'a', x: 0.4, y: 0.3 }])).toHaveProperty('error')
    expect(parseRooms([{ name: 'A', x: 1.2, y: 0.3 }])).toHaveProperty('error')
    expect(parseRooms([{ name: '', x: 0.2, y: 0.3 }])).toHaveProperty('error')
    expect(parseRooms('x')).toHaveProperty('error')
  })
  it('matched points: none, two or three', () => {
    expect(parseControls([])).toEqual({ controls: [] })
    expect(parseControls([control(0.1, 0.1)])).toHaveProperty('error')
    expect(parseControls([control(0.1, 0.1), control(0.9, 0.9)])).toHaveProperty('controls')
    expect(parseControls([control(0.1, 0.1), { x: 0.5, y: 0.5, lat: 95, lng: 0 }])).toHaveProperty('error')
    expect(parseControls([1, 2, 3, 4].map(() => control(0.1, 0.1)))).toHaveProperty('error')
  })
})

describe('aerial picture tiles', () => {
  it('goes to the map grid and back', () => {
    const w = worldXY(LAT0, LNG0, 18), g = worldToGeo(w.x, w.y, 18)
    expect(g.lat).toBeCloseTo(LAT0, 6); expect(g.lng).toBeCloseTo(LNG0, 6)
    expect(Math.floor(worldXY(0, 0, 1).x)).toBe(1)
  })
  it('knows the ground size of a pixel', () => { expect(metersPerPixel(0, 0)).toBeCloseTo(156_543, -1); expect(metersPerPixel(LAT0, 19)).toBeCloseTo(0.2296, 2) })
  it('accepts only tiles that exist', () => {
    expect(validTile(18, 54000, 99000)).toBe(true)
    expect(validTile(2, 4, 0)).toBe(false); expect(validTile(23, 0, 0)).toBe(false); expect(validTile(22, 0, 0)).toBe(true); expect(validTile(1.5, 0, 0)).toBe(false); expect(validTile(3, -1, 0)).toBe(false)
  })
  it('a room code opens a capture with the place filled in', () => {
    expect(roomCodePath('abc', 'Level 2', 'Unit 201 / kitchen')).toBe('/dashboard/site?schedule=abc&level=Level%202&room=Unit%20201%20%2F%20kitchen&new=1')
  })
})
