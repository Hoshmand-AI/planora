import { describe, expect, it } from 'vitest'
import { roomCodePath } from './plan'
import { parseRoomCode, resolveRoomCode, roomCodeIsOurs } from './room-code'

describe('reading a room code back', () => {
  it('reads what RunF9 printed, with or without the site address in front', () => {
    const path = roomCodePath('sched-1', 'Level 3', 'Unit 302 / kitchen')
    expect(parseRoomCode(path)).toEqual({ scheduleId: 'sched-1', level: 'Level 3', room: 'Unit 302 / kitchen' })
    expect(parseRoomCode('https://runf9.ai' + path)).toEqual({ scheduleId: 'sched-1', level: 'Level 3', room: 'Unit 302 / kitchen' })
  })
  it('ignores every other code', () => {
    expect(parseRoomCode('https://example.com/product/123')).toBeNull()
    expect(parseRoomCode('https://runf9.ai/dashboard/documents?level=1&room=2')).toBeNull()
    expect(parseRoomCode('https://runf9.ai/dashboard/site?schedule=abc')).toBeNull()
    expect(parseRoomCode('WIFI:S:site;T:WPA;P:secret;;')).toBeNull()
    expect(parseRoomCode('')).toBeNull()
  })
  it('keeps names tidy and short', () => {
    const c = parseRoomCode(`/dashboard/site?level=${encodeURIComponent('  Level   2 ')}&room=${'x'.repeat(300)}`)!
    expect(c.level).toBe('Level 2'); expect(c.room).toHaveLength(80); expect(c.scheduleId).toBeNull()
  })
  it('belongs to the project when it names this upload or a room on its drawings', () => {
    const plans = [{ level: 'Level 3', rooms: [{ id: 'a', name: 'Unit 302 kitchen', x: 0.5, y: 0.5 }] }]
    expect(roomCodeIsOurs({ scheduleId: 's1', level: 'L9', room: 'Anything' }, 's1', [])).toBe(true)
    // Printed before a schedule update: another upload id, the same room on the drawing
    expect(roomCodeIsOurs({ scheduleId: 'old', level: 'level 3', room: 'unit 302 KITCHEN' }, 's2', plans)).toBe(true)
    expect(roomCodeIsOurs({ scheduleId: 'other', level: 'Level 3', room: 'Unit 999' }, 's2', plans)).toBe(false)
    expect(roomCodeIsOurs({ scheduleId: null, level: 'Level 3', room: null }, 's2', plans)).toBe(false)
    // Half a place is not what RunF9 prints, even with this upload's id
    expect(roomCodeIsOurs({ scheduleId: 's1', level: 'Level 3', room: null }, 's1', plans)).toBe(false)
  })
  it('gives the place in the drawing\'s own spelling', () => {
    const plans = [{ level: 'Level 3', rooms: [{ id: 'a', name: 'Unit 302 kitchen', x: 0.5, y: 0.5 }] }]
    expect(resolveRoomCode({ scheduleId: 'old', level: 'level 3', room: 'UNIT 302 KITCHEN' }, 's2', plans)).toEqual({ level: 'Level 3', room: 'Unit 302 kitchen' })
    expect(resolveRoomCode({ scheduleId: 's2', level: 'Roof', room: 'Plant room' }, 's2', plans)).toEqual({ level: 'Roof', room: 'Plant room' })
    expect(resolveRoomCode({ scheduleId: 'other', level: 'Roof', room: 'Plant room' }, 's2', plans)).toBeNull()
  })
})
