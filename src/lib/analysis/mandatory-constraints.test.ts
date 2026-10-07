// Round-3 pilot: mandatory-constraint handling across the analysis, DCMA #12/#13, the brief and reports.
import { describe, it, expect } from 'vitest'
import type { AnalyzableActivity, AnalyzableSchedule, CpmLink, WorkCalendar } from '@/lib/planning/types'
import type { Activity, Relationship, Schedule } from '@/lib/db'
import { runDcma } from '@/lib/analysis/dcma'
import { addWorkDays, defaultCalendar, finishFromStart } from '@/lib/planning/calendar'
import { makeActivity } from '@/lib/parsers/types'
import { completeSchedule } from '@/lib/planning/complete-schedule'
import { analyzeSchedule } from '@/lib/analysis/schedule-analysis'
import { projectBrief } from '@/lib/analysis/brief'
import { buildReport } from '@/lib/export/reports'
import { analyzableFromDb } from '@/lib/planning/service'

const cal = defaultCalendar()
const task = (id: string, duration = 5, extra: Partial<AnalyzableActivity> = {}): AnalyzableActivity => ({ id, code: id, name: `Task ${id}`, type: 'task', duration, resourceCount: 1, ...extra })
const ms = (id: string, extra: Partial<AnalyzableActivity> = {}): AnalyzableActivity => ({ id, code: id, name: `Milestone ${id}`, type: 'milestone', duration: 0, ...extra })
const fs = (from: string, to: string, lag = 0): CpmLink => ({ from, to, type: 'FS', lag })
const check = (r: ReturnType<typeof runDcma>, id: number) => r.checks.find((c) => c.id === id)!

describe('DCMA #12 / #13 with mandatory constraints', () => {
  // A winter shutdown run on a calendar no activity on the tested path uses.
  const shutdown: string[] = []
  for (let d = Date.UTC(2026, 11, 15); d <= Date.UTC(2027, 2, 15); d += 86_400_000) shutdown.push(new Date(d).toISOString().slice(0, 10))
  const seasonal: WorkCalendar = { id: 'seasonal', name: 'Seasonal', workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidays: shutdown }

  it('12 fails on a Mandatory Start-driven path and names the constraint (no calendar excuse)', () => {
    const s: AnalyzableSchedule = {
      projectStart: '2026-03-02', dataDate: '2026-03-02', calendars: [cal, seasonal], defaultCalendarId: cal.id,
      activities: [
        ms('S', { actualStart: '2026-03-02', actualFinish: '2026-03-02' }),
        task('B', 10, { constraint: { type: 'MSO', date: '2026-04-06' } }), task('C', 5),
        task('X', 5, { calendarId: 'seasonal' }),
        ms('F', { name: 'Substantial Completion', baselineFinish: '2026-12-31' }),
      ],
      links: [fs('S', 'B'), fs('B', 'C'), fs('C', 'F'), fs('S', 'X'), fs('X', 'F')],
    }
    const c = check(runDcma(s), 12)
    expect(c.result).toBe('fail')
    expect(c.offenders).toContain('B')
    expect(c.explanation).toMatch(/starts at B, held by a mandatory constraint on B \(Mandatory Start 04\/06\/2026\)/)
    expect(c.explanation).not.toMatch(/seasonal|shutdown/i)
  })

  it('12 notes a driving path that starts at a Start On or After constraint', () => {
    const s: AnalyzableSchedule = {
      projectStart: '2026-03-02', dataDate: '2026-03-02', calendars: [cal], defaultCalendarId: cal.id,
      activities: [task('A', 5, { constraint: { type: 'SNET', date: '2026-03-16' } }), task('B', 5), ms('F', { name: 'Substantial Completion' })],
      links: [fs('A', 'B'), fs('B', 'F')],
    }
    const c = check(runDcma(s), 12)
    expect(c.explanation).toMatch(/longest path starts at A, which carries a Start On or After constraint 03\/16\/2026/)
  })

  it("13 uses the milestone's own total float, not the gap to its FNLT date", () => {
    // SC's own FNLT is far away, but Final Completion's FNLT downstream leaves SC with -3 work days.
    const s: AnalyzableSchedule = {
      projectStart: '2026-03-02', dataDate: '2026-03-02', calendars: [cal], defaultCalendarId: cal.id,
      activities: [
        ms('NTP', { actualStart: '2026-03-02', actualFinish: '2026-03-02' }), task('A', 20),
        ms('SC', { name: 'Substantial Completion', constraint: { type: 'FNLT', date: '2026-12-31' } }), task('PUNCH', 10),
        ms('FC', { name: 'Final Completion', constraint: { type: 'FNLT', date: '2026-04-07' } }),
      ],
      links: [fs('NTP', 'A'), fs('A', 'SC'), fs('SC', 'PUNCH'), fs('PUNCH', 'FC')],
    }
    const c = check(runDcma(s), 13)
    expect(c.result).toBe('fail')
    expect(c.explanation).toMatch(/total float of -3 work days/)
  })

  it('13 fails whenever the completion milestone has negative float, even with a ratio above 0.95', () => {
    const ef = finishFromStart('2026-03-02', 200, cal)
    const s: AnalyzableSchedule = {
      projectStart: '2026-03-02', dataDate: '2026-03-02', calendars: [cal], defaultCalendarId: cal.id,
      activities: [ms('S', { actualStart: '2026-03-02', actualFinish: '2026-03-02' }), task('A', 200), ms('F', { name: 'Substantial Completion', constraint: { type: 'FNLT', date: addWorkDays(ef, -2, cal) } })],
      links: [fs('S', 'A'), fs('A', 'F')],
    }
    const c = check(runDcma(s), 13)
    expect(Number(c.metric)).toBeGreaterThanOrEqual(0.95)
    expect(c.result).toBe('fail')
    expect(c.explanation).toMatch(/negative float/)
  })

  it('13 is measured on the logic-driven date when an interim MFO masks the contract milestone', () => {
    // A (20d, to 03/27) -> Dry-In MFO 03/13 -> B (10d) -> SC (FNLT 03/27 = its scheduled date)
    const s: AnalyzableSchedule = {
      projectStart: '2026-03-02', dataDate: '2026-03-02', calendars: [cal], defaultCalendarId: cal.id,
      activities: [
        ms('NTP', { actualStart: '2026-03-02', actualFinish: '2026-03-02' }), task('A', 20),
        ms('DRY', { name: 'Dry-In', constraint: { type: 'MFO', date: '2026-03-13' } }), task('B', 10),
        ms('SC', { name: 'Substantial Completion', constraint: { type: 'FNLT', date: '2026-03-27' } }),
      ],
      links: [fs('NTP', 'A'), fs('A', 'DRY'), fs('DRY', 'B'), fs('B', 'SC')],
    }
    const c = check(runDcma(s), 13)
    expect(c.result).toBe('fail')
    expect(c.explanation).toMatch(/^SC Substantial Completion is forecast 04\/10\/2026 by logic \(03\/27\/2026 as scheduled/)
    expect(c.explanation).toMatch(/total float of -10 work days/)
  })
})

/* ── analysis ── */
const act = (code: string, fields: Partial<Activity> = {}) => makeActivity('s1', { activityId: code, name: code, calendarId: cal.id, ...fields })
const link = (p: Activity, s: Activity): Relationship => ({ id: `${p.id}-${s.id}`, scheduleId: 's1', predecessorId: p.id, successorId: s.id, type: 'FS', lag: 0 })
function run(activities: Activity[], rels: Relationship[], dataDate = '2026-03-02') {
  const done = completeSchedule({ activities, relationships: rels, calendars: [cal], defaultCalendarId: cal.id, projectStart: '2026-03-02', projectFinish: null, dataDate, mustFinishBy: null })
  const analysis = analyzeSchedule({ activities: done.activities, links: rels.map(r => ({ from: r.predecessorId, to: r.successorId })), cpm: done.cpm, reportedFinish: null, mustFinishBy: null, fileValues: done.fileValues, dataDate })
  return { done, analysis }
}
const started = () => act('NTP', { name: 'Notice to Proceed', activityType: 'milestone', actualStart: '2026-03-02', actualFinish: '2026-03-02', status: 'complete', percentComplete: 100 })

describe('analyzeSchedule: one finish basis, labelled', () => {
  function masked() {
    // NTP -> A (20d, to 03/27) -> Dry-In MFO 03/13 -> B (10d) -> SC (baseline 03/27) -> Punch (5d) -> FC
    const ntp = started()
    const a = act('A', { duration: 20 })
    const dry = act('DRY', { name: 'Dry-In', activityType: 'milestone', milestoneKind: 'finish', constraintType: 'MFO', constraintDate: '2026-03-13' })
    const b = act('B', { duration: 10 })
    const sc = act('SC', { name: 'Substantial Completion', activityType: 'milestone', milestoneKind: 'finish', baselineFinish: '2026-03-27' })
    const p = act('P', { name: 'Punch list', duration: 5 })
    const fc = act('FC', { name: 'Final Completion', activityType: 'milestone', milestoneKind: 'finish' })
    const acts = [ntp, a, dry, b, sc, p, fc]
    return { acts, rels: [link(ntp, a), link(a, dry), link(dry, b), link(b, sc), link(sc, p), link(p, fc)] }
  }
  it('an interim MFO does not mask a contract-milestone slip: variance on the logic-driven date', () => {
    const { acts, rels } = masked()
    const { done, analysis } = run(acts, rels)
    const sc = done.activities.find(x => x.activityId === 'SC')!
    expect(sc.earlyFinish).toBe('2026-03-27') // as scheduled, held by the Dry-In MFO
    expect(analysis.finishMilestone).toMatchObject({ code: 'SC', scheduledFinish: '2026-03-27', logicFinish: '2026-04-10', forecastFinish: '2026-04-10', basis: 'logic', varianceDays: 14 })
    expect(analysis.finishMilestone?.heldBy).toMatchObject({ code: 'DRY', type: 'MFO', constraintDate: '2026-03-13' })
    expect(analysis.varianceDays).toBe(14)
    expect(analysis.varianceBasis).toMatch(/logic-driven date 04\/10\/2026.*as scheduled it shows 03\/27\/2026 only because the Mandatory Finish 03\/13\/2026 on DRY Dry-In overrules logic by 10 work days/)
    expect(analysis.statusReasons.join(' ')).toMatch(/SC Substantial Completion: logic-driven \(mandatory constraints relaxed\) 04\/10\/2026; forecast \(as scheduled, constraints honoured\) 03\/27\/2026, held by the Mandatory Finish 03\/13\/2026 on DRY/)
    // both finishes reported, labelled by basis
    expect(analysis).toMatchObject({ scheduledFinish: '2026-04-03', logicFinish: '2026-04-17', forecastFinish: '2026-04-17', forecastBasis: 'logic' })
  })
  it("successors of the MFO carry their logic dates too (consistent with the MFO's own logic date)", () => {
    const { acts, rels } = masked()
    const { done, analysis } = run(acts, rels)
    const id = (c: string) => done.activities.find(x => x.activityId === c)!.id
    expect(analysis.logicDates?.[id('DRY')]).toEqual({ start: '2026-03-27', finish: '2026-03-27' })
    expect(analysis.logicDates?.[id('B')]).toEqual({ start: '2026-03-30', finish: '2026-04-10' })
    expect(analysis.logicDates?.[id('FC')]).toEqual({ start: '2026-04-17', finish: '2026-04-17' })
    expect(analysis.logicDates?.[id('A')]).toBeUndefined()
  })
  it('the driving path is the logic path through the overruled MFO, flagged', () => {
    const { acts, rels } = masked()
    const { done, analysis } = run(acts, rels)
    const code = (id: string) => done.activities.find(x => x.id === id)!.activityId
    expect(analysis.drivingPath?.basis).toBe('logic')
    expect(analysis.drivingPath?.ids.map(code)).toEqual(['A', 'DRY', 'B', 'SC', 'P', 'FC'])
    expect(analysis.drivingPath?.constraints).toEqual([expect.objectContaining({ code: 'DRY', type: 'MFO', effect: 'earlier' })])
  })
  it('a Finish On holding the finish milestone later than logic: traced back through it, flagged', () => {
    const a = act('A', { duration: 5 }), b = act('B', { duration: 5 })
    const f = act('F', { name: 'Substantial Completion', activityType: 'milestone', constraintType: 'FO', constraintDate: '2026-04-30' })
    const { done, analysis } = run([a, b, f], [link(a, b), link(b, f)])
    const code = (id: string) => done.activities.find(x => x.id === id)!.activityId
    expect(analysis.longestPath.map(code)).toEqual(['F'])
    expect(analysis.drivingPath?.ids.map(code)).toEqual(['A', 'B', 'F'])
    expect(analysis.drivingPath?.constraints).toEqual([expect.objectContaining({ code: 'F', type: 'FO', effect: 'later' })])
    expect(analysis.statusReasons.join(' ')).toMatch(/traced through F, whose Finish On constraint 04\/30\/2026 holds it later than logic/)
  })
  it('flags a driving path that starts at a Start On or After constraint', () => {
    const a = act('A', { duration: 5, constraintType: 'SNET', constraintDate: '2026-03-16' }), b = act('B', { duration: 5 })
    const f = act('F', { name: 'Substantial Completion', activityType: 'milestone' })
    const { analysis } = run([a, b, f], [link(a, b), link(b, f)])
    expect(analysis.status).not.toBe('on_track')
    expect(analysis.statusReasons.join(' ')).toMatch(/The driving path starts at A, which carries a Start On or After constraint 03\/16\/2026/)
  })
  it('flags an open-ended activity that drives the project finish', () => {
    const ntp = started(), a = act('A', { duration: 5 }), x = act('X', { duration: 40 })
    const f = act('F', { name: 'Substantial Completion', activityType: 'milestone' })
    const { analysis } = run([ntp, a, x, f], [link(ntp, a), link(a, f), link(ntp, x)])
    expect(analysis.drivingPath?.openEnd).toMatchObject({ code: 'X' })
    expect(analysis.statusReasons.join(' ')).toMatch(/X has no successor but drives the project finish/)
  })
})

describe('brief and reports use the logic-driven milestone dates, labelled', () => {
  const ntp = started()
  const a = act('A', { duration: 20 })
  const dry = act('DRY', { name: 'Dry-In', activityType: 'milestone', milestoneKind: 'finish', constraintType: 'MFO', constraintDate: '2026-03-13' })
  const b = act('B', { duration: 10 })
  const sc = act('SC', { name: 'Substantial Completion', activityType: 'milestone', milestoneKind: 'finish', baselineFinish: '2026-03-27' })
  const rels = [link(ntp, a), link(a, dry), link(dry, b), link(b, sc)]
  const { done, analysis } = run([ntp, a, dry, b, sc], rels)
  const schedule = { id: 's1', name: 'Clinic', version: 'Update 1', dataDate: '2026-03-02', projectStart: '2026-03-02', projectFinish: analysis.forecastFinish, calendars: [cal], defaultCalendarId: cal.id, warnings: [], analysis } as unknown as Schedule
  it('brief: next milestones and the goal at their logic dates, both finishes as facts', () => {
    const br = projectBrief(schedule, done.activities)
    expect(br.nextMilestones.map(m => [m.name, m.date, m.basis ?? 'scheduled'])).toEqual([['Dry-In', '03/27/2026', 'logic'], ['Substantial Completion', '04/10/2026', 'logic']])
    expect(br.nextMilestones[1].scheduled).toBe('03/27/2026')
    expect(br.summary).toMatch(/Substantial Completion by 04\/10\/2026 \(logic-driven; 03\/27\/2026 as scheduled/)
    expect(br.facts).toEqual(expect.arrayContaining([
      { label: 'Forecast (as scheduled, constraints honoured)', value: '03/27/2026' },
      { label: 'Logic-driven (mandatory constraints relaxed)', value: '04/10/2026' },
    ]))
  })
  it('reports: milestone table and critical path at logic dates; both finishes; the MFO flagged on the path', () => {
    const input = { schedule, activities: done.activities, relationships: rels, analysis, dcma: runDcma(analyzableFromDb(schedule, done.activities, rels)) }
    const variance = buildReport('variance', input)
    const scRow = variance.split('\n').find(l => l.startsWith('| SC |'))!
    expect(scRow).toContain('04/10/2026')
    expect(scRow).toMatch(/Forecast by logic \(03\/27\/2026 as scheduled/)
    expect(scRow).toMatch(/\| \+14 \|/)
    const cp = buildReport('critical_path', input)
    expect(cp).toMatch(/Logic-driven path \(mandatory constraints relaxed\) to the finish/)
    expect(cp).toMatch(/Forecast \(as scheduled, constraints honoured\): 03\/27\/2026; logic-driven \(mandatory constraints relaxed\): 04\/10\/2026/)
    expect(cp).toMatch(/\| DRY \| Dry-In \|.*\*\*MFO 03\/13\/2026: MFO 03\/13\/2026 holds it earlier than logic\*\*/)
    expect(cp).toMatch(/\| SC \| Substantial Completion \|.*04\/10\/2026 \(logic; 03\/27\/2026 as scheduled\)/)
  })
})
