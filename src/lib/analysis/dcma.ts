// DCMA 14-Point Schedule Assessment.
//
// Population (unless a check says otherwise): incomplete, non-summary, non-LOE activities.
// "Incomplete" = no actualFinish, status !== 'complete' and percentComplete < 100.
// Total float: the stored totalFloat values are used; when NO activity carries a totalFloat and a
// projectStart (or dataDate) is available, float is computed with runCpm instead.
// Checks that cannot be evaluated (missing baselines, data date, etc.) are 'n/a' and are excluded
// from `applicable`; score = round(100 * passed / applicable), 0 when nothing is applicable.

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
const MAX_OFFENDERS = 25
const CONSTRAINT_TYPES: ConstraintType[] = ['SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO']
const HARD_CONSTRAINTS = new Set(['MSO', 'MFO', 'SNLT', 'FNLT'])

export function isCompleteActivity(a: AnalyzableActivity): boolean {
  return !!a.actualFinish || a.status === 'complete' || (a.percentComplete ?? 0) >= 100
}

function isScheduled(a: AnalyzableActivity): boolean {
  return a.type !== 'summary' && a.type !== 'loe'
}

/** Normalise constraint strings like "Must Start On" / "CS_MSO" to a ConstraintType. */
export function normalizeConstraintType(t: string | null | undefined): ConstraintType | null {
  if (!t) return null
  const u = t.toUpperCase().replace(/^CS_/, '')
  if ((CONSTRAINT_TYPES as string[]).includes(u)) return u as ConstraintType
  const words: Record<string, ConstraintType> = {
    // Primavera P6 XER codes (CS_ prefix stripped)
    MANDSTART: 'MSO', MANDFIN: 'MFO', MEOA: 'FNET', MEOB: 'FNLT', MSOA: 'SNET', MSOB: 'SNLT', MEO: 'MFO',
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

function cap(codes: string[]): string[] {
  return Array.from(new Set(codes)).slice(0, MAX_OFFENDERS)
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
    const noPred = pop.filter((a) => !hasPred.has(a.id))
    const noSucc = pop.filter((a) => !hasSucc.has(a.id))
    const esOf = (a: AnalyzableActivity) => (isValidDate(a.earlyStart) ? a.earlyStart : null) ?? cpm()?.times[a.id]?.earlyStart ?? null
    const byStart = (a: AnalyzableActivity) => { const d = esOf(a); return d ? toDayNumber(d) : 0 }
    const byFinish = (a: AnalyzableActivity) => { const d = efOf(a); return d ? toDayNumber(d) : 0 }
    // exempt the single project start (earliest) and the single project finish (latest)
    const exemptStart = noPred.length ? noPred.reduce((m, a) => (byStart(a) < byStart(m) ? a : m)) : null
    const exemptFinish = noSucc.length ? noSucc.reduce((m, a) => (byFinish(a) >= byFinish(m) ? a : m)) : null
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
        : `${plural(bad.length, 'activity', 'activities')} ${bad.length === 1 ? 'has' : 'have'} actuals in the future or forecasts in the past relative to the ${dataDate} data date, so the update was not statused correctly.`,
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
  const due = dataDate ? withBaseline.filter((a) => toDayNumber(a.baselineFinish!) <= toDayNumber(dataDate)) : []
  if (!dataDate || !withBaseline.length || !due.length) {
    const why = !dataDate ? 'No data date is set.' : !withBaseline.length ? 'The schedule has no baseline dates.' : 'No baselined work was due by the data date.'
    add(na(11, 'Missed tasks', `≤ ${R.maxPct}%`, `${why} Missed tasks cannot be measured.`))
  } else {
    const missed = due.filter((a) => !isValidDate(a.actualFinish) || toDayNumber(a.actualFinish) > toDayNumber(a.baselineFinish!))
    const ok = missed.length / due.length <= R.maxPct / 100
    add({
      id: 11, name: 'Missed tasks', metric: pct(missed.length, due.length), threshold: `≤ ${R.maxPct}%`, result: ok ? 'pass' : 'fail',
      offenders: cap(missed.map((a) => a.code)),
      explanation: ok
        ? 'Work baselined to finish by the data date has essentially all finished on time.'
        : `${missed.length} of ${due.length} activities baselined to finish by ${dataDate} finished late or not at all, which shows the plan is not being met.`,
    })
  }

  /* 12. Critical path test */
  {
    const inp = scheduleToCpmInput(s)
    const base = cpm()
    let result: DcmaCheck | null = null
    if (inp && base && base.criticalPath.length) {
      const openIds = new Set(inp.activities.filter((a) => !a.actualFinish && a.type === 'task').map((a) => a.id))
      const targetId = base.criticalPath.find((id) => openIds.has(id))
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
          const cal = (target.calendarId && calById.get(target.calendarId)) || defaultCal
          const delta = workDaysBetween(base.projectFinish, after.projectFinish, cal)
          // A 600-day shift moves work into different years, so holiday placement and 5-day/7-day
          // calendar transitions add a little noise; a broken path absorbs far more than 2%.
          const ok = Math.abs(delta - CP_TEST_DAYS) <= Math.max(2, Math.round(CP_TEST_DAYS * 0.02))
          result = {
            id: 12, name: 'Critical path test', metric: `+${delta}d finish for +${CP_TEST_DAYS}d on ${target.code}`,
            threshold: `finish moves ${CP_TEST_DAYS}d`, result: ok ? 'pass' : 'fail', offenders: ok ? [] : [target.code],
            explanation: ok
              ? `Adding ${CP_TEST_DAYS} days to critical activity ${target.code} pushed the project finish by the same amount, so the critical path is continuous.`
              : `Adding ${CP_TEST_DAYS} days to critical activity ${target.code} moved the finish by only ${delta} days, so the critical path is broken by a constraint, missing logic or a lag.`,
          }
        } catch {
          result = null
        }
      }
    }
    add(result ?? na(12, 'Critical path test', `finish moves ${CP_TEST_DAYS}d`, 'A critical path could not be computed (missing project start or no open critical work), so the test was not run.'))
  }

  /* 13. CPLI */
  {
    const openWithEf = pop.map((a) => ({ a, ef: efOf(a) })).filter((x): x is { a: AnalyzableActivity; ef: string } => !!x.ef && isValidDate(x.ef))
    const finishAct = openWithEf.length
      ? openWithEf.reduce((m, x) => (toDayNumber(x.ef) >= toDayNumber(m.ef) ? x : m))
      : null
    const projectFinish = (isValidDate(s.projectFinish) ? s.projectFinish : null) ?? finishAct?.ef ?? null
    const tf = finishAct ? tfOf(finishAct.a) : null
    const cpl = dataDate && projectFinish ? workDaysBetween(dataDate, projectFinish, defaultCal) : 0
    if (!dataDate || !projectFinish || tf === null || cpl <= 0) {
      add(na(13, 'CPLI', `≥ ${R.indexTarget.toFixed(2)}`, 'The data date, project finish or finish-activity float is missing, so the critical path length index cannot be computed.'))
    } else {
      const cpli = (cpl + tf) / cpl
      const ok = cpli >= R.indexTarget
      add({
        id: 13, name: 'CPLI', metric: cpli.toFixed(2), threshold: `≥ ${R.indexTarget.toFixed(2)}`, result: ok ? 'pass' : 'fail',
        offenders: ok ? [] : [finishAct!.a.code],
        explanation: ok
          ? `With ${cpl} work days left on the critical path and ${tf} days of float at the finish, the schedule is realistically achievable.`
          : `The finish has ${tf} days of float against ${cpl} remaining critical work days (CPLI ${cpli.toFixed(2)}), so the planned finish is unlikely without recovery.`,
      })
    }
  }

  /* 14. BEI */
  if (!dataDate || !withBaseline.length || !due.length) {
    add(na(14, 'BEI', `≥ ${R.indexTarget.toFixed(2)}`, 'Without baselines due by the data date, the baseline execution index cannot be computed.'))
  } else {
    const completed = all.filter(isCompleteActivity).length
    const bei = completed / due.length
    const ok = bei >= R.indexTarget
    add({
      id: 14, name: 'BEI', metric: bei.toFixed(2), threshold: `≥ ${R.indexTarget.toFixed(2)}`, result: ok ? 'pass' : 'fail',
      offenders: ok ? [] : cap(due.filter((a) => !isCompleteActivity(a)).map((a) => a.code)),
      explanation: ok
        ? `${completed} activities are complete against ${due.length} baselined to finish by the data date, so the team is keeping pace with the plan.`
        : `Only ${completed} activities are complete against ${due.length} baselined to finish by the data date (BEI ${bei.toFixed(2)}), so work is falling behind the baseline.`,
    })
  }

  checks.sort((a, b) => a.id - b.id)
  const applicable = checks.filter((c) => c.result !== 'n/a').length
  const passed = checks.filter((c) => c.result === 'pass').length
  return { checks, passed, applicable, score: applicable ? Math.round((100 * passed) / applicable) : 0 }
}

