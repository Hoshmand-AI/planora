// Resource loading, histograms and over-allocation for a schedule's resource assignments.
//
// Loading: each assignment's units are spread evenly (P6's linear curve) over the work days of the
// activity's own calendar. Units already spent (actuals) fall between the actual start and the day
// before the data date (the actual finish once complete); units still to spend fall between the
// scheduled start of the remaining work (never before the data date) and the scheduled finish.
// Availability: a resource's maximum units per hour (P6 Max Units/Time, MS Project MaxUnits) times the
// hours per day of its calendar (the project's default calendar when it has none). A resource without
// a stated maximum is assumed to be one crew: the most units a single assignment uses per day. Every
// assumption is listed in the result. Material resources are not limited.
// Over-allocation: a day from the data date on where the demand exceeds what is available that day.
// Pure: no database access.

import type { WorkCalendar } from '@/lib/planning/types'
import type { ResourceData, ResourceKind, ScheduleResource } from '@/lib/planning/resource-types'
import { hasResourceData } from '@/lib/planning/resource-types'
import { compileCalendar, defaultCalendar, fromDayNumber, toDayNumber, weekdayOfNumber, type CompiledCalendar } from '@/lib/planning/calendar'

export type HistogramBucket = 'day' | 'week' | 'month'
export const HISTOGRAM_BUCKETS: readonly HistogramBucket[] = ['day', 'week', 'month']

/** An activity as resource loading needs it: progress, calendar and the scheduled dates of its remaining work. */
export interface LoadActivity {
  id: string
  code: string
  name: string
  isMilestone: boolean
  calendarId?: string | null
  status?: 'not_started' | 'in_progress' | 'complete'
  actualStart?: string | null
  actualFinish?: string | null
  /** Scheduled start and finish of the work still to do (CPM early dates) */
  start?: string | null
  finish?: string | null
}

export interface ResourceLoadInput {
  activities: LoadActivity[]
  calendars: WorkCalendar[]
  defaultCalendarId?: string | null
  dataDate?: string | null
  data: ResourceData | null | undefined
  /** What-if staffing: available units per work day by resource id (replaces the file's limit) */
  availability?: Record<string, number>
}

export type AvailabilitySource = 'file' | 'assumed_one_crew' | 'what_if' | 'unlimited'

/** One resource's loading by day (internal; shared with leveling). */
export interface ResourceLoad {
  resource: ScheduleResource
  /** Units available per work day of the resource; null = not limited (material) */
  availablePerDay: number | null
  availabilitySource: AvailabilitySource
  hoursPerDay: number
  /** The resource's own calendar when it has one */
  calendar: CompiledCalendar | null
  /** Day number → demand (units) */
  days: Map<number, { actual: number; remaining: number; by: Map<string, number> }>
  /** Units per work day of each remaining assignment, by activity id */
  rateByActivity: Map<string, number>
}

export interface Loading {
  resources: ResourceLoad[]
  /** Day number of the data date (NaN when there is none) */
  dataDay: number
  /** Project default calendar (availability days of resources without their own calendar) */
  defaultCal: CompiledCalendar
  assumptions: string[]
  unscheduled: string[]
}

const EPS = 1e-6
const r2 = (n: number) => Math.round(n * 100) / 100

/** Units of one assignment spread evenly over the work days of [from, to] (all on `from` when there are none). */
function spread(units: number, from: number, to: number, cal: CompiledCalendar, add: (day: number, units: number) => void) {
  if (!(units > 0) || !Number.isFinite(from)) return
  const end = Number.isFinite(to) && to >= from ? to : from
  const days: number[] = []
  for (let d = from; d <= end; d++) if (cal.isWork(d)) days.push(d)
  if (!days.length) { add(from, units); return }
  const each = units / days.length
  for (const d of days) add(d, each)
}

/** Build per-resource daily loading. */
export function buildLoading(input: ResourceLoadInput): Loading {
  const cals = input.calendars.length ? input.calendars : [defaultCalendar()]
  const calById = new Map(cals.map(c => [c.id, c]))
  const defCal = (input.defaultCalendarId && calById.get(input.defaultCalendarId)) || cals[0]
  const defaultCal = compileCalendar(defCal)
  const calOf = (id?: string | null) => compileCalendar((id && calById.get(id)) || defCal)
  const dataDay = input.dataDate ? toDayNumber(input.dataDate) : NaN
  const assumptions: string[] = []
  const unscheduled = new Set<string>()
  const data = input.data
  if (!hasResourceData(data)) return { resources: [], dataDay, defaultCal, assumptions, unscheduled: [] }

  const acts = new Map(input.activities.map(a => [a.id, a]))
  const loads = new Map<string, ResourceLoad>()
  for (const r of data.resources) {
    const rc = r.calendarId ? calById.get(r.calendarId) : undefined
    loads.set(r.id, {
      resource: r, availablePerDay: null, availabilitySource: 'unlimited', hoursPerDay: (rc || defCal).hoursPerDay || 8,
      calendar: rc ? compileCalendar(rc) : null, days: new Map(), rateByActivity: new Map(),
    })
  }
  const maxSingle = new Map<string, number>()
  for (const x of data.assignments) {
    const L = loads.get(x.resourceId)
    const a = acts.get(x.activityId)
    if (!L || !a || a.isMilestone) continue
    const cal = calOf(a.calendarId)
    const bucket = (day: number) => {
      let v = L.days.get(day)
      if (!v) { v = { actual: 0, remaining: 0, by: new Map() }; L.days.set(day, v) }
      return v
    }
    const addActual = (day: number, u: number) => { const v = bucket(day); v.actual += u; v.by.set(a.id, (v.by.get(a.id) || 0) + u) }
    const addRemaining = (day: number, u: number) => { const v = bucket(day); v.remaining += u; v.by.set(a.id, (v.by.get(a.id) || 0) + u) }
    const done = a.status === 'complete' || !!a.actualFinish
    const started = done || a.status === 'in_progress' || !!a.actualStart
    const aS = a.actualStart ? toDayNumber(a.actualStart) : NaN
    if (done) {
      const units = x.actualUnits > 0 ? x.actualUnits : x.budgetUnits
      const aF = a.actualFinish ? toDayNumber(a.actualFinish) : Number.isFinite(dataDay) ? dataDay - 1 : aS
      if (Number.isFinite(aS)) spread(units, aS, aF, cal, addActual)
      continue
    }
    if (started && x.actualUnits > 0 && Number.isFinite(aS)) {
      const to = Number.isFinite(dataDay) ? dataDay - 1 : aS
      spread(x.actualUnits, aS, Math.max(aS, to), cal, addActual)
    }
    const remaining = started ? x.remainingUnits : (x.remainingUnits > 0 ? x.remainingUnits : Math.max(0, x.budgetUnits - x.actualUnits))
    if (!(remaining > 0)) continue
    let s = a.start ? toDayNumber(a.start) : NaN
    const f = a.finish ? toDayNumber(a.finish) : NaN
    if (!Number.isFinite(s) || !Number.isFinite(f)) { unscheduled.add(a.code); continue }
    if (Number.isFinite(dataDay) && s < dataDay) s = dataDay
    const workDays = cal.countInclusive(s, Math.max(s, f)) || 1
    const rate = remaining / workDays
    L.rateByActivity.set(a.id, (L.rateByActivity.get(a.id) || 0) + rate)
    maxSingle.set(x.resourceId, Math.max(maxSingle.get(x.resourceId) || 0, L.rateByActivity.get(a.id)!))
    spread(remaining, s, Math.max(s, f), cal, addRemaining)
  }

  const assumedOneCrew: string[] = []
  for (const L of loads.values()) {
    const r = L.resource
    const override = input.availability?.[r.id]
    if (override !== undefined && Number.isFinite(override) && override >= 0) {
      L.availablePerDay = r2(override); L.availabilitySource = 'what_if'
    } else if (r.kind === 'material') {
      L.availablePerDay = null; L.availabilitySource = 'unlimited'
    } else if (r.maxUnitsPerHour && r.maxUnitsPerHour > 0) {
      L.availablePerDay = r2(r.maxUnitsPerHour * L.hoursPerDay); L.availabilitySource = 'file'
    } else {
      const one = maxSingle.get(r.id)
      if (one && one > 0) { L.availablePerDay = r2(one); L.availabilitySource = 'assumed_one_crew'; assumedOneCrew.push(r.code) }
    }
  }
  if (assumedOneCrew.length) assumptions.push(`No maximum units in the file for ${assumedOneCrew.length} resource${assumedOneCrew.length === 1 ? '' : 's'} (${assumedOneCrew.slice(0, 8).join(', ')}${assumedOneCrew.length > 8 ? ', …' : ''}): Planora assumed one crew each, i.e. the most units any single assignment uses per day. Set the real availability in the staffing what-if.`)
  if (data.resources.some(r => !r.calendarId || !calById.has(r.calendarId))) assumptions.push('Resources without a calendar of their own are available on the project default calendar\'s work days and on any day their activities\' calendars schedule work.')
  if (data.resources.some(r => r.kind === 'material')) assumptions.push('Material resources are shown but not limited, so they are never over-allocated.')
  assumptions.push('Units are spread evenly over each activity\'s work days (linear curve); actual units fall before the data date, remaining units from the data date on.')
  const resources = [...loads.values()].filter(L => data.assignments.some(x => x.resourceId === L.resource.id)).sort((a, b) => a.resource.code.localeCompare(b.resource.code) || a.resource.id.localeCompare(b.resource.id))
  return { resources, dataDay, defaultCal, assumptions, unscheduled: [...unscheduled].sort() }
}

/** Units available on a day: the resource's calendar decides; without one, default-calendar work days and any day with demand. */
export function availableOn(L: ResourceLoad, day: number, defaultCal: CompiledCalendar): number | null {
  if (L.availablePerDay === null) return null
  if (L.calendar) return L.calendar.isWork(day) ? L.availablePerDay : 0
  return defaultCal.isWork(day) || L.days.has(day) ? L.availablePerDay : 0
}

export const demandOn = (L: ResourceLoad, day: number) => { const v = L.days.get(day); return v ? v.actual + v.remaining : 0 }

/** True when the day is over-allocated (counted from the data date on). */
export function overOn(L: ResourceLoad, day: number, loading: Pick<Loading, 'dataDay' | 'defaultCal'>): boolean {
  if (Number.isFinite(loading.dataDay) && day < loading.dataDay) return false
  const avail = availableOn(L, day, loading.defaultCal)
  return avail !== null && demandOn(L, day) > avail + EPS
}

/* ─── Analysis output ─────────────────────────────────── */

export interface HistogramBar {
  start: string
  end: string
  /** Units demanded in the period */
  demand: number
  actual: number
  remaining: number
  /** Units available in the period (null = not limited) */
  available: number | null
  /** Highest one-day demand in the period */
  peakDaily: number
  /** Over-allocated days in the period (from the data date on) */
  overAllocatedDays: number
}

export interface ResourceSummary {
  id: string
  code: string
  name: string
  kind: ResourceKind
  unit: string
  availablePerDay: number | null
  availabilitySource: AvailabilitySource
  /** Units available per day as the file states it (before any what-if) */
  fileAvailablePerDay: number | null
  hoursPerDay: number
  peakPerDay: number
  peakDate: string | null
  totalUnits: number
  actualUnits: number
  remainingUnits: number
  assignments: number
  overAllocatedDays: number
  /** Present when requested (histogramFor) */
  histogram?: HistogramBar[]
}

export interface OverAllocationPeriod {
  resourceId: string
  resourceCode: string
  resourceName: string
  from: string
  to: string
  /** Over-allocated days in the period */
  days: number
  peakDemand: number
  available: number
  /** Highest demand above availability on one day */
  maxExcess: number
  /** Activities working on the resource in the period, most units per day first */
  activities: { id: string; code: string; name: string; unitsPerDay: number }[]
}

export interface ResourceAnalysis {
  state: 'ok' | 'no_resource_data'
  /** Why there is nothing to show (no_resource_data) */
  message?: string
  source?: ResourceData['source']
  bucket: HistogramBucket
  dataDate: string | null
  assumptions: string[]
  notes: string[]
  resources: ResourceSummary[]
  overAllocations: OverAllocationPeriod[]
  totals: { resources: number; assignments: number; units: number; overAllocatedResources: number; overAllocatedDays: number; periods: number }
  /** Activities with remaining units but no scheduled dates (not loaded) */
  unscheduled: string[]
}

export const NO_RESOURCE_MESSAGE = 'This schedule has no resource data: the file carries no resources or resource assignments (P6 RSRC / TASKRSRC, MS Project Resources / Assignments, or a spreadsheet resource column). Planora does not invent resources; load them in the source schedule and upload it again.'

const bucketStart = (day: number, bucket: HistogramBucket): number => {
  if (bucket === 'day') return day
  if (bucket === 'week') return day - ((weekdayOfNumber(day) + 6) % 7) // Monday
  const iso = fromDayNumber(day)
  return toDayNumber(`${iso.slice(0, 8)}01`)
}
const bucketEnd = (start: number, bucket: HistogramBucket): number => {
  if (bucket === 'day') return start
  if (bucket === 'week') return start + 6
  const iso = fromDayNumber(start)
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7)
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  return toDayNumber(next) - 1
}

/** Histogram of one resource's loading in day / week / month periods. */
export function histogramOf(L: ResourceLoad, loading: Pick<Loading, 'dataDay' | 'defaultCal'>, bucket: HistogramBucket): HistogramBar[] {
  const days = [...L.days.keys()].sort((a, b) => a - b)
  if (!days.length) return []
  const out: HistogramBar[] = []
  for (let s = bucketStart(days[0], bucket); s <= days[days.length - 1]; s = bucketEnd(s, bucket) + 1) {
    const e = bucketEnd(s, bucket)
    let demand = 0, actual = 0, remaining = 0, peak = 0, over = 0, avail: number | null = L.availablePerDay === null ? null : 0
    for (let d = s; d <= e; d++) {
      const v = L.days.get(d)
      if (v) { actual += v.actual; remaining += v.remaining; demand += v.actual + v.remaining; peak = Math.max(peak, v.actual + v.remaining) }
      const a = availableOn(L, d, loading.defaultCal)
      if (avail !== null && a !== null) avail += a
      if (overOn(L, d, loading)) over++
    }
    out.push({ start: fromDayNumber(s), end: fromDayNumber(e), demand: r2(demand), actual: r2(actual), remaining: r2(remaining), available: avail === null ? null : r2(avail), peakDaily: r2(peak), overAllocatedDays: over })
  }
  return out
}

/** Contiguous over-allocated periods of one resource (work days in between that are within the limit end a period). */
export function overAllocationPeriods(L: ResourceLoad, loading: Pick<Loading, 'dataDay' | 'defaultCal'>, names: Map<string, { code: string; name: string }>): OverAllocationPeriod[] {
  const days = [...L.days.keys()].sort((a, b) => a - b).filter(d => overOn(L, d, loading))
  const out: OverAllocationPeriod[] = []
  let run: number[] = []
  const flush = () => {
    if (!run.length) return
    const units = new Map<string, number>()
    let peak = 0, excess = 0
    for (const d of run) {
      const v = L.days.get(d)!
      const dem = v.actual + v.remaining
      peak = Math.max(peak, dem)
      excess = Math.max(excess, dem - (availableOn(L, d, loading.defaultCal) ?? 0))
      for (const [id, u] of v.by) units.set(id, Math.max(units.get(id) || 0, u))
    }
    out.push({
      resourceId: L.resource.id, resourceCode: L.resource.code, resourceName: L.resource.name,
      from: fromDayNumber(run[0]), to: fromDayNumber(run[run.length - 1]), days: run.length,
      peakDemand: r2(peak), available: L.availablePerDay ?? 0, maxExcess: r2(excess),
      activities: [...units.entries()].map(([id, u]) => ({ id, code: names.get(id)?.code ?? id, name: names.get(id)?.name ?? '', unitsPerDay: r2(u) }))
        .sort((a, b) => b.unitsPerDay - a.unitsPerDay || a.code.localeCompare(b.code)),
    })
    run = []
  }
  for (const d of days) {
    if (run.length) {
      const last = run[run.length - 1]
      let broken = false
      for (let g = last + 1; g < d; g++) {
        const a = availableOn(L, g, loading.defaultCal)
        if (a !== null && a > 0) { broken = true; break }
      }
      if (broken) flush()
    }
    run.push(d)
  }
  flush()
  return out
}

/**
 * Resource analysis: per-resource totals, peak vs available, histograms (for `histogramFor`
 * resources, or all when omitted) and over-allocated periods with the activities contributing.
 */
export function analyzeResources(input: ResourceLoadInput, opts: { bucket?: HistogramBucket; histogramFor?: string[] | 'all' } = {}): ResourceAnalysis {
  const bucket = opts.bucket ?? 'week'
  const dataDate = input.dataDate ?? null
  if (!hasResourceData(input.data)) {
    return { state: 'no_resource_data', message: NO_RESOURCE_MESSAGE, bucket, dataDate, assumptions: [], notes: (input.data as ResourceData | null | undefined)?.notes ?? [], resources: [], overAllocations: [], totals: { resources: 0, assignments: 0, units: 0, overAllocatedResources: 0, overAllocatedDays: 0, periods: 0 }, unscheduled: [] }
  }
  const loading = buildLoading(input)
  const fileLoading = input.availability && Object.keys(input.availability).length ? buildLoading({ ...input, availability: undefined }) : loading
  const fileAvail = new Map(fileLoading.resources.map(L => [L.resource.id, L.availablePerDay]))
  const names = new Map(input.activities.map(a => [a.id, { code: a.code, name: a.name }]))
  const want = opts.histogramFor ?? 'all'
  const resources: ResourceSummary[] = []
  const periods: OverAllocationPeriod[] = []
  let units = 0, overDays = 0
  for (const L of loading.resources) {
    let actual = 0, remaining = 0, peak = 0, peakDay = NaN, over = 0
    for (const [d, v] of L.days) {
      actual += v.actual; remaining += v.remaining
      const dem = v.actual + v.remaining
      if (dem > peak + EPS || (Math.abs(dem - peak) <= EPS && d < peakDay)) { peak = dem; peakDay = d }
      if (overOn(L, d, loading)) over++
    }
    units += actual + remaining
    overDays += over
    const p = overAllocationPeriods(L, loading, names)
    periods.push(...p)
    resources.push({
      id: L.resource.id, code: L.resource.code, name: L.resource.name, kind: L.resource.kind, unit: L.resource.unit || (L.resource.kind === 'material' ? 'units' : 'h'),
      availablePerDay: L.availablePerDay, availabilitySource: L.availabilitySource, fileAvailablePerDay: fileAvail.get(L.resource.id) ?? null, hoursPerDay: L.hoursPerDay,
      peakPerDay: r2(peak), peakDate: Number.isFinite(peakDay) ? fromDayNumber(peakDay) : null,
      totalUnits: r2(actual + remaining), actualUnits: r2(actual), remainingUnits: r2(remaining),
      assignments: input.data!.assignments.filter(x => x.resourceId === L.resource.id && names.has(x.activityId)).length,
      overAllocatedDays: over,
      ...(want === 'all' || want.includes(L.resource.id) ? { histogram: histogramOf(L, loading, bucket) } : {}),
    })
  }
  periods.sort((a, b) => a.from.localeCompare(b.from) || a.resourceCode.localeCompare(b.resourceCode))
  return {
    state: 'ok', source: input.data!.source, bucket, dataDate,
    assumptions: loading.assumptions, notes: input.data!.notes,
    resources, overAllocations: periods,
    totals: { resources: resources.length, assignments: resources.reduce((s, r) => s + r.assignments, 0), units: r2(units), overAllocatedResources: resources.filter(r => r.overAllocatedDays > 0).length, overAllocatedDays: overDays, periods: periods.length },
    unscheduled: loading.unscheduled,
  }
}
