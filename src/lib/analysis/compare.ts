// Update-to-update comparison of two uploads of the same project (e.g. Update 5 vs Update 6, or the
// baseline vs the current update). Activities are matched by activity ID (P6 task code / MSP ID),
// relationships by predecessor code + successor code + type, calendars by name. Pure, so it is unit tested.
//
// This is the evidence a monthly update review and a windows / time-impact analysis start from:
// what moved, what was added or deleted, which logic, durations, constraints and calendars changed,
// which actual dates were rewritten after the fact, and where float eroded.

import type { Activity, Relationship, Schedule } from '@/lib/db'
import type { CpmResult, WorkCalendar } from '@/lib/planning/types'
import { fmtDate } from '@/lib/format'

export interface CompareSide {
  schedule: Pick<Schedule, 'id' | 'name' | 'version' | 'dataDate'> & { forecastFinish: string | null; projectKey?: string | null }
  activities: Activity[]
  relationships: Relationship[]
  /** Activity ids on the longest path */
  longestPath?: string[]
  finishMilestone?: { code: string; forecastFinish: string | null } | null
  /** The schedule's calendars; activity calendars are compared by calendar name, not by internal id */
  calendars?: WorkCalendar[]
  defaultCalendarId?: string | null
  /** Mandatory constraints that overrule logic (ScheduleAnalysis.violations) */
  violations?: CpmResult['violations']
}

export interface ActivityChange {
  code: string
  name: string
  field: 'duration' | 'remaining' | 'start' | 'finish' | 'float' | 'constraint' | 'calendar' | 'actual_start' | 'actual_finish' | 'name' | 'baseline_finish'
  before: string | number | null
  after: string | number | null
  /** For dates: calendar days after - before; for numbers: after - before */
  delta: number | null
}

/** A change to a calendar's definition, matched by calendar name across the two updates. */
export interface CalendarChange {
  calendar: string
  field: 'added' | 'removed' | 'work_week' | 'hours_per_day' | 'holidays_added' | 'holidays_removed' | 'work_days_added' | 'work_days_removed'
  before: string | null
  after: string | null
}

export interface ScheduleComparison {
  before: { id: string; name: string; version: string; dataDate: string | null; forecastFinish: string | null }
  after: { id: string; name: string; version: string; dataDate: string | null; forecastFinish: string | null }
  /**
   * Calendar days the forecast finish moved (+ = later), measured on the same finish activity in both
   * updates when there is one (finishActivity); otherwise on the project forecast finish.
   */
  finishMovement: number | null
  /** Calendar days the project forecast finish moved, whichever activity finishes last */
  projectFinishMovement: number | null
  /** Activity whose finish finishMovement measures (null: project forecast finish) */
  finishActivity: string | null
  milestoneMovement: { code: string; before: string | null; after: string | null; delta: number | null } | null
  /** Mandatory finish constraint that holds the finish while logic would push it later */
  finishHeldBy: { code: string; constraintDate: string; logicDate: string; days: number } | null
  matched: number
  added: { code: string; name: string }[]
  deleted: { code: string; name: string }[]
  logicAdded: { pred: string; succ: string; type: string; lag: number }[]
  logicDeleted: { pred: string; succ: string; type: string; lag: number }[]
  lagChanged: { pred: string; succ: string; type: string; before: number; after: number }[]
  changes: ActivityChange[]
  calendarChanges: CalendarChange[]
  /** Actual dates that changed after they were first reported (should not happen) */
  actualsRewritten: ActivityChange[]
  /** Open activities whose total float dropped, largest drop first */
  floatErosion: { code: string; name: string; before: number; after: number; delta: number }[]
  /** left includes driving-path activities deleted in the later update (also listed in leftDeleted) */
  criticalPath: { entered: string[]; left: string[]; leftDeleted: string[] }
  progress: { started: string[]; finished: string[] }
  /** Problems with the pairing itself: different projects, reversed order, same data date */
  warnings: string[]
  summary: string[]
}

const DAY = 86_400_000
const calDays = (a: string | null | undefined, b: string | null | undefined) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / DAY) : null)
const work = (a: Activity) => a.activityType !== 'summary'
const relKey = (p: string, s: string, t: string) => `${p}→${s}|${t}`
const calKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ')
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const weekLabel = (c: WorkCalendar) => [...c.workDays].sort((x, y) => x - y).map(d => WD[d]).join(', ') || 'none'
const dateList = (ds: string[]) => (ds.length > 6 ? `${ds.slice(0, 6).map(d => fmtDate(d)).join(', ')} and ${ds.length - 6} more` : ds.map(d => fmtDate(d)).join(', '))

/** Compare the calendars of two updates by name (ids are renumbered by P6 exports and round trips). */
export function compareCalendars(before: WorkCalendar[], after: WorkCalendar[]): CalendarChange[] {
  const out: CalendarChange[] = []
  const bBy = new Map(before.map(c => [calKey(c.name), c]))
  const aBy = new Map(after.map(c => [calKey(c.name), c]))
  for (const [k, b] of bBy) {
    const a = aBy.get(k)
    if (!a) { out.push({ calendar: b.name, field: 'removed', before: `${weekLabel(b)} × ${b.hoursPerDay}h`, after: null }); continue }
    if (weekLabel(a) !== weekLabel(b)) out.push({ calendar: a.name, field: 'work_week', before: weekLabel(b), after: weekLabel(a) })
    if (Math.abs(a.hoursPerDay - b.hoursPerDay) > 0.01) out.push({ calendar: a.name, field: 'hours_per_day', before: String(b.hoursPerDay), after: String(a.hoursPerDay) })
    const diff = (x: string[] = [], y: string[] = []) => { const ys = new Set(y); return x.filter(d => !ys.has(d)).sort() }
    const hAdded = diff(a.holidays, b.holidays), hRemoved = diff(b.holidays, a.holidays)
    const wAdded = diff(a.extraWorkDays, b.extraWorkDays), wRemoved = diff(b.extraWorkDays, a.extraWorkDays)
    if (hAdded.length) out.push({ calendar: a.name, field: 'holidays_added', before: null, after: dateList(hAdded) })
    if (hRemoved.length) out.push({ calendar: a.name, field: 'holidays_removed', before: dateList(hRemoved), after: null })
    if (wAdded.length) out.push({ calendar: a.name, field: 'work_days_added', before: null, after: dateList(wAdded) })
    if (wRemoved.length) out.push({ calendar: a.name, field: 'work_days_removed', before: dateList(wRemoved), after: null })
  }
  for (const [k, a] of aBy) if (!bBy.has(k)) out.push({ calendar: a.name, field: 'added', before: null, after: `${weekLabel(a)} × ${a.hoursPerDay}h` })
  return out
}

const CAL_CHANGE_TEXT: Record<CalendarChange['field'], (c: CalendarChange) => string> = {
  added: c => `calendar "${c.calendar}" added (${c.after})`,
  removed: c => `calendar "${c.calendar}" removed (${c.before})`,
  work_week: c => `"${c.calendar}" work week ${c.before} → ${c.after}`,
  hours_per_day: c => `"${c.calendar}" hours per day ${c.before} → ${c.after}`,
  holidays_added: c => `"${c.calendar}" non-work days added: ${c.after}`,
  holidays_removed: c => `"${c.calendar}" non-work days removed: ${c.before}`,
  work_days_added: c => `"${c.calendar}" exception work days added: ${c.after}`,
  work_days_removed: c => `"${c.calendar}" exception work days removed: ${c.before}`,
}
export const describeCalendarChange = (c: CalendarChange) => CAL_CHANGE_TEXT[c.field](c)

export function compareSchedules(before: CompareSide, after: CompareSide): ScheduleComparison {
  const bActs = before.activities.filter(work)
  const aActs = after.activities.filter(work)
  const bByCode = new Map(bActs.map(a => [a.activityId, a]))
  const aByCode = new Map(aActs.map(a => [a.activityId, a]))
  const bCodeOf = new Map(before.activities.map(a => [a.id, a.activityId]))
  const aCodeOf = new Map(after.activities.map(a => [a.id, a.activityId]))

  // Calendars are identified by name: P6 renumbers clndr_id on export/import, so ids differ across
  // updates of the same project. Without calendar data, fall back to the id.
  const calName = (side: CompareSide, id: string | null | undefined): string | null => {
    const ref = id || side.defaultCalendarId || null
    if (!side.calendars?.length) return ref
    const c = side.calendars.find(x => x.id === ref)
    return c ? c.name : ref
  }

  const added = aActs.filter(a => !bByCode.has(a.activityId)).map(a => ({ code: a.activityId, name: a.name }))
  const deleted = bActs.filter(a => !aByCode.has(a.activityId)).map(a => ({ code: a.activityId, name: a.name }))

  const changes: ActivityChange[] = []
  const actualsRewritten: ActivityChange[] = []
  const floatErosion: ScheduleComparison['floatErosion'] = []
  const started: string[] = [], finished: string[] = []
  let matched = 0
  const push = (c: ActivityChange) => changes.push(c)
  for (const a of aActs) {
    const b = bByCode.get(a.activityId)
    if (!b) continue
    matched++
    const base = { code: a.activityId, name: a.name }
    if (Math.round(b.duration) !== Math.round(a.duration)) push({ ...base, field: 'duration', before: b.duration, after: a.duration, delta: Math.round(a.duration - b.duration) })
    if (a.status !== 'complete' && b.status !== 'complete' && Math.round(b.remainingDuration) !== Math.round(a.remainingDuration) && a.status === 'in_progress' && b.status === 'in_progress') {
      push({ ...base, field: 'remaining', before: b.remainingDuration, after: a.remainingDuration, delta: Math.round(a.remainingDuration - b.remainingDuration) })
    }
    const bs = b.actualStart || b.earlyStart, as = a.actualStart || a.earlyStart
    const ds = calDays(bs, as)
    if (ds) push({ ...base, field: 'start', before: bs, after: as, delta: ds })
    const bf = b.actualFinish || b.earlyFinish, af = a.actualFinish || a.earlyFinish
    const df = calDays(bf, af)
    if (df) push({ ...base, field: 'finish', before: bf, after: af, delta: df })
    if (b.name !== a.name) push({ ...base, field: 'name', before: b.name, after: a.name, delta: null })
    const bk = b.constraintType ? `${b.constraintType} ${b.constraintDate ?? ''}`.trim() : null
    const ak = a.constraintType ? `${a.constraintType} ${a.constraintDate ?? ''}`.trim() : null
    if (bk !== ak) push({ ...base, field: 'constraint', before: bk, after: ak, delta: null })
    const bc = calName(before, b.calendarId), ac = calName(after, a.calendarId)
    if ((bc === null ? null : calKey(bc)) !== (ac === null ? null : calKey(ac))) push({ ...base, field: 'calendar', before: bc, after: ac, delta: null })
    if (b.baselineFinish && a.baselineFinish && b.baselineFinish !== a.baselineFinish) push({ ...base, field: 'baseline_finish', before: b.baselineFinish, after: a.baselineFinish, delta: calDays(b.baselineFinish, a.baselineFinish) })
    // Actuals already reported should not change in a later update.
    if (b.actualStart && b.actualStart !== a.actualStart) actualsRewritten.push({ ...base, field: 'actual_start', before: b.actualStart, after: a.actualStart, delta: calDays(b.actualStart, a.actualStart) })
    if (b.actualFinish && b.actualFinish !== a.actualFinish) actualsRewritten.push({ ...base, field: 'actual_finish', before: b.actualFinish, after: a.actualFinish, delta: calDays(b.actualFinish, a.actualFinish) })
    if (!b.actualStart && a.actualStart) started.push(a.activityId)
    if (!b.actualFinish && a.actualFinish) finished.push(a.activityId)
    if (a.status !== 'complete' && b.status !== 'complete' && a.totalFloat < b.totalFloat) {
      floatErosion.push({ ...base, before: b.totalFloat, after: a.totalFloat, delta: a.totalFloat - b.totalFloat })
    }
  }
  floatErosion.sort((x, y) => x.delta - y.delta)
  const calendarChanges = before.calendars && after.calendars ? compareCalendars(before.calendars, after.calendars) : []

  const relMap = (rels: Relationship[], codeOf: Map<string, string>) => {
    const m = new Map<string, { pred: string; succ: string; type: string; lag: number }>()
    for (const r of rels) {
      const p = codeOf.get(r.predecessorId), s = codeOf.get(r.successorId)
      if (p && s) m.set(relKey(p, s, r.type), { pred: p, succ: s, type: r.type, lag: r.lag })
    }
    return m
  }
  const bRel = relMap(before.relationships, bCodeOf)
  const aRel = relMap(after.relationships, aCodeOf)
  const logicAdded = [...aRel].filter(([k]) => !bRel.has(k)).map(([, v]) => v)
  const logicDeleted = [...bRel].filter(([k]) => !aRel.has(k)).map(([, v]) => v)
  const lagChanged = [...aRel].filter(([k, v]) => bRel.has(k) && bRel.get(k)!.lag !== v.lag).map(([, v]) => ({ pred: v.pred, succ: v.succ, type: v.type, before: bRel.get(relKey(v.pred, v.succ, v.type))!.lag, after: v.lag }))

  const pathCodes = (side: CompareSide, codeOf: Map<string, string>) => new Set((side.longestPath?.length ? side.longestPath : side.activities.filter(x => x.isCritical).map(x => x.id)).map(id => codeOf.get(id)).filter((c): c is string => !!c))
  const bPath = pathCodes(before, bCodeOf), aPath = pathCodes(after, aCodeOf)
  const entered = [...aPath].filter(c => !bPath.has(c))
  // A driving-path activity deleted in the later update has left the path too.
  const leftDeleted = [...bPath].filter(c => !aByCode.has(c) && bByCode.has(c))
  const left = [...bPath].filter(c => !aPath.has(c) && (!aByCode.has(c) ? bByCode.has(c) : aByCode.get(c)!.status !== 'complete'))

  // Finish movement is measured on the same finish activity in both updates, so a different activity
  // becoming the last one does not read as a slip or a gain.
  const projectFinishMovement = calDays(before.schedule.forecastFinish, after.schedule.forecastFinish)
  const finishOn = (side: CompareSide, byCode: Map<string, Activity>, code: string) =>
    side.finishMilestone?.code === code ? side.finishMilestone.forecastFinish : (byCode.get(code)?.actualFinish || byCode.get(code)?.earlyFinish || null)
  const fmCode = after.finishMilestone?.code ?? before.finishMilestone?.code ?? null
  let milestoneMovement: ScheduleComparison['milestoneMovement'] = null
  let finishActivity: string | null = null
  let finishMovement = projectFinishMovement
  if (fmCode) {
    const bd = finishOn(before, bByCode, fmCode), ad = finishOn(after, aByCode, fmCode)
    milestoneMovement = { code: fmCode, before: bd, after: ad, delta: calDays(bd, ad) }
    if (bd && ad) { finishActivity = fmCode; finishMovement = milestoneMovement.delta }
  }
  const finishChanged = !!(before.finishMilestone?.code && after.finishMilestone?.code && before.finishMilestone.code !== after.finishMilestone.code)

  // Did a mandatory finish hold the date while logic slipped?
  let finishHeldBy: ScheduleComparison['finishHeldBy'] = null
  if (finishMovement != null && finishMovement <= 0) {
    const mfo = (after.violations || []).filter(v => v.type === 'MFO' && v.days > 0)
    const onFinish = mfo.find(v => aCodeOf.get(v.id) === (finishActivity ?? fmCode))
    const v = onFinish ?? mfo.find(x => !after.schedule.forecastFinish || x.logicDate > after.schedule.forecastFinish) ?? null
    if (v) finishHeldBy = { code: aCodeOf.get(v.id) ?? v.id, constraintDate: v.constraintDate, logicDate: v.logicDate, days: v.days }
  }

  // Is this a sensible pair?
  const warnings: string[] = []
  const bk = before.schedule.projectKey?.trim().toLowerCase(), ak = after.schedule.projectKey?.trim().toLowerCase()
  if (bk && ak && bk !== ak) warnings.push(`These look like different projects ("${before.schedule.projectKey}" and "${after.schedule.projectKey}"); the comparison may not be meaningful.`)
  else if (bActs.length && aActs.length && matched === 0) warnings.push('The two schedules have no activity IDs in common, so they look like different projects; nothing could be matched.')
  if (before.schedule.dataDate && after.schedule.dataDate) {
    if (before.schedule.dataDate > after.schedule.dataDate) warnings.push(`The comparison is reversed: the base ${before.schedule.version} has a later data date (${fmtDate(before.schedule.dataDate)}) than ${after.schedule.version} (${fmtDate(after.schedule.dataDate)}). Swap them to read changes forward in time.`)
    else if (before.schedule.dataDate === after.schedule.dataDate) warnings.push(`Both updates have the same data date (${fmtDate(after.schedule.dataDate)}); this compares two versions of the same update, not two periods.`)
  }

  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`
  const days = (d: number) => `${Math.abs(d)} calendar ${Math.abs(d) === 1 ? 'day' : 'days'} ${d > 0 ? 'later' : 'earlier'}`
  const summary: string[] = [...warnings]
  if (finishChanged) summary.push(`The finish activity changed from ${before.finishMilestone!.code} to ${after.finishMilestone!.code}; finish movement is measured on ${finishActivity ?? 'the project forecast finish'}.`)
  if (finishMovement != null) {
    const what = finishActivity ? `The forecast finish (${finishActivity})` : 'The forecast finish'
    const bd = finishActivity ? milestoneMovement!.before : before.schedule.forecastFinish
    const ad = finishActivity ? milestoneMovement!.after : after.schedule.forecastFinish
    summary.push(finishMovement === 0 ? `${what} did not move.` : `${what} moved ${days(finishMovement)} (${fmtDate(bd)} → ${fmtDate(ad)}).`)
  }
  if (finishActivity && projectFinishMovement != null && projectFinishMovement !== finishMovement) summary.push(`The latest-finishing activity moved ${projectFinishMovement === 0 ? '0 days' : days(projectFinishMovement)} (${fmtDate(before.schedule.forecastFinish)} → ${fmtDate(after.schedule.forecastFinish)}).`)
  if (finishHeldBy) summary.push(`The finish ${finishMovement === 0 ? 'did not move' : 'moved earlier'} only because a Mandatory Finish constraint on ${finishHeldBy.code} holds it at ${fmtDate(finishHeldBy.constraintDate)}; logic alone would finish it ${fmtDate(finishHeldBy.logicDate)}, ${n(finishHeldBy.days, 'work day')} later.`)
  summary.push(`${n(started.length, 'activity', 'activities')} started and ${finished.length} finished this period.`)
  if (added.length || deleted.length) summary.push(`${n(added.length, 'activity', 'activities')} added, ${deleted.length} deleted.`)
  if (logicAdded.length || logicDeleted.length || lagChanged.length) summary.push(`Logic: ${n(logicAdded.length, 'relationship')} added, ${logicDeleted.length} deleted, ${lagChanged.length} lag ${lagChanged.length === 1 ? 'change' : 'changes'}.`)
  const durCh = changes.filter(c => c.field === 'duration')
  if (durCh.length) summary.push(`${n(durCh.length, 'original duration')} changed.`)
  const startCh = changes.filter(c => c.field === 'start' && c.delta)
  if (startCh.length) {
    const later = startCh.filter(c => c.delta! > 0).length
    const big = [...startCh].sort((x, y) => Math.abs(y.delta!) - Math.abs(x.delta!))[0]
    summary.push(`${n(startCh.length, 'start date')} moved (${later} later, ${startCh.length - later} earlier); the largest is ${big.code}, ${days(big.delta!)}.`)
  }
  const cstrCh = changes.filter(c => c.field === 'constraint')
  if (cstrCh.length) summary.push(`${n(cstrCh.length, 'constraint')} added, removed or changed.`)
  const calCh = changes.filter(c => c.field === 'calendar')
  if (calCh.length) summary.push(`${n(calCh.length, 'activity', 'activities')} moved to a different calendar (e.g. ${calCh[0].code}: "${calCh[0].before}" → "${calCh[0].after}").`)
  if (calendarChanges.length) summary.push(`Calendar changes: ${calendarChanges.slice(0, 5).map(describeCalendarChange).join('; ')}${calendarChanges.length > 5 ? `; and ${calendarChanges.length - 5} more` : ''}.`)
  if (actualsRewritten.length) summary.push(`${n(actualsRewritten.length, 'previously reported actual date')} changed; actuals should not be rewritten in a later update.`)
  if (floatErosion.length) summary.push(`Float dropped on ${n(floatErosion.length, 'open activity', 'open activities')}; the largest drop is ${floatErosion[0].code} (${floatErosion[0].before} → ${floatErosion[0].after} work days).`)
  if (entered.length || left.length) summary.push(`Driving path: ${entered.length} joined, ${left.length} left${leftDeleted.length ? ` (${leftDeleted.join(', ')} deleted)` : ''}.`)

  return {
    before: { id: before.schedule.id, name: before.schedule.name, version: before.schedule.version, dataDate: before.schedule.dataDate, forecastFinish: before.schedule.forecastFinish },
    after: { id: after.schedule.id, name: after.schedule.name, version: after.schedule.version, dataDate: after.schedule.dataDate, forecastFinish: after.schedule.forecastFinish },
    finishMovement, projectFinishMovement, finishActivity, milestoneMovement, finishHeldBy, matched, added, deleted, logicAdded, logicDeleted, lagChanged, changes, calendarChanges, actualsRewritten,
    floatErosion, criticalPath: { entered, left, leftDeleted }, progress: { started, finished }, warnings, summary,
  }
}

/**
 * The default base for comparing `after`: the latest upload in its series with an EARLIER data date
 * (series ordered by data date, then upload time). A re-upload with the same data date is never the
 * default. Without data dates, the latest earlier upload is used.
 */
export function pickDefaultBase<T extends { id: string; dataDate: string | null; uploadedAt: string }>(series: T[], after: T): T | undefined {
  const others = series.filter(s => s.id !== after.id)
  // uploadedAt may arrive as a Date from the driver; compare as instants.
  const t = (s: T) => new Date(s.uploadedAt).getTime()
  if (after.dataDate) {
    const earlier = orderSeries(others.filter(s => s.dataDate && s.dataDate < after.dataDate!))
    return earlier[earlier.length - 1]
  }
  const earlier = others.filter(s => t(s) < t(after)).sort((x, y) => t(x) - t(y))
  return earlier[earlier.length - 1]
}

/** Order an update series by data date (no data date first), then upload time. */
export function orderSeries<T extends { dataDate: string | null; uploadedAt: string }>(series: T[]): T[] {
  return [...series].sort((x, y) => (x.dataDate === null ? (y.dataDate === null ? 0 : -1) : y.dataDate === null ? 1 : x.dataDate.localeCompare(y.dataDate)) || new Date(x.uploadedAt).getTime() - new Date(y.uploadedAt).getTime())
}
