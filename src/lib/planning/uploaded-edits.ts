// Edits a scheduler makes to an uploaded schedule inside Planora, each with a reason.
//
// The imported activities and relationships are never changed: edits are stored as an override layer
// (table schedule_edits, migration 7) and applied in order on every read, before Planora's CPM
// recalculation. So the original file stays the record of what the contractor submitted, every edit
// can be listed, exported and reverted, and the audit log holds who changed what and why.
//
// Edit kinds (P6 terms):
//   duration     — remaining duration of an open activity (not started: original = remaining)
//   link_set     — add a relationship, or change the type/lag of an existing one (same pred/succ)
//   link_remove  — delete a relationship
//   constraint   — set or clear an activity's primary constraint
// Pure: no database access, so it is unit tested with the CPM.

import type { Activity, Relationship } from '@/lib/db'
import { CONSTRAINT_TYPES, type ConstraintType, type LinkType } from './types'
import { scheduledRemaining } from './complete-schedule'

export type ScheduleEditChange =
  | { kind: 'duration'; activityId: string; remaining: number }
  | { kind: 'link_set'; predecessorId: string; successorId: string; type: LinkType; lag: number }
  | { kind: 'link_remove'; predecessorId: string; successorId: string }
  | { kind: 'constraint'; activityId: string; constraint: { type: ConstraintType; date: string } | null }

export type ScheduleEditKind = ScheduleEditChange['kind']
export const EDIT_KINDS: readonly ScheduleEditKind[] = ['duration', 'link_set', 'link_remove', 'constraint']

export interface ScheduleEdit {
  id: string
  change: ScheduleEditChange
  reason: string
  /** User id and display name of who made the edit */
  by: string
  byName?: string | null
  at: string
  /** 'recovery' when the edit came from a what-if / recovery option; 'leveling' from a resource leveling run (the leveled scenario) */
  source?: 'manual' | 'recovery' | 'leveling'
  optionId?: string | null
}

export interface AppliedEdit extends ScheduleEdit {
  /** What changed, in words: "A1030 Spread Footings: remaining duration" */
  label: string
  before: string
  after: string
  status: 'applied' | 'skipped'
  /** Why an edit could not be applied (e.g. the activity is complete) */
  note?: string
}

export const REASON_MIN = 5
const LINK_TYPES: readonly LinkType[] = ['FS', 'SS', 'FF', 'SF']
const CSTR = new Set<string>(CONSTRAINT_TYPES)
const isWork = (a: Activity) => a.activityType !== 'summary' && a.activityType !== 'loe'
const isoDay = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))
const linkText = (type: string, lag: number) => `${type}${lag ? ` ${lag > 0 ? '+' : ''}${lag}d` : ''}`
const cstrText = (t?: string | null, d?: string | null) => (t && d ? `${t} ${d}` : 'none')

/** Remaining work days the CPM uses for an activity. */
export const remainingOf = (a: Activity) => scheduledRemaining(a) ?? Math.max(0, Math.round(a.duration))

/** Apply edits in order to copies of the imported activities and relationships. */
export function applyScheduleEdits(activities: Activity[], relationships: Relationship[], edits: ScheduleEdit[]): {
  activities: Activity[]; relationships: Relationship[]; applied: AppliedEdit[]; editedActivityIds: string[]
} {
  const acts = activities.map(a => ({ ...a }))
  let rels = relationships.map(r => ({ ...r }))
  const byId = new Map(acts.map(a => [a.id, a]))
  const name = (id: string) => { const a = byId.get(id); return a ? `${a.activityId} ${a.name}` : id }
  const edited = new Set<string>()
  const applied: AppliedEdit[] = []
  for (const e of edits) {
    const c = e.change
    const skip = (label: string, note: string) => applied.push({ ...e, label, before: '—', after: '—', status: 'skipped', note })
    if (c.kind === 'duration') {
      const a = byId.get(c.activityId)
      const label = `${name(c.activityId)}: remaining duration`
      if (!a || !isWork(a)) { skip(label, 'The activity is no longer in this schedule.'); continue }
      if (a.status === 'complete' || a.actualFinish) { skip(label, 'The activity is complete.'); continue }
      if (a.activityType === 'milestone') { skip(label, 'Milestones have no duration.'); continue }
      const before = remainingOf(a)
      const v = Math.max(0, Math.round(c.remaining))
      if (a.status === 'in_progress') a.remainingDuration = v
      else { a.duration = v; a.remainingDuration = v }
      edited.add(a.id)
      applied.push({ ...e, label, before: `${before}d`, after: `${v}d`, status: 'applied' })
    } else if (c.kind === 'link_set') {
      const label = `${name(c.predecessorId)} → ${name(c.successorId)}`
      const p = byId.get(c.predecessorId), s = byId.get(c.successorId)
      if (!p || !s || !isWork(p) || !isWork(s)) { skip(label, 'An activity of this relationship is no longer in this schedule.'); continue }
      const i = rels.findIndex(r => r.predecessorId === c.predecessorId && r.successorId === c.successorId)
      const before = i >= 0 ? linkText(rels[i].type, rels[i].lag) : 'no relationship'
      if (i >= 0) rels[i] = { ...rels[i], type: c.type, lag: c.lag }
      else rels.push({ id: `edit-${e.id}`, scheduleId: p.scheduleId, predecessorId: c.predecessorId, successorId: c.successorId, type: c.type, lag: c.lag })
      edited.add(p.id); edited.add(s.id)
      applied.push({ ...e, label, before, after: linkText(c.type, c.lag), status: 'applied' })
    } else if (c.kind === 'link_remove') {
      const label = `${name(c.predecessorId)} → ${name(c.successorId)}`
      const r = rels.find(x => x.predecessorId === c.predecessorId && x.successorId === c.successorId)
      if (!r) { skip(label, 'The relationship is not in the schedule.'); continue }
      rels = rels.filter(x => x !== r)
      edited.add(c.predecessorId); edited.add(c.successorId)
      applied.push({ ...e, label, before: linkText(r.type, r.lag), after: 'removed', status: 'applied' })
    } else if (c.kind === 'constraint') {
      const a = byId.get(c.activityId)
      const label = `${name(c.activityId)}: constraint`
      if (!a || !isWork(a)) { skip(label, 'The activity is no longer in this schedule.'); continue }
      const before = cstrText(a.constraintType, a.constraintDate)
      a.constraintType = c.constraint?.type ?? null
      a.constraintDate = c.constraint?.date ?? null
      edited.add(a.id)
      applied.push({ ...e, label, before, after: cstrText(a.constraintType, a.constraintDate), status: 'applied' })
    }
  }
  return { activities: acts, relationships: rels, applied, editedActivityIds: [...edited] }
}

/** True when `to` already reaches `from` through relationships (adding from → to would close a loop). */
function reaches(rels: Relationship[], from: string, to: string): boolean {
  const out = new Map<string, string[]>()
  for (const r of rels) out.set(r.predecessorId, [...(out.get(r.predecessorId) || []), r.successorId])
  const seen = new Set<string>([from])
  const stack = [from]
  while (stack.length) {
    const n = stack.pop()!
    if (n === to) return true
    for (const m of out.get(n) || []) if (!seen.has(m)) { seen.add(m); stack.push(m) }
  }
  return false
}

/**
 * Validate a requested change against the current (already edited) network. Activities may be given
 * by Planora id or by activity code. Returns the normalized change or a message for the scheduler.
 */
export function validateEditChange(raw: unknown, activities: Activity[], relationships: Relationship[]): { change: ScheduleEditChange } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Each edit needs a kind: duration, link_set, link_remove or constraint.' }
  const b = raw as Record<string, unknown>
  const find = (v: unknown) => {
    if (typeof v !== 'string' || !v.trim()) return undefined
    const k = v.trim()
    return activities.find(a => a.id === k) ?? activities.find(a => a.activityId === k) ?? activities.find(a => a.activityId?.toLowerCase() === k.toLowerCase())
  }
  const work = (v: unknown, role: string): Activity | string => {
    const a = find(v)
    if (!a) return `No activity "${String(v ?? '')}" in this schedule (${role}).`
    if (!isWork(a)) return `${a.activityId} is a ${a.activityType === 'loe' ? 'level-of-effort' : 'summary'} activity; Planora does not schedule it.`
    return a
  }
  switch (b.kind) {
    case 'duration': {
      const a = work(b.activityId, 'activity')
      if (typeof a === 'string') return { error: a }
      if (a.status === 'complete' || a.actualFinish) return { error: `${a.activityId} is complete; its duration is history.` }
      if (a.activityType === 'milestone') return { error: `${a.activityId} is a milestone and has no duration.` }
      const v = Number(b.remaining)
      if (!Number.isFinite(v) || v < 0 || v > 5000) return { error: 'Remaining duration must be between 0 and 5000 work days.' }
      if (Math.round(v) === remainingOf(a)) return { error: `${a.activityId} already has ${remainingOf(a)} work days remaining.` }
      return { change: { kind: 'duration', activityId: a.id, remaining: Math.round(v) } }
    }
    case 'link_set': {
      const p = work(b.predecessorId, 'predecessor'); if (typeof p === 'string') return { error: p }
      const s = work(b.successorId, 'successor'); if (typeof s === 'string') return { error: s }
      if (p.id === s.id) return { error: 'An activity cannot be its own predecessor.' }
      const type = String(b.type || 'FS').toUpperCase() as LinkType
      if (!LINK_TYPES.includes(type)) return { error: 'Relationship type must be FS, SS, FF or SF.' }
      const lag = Number(b.lag ?? 0)
      if (!Number.isFinite(lag) || Math.abs(lag) > 1000) return { error: 'Lag must be a number of work days between -1000 and 1000.' }
      const existing = relationships.find(r => r.predecessorId === p.id && r.successorId === s.id)
      if (existing && existing.type === type && existing.lag === Math.round(lag)) return { error: `${p.activityId} → ${s.activityId} is already ${linkText(type, Math.round(lag))}.` }
      if (!existing && reaches(relationships, s.id, p.id)) return { error: `${s.activityId} already leads to ${p.activityId}; this relationship would create a logic loop.` }
      return { change: { kind: 'link_set', predecessorId: p.id, successorId: s.id, type, lag: Math.round(lag) } }
    }
    case 'link_remove': {
      const p = find(b.predecessorId), s = find(b.successorId)
      if (!p || !s) return { error: 'Name the predecessor and successor of the relationship to remove.' }
      if (!relationships.some(r => r.predecessorId === p.id && r.successorId === s.id)) return { error: `There is no relationship ${p.activityId} → ${s.activityId}.` }
      return { change: { kind: 'link_remove', predecessorId: p.id, successorId: s.id } }
    }
    case 'constraint': {
      const a = work(b.activityId, 'activity')
      if (typeof a === 'string') return { error: a }
      if (b.constraint === null || b.constraint === undefined || (typeof b.constraint === 'object' && !(b.constraint as Record<string, unknown>).type)) {
        if (!a.constraintType) return { error: `${a.activityId} has no constraint to clear.` }
        return { change: { kind: 'constraint', activityId: a.id, constraint: null } }
      }
      const c = b.constraint as Record<string, unknown>
      const type = String(c.type).toUpperCase()
      if (!CSTR.has(type)) return { error: `Constraint type must be one of ${CONSTRAINT_TYPES.join(', ')}.` }
      if (!isoDay(c.date)) return { error: 'Constraint date must be a date (YYYY-MM-DD).' }
      return { change: { kind: 'constraint', activityId: a.id, constraint: { type: type as ConstraintType, date: String(c.date) } } }
    }
    default: return { error: 'Edit kind must be duration, link_set, link_remove or constraint.' }
  }
}

/** Validate the reason that every edit must carry. */
export function reasonError(reason: unknown): string | null {
  return typeof reason === 'string' && reason.trim().length >= REASON_MIN ? null : `Give a reason for the edit (at least ${REASON_MIN} characters); it is kept with the edit, in exports and in the audit log.`
}

/** Short, stable fingerprint of active edits (cache keys). */
export function editsFingerprint(edits: { id: string }[]): string {
  return edits.map(e => e.id).join(',')
}
