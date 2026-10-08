// Time Impact Analysis (TIA) on an uploaded schedule update, after AACE RP 52R-06 ("prospective"
// TIA): a delay event is modelled as a fragnet (new activities plus their ties to existing activity
// codes), inserted into an accepted update as of its data date, and the network is recalculated with
// Planora's own CPM (src/lib/planning/cpm.ts via completeSchedule) exactly as every other view does:
// calendars, lags, progress (retained logic / override), mandatory constraints (scheduled dates and
// the logic-driven dates they overrule). The result compares before and after for the project finish
// and every contract / interim milestone, in calendar and work days, shows float change, the driving
// path to the contract milestone before and after (which fragnet activities are on it), and flags
// activities on the pre-existing driving path that were already slipping in the same period as
// POTENTIAL concurrent delay for an analyst to judge.
//
// Calculation, not conclusion: responsibility is a label the user enters. Whether a delay is
// excusable, compensable or gives an entitlement to time or money is a contractual / legal
// determination Planora does not make; every result and report says so (TIA_DISCLAIMER).
//
// Deterministic and reproducible: no clock, no randomness; inputsHash is the SHA-256 of the canonical
// calculation inputs (network, calendars, settings, fragnet, event dates, previous update), and
// resultHash the SHA-256 of the canonical result. Same inputs → same hashes and the same result.
// Pure (no database access), so it is unit tested.

import { createHash } from 'crypto'
import type { Activity, Relationship } from '@/lib/db'
import type { CpmResult, LinkType, ProgressMode, WorkCalendar } from '@/lib/planning/types'
import { completeSchedule } from '@/lib/planning/complete-schedule'
import { defaultCalendar, workDaysBetween } from '@/lib/planning/calendar'
import { contractTarget, FINISH_DATE_CONSTRAINTS } from '@/lib/planning/contract-target'
import { analyzeSchedule, type ScheduleAnalysis } from '@/lib/analysis/schedule-analysis'
import { fmtDate } from '@/lib/format'

export const TIA_ENGINE = 'planora-tia/1'

export const RESPONSIBILITIES = ['owner', 'contractor', 'third_party', 'force_majeure', 'unassigned'] as const
export type Responsibility = typeof RESPONSIBILITIES[number]
export const RESPONSIBILITY_LABELS: Record<Responsibility, string> = {
  owner: 'Owner', contractor: 'Contractor', third_party: 'Third party', force_majeure: 'Force majeure', unassigned: 'Unassigned',
}
export const DELAY_EVENT_STATUSES = ['draft', 'analyzed', 'accepted', 'rejected'] as const
export type DelayEventStatus = typeof DELAY_EVENT_STATUSES[number]

export const TIA_DISCLAIMER = 'This Time Impact Analysis is a schedule calculation. Planora inserts the fragnet as modelled, recalculates the network and reports the difference. It does not determine whether a delay is excusable, compensable or gives an entitlement to time or money, nor who is responsible for it: those are contractual and legal determinations for the parties under the contract. The responsibility shown is a label entered by the user. Concurrency indicators are potential concurrent delay only and require analyst judgment.'
export const CONCURRENCY_LABEL = 'Potential concurrent delay — requires analyst judgment'

/* ─── Fragnet model ─────────────────────────────────── */

export interface FragnetActivity {
  /** New activity code (must not exist in the update), e.g. "TIA-01" */
  code: string
  name: string
  /** Work days on its calendar; 0 = a milestone */
  duration: number
  /** Calendar id from the schedule's calendars; null = the schedule's default calendar */
  calendarId?: string | null
  /** Optional earliest start (e.g. the date the event began); clamped to the data date */
  startNoEarlierThan?: string | null
}

export interface FragnetLink {
  /** Activity code: a fragnet code or an existing activity code */
  from: string
  to: string
  type: LinkType
  /** Work days on the predecessor's calendar */
  lag: number
}

export interface Fragnet {
  activities: FragnetActivity[]
  relationships: FragnetLink[]
  /** The analyst intends open ends (no tie in or out): reported as warnings instead of errors */
  allowOpenEnds?: boolean
}

export interface EvidenceRef { label: string; url?: string | null }

/** The network of the update the TIA runs on (as loaded: submitted or scenario). */
export interface TiaNetwork {
  scheduleId: string
  scheduleName: string
  version: string
  activities: Activity[]
  relationships: Relationship[]
  calendars: WorkCalendar[]
  defaultCalendarId: string | null
  projectStart: string | null
  dataDate: string | null
  mustFinishBy: string | null
  progressMode: ProgressMode
  /** Contract milestone the scheduler designated (id or code); null = picked automatically */
  finishMilestoneId?: string | null
  basis?: 'submitted' | 'scenario'
  editsApplied?: number
}

/** The previous update of the same project, for concurrency indicators (recalculated activities). */
export interface TiaPrevious {
  scheduleId: string
  label: string
  dataDate: string | null
  activities: Pick<Activity, 'activityId' | 'name' | 'earlyStart' | 'earlyFinish' | 'actualStart' | 'actualFinish' | 'status' | 'remainingDuration'>[]
}

export interface TiaEventInput {
  title: string
  responsibility: Responsibility
  eventStart?: string | null
  eventEnd?: string | null
  fragnet: Fragnet
}

/* ─── Result ────────────────────────────────────────── */

export interface DatePair { scheduled: string | null; logic: string | null }

export interface MilestoneImpact {
  id: string
  code: string
  name: string
  kind: 'contract' | 'interim' | 'milestone'
  /** The date it must meet: its finish constraint (FNLT / FO / MFO), or Must Finish By for the contract milestone */
  contractDate: string | null
  contractSource: string | null
  calendar: string
  constraint: string | null
  before: DatePair & { totalFloat: number | null }
  after: DatePair & { totalFloat: number | null }
  /** Calendar days after − before (+ = later) */
  impactCd: { scheduled: number | null; logic: number | null }
  /** Work days on the milestone's calendar */
  impactWd: { scheduled: number | null; logic: number | null }
  /** Work days after − before (negative = float consumed) */
  floatChange: number | null
  /** Calendar days the logic-driven date is past the contract date (negative = ahead) */
  lateVsContract: { before: number | null; after: number | null }
}

export interface PathStep { id: string; code: string; name: string; start: string | null; finish: string | null; totalFloat: number | null; fragnet: boolean; status: string }

export interface FragnetRow { code: string; name: string; duration: number; calendar: string; startNoEarlierThan: string | null; start: string | null; finish: string | null; totalFloat: number | null; onDrivingPath: boolean }

export interface ConcurrencyFlag {
  code: string
  name: string
  /** What the indicator is based on */
  indicator: 'slipped_since_previous' | 'late_start_since_previous' | 'late_vs_baseline'
  detail: string
  /** Calendar days the activity slipped (previous update or baseline → this update) */
  slipCd: number | null
  /** The activity's dates overlap the delay event's period */
  overlapsEvent: boolean
  label: typeof CONCURRENCY_LABEL
}

export interface TiaResult {
  engine: typeof TIA_ENGINE
  inputsHash: string
  resultHash: string
  disclaimer: string
  ok: boolean
  validation: { errors: string[]; warnings: string[] }
  update: { scheduleId: string; name: string; version: string; dataDate: string | null; basis: 'submitted' | 'scenario'; editsApplied: number; progressMode: ProgressMode }
  event: { title: string; responsibility: Responsibility; responsibilityLabel: string; eventStart: string | null; eventEnd: string | null }
  assumptions: string[]
  contractMilestone: { id: string; code: string; name: string; date: string | null; dateSource: string | null; designated: boolean } | null
  projectFinish: { before: DatePair; after: DatePair; impactCd: { scheduled: number | null; logic: number | null }; impactWd: { scheduled: number | null; logic: number | null }; calendar: string }
  /** Contract milestone first, then interim / other open milestones by date */
  milestones: MilestoneImpact[]
  drivingPath: { target: string | null; before: PathStep[]; after: PathStep[]; fragnetOnPath: string[]; basisBefore: 'scheduled' | 'logic'; basisAfter: 'scheduled' | 'logic' }
  fragnet: FragnetRow[]
  concurrency: { basis: 'previous_update' | 'baseline' | 'none'; comparedWith: string | null; period: { from: string | null; to: string | null }; flags: ConcurrencyFlag[] }
  /** Recalculation warnings that appear only once the fragnet is inserted */
  warnings: string[]
  /** Plain statements of what was calculated (no conclusions) */
  findings: string[]
}

/** Stored separately in tia_runs (before_result / after_result): the headline of each recalculation. */
export interface TiaSide { forecastFinish: string | null; scheduledFinish: string | null; logicFinish: string | null; finishMilestone: ScheduleAnalysis['finishMilestone']; longestPath: string[]; violations: CpmResult['violations'] }

/* ─── Helpers ───────────────────────────────────────── */

const DAY = 86_400_000
const ISO = /^\d{4}-\d{2}-\d{2}$/
const LINK_TYPES: readonly LinkType[] = ['FS', 'SS', 'FF', 'SF']
const isoDay = (v: unknown): v is string => typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(v))
const calDays = (a: string | null | undefined, b: string | null | undefined) => (a && b ? Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / DAY) : null)
const isWork = (a: Activity) => a.activityType !== 'summary' && a.activityType !== 'loe'
const isOpen = (a: Pick<Activity, 'status' | 'actualFinish'>) => a.status !== 'complete' && !a.actualFinish
const FRAG_PREFIX = 'tia:'
const fragId = (code: string) => `${FRAG_PREFIX}${code}`
const signed = (n: number | null) => (n == null ? '—' : n > 0 ? `+${n}` : String(n))

/** Canonical JSON (sorted keys) for hashing. */
export function canonical(v: unknown): string {
  if (v === undefined) return 'null'
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  return `{${Object.keys(v as object).filter(k => (v as Record<string, unknown>)[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`
}
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

/**
 * Parse a fragnet from a request body (structure and types only; references and logic are checked
 * against the network by validateFragnet).
 */
export function parseFragnet(raw: unknown): { fragnet: Fragnet } | { error: string } {
  if (raw == null) return { fragnet: { activities: [], relationships: [] } }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { error: 'The fragnet must be an object with activities and relationships.' }
  const b = raw as Record<string, unknown>
  const acts = Array.isArray(b.activities) ? b.activities : []
  const rels = Array.isArray(b.relationships) ? b.relationships : []
  if (acts.length > 200) return { error: 'A fragnet can have at most 200 activities.' }
  if (rels.length > 1000) return { error: 'A fragnet can have at most 1000 relationships.' }
  const activities: FragnetActivity[] = []
  for (const [i, x] of acts.entries()) {
    if (!x || typeof x !== 'object') return { error: `Fragnet activity ${i + 1} is not an object.` }
    const a = x as Record<string, unknown>
    const code = String(a.code ?? '').trim()
    const name = String(a.name ?? '').trim()
    if (!code || code.length > 40) return { error: `Fragnet activity ${i + 1} needs an activity code (up to 40 characters).` }
    if (!name || name.length > 200) return { error: `Fragnet activity ${code} needs a name (up to 200 characters).` }
    const duration = Number(a.duration)
    if (!Number.isFinite(duration)) return { error: `Fragnet activity ${code}: duration must be a number of work days.` }
    const snet = a.startNoEarlierThan == null || a.startNoEarlierThan === '' ? null : a.startNoEarlierThan
    if (snet !== null && !isoDay(snet)) return { error: `Fragnet activity ${code}: earliest start must be a date (YYYY-MM-DD).` }
    activities.push({ code, name, duration, calendarId: typeof a.calendarId === 'string' && a.calendarId ? a.calendarId : null, startNoEarlierThan: snet })
  }
  const relationships: FragnetLink[] = []
  for (const [i, x] of rels.entries()) {
    if (!x || typeof x !== 'object') return { error: `Fragnet relationship ${i + 1} is not an object.` }
    const r = x as Record<string, unknown>
    const type = String(r.type ?? 'FS').toUpperCase() as LinkType
    const lag = Number(r.lag ?? 0)
    if (!LINK_TYPES.includes(type)) return { error: `Fragnet relationship ${i + 1}: type must be FS, SS, FF or SF.` }
    if (!Number.isFinite(lag)) return { error: `Fragnet relationship ${i + 1}: lag must be a number of work days.` }
    relationships.push({ from: String(r.from ?? '').trim(), to: String(r.to ?? '').trim(), type, lag })
  }
  return { fragnet: { activities, relationships, ...(b.allowOpenEnds === true ? { allowOpenEnds: true } : {}) } }
}

export interface FragnetValidation {
  errors: string[]
  warnings: string[]
  /** Fragnet activities and relationships in the update's id space, ready to add to the network (when no errors) */
  activities: Activity[]
  relationships: Relationship[]
}

/**
 * Validate a fragnet against the update: codes unique and new, references exist (and are scheduled
 * work), durations ≥ 0, calendars exist, lags are whole work days, no logic loop is introduced, and it
 * ties into the network in and out (open ends are errors unless allowOpenEnds, then warnings).
 * Fragnet work cannot start before the data date (an earlier start is clamped, with a warning), and
 * completed activities are never moved (a tie into one is dropped, with a warning).
 */
export function validateFragnet(fragnet: Fragnet, net: Pick<TiaNetwork, 'scheduleId' | 'activities' | 'relationships' | 'calendars' | 'defaultCalendarId' | 'dataDate'>): FragnetValidation {
  const errors: string[] = []
  const warnings: string[] = []
  const acts = fragnet.activities ?? []
  const rels = fragnet.relationships ?? []
  if (!acts.length) errors.push('Add at least one fragnet activity that models the delay event.')
  const byCode = new Map<string, Activity>()
  const byCodeLower = new Map<string, Activity>()
  for (const a of net.activities) {
    if (!byCode.has(a.activityId)) byCode.set(a.activityId, a)
    if (!byCodeLower.has(a.activityId.toLowerCase())) byCodeLower.set(a.activityId.toLowerCase(), a)
  }
  const existing = (code: string) => byCode.get(code) ?? byCodeLower.get(code.toLowerCase())
  const cals = net.calendars.length ? net.calendars : [defaultCalendar()]
  const defCal = net.defaultCalendarId && cals.some(c => c.id === net.defaultCalendarId) ? net.defaultCalendarId : cals[0].id
  const fragCodes = new Map<string, FragnetActivity>()
  for (const a of acts) {
    const k = a.code.toLowerCase()
    if ([...fragCodes.keys()].some(c => c.toLowerCase() === k)) { errors.push(`Fragnet activity code ${a.code} is used twice; codes must be unique.`); continue }
    if (existing(a.code)) { errors.push(`Fragnet activity code ${a.code} already exists in this update; give the new activity its own code.`); continue }
    fragCodes.set(a.code, a)
    if (!Number.isFinite(a.duration) || a.duration < 0) errors.push(`Fragnet activity ${a.code}: duration must be 0 or more work days.`)
    else if (a.duration > 5000) errors.push(`Fragnet activity ${a.code}: duration must be at most 5000 work days.`)
    else if (Math.round(a.duration) !== a.duration) warnings.push(`Fragnet activity ${a.code}: duration ${a.duration} rounded to ${Math.round(a.duration)} work days.`)
    if (a.calendarId && !cals.some(c => c.id === a.calendarId)) errors.push(`Fragnet activity ${a.code}: calendar "${a.calendarId}" is not one of this schedule's calendars.`)
  }
  const fragCode = (code: string) => fragCodes.has(code) ? code : [...fragCodes.keys()].find(c => c.toLowerCase() === code.toLowerCase())

  // Relationships in id space.
  const ids = new Map<string, string>() // code -> id
  for (const c of fragCodes.keys()) ids.set(c, fragId(c))
  const out: Relationship[] = []
  const seen = new Set<string>()
  const preds = new Map<string, number>(), succs = new Map<string, number>()
  let tieIn = 0, tieOut = 0
  for (const [i, r] of rels.entries()) {
    const label = `${r.from || '?'} → ${r.to || '?'}`
    if (!r.from || !r.to) { errors.push(`Fragnet relationship ${i + 1} needs a predecessor and a successor.`); continue }
    const fFrom = fragCode(r.from), fTo = fragCode(r.to)
    const eFrom = fFrom ? undefined : existing(r.from), eTo = fTo ? undefined : existing(r.to)
    if (!fFrom && !eFrom) { errors.push(`Relationship ${label}: no activity "${r.from}" in the fragnet or in this update.`); continue }
    if (!fTo && !eTo) { errors.push(`Relationship ${label}: no activity "${r.to}" in the fragnet or in this update.`); continue }
    if (!fFrom && !fTo) { errors.push(`Relationship ${label} links two existing activities; a fragnet relationship must start or end at a fragnet activity.`); continue }
    if ((eFrom && !isWork(eFrom)) || (eTo && !isWork(eTo))) { errors.push(`Relationship ${label}: ${(eFrom && !isWork(eFrom) ? eFrom : eTo)!.activityId} is a level-of-effort or summary activity, which Planora does not schedule.`); continue }
    if (!LINK_TYPES.includes(r.type)) { errors.push(`Relationship ${label}: type must be FS, SS, FF or SF.`); continue }
    if (!Number.isFinite(r.lag) || Math.abs(r.lag) > 1000) { errors.push(`Relationship ${label}: lag must be between -1000 and 1000 work days.`); continue }
    const from = fFrom ? fragId(fFrom) : eFrom!.id
    const to = fTo ? fragId(fTo) : eTo!.id
    if (from === to) { errors.push(`Relationship ${label}: an activity cannot be its own predecessor.`); continue }
    const key = `${from}>${to}`
    if (seen.has(key)) { errors.push(`Relationship ${label} is listed twice.`); continue }
    seen.add(key)
    if (eTo && !isOpen(eTo)) {
      warnings.push(`Relationship ${label}: ${eTo.activityId} is complete, so the fragnet cannot delay it; the tie is ignored (completed work is not moved).`)
      continue
    }
    if (Math.round(r.lag) !== r.lag) warnings.push(`Relationship ${label}: lag ${r.lag} rounded to ${Math.round(r.lag)} work days.`)
    if (fFrom && !fTo) tieOut++
    if (!fFrom && fTo) tieIn++
    preds.set(to, (preds.get(to) ?? 0) + 1)
    succs.set(from, (succs.get(from) ?? 0) + 1)
    out.push({ id: `tia-rel-${i + 1}`, scheduleId: net.scheduleId, predecessorId: from, successorId: to, type: r.type, lag: Math.round(r.lag) })
  }

  // Logic loops: any new loop must use a fragnet relationship u → v, so v must already reach u.
  if (out.length) {
    const adj = new Map<string, string[]>()
    const add = (a: string, b: string) => { const l = adj.get(a); if (l) l.push(b); else adj.set(a, [b]) }
    for (const r of net.relationships) add(r.predecessorId, r.successorId)
    for (const r of out) add(r.predecessorId, r.successorId)
    const codeOf = (id: string) => id.startsWith(FRAG_PREFIX) ? id.slice(FRAG_PREFIX.length) : net.activities.find(a => a.id === id)?.activityId ?? id
    const reported = new Set<string>()
    for (const r of out) {
      // BFS from successor back to predecessor, keeping the path for the message.
      const prev = new Map<string, string>()
      const q = [r.successorId]
      prev.set(r.successorId, '')
      let found = false
      for (let h = 0; h < q.length && !found; h++) {
        for (const m of adj.get(q[h]) ?? []) {
          if (prev.has(m)) continue
          prev.set(m, q[h])
          if (m === r.predecessorId) { found = true; break }
          q.push(m)
        }
      }
      if (!found) continue
      const path: string[] = []
      for (let cur = r.predecessorId; cur; cur = prev.get(cur) || '') path.unshift(codeOf(cur))
      const loop = [codeOf(r.predecessorId), ...path].join(' → ')
      if (!reported.has(loop)) { reported.add(loop); errors.push(`The fragnet would create a logic loop: ${loop}.`) }
    }
  }

  // Ties into the network.
  const open = (msg: string) => (fragnet.allowOpenEnds ? warnings : errors).push(fragnet.allowOpenEnds ? `${msg} (accepted as an intentional open end).` : `${msg} Tie it in, or mark the open ends as intentional.`)
  for (const a of fragCodes.values()) {
    const id = fragId(a.code)
    if (!preds.get(id) && !a.startNoEarlierThan) open(`Fragnet activity ${a.code} has no predecessor and no earliest start, so it would start at the data date.`)
    else if (!preds.get(id)) warnings.push(`Fragnet activity ${a.code} has no predecessor; its earliest start ${fmtDate(a.startNoEarlierThan)} places it, not logic.`)
    if (!succs.get(id)) open(`Fragnet activity ${a.code} has no successor, so it cannot affect any later work.`)
  }
  if (fragCodes.size && !tieIn && ![...fragCodes.values()].some(a => a.startNoEarlierThan)) open('The fragnet has no predecessor in the existing network.')
  if (fragCodes.size && !tieOut) open('The fragnet has no successor in the existing network, so it cannot move any existing milestone.')

  // Activities, clamped to the data date.
  const activities: Activity[] = []
  for (const a of fragCodes.values()) {
    let snet = a.startNoEarlierThan ?? null
    if (snet && net.dataDate && snet < net.dataDate) {
      warnings.push(`Fragnet activity ${a.code}: earliest start ${fmtDate(snet)} is before the data date ${fmtDate(net.dataDate)}; fragnet work cannot start before the data date, so it is moved to ${fmtDate(net.dataDate)}.`)
      snet = net.dataDate
    }
    const dur = Math.max(0, Math.round(Number(a.duration) || 0))
    activities.push({
      id: fragId(a.code), scheduleId: net.scheduleId, activityId: a.code, name: a.name, wbs: 'Time impact fragnet',
      duration: dur, remainingDuration: dur, percentComplete: 0,
      earlyStart: null, earlyFinish: null, lateStart: null, lateFinish: null, actualStart: null, actualFinish: null, baselineStart: null, baselineFinish: null,
      totalFloat: 0, freeFloat: 0, isCritical: false, status: 'not_started',
      activityType: dur === 0 ? 'milestone' : 'task', milestoneKind: dur === 0 ? 'finish' : null,
      calendarId: a.calendarId || defCal, constraintType: snet ? 'SNET' : null, constraintDate: snet, category: null, sourceId: null,
    })
  }
  return { errors, warnings, activities: errors.length ? [] : activities, relationships: errors.length ? [] : out }
}

/* ─── Recalculation ─────────────────────────────────── */

interface Side {
  done: ReturnType<typeof completeSchedule>
  analysis: ScheduleAnalysis
  byId: Map<string, Activity>
}

function recalc(net: TiaNetwork, activities: Activity[], relationships: Relationship[], finishMilestoneId: string | null | undefined): Side {
  const done = completeSchedule({
    activities, relationships, calendars: net.calendars, defaultCalendarId: net.defaultCalendarId,
    projectStart: net.projectStart, projectFinish: null, dataDate: net.dataDate, mustFinishBy: net.mustFinishBy, progressMode: net.progressMode,
  })
  const analysis = analyzeSchedule({
    activities: done.activities, links: relationships.map(r => ({ from: r.predecessorId, to: r.successorId })), cpm: done.cpm,
    reportedFinish: null, mustFinishBy: net.mustFinishBy, dataDate: net.dataDate, finishMilestoneId: finishMilestoneId ?? null,
    calendars: net.calendars, defaultCalendarId: net.defaultCalendarId,
  })
  return { done, analysis, byId: new Map(done.activities.map(a => [a.id, a])) }
}

/** Finish dates of one activity: scheduled (constraints honoured) and logic-driven (mandatory constraints relaxed). */
function datesOf(s: Side, id: string): DatePair & { totalFloat: number | null; start: string | null } {
  const a = s.byId.get(id)
  if (!a) return { scheduled: null, logic: null, totalFloat: null, start: null }
  if (!isOpen(a)) { const f = a.actualFinish || a.earlyFinish; return { scheduled: f, logic: f, totalFloat: null, start: a.actualStart || a.earlyStart } }
  const t = s.done.cpm?.times[id]
  const scheduled = t?.earlyFinish ?? a.earlyFinish
  const logic = s.done.cpm?.logicTimes?.[id]?.earlyFinish ?? scheduled
  return { scheduled, logic: logic && scheduled && logic < scheduled ? scheduled : logic, totalFloat: t?.totalFloat ?? null, start: t?.earlyStart ?? a.earlyStart }
}

/**
 * The driving path to one activity: the presented driving trace (cpm.drivingTrace, traced through
 * constraints) when the target is on it; otherwise walk back through driving relationships (relationship
 * free float ≤ 0), preferring the most critical, latest-finishing predecessor.
 */
function pathTo(s: Side, targetId: string | null): { ids: string[]; basis: 'scheduled' | 'logic' } {
  const cpm = s.done.cpm
  if (!cpm) return { ids: [], basis: 'scheduled' }
  const trace = cpm.drivingTrace ?? { basis: 'scheduled' as const, path: cpm.longestPath, constraints: [] }
  if (!targetId) return { ids: trace.path, basis: trace.basis }
  const at = trace.path.indexOf(targetId)
  if (at >= 0) return { ids: trace.path.slice(0, at + 1), basis: trace.basis }
  const into = new Map<string, { from: string; ff: number }[]>()
  for (const l of cpm.linkFloat ?? []) {
    const list = into.get(l.to)
    const e = { from: l.from, ff: l.freeFloat }
    if (list) list.push(e); else into.set(l.to, [e])
  }
  const ids: string[] = []
  const visited = new Set<string>()
  let cur: string | null = targetId
  while (cur && !visited.has(cur)) {
    visited.add(cur)
    ids.unshift(cur)
    const cands: { id: string; tf: number; ef: string }[] = (into.get(cur) ?? []).filter(e => e.ff <= 0 && !visited.has(e.from))
      .map(e => ({ id: e.from, tf: cpm.times[e.from]?.totalFloat ?? 0, ef: cpm.times[e.from]?.earlyFinish ?? '' }))
      .filter(c => { const a = s.byId.get(c.id); return !!a && isOpen(a) })
    cands.sort((x, y) => x.tf - y.tf || y.ef.localeCompare(x.ef) || x.id.localeCompare(y.id))
    cur = cands[0]?.id ?? null
  }
  return { ids, basis: 'scheduled' }
}

function steps(s: Side, ids: string[]): PathStep[] {
  return ids.map(id => {
    const a = s.byId.get(id)
    const d = datesOf(s, id)
    return { id, code: a?.activityId ?? id, name: a?.name ?? '', start: d.start, finish: d.logic ?? d.scheduled, totalFloat: d.totalFloat, fragnet: id.startsWith(FRAG_PREFIX), status: a?.status ?? 'not_started' }
  })
}

/* ─── Inputs fingerprint ────────────────────────────── */

/** The canonical calculation inputs: everything that can change a number in the result, nothing else. */
export function tiaInputs(net: TiaNetwork, event: Pick<TiaEventInput, 'eventStart' | 'eventEnd' | 'fragnet'>, previous?: TiaPrevious | null) {
  const acts = net.activities.map(a => ({
    id: a.id, code: a.activityId, type: a.activityType, mk: a.milestoneKind ?? null, d: a.duration, rd: a.remainingDuration, st: a.status,
    as: a.actualStart, af: a.actualFinish, cal: a.calendarId ?? null, ct: a.constraintType ?? null, cd: a.constraintDate ?? null, bf: a.baselineFinish,
  })).sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
  const rels = net.relationships.map(r => [r.predecessorId, r.successorId, r.type, r.lag] as const)
    .sort((x, y) => (x.join('|') < y.join('|') ? -1 : x.join('|') > y.join('|') ? 1 : 0))
  const prev = previous ? {
    id: previous.scheduleId, dd: previous.dataDate,
    acts: previous.activities.map(a => [a.activityId, a.earlyStart, a.earlyFinish, a.actualStart, a.actualFinish, a.status]).sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
  } : null
  return {
    engine: TIA_ENGINE,
    update: { id: net.scheduleId, dataDate: net.dataDate, projectStart: net.projectStart, mustFinishBy: net.mustFinishBy, progressMode: net.progressMode, finishMilestoneId: net.finishMilestoneId ?? null, basis: net.basis ?? 'submitted', editsApplied: net.editsApplied ?? 0 },
    calendars: [...net.calendars].sort((a, b) => a.id.localeCompare(b.id)), defaultCalendarId: net.defaultCalendarId,
    network: { activities: sha(canonical(acts)), relationships: sha(canonical(rels)) },
    fragnet: {
      activities: (event.fragnet.activities ?? []).map(a => ({ code: a.code, name: a.name, duration: a.duration, calendarId: a.calendarId ?? null, startNoEarlierThan: a.startNoEarlierThan ?? null })),
      relationships: (event.fragnet.relationships ?? []).map(r => ({ from: r.from, to: r.to, type: r.type, lag: r.lag })),
      allowOpenEnds: !!event.fragnet.allowOpenEnds,
    },
    eventStart: event.eventStart ?? null, eventEnd: event.eventEnd ?? null,
    previous: prev ? sha(canonical(prev)) : null,
  }
}

export function tiaInputsHash(net: TiaNetwork, event: Pick<TiaEventInput, 'eventStart' | 'eventEnd' | 'fragnet'>, previous?: TiaPrevious | null): string {
  return sha(canonical(tiaInputs(net, event, previous)))
}

/* ─── The analysis ──────────────────────────────────── */

export function runTia(net: TiaNetwork, event: TiaEventInput, previous?: TiaPrevious | null): { result: TiaResult; before: TiaSide | null; after: TiaSide | null } {
  const inputsHash = tiaInputsHash(net, event, previous)
  const cals = net.calendars.length ? net.calendars : [defaultCalendar()]
  const defCalId = net.defaultCalendarId && cals.some(c => c.id === net.defaultCalendarId) ? net.defaultCalendarId : cals[0].id
  const calOf = (id: string | null | undefined) => cals.find(c => c.id === id) ?? cals.find(c => c.id === defCalId)!
  const v = validateFragnet(event.fragnet, net)
  const eventOut: TiaResult['event'] = { title: event.title, responsibility: event.responsibility, responsibilityLabel: RESPONSIBILITY_LABELS[event.responsibility] ?? 'Unassigned', eventStart: event.eventStart ?? null, eventEnd: event.eventEnd ?? null }
  const update: TiaResult['update'] = { scheduleId: net.scheduleId, name: net.scheduleName, version: net.version, dataDate: net.dataDate, basis: net.basis ?? 'submitted', editsApplied: net.editsApplied ?? 0, progressMode: net.progressMode }
  if (!net.relationships.length) v.errors.push('This update has no activity relationships, so a fragnet cannot be inserted and recalculated.')
  if (!net.dataDate) v.warnings.push('This update has no data date; the project start is used as the data date.')

  const empty = (): TiaResult => ({
    engine: TIA_ENGINE, inputsHash, resultHash: '', disclaimer: TIA_DISCLAIMER, ok: false, validation: { errors: v.errors, warnings: v.warnings }, update, event: eventOut,
    assumptions: [], contractMilestone: null,
    projectFinish: { before: { scheduled: null, logic: null }, after: { scheduled: null, logic: null }, impactCd: { scheduled: null, logic: null }, impactWd: { scheduled: null, logic: null }, calendar: calOf(defCalId).name },
    milestones: [], drivingPath: { target: null, before: [], after: [], fragnetOnPath: [], basisBefore: 'scheduled', basisAfter: 'scheduled' }, fragnet: [],
    concurrency: { basis: 'none', comparedWith: null, period: { from: null, to: null }, flags: [] }, warnings: [], findings: [],
  })
  if (v.errors.length) {
    const r = empty()
    r.resultHash = sha(canonical({ ...r, resultHash: '' }))
    return { result: r, before: null, after: null }
  }

  const before = recalc(net, net.activities, net.relationships, net.finishMilestoneId)
  const fmBefore = before.analysis.finishMilestone
  const after = recalc(net, [...net.activities, ...v.activities], [...net.relationships, ...v.relationships], fmBefore?.id ?? net.finishMilestoneId)
  if (!before.done.cpm || !after.done.cpm) {
    v.errors.push('Planora could not recalculate this update.')
    const r = empty()
    r.resultHash = sha(canonical({ ...r, resultHash: '' }))
    return { result: r, before: null, after: null }
  }
  const target = contractTarget(before.analysis)
  const contractMilestone = fmBefore && target ? { id: fmBefore.id, code: fmBefore.code, name: fmBefore.name, date: target.date, dateSource: target.dateSource, designated: target.designated } : null

  // Project finish (all work).
  const defCal = calOf(defCalId)
  const pf = (s: Side): DatePair => ({ scheduled: s.analysis.scheduledFinish ?? null, logic: s.analysis.logicFinish ?? s.analysis.forecastFinish ?? null })
  const wd = (a: string | null, b: string | null, cal: WorkCalendar) => (a && b ? workDaysBetween(a.slice(0, 10), b.slice(0, 10), cal) : null)
  const pfB = pf(before), pfA = pf(after)
  const projectFinish: TiaResult['projectFinish'] = {
    before: pfB, after: pfA,
    impactCd: { scheduled: calDays(pfB.scheduled, pfA.scheduled), logic: calDays(pfB.logic, pfA.logic) },
    impactWd: { scheduled: wd(pfB.scheduled, pfA.scheduled, defCal), logic: wd(pfB.logic, pfA.logic, defCal) },
    calendar: defCal.name,
  }

  // Milestones: the contract milestone, then every other open milestone of the update.
  const work = net.activities.filter(isWork)
  const msActs = work.filter(a => (a.activityType === 'milestone' && isOpen(a)) || a.id === fmBefore?.id)
  const milestones: MilestoneImpact[] = msActs.map((a): MilestoneImpact => {
    const b = datesOf(before, a.id), f = datesOf(after, a.id)
    const cal = calOf(a.calendarId)
    const isContract = a.id === fmBefore?.id
    const k = a.constraintType && FINISH_DATE_CONSTRAINTS.has(a.constraintType) && a.constraintDate ? { date: a.constraintDate.slice(0, 10), src: `${a.activityId} ${a.constraintType} constraint` } : null
    const contractDate = isContract ? target?.date ?? null : k?.date ?? null
    const contractSource = isContract ? target?.dateSource ?? null : k?.src ?? null
    return {
      id: a.id, code: a.activityId, name: a.name, kind: isContract ? 'contract' : k ? 'interim' : 'milestone',
      contractDate, contractSource, calendar: cal.name, constraint: a.constraintType && a.constraintDate ? `${a.constraintType} ${a.constraintDate.slice(0, 10)}` : null,
      before: { scheduled: b.scheduled, logic: b.logic, totalFloat: b.totalFloat }, after: { scheduled: f.scheduled, logic: f.logic, totalFloat: f.totalFloat },
      impactCd: { scheduled: calDays(b.scheduled, f.scheduled), logic: calDays(b.logic, f.logic) },
      impactWd: { scheduled: wd(b.scheduled, f.scheduled, cal), logic: wd(b.logic, f.logic, cal) },
      floatChange: b.totalFloat != null && f.totalFloat != null ? f.totalFloat - b.totalFloat : null,
      lateVsContract: { before: calDays(contractDate, b.logic), after: calDays(contractDate, f.logic) },
    }
  }).sort((x, y) => (x.kind === 'contract' ? -1 : y.kind === 'contract' ? 1 : 0) || (x.before.logic ?? '').localeCompare(y.before.logic ?? '') || x.code.localeCompare(y.code))

  // Driving path to the contract milestone (the project finish when there is none).
  const targetId = fmBefore?.id ?? null
  const pB = pathTo(before, targetId), pA = pathTo(after, targetId)
  const afterSteps = steps(after, pA.ids)
  const fragnetOnPath = afterSteps.filter(s => s.fragnet).map(s => s.code)
  const drivingPath: TiaResult['drivingPath'] = { target: fmBefore?.code ?? null, before: steps(before, pB.ids), after: afterSteps, fragnetOnPath, basisBefore: pB.basis, basisAfter: pA.basis }

  const fragnet: FragnetRow[] = v.activities.map(a => {
    const d = datesOf(after, a.id)
    return { code: a.activityId, name: a.name, duration: a.duration, calendar: calOf(a.calendarId).name, startNoEarlierThan: a.constraintDate ?? null, start: d.start, finish: d.scheduled, totalFloat: d.totalFloat, onDrivingPath: fragnetOnPath.includes(a.activityId) }
  })

  // Concurrency indicators on the pre-existing driving path.
  const evStart = event.eventStart ?? null
  const fmAfter = milestones.find(m => m.kind === 'contract')
  const evEnd = event.eventEnd ?? fmAfter?.after.logic ?? pfA.logic
  const period = { from: previous?.dataDate ?? evStart, to: net.dataDate }
  const prevByCode = new Map((previous?.activities ?? []).map(a => [a.activityId, a]))
  const flags: ConcurrencyFlag[] = []
  for (const st of drivingPath.before) {
    if (st.fragnet || st.id === fmBefore?.id) continue
    const a = before.byId.get(st.id)
    if (!a || !isWork(a) || a.activityType === 'milestone') continue
    const curStart = a.actualStart || datesOf(before, a.id).start
    const curFinish = a.actualFinish || datesOf(before, a.id).logic
    const overlapsEvent = !!(evStart && curStart && curFinish && curStart.slice(0, 10) <= (evEnd ?? curFinish).slice(0, 10) && curFinish.slice(0, 10) >= evStart)
    const base = { code: a.activityId, name: a.name, overlapsEvent, label: CONCURRENCY_LABEL } as const
    if (previous) {
      const p = prevByCode.get(a.activityId)
      if (!p) continue
      const pFinish = p.actualFinish || p.earlyFinish
      const slip = calDays(pFinish, curFinish)
      if (slip != null && slip > 0) {
        flags.push({ ...base, indicator: 'slipped_since_previous', slipCd: slip, detail: `${a.activityId} ${a.actualFinish ? 'finished' : 'is forecast to finish'} ${fmtDate(curFinish)}, ${slip} calendar day${slip === 1 ? '' : 's'} later than ${fmtDate(pFinish)} in ${previous.label}.` })
        continue
      }
      const pStart = p.actualStart || p.earlyStart
      if (!a.actualStart && pStart && net.dataDate && pStart.slice(0, 10) < net.dataDate) {
        const late = calDays(pStart, curStart)
        flags.push({ ...base, indicator: 'late_start_since_previous', slipCd: late, detail: `${a.activityId} was forecast to start ${fmtDate(pStart)} in ${previous.label} and had not started at the data date ${fmtDate(net.dataDate)}.` })
      }
    } else if (a.baselineFinish) {
      const slip = calDays(a.baselineFinish, curFinish)
      if (slip != null && slip > 0 && (a.actualStart || a.actualFinish || (a.baselineStart && net.dataDate && a.baselineStart.slice(0, 10) < net.dataDate))) {
        flags.push({ ...base, indicator: 'late_vs_baseline', slipCd: slip, detail: `${a.activityId} ${a.actualFinish ? 'finished' : 'is forecast to finish'} ${fmtDate(curFinish)}, ${slip} calendar day${slip === 1 ? '' : 's'} after its baseline finish ${fmtDate(a.baselineFinish)} (no previous update to compare with).` })
      }
    }
  }
  const concurrency: TiaResult['concurrency'] = {
    basis: previous ? 'previous_update' : work.some(a => a.baselineFinish) ? 'baseline' : 'none',
    comparedWith: previous ? `${previous.label}${previous.dataDate ? ` (data date ${fmtDate(previous.dataDate)})` : ''}` : null,
    period, flags,
  }

  // Warnings the fragnet introduced into the recalculation.
  const beforeW = new Set(before.done.cpm.warnings)
  const warnings = after.done.cpm.warnings.filter(w => !beforeW.has(w))

  // Assumptions: what the calculation rests on.
  const mand = before.done.cpm.violations.length
  const assumptions = [
    `Update analysed: ${net.scheduleName} (${net.version}), data date ${fmtDate(net.dataDate)}, ${update.basis === 'scenario' && update.editsApplied ? `with ${update.editsApplied} Planora edit${update.editsApplied === 1 ? '' : 's'} applied (a what-if scenario)` : 'as submitted'}.`,
    `The fragnet (${v.activities.length} activit${v.activities.length === 1 ? 'y' : 'ies'}, ${v.relationships.length} relationship${v.relationships.length === 1 ? '' : 's'}) is inserted as modelled by the user; durations, logic and lags are the user's.`,
    'Fragnet work cannot start before the data date; completed activities and actual dates are not moved.',
    `Recalculated with Planora's CPM: ${net.progressMode === 'retained' ? 'retained logic' : 'progress override'} for out-of-sequence progress; relationship lags on the predecessor's calendar; float in work days of each activity's own calendar.`,
    `Calendars: ${cals.map(c => c.name).join(', ')} (default ${defCal.name}); fragnet activities use ${[...new Set(v.activities.map(a => calOf(a.calendarId).name))].join(', ') || defCal.name}.`,
    mand
      ? `Mandatory constraints (MSO/MFO) are honoured as scheduled and relaxed for the logic-driven dates; ${mand} overrule${mand === 1 ? 's' : ''} logic in this update, so both dates are reported.`
      : 'Mandatory constraints (MSO/MFO), when present, are honoured as scheduled and relaxed for the logic-driven dates; both are reported.',
    net.mustFinishBy ? `Float is measured against the required finish (Must Finish By) ${fmtDate(net.mustFinishBy)}.` : 'Float is measured against the project finish (no Must Finish By date).',
    contractMilestone ? `Contract milestone: ${contractMilestone.code} ${contractMilestone.name}${contractMilestone.designated ? ' (designated)' : ' (picked automatically)'}${contractMilestone.date ? `, to be met by ${fmtDate(contractMilestone.date)} (${contractMilestone.dateSource})` : ', no contract date'}.` : 'No contract milestone was identified; the project finish is measured.',
    'Impacts are after minus before, in calendar days (cd) and in work days (wd) of the milestone\'s calendar; + means later.',
  ]

  // Findings: plain statements of what was computed.
  const findings: string[] = []
  const cm = milestones.find(m => m.kind === 'contract')
  if (cm) {
    findings.push(`${cm.code} ${cm.name}: logic-driven ${fmtDate(cm.before.logic)} → ${fmtDate(cm.after.logic)} (${signed(cm.impactCd.logic)} cd, ${signed(cm.impactWd.logic)} wd); as scheduled ${fmtDate(cm.before.scheduled)} → ${fmtDate(cm.after.scheduled)} (${signed(cm.impactCd.scheduled)} cd).`)
    if (cm.floatChange != null) findings.push(`Total float at ${cm.code}: ${cm.before.totalFloat} → ${cm.after.totalFloat} wd (${signed(cm.floatChange)}).`)
    if (cm.impactCd.logic === 0 && (cm.floatChange ?? 0) < 0) findings.push(`The fragnet is absorbed by float before ${cm.code}: no change to its date, ${-(cm.floatChange ?? 0)} wd of float consumed.`)
    if (cm.impactCd.scheduled === 0 && (cm.impactCd.logic ?? 0) > 0) findings.push(`${cm.code}'s scheduled date does not move because a mandatory constraint holds it; the logic-driven date moves ${cm.impactCd.logic} cd.`)
  }
  findings.push(`Project finish (logic-driven): ${fmtDate(pfB.logic)} → ${fmtDate(pfA.logic)} (${signed(projectFinish.impactCd.logic)} cd, ${signed(projectFinish.impactWd.logic)} wd on ${defCal.name}).`)
  findings.push(fragnetOnPath.length ? `Fragnet activities on the driving path to ${drivingPath.target ?? 'the project finish'} after insertion: ${fragnetOnPath.join(', ')}.` : `No fragnet activity is on the driving path to ${drivingPath.target ?? 'the project finish'} after insertion.`)
  const moved = milestones.filter(m => m.kind !== 'contract' && (m.impactCd.logic ?? 0) !== 0)
  if (moved.length) findings.push(`Other milestones that move: ${moved.map(m => `${m.code} ${signed(m.impactCd.logic)} cd`).join(', ')}.`)
  if (flags.length) findings.push(`${flags.length} activit${flags.length === 1 ? 'y' : 'ies'} on the pre-existing driving path ${flags.length === 1 ? 'was' : 'were'} already slipping: ${CONCURRENCY_LABEL.toLowerCase()}.`)

  const result: TiaResult = {
    engine: TIA_ENGINE, inputsHash, resultHash: '', disclaimer: TIA_DISCLAIMER, ok: true, validation: { errors: [], warnings: v.warnings }, update, event: eventOut,
    assumptions, contractMilestone, projectFinish, milestones, drivingPath, fragnet, concurrency, warnings, findings,
  }
  result.resultHash = sha(canonical({ ...result, resultHash: '' }))
  const side = (s: Side): TiaSide => ({ forecastFinish: s.analysis.forecastFinish, scheduledFinish: s.analysis.scheduledFinish ?? null, logicFinish: s.analysis.logicFinish ?? null, finishMilestone: s.analysis.finishMilestone, longestPath: s.analysis.longestPath, violations: s.analysis.violations })
  return { result, before: side(before), after: side(after) }
}

/* ─── Delay events (records) ────────────────────────── */

export interface DelayEvent {
  id: string
  scheduleId: string
  title: string
  description: string | null
  /** User-entered label only; not a determination */
  responsibility: Responsibility
  eventStart: string | null
  eventEnd: string | null
  notifiedOn: string | null
  evidence: EvidenceRef[]
  fragnet: Fragnet
  status: DelayEventStatus
  statusNote: string | null
  createdBy: string | null
  createdByName?: string | null
  updatedBy: string | null
  createdAt: string
  updatedAt: string
}

export interface TiaRun {
  id: string
  delayEventId: string
  scheduleId: string
  inputsHash: string
  resultHash: string
  engine: string
  inputs: Record<string, unknown>
  before: TiaSide | null
  after: TiaSide | null
  result: TiaResult
  createdBy: string | null
  createdByName?: string | null
  createdAt: string
}

/** Links must be http(s): no javascript:, data: or file: URL reaches a page or a report. */
export function safeUrl(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null
  try {
    const u = new URL(v.trim())
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch { return null }
}

export function parseEvidence(raw: unknown): { evidence: EvidenceRef[] } | { error: string } {
  if (raw == null) return { evidence: [] }
  if (!Array.isArray(raw)) return { error: 'Evidence must be a list of references (a description and an optional link).' }
  if (raw.length > 50) return { error: 'At most 50 evidence references per delay event.' }
  const out: EvidenceRef[] = []
  for (const [i, x] of raw.entries()) {
    const r = (x && typeof x === 'object' ? x : { label: x }) as Record<string, unknown>
    const label = String(r.label ?? '').trim().slice(0, 500)
    const hasUrl = typeof r.url === 'string' && r.url.trim() !== ''
    const url = hasUrl ? safeUrl(r.url) : null
    if (hasUrl && !url) return { error: `Evidence ${i + 1}: the link must be an http(s) address.` }
    if (!label && !url) continue
    out.push({ label: label || url!, url })
  }
  return { evidence: out }
}

type EventFields = Partial<Pick<DelayEvent, 'title' | 'description' | 'responsibility' | 'eventStart' | 'eventEnd' | 'notifiedOn' | 'evidence' | 'fragnet'>>

/** The editable fields of a delay event from a request body; `partial` for PATCH (absent = unchanged). */
export function parseDelayEventFields(raw: unknown, partial: boolean): { fields: EventFields } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Send the delay event as JSON.' }
  const b = raw as Record<string, unknown>
  const f: EventFields = {}
  if (!partial || 'title' in b) {
    const t = String(b.title ?? '').trim()
    if (t.length < 3 || t.length > 200) return { error: 'Give the delay event a title (3 to 200 characters).' }
    f.title = t
  }
  if ('description' in b) f.description = b.description == null ? null : String(b.description).trim().slice(0, 5000) || null
  if (!partial || 'responsibility' in b) {
    const r = b.responsibility == null || b.responsibility === '' ? 'unassigned' : String(b.responsibility)
    if (!(RESPONSIBILITIES as readonly string[]).includes(r)) return { error: `Responsibility must be one of ${RESPONSIBILITIES.join(', ')}.` }
    f.responsibility = r as Responsibility
  }
  for (const [k, label] of [['eventStart', 'Event start'], ['eventEnd', 'Event end'], ['notifiedOn', 'Notice date']] as const) {
    if (!partial || k in b) {
      const v = b[k]
      if (v == null || v === '') f[k] = null
      else if (isoDay(v)) f[k] = v
      else return { error: `${label} must be a date (YYYY-MM-DD).` }
    }
  }
  if (f.eventStart && f.eventEnd && f.eventEnd < f.eventStart) return { error: 'Event end cannot be before the event start.' }
  if (!partial || 'evidence' in b) {
    const e = parseEvidence(b.evidence)
    if ('error' in e) return e
    f.evidence = e.evidence
  }
  if (!partial || 'fragnet' in b) {
    const g = parseFragnet(b.fragnet)
    if ('error' in g) return g
    f.fragnet = g.fragnet
  }
  return { fields: f }
}
