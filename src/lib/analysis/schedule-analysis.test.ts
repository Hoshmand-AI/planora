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
    const a = act('A1000', { duration: 25, baselineFinish: '2026-03-13' })
    const f = act('M9000', { name: 'Contract Completion', activityType: 'milestone', baselineFinish: '2026-03-13', constraintType: 'MFO', constraintDate: '2026-03-13' })
    const { analysis } = run([a, f], [link(a, f)])
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
