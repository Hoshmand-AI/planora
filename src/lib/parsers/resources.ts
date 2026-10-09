// Resource and assignment readers for the schedule parsers: P6 XER (RSRC, RSRCRATE, TASKRSRC, UMEASURE),
// P6 XML (Resource, ResourceRate, ResourceAssignment, UnitOfMeasure), MS Project XML (Resources,
// Assignments) and spreadsheet resource columns. Kept apart from the
// parsers themselves so each parser only hands its tables / XML / rows over. Nothing is invented:
// a file without resources gives null.

import type { Activity } from '@/lib/db'
import type { ResourceAssignment, ResourceData, ResourceKind, ScheduleResource } from '@/lib/planning/resource-types'
import { round2 } from './types'
import { children, childText, type XNode } from './xml-tree'

type Row = Record<string, string>

const num = (v: string | undefined | null): number | null => {
  if (v === undefined || v === null || String(v).trim() === '') return null
  const n = parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

/* ─── P6 XER ─────────────────────────────────────────────── */

const P6_KIND: Record<string, ResourceKind> = { RT_Labor: 'labor', RT_Equip: 'nonlabor', RT_Mat: 'material' }

/**
 * Resources and assignments of the imported project from an XER's tables. `tasks` maps P6 task_id to
 * the parsed activity. Max units per hour come from RSRCRATE (the rate in effect on the data date,
 * else the earliest); P6 keeps no limit on the RSRC row itself.
 */
export function xerResourceData(tables: Record<string, Row[]>, tasks: Map<string, Activity>, dataDate: string | null): ResourceData | null {
  const rows = tables['TASKRSRC']
  if (!rows?.length) return null
  const notes: string[] = []
  const rsrcRows = new Map<string, Row>()
  for (const r of tables['RSRC'] || []) if (r['rsrc_id'] && !rsrcRows.has(r['rsrc_id'])) rsrcRows.set(r['rsrc_id'], r)
  const units = new Map<string, string>()
  for (const u of tables['UMEASURE'] || []) if (u['unit_id']) units.set(u['unit_id'], u['unit_abbrev'] || u['unit_name'] || '')
  const rates = new Map<string, Row[]>()
  for (const r of tables['RSRCRATE'] || []) if (r['rsrc_id']) rates.set(r['rsrc_id'], [...(rates.get(r['rsrc_id']) || []), r])
  const maxOf = (rsrcId: string): number | null => {
    const list = (rates.get(rsrcId) || []).slice().sort((a, b) => (a['start_date'] || '').localeCompare(b['start_date'] || ''))
    if (!list.length) return null
    const dd = dataDate || ''
    const inEffect = [...list].reverse().find(r => !r['start_date'] || !dd || r['start_date'].slice(0, 10) <= dd) || list[0]
    const v = num(inEffect['max_qty_per_hr'])
    return v !== null && v > 0 ? v : null
  }

  const assignments: ResourceAssignment[] = []
  const used = new Set<string>()
  let roleOnly = 0, otherProject = 0
  for (const r of rows) {
    const act = tasks.get(r['task_id'])
    if (!act) { otherProject++; continue }
    const rid = r['rsrc_id']
    if (!rid) { roleOnly++; continue }
    const target = num(r['target_qty']) ?? 0
    const actual = (num(r['act_reg_qty']) ?? 0) + (num(r['act_ot_qty']) ?? 0)
    const done = act.status === 'complete' || !!act.actualFinish
    const rem = num(r['remain_qty'])
    assignments.push({
      activityId: act.id, sourceKey: act.sourceId ?? r['task_id'], activityCode: act.activityId, resourceId: rid,
      budgetUnits: round2(target), actualUnits: round2(actual),
      remainingUnits: round2(rem !== null ? Math.max(0, rem) : done ? 0 : Math.max(0, target - actual)),
      unitsPerHour: num(r['remain_qty_per_hr']) || num(r['target_qty_per_hr']) || null,
    })
    used.add(rid)
  }
  if (otherProject) notes.push(`${otherProject} TASKRSRC row${otherProject === 1 ? ' belongs' : 's belong'} to activities of another project in the file and ${otherProject === 1 ? 'was' : 'were'} not imported.`)
  if (roleOnly) notes.push(`${roleOnly} assignment${roleOnly === 1 ? ' is' : 's are'} to a role with no resource; roles are not loaded.`)
  if (!assignments.length) return null

  const resources: ScheduleResource[] = []
  for (const id of used) {
    const r = rsrcRows.get(id)
    if (!r) notes.push(`Resource ${id} is assigned but not in the RSRC table; shown by its id.`)
    resources.push({
      id, code: r?.['rsrc_short_name'] || `RSRC-${id}`, name: r?.['rsrc_name'] || r?.['rsrc_short_name'] || `Resource ${id}`,
      kind: P6_KIND[r?.['rsrc_type'] || ''] ?? 'labor',
      unit: r?.['rsrc_type'] === 'RT_Mat' ? (units.get(r['unit_id']) || null) : 'h',
      maxUnitsPerHour: maxOf(id),
      calendarId: r?.['clndr_id'] || null,
    })
  }
  resources.sort((a, b) => a.code.localeCompare(b.code))
  return { source: 'p6_xer', resources, assignments, notes }
}

/* ─── P6 XML ──────────────────────────────────────────────── */

const P6XML_KIND: Record<string, ResourceKind> = { labor: 'labor', nonlabor: 'nonlabor', material: 'material' }

/**
 * Resources and assignments of the imported project from a P6 XML (PMXML) document, with the XER
 * semantics: `tasks` maps Activity ObjectId to the parsed activity; Resource ObjectId is the resource
 * id (as XER rsrc_id); max units per hour come from ResourceRate MaxUnitsPerTime (the rate in effect
 * on the data date, else the earliest; else the Resource's own MaxUnitsPerTime); PlannedUnits is the
 * budget, ActualRegularUnits + ActualOvertimeUnits (else ActualUnits) the actual and RemainingUnits the
 * remaining units.
 */
export function p6XmlResourceData(root: XNode, project: XNode, tasks: Map<string, Activity>, dataDate: string | null): ResourceData | null {
  const rows = [...children(project, 'ResourceAssignment'), ...children(root, 'ResourceAssignment')]
  if (!rows.length) return null
  const notes: string[] = []
  const rsrcNodes = new Map<string, XNode>()
  for (const r of children(root, 'Resource')) { const id = childText(r, 'ObjectId'); if (id && !rsrcNodes.has(id)) rsrcNodes.set(id, r) }
  const units = new Map<string, string>()
  for (const u of children(root, 'UnitOfMeasure')) if (childText(u, 'ObjectId')) units.set(childText(u, 'ObjectId'), childText(u, 'Abbreviation') || childText(u, 'Name'))
  const rates = new Map<string, XNode[]>()
  for (const r of children(root, 'ResourceRate')) { const id = childText(r, 'ResourceObjectId'); if (id) rates.set(id, [...(rates.get(id) || []), r]) }
  const maxOf = (rsrcId: string): number | null => {
    const list = (rates.get(rsrcId) || []).slice().sort((a, b) => childText(a, 'EffectiveDate').localeCompare(childText(b, 'EffectiveDate')))
    const dd = dataDate || ''
    const inEffect = list.length ? ([...list].reverse().find(r => !childText(r, 'EffectiveDate') || !dd || childText(r, 'EffectiveDate').slice(0, 10) <= dd) || list[0]) : rsrcNodes.get(rsrcId)
    const v = num(childText(inEffect, 'MaxUnitsPerTime'))
    return v !== null && v > 0 ? v : null
  }

  const assignments: ResourceAssignment[] = []
  const used = new Set<string>()
  let roleOnly = 0, otherProject = 0
  for (const r of rows) {
    const act = tasks.get(childText(r, 'ActivityObjectId'))
    if (!act) { otherProject++; continue }
    const rid = childText(r, 'ResourceObjectId')
    if (!rid) { roleOnly++; continue }
    const target = num(childText(r, 'PlannedUnits')) ?? 0
    const reg = num(childText(r, 'ActualRegularUnits')), ot = num(childText(r, 'ActualOvertimeUnits'))
    const actual = reg !== null || ot !== null ? (reg ?? 0) + (ot ?? 0) : num(childText(r, 'ActualUnits')) ?? 0
    const done = act.status === 'complete' || !!act.actualFinish
    const rem = num(childText(r, 'RemainingUnits'))
    assignments.push({
      activityId: act.id, sourceKey: act.sourceId ?? childText(r, 'ActivityObjectId'), activityCode: act.activityId, resourceId: rid,
      budgetUnits: round2(target), actualUnits: round2(actual),
      remainingUnits: round2(rem !== null ? Math.max(0, rem) : done ? 0 : Math.max(0, target - actual)),
      unitsPerHour: num(childText(r, 'RemainingUnitsPerTime')) || num(childText(r, 'PlannedUnitsPerTime')) || null,
    })
    used.add(rid)
  }
  if (otherProject) notes.push(`${otherProject} ResourceAssignment${otherProject === 1 ? ' belongs' : 's belong'} to activities of another project in the file and ${otherProject === 1 ? 'was' : 'were'} not imported.`)
  if (roleOnly) notes.push(`${roleOnly} assignment${roleOnly === 1 ? ' is' : 's are'} to a role with no resource; roles are not loaded.`)
  if (!assignments.length) return null

  const resources: ScheduleResource[] = []
  for (const id of used) {
    const r = rsrcNodes.get(id)
    if (!r) notes.push(`Resource ${id} is assigned but not in the file's resources; shown by its id.`)
    const kind = P6XML_KIND[childText(r, 'ResourceType').toLowerCase().replace(/[^a-z]/g, '')] ?? 'labor'
    resources.push({
      id, code: childText(r, 'Id') || `RSRC-${id}`, name: childText(r, 'Name') || childText(r, 'Id') || `Resource ${id}`,
      kind,
      unit: kind === 'material' ? (units.get(childText(r, 'UnitOfMeasureObjectId')) || null) : 'h',
      maxUnitsPerHour: maxOf(id),
      calendarId: childText(r, 'CalendarObjectId') || null,
    })
  }
  resources.sort((a, b) => a.code.localeCompare(b.code))
  return { source: 'p6_xml', resources, assignments, notes }
}

/* ─── MS Project XML ─────────────────────────────────────── */

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}
function blocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g')
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) out.push(m[1])
  return out
}
function strip(xml: string, tags: string[]): string {
  let out = xml
  for (const t of tags) out = out.replace(new RegExp(`<${t}(?:\\s[^>]*)?>[\\s\\S]*?</${t}>`, 'g'), '')
  return out
}
function text(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`))
  return m ? decodeXml(m[1].trim()) : ''
}
/** "PT80H0M0S" → hours (a "D" component counts as `hpd` hours). */
function ptHours(v: string, hpd: number): number | null {
  const m = v.trim().match(/^(-)?P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/)
  if (!m) return num(v)
  const h = (m[2] ? +m[2] * hpd : 0) + (m[3] ? +m[3] : 0) + (m[4] ? +m[4] / 60 : 0) + (m[5] ? +m[5] / 3600 : 0)
  return m[1] ? -h : h
}

/**
 * Work and material resources and their assignments from an MS Project XML. `tasks` maps task UID to
 * the parsed activity. Cost resources and the "unassigned" placeholder are skipped. MaxUnits is a
 * fraction of one unit per hour (1 = 100%); a resource whose Group says equipment is read as nonlabor.
 */
export function mspResourceData(xml: string, tasks: Map<string, Activity>, hoursPerDay: number): ResourceData | null {
  const asgBlock = xml.match(/<Assignments(?:\s[^>]*)?>([\s\S]*?)<\/Assignments>/)?.[1]
  if (!asgBlock) return null
  const resBlock = xml.match(/<Resources(?:\s[^>]*)?>([\s\S]*?)<\/Resources>/)?.[1] || ''
  const notes: string[] = []
  const resById = new Map<string, ScheduleResource>()
  let costResources = 0
  for (const b of blocks(resBlock, 'Resource')) {
    const own = strip(b, ['Baseline', 'ExtendedAttribute', 'AvailabilityPeriods', 'Rates', 'TimephasedData', 'WorkingTimes'])
    const uid = text(own, 'UID'), name = text(own, 'Name')
    if (!uid || !name || text(own, 'IsNull') === '1') continue
    const type = text(own, 'Type')
    if (type === '2') { costResources++; continue }
    const group = text(own, 'Group')
    const kind: ResourceKind = type === '0' ? 'material' : /equip|non\s*-?labou?r|plant/i.test(group) ? 'nonlabor' : 'labor'
    const max = num(text(own, 'MaxUnits'))
    const cal = text(own, 'CalendarUID')
    resById.set(uid, {
      id: uid, code: text(own, 'Initials') || name, name, kind,
      unit: kind === 'material' ? (text(own, 'MaterialLabel') || null) : 'h',
      maxUnitsPerHour: kind === 'material' ? null : max !== null && max > 0 ? max : null,
      calendarId: cal && cal !== '-1' ? cal : null,
    })
  }
  if (costResources) notes.push(`${costResources} cost resource${costResources === 1 ? ' was' : 's were'} skipped (no units to load).`)
  const assignments: ResourceAssignment[] = []
  const used = new Set<string>()
  let unmatched = 0
  for (const b of blocks(asgBlock, 'Assignment')) {
    const own = strip(b, ['Baseline', 'ExtendedAttribute', 'TimephasedData'])
    const rid = text(own, 'ResourceUID')
    const act = tasks.get(text(own, 'TaskUID'))
    const res = resById.get(rid)
    if (!act || !res) { if (rid !== '-65535' && rid !== '') unmatched++; continue }
    const work = ptHours(text(own, 'Work'), hoursPerDay) ?? 0
    const actual = ptHours(text(own, 'ActualWork'), hoursPerDay) ?? 0
    const remTxt = text(own, 'RemainingWork')
    const rem = remTxt ? ptHours(remTxt, hoursPerDay) : null
    const done = act.status === 'complete' || !!act.actualFinish
    assignments.push({
      activityId: act.id, sourceKey: act.sourceId, activityCode: act.activityId, resourceId: rid,
      budgetUnits: round2(work), actualUnits: round2(actual),
      remainingUnits: round2(rem !== null ? Math.max(0, rem) : done ? 0 : Math.max(0, work - actual)),
      unitsPerHour: num(text(own, 'Units')),
    })
    used.add(rid)
  }
  if (unmatched) notes.push(`${unmatched} assignment${unmatched === 1 ? '' : 's'} named a task or resource that is not in the file and ${unmatched === 1 ? 'was' : 'were'} skipped.`)
  if (!assignments.length) return null
  const resources = [...used].map(id => resById.get(id)!).sort((a, b) => a.code.localeCompare(b.code))
  return { source: 'ms_xml', resources, assignments, notes }
}

/* ─── Spreadsheets ───────────────────────────────────────── */

/** "Carpenters[200%]; Laborers" / "Crew A, Crew B" → names with units per hour (MS Project style brackets). */
export function splitResourceCell(cell: string): { name: string; unitsPerHour: number | null }[] {
  return cell.split(/[;,\n]+/).map(s => s.trim()).filter(Boolean).map(s => {
    const m = s.match(/^(.*?)\s*\[\s*(\d+(?:\.\d+)?)\s*(%)?\s*\]\s*$/)
    if (!m) return { name: s, unitsPerHour: null }
    const v = parseFloat(m[2])
    return { name: m[1].trim(), unitsPerHour: m[3] ? v / 100 : v }
  }).filter(x => x.name)
}

/** Units from a cell: 120, "120", "120 h", "120 hrs". */
export function unitsCell(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const m = v.trim().replace(/,/g, '').match(/^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|mh|manhours)?\.?$/i)
  return m ? parseFloat(m[1]) : null
}

/**
 * Resources from spreadsheet columns ("Resource Names", "Budgeted Units" / "Labor Hours"). Without a
 * units column, each named resource is assumed to work the activity's full duration at its bracketed
 * units (1 when none) for 8 hours a day; actual units follow percent complete. Both are stated.
 */
export function spreadsheetResourceData(rows: { act: Activity; resources: string; units: unknown; hoursPerDay: number }[], source: 'excel' | 'csv'): ResourceData | null {
  const resById = new Map<string, ScheduleResource>()
  const assignments: ResourceAssignment[] = []
  let derived = 0, split = 0
  for (const r of rows) {
    if (!r.resources.trim() || r.act.activityType === 'milestone' || r.act.activityType === 'summary') continue
    const names = splitResourceCell(r.resources)
    if (!names.length) continue
    const given = unitsCell(r.units)
    if (given !== null && names.length > 1) split++
    for (const n of names) {
      const id = n.name
      if (!resById.has(id)) resById.set(id, { id, code: n.name, name: n.name, kind: 'labor', unit: 'h', maxUnitsPerHour: null, calendarId: null })
      const uph = n.unitsPerHour ?? 1
      let budget: number
      if (given !== null) budget = given / names.length
      else { budget = Math.max(0, r.act.duration) * r.hoursPerDay * uph; derived++ }
      const pct = Math.max(0, Math.min(100, r.act.status === 'complete' ? 100 : r.act.percentComplete || 0))
      const actual = budget * pct / 100
      assignments.push({
        activityId: r.act.id, sourceKey: r.act.sourceId, activityCode: r.act.activityId, resourceId: id,
        budgetUnits: round2(budget), actualUnits: round2(actual), remainingUnits: round2(budget - actual), unitsPerHour: n.unitsPerHour,
      })
    }
  }
  if (!assignments.length) return null
  const notes: string[] = []
  if (derived) notes.push(`${derived} assignment${derived === 1 ? ' has' : 's have'} no units column value; Planora assumed the resource works the whole duration, 8 hours a day at its bracketed units (1 when none).`)
  if (split) notes.push(`${split} row${split === 1 ? ' names' : 's name'} several resources with one units value; the units were split evenly between them.`)
  notes.push('Spreadsheet actual units follow percent complete (the sheet has no actual units).')
  return { source, resources: [...resById.values()].sort((a, b) => a.code.localeCompare(b.code)), assignments, notes }
}
