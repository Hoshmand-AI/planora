// Validation of the scheduler's Monte Carlo inputs for an uploaded schedule (per-activity three-point
// ranges and discrete risk events), and how they are shown. Pure, so it is unit tested.

import { randomUUID as uuid } from 'crypto'
import type { Activity } from '@/lib/db'
import type { SraRange, SraRiskEvent } from './sra'
import { workKind } from './work-kind'

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN)

/** Validate risk inputs against the schedule's open tasks; activities by Planora id or activity code. */
export function parseRiskInputs(b: { ranges?: unknown; events?: unknown }, activities: Activity[]): { ranges: SraRange[]; events: SraRiskEvent[] } | { error: string } {
  const find = (v: unknown) => {
    const k = typeof v === 'string' ? v.trim() : ''
    return k ? activities.find(a => a.id === k) ?? activities.find(a => a.activityId === k) ?? activities.find(a => a.activityId?.toLowerCase() === k.toLowerCase()) : undefined
  }
  const openTask = (v: unknown, what: string): Activity | string => {
    const a = find(v)
    if (!a) return `${what}: no activity "${String(v ?? '')}" in this schedule.`
    if (a.activityType !== 'task') return `${what}: ${a.activityId} is not a task with a duration.`
    if (a.status === 'complete' || a.actualFinish) return `${what}: ${a.activityId} is complete.`
    return a
  }
  const rawRanges = Array.isArray(b.ranges) ? b.ranges : []
  const rawEvents = Array.isArray(b.events) ? b.events : []
  if (rawRanges.length > 500 || rawEvents.length > 100) return { error: 'Up to 500 activity ranges and 100 risk events per schedule.' }
  const ranges: SraRange[] = []
  const seen = new Set<string>()
  for (const [i, r] of rawRanges.entries()) {
    const x = (r || {}) as Record<string, unknown>
    const a = openTask(x.activityId, `Range ${i + 1}`)
    if (typeof a === 'string') return { error: a }
    if (seen.has(a.id)) return { error: `Range ${i + 1}: ${a.activityId} already has a range.` }
    const o = num(x.optimistic), m = num(x.mostLikely), p = num(x.pessimistic)
    if (![o, m, p].every(n => Number.isFinite(n) && n >= 0 && n <= 5000)) return { error: `Range ${i + 1} (${a.activityId}): optimistic, most likely and pessimistic must be work days between 0 and 5000.` }
    if (!(o <= m && m <= p) || p <= 0) return { error: `Range ${i + 1} (${a.activityId}): needs optimistic ≤ most likely ≤ pessimistic, with a pessimistic above 0.` }
    seen.add(a.id)
    ranges.push({ activityId: a.id, optimistic: Math.round(o * 10) / 10, mostLikely: Math.round(m * 10) / 10, pessimistic: Math.round(p * 10) / 10 })
  }
  const events: SraRiskEvent[] = []
  for (const [i, r] of rawEvents.entries()) {
    const x = (r || {}) as Record<string, unknown>
    const name = typeof x.name === 'string' ? x.name.trim().slice(0, 200) : ''
    if (!name) return { error: `Risk event ${i + 1}: give it a name (e.g. "Failed concrete inspection").` }
    const a = openTask(x.activityId, `Risk event ${i + 1} (${name})`)
    if (typeof a === 'string') return { error: a }
    const prob = num(x.probability), impact = num(x.impactDays)
    if (!Number.isFinite(prob) || prob <= 0 || prob > 1) return { error: `Risk event ${i + 1} (${name}): probability must be above 0 and at most 1 (e.g. 0.3 for 30%).` }
    if (!Number.isFinite(impact) || impact < 1 || impact > 1000) return { error: `Risk event ${i + 1} (${name}): impact must be 1 to 1000 work days.` }
    events.push({ id: typeof x.id === 'string' && x.id ? x.id.slice(0, 64) : uuid(), name, probability: Math.round(prob * 1000) / 1000, impactDays: Math.round(impact), activityId: a.id })
  }
  return { ranges, events }
}

/** Inputs with activity codes and names, plus how many open tasks get the name-based defaults. */
export function describeRiskInputs(ranges: SraRange[], events: SraRiskEvent[], activities: Activity[], updatedAt: string | null) {
  const byId = new Map(activities.map(a => [a.id, a]))
  const label = (id: string) => { const a = byId.get(id); return a ? { code: a.activityId, name: a.name } : { code: id, name: '(no longer in the schedule)' } }
  const open = activities.filter(a => a.activityType === 'task' && a.status !== 'complete' && !a.actualFinish)
  return {
    ranges: ranges.map(r => ({ ...r, ...label(r.activityId) })),
    events: events.map(e => ({ ...e, ...label(e.activityId) })),
    updatedAt,
    defaults: {
      procurement: open.filter(a => workKind(a.name, a.category) === 'procurement').length,
      cure: open.filter(a => workKind(a.name, a.category) === 'cure').length,
    },
  }
}
