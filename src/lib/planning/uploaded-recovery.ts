// What-if and recovery options for an UPLOADED schedule.
//
// The recovery engine for plans built in Planora (recovery.ts) works by re-answering interview
// questions and regenerating the plan (work week, delivery method, catalog lead times), which an
// uploaded P6 / MS Project network does not have. So uploads get their own generator, driven by the
// network itself: it walks the driving path to the CONTRACT milestone (the designated or auto-picked
// finish milestone; the project finish when there is none) and models the levers a scheduler would
// try — crash a driving field activity, overlap two driving field activities (FS → SS with a lag),
// expedite a driving fabrication/delivery item — each recalculated with Planora's CPM on the real
// network (all calendars, lags, constraints and progress), showing the new milestone date, whether it
// meets the milestone's own constraint date (FNLT / FO / MFO, else Must Finish By) and the float effect.
//
// Domain rules: work by others (utility relocations by the utility owner, owner-furnished items),
// fixed-duration work (cure, biological seeding / acclimation, regulatory review / permit /
// inspection, lab turnaround), fabrication / delivery (expedite only) and work after the contract
// milestone (punch list, defects period, as-builts, close-out) are never crashed or overlapped.
// Overlap wording follows the project type (floors for buildings, segments for linear work, process
// trains for plants).
// Every option is a list of ordinary schedule edits, so applying it records edits with a reason.
// Shares the labor premium ranges with recovery.ts so the trade-offs read the same way.

import type { Activity, Relationship } from '@/lib/db'
import type { ProgressMode, WorkCalendar } from './types'
import type { ContractTarget } from './contract-target'
import { completeSchedule } from './complete-schedule'
import { applyScheduleEdits, remainingOf, type ScheduleEditChange } from './uploaded-edits'
import { NOT_CRASHABLE, workKind, type WorkKind } from './work-kind'
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
  /** The contract milestone and the date it must meet (service.contractTarget); none = the project finish */
  contract?: ContractTarget | null
  /** Facility type (wording of overlap options) */
  projectType?: string | null
}

export interface NetworkOutcome {
  finish: string | null
  /** Logic-driven finish of the measured (contract) milestone; equals `finish` when none is measured */
  measured: string | null
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
  /** New date of the contract milestone (the project finish when there is none) */
  newFinish: string
  /** New project finish (all work, including after the contract milestone) */
  newProjectFinish: string | null
  /** Calendar days the contract milestone moves earlier (negative = later) */
  daysSaved: number
  minFloatBefore: number | null
  minFloatAfter: number | null
  /** null when there is no required date to meet */
  meetsDate: boolean | null
}

export interface UploadedRecoveryPlan {
  /** Forecast of the contract milestone (the project finish when there is none) */
  finish: string
  /** Forecast project finish */
  projectFinish: string
  /** The contract milestone recovery targets; null = the project finish */
  milestone: { id: string; code: string; name: string; designated: boolean } | null
  /** The date to meet at that milestone */
  required: string | null
  requiredSource: string | null
  /** Calendar days the milestone is forecast past the required date (0 when on time or no date) */
  gapDays: number
  minFloat: number | null
  explanation: string[]
  drivers: { id: string; code: string; name: string; remaining: number; kind: WorkKind }[]
  /** Driving activities that are never crashed or overlapped, and why */
  excluded: { id: string; code: string; name: string; kind: WorkKind; why: string }[]
  options: UploadedRecoveryOption[]
}

const calDays = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
const us = (x: string) => `${x.slice(5, 7)}/${x.slice(8, 10)}/${x.slice(0, 4)}`

const BUILDING = new Set(['commercial_office', 'healthcare', 'data_center', 'k12_school', 'multifamily', 'warehouse_industrial', 'retail', 'lab_research', 'federal_defense', 'interiors_ti'])
/** How work is split to overlap two activities, in the project's own terms. */
export function overlapSplit(projectType?: string | null): { by: string; unit: string } {
  const t = projectType || ''
  if (BUILDING.has(t)) return { by: 'by area or floor', unit: 'area / floor' }
  if (t === 'highway_bridge' || t === 'transit_rail') return { by: 'by segment, stage or station range', unit: 'segment / stage' }
  if (t === 'water_wastewater' || t === 'industrial_process' || t === 'epc_industrial' || t === 'utility_power') return { by: 'by process train, unit or system', unit: 'train / unit / system' }
  if (t === 'aviation') return { by: 'by pavement section or construction phase area', unit: 'section / phase area' }
  if (t === 'marine_civil_works') return { by: 'by reach, berth or segment', unit: 'reach / segment' }
  if (t === 'environmental_remediation') return { by: 'by excavation cell or area', unit: 'cell / area' }
  return { by: 'by separate work areas or segments', unit: 'work area / segment' }
}

/** Finish of one activity: the logic date when a mandatory constraint pins it, else its early finish (an actual when complete). */
function finishOf(done: ReturnType<typeof completeSchedule>, id: string): string | null {
  const a = done.activities.find(x => x.id === id)
  if (a?.actualFinish) return a.actualFinish.slice(0, 10)
  const v = done.cpm?.violations.find(x => x.id === id)
  return v?.logicDate ?? done.cpm?.times[id]?.earlyFinish ?? null
}

/** Recalculate the network with these changes applied (nothing is stored); `measureId` = the contract milestone. */
export function evaluateNetwork(net: NetworkInput, changes: ScheduleEditChange[] = [], measureId: string | null = net.contract?.milestoneId ?? null): NetworkOutcome {
  const edited = changes.length
    ? applyScheduleEdits(net.activities, net.relationships, changes.map((change, i) => ({ id: `whatif-${i}`, change, reason: 'what-if', by: 'planora', at: '' })))
    : { activities: net.activities, relationships: net.relationships }
  const done = completeSchedule({
    activities: edited.activities, relationships: edited.relationships, calendars: net.calendars, defaultCalendarId: net.defaultCalendarId,
    projectStart: net.projectStart, projectFinish: null, dataDate: net.dataDate, mustFinishBy: net.mustFinishBy, progressMode: net.progressMode,
  })
  if (!done.cpm) return { finish: done.projectFinish, measured: done.projectFinish, minFloat: null, longestPath: [], earlyFinish: {} }
  const open = done.activities.filter(a => a.activityType !== 'summary' && a.activityType !== 'loe' && a.status !== 'complete' && !a.actualFinish && done.cpm!.times[a.id])
  const minFloat = open.length ? Math.min(...open.map(a => done.cpm!.times[a.id].totalFloat)) : null
  const measured = measureId ? finishOf(done, measureId) ?? done.cpm.logicFinish : done.cpm.logicFinish
  return { finish: done.cpm.logicFinish, measured, minFloat, longestPath: done.cpm.longestPath, earlyFinish: Object.fromEntries(Object.entries(done.cpm.times).map(([id, t]) => [id, t.earlyFinish])) }
}

/** Walk back from `to` through the logic: at each step the open predecessor that finishes latest. */
function chainTo(net: NetworkInput, to: string, earlyFinish: Record<string, string>, byId: Map<string, Activity>): string[] {
  const preds = new Map<string, string[]>()
  for (const r of net.relationships) preds.set(r.successorId, [...(preds.get(r.successorId) || []), r.predecessorId])
  const chain: string[] = []
  const seen = new Set<string>()
  let cur: string | undefined = to
  while (cur && !seen.has(cur) && chain.length < 500) {
    seen.add(cur); chain.unshift(cur)
    const ps: string[] = (preds.get(cur) || []).filter(id => earlyFinish[id] && byId.get(id) && byId.get(id)!.status !== 'complete')
    cur = ps.sort((a, b) => (earlyFinish[b] || '').localeCompare(earlyFinish[a] || ''))[0]
  }
  return chain
}

export function uploadedRecoveryOptions(net: NetworkInput, opts: { maxOptions?: number } = {}): UploadedRecoveryPlan | null {
  const byId = new Map(net.activities.map(a => [a.id, a]))
  // The contract milestone, unless it is missing from the network or already complete.
  const ms = net.contract?.milestoneId ? byId.get(net.contract.milestoneId) : undefined
  const target = ms && ms.status !== 'complete' && !ms.actualFinish ? ms : undefined
  const measureId = target?.id ?? null
  const base = evaluateNetwork(net, [], measureId)
  if (!base.finish || !base.measured || !base.longestPath.length) return null
  const kindOf = (a: Activity) => workKind(a.name, a.category)
  const openTask = (a: Activity | undefined): a is Activity => !!a && a.activityType === 'task' && a.status !== 'complete' && !a.actualFinish && remainingOf(a) > 0
  // The driving path to the contract milestone (work after it cannot move it); without one, the P6
  // longest path. The longest path stops at a date-pinned activity (e.g. a finish milestone held by a
  // Finish On constraint); then follow the logic back from that activity.
  let path: Activity[]
  if (target) path = chainTo(net, target.id, base.earlyFinish, byId).map(id => byId.get(id)).filter(openTask)
  else {
    path = base.longestPath.map(id => byId.get(id)).filter(openTask)
    if (!path.length) path = chainTo(net, base.longestPath[base.longestPath.length - 1], base.earlyFinish, byId).map(id => byId.get(id)).filter(openTask)
  }
  // The date to meet: the contract milestone's own date (else Must Finish By); the project's required finish without one.
  const required = target ? net.contract?.date ?? null : net.contract && !net.contract.milestoneId ? net.contract.date : net.mustFinishBy || null
  const requiredSource = required ? (target ? net.contract?.dateSource ?? null : 'Must Finish By') : null
  const current = base.measured
  const gapDays = required && current > required ? calDays(required, current) : 0
  const split = overlapSplit(net.projectType)

  const options: UploadedRecoveryOption[] = []
  const add = (o: Omit<UploadedRecoveryOption, 'newFinish' | 'newProjectFinish' | 'daysSaved' | 'minFloatBefore' | 'minFloatAfter' | 'meetsDate'>) => {
    const r = evaluateNetwork(net, o.changes, measureId)
    if (!r.measured) return
    options.push({ ...o, newFinish: r.measured, newProjectFinish: r.finish, daysSaved: calDays(r.measured, current), minFloatBefore: base.minFloat, minFloatAfter: r.minFloat, meetsDate: required ? r.measured <= required : null })
  }
  // Only field work is crashed or overlapped; procurement is only expedited; the rest is never touched.
  const isField = (a: Activity) => kindOf(a) === 'field'

  // 1. Crash the longest driving field activities, one at a time (add crews / a second shift).
  const field = path.filter(a => isField(a) && remainingOf(a) >= 3)
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
  const crashAll = path.filter(a => isField(a) && remainingOf(a) >= 5)
  if (crashAll.length > 1) {
    add({
      id: 'crash-path', title: `Crash ${crashAll.length} driving field activities by 15%`,
      description: `Shorten every driving field activity of 5+ work days: ${crashAll.slice(0, 5).map(a => a.activityId).join(', ')}${crashAll.length > 5 ? ', …' : ''}.`,
      tradeoff: 'Higher labor cost and supervision load across the driving path; returns diminish beyond 15–20%, and another path may take over (see the float effect).',
      changes: crashAll.map(a => ({ kind: 'duration' as const, activityId: a.id, remaining: Math.max(1, Math.round(remainingOf(a) * 0.85)) })),
      reason: 'What-if: compress driving field work by 15% (added crews / shifts)',
    })
  }
  // 3. Overlap consecutive driving field activities: FS → SS with a lag of half the predecessor.
  const onPath = new Set(path.map(a => a.id))
  const fsOnPath = net.relationships.filter(r => r.type === 'FS' && onPath.has(r.predecessorId) && onPath.has(r.successorId))
    .map(r => ({ r, p: byId.get(r.predecessorId)!, s: byId.get(r.successorId)! }))
    .filter(x => x.p.status !== 'in_progress' && remainingOf(x.p) >= 4 && remainingOf(x.s) >= 2 && isField(x.p) && isField(x.s))
    .sort((a, b) => remainingOf(b.p) - remainingOf(a.p)).slice(0, 3)
  for (const { r, p, s } of fsOnPath) {
    const lag = Math.max(1, Math.ceil(remainingOf(p) / 2) + Math.max(0, r.lag))
    add({
      id: `overlap-${r.predecessorId}-${r.successorId}`, title: `Overlap ${p.activityId} → ${s.activityId}: FS → SS +${lag}d`,
      description: `Start ${s.activityId} ${s.name} when ${p.activityId} ${p.name} is about half done, instead of after it finishes (split the work ${split.by}).`,
      tradeoff: `Needs a real split of the work (${split.unit}) and coordination of two crews working next to each other. If ${s.activityId} cannot finish before ${p.activityId}, also add an FF relationship.`,
      changes: [{ kind: 'link_set', predecessorId: r.predecessorId, successorId: r.successorId, type: 'SS', lag }],
      reason: `What-if: overlap ${p.activityId} and ${s.activityId} (FS → SS +${lag}d), work split ${split.by}`,
    })
  }
  // 4. Expedite a driving fabrication / delivery / procurement item (the only lever on supplier work).
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
  const excluded = path.filter(a => !isField(a) && kindOf(a) !== 'procurement')
    .map(a => ({ id: a.id, code: a.activityId, name: a.name, kind: kindOf(a), why: NOT_CRASHABLE[kindOf(a)] ?? 'not crashable' }))
  const what = target ? `${target.activityId} ${target.name} (${net.contract?.designated ? 'the designated contract milestone' : 'the contract milestone, picked automatically'})` : "Planora's recalculated project finish"
  const after = target && base.finish > current ? `Work after ${target.activityId} (e.g. punch list, defects period, as-builts, close-out) runs to ${us(base.finish)}; it cannot move the contract milestone and is not part of these options.` : ''
  const explanation = [
    required
      ? (gapDays > 0
        ? `${what} is forecast for ${us(current)}, ${gapDays} calendar days after the required ${us(required)}${requiredSource ? ` (${requiredSource})` : ''}.`
        : `${what} is forecast for ${us(current)}, on or before the required ${us(required)}${requiredSource ? ` (${requiredSource})` : ''}.`)
      : `${what} is forecast for ${us(current)}; there is no constraint date or required finish to meet, so these are what-ifs.`,
    after,
    base.minFloat != null ? `The lowest total float on open work is ${base.minFloat} work days${base.minFloat < 0 ? ' (negative: the network cannot meet a date it has been given)' : ''}.` : '',
    drivers.length ? `The longest remaining driving activities are ${drivers.slice(0, 3).map(x => `${x.code} ${x.name} (${x.remaining}d, ${x.kind.replace('_', ' ')})`).join('; ')}. Time is recovered only by shortening or re-sequencing the driving path.` : '',
    excluded.length ? `Never crashed or overlapped: ${excluded.slice(0, 4).map(x => `${x.code} ${x.name} (${x.why})`).join('; ')}${excluded.length > 4 ? '; …' : ''}.` : '',
    useful.length ? 'Each option below was recalculated on this network; applying one records it as edits with your reason (the uploaded file is not changed).' : 'None of the modeled levers moves the milestone; the driving path is mostly fixed-duration work, work by others, procurement or constraints. Negotiate the date or re-plan the logic in P6.',
  ].filter(Boolean)
  return {
    finish: current, projectFinish: base.finish,
    milestone: target ? { id: target.id, code: target.activityId, name: target.name, designated: !!net.contract?.designated } : null,
    required, requiredSource, gapDays, minFloat: base.minFloat, explanation, drivers, excluded, options: useful,
  }
}
