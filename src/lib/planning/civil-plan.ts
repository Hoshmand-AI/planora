// Civil and federal adjustments the generator applies to its network: quantity-based earthwork,
// the seasonal (winter shutdown) calendar for paving / striping / seeding, the in-water work window
// held as real date constraints, and federal-installation wording. Kept apart from generator.ts so
// the shared generator stays small; each function only touches civil or federal plans.

import type { Answer, Assumption, CpmResult, PlanActivity, ProjectProfile, WorkCalendar } from './types'
import { WINTER_SHUTDOWN, inWaterWindow } from './civil-options'
import { federalInstallationTri } from '@/lib/knowledge/applicability'

export const SEASON_CAL = 'cal-season'
/** Typical spread production for mass excavation / embankment, cubic yards per 8-hour day. */
export const EARTHWORK_CY_PER_DAY = 1500

const known = (answers: Record<string, Answer>, id: string) => (answers[id]?.status === 'known' ? answers[id].value : undefined)
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)) ? Number(v) : undefined)

/** Earthwork sized from the quantity answer instead of construction value (highway, aviation). */
export function applyEarthworkQuantity(acts: Map<string, PlanActivity>, answers: Record<string, Answer>, profile: ProjectProfile, hoursFactor: number): void {
  if (profile.projectType !== 'highway_bridge' && profile.projectType !== 'aviation') return
  const cy = num(known(answers, 'civil.earthwork_cy'))
  const a = acts.get('t-earthwork')
  if (!a || !cy || cy <= 0) return
  const days = Math.min(400, Math.max(5, Math.ceil((cy / EARTHWORK_CY_PER_DAY) * hoursFactor)))
  a.duration = days
  a.rationale = {
    summary: `${days} work days = ${Math.round(cy).toLocaleString()} CY ÷ ${EARTHWORK_CY_PER_DAY.toLocaleString()} CY per day (one excavation / embankment spread)${hoursFactor !== 1 ? `, scaled ×${hoursFactor.toFixed(2)} for the work-day length` : ''}.`,
    sources: [{ kind: 'user', label: 'Earthwork quantity from interview' }, { kind: 'template', label: 'Typical spread production rate' }],
    confidence: 'medium',
    assumptions: ['Production varies with haul distance, material and spreads; add spreads to shorten.'],
  }
}

/** All dates from `from` to `to` (month-day, inclusive) in each year of the range. */
function seasonDates(fromMD: string, toMD: string, y0: number, y1: number): string[] {
  const out: string[] = []
  for (let y = y0; y <= y1; y++) {
    const start = Date.parse(`${y}-${fromMD}T00:00:00Z`)
    // A season that wraps the new year (Dec → Mar) ends in the next year.
    const end = Date.parse(`${fromMD > toMD ? y + 1 : y}-${toMD}T00:00:00Z`)
    for (let t = start; t <= end; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

/**
 * Paving, striping and seeding go on a seasonal calendar with no work days in the winter shutdown, so
 * the CPM cannot put them in winter (pilot finding: northern-state paving was scheduled in January).
 */
export function applySeasonalCalendar(acts: Map<string, PlanActivity>, calendars: WorkCalendar[], seasonalIds: Set<string>, field: WorkCalendar, notes: string[], assumptions: Assumption[]): void {
  if (!seasonalIds.size) return
  const base = (id: string) => id.replace(/#\d+$/, '')
  const affected = [...acts.values()].filter(a => seasonalIds.has(base(a.id)))
  if (!affected.length) return
  const y0 = Number((field.holidays[0] || '2026-01-01').slice(0, 4)) - 1
  const holidays = [...new Set([...field.holidays, ...seasonDates(WINTER_SHUTDOWN.from, WINTER_SHUTDOWN.to, y0, y0 + 8)])].sort()
  calendars.push({
    id: SEASON_CAL, name: `Seasonal field work — no paving, striping or seeding ${WINTER_SHUTDOWN.label}`, workDays: field.workDays, hoursPerDay: field.hoursPerDay,
    holidays, canonical: `${field.canonical ?? 'field'} (seasonal)`,
  })
  for (const a of affected) {
    a.calendarId = SEASON_CAL
    a.rationale = { ...a.rationale, assumptions: [...(a.rationale.assumptions || []), `Seasonal work: no work days ${WINTER_SHUTDOWN.label} (winter shutdown).`] }
  }
  notes.push(`Winter shutdown: paving, pavement markings and seeding are on a seasonal calendar with no work days ${WINTER_SHUTDOWN.label}. Adjust the calendar to the agency's seasonal limits.`)
  assumptions.push({ questionId: 'civil.winter_shutdown', text: `Seasonal limits: ${affected.length} paving / striping / seeding activities cannot be worked ${WINTER_SHUTDOWN.label}.`, bufferDays: 0, kind: 'inferred' })
}

/**
 * The in-water work window as real constraints: the first in-water activity starts no earlier than the
 * window opens and the last must finish before it closes (finish-no-later-than), in the first season
 * whose window is still open when the work is ready. Work that cannot fit shows negative float.
 */
export function applyInWaterWindow(acts: Map<string, PlanActivity>, first: CpmResult, recompute: () => CpmResult, answers: Record<string, Answer>, notes: string[], assumptions: Assumption[]): CpmResult {
  const win = inWaterWindow(answers)
  // Window-limited in-water work (cofferdams, pile driving in water, cofferdam removal) says so in its
  // name; dewatering inside a cofferdam is not limited.
  const limited = [...acts.values()].filter(a => a.category === 'in_water_work' && a.type === 'task' && /window/i.test(a.name) && first.times[a.id])
  if (!limited.length) return first
  if (!win) {
    if (answers['civil.inwater_open'] || answers['civil.inwater_close']) {
      assumptions.push({ questionId: 'civil.inwater_open', text: 'In-water work window not given: in-water work is not restricted to a season — confirm the window in the permits.', bufferDays: 10, kind: 'unknown' })
    }
    return first
  }
  // One group per in-water activity (its split segments together): Stage 1 and Stage 2 cofferdams each
  // fall in their own season. Groups are placed in time order, re-running the CPM after each.
  const groups = new Map<string, PlanActivity[]>()
  for (const a of limited) {
    const key = a.id.replace(/#\d+$/, '')
    groups.set(key, [...(groups.get(key) ?? []), a])
  }
  const wraps = win.open > win.close
  const closeOf = (yr: number) => `${wraps ? yr + 1 : yr}-${win.close}`
  const f = (x: string) => `${x.slice(5, 7)}/${x.slice(8, 10)}/${x.slice(0, 4)}`
  let cpm = first
  const placed: string[] = []
  const order = [...groups.values()].sort((x, y) => (first.times[x[0].id].earlyStart).localeCompare(first.times[y[0].id].earlyStart))
  for (const g of order) {
    g.sort((x, y) => x.id.localeCompare(y.id, undefined, { numeric: true }))
    const head = g[0], tail = g[g.length - 1]
    const ready = cpm.times[head.id].earlyStart
    // The first season whose window has not closed by the time the work is ready.
    let y = Number(ready.slice(0, 4)) - (wraps ? 1 : 0)
    while (closeOf(y) < ready) y++
    const open = `${y}-${win.open}`, close = closeOf(y)
    // One activity holds one constraint: a single activity waits for the window if it is not open yet,
    // otherwise it is held to the closing date.
    if (open > ready) {
      head.constraint = { type: 'SNET', date: open }
      head.rationale = { ...head.rationale, assumptions: [...(head.rationale.assumptions || []), `In-water work window opens ${f(open)} (start no earlier than the window).`] }
    }
    if (tail.id !== head.id || open <= ready) {
      tail.constraint = { type: 'FNLT', date: close }
      tail.rationale = { ...tail.rationale, assumptions: [...(tail.rationale.assumptions || []), `In-water work must finish before the window closes ${f(close)} (finish no later than).`] }
    }
    placed.push(`${head.name.replace(/ — Area \d+ of \d+$/, '')}: ${f(open)} – ${f(close)}`)
    cpm = recompute()
  }
  notes.push(`In-water work windows (${win.open.replace('-', '/')} – ${win.close.replace('-', '/')} each season): ${placed.join('; ')}. Negative float on these activities means the work does not fit its season; resequence it or plan for the next window.`)
  assumptions.push({ questionId: 'civil.inwater_open', text: `In-water work held to the permit window, each piece in the first season open when it is ready (${placed.length} window${placed.length > 1 ? 's' : ''}).`, bufferDays: 0, kind: 'inferred' })
  return cpm
}

/**
 * Federal installations: the government is the authority, so the final inspection is the government's
 * acceptance and turnover (DD Form 1354), not a local certificate of occupancy.
 */
export function applyFederalInstallation(acts: Map<string, PlanActivity>, profile: ProjectProfile, assumptions: Assumption[]): void {
  if (federalInstallationTri(profile) !== 'yes') return
  for (const a of acts.values()) {
    if (a.category !== 'inspections' || !a.id.startsWith('t-') || !/certificate of occupancy/i.test(a.name)) continue
    a.name = a.name.replace(/\s*&?\s*certificate of occupancy/i, '').replace(/\(building, /i, '(government QA, ') + ' & government acceptance / DD Form 1354 turnover'
    a.rationale = { ...a.rationale, assumptions: [...(a.rationale.assumptions || []), 'On a federal installation: no local building inspections or certificate of occupancy; the government accepts the facility (DD Form 1354).'] }
  }
  for (const a of acts.values()) {
    if (a.category === 'elevators' && a.id.startsWith('t-') && /state\/AHJ acceptance/.test(a.name)) a.name = a.name.replace('state/AHJ acceptance', 'acceptance inspection (QEI, per the installation)')
  }
  if (profile.projectType === 'federal_defense') {
    assumptions.push(
      { questionId: 'reg.us-ufc-4-010-06.applies', text: 'UFC 4-010-06: facility-related control systems (BAS, EMCS, access control) need RMF documentation and an authorization to connect before turnover; planned as its own activity ahead of substantial completion.', bufferDays: 0, kind: 'inferred' },
      { questionId: 'reg.us-baba.applies', text: 'Buy American / BABA: domestic-content certifications precede the first iron and steel; waivers, if needed, run 2–5+ months and are not in the plan.', bufferDays: 0, kind: 'inferred' },
    )
  }
}
