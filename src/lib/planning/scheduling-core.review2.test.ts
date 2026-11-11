// Line-by-line review, MEDIUM findings M2 to M8 of the scheduling core. 5-day calendar, project start Monday 03/02/2026.
import { describe, expect, it } from 'vitest'
import type { Activity, Relationship } from '@/lib/db'
import type { GeneratedSchedule, PlanActivity, PlanLink } from './types'
import { applyScheduleEdits, revertLoopError, validateEditChange, type ScheduleEdit, type ScheduleEditChange } from './uploaded-edits'
import { completeSchedule } from './complete-schedule'
import { uploadedToGenerated } from './uploaded'
import { runSra } from './sra'
import { runCpm } from './cpm'
import { defaultCalendar } from './calendar'
import { evaluateNetwork, uploadedRecoveryOptions, type NetworkInput } from './uploaded-recovery'
import { planLevelingNetwork, uploadedLevelingNetwork } from './leveling'
import { readClause, toPlanEdit, toUploadedChange } from './edit-instruction'
import { applyEdit } from './overrides'
import { suggestLogic } from '@/lib/logic-assist'

const A = (id: string, code: string, name: string, f: Partial<Activity> = {}): Activity => ({
  id, scheduleId: 's', activityId: code, name, wbs: '', duration: 5, remainingDuration: 5, percentComplete: 0,
  earlyStart: null, earlyFinish: null, lateStart: null, lateFinish: null, actualStart: null, actualFinish: null, baselineStart: null, baselineFinish: null,
  totalFloat: 0, freeFloat: 0, isCritical: false, status: 'not_started', activityType: 'task', calendarId: null, constraintType: null, constraintDate: null, sourceId: null, ...f,
} as Activity)
const R = (p: string, s: string, type: Relationship['type'] = 'FS', lag = 0, id = `${p}>${s}:${type}`): Relationship => ({ id, scheduleId: 's', predecessorId: p, successorId: s, type, lag })
const E = (id: string, change: ScheduleEditChange): ScheduleEdit => ({ id, change, reason: 'review', by: 'u', at: id })
const cal = defaultCalendar()
const net = (activities: Activity[], relationships: Relationship[], dataDate = '2026-03-02'): NetworkInput =>
  ({ activities, relationships, calendars: [cal], defaultCalendarId: cal.id, projectStart: '2026-03-02', dataDate, mustFinishBy: null, progressMode: 'retained' })

describe('M2: reverting an edit never leaves a logic loop', () => {
  const acts = [A('a', 'A', 'Alpha'), A('b', 'B', 'Bravo'), A('c', 'C', 'Charlie')]
  const rels = [R('a', 'b'), R('b', 'c')]
  const e1 = E('e1', { kind: 'link_remove', predecessorId: 'a', successorId: 'b' })
  const s1 = applyScheduleEdits(acts, rels, [e1])
  const v = validateEditChange({ kind: 'link_set', predecessorId: 'B', successorId: 'A', type: 'FS', lag: 0 }, s1.activities, s1.relationships)
  if (!('change' in v)) throw new Error('B → A is valid once A → B is removed')
  const e2 = E('e2', v.change)

  it('both edits together are fine', () => {
    expect(applyScheduleEdits(acts, rels, [e1, e2]).applied.map(x => x.status)).toEqual(['applied', 'applied'])
    expect(revertLoopError(acts, rels, [e1, e2], [])).toBeNull()
  })
  it('the revert of the first edit alone is refused with a plain message', () => {
    const msg = revertLoopError(acts, rels, [e1, e2], ['e1'])
    expect(msg).toMatch(/cannot be reverted on its own/)
    expect(msg).toContain('B Bravo → A Alpha')
    expect(msg).toMatch(/logic loop/)
  })
  it('reverting the later edit, or both, is allowed', () => {
    expect(revertLoopError(acts, rels, [e1, e2], ['e2'])).toBeNull()
    expect(revertLoopError(acts, rels, [e1, e2], ['e1', 'e2'])).toBeNull()
  })
  it('if it happens anyway, the new relationship is left out instead of closing a loop', () => {
    const s2 = applyScheduleEdits(acts, rels, [e2])
    expect(s2.applied[0]).toMatchObject({ status: 'skipped', note: expect.stringMatching(/logic loop/) })
    expect(s2.relationships).toHaveLength(2)
    const done = completeSchedule({ activities: s2.activities, relationships: s2.relationships, calendars: [cal], defaultCalendarId: cal.id, projectStart: '2026-03-02', projectFinish: null, dataDate: '2026-03-02' })
    expect(done.cpm?.cycles).toEqual([])
    expect(done.projectFinish).toBe('2026-03-20')
  })
})

describe('M3: the logic helper does not tie open work to a completed successor', () => {
  it('proposes no link into completed work', () => {
    const acts = [
      A('m', 'M0', 'Notice to Proceed', { activityType: 'milestone', duration: 0 }),
      A('r', 'A10', 'MEP rough-in Level 2'),
      A('d', 'A20', 'Drywall Level 2', { status: 'complete', actualStart: '2026-01-05', actualFinish: '2026-01-20' }),
      A('p', 'A30', 'Paint Level 2', { status: 'complete', actualStart: '2026-01-21', actualFinish: '2026-01-30' }),
      A('f', 'M9', 'Final Completion', { activityType: 'milestone', duration: 0 }),
    ]
    const res = suggestLogic(acts, [R('m', 'r'), R('d', 'p'), R('p', 'f')])
    const complete = new Set(['d', 'p'])
    expect(res.suggestions.filter(s => s.action === 'add_link' && complete.has(s.successor.id))).toEqual([])
    // The loose end is still dealt with: tied to the open finish milestone.
    expect(res.suggestions.find(s => s.predecessor.id === 'r')?.successor.id).toBe('f')
  })
})

describe('M4: leveling reports the scheduled finish, like the dashboard and the what-ifs', () => {
  it('uploaded schedule: a Mandatory Finish that holds work later than logic', () => {
    const n = net([A('a', 'A', 'A'), A('b', 'B', 'B', { constraintType: 'MFO', constraintDate: '2026-03-20' }), A('c', 'C', 'C')], [R('a', 'b'), R('b', 'c')])
    const run = uploadedLevelingNetwork(n, null, []).run(new Map())!
    expect(run.times.c.earlyFinish).toBe('2026-03-27')
    expect(evaluateNetwork(n).finish).toBe('2026-03-27')
    expect(run.finish).toBe('2026-03-27')
  })
  it('RunF9 plan: the same network', () => {
    const rationale = { summary: 'x', sources: [], confidence: 'high' as const }
    const act = (id: string, extra: Partial<PlanActivity> = {}): PlanActivity => ({ id, code: id.toUpperCase(), name: id, duration: 5, type: 'task', category: 'other', phase: 'structure', rationale, ...extra })
    const link = (from: string, to: string): PlanLink => ({ id: `${from}>${to}`, from, to, type: 'FS', lag: 0, rationale })
    const g: GeneratedSchedule = {
      generatedAt: '2026-01-01T00:00:00Z', projectStart: '2026-03-02', defaultCalendarId: cal.id, assumptions: [], calendars: [cal],
      activities: [act('a'), act('b', { constraint: { type: 'MFO', date: '2026-03-20' } }), act('c')], links: [link('a', 'b'), link('b', 'c')],
    }
    const run = planLevelingNetwork(g).run(new Map())!
    expect(run.times.c.earlyFinish).toBe('2026-03-27')
    expect(run.finish).toBe('2026-03-27')
  })
})

describe('M5: Monte Carlo adds no day to work in progress with nothing remaining', () => {
  it('every percentile equals the deterministic finish when the only open work is fixed', () => {
    const acts = [A('a', 'A', 'Excavate', { duration: 20, remainingDuration: 0, status: 'in_progress', actualStart: '2026-03-02' }), A('b', 'B', 'Footings')]
    const rels = [R('a', 'b')]
    const done = completeSchedule({ activities: acts, relationships: rels, calendars: [cal], defaultCalendarId: cal.id, projectStart: '2026-03-02', projectFinish: null, dataDate: '2026-03-30' })
    expect(done.projectFinish).toBe('2026-04-03')
    const g = uploadedToGenerated({ fileName: 'f.xer', uploadedAt: '2026-03-30T00:00:00Z', calendars: [cal], defaultCalendarId: cal.id, projectStart: '2026-03-02', dataDate: '2026-03-30' } as never, done.activities, rels, done.cpm, null)
    const r = runSra(g, {}, null, { iterations: 200, seed: 7, inputs: { nameRules: true, ranges: [{ activityId: 'b', optimistic: 5, mostLikely: 5, pessimistic: 5 }] } })
    expect(r.percentiles.p10).toBe('2026-04-03')
    expect(r.percentiles.p50).toBe('2026-04-03')
    expect(r.percentiles.p80).toBe('2026-04-03')
  })
})

describe('M6: SF across a weekend, the logic date matches the scheduled date', () => {
  it('with no constraint anywhere the two sets of dates are the same', () => {
    const r = runCpm({
      projectStart: '2026-03-02', calendars: [cal], defaultCalendarId: cal.id,
      activities: [{ id: 'p0', code: 'P0', name: 'p0', duration: 5, type: 'task' }, { id: 'p', code: 'P', name: 'p', duration: 5, type: 'task' }, { id: 's', code: 'S', name: 's', duration: 3, type: 'task' }],
      links: [{ from: 'p0', to: 'p', type: 'FS', lag: 0 }, { from: 'p', to: 's', type: 'SF', lag: 0 }],
    })
    // P starts Monday 03/09, so S finishes the Friday before.
    expect(r.times.s).toMatchObject({ earlyStart: '2026-03-04', earlyFinish: '2026-03-06' })
    // logicTimes lists only activities whose logic dates differ from the scheduled ones: none here.
    expect(r.logicTimes).toEqual({})
    expect(r.logicFinish).toBe(r.projectFinish)
  })
})

describe('M7: link edits act on the relationship of the stated type', () => {
  const acts = [A('a', 'A', 'Erect steel', { duration: 20, remainingDuration: 20 }), A('b', 'B', 'Pour slab', { duration: 10, remainingDuration: 10 }), A('m', 'M', 'Substantial Completion', { activityType: 'milestone', duration: 0 })]
  const both = [R('a', 'b', 'FF'), R('a', 'b', 'FS'), R('b', 'm')]
  const pair = (rels: Relationship[]) => rels.filter(r => r.predecessorId === 'a' && r.successorId === 'b').map(r => `${r.type}${r.lag ? `+${r.lag}` : ''}`)

  it('the recovery overlap converts the FS, not the FF listed first, and saves the same days', () => {
    const only = uploadedRecoveryOptions(net(acts, [R('a', 'b'), R('b', 'm')]))!.options.find(o => o.id === 'overlap-a-b')!
    const two = uploadedRecoveryOptions(net(acts, both))!.options.find(o => o.id === 'overlap-a-b')
    expect(only.daysSaved).toBeGreaterThan(0)
    expect(two?.daysSaved).toBe(only.daysSaved)
    expect(pair(applyScheduleEdits(acts, both, [E('1', two!.changes[0])]).relationships)).toEqual(['FF', 'SS+10'])
  })
  it('a lag change goes to the relationship that has that type', () => {
    const v = validateEditChange({ kind: 'link_set', predecessorId: 'A', successorId: 'B', type: 'FS', lag: 2 }, acts, both)
    if (!('change' in v)) throw new Error(v.error)
    const out = applyScheduleEdits(acts, both, [E('1', v.change)])
    expect(out.applied[0]).toMatchObject({ before: 'FS', after: 'FS +2d' })
    expect(pair(out.relationships)).toEqual(['FF', 'FS+2'])
  })
  it('a type change can name the relationship it changes', () => {
    const v = validateEditChange({ kind: 'link_set', predecessorId: 'A', successorId: 'B', type: 'SS', lag: 0, fromType: 'fs' }, acts, both)
    expect(v).toEqual({ change: { kind: 'link_set', predecessorId: 'a', successorId: 'b', type: 'SS', lag: 0, fromType: 'FS' } })
    expect(validateEditChange({ kind: 'link_set', predecessorId: 'A', successorId: 'B', type: 'SS', lag: 0, fromType: 'SF' }, acts, both)).toEqual({ error: 'There is no SF relationship A → B.' })
  })
  it('a removal that names a type removes that relationship only', () => {
    const v = validateEditChange({ kind: 'link_remove', predecessorId: 'A', successorId: 'B', type: 'FS' }, acts, both)
    if (!('change' in v)) throw new Error(v.error)
    expect(pair(applyScheduleEdits(acts, both, [E('1', v.change)]).relationships)).toEqual(['FF'])
    expect(validateEditChange({ kind: 'link_remove', predecessorId: 'A', successorId: 'B', type: 'SS' }, acts, both)).toEqual({ error: 'There is no SS relationship A → B.' })
    // A stored removal of a type that is no longer there is skipped, not applied to another relationship.
    const stale = applyScheduleEdits(acts, both, [E('1', { kind: 'link_remove', predecessorId: 'a', successorId: 'b', type: 'SS' })])
    expect(stale.applied[0].status).toBe('skipped')
    expect(pair(stale.relationships)).toEqual(['FF', 'FS'])
  })
  it('edits without a type behave as before', () => {
    expect(pair(applyScheduleEdits(acts, both, [E('1', { kind: 'link_remove', predecessorId: 'a', successorId: 'b' })]).relationships)).toEqual(['FS'])
    expect(pair(applyScheduleEdits(acts, [R('a', 'b'), R('b', 'm')], [E('1', { kind: 'link_set', predecessorId: 'a', successorId: 'b', type: 'SS', lag: 3 })]).relationships)).toEqual(['SS+3'])
  })
  it('plain English: "remove the FS link between A and B" names the type', () => {
    const refs = [{ id: 'a', code: 'A100', name: 'Erect steel' }, { id: 'b', code: 'A200', name: 'Pour slab' }]
    const r = readClause('remove the FS link between A100 and A200', refs)
    expect(r).toEqual({ step: { op: 'unlink', from: 'a', to: 'b', type: 'FS' } })
    expect(readClause('remove the finish-to-finish relationship between A100 and A200', refs)).toEqual({ step: { op: 'unlink', from: 'a', to: 'b', type: 'FF' } })
    expect(readClause('remove the link between A100 and A200', refs)).toEqual({ step: { op: 'unlink', from: 'a', to: 'b' } })
    expect(toUploadedChange({ op: 'unlink', from: 'a', to: 'b', type: 'FS' }, refs)).toEqual({ kind: 'link_remove', predecessorId: 'a', successorId: 'b', type: 'FS' })
    expect(toUploadedChange({ op: 'unlink', from: 'a', to: 'b' }, refs)).toEqual({ kind: 'link_remove', predecessorId: 'a', successorId: 'b' })
  })
  it('plain English on a plan: the tie of the stated type is the one edited', () => {
    const rationale = { summary: 'x', sources: [], confidence: 'high' as const }
    const g = { links: [{ id: 'l1', from: 'a', to: 'b', type: 'SS', lag: 0, rationale }, { id: 'l2', from: 'a', to: 'b', type: 'FF', lag: 0, rationale }], activities: [] } as unknown as GeneratedSchedule
    expect(toPlanEdit({ op: 'unlink', from: 'a', to: 'b', type: 'FF' }, g, 'why')).toMatchObject({ kind: 'remove_link', linkId: 'l2' })
    expect(toPlanEdit({ op: 'unlink', from: 'a', to: 'b', type: 'FS' }, g, 'why')).toBe('Those activities have no FS tie.')
    expect(toPlanEdit({ op: 'unlink', from: 'a', to: 'b' }, g, 'why')).toMatchObject({ kind: 'remove_link', linkId: 'l1' })
    expect(toPlanEdit({ op: 'link', from: 'a', to: 'b', type: 'FF', lag: 2 }, g, 'why')).toMatchObject({ kind: 'link', linkId: 'l2', lag: 2 })
  })
})

describe('M8: adding an activity after post-completion work', () => {
  const rationale = { summary: 'x', sources: [], confidence: 'high' as const }
  const act = (id: string, code: string, duration: number, extra: Partial<PlanActivity> = {}): PlanActivity =>
    ({ id, code, name: code, duration, type: duration ? 'task' : 'milestone', category: 'other', phase: 'structure', rationale, ...extra })
  const link = (from: string, to: string): PlanLink => ({ id: `${from}>${to}`, from, to, type: 'FS', lag: 0, rationale })
  const s: GeneratedSchedule = {
    generatedAt: '2026-01-01T00:00:00Z', projectStart: '2026-03-02', defaultCalendarId: 'std', assumptions: [],
    calendars: [{ id: 'std', name: 'Std', workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidays: [] }],
    activities: [
      act('a', 'A1000', 0, { category: 'ntp' }), act('b', 'A1010', 5), act('sc', 'A1020', 0, { category: 'substantial_completion' }),
      act('p', 'A1030', 10, { name: 'Punch list', phase: 'closeout' }), act('fc', 'A1040', 0, { category: 'final_completion' }),
    ],
    links: [link('a', 'b'), link('b', 'sc'), link('sc', 'p'), link('p', 'fc')],
  }
  const succ = (g: GeneratedSchedule, id: string) => g.links.filter(l => l.from === id).map(l => l.to)

  it('after the punch list: tied to Final Completion instead of failing with a logic loop', () => {
    const { schedule } = applyEdit(s, { kind: 'add_activity', name: 'Owner training', duration: 3, after: 'p', reason: 'Owner request' }, 'Ana')
    const added = schedule.activities.find(a => a.name === 'Owner training')!
    expect(succ(schedule, added.id)).toEqual(['fc'])
    expect(schedule.cpm!.cycles).toEqual([])
  })
  it('before Substantial Completion: still tied to Substantial Completion', () => {
    const { schedule } = applyEdit(s, { kind: 'add_activity', name: 'Owner equipment', duration: 3, after: 'b', reason: 'Owner scope' }, 'Ana')
    expect(succ(schedule, schedule.activities.find(a => a.name === 'Owner equipment')!.id)).toEqual(['sc'])
  })
})
