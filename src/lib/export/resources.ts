// Resources and assignments in exports, so a round trip keeps them:
//   P6 XER:          RSRC (dictionary), RSRCRATE (max units per hour), TASKRSRC (assignments)
//   MS Project XML:  <Resources> and <Assignments>
// Read back by src/lib/parsers/resources.ts. Only resources with assignments in the schedule are written.

import type { GeneratedSchedule } from '@/lib/planning/types'
import type { ResourceKind, ScheduleResource } from '@/lib/planning/resource-types'
import { hasResourceData } from '@/lib/planning/resource-types'

type XerTable = { name: string; fields: string[]; rows: (string | number)[][] }

const P6_TYPE: Record<ResourceKind, string> = { labor: 'RT_Labor', nonlabor: 'RT_Equip', material: 'RT_Mat' }

/** Resources that carry at least one assignment on an exported activity, in code order. */
function usedResources(s: GeneratedSchedule, exported: (activityId: string) => boolean): { resources: ScheduleResource[]; assignments: NonNullable<GeneratedSchedule['resources']>['assignments'] } {
  const d = s.resources
  if (!hasResourceData(d)) return { resources: [], assignments: [] }
  const byId = new Map(d.resources.map(r => [r.id, r]))
  const assignments = d.assignments.filter(a => byId.has(a.resourceId) && exported(a.activityId))
  const ids = new Set(assignments.map(a => a.resourceId))
  return { resources: d.resources.filter(r => ids.has(r.id)).sort((a, b) => a.code.localeCompare(b.code)), assignments }
}

/** P6 ids for resources: their own ids when they are already P6 ids (positive integers), else 3000, 3001, ... */
function xerIds(resources: ScheduleResource[]): Map<string, number> {
  const numeric = resources.map(r => (/^[1-9]\d{0,9}$/.test(r.id) ? Number(r.id) : NaN))
  if (numeric.every(n => !isNaN(n)) && new Set(numeric).size === numeric.length) return new Map(resources.map((r, i) => [r.id, numeric[i]]))
  return new Map(resources.map((r, i) => [r.id, 3000 + i]))
}

/** RSRC, RSRCRATE and TASKRSRC tables for exportXer; empty when the schedule has no resources. */
export function xerResourceTables(s: GeneratedSchedule, taskId: Map<string, number>, calId: Map<string, number>, projId: number, dataDate: string): XerTable[] {
  const { resources, assignments } = usedResources(s, id => taskId.has(id))
  if (!resources.length) return []
  const rid = xerIds(resources)
  const rsrc: XerTable = {
    name: 'RSRC',
    fields: ['rsrc_id', 'parent_rsrc_id', 'clndr_id', 'rsrc_seq_num', 'rsrc_short_name', 'rsrc_name', 'rsrc_title_name', 'def_qty_per_hr', 'cost_qty_type', 'active_flag', 'rsrc_type', 'unit_id'],
    rows: resources.map((r, i) => [rid.get(r.id)!, '', (r.calendarId && calId.get(r.calendarId)) || calId.get(s.defaultCalendarId) || '', i + 1, r.code, r.name, '', 1, 'QT_Hour', 'Y', P6_TYPE[r.kind], '']),
  }
  const rates: XerTable = {
    name: 'RSRCRATE',
    fields: ['rsrc_rate_id', 'rsrc_id', 'max_qty_per_hr', 'cost_per_qty', 'start_date'],
    rows: resources.filter(r => r.maxUnitsPerHour && r.maxUnitsPerHour > 0).map((r, i) => [4000 + i, rid.get(r.id)!, r.maxUnitsPerHour!, 0, `${dataDate.slice(0, 10)} 00:00`]),
  }
  const kind = new Map(resources.map(r => [r.id, r.kind]))
  const taskrsrc: XerTable = {
    name: 'TASKRSRC',
    fields: ['taskrsrc_id', 'task_id', 'proj_id', 'rsrc_id', 'remain_qty', 'target_qty', 'act_reg_qty', 'act_ot_qty', 'target_qty_per_hr', 'remain_qty_per_hr', 'rsrc_type'],
    rows: assignments.map((a, i) => [60000 + i, taskId.get(a.activityId)!, projId, rid.get(a.resourceId)!, a.remainingUnits, a.budgetUnits, a.actualUnits, 0, a.unitsPerHour ?? '', a.unitsPerHour ?? '', P6_TYPE[kind.get(a.resourceId) ?? 'labor']]),
  }
  return [rsrc, ...(rates.rows.length ? [rates] : []), taskrsrc]
}

const esc = (v: unknown) => String(v ?? '').replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!))
const pt = (h: number) => {
  const neg = h < 0
  const m = Math.round(Math.abs(h) * 60)
  return `${neg ? '-' : ''}PT${Math.floor(m / 60)}H${m % 60}M0S`
}

/** <Resources> and <Assignments> blocks for exportMspXml (indent "  "); empty string when none. */
export function mspResourcesXml(s: GeneratedSchedule, uidById: Map<string, number>, calUid: Map<string, number>): string {
  const { resources, assignments } = usedResources(s, id => uidById.has(id))
  if (!resources.length) return ''
  const ruid = new Map(resources.map((r, i) => [r.id, i + 1]))
  const h = '  ', i = '      '
  const tag = (n: string, v: unknown) => `${i}<${n}>${esc(v)}</${n}>\n`
  let x = `${h}<Resources>\n`
  for (const r of resources) {
    x += '    <Resource>\n'
    x += tag('UID', ruid.get(r.id)) + tag('ID', ruid.get(r.id)) + tag('Name', r.name) + tag('Type', r.kind === 'material' ? 0 : 1) + tag('IsNull', 0) + tag('Initials', r.code)
    if (r.kind === 'nonlabor') x += tag('Group', 'Equipment')
    if (r.kind === 'material' && r.unit) x += tag('MaterialLabel', r.unit)
    if (r.kind !== 'material' && r.maxUnitsPerHour && r.maxUnitsPerHour > 0) x += tag('MaxUnits', r.maxUnitsPerHour)
    const cu = r.calendarId ? calUid.get(r.calendarId) : undefined
    if (cu) x += tag('CalendarUID', cu)
    x += '    </Resource>\n'
  }
  x += `${h}</Resources>\n${h}<Assignments>\n`
  assignments.forEach((a, n) => {
    x += '    <Assignment>\n'
    x += tag('UID', n + 1) + tag('TaskUID', uidById.get(a.activityId)) + tag('ResourceUID', ruid.get(a.resourceId))
    if (a.unitsPerHour) x += tag('Units', a.unitsPerHour)
    x += tag('Work', pt(a.budgetUnits)) + tag('ActualWork', pt(a.actualUnits)) + tag('RemainingWork', pt(a.remainingUnits))
    x += '    </Assignment>\n'
  })
  return x + `${h}</Assignments>\n`
}
