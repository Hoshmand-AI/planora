import { describe, expect, it } from 'vitest'
import type { GeneratedSchedule, PlanActivity, PlanLink, WorkCalendar } from './types'
import type { ResourceData } from './resource-types'
import { runCpm } from './cpm'
import { analyzeResources, NO_RESOURCE_MESSAGE } from '@/lib/analysis/resources'
import { levelResources, loadActivitiesOf, planLevelingNetwork, uploadedLevelingNetwork } from './leveling'
import type { Activity, Relationship } from '@/lib/db'

// 2026-03-02 is a Monday.
const CAL5: WorkCalendar = { id: 'c5', name: '5-day', workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidays: ['2026-03-04'] }
const CAL7: WorkCalendar = { id: 'c7', name: '7-day', workDays: [0, 1, 2, 3, 4, 5, 6], hoursPerDay: 8, holidays: [] }

const act = (id: string, duration: number, extra: Partial<PlanActivity> = {}): PlanActivity => ({
  id, code: id.toUpperCase(), name: `Activity ${id}`, duration, type: duration === 0 ? 'milestone' : 'task', calendarId: 'c5',
  category: 'other', phase: 'structure', rationale: { summary: '', sources: [], confidence: 'high' }, ...extra,
})
const link = (from: string, to: string): PlanLink => ({ id: `${from}-${to}`, from, to, type: 'FS', lag: 0, rationale: { summary: '', sources: [], confidence: 'high' } })

function plan(activities: PlanActivity[], links: PlanLink[], resources: ResourceData | null, extra: Partial<GeneratedSchedule> = {}): GeneratedSchedule {
  const g: GeneratedSchedule = {
    generatedAt: '2026-03-01T00:00:00Z', projectStart: '2026-03-02', calendars: [CAL5, CAL7], defaultCalendarId: 'c5',
    activities, links, assumptions: [], resources, ...extra,
  }
  g.cpm = runCpm({ projectStart: g.projectStart, dataDate: g.dataDate, calendars: g.calendars, defaultCalendarId: g.defaultCalendarId, activities, links })
  return g
}

const R = (max: number | null = 1): ResourceData['resources'][number] => ({ id: 'r1', code: 'CARP', name: 'Carpenters', kind: 'labor', unit: 'h', maxUnitsPerHour: max })
const asg = (activityId: string, units: number): ResourceData['assignments'][number] => ({ activityId, resourceId: 'r1', budgetUnits: units, actualUnits: 0, remainingUnits: units })
const data = (assignments: ResourceData['assignments'], max: number | null = 1): ResourceData => ({ source: 'plan', resources: [R(max)], assignments, notes: [] })

function analysisOf(g: GeneratedSchedule, opts: { availability?: Record<string, number> } = {}) {
  const net = planLevelingNetwork(g)
  const run = net.run(new Map())!
  return analyzeResources({ activities: loadActivitiesOf(net, run), calendars: g.calendars, defaultCalendarId: g.defaultCalendarId, dataDate: g.dataDate, data: g.resources, availability: opts.availability }, { bucket: 'day' })
}

describe('resource loading', () => {
  it('spreads units over the work days of each activity\'s calendar (holidays and weekends excluded)', () => {
    // a: 5 work days on the 5-day calendar from Mon 03/02 with a holiday on Wed 03/04 → Mon, Tue, Thu, Fri, Mon.
    // b: 7 days on the 7-day calendar → every day 03/02–03/08.
    const g = plan([act('a', 5), act('b', 7, { calendarId: 'c7' })], [], {
      source: 'plan', notes: [],
      resources: [R(10), { id: 'r2', code: 'CRANE', name: 'Crane', kind: 'nonlabor', unit: 'h', maxUnitsPerHour: 1 }],
      assignments: [asg('a', 40), { activityId: 'b', resourceId: 'r2', budgetUnits: 56, actualUnits: 0, remainingUnits: 56 }],
    })
    const r = analysisOf(g)
    expect(r.state).toBe('ok')
    const carp = r.resources.find(x => x.code === 'CARP')!
    expect(carp.histogram!.filter(b => b.demand > 0).map(b => [b.start, b.demand])).toEqual([
      ['2026-03-02', 8], ['2026-03-03', 8], ['2026-03-05', 8], ['2026-03-06', 8], ['2026-03-09', 8],
    ])
    expect(carp.totalUnits).toBe(40)
    expect(carp.availablePerDay).toBe(80) // 10 units/h × 8 h
    const crane = r.resources.find(x => x.code === 'CRANE')!
    expect(crane.histogram!.filter(b => b.demand > 0)).toHaveLength(7)
    expect(crane.peakPerDay).toBe(8)
    // No calendar of its own: weekend days with demand count as available, so no false over-allocation.
    expect(crane.overAllocatedDays).toBe(0)
  })

  it('puts actual units before the data date and remaining units after it', () => {
    const g = plan([act('a', 5, { actualStart: '2026-03-02', status: 'in_progress', remaining: 3 })], [], {
      source: 'plan', notes: [], resources: [R(1)],
      assignments: [{ activityId: 'a', resourceId: 'r1', budgetUnits: 40, actualUnits: 16, remainingUnits: 24 }],
    }, { dataDate: '2026-03-05' })
    const r = analysisOf(g)
    const h = r.resources[0].histogram!.filter(b => b.demand > 0)
    expect(h.filter(b => b.actual > 0).map(b => [b.start, b.actual])).toEqual([['2026-03-02', 8], ['2026-03-03', 8]])
    expect(h.filter(b => b.remaining > 0).map(b => [b.start, b.remaining])).toEqual([['2026-03-05', 8], ['2026-03-06', 8], ['2026-03-09', 8]])
    expect(r.resources[0].actualUnits).toBe(16)
    expect(r.resources[0].remainingUnits).toBe(24)
  })

  it('weekly and monthly histograms sum the days', () => {
    const g = plan([act('a', 5), act('b', 5)], [], data([asg('a', 40), asg('b', 40)]))
    const net = planLevelingNetwork(g)
    const acts = loadActivitiesOf(net, net.run(new Map())!)
    const week = analyzeResources({ activities: acts, calendars: g.calendars, defaultCalendarId: 'c5', data: g.resources }, { bucket: 'week' })
    expect(week.resources[0].histogram!.map(b => [b.start, b.demand])).toEqual([['2026-03-02', 64], ['2026-03-09', 16]])
    const month = analyzeResources({ activities: acts, calendars: g.calendars, defaultCalendarId: 'c5', data: g.resources }, { bucket: 'month' })
    expect(month.resources[0].histogram!.map(b => [b.start, b.end, b.demand])).toEqual([['2026-03-01', '2026-03-31', 80]])
  })
})

describe('over-allocation', () => {
  it('finds the days demand exceeds availability, with the activities contributing', () => {
    // a and b run in parallel, each 8 h/day; the resource supplies 1 unit/h × 8 h = 8 h/day.
    const g = plan([act('a', 5), act('b', 3)], [], data([asg('a', 40), asg('b', 24)]))
    const r = analysisOf(g)
    expect(r.resources[0].overAllocatedDays).toBe(3)
    expect(r.resources[0].peakPerDay).toBe(16)
    expect(r.overAllocations).toHaveLength(1)
    const p = r.overAllocations[0]
    // Mon, Tue, (holiday Wed), Thu: one period across the holiday.
    expect([p.from, p.to, p.days, p.peakDemand, p.available, p.maxExcess]).toEqual(['2026-03-02', '2026-03-05', 3, 16, 8, 8])
    expect(p.activities.map(a => a.code)).toEqual(['A', 'B'])
    expect(r.totals.overAllocatedResources).toBe(1)
  })

  it('assumes one crew when the file gives no maximum, and says so', () => {
    const g = plan([act('a', 5), act('b', 3)], [], data([asg('a', 40), asg('b', 24)], null))
    const r = analysisOf(g)
    expect(r.resources[0].availabilitySource).toBe('assumed_one_crew')
    expect(r.resources[0].availablePerDay).toBe(8)
    expect(r.assumptions.join(' ')).toMatch(/assumed one crew/)
    expect(r.resources[0].overAllocatedDays).toBe(3)
  })

  it('reports a clear no-resource state and never invents resources', () => {
    const g = plan([act('a', 5)], [], null)
    const r = analysisOf(g)
    expect(r.state).toBe('no_resource_data')
    expect(r.message).toBe(NO_RESOURCE_MESSAGE)
    expect(r.resources).toEqual([])
    const lv = levelResources(planLevelingNetwork(g))
    expect(lv.ok).toBe(true)
    expect(lv.delays).toEqual([])
    expect(lv.after.finish).toBe(lv.before.finish)
  })
})

describe('leveling', () => {
  // c (10d, no resources) drives the finish; a (5d) and b (3d) both use the carpenters at 8 h/day
  // and have 5 and 7 days of float.
  const withinFloat = () => plan([act('a', 5), act('b', 3), act('c', 10), act('end', 0)], [link('a', 'end'), link('b', 'end'), link('c', 'end')], data([asg('a', 40), asg('b', 24)]))

  it('levels within float without moving the finish', () => {
    const g = withinFloat()
    const r = levelResources(planLevelingNetwork(g))
    expect(r.ok).toBe(true)
    expect(r.label).toBe('Leveled scenario')
    expect(r.after.finish).toBe(r.before.finish)
    expect(r.finishChangeDays).toBe(0)
    expect(r.delays.map(d => [d.code, d.fromStart, d.toStart, d.workDays, d.withinFloat])).toEqual([['B', '2026-03-02', '2026-03-10', 5, true]])
    expect(r.after.overAllocatedDays).toBe(0)
    expect(r.remaining).toEqual([])
    expect(r.changes).toEqual([{ kind: 'constraint', activityId: 'b', constraint: { type: 'SNET', date: '2026-03-10' } }])
  })

  it('smoothing keeps the finish and leaves over-allocations it cannot fix within float', () => {
    // a and b both drive the finish (no float): nothing can wait without moving the finish.
    const g = plan([act('a', 5), act('b', 5), act('end', 0)], [link('a', 'end'), link('b', 'end')], data([asg('a', 40), asg('b', 40)]))
    const r = levelResources(planLevelingNetwork(g), { mode: 'smooth' })
    expect(r.delays).toEqual([])
    expect(r.after.finish).toBe(r.before.finish)
    expect(r.remaining.length).toBeGreaterThan(0)
    expect(r.unresolved[0].reason).toMatch(/within its float/)
    // Leveling without permission to extend behaves the same, and says how to resolve it.
    const lv = levelResources(planLevelingNetwork(g), { mode: 'level' })
    expect(lv.delays).toEqual([])
    expect(lv.unresolved[0].reason).toMatch(/allow the finish to extend/)
  })

  it('extends the finish when allowed and nothing fits within float', () => {
    const g = plan([act('a', 5), act('b', 5), act('end', 0, { milestoneKind: 'finish' })], [link('a', 'end'), link('b', 'end')], data([asg('a', 40), asg('b', 40)]), {
      milestoneTargets: [{ key: 'sc', label: 'Substantial completion', target: '2026-03-20', activityId: 'end' }],
    })
    const r = levelResources(planLevelingNetwork(g), { mode: 'level', allowFinishExtension: true })
    expect(r.after.overAllocatedDays).toBe(0)
    expect(r.delays).toHaveLength(1)
    // Equal float and late start: the higher code (B) waits for A.
    expect(r.delays[0].code).toBe('B')
    expect(r.delays[0].withinFloat).toBe(false)
    expect(r.before.finish).toBe('2026-03-09')
    expect(r.after.finish).toBe('2026-03-16')
    expect(r.finishChangeDays).toBe(7)
    expect(r.before.milestones[0]).toMatchObject({ code: 'END', date: '2026-03-09' })
    expect(r.after.milestones[0]).toMatchObject({ code: 'END', date: '2026-03-16', required: '2026-03-20' })
  })

  it('is deterministic: the input order does not change the result', () => {
    const acts = [act('a', 5), act('b', 5), act('c', 4), act('d', 2), act('end', 0)]
    const links = [link('a', 'end'), link('b', 'end'), link('c', 'end'), link('d', 'end')]
    const res = data([asg('a', 40), asg('b', 40), asg('c', 32), asg('d', 16)])
    const one = levelResources(planLevelingNetwork(plan(acts, links, res)), { allowFinishExtension: true })
    const two = levelResources(planLevelingNetwork(plan([...acts].reverse(), [...links].reverse(), { ...res, assignments: [...res.assignments].reverse() })), { allowFinishExtension: true })
    expect(two.delays).toEqual(one.delays)
    expect(two.after).toEqual(one.after)
    expect(one.after.overAllocatedDays).toBe(0)
  })

  it('what-if staffing: adding a crew removes the delay', () => {
    const g = plan([act('a', 5), act('b', 5), act('end', 0)], [link('a', 'end'), link('b', 'end')], data([asg('a', 40), asg('b', 40)]))
    const before = levelResources(planLevelingNetwork(g), { allowFinishExtension: true })
    expect(before.finishChangeDays).toBe(7)
    const twoCrews = levelResources(planLevelingNetwork(g), { allowFinishExtension: true, availability: { r1: 16 } })
    expect(twoCrews.delays).toEqual([])
    expect(twoCrews.finishChangeDays).toBe(0)
    expect(twoCrews.availability).toEqual({ r1: 16 })
    expect(analysisOf(g, { availability: { r1: 16 } }).resources[0]).toMatchObject({ availablePerDay: 16, availabilitySource: 'what_if', fileAvailablePerDay: 8, overAllocatedDays: 0 })
  })

  it('never moves work in progress, complete work or activities held by a constraint', () => {
    const g = plan([
      act('a', 5, { actualStart: '2026-03-02', status: 'in_progress', remaining: 5 }),
      act('b', 5, { constraint: { type: 'FNLT', date: '2026-03-20' } }),
      act('end', 0),
    ], [link('a', 'end'), link('b', 'end')], data([asg('a', 40), asg('b', 40)]), { dataDate: '2026-03-02' })
    const r = levelResources(planLevelingNetwork(g), { allowFinishExtension: true })
    expect(r.delays).toEqual([])
    expect(r.unresolved[0].reason).toMatch(/in progress, complete or held by a constraint/)
  })

  it('a single activity that needs more than is available is reported, not moved', () => {
    const g = plan([act('a', 5), act('end', 0)], [link('a', 'end')], data([asg('a', 80)]))
    const r = levelResources(planLevelingNetwork(g), { allowFinishExtension: true })
    expect(r.delays).toEqual([])
    expect(r.unresolved[0].reason).toMatch(/alone needs more CARP/)
  })
})

describe('uploaded schedules', () => {
  const A = (id: string, duration: number, extra: Partial<Activity> = {}): Activity => ({
    id, scheduleId: 's', activityId: id.toUpperCase(), name: id, wbs: '', duration, remainingDuration: duration, percentComplete: 0,
    earlyStart: null, earlyFinish: null, lateStart: null, lateFinish: null, actualStart: null, actualFinish: null, baselineStart: null, baselineFinish: null,
    totalFloat: 0, freeFloat: 0, isCritical: false, status: 'not_started', activityType: duration ? 'task' : 'milestone', calendarId: 'c5', sourceId: id, ...extra,
  })
  const rel = (p: string, s: string): Relationship => ({ id: `${p}${s}`, scheduleId: 's', predecessorId: p, successorId: s, type: 'FS', lag: 0 })

  it('levels through the uploaded-edits mechanism (SNET edits) and keeps an existing earlier SNET in view', () => {
    const net = uploadedLevelingNetwork({
      activities: [A('a', 5), A('b', 3, { constraintType: 'SNET', constraintDate: '2026-03-03' }), A('c', 10), A('end', 0)],
      relationships: [rel('a', 'end'), rel('b', 'end'), rel('c', 'end')], calendars: [CAL5], defaultCalendarId: 'c5', projectStart: '2026-03-02',
      dataDate: '2026-03-02', mustFinishBy: null, progressMode: 'retained',
    }, data([asg('a', 40), asg('b', 24)]), [{ id: 'end', code: 'END', name: 'end' }])
    const r = levelResources(net)
    expect(r.after.finish).toBe(r.before.finish)
    expect(r.delays.map(d => [d.code, d.fromStart, d.toStart])).toEqual([['B', '2026-03-03', '2026-03-10']])
    expect(r.changes[0]).toEqual({ kind: 'constraint', activityId: 'b', constraint: { type: 'SNET', date: '2026-03-10' } })
    expect(r.after.milestones[0].date).toBe(r.before.milestones[0].date)
  })
})
