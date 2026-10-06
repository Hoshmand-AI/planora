// DCMA 14-Point Schedule Assessment.
//
// Population (unless a check says otherwise): incomplete, non-summary, non-LOE activities.
// "Incomplete" = no actualFinish, status !== 'complete' and percentComplete < 100.
// Total float: the stored totalFloat values are used; when NO activity carries a totalFloat and a
// projectStart (or dataDate) is available, float is computed with runCpm instead.
// Checks that cannot be evaluated (missing baselines, data date, etc.) are 'n/a' and are excluded
// from `applicable`; score = round(100 * passed / applicable), 0 when nothing is applicable.

import { CONSTRAINT_TYPES } from '@/lib/planning/types'
import type {
  AnalyzableActivity,
  AnalyzableSchedule,
  ConstraintType,
  CpmActivity,
  CpmInput,
  CpmResult,
  DcmaCheck,
  DcmaReport,
  WorkCalendar,
} from '@/lib/planning/types'
import { runCpm } from '@/lib/planning/cpm'
import { defaultCalendar, isValidDate, toDayNumber, workDaysBetween } from '@/lib/planning/calendar'
import { pickFinishCandidate } from '@/lib/analysis/finish-milestone'
import { fmtDate } from '@/lib/format'

export const HIGH_FLOAT_DAYS = 44
export const HIGH_DURATION_DAYS = 44
export const CP_TEST_DAYS = 600

/**
 * Thresholds an organization may tune to its own standard (Organization → Policies). Defaults are
 * the published DCMA 14-point values; every report states the threshold it was judged against.
 */
export interface DcmaRules {
  /** Checks 1, 3, 5, 6, 8, 11: maximum share of offending activities (%) */
  maxPct: number
  /** Check 4: minimum share of finish-to-start relationships (%) */
  minFsPct: number
  /** Check 6: total float above this many work days counts as high */
  highFloatDays: number
  /** Check 8: remaining duration above this many work days counts as high */
  highDurationDays: number
  /** Checks 13 and 14: minimum CPLI and BEI */
  indexTarget: number
}

export const DEFAULT_DCMA_RULES: DcmaRules = { maxPct: 5, minFsPct: 90, highFloatDays: HIGH_FLOAT_DAYS, highDurationDays: HIGH_DURATION_DAYS, indexTarget: 0.95 }

export function normalizeDcmaRules(raw: unknown): DcmaRules {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const n = (k: keyof DcmaRules, lo: number, hi: number, step = 1) => {
    const v = Number(r[k])
    return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v / step) / Math.round(1 / step))) : DEFAULT_DCMA_RULES[k]
  }
  return { maxPct: n('maxPct', 1, 25), minFsPct: n('minFsPct', 50, 100), highFloatDays: n('highFloatDays', 10, 260), highDurationDays: n('highDurationDays', 5, 260), indexTarget: n('indexTarget', 0.8, 1, 0.01) }
}
const HARD_CONSTRAINTS = new Set(['MSO', 'MFO', 'SO', 'FO', 'SNLT', 'FNLT'])
const CONSTRAINT_LABEL: Record<string, string> = {
  SNET: 'Start On or After', SNLT: 'Start On or Before', FNET: 'Finish On or After', FNLT: 'Finish On or Before',
  SO: 'Start On', FO: 'Finish On', MSO: 'Mandatory Start', MFO: 'Mandatory Finish',
}

export function isCompleteActivity(a: AnalyzableActivity): boolean {
  return !!a.actualFinish || a.status === 'complete' || (a.percentComplete ?? 0) >= 100
}

function isScheduled(a: AnalyzableActivity): boolean {
  return a.type !== 'summary' && a.type !== 'loe'
}

/** Normalise constraint strings like "Must Start On" / "CS_MSO" to a ConstraintType. */
export function normalizeConstraintType(t: string | null | undefined): ConstraintType | null {
  if (!t) return null
  const raw = t.toUpperCase().trim()
  // P6 XER codes: CS_MSO / CS_MEO are "Start On" / "Finish On", not the mandatory types.
  if (raw === 'CS_MSO') return 'SO'
  if (raw === 'CS_MEO') return 'FO'
  const u = raw.replace(/^CS_/, '')
  if ((CONSTRAINT_TYPES as readonly string[]).includes(u)) return u as ConstraintType
  const words: Record<string, ConstraintType> = {
    // Primavera P6 XER codes (CS_ prefix stripped)
    MANDSTART: 'MSO', MANDFIN: 'MFO', MANDFINISH: 'MFO', MEOA: 'FNET', MEOB: 'FNLT', MSOA: 'SNET', MSOB: 'SNLT', MEO: 'FO',
    'START ON': 'SO', 'FINISH ON': 'FO', 'MANDATORY START': 'MSO', 'MANDATORY FINISH': 'MFO',
    'START ON OR AFTER': 'SNET', 'START ON OR BEFORE': 'SNLT', 'FINISH ON OR AFTER': 'FNET', 'FINISH ON OR BEFORE': 'FNLT',
    'MUST START ON': 'MSO', 'MUST FINISH ON': 'MFO', 'START NO EARLIER THAN': 'SNET', 'START NO LATER THAN': 'SNLT',
    'FINISH NO EARLIER THAN': 'FNET', 'FINISH NO LATER THAN': 'FNLT',
  }
  return words[u] ?? null
}

/** Build a CPM input from an analyzable schedule (summary and LOE activities are dropped). */
export function scheduleToCpmInput(s: AnalyzableSchedule): CpmInput | null {
  const projectStart = s.projectStart || s.dataDate
  if (!isValidDate(projectStart)) return null
  const activities: CpmActivity[] = []
  const ids = new Set<string>()
  for (const a of s.activities) {
    if (!isScheduled(a)) continue
    ids.add(a.id)
    const ct = normalizeConstraintType(a.constraint?.type)
    activities.push({
      id: a.id,
      code: a.code,
      name: a.name,
      duration: a.duration,
      remaining: a.remaining,
      calendarId: a.calendarId ?? undefined,
      type: a.type === 'milestone' ? 'milestone' : 'task',
      constraint: ct && isValidDate(a.constraint?.date) ? { type: ct, date: a.constraint!.date! } : undefined,
      actualStart: a.actualStart ?? null,
      actualFinish: a.actualFinish ?? null,
    })
  }
  return {
    projectStart,
    dataDate: isValidDate(s.dataDate) ? s.dataDate : undefined,
    activities,
    links: s.links.filter((l) => ids.has(l.from) && ids.has(l.to)),
    calendars: s.calendars,
    defaultCalendarId: s.defaultCalendarId ?? undefined,
  }
}

function pct(n: number, d: number): string {
  return `${d === 0 ? '0.0' : ((100 * n) / d).toFixed(1)}%`
}

/** Every offender, de-duplicated (screens truncate with an accurate "and N more"). */
function cap(codes: string[]): string[] {
  return Array.from(new Set(codes))
}

/** Index shown to 2 decimals without rounding a failing value up to the threshold (0.9496 -> 0.94). */
function indexText(v: number, ok: boolean, target: number): string {
  const t = v.toFixed(2)
  return !ok && Number(t) >= target ? (Math.floor(v * 100) / 100).toFixed(2) : t
}

/**
 * Execution against the baseline as of the data date (DCMA #11 Missed Tasks and #14 BEI): work
 * baselined to finish strictly BEFORE the data date vs work actually finished. The data date is the
 * first day of the remaining work, so work baselined to finish on it is not yet due (DCMA guidance). Null when it cannot be measured
 * (no data date, no baselines, a fresh baseline, or nothing due yet).
 */
export function baselineExecution(activities: AnalyzableActivity[], dataDate: string | null | undefined): { due: number; missed: number; completed: number; bei: number; dueCodes: string[]; missedCodes: string[]; openDueCodes: string[] } | null {
  if (!isValidDate(dataDate)) return null
  const all = activities.filter(isScheduled)
  const withBaseline = all.filter((a) => isValidDate(a.baselineFinish))
  const firstBaseline = withBaseline.map((a) => (isValidDate(a.baselineStart) ? a.baselineStart! : a.baselineFinish!)).sort()[0]
  if (!firstBaseline || toDayNumber(dataDate) <= toDayNumber(firstBaseline)) return null
  const due = withBaseline.filter((a) => toDayNumber(a.baselineFinish!) < toDayNumber(dataDate))
  if (!due.length) return null
  const missed = due.filter((a) => !isValidDate(a.actualFinish) || toDayNumber(a.actualFinish) > toDayNumber(a.baselineFinish!))
  const completed = all.filter(isCompleteActivity).length
  return {
    due: due.length, missed: missed.length, completed, bei: completed / due.length,
    dueCodes: due.map((a) => a.code), missedCodes: missed.map((a) => a.code), openDueCodes: due.filter((a) => !isCompleteActivity(a)).map((a) => a.code),
  }
}

function plural(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`
}

export function runDcma(s: AnalyzableSchedule, rules: Partial<DcmaRules> = {}): DcmaReport {
  const R = normalizeDcmaRules(rules)
  const all = s.activities.filter(isScheduled)
  const byId = new Map(all.map((a) => [a.id, a]))
  const pop = all.filter((a) => !isCompleteActivity(a))
  const popIds = new Set(pop.map((a) => a.id))
  const dataDate = isValidDate(s.dataDate) ? s.dataDate : null
  const calById = new Map<string, WorkCalendar>(s.calendars.map((c) => [c.id, c]))
  const defaultCal = (s.defaultCalendarId && calById.get(s.defaultCalendarId)) || s.calendars[0] || defaultCalendar()

  // Links between real (non-summary, non-LOE) activities
  const links = s.links.filter((l) => byId.has(l.from) && byId.has(l.to))
  const hasPred = new Set(links.map((l) => l.to))
  const hasSucc = new Set(links.map((l) => l.from))

  // CPM (lazy)
  let cpmCache: CpmResult | null | undefined
  const cpm = (): CpmResult | null => {
    if (cpmCache !== undefined) return cpmCache
    const inp = scheduleToCpmInput(s)
    try {
      cpmCache = inp && inp.activities.length ? runCpm(inp) : null
    } catch {
      cpmCache = null
    }
    return cpmCache
  }
  const storedTf = all.some((a) => a.totalFloat !== null && a.totalFloat !== undefined)
  const tfOf = (a: AnalyzableActivity): number | null => {
    if (storedTf) return a.totalFloat ?? null
    return cpm()?.times[a.id]?.totalFloat ?? null
  }
  const efOf = (a: AnalyzableActivity): string | null =>
    (isValidDate(a.earlyFinish) ? a.earlyFinish : null) ?? cpm()?.times[a.id]?.earlyFinish ?? null

  const checks: DcmaCheck[] = []
  const add = (c: DcmaCheck) => checks.push(c)
  function na(id: number, name: string, threshold: string, why: string): DcmaCheck {
    return { id, name, metric: 'n/a', threshold, result: 'n/a', offenders: [], explanation: why }
  }

  /* 1. Logic */
  {
    const esOf = (a: AnalyzableActivity) => (isValidDate(a.earlyStart) ? a.earlyStart : null) ?? cpm()?.times[a.id]?.earlyStart ?? null
    const byStart = (a: AnalyzableActivity) => { const d = esOf(a); return d ? toDayNumber(d) : 0 }
    const byFinish = (a: AnalyzableActivity) => { const d = efOf(a); return d ? toDayNumber(d) : 0 }
    // Exempt the project's single start and single finish. They are chosen among ALL activities, so
    // once the start milestone (e.g. NTP) is complete no open dangling activity inherits its
    // exemption; the finish prefers a milestone, so a dangling last task is still reported.
    const allNoPred = all.filter((a) => !hasPred.has(a.id))
    const allNoSucc = all.filter((a) => !hasSucc.has(a.id))
    const exemptStart = allNoPred.length ? allNoPred.reduce((m, a) => (byStart(a) < byStart(m) ? a : m)) : null
    const finishPool = allNoSucc.some((a) => a.type === 'milestone') ? allNoSucc.filter((a) => a.type === 'milestone') : allNoSucc
    const exemptFinish = finishPool.length ? finishPool.reduce((m, a) => (byFinish(a) >= byFinish(m) ? a : m)) : null
    const offenders = pop.filter((a) => (!hasPred.has(a.id) && a !== exemptStart) || (!hasSucc.has(a.id) && a !== exemptFinish))
    if (!pop.length) add(na(1, 'Logic', `≤ ${R.maxPct}%`, 'There are no open activities to test for missing logic.'))
    else {
      const ok = offenders.length / pop.length <= R.maxPct / 100
      add({
        id: 1, name: 'Logic', metric: pct(offenders.length, pop.length), threshold: `≤ ${R.maxPct}%`, result: ok ? 'pass' : 'fail',
        offenders: cap(offenders.map((a) => a.code)),
        explanation: offenders.length === 0
          ? 'Every open activity has both a predecessor and a successor, so delays will flow through the network.'
          : `${plural(offenders.length, 'open activity', 'open activities')} ${offenders.length === 1 ? 'is' : 'are'} missing a predecessor or successor, so a slip there will not move the dates that depend on it.`,
      })
    }
  }

  /* 2-4: relationship checks on links into open activities */
  const openLinks = links.filter((l) => popIds.has(l.to))
  const codeOf = (id: string) => byId.get(id)?.code ?? id
  {
    const leads = openLinks.filter((l) => l.lag < 0)
    if (!openLinks.length) add(na(2, 'Leads', '0', 'There are no relationships into open activities to test for leads.'))
    else add({
      id: 2, name: 'Leads', metric: String(leads.length), threshold: '0', result: leads.length === 0 ? 'pass' : 'fail',
      offenders: cap(leads.map((l) => codeOf(l.to))),
      explanation: leads.length === 0
        ? 'No relationships use negative lag, so successors never start before their predecessors logically allow.'
        : `${plural(leads.length, 'relationship')} ${leads.length === 1 ? 'uses' : 'use'} a negative lag (lead), which hides overlap assumptions and distorts the critical path; model the overlap with SS/FF logic instead.`,
    })
    const lags = openLinks.filter((l) => l.lag > 0)
    if (!openLinks.length) add(na(3, 'Lags', `≤ ${R.maxPct}%`, 'There are no relationships into open activities to test for lags.'))
    else add({
      id: 3, name: 'Lags', metric: pct(lags.length, openLinks.length), threshold: `≤ ${R.maxPct}%`,
      result: lags.length / openLinks.length <= R.maxPct / 100 ? 'pass' : 'fail',
      offenders: cap(lags.map((l) => codeOf(l.to))),
      explanation: lags.length / openLinks.length <= R.maxPct / 100
        ? 'Lags are used sparingly, so waiting time is mostly shown as real activities.'
        : `${pct(lags.length, openLinks.length)} of relationships carry a positive lag; replace lags like cure time or review periods with explicit activities so they can be statused.`,
    })
    const fsCount = openLinks.filter((l) => l.type === 'FS').length
    if (!openLinks.length) add(na(4, 'Relationship types', `≥ ${R.minFsPct}% FS`, 'There are no relationships into open activities to test.'))
    else {
      const ok = fsCount / openLinks.length >= R.minFsPct / 100
      add({
        id: 4, name: 'Relationship types', metric: `${pct(fsCount, openLinks.length)} FS`, threshold: `≥ ${R.minFsPct}% FS`, result: ok ? 'pass' : 'fail',
        offenders: cap(openLinks.filter((l) => l.type !== 'FS').map((l) => codeOf(l.to))),
        explanation: ok
          ? 'Most logic is finish-to-start, which keeps the sequence easy to read and the critical path reliable.'
          : `Only ${pct(fsCount, openLinks.length)} of relationships are finish-to-start; heavy use of SS/FF/SF makes the critical path harder to trace and can hide gaps.`,
      })
    }
  }

  /* 5. Hard constraints */
  {
    const hard = pop.filter((a) => {
      const t = normalizeConstraintType(a.constraint?.type)
      return !!t && HARD_CONSTRAINTS.has(t)
    })
    if (!pop.length) add(na(5, 'Hard constraints', `≤ ${R.maxPct}%`, 'There are no open activities to test for constraints.'))
    else {
      const ok = hard.length / pop.length <= R.maxPct / 100
      add({
        id: 5, name: 'Hard constraints', metric: pct(hard.length, pop.length), threshold: `≤ ${R.maxPct}%`, result: ok ? 'pass' : 'fail',
        offenders: cap(hard.map((a) => a.code)),
        explanation: ok
          ? 'Few activities are pinned by hard constraints, so dates are driven by logic rather than typed in.'
          : `${plural(hard.length, 'activity', 'activities')} ${hard.length === 1 ? 'uses' : 'use'} a hard constraint (MSO/MFO/SNLT/FNLT) that overrides logic and can mask real float.`,
      })
    }
  }

  /* 6/7. Float */
  {
    const withTf = pop.map((a) => ({ a, tf: tfOf(a) })).filter((x): x is { a: AnalyzableActivity; tf: number } => x.tf !== null)
    if (!withTf.length) {
      add(na(6, 'High float', `≤ ${R.maxPct}% with TF > ${R.highFloatDays}d`, 'Total float is not available (no stored float and no project start to compute it).'))
      add(na(7, 'Negative float', '0', 'Total float is not available (no stored float and no project start to compute it).'))
    } else {
      const high = withTf.filter((x) => x.tf > R.highFloatDays)
      const okH = high.length / withTf.length <= R.maxPct / 100
      add({
        id: 6, name: 'High float', metric: pct(high.length, withTf.length), threshold: `≤ ${R.maxPct}% with TF > ${R.highFloatDays}d`, result: okH ? 'pass' : 'fail',
        offenders: cap(high.map((x) => x.a.code)),
        explanation: okH
          ? `Few activities have more than ${R.highFloatDays} days of float, which suggests the logic is reasonably complete.`
          : `${plural(high.length, 'activity', 'activities')} ${high.length === 1 ? 'has' : 'have'} more than ${R.highFloatDays} work days of float, usually a sign of missing successors or unrealistic logic.`,
      })
      const neg = withTf.filter((x) => x.tf < 0)
      add({
        id: 7, name: 'Negative float', metric: String(neg.length), threshold: '0', result: neg.length === 0 ? 'pass' : 'fail',
        offenders: cap(neg.map((x) => x.a.code)),
        explanation: neg.length === 0
          ? 'No activity has negative float, so the schedule currently supports its imposed dates.'
          : `${plural(neg.length, 'activity', 'activities')} ${neg.length === 1 ? 'has' : 'have'} negative float, meaning the current plan cannot meet a constraint or deadline without recovery.`,
      })
    }
  }

  /* 8. High duration */
  {
    const tasks = pop.filter((a) => a.type === 'task')
    const long = tasks.filter((a) => (a.remaining ?? a.duration) > R.highDurationDays)
    if (!tasks.length) add(na(8, 'High duration', `≤ ${R.maxPct}% with remaining > ${R.highDurationDays}d`, 'There are no open tasks to test for duration.'))
    else {
      const ok = long.length / tasks.length <= R.maxPct / 100
      add({
        id: 8, name: 'High duration', metric: pct(long.length, tasks.length), threshold: `≤ ${R.maxPct}% with remaining > ${R.highDurationDays}d`,
        result: ok ? 'pass' : 'fail', offenders: cap(long.map((a) => a.code)),
        explanation: ok
          ? `Open tasks are broken down finely enough (few exceed ${R.highDurationDays} work days) to status and manage.`
          : `${plural(long.length, 'task')} ${long.length === 1 ? 'runs' : 'run'} longer than ${R.highDurationDays} work days; break them into smaller pieces so progress and slips are visible.`,
      })
    }
  }

  /* 9. Invalid dates */
  if (!dataDate) add(na(9, 'Invalid dates', '0', 'No data date is set, so forecast and actual dates cannot be checked against it.'))
  else {
    const dd = toDayNumber(dataDate)
    const before = (d: string | null | undefined) => isValidDate(d) && toDayNumber(d) < dd
    const after = (d: string | null | undefined) => isValidDate(d) && toDayNumber(d) > dd
    const bad = all.filter((a) => {
      if (after(a.actualStart) || after(a.actualFinish)) return true
      if (isCompleteActivity(a)) return false
      return (!a.actualStart && before(a.earlyStart)) || before(a.earlyFinish)
    })
    add({
      id: 9, name: 'Invalid dates', metric: String(bad.length), threshold: '0', result: bad.length === 0 ? 'pass' : 'fail',
      offenders: cap(bad.map((a) => a.code)),
      explanation: bad.length === 0
        ? 'All actual dates are on or before the data date and all forecasts are on or after it.'
        : `${plural(bad.length, 'activity', 'activities')} ${bad.length === 1 ? 'has' : 'have'} actuals in the future or forecasts in the past relative to the ${fmtDate(dataDate)} data date, so the update was not statused correctly.`,
    })
  }

  /* 10. Resources */
  {
    const loaded = all.some((a) => a.resourceCount !== undefined)
    const tasks = pop.filter((a) => a.type === 'task' && a.duration > 0)
    if (!loaded || !tasks.length) add(na(10, 'Resources', '0 without resources', 'The schedule carries no resource data, so resource loading cannot be assessed.'))
    else {
      const none = tasks.filter((a) => a.resourceCount === 0)
      add({
        id: 10, name: 'Resources', metric: `${none.length} (${pct(none.length, tasks.length)})`, threshold: '0 without resources',
        result: none.length === 0 ? 'pass' : 'fail', offenders: cap(none.map((a) => a.code)),
        explanation: none.length === 0
          ? 'Every open task with duration has resources or cost assigned.'
          : `${plural(none.length, 'task')} with duration ${none.length === 1 ? 'has' : 'have'} no resources assigned, so labor and cost cannot be tied to the schedule for them.`,
      })
    }
  }

  /* 11. Missed tasks & 14. BEI */
  const withBaseline = all.filter((a) => isValidDate(a.baselineFinish))
  // A fresh baseline (data date on or before the first baselined start) has nothing due yet; a
  // start milestone baselined on the data date is not "missed".
  const firstBaseline = withBaseline.map((a) => (isValidDate(a.baselineStart) ? a.baselineStart! : a.baselineFinish!)).sort()[0]
  const freshBaseline = !!dataDate && !!firstBaseline && toDayNumber(dataDate) <= toDayNumber(firstBaseline)
  // Due = baselined to finish strictly before the data date (the data date itself is remaining time).
  const due = dataDate && !freshBaseline ? withBaseline.filter((a) => toDayNumber(a.baselineFinish!) < toDayNumber(dataDate)) : []
  if (!dataDate || !withBaseline.length || !due.length) {
    const why = !dataDate ? 'No data date is set.' : !withBaseline.length ? 'The schedule has no baseline dates.' : freshBaseline ? 'This is a fresh baseline: the data date is on or before the first baselined start, so nothing is due yet.' : 'No baselined work was due before the data date.'
    add(na(11, 'Missed tasks', `≤ ${R.maxPct}%`, `${why} Missed tasks cannot be measured.`))
  } else {
    const ex = baselineExecution(s.activities, dataDate)!
    const ok = ex.missed / due.length <= R.maxPct / 100
    add({
      id: 11, name: 'Missed tasks', metric: pct(ex.missed, due.length), threshold: `≤ ${R.maxPct}%`, result: ok ? 'pass' : 'fail',
      offenders: cap(ex.missedCodes),
      explanation: ok
        ? 'Work baselined to finish before the data date has essentially all finished on time.'
        : `${ex.missed} of ${due.length} activities baselined to finish before ${fmtDate(dataDate)} finished late or not at all, which shows the plan is not being met.`,
    })
  }

  /* 12. Critical path test */
  {
    const inp = scheduleToCpmInput(s)
    const base = cpm()
    const thr = `finish moves ${CP_TEST_DAYS}d`
    const tol = Math.max(2, Math.round(CP_TEST_DAYS * 0.02))
    // Mandatory constraints (MSO/MFO) on the driving path hold dates by typing them in, not by logic.
    const mandatory = (id: string) => {
      const a = inp?.activities.find((x) => x.id === id)
      return a && !a.actualFinish && (a.constraint?.type === 'MSO' || a.constraint?.type === 'MFO') ? a : null
    }
    // The longest path stops at a mandatory constraint; test the path logic alone would drive.
    const path = base?.logicLongestPath?.length ? base.logicLongestPath : (base?.longestPath ?? [])
    const pinnedOnPath = [...(base?.longestPathConstraint ? [base.longestPathConstraint.id] : []), ...path].filter((id, i, all) => all.indexOf(id) === i).map(mandatory).filter((a): a is CpmActivity => !!a)
    const pinnedAny = pinnedOnPath.length ? pinnedOnPath : (base?.violations ?? []).map((v) => mandatory(v.id)).filter((a): a is CpmActivity => !!a)
    const pinText = (list: CpmActivity[]) => list.slice(0, 3).map((a) => `${a.code} (${a.constraint!.type === 'MSO' ? 'Mandatory Start' : 'Mandatory Finish'} ${fmtDate(a.constraint!.date)})`).join(', ')
    let result: DcmaCheck | null = null
    if (inp && base && path.length) {
      // Test the longest path from its first open task that has a successor (adding time to a dangling
      // end activity would move the finish trivially and prove nothing).
      const withSucc = new Set(inp.links.map((l) => l.from))
      const openIds = new Set(inp.activities.filter((a) => !a.actualFinish && a.type === 'task' && withSucc.has(a.id)).map((a) => a.id))
      const targetId = path.find((id) => openIds.has(id))
      if (targetId) {
        const target = inp.activities.find((a) => a.id === targetId)!
        const bumped: CpmInput = {
          ...inp,
          activities: inp.activities.map((a) =>
            a.id === targetId
              ? { ...a, duration: a.duration + CP_TEST_DAYS, remaining: a.remaining === undefined ? undefined : a.remaining + CP_TEST_DAYS }
              : a,
          ),
        }
        try {
          const after = runCpm(bumped)
          const calOf = (id: string | undefined) => {
            const a = id ? inp.activities.find((x) => x.id === id) : undefined
            return (a?.calendarId && calById.get(a.calendarId)) || defaultCal
          }
          const cal = calOf(targetId)
          const endId = base.longestPath[base.longestPath.length - 1] ?? path[path.length - 1]
          // Counted in the target's work days, and in the finish activity's: seasonal shutdowns or other
          // nonwork periods that only one of the calendars has make the two counts differ.
          const delta = workDaysBetween(base.projectFinish, after.projectFinish, cal)
          const deltaAtFinish = workDaysBetween(base.projectFinish, after.projectFinish, calOf(endId))
          const within = (d: number) => Math.abs(d - CP_TEST_DAYS) <= tol
          // Continuity itself: after the delay the target still drives the same finish activity through
          // the longest path and the finish moved. Holds whatever nonwork periods the calendars add.
          const afterEnd = after.longestPath[after.longestPath.length - 1]
          const drives = after.longestPath.includes(targetId) && afterEnd === endId && toDayNumber(after.projectFinish) > toDayNumber(base.projectFinish)
          const ok = within(delta) || within(deltaAtFinish) || drives
          const calNote = !within(delta) && ok
            ? ` (${delta} work days on ${target.code}'s calendar${deltaAtFinish !== delta ? `, ${deltaAtFinish} on the finish activity's` : ''}: the calendars' nonwork periods, such as seasonal shutdowns, account for the difference, and ${target.code} still drives the finish)`
            : ''
          const moved = delta === CP_TEST_DAYS
            ? 'pushed the project finish by the same amount'
            : `pushed the project finish by ${delta} work days${calNote || ` (within the ${tol}-day allowance for holidays and calendar changes over that span)`}`
          // Where the delay stopped: the first activity after the target on the path whose finish moved
          // less than half as far (calendar days) as the target's, and the constraint on it, if any.
          const calShift = (id: string) => {
            const b = base.times[id], x = after.times[id]
            return b && x ? toDayNumber(x.earlyFinish) - toDayNumber(b.earlyFinish) : 0
          }
          const targetShift = calShift(targetId)
          const stopId = ok ? undefined : path.slice(path.indexOf(targetId) + 1).find((id) => calShift(id) < targetShift / 2)
          const stopAct = stopId ? inp.activities.find((x) => x.id === stopId) : undefined
          const stopText = stopAct
            ? stopAct.constraint
              ? `the delay stops at ${stopAct.code}, held by its ${CONSTRAINT_LABEL[stopAct.constraint.type] ?? stopAct.constraint.type} constraint ${fmtDate(stopAct.constraint.date)}`
              : `the delay stops at ${stopAct.code}, so the path is broken there by missing logic, a lag or a relationship type`
            : null
          const why = pinnedAny.length
            ? `the finish is held by a mandatory constraint on ${pinText(pinnedAny)}, so logic does not drive it`
            : stopText ?? 'the path is broken by a constraint, missing logic or a lag'
          result = {
            id: 12, name: 'Critical path test', metric: `+${delta}d finish for +${CP_TEST_DAYS}d on ${target.code}`,
            threshold: thr, result: ok ? 'pass' : 'fail', offenders: ok ? [] : cap([target.code, ...pinnedAny.map((a) => a.code), ...(stopAct && !pinnedAny.length ? [stopAct.code] : [])]),
            explanation: ok
              ? `Adding ${CP_TEST_DAYS} days to ${target.code}, the first open task on the longest path, ${moved}, so the driving path is continuous.`
              : `Adding ${CP_TEST_DAYS} days to ${target.code}, the first open task on the longest path, moved the finish by only ${delta} work days, so ${why}.`,
          }
        } catch {
          result = null
        }
      } else if (pinnedAny.length) {
        // Nothing upstream to lengthen: the driving path is only constraint-pinned activities.
        result = {
          id: 12, name: 'Critical path test', metric: 'path pinned by mandatory constraint', threshold: thr, result: 'fail',
          offenders: cap(pinnedAny.map((a) => a.code)),
          explanation: `The longest path is held by a mandatory constraint on ${pinText(pinnedAny)} rather than by logic, so no delay upstream can move the finish and the critical path cannot be tested. Replace the mandatory constraint with Finish On or Before (or a deadline) so the path is driven by logic.`,
        }
      }
    }
    add(result ?? na(12, 'Critical path test', thr, 'The longest path has no open task with a successor (or the schedule has no project start), so the test was not run.'))
  }

  /* 13. CPLI */
  {
    // CPLI = (critical path length remaining + finish milestone total float) / critical path length
    // remaining, measured at the contract (finish) milestone. Both terms are counted in work days on
    // that milestone's own calendar, so a 7-day calendar's float is never mixed with 5-day
    // durations. Float is the milestone's logic-driven forecast against its target: its finish
    // constraint, else the required finish, else its baseline. With no target the float (and the
    // index) would be a meaningless 1.00, so the check is n/a.
    const thr = `≥ ${R.indexTarget.toFixed(2)}`
    const res = cpm()
    const picked = pickFinishCandidate(
      all.map((a) => ({
        id: a.id, code: a.code, name: a.name, isMilestone: a.type === 'milestone', milestoneKind: a.milestoneKind ?? null,
        constraintType: normalizeConstraintType(a.constraint?.type) ?? null, hasSuccessor: hasSucc.has(a.id), finish: a.actualFinish ?? efOf(a), a,
      })),
      s.finishMilestoneId,
    )
    const fm = picked?.pick.a ?? null
    const violation = fm ? res?.violations.find((v) => v.id === fm.id) : undefined
    const forecast = fm ? (violation?.logicDate ?? efOf(fm)) : null
    const fmCal = (fm?.calendarId && calById.get(fm.calendarId)) || defaultCal
    const ct = normalizeConstraintType(fm?.constraint?.type)
    const target = fm && ct && (ct === 'MFO' || ct === 'FO' || ct === 'FNLT') && isValidDate(fm.constraint?.date)
      ? { date: fm.constraint!.date!, basis: `its ${ct} constraint date ${fmtDate(fm.constraint!.date)}` }
      : isValidDate(s.mustFinishBy)
        ? { date: s.mustFinishBy, basis: `the required finish ${fmtDate(s.mustFinishBy)}` }
        : fm && isValidDate(fm.baselineFinish)
          ? { date: fm.baselineFinish, basis: `its baseline finish ${fmtDate(fm.baselineFinish)}` }
          : null
    const label = fm ? `${fm.code} ${fm.name}` : ''
    const cpl = dataDate && forecast && isValidDate(forecast) ? workDaysBetween(dataDate, forecast, fmCal) : 0
    if (!fm) add(na(13, 'CPLI', thr, 'No finish milestone could be identified, so the critical path length index cannot be computed.'))
    else if (isCompleteActivity(fm)) add(na(13, 'CPLI', thr, `${label}, the finish milestone, is already complete, so there is no remaining critical path to measure.`))
    else if (!target) add(na(13, 'CPLI', thr, `${label}, the finish milestone, has no finish constraint, required finish or baseline date, so there is no target to measure its float against (CPLI would read a meaningless 1.00).`))
    else if (!dataDate || cpl <= 0) add(na(13, 'CPLI', thr, 'The data date or the finish milestone forecast is missing (or the forecast is not after the data date), so the critical path length index cannot be computed.'))
    else {
      const tf = workDaysBetween(forecast!, target.date, fmCal)
      const cpli = (cpl + tf) / cpl
      const ok = cpli >= R.indexTarget
      const shown = indexText(cpli, ok, R.indexTarget)
      const units = `work days on the ${fmCal.name} calendar`
      add({
        id: 13, name: 'CPLI', metric: shown, threshold: thr, result: ok ? 'pass' : 'fail',
        offenders: ok ? [] : [fm.code],
        explanation: !ok
          ? `${label} is forecast ${fmtDate(forecast)} with ${tf} ${units} of float to ${target.basis}, against ${cpl} remaining ${units} on the critical path (CPLI ${shown}), so the completion date is unlikely without recovery.`
          : tf < 0
            ? `CPLI ${shown} meets the ${R.indexTarget.toFixed(2)} threshold, but ${label} is forecast ${fmtDate(forecast)}, ${-tf} ${units} behind ${target.basis}, so it still needs that much recovery.`
            : `${label} is forecast ${fmtDate(forecast)} with ${tf} ${units} of float to ${target.basis}, against ${cpl} remaining ${units} on the critical path, so the completion date is realistically achievable.`,
      })
    }
  }

  /* 14. BEI */
  if (!dataDate || !withBaseline.length || !due.length) {
    add(na(14, 'BEI', `≥ ${R.indexTarget.toFixed(2)}`, freshBaseline ? 'This is a fresh baseline, so nothing is due yet and the baseline execution index does not apply.' : 'Without baselines due before the data date, the baseline execution index cannot be computed.'))
  } else {
    const ex = baselineExecution(s.activities, dataDate)!
    const { completed, bei } = ex
    const ok = bei >= R.indexTarget
    const shown = indexText(bei, ok, R.indexTarget)
    add({
      id: 14, name: 'BEI', metric: shown, threshold: `≥ ${R.indexTarget.toFixed(2)}`, result: ok ? 'pass' : 'fail',
      offenders: ok ? [] : cap(ex.openDueCodes),
      explanation: ok
        ? `${completed} activities are complete against ${due.length} baselined to finish before the data date, so the team is keeping pace with the plan.`
        : `Only ${completed} activities are complete against ${due.length} baselined to finish before the data date (BEI ${shown}), so work is falling behind the baseline.`,
    })
  }

  checks.sort((a, b) => a.id - b.id)
  const applicable = checks.filter((c) => c.result !== 'n/a').length
  const passed = checks.filter((c) => c.result === 'pass').length
  return { checks, passed, applicable, score: applicable ? Math.round((100 * passed) / applicable) : 0 }
}

