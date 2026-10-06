import { describe, it, expect } from 'vitest'
import type { Activity, Relationship } from '@/lib/db'
import { makeActivity } from '@/lib/parsers/types'
import { completeSchedule } from '@/lib/planning/complete-schedule'
import { analyzeSchedule } from '@/lib/analysis/schedule-analysis'
import { defaultCalendar } from '@/lib/planning/calendar'

const cal = defaultCalendar()
const act = (code: string, fields: Partial<Activity> = {}) => makeActivity('s1', { activityId: code, name: code, calendarId: cal.id, ...fields })
const link = (p: Activity, s: Activity): Relationship => ({ id: `${p.id}-${s.id}`, scheduleId: 's1', predecessorId: p.id, successorId: s.id, type: 'FS', lag: 0 })

function run(activities: Activity[], rels: Relationship[], header: { finish?: string | null; mustFinishBy?: string | null; dataDate?: string } = {}) {
  const done = completeSchedule({
    activities, relationships: rels, calendars: [cal], defaultCalendarId: cal.id, projectStart: '2026-03-02',
    projectFinish: header.finish ?? null, dataDate: header.dataDate ?? '2026-03-02', mustFinishBy: header.mustFinishBy ?? null,
  })
  return { done, analysis: analyzeSchedule({ activities: done.activities, links: rels.map(r => ({ from: r.predecessorId, to: r.successorId })), cpm: done.cpm, reportedFinish: header.finish ?? null, mustFinishBy: header.mustFinishBy ?? null, fileValues: done.fileValues }) }
}

describe('analyzeSchedule', () => {
  it('reports the recalculated finish, not the date in the file header, and measures variance on the finish milestone', () => {
    const a = act('A1000', { duration: 10, baselineFinish: '2026-03-13' })
    const f = act('M9000', { name: 'Substantial Completion', activityType: 'milestone', baselineFinish: '2026-03-13' })
    const { analysis } = run([a, f], [link(a, f)], { finish: '2026-06-30' })
    expect(analysis.forecastFinish).toBe('2026-03-13')
    expect(analysis.reportedFinish).toBe('2026-06-30')
    expect(analysis.finishMilestone?.code).toBe('M9000')
    expect(analysis.varianceDays).toBe(0)
    expect(analysis.status).toBe('on_track')
  })
  it('never reports ON TRACK when a mandatory finish hides a slip', () => {
    const s = act('A0000', { name: 'Notice to Proceed', activityType: 'milestone', actualStart: '2026-03-02', actualFinish: '2026-03-02', status: 'complete', percentComplete: 100 })
    const a = act('A1000', { duration: 25, baselineFinish: '2026-03-13' })
    const f = act('M9000', { name: 'Contract Completion', activityType: 'milestone', baselineFinish: '2026-03-13', constraintType: 'MFO', constraintDate: '2026-03-13' })
    const { analysis } = run([s, a, f], [link(s, a), link(a, f)])
    expect(analysis.status).toBe('at_risk')
    expect(analysis.violations).toHaveLength(1)
    expect(analysis.forecastFinish).toBe('2026-04-03')
    expect(analysis.varianceDays).toBe(21)
    expect(analysis.negativeFloatCount).toBeGreaterThan(0)
  })
  it('does not invent a project variance from a handful of baselined activities', () => {
    const acts = ['A', 'B', 'C', 'D', 'E'].map((c, i) => act(c, { duration: 5, baselineFinish: i === 0 ? '2025-01-01' : null }))
    const rels = acts.slice(1).map((s, i) => link(acts[i], s))
    const { analysis } = run(acts, rels)
    expect(analysis.varianceDays).toBeNull()
    expect(analysis.varianceBasis).toMatch(/Only 1 of 5/)
  })
  it('recalculates stored float and lists where the file disagrees', () => {
    const a = act('A', { duration: 5, earlyStart: '2026-03-02', earlyFinish: '2026-03-06', totalFloat: 0 })
    const b = act('B', { duration: 5, earlyStart: '2026-03-09', earlyFinish: '2026-03-13', totalFloat: 30 })
    const { done, analysis } = run([a, b], [link(a, b)], { finish: '2026-03-13' })
    expect(done.activities.find(x => x.activityId === 'B')!.totalFloat).toBe(0)
    expect(analysis.recalc).toMatchObject({ compared: 2, differing: 1 })
    expect(analysis.recalc!.samples[0]).toMatchObject({ code: 'B', fileFloat: 30, planoraFloat: 0 })
  })
  it('flags a forecast after the required finish', () => {
    const a = act('A', { duration: 10 })
    const f = act('F', { activityType: 'milestone' })
    const { analysis } = run([a, f], [link(a, f)], { mustFinishBy: '2026-03-10' })
    expect(analysis.status).toBe('at_risk')
    expect(analysis.statusReasons.join(' ')).toMatch(/after the required finish/)
  })
})

describe('analyzeSchedule: pilot findings (finish milestone, variance basis, status)', () => {
  // NTP (done) -> A -> M2000 Dry-In (MFO) -> B -> M9000 Substantial Completion -> Punch list -> M9100 Final Completion
  function project(opts: { scConstraint?: boolean } = {}) {
    const ntp = act('A0000', { name: 'Notice to Proceed', activityType: 'milestone', actualStart: '2026-03-02', actualFinish: '2026-03-02', status: 'complete', percentComplete: 100 })
    const a = act('A1000', { duration: 10 })
    const dry = act('M2000', { name: 'Dry-In', activityType: 'milestone', milestoneKind: 'finish', constraintType: 'MFO', constraintDate: '2026-03-13' })
    const b = act('A2000', { duration: 10 })
    const sc = act('M9000', { name: 'Substantial Completion', activityType: 'milestone', milestoneKind: 'finish', baselineFinish: '2026-03-27', ...(opts.scConstraint ? { constraintType: 'FNLT', constraintDate: '2026-03-27' } : {}) })
    const punch = act('A9000', { name: 'Punch list', duration: 10 })
    const fc = act('M9100', { name: 'Final Completion', activityType: 'milestone', milestoneKind: 'finish', constraintType: 'FNLT', constraintDate: '2026-04-10' })
    const acts = [ntp, a, dry, b, sc, punch, fc]
    const rels = [link(ntp, a), link(a, dry), link(dry, b), link(b, sc), link(sc, punch), link(punch, fc)]
    return { acts, rels }
  }
  const links = (rels: Relationship[]) => rels.map(r => ({ from: r.predecessorId, to: r.successorId }))

  it('picks Substantial Completion (with successors, finish-constrained) over an MFO interim milestone and Final Completion', () => {
    const { acts, rels } = project({ scConstraint: true })
    const { analysis } = run(acts, rels)
    expect(analysis.finishMilestone?.code).toBe('M9000')
    expect(analysis.varianceBasis).toBe('M9000 Substantial Completion: forecast 03/27/2026 vs baseline 03/27/2026 (calendar days).')
  })

  it('never prefers an interim milestone, and honours a designated milestone by activity code', () => {
    const { acts, rels } = project()
    const { done } = run(acts, rels)
    const base = { activities: done.activities, links: links(rels), cpm: done.cpm, reportedFinish: null, mustFinishBy: null }
    expect(analyzeSchedule(base).finishMilestone?.code).not.toBe('M2000')
    expect(analyzeSchedule({ ...base, finishMilestoneId: 'm9100' }).finishMilestone).toMatchObject({ code: 'M9100', designated: true })
  })

  it('a required completion equal to the Substantial Completion forecast is not a conflict', () => {
    const p = project({ scConstraint: true })
    expect(run(p.acts, p.rels, { mustFinishBy: '2026-03-27' }).analysis.statusReasons.join(' ')).not.toMatch(/required finish/)
    const q = project({ scConstraint: true })
    expect(run(q.acts, q.rels, { mustFinishBy: '2026-03-26' }).analysis.statusReasons.join(' '))
      .toMatch(/M9000 Substantial Completion is forecast for 03\/27\/2026, after the required finish 03\/26\/2026/)
  })

  it('measures variance against the series Baseline upload, not the moving P6 target date', () => {
    const { acts, rels } = project({ scConstraint: true })
    const { done } = run(acts, rels)
    const analysis = analyzeSchedule({
      activities: done.activities, links: links(rels), cpm: done.cpm, reportedFinish: null, mustFinishBy: null,
      seriesBaseline: { scheduleId: 'b1', label: 'Baseline', dataDate: '2026-02-02', finishes: { M9000: '2026-03-20' } },
    })
    expect(analysis.varianceDays).toBe(7)
    expect(analysis.finishMilestone).toMatchObject({ baselineFinish: '2026-03-20', baselineSource: 'baseline_upload' })
    expect(analysis.varianceBasis).toBe('M9000 Substantial Completion: forecast 03/27/2026 vs 03/20/2026 in the Baseline upload "Baseline" (data date 02/02/2026) (calendar days).')
  })

  it('reports negative float with its activity and calendar', () => {
    const { acts, rels } = project({ scConstraint: true })
    const { done } = run(acts, rels, { mustFinishBy: '2026-03-20' })
    const analysis = analyzeSchedule({ activities: done.activities, links: links(rels), cpm: done.cpm, reportedFinish: null, mustFinishBy: null, calendars: [cal], defaultCalendarId: cal.id })
    expect(analysis.minFloat).toBeLessThan(0)
    expect(analysis.minFloatAt).toMatchObject({ calendar: 'Standard 5-Day' })
    expect(analysis.statusReasons.join(' ')).toMatch(/negative float \(lowest -\d+ work days on \S+, counted on its "Standard 5-Day" calendar\)/)
  })

  it('a schedule behind on execution (BEI < 0.95) is at least attention', () => {
    // Four tasks baselined to finish before the data date; none finished (plus the finished NTP).
    const ntp = act('A0', { activityType: 'milestone', actualStart: '2026-03-02', actualFinish: '2026-03-02', status: 'complete', percentComplete: 100, baselineStart: '2026-03-02', baselineFinish: '2026-03-02' })
    const ts = [1, 2, 3, 4].map(i => act(`T${i}`, { duration: 1, baselineStart: '2026-03-02', baselineFinish: '2026-03-03' }))
    const f = act('F', { name: 'Substantial Completion', activityType: 'milestone', baselineFinish: '2026-04-30' })
    const rels = [...ts.map(t => link(ntp, t)), ...ts.map(t => link(t, f))]
    const { done } = run([ntp, ...ts, f], rels, { dataDate: '2026-03-16' })
    const analysis = analyzeSchedule({ activities: done.activities, links: links(rels), cpm: done.cpm, reportedFinish: null, mustFinishBy: null, dataDate: '2026-03-16' })
    expect(analysis.status).not.toBe('on_track')
    expect(analysis.statusReasons.join(' ')).toMatch(/Baseline execution index is 0\.20, below 0\.95/)
    expect(analysis.statusReasons.join(' ')).toMatch(/4 of 5 activities baselined to finish before 03\/16\/2026 finished late or not at all/)
  })

  it('an unstarted schedule does not report a slip against stale target dates', () => {
    const a = act('A1000', { duration: 120 })
    const f = act('M9000', { name: 'Substantial Completion', activityType: 'milestone', baselineFinish: '2026-03-31' })
    const { analysis } = run([a, f], [link(a, f)])
    expect(analysis.varianceDays).toBeNull()
    expect(analysis.finishMilestone?.varianceDays).toBeNull()
    expect(analysis.varianceBasis).toMatch(/^No work has started, so the file's baseline \(target\) dates are planned dates.*no slip is reported\. M9000 Substantial Completion: forecast \d\d\/\d\d\/2026 vs baseline 03\/31\/2026 \(calendar days\): \d+ calendar days later/)
    expect(analysis.status).toBe('on_track')
  })
})
