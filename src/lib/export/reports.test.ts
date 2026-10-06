import { describe, it, expect } from 'vitest'
import type { Activity, Relationship, Schedule } from '@/lib/db'
import { makeActivity } from '@/lib/parsers/types'
import { completeSchedule } from '@/lib/planning/complete-schedule'
import { analyzeSchedule } from '@/lib/analysis/schedule-analysis'
import { runDcma } from '@/lib/analysis/dcma'
import { analyzableFromDb } from '@/lib/planning/service'
import { buildReport } from '@/lib/export/reports'
import { defaultCalendar } from '@/lib/planning/calendar'

const cal = defaultCalendar()
const act = (code: string, f: Partial<Activity> = {}) => makeActivity('s', { activityId: code, name: `Activity ${code}`, calendarId: cal.id, duration: 5, ...f })
const link = (p: Activity, s: Activity): Relationship => ({ id: p.id + s.id, scheduleId: 's', predecessorId: p.id, successorId: s.id, type: 'FS', lag: 0 })

const ntp = act('M100', { name: 'NTP', activityType: 'milestone', duration: 0, actualStart: '2026-03-02', actualFinish: '2026-03-02', status: 'complete', baselineFinish: '2026-03-02' })
const a = act('A200', { duration: 10, baselineStart: '2026-03-03', baselineFinish: '2026-03-16', actualStart: '2026-03-03', remainingDuration: 8, status: 'in_progress' })
const b = act('A300', { duration: 10, baselineStart: '2026-03-17', baselineFinish: '2026-03-30' })
const f = act('M900', { name: 'Substantial Completion', activityType: 'milestone', duration: 0, baselineFinish: '2026-03-30' })
const rels = [link(ntp, a), link(a, b), link(b, f)]
const schedule = { id: 's', name: 'Bridge 12', version: 'Update 3', dataDate: '2026-03-09', projectStart: '2026-03-02', calendars: [cal], defaultCalendarId: cal.id, warnings: [] } as unknown as Schedule
const done = completeSchedule({ activities: [ntp, a, b, f], relationships: rels, calendars: [cal], defaultCalendarId: cal.id, projectStart: '2026-03-02', projectFinish: null, dataDate: '2026-03-09' })
const analysis = analyzeSchedule({ activities: done.activities, links: rels.map(r => ({ from: r.predecessorId, to: r.successorId })), cpm: done.cpm, reportedFinish: null, mustFinishBy: null })
const dcma = runDcma(analyzableFromDb(schedule, done.activities, rels))
const input = { schedule, activities: done.activities, relationships: rels, analysis, dcma }

describe('buildReport (offline, per type)', () => {
  const types = ['executive_summary', 'critical_path', 'variance', 'qa_qc'] as const
  const out = Object.fromEntries(types.map(t => [t, buildReport(t, input)]))
  it('gives each report type its own body', () => {
    const bodies = types.map(t => out[t].split('\n').slice(1).join('\n'))
    expect(new Set(bodies).size).toBe(4)
  })
  it('variance report measures the finish milestone against its baseline with units', () => {
    expect(analysis.varianceDays).toBe(2) // remaining 8d from Mon 03/09 -> 03/18; A300 03/19-04/01; baseline 03/30
    expect(out.variance).toMatch(/M900 Substantial Completion/)
    expect(out.variance).toMatch(/Variance \(calendar days, \+ = late\) \| \+2/)
    expect(out.variance).toMatch(/## 3\. Activities finishing latest against baseline/)
    expect(out.variance).not.toMatch(/Unknown days/)
  })
  it('critical path report lists the driving path in sequence', () => {
    expect(out.critical_path).toMatch(/\| 1 \| A200 \|/)
    expect(out.critical_path).toMatch(/\| 2 \| A300 \|/)
  })
  it('QA/QC report carries the DCMA table and findings', () => {
    expect(out.qa_qc).toMatch(/DCMA 14-point results/)
    expect(out.qa_qc).toMatch(/\| 14 \| BEI \|/)
  })
})
