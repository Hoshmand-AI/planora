// Scheduler overrides. The tool proposes; the scheduler disposes. Every edit records who, when, why,
// and what the tool had reasoned, then the network is recomputed and the impact reported.

import type { ConstraintType, GeneratedSchedule, LinkType, Override, PlanActivity, PlanLink } from './types'
import { runCpm } from './cpm'
import { fmtConstraint, overriddenRationale, removeActivityBridging } from './generator'

export type Edit =
  | { kind: 'duration'; activityId: string; value: number; reason: string }
  | { kind: 'rename'; activityId: string; value: string; reason: string }
  | { kind: 'remove_activity'; activityId: string; reason: string }
  | { kind: 'add_link'; from: string; to: string; type: LinkType; lag: number; reason: string }
  | { kind: 'remove_link'; linkId: string; reason: string }
  | { kind: 'link'; linkId: string; type?: LinkType; lag?: number; reason: string }
  /** Add work the tool didn't know about, e.g. "Owner-furnished kitchen equipment install" */
  | { kind: 'add_activity'; name: string; duration: number; after: string; before?: string; reason: string }
  /** Set (or clear, with null) the activity's date constraint, e.g. a contractual access date or an outage window */
  | { kind: 'constraint'; activityId: string; constraint: { type: PlanConstraintType; date: string } | null; reason: string }

/** Date constraints the plan editor can set (P6 primary constraints). */
export type PlanConstraintType = Extract<ConstraintType, 'SNET' | 'SNLT' | 'FNET' | 'FNLT' | 'MSO' | 'MFO'>
export const PLAN_CONSTRAINT_TYPES: readonly PlanConstraintType[] = ['SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO']
const isIsoDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v

export interface EditImpact {
  finishBefore: string
  finishAfter: string
  /** Calendar days the project finish moved (+ later / - earlier) */
  finishDeltaDays: number
  criticalAdded: string[]
  criticalRemoved: string[]
}

export class EditError extends Error {}

const LINK_TYPES: LinkType[] = ['FS', 'SS', 'FF', 'SF']

/**
 * Activity ID for an added activity that follows the schedule's own numbering: the dominant
 * prefix + numeric width series (e.g. A1000, A1010, … → step 10) continues with the next free number
 * after the highest one (A1000, A1010 → A1020). Only when the IDs show no such series (fewer than two
 * codes sharing a prefix and width) does it fall back to Planora's U0001-style codes.
 */
export function nextActivityCode(existing: string[]): string {
  const used = new Set(existing)
  const series = new Map<string, { prefix: string; width: number; nums: number[] }>()
  for (const c of existing) {
    const m = /^(.*?)(\d+)$/.exec(c || '')
    if (!m) continue
    const key = `${m[1]}\u0000${m[2].length}`
    const g = series.get(key) || { prefix: m[1], width: m[2].length, nums: [] }
    g.nums.push(Number(m[2]))
    series.set(key, g)
  }
  // Dominant series: most members; ties go to the one with the higher numbers (the main sequence).
  const top = (g: { nums: number[] }) => g.nums.reduce((m, v) => (v > m ? v : m), -Infinity)
  const best = [...series.values()].sort((a, b) => b.nums.length - a.nums.length || top(b) - top(a))[0]
  if (best && best.nums.length >= 2) {
    const nums = [...new Set(best.nums)].sort((a, b) => a - b)
    // Step: the most common gap between consecutive IDs (A1000, A1010, A1020 → 10).
    const gaps = new Map<number, number>()
    for (let k = 1; k < nums.length; k++) {
      const d = nums[k] - nums[k - 1]
      if (d > 0) gaps.set(d, (gaps.get(d) || 0) + 1)
    }
    const step = [...gaps.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] || 1
    const fmt = (n: number) => `${best.prefix}${String(n).padStart(best.width, '0')}`
    let n = nums[nums.length - 1] + step
    while (used.has(fmt(n))) n += step
    return fmt(n)
  }
  let n = existing.length
  const fallback = (k: number) => `U${String(k).padStart(4, '0')}`
  while (used.has(fallback(n))) n++
  return fallback(n)
}

export function applyEdit(s: GeneratedSchedule, edit: Edit, by: string): { schedule: GeneratedSchedule; impact: EditImpact; summary: string } {
  if (!edit.reason || edit.reason.trim().length < 3) throw new EditError('Give a short reason for the change — it is kept in the audit trail and the basis of schedule.')
  const reason = edit.reason.trim().slice(0, 500)
  const at = new Date().toISOString()
  const acts = new Map(s.activities.map(a => [a.id, structuredClone(a)]))
  const links = new Map(s.links.map(l => [l.id, structuredClone(l)]))
  const removed = [...(s.removed || [])]
  const getAct = (id: string): PlanActivity => {
    const a = acts.get(id)
    if (!a) throw new EditError(`Activity ${id} not found`)
    return a
  }
  const getLink = (id: string): PlanLink => {
    const l = links.get(id)
    if (!l) throw new EditError(`Link ${id} not found`)
    return l
  }
  let summary: string

  switch (edit.kind) {
    case 'duration': {
      const a = getAct(edit.activityId)
      const v = Math.round(Number(edit.value))
      if (!Number.isFinite(v) || v < 0 || v > 2000) throw new EditError('Duration must be between 0 and 2000 work days.')
      if (a.type === 'milestone' && v !== 0) throw new EditError('Milestones have zero duration.')
      const o: Override = { field: 'duration', from: a.duration, to: v, reason, by, at }
      a.overrides = [...(a.overrides || []), o]
      a.rationale = overriddenRationale(a.rationale, o)
      a.duration = v
      summary = `${a.code} ${a.name}: duration ${o.from} → ${v} days`
      break
    }
    case 'rename': {
      const a = getAct(edit.activityId)
      const v = String(edit.value).trim().slice(0, 200)
      if (!v) throw new EditError('Name cannot be empty.')
      const o: Override = { field: 'name', from: a.name, to: v, reason, by, at }
      a.overrides = [...(a.overrides || []), o]
      a.name = v
      summary = `${a.code}: renamed to “${v}”`
      break
    }
    case 'remove_activity': {
      const a = getAct(edit.activityId)
      if (a.category === 'ntp' || a.category === 'final_completion' || a.category === 'substantial_completion') throw new EditError('Start and completion milestones cannot be removed.')
      const o: Override = { field: 'remove', from: a.name, reason, by, at }
      removeActivityBridging({ acts, links }, a.id, o)
      removed.push({ id: a.id, kind: 'activity', name: `${a.code} ${a.name}`, override: o })
      summary = `Removed ${a.code} ${a.name} (logic bridged)`
      break
    }
    case 'add_activity': {
      const after = getAct(edit.after)
      const name = String(edit.name || '').trim().slice(0, 200)
      if (!name) throw new EditError('Give the new activity a name.')
      const v = Math.round(Number(edit.duration))
      if (!Number.isFinite(v) || v < 0 || v > 2000) throw new EditError('Duration must be between 0 and 2000 work days.')
      const before = edit.before ? getAct(edit.before) : [...acts.values()].find(a => a.category === 'substantial_completion') || [...acts.values()].find(a => a.category === 'final_completion')
      if (before && before.id === after.id) throw new EditError('Pick different activities for "after" and "before".')
      const id = `user:act:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      const o: Override = { field: 'name', to: name, reason, by, at }
      const src = [{ kind: 'override' as const, label: `Added by ${by}`, detail: at }]
      acts.set(id, {
        id, code: nextActivityCode([...acts.values()].map(a => a.code)), name, duration: v, type: v === 0 ? 'milestone' : 'task',
        calendarId: s.defaultCalendarId, category: 'other', phase: after.phase,
        rationale: { summary: `Added by ${by}: ${reason}`, sources: src, confidence: 'high' }, overrides: [o],
      })
      const lk = (from: string, to: string, why: string) => links.set(`user:${from}>${to}`, {
        id: `user:${from}>${to}`, from, to, type: 'FS', lag: 0, rationale: { summary: why, sources: src, confidence: 'high' }, overrides: [o],
      })
      lk(after.id, id, `Follows ${after.code} ${after.name} (set by ${by}).`)
      if (before) lk(id, before.id, `Must finish before ${before.code} ${before.name} (set by ${by}).`)
      summary = `Added “${name}” (${v} days) after ${after.code}${before ? ` and before ${before.code}` : ''}`
      break
    }
    case 'add_link': {
      getAct(edit.from); getAct(edit.to)
      if (edit.from === edit.to) throw new EditError('An activity cannot depend on itself.')
      if (!LINK_TYPES.includes(edit.type)) throw new EditError('Link type must be FS, SS, FF or SF.')
      const id = `user:${edit.from}>${edit.to}`
      if (links.has(id) || links.has(`${edit.from}>${edit.to}`)) throw new EditError('Those activities are already linked.')
      const o: Override = { field: 'add_link', to: `${edit.type}${edit.lag ? ` ${edit.lag}d` : ''}`, reason, by, at }
      links.set(id, {
        id, from: edit.from, to: edit.to, type: edit.type, lag: Math.round(Number(edit.lag) || 0),
        rationale: { summary: `Added by ${by}: ${reason}`, sources: [{ kind: 'override', label: `Scheduler logic by ${by}`, detail: at }], confidence: 'high' },
        overrides: [o],
      })
      summary = `Linked ${acts.get(edit.from)!.code} → ${acts.get(edit.to)!.code} (${edit.type}${edit.lag ? ` ${edit.lag}d` : ''})`
      break
    }
    case 'remove_link': {
      const l = getLink(edit.linkId)
      const o: Override = { field: 'remove_link', from: `${l.type} ${l.lag}`, reason, by, at }
      links.delete(l.id)
      if (!l.id.startsWith('user:')) removed.push({ id: l.id, kind: 'link', name: `${acts.get(l.from)?.code} → ${acts.get(l.to)?.code}`, override: o })
      summary = `Removed link ${acts.get(l.from)?.code} → ${acts.get(l.to)?.code}`
      break
    }
    case 'link': {
      const l = getLink(edit.linkId)
      if (edit.type && !LINK_TYPES.includes(edit.type)) throw new EditError('Link type must be FS, SS, FF or SF.')
      const parts: string[] = []
      if (edit.type && edit.type !== l.type) {
        const o: Override = { field: 'type', from: l.type, to: edit.type, reason, by, at }
        l.overrides = [...(l.overrides || []), o]
        l.rationale = overriddenRationale(l.rationale, o)
        parts.push(`${l.type} → ${edit.type}`)
        l.type = edit.type
      }
      if (edit.lag !== undefined && Math.round(edit.lag) !== l.lag) {
        const o: Override = { field: 'lag', from: l.lag, to: Math.round(edit.lag), reason, by, at }
        l.overrides = [...(l.overrides || []), o]
        l.rationale = overriddenRationale(l.rationale, o)
        parts.push(`lag ${l.lag} → ${Math.round(edit.lag)}`)
        l.lag = Math.round(edit.lag)
      }
      if (!parts.length) throw new EditError('Nothing changed.')
      summary = `Link ${acts.get(l.from)?.code} → ${acts.get(l.to)?.code}: ${parts.join(', ')}`
      break
    }
    case 'constraint': {
      const a = getAct(edit.activityId)
      const c = edit.constraint
      let next: PlanActivity['constraint'] | undefined
      if (c === null || c === undefined) {
        if (!a.constraint) throw new EditError('This activity has no constraint to clear.')
        next = undefined
      } else {
        if (typeof c !== 'object' || !PLAN_CONSTRAINT_TYPES.includes(c.type)) throw new EditError(`Constraint type must be one of ${PLAN_CONSTRAINT_TYPES.join(', ')}.`)
        if (!isIsoDate(c.date)) throw new EditError('Give the constraint date as YYYY-MM-DD.')
        if (c.date < s.projectStart) throw new EditError('The constraint date cannot be before the project start (Notice to Proceed).')
        if (a.constraint && a.constraint.type === c.type && a.constraint.date === c.date) throw new EditError('Nothing changed.')
        next = { type: c.type, date: c.date }
      }
      const o: Override = { field: 'constraint', from: a.constraint ? { ...a.constraint } : null, to: next ? { ...next } : null, reason, by, at }
      a.overrides = [...(a.overrides || []), o]
      a.rationale = overriddenRationale(a.rationale, { ...o, from: fmtConstraint(o.from), to: fmtConstraint(o.to) })
      if (next) a.constraint = next
      else delete a.constraint
      summary = `${a.code} ${a.name}: constraint ${fmtConstraint(o.from)} → ${fmtConstraint(o.to)}`
      break
    }
    default:
      throw new EditError('Unknown edit')
  }

  const before = s.cpm
  const cpm = runCpm({
    projectStart: s.projectStart,
    activities: [...acts.values()],
    links: [...links.values()],
    calendars: s.calendars,
    defaultCalendarId: s.defaultCalendarId,
    mustFinishBy: s.mustFinishBy,
  })
  if (cpm.cycles.length) throw new EditError('That change creates a logic loop (circular dependency). It was not applied.')

  const next: GeneratedSchedule = { ...s, activities: [...acts.values()], links: [...links.values()], removed, cpm }
  const critBefore = new Set(Object.entries(before?.times || {}).filter(([, t]) => t.critical).map(([id]) => id))
  const critAfter = new Set(Object.entries(cpm.times).filter(([, t]) => t.critical).map(([id]) => id))
  const code = (id: string) => acts.get(id)?.code || s.activities.find(a => a.id === id)?.code || id
  const finishBefore = before?.projectFinish || cpm.projectFinish
  return {
    schedule: next,
    summary,
    impact: {
      finishBefore,
      finishAfter: cpm.projectFinish,
      finishDeltaDays: Math.round((Date.parse(cpm.projectFinish) - Date.parse(finishBefore)) / 86_400_000),
      criticalAdded: [...critAfter].filter(x => !critBefore.has(x)).map(code),
      criticalRemoved: [...critBefore].filter(x => !critAfter.has(x)).map(code),
    },
  }
}
