// "The tool questions its own inputs": data-quality questions a senior scheduler would ask about
// an uploaded or generated schedule before trusting any analysis of it.
//
// Each DataQuestion has a stable id `${rule}:${code}` (links use `${rule}:${from}->${to}`,
// calendars `${rule}:${calendarId}`, duplicates `${rule}:${name}`). Per rule at most
// MAX_PER_RULE individual questions are emitted; the rest are rolled into one `${rule}:_more`
// question listing the remaining activity codes. Results are sorted error → warning → info,
// preserving rule order within a severity.

import type { AnalyzableActivity, AnalyzableSchedule, DataQuestion, Severity, WorkCalendar } from '@/lib/planning/types'
import {
  WEEKDAY_NAMES,
  compileCalendar,
  countWorkDaysInclusive,
  defaultCalendar,
  isValidDate,
  toDayNumber,
  weekdayOf,
  workDaysBetween,
} from '@/lib/planning/calendar'

export const MAX_PER_RULE = 20
export const LONG_DURATION_DAYS = 44
const STANDARD_HOURS = [8, 10]

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 }

function isComplete(a: AnalyzableActivity): boolean {
  return !!a.actualFinish || a.status === 'complete' || (a.percentComplete ?? 0) >= 100
}

function describeCalendar(cal: WorkCalendar): string {
  const n = compileCalendar(cal).mask.filter(Boolean).length
  return `${n}-day week`
}

function label(a: AnalyzableActivity): string {
  return `${a.code} '${a.name}'`
}

function prettyDate(d: string): string {
  return `${WEEKDAY_NAMES[weekdayOf(d)]} ${d.slice(0, 10)}`
}

type DateField = 'earlyStart' | 'earlyFinish' | 'actualStart' | 'actualFinish'
const FIELD_VERB: Record<DateField, string> = {
  actualStart: 'actually started on',
  actualFinish: 'actually finished on',
  earlyStart: 'scheduled to start on',
  earlyFinish: 'scheduled to finish on',
}

export function checkInputs(s: AnalyzableSchedule): DataQuestion[] {
  const out: DataQuestion[] = []
  const perRule = new Map<string, DataQuestion[]>()
  const overflow = new Map<string, { severity: Severity; codes: string[]; summary: (n: number) => string }>()
  const usedIds = new Set<string>()

  const push = (q: DataQuestion, summary?: (n: number) => string) => {
    const list = perRule.get(q.rule) ?? []
    perRule.set(q.rule, list)
    if (list.length >= MAX_PER_RULE && summary) {
      const o = overflow.get(q.rule) ?? { severity: q.severity, codes: [], summary }
      o.codes.push(...q.activityCodes)
      overflow.set(q.rule, o)
      return
    }
    let id = q.id
    for (let i = 2; usedIds.has(id); i++) id = `${q.id}#${i}`
    usedIds.add(id)
    const final = { ...q, id }
    list.push(final)
    out.push(final)
  }

  const calById = new Map<string, WorkCalendar>(s.calendars.map((c) => [c.id, c]))
  const defaultCal = (s.defaultCalendarId && calById.get(s.defaultCalendarId)) || s.calendars[0] || defaultCalendar()
  const calOf = (a: AnalyzableActivity) => (a.calendarId && calById.get(a.calendarId)) || defaultCal
  const byId = new Map<string, AnalyzableActivity>()
  for (const a of s.activities) if (!byId.has(a.id)) byId.set(a.id, a)
  const dataDate = isValidDate(s.dataDate) ? s.dataDate : null
  const dd = dataDate ? toDayNumber(dataDate) : NaN
  const real = s.activities.filter((a) => a.type !== 'summary')

  /* weekend_work / holiday_work */
  for (const a of real) {
    if (a.type === 'loe') continue
    const cal = calOf(a)
    const c = compileCalendar(cal)
    const holidays = new Set((cal.holidays ?? []).map((h) => h.slice(0, 10)))
    let weekend: { f: DateField; d: string } | null = null
    let holiday: { f: DateField; d: string } | null = null
    const fields: DateField[] = ['actualStart', 'actualFinish', 'earlyStart', 'earlyFinish']
    for (const f of fields) {
      const d = a[f]
      if (!isValidDate(d)) continue
      // forecast dates of in-progress/complete work are just echoes of actuals
      if ((f === 'earlyStart' && a.actualStart) || (f === 'earlyFinish' && a.actualFinish)) continue
      const n = toDayNumber(d)
      if (c.isWork(n)) continue
      if (holidays.has(d.slice(0, 10))) holiday = holiday ?? { f, d: d.slice(0, 10) }
      else weekend = weekend ?? { f, d: d.slice(0, 10) }
    }
    if (weekend) {
      push({
        id: `weekend_work:${a.code}`, severity: 'warning', rule: 'weekend_work', activityCodes: [a.code],
        question: `Calendar '${cal.name}' is a ${describeCalendar(cal)}, but activity ${label(a)} is ${FIELD_VERB[weekend.f]} ${prettyDate(weekend.d)} — is weekend work intentional?`,
        detail: `${weekend.f} ${weekend.d} is not a work day on calendar '${cal.name}' (${cal.id}). Either the activity needs a calendar that includes that day, or the date is wrong.`,
      }, (n) => `${n} more activities have dates on non-work days of their calendars — should they be on a different calendar?`)
    }
    if (holiday) {
      push({
        id: `holiday_work:${a.code}`, severity: 'warning', rule: 'holiday_work', activityCodes: [a.code],
        question: `Activity ${label(a)} is ${FIELD_VERB[holiday.f]} ${prettyDate(holiday.d)}, which is a holiday on calendar '${cal.name}' — is holiday work planned, or is the date wrong?`,
        detail: `${holiday.d} is listed as a holiday on calendar '${cal.name}' (${cal.id}).`,
      }, (n) => `${n} more activities have dates on calendar holidays — is holiday work planned?`)
    }
  }

  /* finish_before_start */
  for (const a of real) {
    const pairs: [string, string | null | undefined, string | null | undefined][] = [
      ['actual', a.actualStart, a.actualFinish],
      ['planned', a.earlyStart, a.earlyFinish],
    ]
    for (const [kind, st, fi] of pairs) {
      if (isValidDate(st) && isValidDate(fi) && toDayNumber(fi) < toDayNumber(st)) {
        push({
          id: `finish_before_start:${a.code}`, severity: 'error', rule: 'finish_before_start', activityCodes: [a.code],
          question: `Activity ${label(a)} has an ${kind} finish (${fi.slice(0, 10)}) before its ${kind} start (${st.slice(0, 10)}) — which date is correct?`,
          detail: `${kind === 'actual' ? 'Actual' : 'Early'} finish precedes start by ${toDayNumber(st) - toDayNumber(fi)} calendar day(s).`,
        }, (n) => `${n} more activities finish before they start — which dates are correct?`)
        break
      }
    }
  }

  /* actual_after_data_date / forecast_before_data_date */
  if (dataDate) {
    for (const a of real) {
      const future = (['actualStart', 'actualFinish'] as const).find((f) => isValidDate(a[f]) && toDayNumber(a[f]!) > dd)
      if (future) {
        push({
          id: `actual_after_data_date:${a.code}`, severity: 'error', rule: 'actual_after_data_date', activityCodes: [a.code],
          question: `Activity ${label(a)} has an ${future === 'actualStart' ? 'actual start' : 'actual finish'} of ${a[future]!.slice(0, 10)}, after the ${dataDate} data date — was this progress recorded in advance?`,
          detail: 'Actual dates cannot be in the future relative to the status date; the update may have been statused against the wrong data date.',
        }, (n) => `${n} more activities have actual dates after the data date — was progress recorded in advance?`)
      }
      if (isComplete(a) || a.type === 'loe') continue
      const past: DateField | undefined = !a.actualStart && isValidDate(a.earlyStart) && toDayNumber(a.earlyStart) < dd
        ? 'earlyStart'
        : isValidDate(a.earlyFinish) && toDayNumber(a.earlyFinish) < dd ? 'earlyFinish' : undefined
      if (past) {
        push({
          id: `forecast_before_data_date:${a.code}`, severity: 'error', rule: 'forecast_before_data_date', activityCodes: [a.code],
          question: `Activity ${label(a)} is incomplete but ${FIELD_VERB[past]} ${a[past]!.slice(0, 10)}, before the ${dataDate} data date — did it actually ${past === 'earlyStart' ? 'start' : 'finish'}, or does the forecast need to move out?`,
          detail: 'Remaining work must be forecast on or after the data date; the schedule may not have been recalculated after statusing.',
        }, (n) => `${n} more incomplete activities are forecast before the data date — was the schedule recalculated?`)
      }
    }
  }

  /* progress_without_actual_start / complete_without_actual_finish */
  for (const a of real) {
    const pct = a.percentComplete ?? 0
    if ((pct > 0 || a.status === 'in_progress' || a.status === 'complete') && !a.actualStart) {
      push({
        id: `progress_without_actual_start:${a.code}`, severity: 'warning', rule: 'progress_without_actual_start', activityCodes: [a.code],
        question: `Activity ${label(a)} shows progress (${a.status === 'complete' ? 'complete' : `${pct}% complete`}) but has no actual start — when did it start?`,
        detail: 'Without an actual start the schedule cannot tell earned progress from forecast.',
      }, (n) => `${n} more activities show progress without an actual start — when did they start?`)
    }
    if ((a.status === 'complete' || pct >= 100) && !a.actualFinish) {
      push({
        id: `complete_without_actual_finish:${a.code}`, severity: 'warning', rule: 'complete_without_actual_finish', activityCodes: [a.code],
        question: `Activity ${label(a)} is marked complete but has no actual finish — when did it finish?`,
        detail: 'Completed work needs an actual finish so successors and performance metrics (BEI, missed tasks) are correct.',
      }, (n) => `${n} more complete activities have no actual finish — when did they finish?`)
    }
  }

  /* zero_duration_task / milestone_with_duration / long_duration / duration_mismatch */
  for (const a of real) {
    if (a.type === 'task' && a.duration === 0 && !isComplete(a)) {
      push({
        id: `zero_duration_task:${a.code}`, severity: 'warning', rule: 'zero_duration_task', activityCodes: [a.code],
        question: `Activity ${label(a)} is a task with zero duration — should it be a milestone?`,
        detail: 'Zero-duration tasks behave inconsistently across tools; model events as start or finish milestones.',
      }, (n) => `${n} more tasks have zero duration — should they be milestones?`)
    }
    if (a.type === 'milestone' && a.duration > 0) {
      push({
        id: `milestone_with_duration:${a.code}`, severity: 'warning', rule: 'milestone_with_duration', activityCodes: [a.code],
        question: `Milestone ${label(a)} has a duration of ${a.duration} days — is it really a task, or should the duration be zero?`,
        detail: 'Milestones mark a point in time; a duration on a milestone is ignored by CPM and usually signals a mis-typed activity.',
      }, (n) => `${n} more milestones carry a duration — are they really tasks?`)
    }
    if (a.type === 'task' && !isComplete(a) && (a.remaining ?? a.duration) > LONG_DURATION_DAYS) {
      const d = a.remaining ?? a.duration
      push({
        id: `long_duration:${a.code}`, severity: 'info', rule: 'long_duration', activityCodes: [a.code],
        question: `Activity ${label(a)} has ${d} work days remaining — can it be broken into smaller, measurable pieces?`,
        detail: `Activities longer than ${LONG_DURATION_DAYS} work days are hard to status and hide slippage (DCMA check 8).`,
      }, (n) => `${n} more activities exceed ${LONG_DURATION_DAYS} work days — can they be broken down?`)
    }
    if (a.type === 'task' && !a.actualStart && a.duration > 0 && isValidDate(a.earlyStart) && isValidDate(a.earlyFinish)
      && toDayNumber(a.earlyFinish) >= toDayNumber(a.earlyStart)) {
      const cal = calOf(a)
      const span = countWorkDaysInclusive(a.earlyStart, a.earlyFinish, cal)
      if (Math.abs(span - a.duration) > 1) {
        push({
          id: `duration_mismatch:${a.code}`, severity: 'warning', rule: 'duration_mismatch', activityCodes: [a.code],
          question: `Activity ${label(a)} has a duration of ${a.duration} days, but its dates ${a.earlyStart.slice(0, 10)} → ${a.earlyFinish.slice(0, 10)} span ${span} work days on calendar '${cal.name}' — is the calendar or the duration wrong?`,
          detail: 'A mismatch usually means the activity was scheduled on a different calendar than the one assigned, or the dates were typed in.',
        }, (n) => `${n} more activities have dates that do not match their durations — are their calendars right?`)
      }
    }
  }

  /* dangling_link / out_of_sequence */
  for (const l of s.links) {
    const from = byId.get(l.from), to = byId.get(l.to)
    if (!from || !to) {
      const missing = [!from ? l.from : null, !to ? l.to : null].filter(Boolean).join(' and ')
      const codes = [from?.code, to?.code].filter((x): x is string => !!x)
      push({
        id: `dangling_link:${l.from}->${l.to}`, severity: 'error', rule: 'dangling_link', activityCodes: codes,
        question: `A ${l.type} relationship ${l.from} → ${l.to} points to ${missing}, which ${missing.includes(' and ') ? 'are' : 'is'} not in the schedule — was an activity deleted or left out of the export?`,
        detail: 'The relationship is ignored by CPM, so logic that depended on it is missing.',
      }, (n) => `${n} more relationships point to activities that are not in the schedule — was the export complete?`)
      continue
    }
    // Out-of-sequence progress: the successor's actual date is earlier than the relationship (with its
    // lag, in work days on the predecessor's calendar) allows — now (predecessor still open) or
    // historically (both actual dates recorded, in the wrong order).
    const lag = Math.max(0, Math.round(l.lag ?? 0))
    const wdFrom = (a: string, b: string) => (isValidDate(a) && isValidDate(b) ? workDaysBetween(a.slice(0, 10), b.slice(0, 10), calOf(from)) : 0)
    const lagText = lag ? ` + ${lag} wd lag` : ''
    const oos = (question: string) => push({
      id: `out_of_sequence:${to.code}`, severity: 'warning', rule: 'out_of_sequence', activityCodes: [to.code, from.code], question,
      detail: 'Out-of-sequence progress makes the remaining logic unreliable; fix the relationship or record the predecessor dates (P6 schedules it by Retained Logic or Progress Override).',
    }, (n) => `${n} more activities progressed out of sequence with their predecessors — is the logic still valid?`)
    if (l.type === 'FS' && to.actualStart && !from.actualFinish && !isComplete(from)) {
      oos(`Activity ${label(to)} has started (${to.actualStart.slice(0, 10)}) although its finish-to-start predecessor ${label(from)} has not finished — is the logic wrong, or did work proceed out of sequence?`)
    } else if (l.type === 'FS' && to.actualStart && from.actualFinish
      && (to.actualStart.slice(0, 10) < from.actualFinish.slice(0, 10) || wdFrom(from.actualFinish, to.actualStart) < lag)) {
      oos(`Activity ${label(to)} started ${to.actualStart.slice(0, 10)}, before its finish-to-start predecessor ${label(from)} allowed it (finished ${from.actualFinish.slice(0, 10)}${lagText}) — were the actual dates recorded correctly, or did work proceed out of sequence?`)
    } else if (l.type === 'SS' && to.actualStart && (!from.actualStart ? !isComplete(from) : to.actualStart.slice(0, 10) < from.actualStart.slice(0, 10) || wdFrom(from.actualStart, to.actualStart) < lag)) {
      oos(from.actualStart
        ? `Activity ${label(to)} started ${to.actualStart.slice(0, 10)}, earlier than its start-to-start predecessor ${label(from)} allows (started ${from.actualStart.slice(0, 10)}${lagText}) — is the lag wrong, or did work proceed out of sequence?`
        : `Activity ${label(to)} has started (${to.actualStart.slice(0, 10)}) although its start-to-start predecessor ${label(from)} has not started${lagText ? ` (lag ${lag} wd)` : ''} — is the logic wrong, or did work proceed out of sequence?`)
    } else if (l.type === 'FF' && to.actualFinish && (!from.actualFinish ? !isComplete(from) : to.actualFinish.slice(0, 10) < from.actualFinish.slice(0, 10) || wdFrom(from.actualFinish, to.actualFinish) < lag)) {
      oos(from.actualFinish
        ? `Activity ${label(to)} finished ${to.actualFinish.slice(0, 10)}, earlier than its finish-to-finish predecessor ${label(from)} allows (finished ${from.actualFinish.slice(0, 10)}${lagText}) — is the lag wrong, or did work proceed out of sequence?`
        : `Activity ${label(to)} has finished (${to.actualFinish.slice(0, 10)}) although its finish-to-finish predecessor ${label(from)} has not finished${lagText ? ` (lag ${lag} wd)` : ''} — is the logic wrong, or did work proceed out of sequence?`)
    }
  }

  /* calendar_mismatch_hours */
  for (const cal of s.calendars) {
    if (!STANDARD_HOURS.includes(cal.hoursPerDay)) {
      push({
        id: `calendar_mismatch_hours:${cal.id}`, severity: 'info', rule: 'calendar_mismatch_hours', activityCodes: [],
        question: `Calendar '${cal.name}' is set to ${cal.hoursPerDay} hours per day — is that intended, or were durations converted from hours with the wrong factor?`,
        detail: 'Most construction calendars use 8 or 10 hours per day; an unusual value often means imported durations were scaled incorrectly.',
      })
    }
  }

  /* duplicate_names */
  {
    const groups = new Map<string, AnalyzableActivity[]>()
    for (const a of real) {
      const key = a.name.trim().toLowerCase()
      if (!key) continue
      const g = groups.get(key) ?? []
      g.push(a)
      groups.set(key, g)
    }
    groups.forEach((g) => {
      if (g.length < 3) return
      push({
        id: `duplicate_names:${g[0].name.trim()}`, severity: 'info', rule: 'duplicate_names', activityCodes: g.map((a) => a.code).slice(0, 25),
        question: `${g.length} activities are all named '${g[0].name.trim()}' — can the names say where or what (area, level, trade) so they can be told apart?`,
        detail: `Codes: ${g.map((a) => a.code).slice(0, 10).join(', ')}${g.length > 10 ? ', …' : ''}.`,
      })
    })
  }

  /* overflow summaries */
  overflow.forEach((o, rule) => {
    const q: DataQuestion = {
      id: `${rule}:_more`, severity: o.severity, rule, activityCodes: o.codes.slice(0, 100),
      question: o.summary(o.codes.length),
      detail: `Codes: ${o.codes.slice(0, 15).join(', ')}${o.codes.length > 15 ? ', …' : ''}.`,
    }
    const list = perRule.get(rule)!
    // place right after the rule's last individual question
    const last = list[list.length - 1]
    out.splice(out.indexOf(last) + 1, 0, q)
  })

  return out
    .map((q, i) => ({ q, i }))
    .sort((x, y) => SEVERITY_ORDER[x.q.severity] - SEVERITY_ORDER[y.q.severity] || x.i - y.i)
    .map((x) => x.q)
}
