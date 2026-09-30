// Work-day date math on a WorkCalendar.
//
// All public dates are ISO 'yyyy-mm-dd' strings (anything after the first 10 chars, e.g. a time
// part, is ignored). Internally dates are UTC "day numbers" (days since 1970-01-01) so there are
// no timezone or DST bugs.
//
// Conventions
// - A date is a work day if it is listed in extraWorkDays, OR its weekday is in workDays and it is
//   not listed in holidays. (extraWorkDays win over holidays: they are explicit P6 exceptions.)
// - nextWorkDay / prevWorkDay are inclusive "snaps": they return the date itself if it is a work day.
// - addWorkDays(date, n): n > 0 returns the n-th work day strictly after `date`; n < 0 the |n|-th work
//   day strictly before; n = 0 returns `date` unchanged (callers snap first if they need a work day).
// - Activities are day-granular. An activity starting on work day S with duration d > 0 finishes on
//   the (d-1)-th work day after S (finish = last work day it occupies, inclusive).
//   Milestones (d = 0): finish == start.
// - workDaysBetween(a, b): the signed number of work days you move from a to b, i.e. the count of
//   work days in (a, b] when b >= a, and minus the count in (b, a] when b < a. For work days a, b:
//   addWorkDays(a, workDaysBetween(a, b)) === b.
//
// Degenerate calendars: a calendar with NO work weekdays is treated as a 7-day calendar (holidays
// still apply) rather than throwing; calendarWarnings() reports it so callers (CPM) can surface it.
// All searches are additionally capped (MAX_SCAN days) so a calendar whose every day is a holiday
// can never loop forever — that case throws a clear Error.

import type { WorkCalendar, Weekday } from '@/lib/planning/types'

const MS_PER_DAY = 86_400_000
/** Upper bound on consecutive non-work days we will scan before giving up (~27 years). */
const MAX_SCAN = 10_000

/* ─── Day-number conversion ───────────────────────────── */

const parseCache = new Map<string, number>()

/** ISO date -> UTC day number. Returns NaN for an unparseable date. */
export function toDayNumber(date: string): number {
  const key = date.length > 10 ? date.slice(0, 10) : date
  const hit = parseCache.get(key)
  if (hit !== undefined) return hit
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  let n = NaN
  if (m) {
    const y = +m[1], mo = +m[2], d = +m[3]
    const t = Date.UTC(y, mo - 1, d)
    const back = new Date(t)
    if (back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d) {
      n = Math.round(t / MS_PER_DAY)
    }
  }
  if (parseCache.size > 50_000) parseCache.clear()
  parseCache.set(key, n)
  return n
}

/** UTC day number -> ISO date. */
export function fromDayNumber(n: number): string {
  return new Date(n * MS_PER_DAY).toISOString().slice(0, 10)
}

export function isValidDate(date: string | null | undefined): date is string {
  return typeof date === 'string' && !Number.isNaN(toDayNumber(date))
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOfNumber(n: number): Weekday {
  return ((((n + 4) % 7) + 7) % 7) as Weekday // 1970-01-01 was a Thursday
}

export function weekdayOf(date: string): Weekday {
  return weekdayOfNumber(toDayNumber(date))
}

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

export function addCalendarDays(date: string, n: number): string {
  return fromDayNumber(toDayNumber(date) + n)
}

export function compareDates(a: string, b: string): number {
  return toDayNumber(a) - toDayNumber(b)
}

/* ─── Compiled calendars (fast path used by CPM) ─────── */

export interface CompiledCalendar {
  readonly cal: WorkCalendar
  /** Work weekdays actually used (all 7 when the calendar declared none). */
  readonly mask: readonly boolean[]
  readonly warnings: readonly string[]
  isWork(n: number): boolean
  /** Inclusive snap forward */
  next(n: number): number
  /** Inclusive snap backward */
  prev(n: number): number
  /** See addWorkDays */
  add(n: number, k: number): number
  /** Work days in [a, b] (0 when b < a) */
  countInclusive(a: number, b: number): number
}

const compiledCache = new WeakMap<WorkCalendar, CompiledCalendar>()

export function compileCalendar(cal: WorkCalendar): CompiledCalendar {
  const cached = compiledCache.get(cal)
  if (cached) return cached

  const warnings: string[] = []
  const mask = [false, false, false, false, false, false, false]
  for (const d of cal.workDays ?? []) if (Number.isInteger(d) && d >= 0 && d <= 6) mask[d] = true
  const workPerWeek = mask.filter(Boolean).length
  if (workPerWeek === 0) {
    for (let i = 0; i < 7; i++) mask[i] = true
    warnings.push(`Calendar '${cal.name || cal.id}' has no work days defined; treated as a 7-day calendar.`)
  }
  const weekCount = mask.filter(Boolean).length

  const holidays = new Set<number>()
  for (const h of cal.holidays ?? []) {
    const n = toDayNumber(h)
    if (!Number.isNaN(n)) holidays.add(n)
  }
  const extra = new Set<number>()
  for (const h of cal.extraWorkDays ?? []) {
    const n = toDayNumber(h)
    if (!Number.isNaN(n)) extra.add(n)
  }
  // Exceptions that change the weekly pattern, for fast counting.
  const removed: number[] = [] // weekly work days that are holidays
  const added: number[] = [] // non-weekly days that are extra work days
  holidays.forEach((h) => { if (mask[weekdayOfNumber(h)] && !extra.has(h)) removed.push(h) })
  extra.forEach((e) => { if (!mask[weekdayOfNumber(e)]) added.push(e) })

  const isWork = (n: number): boolean => {
    if (extra.has(n)) return true
    return mask[weekdayOfNumber(n)] && !holidays.has(n)
  }

  const fail = (n: number): never => {
    throw new Error(`Calendar '${cal.name || cal.id}': no work day found within ${MAX_SCAN} days of ${fromDayNumber(n)}`)
  }

  const next = (n: number): number => {
    for (let i = 0; i < MAX_SCAN; i++) if (isWork(n + i)) return n + i
    return fail(n)
  }
  const prev = (n: number): number => {
    for (let i = 0; i < MAX_SCAN; i++) if (isWork(n - i)) return n - i
    return fail(n)
  }
  const add = (n: number, k: number): number => {
    let cur = n
    if (k > 0) {
      // jump whole weeks when there are no exceptions in the way is not worth the complexity here;
      // durations are small. Linear scan with a guard.
      let left = k
      let scanned = 0
      while (left > 0) {
        cur++
        if (isWork(cur)) { left--; scanned = 0 } else if (++scanned > MAX_SCAN) fail(n)
      }
    } else if (k < 0) {
      let left = -k
      let scanned = 0
      while (left > 0) {
        cur--
        if (isWork(cur)) { left--; scanned = 0 } else if (++scanned > MAX_SCAN) fail(n)
      }
    }
    return cur
  }
  const countInclusive = (a: number, b: number): number => {
    if (b < a) return 0
    const days = b - a + 1
    const weeks = Math.floor(days / 7)
    let count = weeks * weekCount
    for (let i = a + weeks * 7; i <= b; i++) if (mask[weekdayOfNumber(i)]) count++
    for (const h of removed) if (h >= a && h <= b) count--
    for (const e of added) if (e >= a && e <= b) count++
    return count
  }

  const compiled: CompiledCalendar = { cal, mask, warnings, isWork, next, prev, add, countInclusive }
  compiledCache.set(cal, compiled)
  return compiled
}

/** Warnings about a calendar definition (e.g. no work days -> treated as 7-day). */
export function calendarWarnings(cal: WorkCalendar): string[] {
  return [...compileCalendar(cal).warnings]
}

function num(date: string): number {
  const n = toDayNumber(date)
  if (Number.isNaN(n)) throw new Error(`Invalid ISO date '${date}'`)
  return n
}

/* ─── Public string API ───────────────────────────────── */

export function isWorkDay(date: string, cal: WorkCalendar): boolean {
  return compileCalendar(cal).isWork(num(date))
}

export function isHoliday(date: string, cal: WorkCalendar): boolean {
  const d = date.slice(0, 10)
  return (cal.holidays ?? []).some((h) => h.slice(0, 10) === d) && !(cal.extraWorkDays ?? []).some((h) => h.slice(0, 10) === d)
}

export function nextWorkDay(date: string, cal: WorkCalendar): string {
  return fromDayNumber(compileCalendar(cal).next(num(date)))
}

export function prevWorkDay(date: string, cal: WorkCalendar): string {
  return fromDayNumber(compileCalendar(cal).prev(num(date)))
}

export function addWorkDays(date: string, n: number, cal: WorkCalendar): string {
  return fromDayNumber(compileCalendar(cal).add(num(date), Math.trunc(n)))
}

/** Finish (last occupied work day) of an activity starting on `start` (snapped forward) with duration d. */
export function finishFromStart(start: string, d: number, cal: WorkCalendar): string {
  const c = compileCalendar(cal)
  const s = c.next(num(start))
  return fromDayNumber(d > 0 ? c.add(s, Math.ceil(d) - 1) : s)
}

/** Start of an activity finishing on `finish` (snapped backward) with duration d. */
export function startFromFinish(finish: string, d: number, cal: WorkCalendar): string {
  const c = compileCalendar(cal)
  const f = c.prev(num(finish))
  return fromDayNumber(d > 0 ? c.add(f, -(Math.ceil(d) - 1)) : f)
}

/** Signed work days moved from a to b: count of work days in (a, b], negated when b < a. */
export function workDaysBetween(a: string, b: string, cal: WorkCalendar): number {
  const c = compileCalendar(cal)
  const x = num(a), y = num(b)
  if (y >= x) return c.countInclusive(x + 1, y)
  return -c.countInclusive(y + 1, x)
}

/** Work days in [start, finish]; 0 when finish < start. */
export function countWorkDaysInclusive(start: string, finish: string, cal: WorkCalendar): number {
  return compileCalendar(cal).countInclusive(num(start), num(finish))
}

export function defaultCalendar(): WorkCalendar {
  return {
    id: 'default-5d',
    name: 'Standard 5-Day',
    workDays: [1, 2, 3, 4, 5],
    hoursPerDay: 8,
    holidays: [],
    canonical: '5-day x 8h',
  }
}

/* ─── US federal holidays ─────────────────────────────── */

function nthWeekday(year: number, month: number, weekday: number, nth: number): number {
  const first = Math.round(Date.UTC(year, month - 1, 1) / MS_PER_DAY)
  const offset = (weekday - weekdayOfNumber(first) + 7) % 7
  return first + offset + (nth - 1) * 7
}

function lastWeekday(year: number, month: number, weekday: number): number {
  const last = Math.round(Date.UTC(year, month, 0) / MS_PER_DAY)
  const offset = (weekdayOfNumber(last) - weekday + 7) % 7
  return last - offset
}

function observed(n: number): number {
  const w = weekdayOfNumber(n)
  if (w === 6) return n - 1
  if (w === 0) return n + 1
  return n
}

/**
 * Observed US federal holiday dates that fall within calendar year `year` (5 U.S.C. 6103 / OPM
 * rules: Saturday holidays are observed Friday, Sunday holidays Monday). Note that when Jan 1 of
 * `year + 1` is a Saturday, its observed date (Dec 31 of `year`) is included here, and a Saturday
 * Jan 1 of `year` (observed in the prior year) is not. Juneteenth is included from 2021.
 */
export function usFederalHolidays(year: number): string[] {
  const fixed = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY)
  const list: number[] = [
    observed(fixed(year, 1, 1)),
    nthWeekday(year, 1, 1, 3), // MLK Day
    nthWeekday(year, 2, 1, 3), // Washington's Birthday
    lastWeekday(year, 5, 1), // Memorial Day
    ...(year >= 2021 ? [observed(fixed(year, 6, 19))] : []),
    observed(fixed(year, 7, 4)),
    nthWeekday(year, 9, 1, 1), // Labor Day
    nthWeekday(year, 10, 1, 2), // Columbus Day
    observed(fixed(year, 11, 11)),
    nthWeekday(year, 11, 4, 4), // Thanksgiving
    observed(fixed(year, 12, 25)),
    observed(fixed(year + 1, 1, 1)), // next New Year's may be observed Dec 31
  ]
  const lo = fixed(year, 1, 1), hi = fixed(year, 12, 31)
  return Array.from(new Set(list.filter((n) => n >= lo && n <= hi))).sort((a, b) => a - b).map(fromDayNumber)
}

/** Observed US federal holidays for every year in [fromYear, toYear]. */
export function usFederalHolidaysRange(fromYear: number, toYear: number): string[] {
  const out: string[] = []
  for (let y = fromYear; y <= toYear; y++) out.push(...usFederalHolidays(y))
  return out
}
