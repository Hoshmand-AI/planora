// Deterministic schedule reports, built from the recalculated network with no AI model (offline,
// air-gapped, or when the model fails). Each report type has its own content:
//   executive_summary — status and why, finish vs baseline, milestones, the next 14 days, top issues
//   critical_path     — the longest (driving) path in sequence with the real driving relationship
//                       types, every tied driving branch (relationship free float 0), near-critical
//                       work, constraints
//   variance          — finish-milestone variance, milestones with contract/constraint dates, a WBS
//                       roll-up, every activity's variance, the change since the previous update, and
//                       in an update series the windows analysis and the float / BEI trend
//   qa_qc             — DCMA 14-point table with every offender, recalculation differences,
//                       overruled constraints, the data questions and the reviewer's dispositions
// Every report starts with a provenance block (source file, SHA-256, release, settings, data date).
// Dates are MM/DD/YYYY; variances are calendar days, float is work days. Pure, so it is unit tested.

import type { Activity, Relationship, Schedule } from '@/lib/db'
import type { DcmaReport } from '@/lib/planning/types'
import type { ScheduleAnalysis } from '@/lib/analysis/schedule-analysis'
import type { ScheduleComparison } from '@/lib/analysis/compare'
import type { ProjectBrief } from '@/lib/analysis/brief'
import type { CpmLinkFloat } from '@/lib/planning/types'
import type { WindowsAnalysis } from '@/lib/analysis/windows'
import { trendMarkdown, windowsMarkdown } from '@/lib/analysis/windows'
import type { ReviewState } from '@/lib/analysis/review'
import { reviewMarkdown } from '@/lib/analysis/review'
import { provenanceMarkdown, type Provenance } from './provenance'
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
  dataQuestions?: { id?: string; severity: string; question: string; activityCodes?: string[] }[]
  /** For the 14-day outlook; defaults to the data date */
  today?: string
  /** Source file, SHA-256, release, settings and data date (printed first) */
  provenance?: Provenance | null
  /** Windows analysis and float / BEI trend of the update series (variance report) */
  windows?: WindowsAnalysis | null
  /** Reviewer dispositions of this submission (QA/QC report) */
  review?: ReviewState | null
  /** Relationship free float from the recalculation (critical path report: tied driving branches) */
  linkFloat?: CpmLinkFloat[] | null
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
      ['Lowest total float on open work (work days of that activity\'s calendar)', an.minFloat == null ? '—' : `${an.minFloat}${an.minFloatAt ? ` (${an.minFloatAt.code}, ${an.minFloatAt.calendar === 'own' ? 'own' : an.minFloatAt.calendar} calendar)` : ''}`],
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

/**
 * The contract / constraint date a milestone is held to: its own constraint date, else (for the
 * finish milestone) the required finish the file imposes (P6 Must Finish By).
 */
function contractOf(r: ReportInput, m: Activity): { label: string; date: string } | null {
  if (m.constraintType && m.constraintDate) return { label: m.constraintType, date: m.constraintDate }
  if (r.analysis.mustFinishBy && r.analysis.finishMilestone?.id === m.id) return { label: 'Must Finish By', date: r.analysis.mustFinishBy }
  return null
}

const MILESTONE_HEAD = ['ID', 'Milestone', 'Baseline', 'Forecast/actual', '', 'Contract / constraint', 'Days late vs contract (cd)', 'Variance vs baseline (cd)', 'Float (wd)']

function milestoneRows(r: ReportInput) {
  return r.activities.filter(a => a.activityType === 'milestone')
    .map(m => ({ m, f: forecastOf(r, m), k: contractOf(r, m) }))
    .sort((x, y) => (x.f.finish || '').localeCompare(y.f.finish || ''))
    .map(({ m, f, k }) => [m.activityId, m.name, d(m.baselineFinish), d(f.finish),
      m.actualFinish ? 'Actual' : f.pinned ? `Forecast by logic (${f.pinned.type} ${d(f.pinned.constraintDate)} overruled)` : 'Forecast',
      k ? `${k.label} ${d(k.date)}` : '—', k ? signed(calDays(k.date, f.finish)) : '—',
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
    '## 4. Key milestones', table(MILESTONE_HEAD, milestoneRows(r).slice(0, 15)), '',
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
  const lf = r.linkFloat ?? null
  const relFloat = (rel: Relationship) => lf?.find(x => x.from === rel.predecessorId && x.to === rel.successorId && x.type === rel.type)?.freeFloat ?? null
  const fmtRel = (p: Relationship) => `${p.type}${p.lag ? ` ${p.lag > 0 ? '+' : ''}${p.lag}d` : ''}`
  // The relationship that actually drives each path activity: the one from the previous activity on
  // the path; with several between the same pair, the one with the least relationship free float.
  const linkInto = (a: Activity, i: number) => {
    const prev = i > 0 ? path[i - 1] : null
    const cands = (preds.get(a.id) || []).filter(x => prev && x.predecessorId === prev.id)
    if (!cands.length) return i === 0 ? 'start' : '—'
    const best = [...cands].sort((x, y) => (relFloat(x) ?? 1e9) - (relFloat(y) ?? 1e9))[0]
    return fmtRel(best)
  }
  const branches = drivingBranches(r, path)
  return [
    '## 1. Summary',
    `- Longest (driving) path to the finish: ${path.length} open activities, from ${path[0] ? `${path[0].activityId} ${path[0].name}` : '—'} to ${path.length ? `${path[path.length - 1].activityId} ${path[path.length - 1].name}` : '—'}.`,
    `- Critical (total float ≤ 0): ${critical.length} of ${opens.length} open activities (${opens.length ? Math.round((100 * critical.length) / opens.length) : 0}%).`,
    `- Near-critical (1–10 work days of float): ${near.length}.`,
    `- Forecast finish ${d(r.analysis.forecastFinish)}${r.analysis.mustFinishBy ? `; required ${d(r.analysis.mustFinishBy)}` : ''}. Lowest float on open work: ${r.analysis.minFloat ?? '—'} work days.`,
    `- Out-of-sequence progress scheduled with ${r.analysis.progressMode === 'retained' ? 'retained logic' : 'progress override'}.`,
    '',
    '## 2. Driving path in sequence', table(['#', 'ID', 'Activity', 'Relationship in', 'Duration (wd)', 'Start', 'Finish', 'Float (wd)', 'Constraint'],
      path.map((a, i) => [i + 1, a.activityId, a.name, linkInto(a, i), a.status === 'in_progress' ? `${a.remainingDuration} rem.` : a.duration, d(a.earlyStart), d(a.earlyFinish), a.totalFloat, a.constraintType ? `${a.constraintType} ${d(a.constraintDate)}` : ''])), '',
    '## 3. All driving branches to the finish (relationship free float 0)',
    ...(branches ? [
      branches.ties.length
        ? `${branches.links.length} driving relationships reach the finish; ${branches.ties.length} ${branches.ties.length === 1 ? 'activity is' : 'activities are'} driven by more than one tied predecessor (${branches.ties.slice(0, 8).map(x => x.activityId).join(', ')}${branches.ties.length > 8 ? ` and ${branches.ties.length - 8} more` : ''}), so at least ${branches.parallel} tied branches drive the finish. Shortening one tied branch alone does not move the finish.`
        : `${branches.links.length} driving relationships reach the finish along a single chain (no ties).`,
      '',
      table(['Successor', 'Predecessor', 'Relationship', 'Rel. free float (wd)', 'On the path above'], branches.links.map(x => [`${x.succ.activityId} ${x.succ.name}`, `${x.pred.activityId} ${x.pred.name}`, fmtRel(x.rel), x.float, x.onPath ? 'yes' : 'tied branch'])),
    ] : ['_Relationship free float was not calculated for this schedule (no logic)._']), '',
    '## 4. Near-critical activities (1–10 work days of float)', table(['ID', 'Activity', 'Finish', 'Float (wd)'], near.slice(0, 30).map(a => [a.activityId, a.name, d(a.earlyFinish), a.totalFloat])), '',
    '## 5. Constraints on open work', table(['ID', 'Activity', 'Constraint', 'Date', 'Float (wd)'], constrained.map(a => [a.activityId, a.name, a.constraintType, d(a.constraintDate), a.totalFloat])), '',
    '## 6. Mandatory constraints that overrule logic',
    r.analysis.violations.length ? table(['Activity', 'Type', 'Constraint date', 'Logic date', 'Work days hidden'], r.analysis.violations.map(v => [codeOf(r, v.id), v.type, d(v.constraintDate), d(v.logicDate), v.days])) : '_None._',
  ]
}

/**
 * Every driving relationship (relationship free float <= 0) leading back from the end of the driving
 * path, so tied parallel branches show instead of one arbitrarily chosen chain.
 */
export function drivingBranches(r: Pick<ReportInput, 'activities' | 'relationships' | 'linkFloat'>, path: Activity[]) {
  const lf = r.linkFloat
  if (!lf || !path.length) return null
  const byId = new Map(r.activities.map(a => [a.id, a]))
  const rels = new Map(r.relationships.map(x => [`${x.predecessorId}|${x.successorId}|${x.type}`, x]))
  const into = new Map<string, CpmLinkFloat[]>()
  for (const l of lf) if (l.freeFloat <= 0) into.set(l.to, [...(into.get(l.to) || []), l])
  const onPath = new Set(path.map(a => a.id))
  const seen = new Set<string>()
  const queue = [path[path.length - 1].id]
  const links: { pred: Activity; succ: Activity; rel: Relationship; float: number; onPath: boolean }[] = []
  const driverCount = new Map<string, number>()
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    const ins = (into.get(id) || []).filter(l => { const p = byId.get(l.from); return p && open(p) })
    driverCount.set(id, new Set(ins.map(l => l.from)).size)
    for (const l of ins) {
      const pred = byId.get(l.from)!, succ = byId.get(l.to)!
      const rel = rels.get(`${l.from}|${l.to}|${l.type}`) ?? { id: '', scheduleId: '', predecessorId: l.from, successorId: l.to, type: l.type, lag: l.lag }
      links.push({ pred, succ, rel, float: l.freeFloat, onPath: onPath.has(l.from) && onPath.has(l.to) })
      queue.push(l.from)
    }
  }
  const ties = [...driverCount].filter(([, n]) => n > 1).map(([id]) => byId.get(id)!).filter(Boolean)
  // Each extra tied driver at a merge point adds one parallel driving branch.
  const parallel = 1 + [...driverCount.values()].reduce((t, n) => t + Math.max(0, n - 1), 0)
  links.sort((x, y) => Number(y.onPath) - Number(x.onPath) || (x.succ.earlyStart || '').localeCompare(y.succ.earlyStart || '') || x.succ.activityId.localeCompare(y.succ.activityId))
  return { links, ties, parallel }
}

/** Top-level WBS of an activity: the first segment of its WBS path ("CIV.EARTH Earthwork" -> "CIV"). */
const topWbs = (a: Activity) => (a.wbs || '').trim().split('.')[0].trim().split(/\s+/)[0] || '(no WBS)'

function wbsRollup(r: ReportInput) {
  const groups = new Map<string, Activity[]>()
  for (const a of r.activities.filter(isWork)) groups.set(topWbs(a), [...(groups.get(topWbs(a)) || []), a])
  return [...groups].map(([wbs, acts]) => {
    const fin = acts.map(a => ({ a, f: forecastOf(r, a).finish })).filter(x => x.f)
    const bl = acts.map(a => a.baselineFinish).filter((x): x is string => !!x).sort()
    const forecast = fin.map(x => x.f!).sort().pop() ?? null
    const worst = acts.filter(a => a.baselineFinish).map(a => ({ a, v: calDays(a.baselineFinish, forecastOf(r, a).finish) })).filter(x => x.v != null).sort((x, y) => y.v! - x.v!)[0]
    return { wbs, n: acts.length, done: acts.filter(a => !open(a)).length, bl: bl[bl.length - 1] ?? null, forecast, v: calDays(bl[bl.length - 1], forecast), late: acts.filter(a => (calDays(a.baselineFinish, forecastOf(r, a).finish) ?? 0) > 0).length, worst }
  }).sort((x, y) => (y.v ?? -1e9) - (x.v ?? -1e9) || x.wbs.localeCompare(y.wbs))
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
  // Every activity, latest against baseline first; activities without a baseline last.
  const all = work.map(a => {
    const { start: s, finish: f } = forecastOf(r, a)
    return { a, startVar: calDays(a.baselineStart, s), finishVar: calDays(a.baselineFinish, f), f, s }
  }).sort((x, y) => (x.finishVar == null ? 1 : 0) - (y.finishVar == null ? 1 : 0) || (y.finishVar ?? 0) - (x.finishVar ?? 0) || x.a.activityId.localeCompare(y.a.activityId))
  const c = r.comparison
  const w = r.windows
  return [
    '## 1. Overall variance', ...statusSection(r), '',
    withBl.length ? `${withBl.length} of ${work.length} activities carry baseline dates: ${late.length} forecast or finished late, ${early.length} early, ${withBl.length - late.length - early.length} on time.` : 'The file carries no baseline dates, so activity variance cannot be measured. Export the baseline into the update (P6: assign the project baseline before export) to enable this report.',
    '',
    '## 2. Milestones: baseline, contract and forecast', table(MILESTONE_HEAD, milestoneRows(r)),
    '', '_Days late vs contract: forecast (or actual) minus the milestone\'s constraint date, or the required finish for the finish milestone; + = late._', '',
    '## 3. Finish variance by top-level WBS', table(['WBS', 'Activities', 'Complete', 'Latest baseline finish', 'Latest forecast finish', 'Finish variance (cd)', 'Activities late', 'Worst activity'],
      wbsRollup(r).map(g => [g.wbs, g.n, g.done, d(g.bl), d(g.forecast), signed(g.v), g.late, g.worst && g.worst.v! > 0 ? `${g.worst.a.activityId} (${signed(g.worst.v)})` : '—'])), '',
    `## 4. Activities finishing latest against baseline (all ${all.length} activities, by finish variance)`, table(['ID', 'Activity', 'WBS', 'BL start', 'Start', 'Start var (cd)', 'BL finish', 'Finish', 'Finish var (cd)', 'Float (wd)'],
      all.map(x => [x.a.activityId, x.a.name, topWbs(x.a), d(x.a.baselineStart), d(x.s), signed(x.startVar), d(x.a.baselineFinish), d(x.f), signed(x.finishVar), open(x.a) ? x.a.totalFloat : 'done'])), '',
    '## 5. Change since the previous update',
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
    ...(w && w.windows.length ? [
      '', '## 6. Windows analysis', ...windowsMarkdown(w, d), '',
      '## 7. Driving-path float and execution trend', 'Finish-milestone total float (the driving path\'s float), lowest float, BEI and missed tasks (baseline finishes before each data date) per update.', '',
      ...trendMarkdown(w.trend, d),
    ] : []),
  ]
}

function qaqc(r: ReportInput): string[] {
  const fail = r.dcma.checks.filter(c => c.result === 'fail')
  return [
    '## 1. Score', `${r.dcma.passed} of ${r.dcma.applicable} applicable DCMA 14-point checks pass (score ${r.dcma.score}). Checks that cannot be evaluated are marked n/a and excluded.`, '',
    '## 2. DCMA 14-point results', table(['#', 'Check', 'Metric', 'Threshold', 'Result'], r.dcma.checks.map(c => [c.id, c.name, c.metric, c.threshold, c.result.toUpperCase()])), '',
    '## 3. Findings and the activities involved',
    ...(fail.length ? fail.map(c => `- **#${c.id} ${c.name} (${c.metric}).** ${c.explanation}${c.offenders.length ? ` Activities (${c.offenders.length}): ${c.offenders.join(', ')}.` : ''}`) : ['_All applicable checks pass._']), '',
    '## 4. Mandatory constraints that overrule logic',
    r.analysis.violations.length ? table(['Activity', 'Type', 'Constraint date', 'Logic date', 'Work days hidden'], r.analysis.violations.map(v => [codeOf(r, v.id), v.type, d(v.constraintDate), d(v.logicDate), v.days])) : '_None._', '',
    '## 5. File vs Planora recalculation',
    r.analysis.recalc
      ? `${r.analysis.recalc.differing} of ${r.analysis.recalc.compared} open activities differ by more than 1 day in finish or total float.\n\n${table(['ID', 'Activity', 'File finish', 'Planora finish', 'File float', 'Planora float'], r.analysis.recalc.samples.map(x => [x.code, x.name, d(x.fileFinish), d(x.planoraFinish), x.fileFloat ?? '—', x.planoraFloat ?? '—']))}`
      : '_The file carried no calculated dates, so Planora scheduled it from logic; there is nothing to compare._', '',
    '## 6. Data questions for the scheduler',
    ...(r.dataQuestions?.length ? r.dataQuestions.slice(0, 30).map(q => `- (${q.severity}) ${q.question}${q.activityCodes?.length ? ` [${q.activityCodes.slice(0, 8).join(', ')}]` : ''}`) : ['_None._']), '',
    '## 7. Reviewer disposition',
    ...reviewMarkdown(r.review, { dcma: r.dcma.checks.map(c => ({ id: c.id, name: c.name, result: c.result })), questions: (r.dataQuestions ?? []).filter(q => q.id).map(q => ({ id: q.id!, question: q.question })) }),
  ]
}

/**
 * "Edits made in Planora": every change made to the uploaded schedule inside Planora, with who, when,
 * before/after and the reason, so a report never presents an edited network as the contractor's file.
 * Empty string when there are none.
 */
export function editsSection(edits: { label: string; before: string; after: string; reason: string; by: string; byName?: string | null; at: string; status: 'applied' | 'skipped'; note?: string; source?: string }[],
  reverted: { reason: string; at: string; revertedAt: string | null; revertReason: string | null; change: { kind: string } }[] = [],
  /** false when the report is on the schedule as submitted: the edits are listed but not in its figures */
  inFigures = true): string {
  if (!edits.length && !reverted.length) return ''
  const applied = edits.filter(e => e.status === 'applied')
  const skipped = edits.filter(e => e.status === 'skipped')
  return fmtDates([
    '## Edits made in Planora',
    inFigures
      ? `The forecast, float and driving path in this report include ${applied.length} edit${applied.length === 1 ? '' : 's'} made in Planora to the uploaded file (a what-if scenario; the original file is unchanged and kept with its SHA-256).`
      : `This report is on the schedule as submitted: its forecast, float and driving path do NOT include the ${applied.length} edit${applied.length === 1 ? '' : 's'} made in Planora listed below (a what-if scenario; request the report on the scenario to include them).`, '',
    table(['Date', 'By', 'Change', 'Before', 'After', 'Reason', 'Source'], applied.map(e => [d(e.at), e.byName || e.by, e.label, e.before, e.after, e.reason, e.source === 'recovery' ? 'Recovery option' : 'Manual'])),
    ...(skipped.length ? ['', `${skipped.length} edit${skipped.length === 1 ? ' no longer applies' : 's no longer apply'}: ${skipped.map(e => `${e.label} (${e.note ?? 'not applicable'})`).join('; ')}.`] : []),
    ...(reverted.length ? ['', `${reverted.length} earlier edit${reverted.length === 1 ? ' was' : 's were'} reverted: ${reverted.map(e => `${e.change.kind.replace('_', ' ')} edit of ${d(e.at)} reverted ${d(e.revertedAt)}${e.revertReason ? ` (${e.revertReason})` : ''}`).join('; ')}.`] : []),
  ].join('\n'))
}

/**
 * The deterministic, evidence sections an AI-written report must still carry (appended to it):
 * provenance, and per type the windows / trend (variance), driving branches (critical path) and the
 * reviewer's dispositions (QA/QC).
 */
export function reportSupplement(type: string, r: ReportInput): string {
  const out: string[] = []
  if (type === 'variance' && r.windows?.windows.length) out.push('## Windows analysis (Planora calculation)', ...windowsMarkdown(r.windows, d), '', '## Driving-path float and execution trend', ...trendMarkdown(r.windows.trend, d), '')
  if (type === 'qa_qc') out.push('## Reviewer disposition', ...reviewMarkdown(r.review, { dcma: r.dcma.checks.map(c => ({ id: c.id, name: c.name, result: c.result })), questions: (r.dataQuestions ?? []).filter(q => q.id).map(q => ({ id: q.id!, question: q.question })) }), '')
  if (r.provenance) out.push(...provenanceMarkdown(r.provenance))
  return fmtDates(out.join('\n'))
}

export function buildReport(type: string, r: ReportInput): string {
  const t = (type in REPORT_TITLES ? type : 'executive_summary') as ReportType
  const body = t === 'critical_path' ? criticalPath(r) : t === 'variance' ? variance(r) : t === 'qa_qc' ? qaqc(r) : executiveSummary(r)
  // Analysis reasons, variance basis, comparisons and findings carry ISO dates; people read MM/DD/YYYY.
  return fmtDates([
    `# ${REPORT_TITLES[t]} — ${r.schedule.name} (${r.schedule.version})`, '',
    `_Prepared by Planora from the schedule data (no AI model). Data date ${d(r.schedule.dataDate)}. Dates MM/DD/YYYY; variances in calendar days (cd); float and durations in work days (wd)._`, '',
    ...(r.provenance ? provenanceMarkdown(r.provenance) : []),
    ...body,
  ].join('\n'))
}
