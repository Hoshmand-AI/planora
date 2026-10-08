// Resources and resource assignments of a schedule, as the source file gives them (P6 RSRC /
// RSRCRATE / TASKRSRC, MS Project Resources / Assignments, spreadsheet resource columns) or as a plan
// carries them. Plain data: stored as JSON, sent to the browser and written back out by the exporters.
// Planora never invents resources: a schedule without them has `ResourceData` null / empty.

/** P6 RT_Labor / RT_Equip / RT_Mat; MS Project Work (labor) / Material. */
export type ResourceKind = 'labor' | 'nonlabor' | 'material'

export interface ScheduleResource {
  /** Source id (P6 rsrc_id, MS Project resource UID, spreadsheet resource name) */
  id: string
  /** Short code (P6 rsrc_short_name, MS Project Initials) */
  code: string
  name: string
  kind: ResourceKind
  /** Unit of measure: hours for labor and nonlabor; the material's own unit when the file gives one */
  unit?: string | null
  /**
   * Maximum units per hour the resource can supply (P6 RSRCRATE max_qty_per_hr "Max Units/Time",
   * MS Project MaxUnits where 1 = 100%). Null or absent = the file does not say.
   */
  maxUnitsPerHour?: number | null
  /** Resource calendar id (one of the schedule's calendars), when the file gives one */
  calendarId?: string | null
}

export interface ResourceAssignment {
  /** Activity id in the schedule this data belongs to (Planora activity id) */
  activityId: string
  /** Source task key (P6 task_id, MS Project task UID, spreadsheet activity id): re-binds to stored activities */
  sourceKey?: string | null
  activityCode?: string | null
  resourceId: string
  /** Budgeted (planned) units: hours for labor / nonlabor */
  budgetUnits: number
  /** Units spent to date (P6 act_reg_qty + act_ot_qty, MS Project ActualWork) */
  actualUnits: number
  /** Units still to spend (P6 remain_qty, MS Project RemainingWork) */
  remainingUnits: number
  /** Planned units per hour (P6 target_qty_per_hr, MS Project Units), when given */
  unitsPerHour?: number | null
}

export interface ResourceData {
  source: 'p6_xer' | 'ms_xml' | 'excel' | 'csv' | 'plan'
  resources: ScheduleResource[]
  assignments: ResourceAssignment[]
  /** What the reader assumed or skipped, in plain words */
  notes: string[]
}

/** True when the data holds at least one assignment of a known resource. */
export function hasResourceData(d: ResourceData | null | undefined): d is ResourceData {
  if (!d || !d.assignments.length) return false
  const ids = new Set(d.resources.map(r => r.id))
  return d.assignments.some(a => ids.has(a.resourceId))
}

/**
 * Re-bind assignments read from a file to the stored activities (a re-parse gives activities fresh
 * ids): by source key first (P6 task_id / MS Project UID), then by activity code. Assignments whose
 * activity is not in the schedule are dropped and counted in a note.
 */
export function bindAssignments(d: ResourceData, activities: { id: string; activityId?: string; code?: string; sourceId?: string | null }[]): ResourceData {
  const bySource = new Map<string, string>()
  const byCode = new Map<string, string>()
  for (const a of activities) {
    if (a.sourceId && !bySource.has(a.sourceId)) bySource.set(a.sourceId, a.id)
    const code = a.activityId ?? a.code
    if (code && !byCode.has(code)) byCode.set(code, a.id)
  }
  const ids = new Set(activities.map(a => a.id))
  let dropped = 0
  const assignments: ResourceAssignment[] = []
  for (const x of d.assignments) {
    const id = (x.sourceKey && bySource.get(x.sourceKey)) || (x.activityCode && byCode.get(x.activityCode)) || (ids.has(x.activityId) ? x.activityId : undefined)
    if (!id) { dropped++; continue }
    assignments.push({ ...x, activityId: id })
  }
  const notes = dropped ? [...d.notes, `${dropped} resource assignment${dropped === 1 ? ' is' : 's are'} on activities not in this schedule (summary or other-project activities) and ${dropped === 1 ? 'was' : 'were'} left out.`] : d.notes
  return { ...d, assignments, notes }
}
