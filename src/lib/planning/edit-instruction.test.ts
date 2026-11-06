import { describe, expect, it } from 'vitest'
import { parseDate, parseDays, parseModelSteps, readInstruction, resolveActivity, splitClauses, toUploadedChange, type RefActivity } from './edit-instruction'

const acts: RefActivity[] = [
  { id: 'a1', code: 'A1010', name: 'Excavation', remaining: 10 },
  { id: 'a2', code: 'A1020', name: 'Spread Footings', remaining: 8 },
  { id: 'a3', code: 'A1030', name: 'Foundation Walls', remaining: 12 },
  { id: 'a4', code: 'A1040', name: 'Structural Steel Erection', remaining: 30 },
  { id: 'a5', code: 'A1050', name: 'Roofing', remaining: 15 },
  { id: 'a6', code: 'A1060', name: 'Interior Framing Level 1', remaining: 20 },
  { id: 'a7', code: 'A1070', name: 'Interior Framing Level 2', remaining: 20 },
]
const steps = (t: string, o = {}) => readInstruction(t, acts, o).map(r => r.step ?? r.error)

describe('plain-English schedule edits (rules)', () => {
  it('splits clauses and reads days, weeks and dates', () => {
    expect(splitClauses('extend A1030 by 5 days; then link A1010 to A1020.\nRoofing takes 3 weeks')).toEqual(['extend A1030 by 5 days', 'link A1010 to A1020', 'Roofing takes 3 weeks'])
    expect(parseDays('2 weeks')).toBe(10)
    expect(parseDays('five working days')).toBe(5)
    expect(parseDate('by 03/15/2027')?.iso).toBe('2027-03-15')
    expect(parseDate('on March 3, 2027')?.iso).toBe('2027-03-03')
    expect(parseDate('02/30/2027')).toBeNull()
  })

  it('finds activities by ID or by the words of their name, and says when a name is ambiguous', () => {
    expect((resolveActivity('the footings', acts) as RefActivity).code).toBe('A1020')
    expect((resolveActivity('a1040', acts) as RefActivity).name).toMatch(/Steel/)
    expect(resolveActivity('interior framing', acts)).toMatch(/matches 2 activities.*A1060.*A1070/)
    expect(resolveActivity('landscaping', acts)).toMatch(/No activity matches/)
  })

  it('reads durations: set, extend, shorten', () => {
    expect(steps('extend A1030 by 5 days')).toEqual([{ op: 'duration', activityId: 'a3', delta: 5 }])
    expect(steps('shorten structural steel by 1 week')).toEqual([{ op: 'duration', activityId: 'a4', delta: -5 }])
    expect(steps('Roofing takes 12 days')).toEqual([{ op: 'duration', activityId: 'a5', days: 12 }])
    expect(steps('set the duration of excavation to 7 days')).toEqual([{ op: 'duration', activityId: 'a1', days: 7 }])
    expect(steps('add 3 days to foundation walls')).toEqual([{ op: 'duration', activityId: 'a3', delta: 3 }])
  })

  it('reads relationships: FS, SS with lag, FF, removal', () => {
    expect(steps('Roofing after structural steel')).toEqual([{ op: 'link', from: 'a4', to: 'a5', type: 'FS', lag: 0 }])
    expect(steps('excavation before footings')).toEqual([{ op: 'link', from: 'a1', to: 'a2', type: 'FS', lag: 0 }])
    expect(steps('start A1070 5 days after A1060 starts')).toEqual([{ op: 'link', from: 'a6', to: 'a7', type: 'SS', lag: 5 }])
    expect(steps('A1070 finishes with A1060')).toEqual([{ op: 'link', from: 'a6', to: 'a7', type: 'FF', lag: 0 }])
    expect(steps('link A1010 to A1030 as SS with 2 days lag')).toEqual([{ op: 'link', from: 'a1', to: 'a3', type: 'SS', lag: 2 }])
    expect(steps('remove the link between A1020 and A1030')).toEqual([{ op: 'unlink', from: 'a2', to: 'a3' }])
    expect(steps('A1030 no longer depends on A1020')).toEqual([{ op: 'unlink', from: 'a2', to: 'a3' }])
  })

  it('reads constraints and clearing them', () => {
    expect(steps('Roofing must finish by 03/15/2027')).toEqual([{ op: 'constraint', activityId: 'a5', type: 'FNLT', date: '2027-03-15' }])
    expect(steps('Excavation cannot start before 01/04/2027')).toEqual([{ op: 'constraint', activityId: 'a1', type: 'SNET', date: '2027-01-04' }])
    expect(steps('A1040 must start on 2027-02-01')).toEqual([{ op: 'constraint', activityId: 'a4', type: 'MSO', date: '2027-02-01' }])
    expect(steps('clear the constraint on roofing')).toEqual([{ op: 'clear_constraint', activityId: 'a5' }])
  })

  it('leaves unknown text and plan-only edits unread for an uploaded schedule', () => {
    expect(steps('make it better')[0]).toMatch(/could not read/)
    expect(steps('rename A1050 to Roof membrane')[0]).toMatch(/could not read|No activity/)
    expect(steps('rename A1050 to "Roof membrane"', { allowStructural: true })).toEqual([{ op: 'rename', activityId: 'a5', name: 'Roof membrane' }])
    expect(steps('add "Owner move-in" (10 days) after A1050', { allowStructural: true })).toEqual([{ op: 'add', name: 'Owner move-in', days: 10, after: 'a5' }])
  })

  it('turns steps into uploaded-schedule edits with the remaining duration', () => {
    expect(toUploadedChange({ op: 'duration', activityId: 'a3', delta: -4 }, acts)).toEqual({ kind: 'duration', activityId: 'a3', remaining: 8 })
    expect(toUploadedChange({ op: 'rename', activityId: 'a3', name: 'x' }, acts)).toBeNull()
  })

  it('accepts model steps only with listed codes and known shapes', () => {
    const r = parseModelSteps({ steps: [
      { clause: 1, op: 'duration', code: 'A1050', delta: 4 },
      { clause: 2, op: 'link', from: 'A1010', to: 'Z9999', type: 'FS' },
      { clause: 3, op: 'unclear', why: 'no activity named' },
      { clause: 9, op: 'duration', code: 'A1010', days: 1 },
      { clause: 4, op: 'remove', code: 'A1010' },
    ] }, acts, [1, 2, 3, 4])
    expect(r.get(1)).toEqual({ step: { op: 'duration', activityId: 'a5', delta: 4 } })
    expect(r.get(2)?.error).toMatch(/not in this schedule/)
    expect(r.get(3)?.error).toMatch(/no activity named/)
    expect(r.has(9)).toBe(false)
    expect(r.get(4)?.error).toMatch(/does not support/)
    expect(() => parseModelSteps({ nope: 1 }, acts, [1])).toThrow()
  })
})
