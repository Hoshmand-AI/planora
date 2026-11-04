// Time ruler for the schedule Gantt: evenly spaced, calendar-aligned ticks across the chart span.
// Pure presentation. It never changes the span (filtering and zoom keep the same time scale).

import { fmtDate } from './format'

const DAY = 86_400_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export type AxisUnit = 'week' | 'month' | 'quarter' | 'year'
/** `lead` marks the partial period the span starts in (placed at the span's left edge, not on a boundary). */
export interface AxisTick { t: number; label: string; lead?: boolean }

// Approximate unit lengths in days, smallest first.
const UNITS: [AxisUnit, number][] = [['week', 7], ['month', 30.44], ['quarter', 91.31], ['year', 365.25]]

/** The finest unit that gives at most about `perScreen × zoom` ticks across the span. */
export function axisUnit(lo: number, hi: number, zoom = 1, perScreen = 10): AxisUnit {
  const days = Math.max(1, (hi - lo) / DAY)
  for (const [u, len] of UNITS) if (days / len <= perScreen * zoom) return u
  return 'year'
}

/** First instant of the unit containing t (UTC; weeks start on Monday). */
function floorTo(t: number, unit: AxisUnit): number {
  const d = new Date(t)
  const y = d.getUTCFullYear(), m = d.getUTCMonth()
  if (unit === 'week') {
    const day = Date.UTC(y, m, d.getUTCDate())
    return day - ((new Date(day).getUTCDay() + 6) % 7) * DAY
  }
  if (unit === 'month') return Date.UTC(y, m, 1)
  if (unit === 'quarter') return Date.UTC(y, m - (m % 3), 1)
  return Date.UTC(y, 0, 1)
}

function next(t: number, unit: AxisUnit): number {
  if (unit === 'week') return t + 7 * DAY
  const d = new Date(t)
  const step = unit === 'month' ? 1 : unit === 'quarter' ? 3 : 12
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + step, 1)
}

function label(t: number, unit: AxisUnit, withYear: boolean): string {
  const d = new Date(t)
  const y = d.getUTCFullYear(), m = d.getUTCMonth()
  if (unit === 'week') return fmtDate(new Date(t).toISOString())
  if (unit === 'month') return withYear ? `${MONTHS[m]} ${y}` : MONTHS[m]
  if (unit === 'quarter') return `Q${Math.floor(m / 3) + 1} ${y}`
  return String(y)
}

/**
 * Calendar-aligned ticks inside [lo, hi]. Month labels carry the year on the first tick and every January,
 * so the ruler stays readable without repeating the year on every label. When the span starts mid-period
 * (months and longer), a leading tick at `lo` names that period so the left edge is never unlabeled.
 */
export function axisTicks(lo: number, hi: number, zoom = 1): { unit: AxisUnit; ticks: AxisTick[] } {
  const unit = axisUnit(lo, hi, zoom)
  const ticks: AxisTick[] = []
  if (!(hi > lo)) return { unit, ticks }
  let t = floorTo(lo, unit)
  if (t < lo) {
    if (unit !== 'week') ticks.push({ t: lo, label: label(t, unit, true), lead: true })
    t = next(t, unit)
  }
  for (let guard = 0; t <= hi && guard < 600; guard++, t = next(t, unit)) {
    ticks.push({ t, label: label(t, unit, ticks.length === 0 || new Date(t).getUTCMonth() === 0) })
  }
  return { unit, ticks }
}
