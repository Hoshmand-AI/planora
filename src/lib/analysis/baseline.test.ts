import { describe, it, expect } from 'vitest'
import type { Activity, Relationship, Schedule } from '@/lib/db'
import { makeActivity } from '@/lib/parsers/types'
import { parseXER } from '@/lib/parsers/xer-parser'
import { completeSchedule } from '@/lib/planning/complete-schedule'
import { analyzeSchedule } from '@/lib/analysis/schedule-analysis'
import { baselineExecution, fmtIndex, isCompleteActivity, roundIndex, runDcma } from '@/lib/analysis/dcma'
import { seriesTrend } from '@/lib/analysis/windows'
import { analyzableFromDb, pickSeriesBaseline, remeasureSeries, seriesBaselineFrom } from '@/lib/planning/service'
import { buildReport } from '@/lib/export/reports'
import { defaultCalendar } from '@/lib/planning/calendar'
import { applyBaseline, assessFileTargets, baselineFromUpload, resolveBaseline } from './baseline'

const cal = defaultCalendar()
const act = (sid: string, code: string, f: Partial<Activity> = {}) => makeActivity(sid, { activityId: code, name: `Activity ${code}`, wbs: 'CIV.EARTH Earthwork', calendarId: cal.id, duration: 5, ...f })
const link = (p: Activity, s: Activity): Relationship => ({ id: p.id + s.id, scheduleId: p.scheduleId, predecessorId: p.id, successorId: s.id, type: 'FS', lag: 0 })
const sched = (f: Partial<Schedule>) => ({ name: 'Bridge 12', projectStart: '2026-03-02', calendars: [cal], defaultCalendarId: cal.id, warnings: [], projectKey: 'bridge 12', ...f } as unknown as Schedule)

// The upload labelled Baseline (data date 03/02): its forecast is the baseline.
const baseSchedule = sched({ id: 'b', version: 'Baseline', dataDate: '2026-03-02', uploadedAt: '2026-03-01T15:00:00Z' })
const baseActs = [
  act('b', 'M100', { name: 'Notice to Proceed', activityType: 'milestone', milestoneKind: 'start', duration: 0, earlyStart: '2026-03-02', earlyFinish: '2026-03-02' }),
  act('b', 'A200', { duration: 5, earlyStart: '2026-03-02', earlyFinish: '2026-03-06' }),
  act('b', 'A300', { duration: 10, earlyStart: '2026-03-09', earlyFinish: '2026-03-20' }),
  act('b', 'M900', { name: 'Substantial Completion', activityType: 'milestone', duration: 0, earlyStart: '2026-03-20', earlyFinish: '2026-03-20' }),
]

// Update 1 (data date 03/23): its own P6 target dates were moved (re-planned) and differ from the Baseline upload.
const updSchedule = sched({ id: 'u', version: 'Update 1', dataDate: '2026-03-23', uploadedAt: '2026-03-24T15:00:00Z' })
const ntp = act('u', 'M100', { name: 'Notice to Proceed', activityType: 'milestone', milestoneKind: 'start', duration: 0, actualStart: '2026-03-02', actualFinish: '2026-03-02', status: 'complete', percentComplete: 100, baselineStart: '2026-03-02', baselineFinish: '2026-03-02' })
const a200 = act('u', 'A200', { duration: 5, actualStart: '2026-03-02', actualFinish: '2026-03-06', status: 'complete', percentComplete: 100, baselineStart: '2026-03-02', baselineFinish: '2026-03-06' })
const a300 = act('u', 'A300', { duration: 10, remainingDuration: 5, actualStart: '2026-03-09', status: 'in_progress', percentComplete: 50, baselineStart: '2026-03-30', baselineFinish: '2026-04-10' })
const m900 = act('u', 'M900', { name: 'Substantial Completion', activityType: 'milestone', duration: 0, baselineFinish: '2026-04-10' })
const rels = [link(ntp, a200), link(a200, a300), link(a300, m900)]

function loadUpdate() {
  const done = completeSchedule({ activities: [ntp, a200, a300, m900], relationships: rels, calendars: [cal], defaultCalendarId: cal.id, projectStart: '2026-03-02', projectFinish: null, dataDate: '2026-03-23' })
  const seriesBaseline = seriesBaselineFrom(updSchedule, [baseSchedule, updSchedule], () => baseActs)
  const baseline = resolveBaseline({ activities: done.activities, seriesBaseline, meta: { fileTargets: assessFileTargets([ntp, a200, a300, m900]) } })
  const activities = applyBaseline(done.activities, baseline)
  const analysis = analyzeSchedule({ activities, links: rels.map(r => ({ from: r.predecessorId, to: r.successorId })), cpm: done.cpm, reportedFinish: null, mustFinishBy: null, dataDate: '2026-03-23', baseline })
  return { done, baseline, activities, analysis, fileActivities: done.activities }
}

describe('one baseline for every surface (series Baseline upload vs the update file\'s own targets)', () => {
  const { baseline, activities, analysis, fileActivities } = loadUpdate()
  const dcma = runDcma(analyzableFromDb(updSchedule, activities, rels))
  const input = { schedule: updSchedule, activities, relationships: rels, analysis, dcma }
  const variance = buildReport('variance', input)
  const exec = buildReport('executive_summary', input)

  it('resolves the upload labelled Baseline and states it as the report header', () => {
    expect(baseline.source).toBe('baseline_upload')
    expect(baseline.header).toBe("Baseline: Update 0 'Baseline' uploaded 03/01/2026 (data date 03/02/2026)")
    expect(analysis.baseline?.header).toBe(baseline.header)
    for (const t of ['executive_summary', 'critical_path', 'variance', 'qa_qc']) expect(buildReport(t, input)).toContain(`**${baseline.header}.**`)
  })

  it('headline, finish milestone, milestone tables, WBS roll-up and activity table all report +7 against 03/20/2026', () => {
    // A300 has 5 days left from Mon 03/23 -> Fri 03/27; the Baseline upload had M900 on 03/20.
    expect(analysis.finishMilestone).toMatchObject({ code: 'M900', baselineFinish: '2026-03-20', baselineSource: 'baseline_upload', forecastFinish: '2026-03-27', varianceDays: 7 })
    expect(analysis.varianceDays).toBe(7)
    expect(variance).toMatch(/Variance \(calendar days, \+ = late\) \| \+7 \|/)
    expect(variance).toMatch(/Finish milestone baseline \/ forecast \| 03\/20\/2026 \/ 03\/27\/2026 \|/)
    const milestoneRow = /\| M900 \| Substantial Completion \| 03\/20\/2026 \| 03\/27\/2026 \| Forecast \| — \| — \| \+7 \|/
    expect(variance).toMatch(milestoneRow)
    expect(exec).toMatch(milestoneRow)
    expect(variance).toMatch(/\| CIV \| 4 \| 2 \| 03\/20\/2026 \| 03\/27\/2026 \| \+7 \|/)
    expect(variance).toMatch(/\| M900 \| Substantial Completion \| CIV \| 03\/20\/2026 \| 03\/27\/2026 \| \+7 \| 03\/20\/2026 \| 03\/27\/2026 \| \+7 \|/)
    // The update file's own (moved) targets appear nowhere in the analysis surfaces.
    expect(variance).not.toMatch(/04\/10\/2026/)
    expect(exec).not.toMatch(/04\/10\/2026/)
    // ...but stay on the file's activities for exports.
    expect(fileActivities.find(a => a.activityId === 'M900')?.baselineFinish).toBe('2026-04-10')
  })

  it('BEI and missed tasks are computed from the Baseline upload (tasks only), the same in status, DCMA and the trend', () => {
    // Baseline upload: A200 (03/06) and A300 (03/20) were due before 03/23; only A200 is complete.
    // The file's own targets would have made only A200 due (BEI 1.00).
    const ex = baselineExecution(analyzableFromDb(updSchedule, activities, rels).activities, '2026-03-23')!
    expect(ex).toMatchObject({ due: 2, completed: 1, missed: 1, missedCodes: ['A300'] })
    expect(dcma.checks.find(c => c.id === 14)).toMatchObject({ metric: '0.50', result: 'fail' })
    expect(dcma.checks.find(c => c.id === 11)).toMatchObject({ metric: '50.0%', offenders: ['A300'] })
    expect(analysis.statusReasons.join(' ')).toMatch(/Baseline execution index is 0\.50, below 0\.95: 1 tasks complete against 2/)
    const trend = seriesTrend([{ schedule: updSchedule, activities, relationships: rels, analysis }], 'M900')
    expect(trend[0]).toMatchObject({ bei: 0.5, missed: 1, due: 2 })
    // The NTP start milestone is never a missed task.
    expect(ex.missedCodes).not.toContain('M100')
    const fileEx = baselineExecution(analyzableFromDb(updSchedule, fileActivities, rels).activities, '2026-03-23')!
    expect(fileEx.due).toBe(1)
  })

  it('the windows trend re-measures every update against the anchor\'s baseline', () => {
    const own = { schedule: { id: 'x', dataDate: '2026-03-23' }, activities: fileActivities, baseline: resolveBaseline({ activities: fileActivities }) }
    const anchor = { schedule: { id: 'u', dataDate: '2026-03-23' }, activities, baseline }
    const [x] = remeasureSeries([own, anchor], 'u')
    expect(x.activities.find(a => a.activityId === 'M900')?.baselineFinish).toBe('2026-03-20')
  })
})

describe('choosing the baseline', () => {
  const u2 = sched({ id: 'u2', version: 'Update 2', dataDate: '2026-04-06', uploadedAt: '2026-04-07T15:00:00Z' })
  const series = [baseSchedule, updSchedule, u2]
  it('defaults to the upload labelled Baseline; a designated earlier upload wins; a later one never does', () => {
    expect(pickSeriesBaseline(u2, series)?.id).toBe('b')
    expect(pickSeriesBaseline({ ...u2, baselineScheduleId: 'u' }, series)?.id).toBe('u')
    expect(pickSeriesBaseline({ ...updSchedule, baselineScheduleId: 'u2' }, series)?.id).toBe('b')
    const r = seriesBaselineFrom({ ...u2, baselineScheduleId: 'u' }, series, () => baseActs)!
    expect(r.header).toBe('Baseline: Update 1 uploaded 03/24/2026 (data date 03/23/2026), designated by the scheduler')
  })
  it('never uses the P6 planned dates of not-started work in an update as a baseline', () => {
    const p = [
      act('p', 'A1', { actualStart: '2026-03-02', actualFinish: '2026-03-06', status: 'complete', baselineStart: '2026-03-02', baselineFinish: '2026-03-06' }),
      ...['A2', 'A3', 'A4'].map((c, i) => act('p', c, { earlyStart: `2026-04-0${i + 1}`, earlyFinish: `2026-04-0${i + 5}`, baselineStart: `2026-04-0${i + 1}`, baselineFinish: `2026-04-0${i + 5}` })),
    ]
    const ft = assessFileTargets(p)
    expect(ft.usable).toBe(false)
    const r = resolveBaseline({ activities: p, meta: { fileTargets: ft } })
    expect(r.source).toBe('none')
    expect(applyBaseline(p, r).every(a => !a.baselineFinish)).toBe(true)
    const an = analyzeSchedule({ activities: p, links: [], cpm: null, reportedFinish: null, mustFinishBy: null, dataDate: '2026-03-23', baseline: r })
    expect(an.varianceDays).toBeNull()
    expect(an.varianceBasis).toMatch(/planned dates, not a baseline/)
    // Targets that differ from the planned dates are a baseline.
    expect(assessFileTargets(p.map((a, i) => (i ? { ...a, baselineFinish: '2026-03-31' } : a))).usable).toBe(true)
  })
})

describe('the P6 project baseline embedded in the XER', () => {
  const xer = [
    'ERMHDR\t19.12\t2026-03-24\tProject\tadmin\tPrimavera',
    '%T\tPROJECT',
    '%F\tproj_id\tproj_short_name\tsum_base_proj_id\torig_proj_id\tlast_recalc_date\tplan_start_date',
    '%R\t1\tBRIDGE-12\t2\t\t2026-03-23 00:00\t2026-03-02 00:00',
    '%R\t2\tBRIDGE-12 BL1\t\t1\t2026-03-02 00:00\t2026-03-02 00:00',
    '%T\tTASK',
    '%F\ttask_id\tproj_id\ttask_code\ttask_name\ttask_type\tstatus_code\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt\tact_start_date\tact_end_date\tearly_start_date\tearly_end_date\ttarget_start_date\ttarget_end_date',
    '%R\t11\t1\tA200\tExcavate\tTT_Task\tTK_Complete\t40\t0\t2026-03-02 08:00\t2026-03-06 17:00\t\t\t2026-03-02 08:00\t2026-03-06 17:00',
    '%R\t12\t1\tA300\tPour\tTT_Task\tTK_Active\t80\t40\t2026-03-09 08:00\t\t2026-03-23 08:00\t2026-03-27 17:00\t2026-03-30 08:00\t2026-04-10 17:00',
    '%R\t13\t1\tM900\tSubstantial Completion\tTT_FinMile\tTK_NotStart\t0\t0\t\t\t2026-03-27 17:00\t2026-03-27 17:00\t2026-04-10 17:00\t2026-04-10 17:00',
    '%R\t21\t2\tA200\tExcavate\tTT_Task\tTK_NotStart\t40\t40\t\t\t2026-03-02 08:00\t2026-03-06 17:00\t2026-03-02 08:00\t2026-03-06 17:00',
    '%R\t22\t2\tA300\tPour\tTT_Task\tTK_NotStart\t80\t80\t\t\t2026-03-09 08:00\t2026-03-20 17:00\t2026-03-09 08:00\t2026-03-20 17:00',
    '%R\t23\t2\tM900\tSubstantial Completion\tTT_FinMile\tTK_NotStart\t0\t0\t\t\t2026-03-20 17:00\t2026-03-20 17:00\t2026-03-20 17:00\t2026-03-20 17:00',
    '%E',
  ].join('\n')
  const parsed = parseXER(xer, 'e')

  it('imports one project and captures the baseline project\'s TASK dates by task_code', () => {
    expect(parsed.activities.map(a => a.activityId)).toEqual(['A200', 'A300', 'M900'])
    expect(parsed.embeddedBaseline).toMatchObject({ projectId: '2', name: 'BRIDGE-12 BL1', finishes: { A200: '2026-03-06', A300: '2026-03-20', M900: '2026-03-20' } })
  })

  it('is the baseline when the series has no Baseline upload (variance and BEI against it, not the file targets)', () => {
    const b = resolveBaseline({ activities: parsed.activities, seriesBaseline: null, meta: { embedded: parsed.embeddedBaseline, fileTargets: assessFileTargets(parsed.activities) } })
    expect(b.source).toBe('p6_embedded')
    expect(b.header).toBe('Baseline: P6 project baseline "BRIDGE-12 BL1" embedded in the uploaded XER (data date 03/02/2026)')
    const an = analyzeSchedule({ activities: parsed.activities, links: [], cpm: null, reportedFinish: null, mustFinishBy: null, dataDate: '2026-03-23', finishMilestoneId: 'M900', baseline: b })
    expect(an.finishMilestone).toMatchObject({ baselineFinish: '2026-03-20', baselineSource: 'p6_embedded', varianceDays: 7 })
    expect(an.varianceBasis).toMatch(/P6 project baseline "BRIDGE-12 BL1"/)
    const ex = baselineExecution(analyzableFromDb(sched({ dataDate: '2026-03-23' }), applyBaseline(parsed.activities, b), []).activities, '2026-03-23')!
    expect(ex).toMatchObject({ due: 2, completed: 1 })
  })

  it('a series Baseline upload still takes precedence over the embedded one', () => {
    const series = baselineFromUpload(baseSchedule, baseActs, { seriesIndex: 0 })
    expect(resolveBaseline({ activities: parsed.activities, seriesBaseline: series, meta: { embedded: parsed.embeddedBaseline } }).source).toBe('baseline_upload')
  })
})

describe('BEI rounding and completion', () => {
  it('rounds half up to 2 decimals everywhere, and judges pass/fail on the shown value', () => {
    expect(fmtIndex(0.945)).toBe('0.95')
    expect(fmtIndex(0.9449)).toBe('0.94')
    expect(fmtIndex(2 / 3)).toBe('0.67')
    expect(roundIndex(0.125)).toBe(0.13)
  })
  it('a not-started activity whose percent complete was clamped to 100 on import is not complete', () => {
    expect(isCompleteActivity({ id: 'x', code: 'x', name: 'x', type: 'task', duration: 5, status: 'not_started', percentComplete: 100 })).toBe(false)
    expect(isCompleteActivity({ id: 'x', code: 'x', name: 'x', type: 'task', duration: 5, percentComplete: 100 })).toBe(true)
  })
})
