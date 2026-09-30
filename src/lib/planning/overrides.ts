// Scheduler overrides. The tool proposes; the scheduler disposes. Every edit records who, when, why,
// and what the tool had reasoned, then the network is recomputed and the impact reported.

import type { GeneratedSchedule, LinkType, Override, PlanActivity, PlanLink } from './types'
import { runCpm } from './cpm'
import { overriddenRationale, removeActivityBridging } from './generator'

export type Edit =
  | { kind: 'duration'; activityId: string; value: number; reason: string }
  | { kind: 'rename'; activityId: string; value: string; reason: string }
  | { kind: 'remove_activity'; activityId: string; reason: string }
  | { kind: 'add_link'; from: string; to: string; type: LinkType; lag: number; reason: string }
  | { kind: 'remove_link'; linkId: string; reason: string }
  | { kind: 'link'; linkId: string; type?: LinkType; lag?: number; reason: string }
  /** Add work the tool didn't know about, e.g. "Owner-furnished kitchen equipment install" */
  | { kind: 'add_activity'; name: string; duration: number; after: string; before?: string; reason: string }

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
        id, code: `U${String(acts.size).padStart(4, '0')}`, name, duration: v, type: v === 0 ? 'milestone' : 'task',
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
