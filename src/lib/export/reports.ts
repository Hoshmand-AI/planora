// Deterministic schedule reports, built from the recalculated network with no AI model (offline,
// air-gapped, or when the model fails). Each report type has its own content:
//   executive_summary — status and why, finish vs baseline, milestones, the next 14 days, top issues
//   critical_path     — the longest (driving) path in sequence, near-critical work, constraints
//   variance          — finish-milestone variance, milestone and activity baseline-vs-forecast
//                       tables, and the change since the previous update when there is one
//   qa_qc             — DCMA 14-point table with every offender, recalculation differences,
//                       overruled constraints and the data questions
// Dates are MM/DD/YYYY; variances are calendar days, float is work days. Pure, so it is unit tested.

import type { Activity, Relationship, Schedule } from '@/lib/db'
import type { DcmaReport } from '@/lib/planning/types'
import type { ScheduleAnalysis } from '@/lib/analysis/schedule-analysis'
import type { ScheduleComparison } from '@/lib/analysis/compare'
import type { ProjectBrief } from '@/lib/analysis/brief'
import { fmtDate, fmtDates } from '@/lib/format'

export type ReportType = 'executive_summary' | 'critical_path' | 'variance' | 'qa_qc'
export const REPORT_TITLES: Record<ReportType, string> = {
  executive_summary: 'Executive Summary',
  critical_path: 'Critical Path Analysis',
  variance: 'Baseline vs Current Variance',
  qa_qc: 'Schedule QA/QC Audit (DCMA 14-Point)',
}

export interface ReportInput {
  schedule: Schedule
  activities: Activity[]
  relationships: Relationship[]
  analysis: ScheduleAnalysis
  dcma: DcmaReport
  brief?: ProjectBrief | null
  comparison?: ScheduleComparison | null
  dataQuestions?: { severity: string; question: string; activityCodes?: string[] }[]
  /** For the 14-day outlook; defaults to the data date */
  today?: string
}

const DAY = 86_400_000
const calDays = (a: string | null | undefined, b: string | null | undefined) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / DAY) : null)
const d = (v: string | null | undefined) => (v ? fmtDate(v) : '—')
const signed = (n: number | null | undefined) => (n == null ? '—' : n > 0 ? `+${n}` : String(n))
const cell = (v: unknown) => String(v ?? '—').replace(/\|/g, '/').replace(/\s+/g, ' ')
const table = (head: string[], rows: unknown[][]) => rows.length
  ? [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.map(cell).join(' | ')} |`)].join('\n')
  : '_None._'
const open = (a: Activity) => a.status !== 'complete' && !a.actualFinish
const isWork = (a: Activity) => a.activityType !== 'summary' && a.activityType !== 'loe'
const STATUS = { on_track: 'On track', attention: 'Needs attention', at_risk: 'At risk', complete: 'Complete' } as const

function statusSection(r: ReportInput): string[] {
  const { analysis: an, schedule: s } = r
  const fm = an.finishMilestone
  return [
    `**Status: ${STATUS[an.status]}.** ${an.statusReasons.join(' ') || 'No negative float, no overruled constraints and no slip against the baseline.'}`,
    '',
    table(['Item', 'Value'], [
      ['Data date', d(s.dataDate)],
      ['Forecast finish (Planora recalculation)', d(an.forecastFinish)],
      ['Finish written in the file header', d(an.reportedFinish)],
      ['Required finish (Must Finish By)', d(an.mustFinishBy)],
      ['Finish milestone', fm ? `${fm.code} ${fm.name}` : '—'],
      ['Finish milestone baseline / forecast', fm ? `${d(fm.baselineFinish)} / ${d(fm.forecastFinish)}` : '—'],
      ['Variance (calendar days, + = late)', signed(an.varianceDays)],
      ['Lowest total float on open work (work days)', an.minFloat ?? '—'],
      ['Activities with negative float', an.negativeFloatCount],
      ['Scheduling of out-of-sequence progress', an.progressMode === 'retained' ? 'Retained logic' : 'Progress override'],
    ]),
    '',
    `_Variance basis: ${an.varianceBasis}_`,
  ]
}

/**
 * The forecast an activity's logic produces. Where a mandatory constraint (MFO/MSO) pins the
 * displayed date earlier than logic allows, the logic date is the forecast — the same rule the
 * headline variance uses (src/lib/analysis/schedule-analysis.ts), so tables agree with it.
 */
function forecastOf(r: ReportInput, a: Activity): { start: string | null; finish: string | null; pinned: ScheduleAnalysis['violations'][number] | null } {
  if (!open(a)) return { start: a.actualStart || a.earlyStart, finish: a.actualFinish || a.earlyFinish, pinned: null }
  const v = r.analysis.violations.find(x => x.id === a.id) ?? null
  if (!v) return { start: a.actualStart || a.earlyStart, finish: a.earlyFinish, pinned: null }
  // The CPM's logicDate is the logic-driven finish (a milestone's date) for MFO and MSO alike.
  return { start: a.actualStart || (a.activityType === 'milestone' ? v.logicDate : a.earlyStart), finish: v.logicDate, pinned: v }
}

function milestoneRows(r: ReportInput) {
  return r.activities.filter(a => a.activityType === 'milestone')
    .map(m => ({ m, f: forecastOf(r, m) }))
    .sort((x, y) => (x.f.finish || '').localeCompare(y.f.finish || ''))
    .map(({ m, f }) => [m.activityId, m.name, d(m.baselineFinish), d(f.finish),
      m.actualFinish ? 'Actual' : f.pinned ? `Forecast by logic (${f.pinned.type} ${d(f.pinned.constraintDate)} overruled)` : 'Forecast',
      signed(calDays(m.baselineFinish, f.finish)), open(m) ? m.totalFloat : '—'])
}

function drivingPath(r: ReportInput): Activity[] {
  const byId = new Map(r.activities.map(a => [a.id, a]))
  return r.analysis.longestPath.map(id => byId.get(id)).filter((a): a is Activity => !!a && open(a))
}

function executiveSummary(r: ReportInput): string[] {
  const work = r.activities.filter(isWork)
  const done = work.filter(a => !open(a)).length
  const from = r.today || r.schedule.dataDate || new Date().toISOString().slice(0, 10)
  const to = new Date(Date.parse(from) + 14 * DAY).toISOString().slice(0, 10)
  const next = work.filter(a => open(a) && !a.actualStart && a.earlyStart && a.earlyStart >= from && a.earlyStart <= to)
    .sort((x, y) => (x.earlyStart || '').localeCompare(y.earlyStart || ''))
  const path = drivingPath(r)
  const failing = r.dcma.checks.filter(c => c.result === 'fail')
  return [
    ...(r.brief ? ['## 1. Project overview', r.brief.summary, ''] : ['## 1. Project overview', `${r.schedule.name}, ${r.schedule.version}.`, '']),
    '## 2. Schedule status', ...statusSection(r), '',
    `Progress: ${done} of ${work.length} activities complete (${work.length ? Math.round((100 * done) / work.length) : 0}%).`, '',
    ...(r.comparison ? ['## 3. Since the previous update', ...r.comparison.summary.map(x => `- ${x}`), ''] : ['## 3. Since the previous update', '_No earlier upload of this project to compare with._', '']),
    '## 4. Key milestones', table(['ID', 'Milestone', 'Baseline', 'Forecast/actual', '', 'Variance (cd)', 'Float (wd)'], milestoneRows(r).slice(0, 15)), '',
    '## 5. Driving path (first 10 open activities)', table(['ID', 'Activity', 'Start', 'Finish', 'Float (wd)'], path.slice(0, 10).map(a => [a.activityId, a.name, d(a.earlyStart), d(a.earlyFinish), a.totalFloat])), '',
    `## 6. Next 14 days (${d(from)}–${d(to)})`, table(['ID', 'Activity', 'Start', 'Float (wd)'], next.slice(0, 15).map(a => [a.activityId, a.name, d(a.earlyStart), a.totalFloat])), '',
    '## 7. Issues to resolve',
    ...issues(r, failing),
  ]
}

function issues(r: ReportInput, failing: DcmaReport['checks']): string[] {
  const out = [
    ...r.analysis.violations.map(v => `- ${codeOf(r, v.id)}: mandatory ${v.type === 'MSO' ? 'start' : 'finish'} ${d(v.constraintDate)} overrules logic by ${v.days} work days (logic date ${d(v.logicDate)}).`),
    ...failing.slice(0, 6).map(c => `- DCMA #${c.id} ${c.name} (${c.metric}): ${c.explanation}`),
  ]
  if (r.analysis.recalc?.differing) out.push(`- ${r.analysis.recalc.differing} of ${r.analysis.recalc.compared} open activities carry float or finish dates in the file that differ from Planora's recalculation by more than 1 day.`)
  return out.length ? out : ['_None found._']
}

function codeOf(r: ReportInput, id: string) {
  const a = r.activities.find(x => x.id === id)
  return a ? `${a.activityId} ${a.name}` : id
}

function criticalPath(r: ReportInput): string[] {
  const path = drivingPath(r)
  const opens = r.activities.filter(a => isWork(a) && open(a))
  const critical = opens.filter(a => a.totalFloat <= 0)
  const near = opens.filter(a => a.totalFloat > 0 && a.totalFloat <= 10).sort((x, y) => x.totalFloat - y.totalFloat)
  const constrained = opens.filter(a => a.constraintType)
  const preds = new Map<string, Relationship[]>()
  for (const rel of r.relationships) preds.set(rel.successorId, [...(preds.get(rel.successorId) || []), rel])
  const pathIds = new Set(path.map(a => a.id))
  const linkInto = (a: Activity) => {
    const p = (preds.get(a.id) || []).find(x => pathIds.has(x.predecessorId))
    return p ? `${p.type}${p.lag ? ` ${p.lag > 0 ? '+' : ''}${p.lag}d` : ''}` : 'start'
  }
  return [
    '## 1. Summary',
    `- Longest (driving) path to the finish: ${path.length} open activities, from ${path[0] ? `${path[0].activityId} ${path[0].name}` : '—'} to ${path.length ? `${path[path.length - 1].activityId} ${path[path.length - 1].name}` : '—'}.`,
    `- Critical (total float ≤ 0): ${critical.length} of ${opens.length} open activities (${opens.length ? Math.round((100 * critical.length) / opens.length) : 0}%).`,
    `- Near-critical (1–10 work days of float): ${near.length}.`,
    `- Forecast finish ${d(r.analysis.forecastFinish)}${r.analysis.mustFinishBy ? `; required ${d(r.analysis.mustFinishBy)}` : ''}. Lowest float on open work: ${r.analysis.minFloat ?? '—'} work days.`,
    `- Out-of-sequence progress scheduled with ${r.analysis.progressMode === 'retained' ? 'retained logic' : 'progress override'}.`,
    '',
    '## 2. Driving path in sequence', table(['#', 'ID', 'Activity', 'Relationship in', 'Duration (wd)', 'Start', 'Finish', 'Float (wd)', 'Constraint'],
      path.map((a, i) => [i + 1, a.activityId, a.name, linkInto(a), a.status === 'in_progress' ? `${a.remainingDuration} rem.` : a.duration, d(a.earlyStart), d(a.earlyFinish), a.totalFloat, a.constraintType ? `${a.constraintType} ${d(a.constraintDate)}` : ''])), '',
    '## 3. Near-critical activities (1–10 work days of float)', table(['ID', 'Activity', 'Finish', 'Float (wd)'], near.slice(0, 30).map(a => [a.activityId, a.name, d(a.earlyFinish), a.totalFloat])), '',
    '## 4. Constraints on open work', table(['ID', 'Activity', 'Constraint', 'Date', 'Float (wd)'], constrained.map(a => [a.activityId, a.name, a.constraintType, d(a.constraintDate), a.totalFloat])), '',
    '## 5. Mandatory constraints that overrule logic',
    r.analysis.violations.length ? table(['Activity', 'Type', 'Constraint date', 'Logic date', 'Work days hidden'], r.analysis.violations.map(v => [codeOf(r, v.id), v.type, d(v.constraintDate), d(v.logicDate), v.days])) : '_None._',
  ]
}

function variance(r: ReportInput): string[] {
  const work = r.activities.filter(isWork)
  const withBl = work.filter(a => a.baselineFinish)
  const rows = withBl.map(a => {
    const { start: s, finish: f } = forecastOf(r, a)
    return { a, startVar: calDays(a.baselineStart, s), finishVar: calDays(a.baselineFinish, f), f, s }
  })
  const late = rows.filter(x => (x.finishVar ?? 0) > 0).sort((x, y) => (y.finishVar ?? 0) - (x.finishVar ?? 0))
  const early = rows.filter(x => (x.finishVar ?? 0) < 0)
  const c = r.comparison
  return [
    '## 1. Overall variance', ...statusSection(r), '',
    withBl.length ? `${withBl.length} of ${work.length} activities carry baseline dates: ${late.length} forecast or finished late, ${early.length} early, ${withBl.length - late.length - early.length} on time.` : 'The file carries no baseline dates, so activity variance cannot be measured. Export the baseline into the update (P6: assign the project baseline before export) to enable this report.',
    '',
    '## 2. Milestones: baseline vs forecast', table(['ID', 'Milestone', 'Baseline', 'Forecast/actual', '', 'Variance (cd)', 'Float (wd)'], milestoneRows(r)), '',
    '## 3. Activities finishing latest against baseline (top 25)', table(['ID', 'Activity', 'BL start', 'Start', 'Start var (cd)', 'BL finish', 'Finish', 'Finish var (cd)', 'Float (wd)'],
      late.slice(0, 25).map(x => [x.a.activityId, x.a.name, d(x.a.baselineStart), d(x.s), signed(x.startVar), d(x.a.baselineFinish), d(x.f), signed(x.finishVar), open(x.a) ? x.a.totalFloat : 'done'])), '',
    '## 4. Change since the previous update',
    ...(c ? [
      `Compared with ${c.before.version} (data date ${d(c.before.dataDate)}).`, '',
      ...c.summary.map(x => `- ${x}`), '',
      '### Duration and constraint changes', table(['ID', 'Activity', 'Change', 'Before', 'After', 'Delta'], c.changes.filter(x => x.field === 'duration' || x.field === 'constraint' || x.field === 'calendar').slice(0, 30).map(x => [x.code, x.name, x.field, x.before, x.after, signed(x.delta)])), '',
      '### Largest float erosion', table(['ID', 'Activity', 'Float before (wd)', 'Float after (wd)', 'Change'], c.floatErosion.slice(0, 20).map(x => [x.code, x.name, x.before, x.after, x.delta])), '',
      '### Logic changes', table(['Change', 'Predecessor', 'Successor', 'Type', 'Lag'], [
        ...c.logicAdded.map(x => ['added', x.pred, x.succ, x.type, x.lag]), ...c.logicDeleted.map(x => ['deleted', x.pred, x.succ, x.type, x.lag]),
        ...c.lagChanged.map(x => ['lag changed', x.pred, x.succ, x.type, `${x.before} → ${x.after}`])].slice(0, 40)), '',
      ...(c.actualsRewritten.length ? ['### Actual dates rewritten after they were reported', table(['ID', 'Activity', 'Field', 'Before', 'After'], c.actualsRewritten.map(x => [x.code, x.name, x.field, d(String(x.before)), d(String(x.after))]))] : []),
    ] : ['_No earlier upload of this project. Upload the next update with the same P6 project ID (or MS Project title) to see what changed._']),
  ]
}

function qaqc(r: ReportInput): string[] {
  const fail = r.dcma.checks.filter(c => c.result === 'fail')
  return [
    '## 1. Score', `${r.dcma.passed} of ${r.dcma.applicable} applicable DCMA 14-point checks pass (score ${r.dcma.score}). Checks that cannot be evaluated are marked n/a and excluded.`, '',
    '## 2. DCMA 14-point results', table(['#', 'Check', 'Metric', 'Threshold', 'Result'], r.dcma.checks.map(c => [c.id, c.name, c.metric, c.threshold, c.result.toUpperCase()])), '',
    '## 3. Findings and the activities involved',
    ...(fail.length ? fail.map(c => `- **#${c.id} ${c.name} (${c.metric}).** ${c.explanation}${c.offenders.length ? ` Activities: ${c.offenders.join(', ')}${c.offenders.length >= 25 ? ' (first 25)' : ''}.` : ''}`) : ['_All applicable checks pass._']), '',
    '## 4. Mandatory constraints that overrule logic',
    r.analysis.violations.length ? table(['Activity', 'Type', 'Constraint date', 'Logic date', 'Work days hidden'], r.analysis.violations.map(v => [codeOf(r, v.id), v.type, d(v.constraintDate), d(v.logicDate), v.days])) : '_None._', '',
    '## 5. File vs Planora recalculation',
    r.analysis.recalc
      ? `${r.analysis.recalc.differing} of ${r.analysis.recalc.compared} open activities differ by more than 1 day in finish or total float.\n\n${table(['ID', 'Activity', 'File finish', 'Planora finish', 'File float', 'Planora float'], r.analysis.recalc.samples.map(x => [x.code, x.name, d(x.fileFinish), d(x.planoraFinish), x.fileFloat ?? '—', x.planoraFloat ?? '—']))}`
      : '_The file carried no calculated dates, so Planora scheduled it from logic; there is nothing to compare._', '',
    '## 6. Data questions for the scheduler',
    ...(r.dataQuestions?.length ? r.dataQuestions.slice(0, 30).map(q => `- (${q.severity}) ${q.question}${q.activityCodes?.length ? ` [${q.activityCodes.slice(0, 8).join(', ')}]` : ''}`) : ['_None._']),
  ]
}

export function buildReport(type: string, r: ReportInput): string {
  const t = (type in REPORT_TITLES ? type : 'executive_summary') as ReportType
  const body = t === 'critical_path' ? criticalPath(r) : t === 'variance' ? variance(r) : t === 'qa_qc' ? qaqc(r) : executiveSummary(r)
  // Analysis reasons, variance basis, comparisons and findings carry ISO dates; people read MM/DD/YYYY.
  return fmtDates([
    `# ${REPORT_TITLES[t]} — ${r.schedule.name} (${r.schedule.version})`, '',
    `_Prepared by Planora from the schedule data (no AI model). Data date ${d(r.schedule.dataDate)}. Dates MM/DD/YYYY; variances in calendar days (cd); float and durations in work days (wd)._`, '',
    ...body,
  ].join('\n'))
}
