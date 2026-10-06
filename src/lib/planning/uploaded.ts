// Treat an uploaded schedule like a Planora plan so the same engines apply to it: Monte Carlo risk
// analysis and exports to P6 / MS Project / Excel. Activity IDs, the source WBS, progress, baseline
// dates, calendars, constraints and the required finish are carried over unchanged.

import type { Activity, Relationship, Schedule } from '@/lib/db'
import type { ScheduleAnalysis } from '@/lib/analysis/schedule-analysis'
import { CONSTRAINT_TYPES, type CanonicalCategory, type ConstraintType, type CpmResult, type GeneratedSchedule, type Override, type PlanActivity, type PlanLink } from './types'
import type { AppliedEdit } from './uploaded-edits'
import { phaseOf } from '@/lib/semantic/taxonomy'
import { defaultCalendar } from './calendar'

const CSTR = new Set<string>(CONSTRAINT_TYPES)
const isoOf = (v: unknown): string => {
  const d = v instanceof Date ? v : new Date(String(v ?? ''))
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

/**
 * Edits made in Planora become overrides on the activities they touch (relationship edits on the
 * successor), so their reasons travel with the activity in exports (XER notebook, Basis of Schedule).
 */
export function editOverrides(edits: AppliedEdit[]): Map<string, Override[]> {
  const out = new Map<string, Override[]>()
  for (const e of edits) {
    if (e.status !== 'applied') continue
    const c = e.change
    const target = c.kind === 'duration' || c.kind === 'constraint' ? c.activityId : c.successorId
    const field: Override['field'] = c.kind === 'duration' ? 'duration' : c.kind === 'constraint' ? 'constraint' : c.kind === 'link_remove' ? 'remove_link' : e.before === 'no relationship' ? 'add_link' : 'type'
    const reason = c.kind === 'link_set' || c.kind === 'link_remove' ? `${e.label}: ${e.reason}` : e.reason
    out.set(target, [...(out.get(target) || []), { field, from: e.before, to: e.after, reason, by: e.byName || e.by, at: e.at }])
  }
  return out
}

export function uploadedToGenerated(s: Schedule, activities: Activity[], relationships: Relationship[], cpm: CpmResult | null, analysis: ScheduleAnalysis | null, edits: AppliedEdit[] = []): GeneratedSchedule {
  const overrides = editOverrides(edits)
  const calendars = s.calendars?.length ? s.calendars : [defaultCalendar()]
  const defaultCalendarId = s.defaultCalendarId && calendars.some(c => c.id === s.defaultCalendarId) ? s.defaultCalendarId : calendars[0].id
  const work = activities.filter(a => a.activityType !== 'summary' && a.activityType !== 'loe')
  const ids = new Set(work.map(a => a.id))
  const acts: PlanActivity[] = work.map(a => {
    const category = (a.category || 'other') as CanonicalCategory
    return {
      id: a.id, code: a.activityId, name: a.name,
      duration: a.activityType === 'milestone' ? 0 : Math.max(0, Math.round(a.duration)),
      remaining: a.status === 'in_progress' ? Math.max(0, Math.round(a.remainingDuration)) : undefined,
      type: a.activityType === 'milestone' ? 'milestone' : 'task',
      milestoneKind: a.activityType === 'milestone' && a.milestoneKind ? a.milestoneKind : undefined,
      calendarId: a.calendarId && calendars.some(c => c.id === a.calendarId) ? a.calendarId : defaultCalendarId,
      constraint: a.constraintType && CSTR.has(a.constraintType) && a.constraintDate ? { type: a.constraintType as ConstraintType, date: a.constraintDate } : undefined,
      actualStart: a.actualStart, actualFinish: a.actualFinish,
      category, phase: phaseOf(category),
      rationale: { summary: `From the uploaded file ${s.fileName}`, sources: [{ kind: 'file', label: s.fileName }], confidence: 'medium' },
      wbs: a.wbs || undefined, status: a.status, percentComplete: a.percentComplete,
      baselineStart: a.baselineStart, baselineFinish: a.baselineFinish,
      ...(overrides.has(a.id) ? { overrides: overrides.get(a.id) } : {}),
    }
  })
  const links: PlanLink[] = relationships.filter(r => ids.has(r.predecessorId) && ids.has(r.successorId)).map(r => ({
    id: r.id, from: r.predecessorId, to: r.successorId, type: r.type, lag: r.lag,
    rationale: { summary: 'From the uploaded file', sources: [{ kind: 'file', label: s.fileName }], confidence: 'medium' },
  }))
  return {
    // Postgres returns timestamps as Date objects; exporters expect an ISO string.
    generatedAt: isoOf(s.uploadedAt), projectStart: s.projectStart || s.dataDate || work.map(a => a.actualStart || a.earlyStart).filter(Boolean).sort()[0] || new Date().toISOString().slice(0, 10),
    dataDate: s.dataDate || undefined,
    mustFinishBy: analysis?.mustFinishBy || undefined,
    calendars, defaultCalendarId, activities: acts, links, assumptions: [], cpm: cpm || undefined,
  }
}
