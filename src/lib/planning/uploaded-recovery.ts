// What-if and recovery options for an UPLOADED schedule.
//
// The recovery engine for plans built in Planora (recovery.ts) works by re-answering interview
// questions and regenerating the plan (work week, delivery method, catalog lead times), which an
// uploaded P6 / MS Project network does not have. So uploads get their own generator, driven by the
// network itself: it walks the driving (longest) path and models the levers a scheduler would try —
// crash a driving field activity, overlap two driving activities (FS → SS with a lag), expedite a
// driving fabrication/delivery item — each recalculated with Planora's CPM on the real network
// (all calendars, lags, constraints and progress), showing the new finish and the float effect.
// Every option is a list of ordinary schedule edits, so applying it records edits with a reason.
// Shares the labor premium ranges with recovery.ts so the trade-offs read the same way.

import type { Activity, Relationship } from '@/lib/db'
import type { ProgressMode, WorkCalendar } from './types'
import { completeSchedule } from './complete-schedule'
import { applyScheduleEdits, remainingOf, type ScheduleEditChange } from './uploaded-edits'
import { workKind, type WorkKind } from './work-kind'
import { PREMIUM } from './recovery'

export interface NetworkInput {
  activities: Activity[]
  relationships: Relationship[]
  calendars: WorkCalendar[]
  defaultCalendarId: string | null
  projectStart: string | null
  dataDate: string | null
  mustFinishBy: string | null
  progressMode: ProgressMode
}

export interface NetworkOutcome {
  finish: string | null
  /** Lowest total float on open work (work days); null without logic */
  minFloat: number | null
  longestPath: string[]
  /** Early finish per activity id */
  earlyFinish: Record<string, string>
}

export interface UploadedRecoveryOption {
  id: string
  title: string
  description: string
  tradeoff: string
  changes: ScheduleEditChange[]
  /** Suggested reason for the edit(s) when the option is applied */
  reason: string
  newFinish: string
  /** Calendar days earlier than the current forecast (negative = later) */
  daysSaved: number
  minFloatBefore: number | null
  minFloatAfter: number | null
  /** null when there is no required finish to meet */
  meetsDate: boolean | null
}

export interface UploadedRecoveryPlan {
  finish: string
  required: string | null
  /** Calendar days the forecast is past the required finish (0 when on time or no date) */
  gapDays: number
  minFloat: number | null
  explanation: string[]
  drivers: { id: string; code: string; name: string; remaining: number; kind: WorkKind }[]
  options: UploadedRecoveryOption[]
}

const calDays = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
const us = (x: string) => `${x.slice(5, 7)}/${x.slice(8, 10)}/${x.slice(0, 4)}`

/** Recalculate the network with these changes applied (nothing is stored). */
export function evaluateNetwork(net: NetworkInput, changes: ScheduleEditChange[] = []): NetworkOutcome {
  const edited = changes.length
    ? applyScheduleEdits(net.activities, net.relationships, changes.map((change, i) => ({ id: `whatif-${i}`, change, reason: 'what-if', by: 'planora', at: '' })))
    : { activities: net.activities, relationships: net.relationships }
  const done = completeSchedule({
    activities: edited.activities, relationships: edited.relationships, calendars: net.calendars, defaultCalendarId: net.defaultCalendarId,
    projectStart: net.projectStart, projectFinish: null, dataDate: net.dataDate, mustFinishBy: net.mustFinishBy, progressMode: net.progressMode,
  })
  if (!done.cpm) return { finish: done.projectFinish, minFloat: null, longestPath: [], earlyFinish: {} }
  const open = done.activities.filter(a => a.activityType !== 'summary' && a.activityType !== 'loe' && a.status !== 'complete' && !a.actualFinish && done.cpm!.times[a.id])
  const minFloat = open.length ? Math.min(...open.map(a => done.cpm!.times[a.id].totalFloat)) : null
  return { finish: done.cpm.logicFinish, minFloat, longestPath: done.cpm.longestPath, earlyFinish: Object.fromEntries(Object.entries(done.cpm.times).map(([id, t]) => [id, t.earlyFinish])) }
}

export function uploadedRecoveryOptions(net: NetworkInput, opts: { maxOptions?: number } = {}): UploadedRecoveryPlan | null {
  const base = evaluateNetwork(net)
  if (!base.finish || !base.longestPath.length) return null
  const byId = new Map(net.activities.map(a => [a.id, a]))
  const kindOf = (a: Activity) => workKind(a.name, a.category)
  const openTask = (a: Activity | undefined): a is Activity => !!a && a.activityType === 'task' && a.status !== 'complete' && !a.actualFinish && remainingOf(a) > 0
  let path = base.longestPath.map(id => byId.get(id)).filter(openTask)
  // The P6 longest path stops at a date-pinned activity (e.g. a finish milestone held by a Finish On
  // constraint). Then follow the logic back from that activity: at each step the predecessor that
  // finishes latest, so the options still work on the chain that would drive it.
  if (!path.length) {
    const preds = new Map<string, string[]>()
    for (const r of net.relationships) preds.set(r.successorId, [...(preds.get(r.successorId) || []), r.predecessorId])
    const chain: string[] = []
    const seen = new Set<string>()
    let cur = base.longestPath[base.longestPath.length - 1]
    while (cur && !seen.has(cur) && chain.length < 500) {
      seen.add(cur); chain.unshift(cur)
      const ps = (preds.get(cur) || []).filter(id => base.earlyFinish[id] && byId.get(id) && byId.get(id)!.status !== 'complete')
      cur = ps.sort((a, b) => (base.earlyFinish[b] || '').localeCompare(base.earlyFinish[a] || ''))[0]
    }
    path = chain.map(id => byId.get(id)).filter(openTask)
  }
  const required = net.mustFinishBy || null
  const gapDays = required && base.finish > required ? calDays(required, base.finish) : 0

  const options: UploadedRecoveryOption[] = []
  const add = (o: Omit<UploadedRecoveryOption, 'newFinish' | 'daysSaved' | 'minFloatBefore' | 'minFloatAfter' | 'meetsDate'>) => {
    const r = evaluateNetwork(net, o.changes)
    if (!r.finish) return
    options.push({ ...o, newFinish: r.finish, daysSaved: calDays(r.finish, base.finish!), minFloatBefore: base.minFloat, minFloatAfter: r.minFloat, meetsDate: required ? r.finish <= required : null })
  }

  // 1. Crash the longest driving field activities, one at a time (add crews / a second shift).
  const field = path.filter(a => kindOf(a) === 'field' && remainingOf(a) >= 3)
  const longestField = [...field].sort((a, b) => remainingOf(b) - remainingOf(a)).slice(0, 3)
  for (const a of longestField) {
    const rem = remainingOf(a)
    const to = Math.max(1, Math.min(rem - 1, Math.round(rem * 0.8)))
    add({
      id: `crash-${a.id}`, title: `Crash ${a.activityId} ${a.name}: ${rem} → ${to} work days (−${rem - to})`,
      description: 'Add a crew or a second shift to this driving activity. Only the remaining duration changes.',
      tradeoff: `Labor premium of about ${Math.round(PREMIUM.crash.low * 100)}–${Math.round(PREMIUM.crash.high * 100)}% on this work from congestion and supervision; check crew and laydown space.`,
      changes: [{ kind: 'duration', activityId: a.id, remaining: to }],
      reason: `What-if: crash driving activity ${a.activityId} by adding crews (${rem} → ${to} work days)`,
    })
  }
  // 2. Crash all driving field work by 15% together.
  const crashAll = path.filter(a => kindOf(a) === 'field' && remainingOf(a) >= 5)
  if (crashAll.length > 1) {
    add({
      id: 'crash-path', title: `Crash ${crashAll.length} driving field activities by 15%`,
      description: `Shorten every driving field activity of 5+ work days: ${crashAll.slice(0, 5).map(a => a.activityId).join(', ')}${crashAll.length > 5 ? ', …' : ''}.`,
      tradeoff: 'Higher labor cost and supervision load across the driving path; returns diminish beyond 15–20%, and another path may take over (see the float effect).',
      changes: crashAll.map(a => ({ kind: 'duration' as const, activityId: a.id, remaining: Math.max(1, Math.round(remainingOf(a) * 0.85)) })),
      reason: 'What-if: compress driving field work by 15% (added crews / shifts)',
    })
  }
  // 3. Overlap consecutive driving activities: FS → SS with a lag of half the predecessor.
  const onPath = new Set(path.map(a => a.id))
  const fsOnPath = net.relationships.filter(r => r.type === 'FS' && onPath.has(r.predecessorId) && onPath.has(r.successorId))
    .map(r => ({ r, p: byId.get(r.predecessorId)!, s: byId.get(r.successorId)! }))
    .filter(x => x.p.status !== 'in_progress' && remainingOf(x.p) >= 4 && remainingOf(x.s) >= 2 && kindOf(x.p) === 'field' && kindOf(x.s) === 'field')
    .sort((a, b) => remainingOf(b.p) - remainingOf(a.p)).slice(0, 3)
  for (const { r, p, s } of fsOnPath) {
    const lag = Math.max(1, Math.ceil(remainingOf(p) / 2) + Math.max(0, r.lag))
    add({
      id: `overlap-${r.predecessorId}-${r.successorId}`, title: `Overlap ${p.activityId} → ${s.activityId}: FS → SS +${lag}d`,
      description: `Start ${s.activityId} ${s.name} when ${p.activityId} ${p.name} is about half done, instead of after it finishes (work by area or floor).`,
      tradeoff: `Needs a real work-area split and coordination of two trades in the same space. If ${s.activityId} cannot finish before ${p.activityId}, also add an FF relationship.`,
      changes: [{ kind: 'link_set', predecessorId: r.predecessorId, successorId: r.successorId, type: 'SS', lag }],
      reason: `What-if: overlap ${p.activityId} and ${s.activityId} (FS → SS +${lag}d) by working in areas`,
    })
  }
  // 4. Expedite a driving fabrication / delivery / procurement item.
  const proc = path.filter(a => kindOf(a) === 'procurement' && remainingOf(a) >= 5).sort((a, b) => remainingOf(b) - remainingOf(a)).slice(0, 2)
  for (const a of proc) {
    const rem = remainingOf(a)
    const to = Math.max(1, Math.round(rem * 0.75))
    add({
      id: `expedite-${a.id}`, title: `Expedite ${a.activityId} ${a.name}: ${rem} → ${to} work days`,
      description: 'Pay for an earlier factory slot, premium freight or a split/partial shipment of this driving item.',
      tradeoff: 'Expedite fees and freight premiums are quoted per item; confirm with the supplier before relying on it.',
      changes: [{ kind: 'duration', activityId: a.id, remaining: to }],
      reason: `What-if: expedite ${a.activityId} with the supplier (${rem} → ${to} work days)`,
    })
  }

  const useful = options.filter(o => o.daysSaved > 0 || ((o.minFloatAfter ?? 0) > (o.minFloatBefore ?? 0)))
    .sort((a, b) => b.daysSaved - a.daysSaved || ((b.minFloatAfter ?? 0) - (a.minFloatAfter ?? 0)))
    .slice(0, opts.maxOptions ?? 8)
  const drivers = [...path].sort((a, b) => remainingOf(b) - remainingOf(a)).slice(0, 6)
    .map(a => ({ id: a.id, code: a.activityId, name: a.name, remaining: remainingOf(a), kind: kindOf(a) }))
  const explanation = [
    required
      ? (gapDays > 0
        ? `Planora's recalculated forecast finish is ${us(base.finish)}, ${gapDays} calendar days after the required ${us(required)}.`
        : `Planora's recalculated forecast finish is ${us(base.finish)}, on or before the required ${us(required)}.`)
      : `Planora's recalculated forecast finish is ${us(base.finish)}; the file carries no required finish, so these are what-ifs.`,
    base.minFloat != null ? `The lowest total float on open work is ${base.minFloat} work days${base.minFloat < 0 ? ' (negative: the network cannot meet a date it has been given)' : ''}.` : '',
    drivers.length ? `The longest remaining driving activities are ${drivers.slice(0, 3).map(x => `${x.code} ${x.name} (${x.remaining}d, ${x.kind})`).join('; ')}. Time is recovered only by shortening or re-sequencing the driving path.` : '',
    useful.length ? 'Each option below was recalculated on this network; applying one records it as edits with your reason (the uploaded file is not changed).' : 'None of the modeled levers moves the finish; the driving path is mostly fixed-duration work (procurement, cure, reviews) or constraints. Negotiate the date or re-plan the logic in P6.',
  ].filter(Boolean)
  return { finish: base.finish, required, gapDays, minFloat: base.minFloat, explanation, drivers, options: useful }
}
