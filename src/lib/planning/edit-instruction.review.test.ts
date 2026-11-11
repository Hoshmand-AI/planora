import { describe, it, expect } from 'vitest'
import { readClause, readInstruction, type RefActivity } from './edit-instruction'

// Misreads found by a line-by-line review: each showed the wrong activity or constraint in the preview.
const acts: RefActivity[] = [
  { id: 'a1', code: '1', name: 'Mobilize' }, { id: 'a2', code: '2', name: 'Excavate' }, { id: 'a3', code: '3', name: 'Level 2 Framing' },
  { id: 'a4', code: '4', name: 'Slab' }, { id: 'a5', code: '5', name: 'Roof Framing' }, { id: 'a6', code: '6', name: 'Roofing' },
  { id: 'a7', code: '15', name: 'Drywall' }, { id: 'a8', code: '8', name: 'Interior Finishes' }, { id: 'a9', code: '9', name: 'Backfill after waterproofing' },
  { id: 'b1', code: 'A1010', name: 'Steel erection' },
]
const step = (t: string, o = {}) => { const r = readClause(t, acts, o); return r && 'step' in r ? r.step : r }

describe('plain-English edits: names, numbers and negation', () => {
  it('a number inside a name is not an activity ID', () => {
    expect(step('extend Level 2 Framing by 5 days')).toEqual({ op: 'duration', activityId: 'a3', delta: 5 })
    expect(step('extend 2 by 5 days')).toEqual({ op: 'duration', activityId: 'a2', delta: 5 })
    expect(step('extend activity #15 by 2 days')).toEqual({ op: 'duration', activityId: 'a7', delta: 2 })
    expect(step('extend A1010 steel by 2 days')).toEqual({ op: 'duration', activityId: 'b1', delta: 2 })
    const r = readClause('Mobilize must finish before March 15', acts)
    expect(r && 'step' in r).toBe(false)
  })
  it('a multi-word name before "N days after" is kept whole', () => {
    expect(step('Roof Framing 5 days after Slab')).toEqual({ op: 'link', from: 'a4', to: 'a5', type: 'FS', lag: 5 })
    expect(step('start Roof Framing 3 days after Slab starts')).toEqual({ op: 'link', from: 'a4', to: 'a5', type: 'SS', lag: 3 })
    expect(step('Roofing after Roof Framing')).toEqual({ op: 'link', from: 'a5', to: 'a6', type: 'FS', lag: 0 })
    expect(step('Interior Finishes after Drywall')).toEqual({ op: 'link', from: 'a7', to: 'a8', type: 'FS', lag: 0 })
    expect(step('Roofing finishes 2 days after Roof Framing finishes')).toEqual({ op: 'link', from: 'a5', to: 'a6', type: 'FF', lag: 2 })
  })
  it('a negated "after" or "before" sets the right constraint', () => {
    expect(step('Roofing cannot finish after 03/15/2027')).toMatchObject({ type: 'FNLT', date: '2027-03-15' })
    expect(step('Roofing must not start after 03/15/2027')).toMatchObject({ type: 'SNLT' })
    expect(step('Roofing must not start before 03/15/2027')).toMatchObject({ type: 'SNET' })
    expect(step('Roofing must start after 03/15/2027')).toMatchObject({ type: 'SNET' })
    expect(step('Roofing must finish by 03/15/2027')).toMatchObject({ type: 'FNLT' })
    expect(step('Roofing must finish no later than 03/15/2027')).toMatchObject({ type: 'FNLT' })
    expect(step('Roofing must start no earlier than 03/15/2027')).toMatchObject({ type: 'SNET' })
    expect(step('Backfill after waterproofing must finish on 03/15/2027')).toMatchObject({ activityId: 'a9', type: 'MFO' })
  })
  it('lateness is not a duration, and days can be taken off without deleting the activity', () => {
    expect(readClause('A1010 is 5 days late', acts)).toBeNull()
    expect(step('remove 5 days from A1010', { allowStructural: true })).toEqual({ op: 'duration', activityId: 'b1', delta: -5 })
    expect(step('remove A1010', { allowStructural: true })).toEqual({ op: 'remove', activityId: 'b1' })
    expect(readClause('delay A1010 by 5 days', acts)).toBeNull()
  })
  it('two edits joined by "and" are both read or the clause is refused, never half applied', () => {
    const r = readInstruction('extend A1010 by 5 days and shorten Slab by 3 days', acts)
    const steps = r.filter(x => x.step)
    expect(steps.length === 2 || steps.length === 0).toBe(true)
  })
})
