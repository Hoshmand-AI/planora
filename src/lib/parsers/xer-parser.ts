// Primavera P6 XER File Parser
// XER is a tab-separated text format: %T table, %F field names, %R rows, %E end.

import type { Activity, Relationship } from '@/lib/db'
import type { ConstraintType, ProgressMode, Weekday, WorkCalendar } from '@/lib/planning/types'
import type { EmbeddedBaseline } from '@/lib/analysis/baseline'
import { randomUUID as uuid } from 'crypto'
import {
  ParsedSchedule, makeActivity, isoDatePrefix, serialToIso, round2, constraintFromLabel,
} from './types'
import { ExceptionCollector, wasRounded, type ExceptionEntity, type ExceptionSeverity } from './exceptions'

type Row = Record<string, string>

export function parseXER(content: string, scheduleId: string, opts: { projectId?: string | null } = {}): ParsedSchedule {
  const warnings: string[] = []
  const ex = new ExceptionCollector('import', 'p6_xer')
  const tables = readTables(content)

  /* ── Project ─────────────────────────────────────────── */
  const projects = tables['PROJECT'] || []
  // A P6 export often carries the update together with its baseline project(s). Import one project:
  // the requested one, else a non-baseline project (no orig_proj_id) with the most activities.
  const taskCount = (pid: string) => (tables['TASK'] || []).filter(t => !t['proj_id'] || t['proj_id'] === pid).length
  const candidates = projects.filter(p => !p['orig_proj_id'])
  const pool = candidates.length ? candidates : projects
  const project = (opts.projectId && projects.find(p => p['proj_id'] === opts.projectId || p['proj_short_name'] === opts.projectId))
    || [...pool].sort((a, b) => taskCount(b['proj_id']) - taskCount(a['proj_id']))[0] || {}
  const projId = project['proj_id'] || null
  if (projects.length > 1) {
    const others = projects.filter(p => p !== project).map(p => `"${p['proj_short_name'] || p['proj_id']}"${p['orig_proj_id'] ? ' (baseline)' : ''}`)
    warnings.push(`XER contains ${projects.length} projects; imported "${project['proj_short_name'] || projId}" only. Not imported: ${others.join(', ')}.`)
    ex.add({ severity: 'warning', entity: 'project', field: 'PROJECT', disposition: 'preserved_in_raw', count: others.length, examples: projects.filter(p => p !== project).map(p => p['proj_short_name'] || p['proj_id']),
      message: `Only "${project['proj_short_name'] || projId}" was imported; the other projects (and their activities) stay in the original file` })
  }
  const inProject = (r: Row) => !projId || !r['proj_id'] || r['proj_id'] === projId
  const embeddedBaseline = projId ? embeddedBaselineOf(projects, project, tables['TASK'] || []) : null
  if (embeddedBaseline) warnings.push(`The file carries the P6 project baseline "${embeddedBaseline.name}" (${Object.keys(embeddedBaseline.finishes).length} activities); variance, BEI and missed tasks are measured against it unless an upload of this project is designated as Baseline.`)
  if (projId) {
    const otherTasks = (tables['TASK'] || []).filter(t => !inProject(t))
    if (otherTasks.length) ex.add({ severity: 'warning', entity: 'activity', field: 'TASK (other projects)', disposition: 'preserved_in_raw', count: otherTasks.length, examples: otherTasks.map(t => t['task_code'] || t['task_id']), message: 'Activities of the projects not imported' })
    tables['TASK'] = (tables['TASK'] || []).filter(inProject)
    tables['PROJWBS'] = (tables['PROJWBS'] || []).filter(inProject)
    const keep = new Set(tables['TASK'].map(t => t['task_id']))
    tables['TASKPRED'] = (tables['TASKPRED'] || []).filter(p => keep.has(p['task_id']))
  }
  const projectName = project['proj_short_name'] || project['proj_long_name'] || 'Imported Schedule'
  const projectKey = project['proj_short_name'] || project['proj_id'] || null
  const projectStart = isoDatePrefix(project['plan_start_date'])
  const dataDate = isoDatePrefix(project['last_recalc_date']) || isoDatePrefix(project['next_data_date']) || projectStart
  const projectFinish = isoDatePrefix(project['scd_end_date']) || isoDatePrefix(project['plan_end_date'])
  // P6 stores the project's "Must Finish By" date in plan_end_date.
  const mustFinishBy = isoDatePrefix(project['plan_end_date'])

  /* ── Calendars ───────────────────────────────────────── */
  const calendars: WorkCalendar[] = []
  const calById = new Map<string, WorkCalendar>()
  let defaultCalFlag: string | null = null
  for (const c of tables['CALENDAR'] || []) {
    const id = c['clndr_id']
    if (!id) continue
    const cal = parseCalendarRow(c, warnings, ex)
    calendars.push(cal)
    calById.set(id, cal)
    if (c['default_flag'] === 'Y' && !defaultCalFlag) defaultCalFlag = id
  }
  let defaultCalendarId: string | null = null
  if (project['clndr_id'] && calById.has(project['clndr_id'])) defaultCalendarId = project['clndr_id']
  else if (defaultCalFlag) defaultCalendarId = defaultCalFlag
  else if (calendars.length) defaultCalendarId = calendars[0].id

  const hoursPerDay = (clndrId: string | undefined | null): number => {
    const cal = (clndrId && calById.get(clndrId)) || (defaultCalendarId ? calById.get(defaultCalendarId) : undefined)
    return cal && cal.hoursPerDay > 0 ? cal.hoursPerDay : 8
  }

  /* ── WBS ─────────────────────────────────────────────── */
  const wbsRows = new Map<string, Row>()
  for (const w of tables['PROJWBS'] || []) if (w['wbs_id']) wbsRows.set(w['wbs_id'], w)
  const wbsCache = new Map<string, string>()
  const wbsPath = (wbsId: string): string => {
    if (!wbsId) return ''
    const cached = wbsCache.get(wbsId)
    if (cached !== undefined) return cached
    const parts: string[] = []
    const seen = new Set<string>()
    let cur = wbsRows.get(wbsId)
    while (cur && !seen.has(cur['wbs_id'])) {
      seen.add(cur['wbs_id'])
      if (cur['proj_node_flag'] === 'Y') break // project root node, not part of the path
      parts.unshift(cur['wbs_short_name'] || cur['wbs_name'] || cur['wbs_id'])
      cur = wbsRows.get(cur['parent_wbs_id'])
    }
    const leaf = wbsRows.get(wbsId)
    let path = parts.join('.')
    if (!wbsRows.has(wbsId)) path = wbsId
    else if (leaf && leaf['wbs_name'] && leaf['wbs_name'] !== leaf['wbs_short_name'] && leaf['proj_node_flag'] !== 'Y') path = `${path} ${leaf['wbs_name']}`
    wbsCache.set(wbsId, path)
    return path
  }

  /* ── Activities ──────────────────────────────────────── */
  // task_id is P6's primary key; a repeated one means a hand-edited or merged file. Keep the first row.
  const seenTaskIds = new Set<string>()
  const duplicates: string[] = []
  const tasks = (tables['TASK'] || []).filter(t => {
    const id = t['task_id']
    if (!id) return true
    if (seenTaskIds.has(id)) { duplicates.push(`${id}${t['task_code'] ? ` (${t['task_code']})` : ''}`); return false }
    seenTaskIds.add(id)
    return true
  })
  if (duplicates.length) {
    warnings.push(`TASK table repeats task_id ${duplicates.slice(0, 10).join(', ')}${duplicates.length > 10 ? ` and ${duplicates.length - 10} more` : ''}; only the first row of each was imported.`)
    ex.add({ severity: 'loss', entity: 'activity', field: 'TASK.task_id', disposition: 'dropped', count: duplicates.length, examples: duplicates, message: 'Repeated task_id rows; only the first row of each was imported' })
  }
  const byTaskId = new Map<string, Activity>()
  const activities: Activity[] = tasks.map(t => {
    const clndrId = t['clndr_id'] || defaultCalendarId
    const code = t['task_code'] || t['task_id']
    if (t['clndr_id'] && !calById.has(t['clndr_id'])) {
      warnings.push(`Activity ${t['task_code']}: calendar ${t['clndr_id']} not found in CALENDAR table; using ${hoursPerDay(null)}h/day`)
      ex.add({ severity: 'warning', entity: 'calendar', field: 'TASK.clndr_id', disposition: 'defaulted', example: code, message: `Activity calendar not in the CALENDAR table; the project default calendar's hours per day were used` })
    }
    const hpd = hoursPerDay(clndrId)
    const hrs = (v: string | undefined, field?: string) => {
      if (v === undefined || v === '') return null
      const exact = parseFloat(v) / hpd
      const r = round2(exact)
      if (field && wasRounded(exact, r)) ex.add({ severity: 'info', entity: 'activity', field, disposition: 'converted', example: code, message: 'Hours converted to work days on the activity calendar and rounded to 0.01 day' })
      return r
    }

    let status: Activity['status'] = 'not_started'
    if (t['status_code'] === 'TK_Complete') status = 'complete'
    else if (t['status_code'] === 'TK_Active') status = 'in_progress'

    let pct = parseFloat(t['phys_complete_pct'] || t['complete_pct'] || '0') || 0
    if (pct < 0 || pct > 100) {
      warnings.push(`Activity ${t['task_code'] || t['task_id']}: percent complete ${pct} is outside 0–100; set to ${pct < 0 ? 0 : 100}`)
      ex.add({ severity: 'warning', entity: 'activity', field: 'TASK.phys_complete_pct', disposition: 'converted', example: code, message: 'Percent complete outside 0–100 was clamped' })
      pct = pct < 0 ? 0 : 100
    }
    if (status === 'complete' && pct === 0) pct = 100
    const pctType = t['complete_pct_type']
    if (pctType && pctType !== 'CP_Phys') ex.add({ severity: 'warning', entity: 'activity', field: 'TASK.complete_pct_type', disposition: 'converted', example: code, message: `Percent complete type ${pctType === 'CP_Drtn' ? 'Duration' : pctType === 'CP_Units' ? 'Units' : pctType} is not modeled; Planora reads the physical % complete and the remaining duration` })
    if (t['task_type'] === 'TT_Rsrc') ex.add({ severity: 'warning', entity: 'activity', field: 'TASK.task_type', disposition: 'converted', example: code, message: 'Resource dependent activities are scheduled as task dependent (on the activity calendar, not resource calendars)' })

    let activityType: Activity['activityType'] = 'task'
    let milestoneKind: Activity['milestoneKind'] = null
    if (t['task_type'] === 'TT_Mile' || t['task_type'] === 'TT_FinMile') {
      activityType = 'milestone'
      // P6 start milestones (TT_Mile) occur at the start of their day, finish milestones at the end
      milestoneKind = t['task_type'] === 'TT_Mile' ? 'start' : 'finish'
    }
    else if (t['task_type'] === 'TT_LOE') activityType = 'loe'
    else if (t['task_type'] === 'TT_WBS') activityType = 'summary'

    const tf = hrs(t['total_float_hr_cnt'])
    const ff = hrs(t['free_float_hr_cnt'])

    let constraintType: ConstraintType | null = null
    let constraintDate: string | null = null
    const cstr = t['cstr_type']
    if (cstr) {
      const mapped = constraintFromLabel(cstr)
      if (mapped === 'ALAP') {
        warnings.push(`Activity ${t['task_code']}: As Late As Possible constraint is not modeled; ignored`)
        ex.add({ severity: 'loss', entity: 'constraint', field: 'TASK.cstr_type=CS_ALAP', disposition: 'dropped', example: code, message: 'As Late As Possible is not modeled; the activity is scheduled as soon as possible' })
      } else if (mapped) {
        constraintType = mapped
        constraintDate = isoDatePrefix(t['cstr_date'])
        if (!constraintDate) {
          warnings.push(`Activity ${t['task_code']}: constraint ${cstr} has no date; ignored`)
          ex.add({ severity: 'loss', entity: 'constraint', field: 'TASK.cstr_date', disposition: 'dropped', example: code, message: 'Constraint without a date was ignored' })
        }
        if (!constraintDate) constraintType = null
      } else {
        warnings.push(`Activity ${t['task_code']}: unrecognized constraint type "${cstr}"`)
        ex.add({ severity: 'loss', entity: 'constraint', field: 'TASK.cstr_type', disposition: 'dropped', example: `${code} (${cstr})`, message: 'Unrecognized constraint type was ignored' })
      }
    }
    if (t['cstr_type2']) {
      warnings.push(`Activity ${t['task_code']}: secondary constraint ${t['cstr_type2']} ignored`)
      ex.add({ severity: 'loss', entity: 'constraint', field: 'TASK.cstr_type2', disposition: 'dropped', example: `${code} (${t['cstr_type2']})`, message: 'Secondary constraints are not modeled; only the primary constraint is used' })
    }

    const a = makeActivity(scheduleId, {
      activityId: t['task_code'] || t['task_id'] || '',
      name: t['task_name'] || 'Unnamed Activity',
      wbs: wbsPath(t['wbs_id'] || ''),
      duration: hrs(t['target_drtn_hr_cnt'], 'TASK.target_drtn_hr_cnt') ?? 0,
      remainingDuration: hrs(t['remain_drtn_hr_cnt'], 'TASK.remain_drtn_hr_cnt') ?? 0,
      percentComplete: pct,
      earlyStart: isoDatePrefix(t['early_start_date']) || isoDatePrefix(t['restart_date']),
      earlyFinish: isoDatePrefix(t['early_end_date']) || isoDatePrefix(t['reend_date']),
      lateStart: isoDatePrefix(t['late_start_date']),
      lateFinish: isoDatePrefix(t['late_end_date']),
      actualStart: isoDatePrefix(t['act_start_date']),
      actualFinish: isoDatePrefix(t['act_end_date']),
      baselineStart: isoDatePrefix(t['target_start_date']),
      baselineFinish: isoDatePrefix(t['target_end_date']),
      totalFloat: tf ?? 0,
      freeFloat: ff ?? 0,
      // Level of effort and WBS summary activities are never critical (P6 excludes them from the critical path).
      isCritical: activityType !== 'loe' && activityType !== 'summary' && (t['driving_path_flag'] === 'Y' || (tf !== null && tf <= 0 && status !== 'complete')),
      status,
      activityType,
      milestoneKind,
      calendarId: clndrId || null,
      constraintType,
      constraintDate: constraintType ? constraintDate : null,
      sourceId: t['task_id'] || null,
    })
    if (t['task_id']) byTaskId.set(t['task_id'], a)
    return a
  })

  /* ── Relationships ───────────────────────────────────── */
  const relationships: Relationship[] = []
  for (const p of tables['TASKPRED'] || []) {
    const pred = byTaskId.get(p['pred_task_id'])
    const succ = byTaskId.get(p['task_id'])
    if (!pred || !succ) {
      warnings.push(`Relationship ${p['pred_task_id']} → ${p['task_id']} references an activity not in this file (external project?); skipped`)
      ex.add({ severity: 'loss', entity: 'relationship', field: 'TASKPRED', disposition: 'dropped', example: `${p['pred_task_id']} -> ${p['task_id']}`, message: 'Relationship to an activity not in the imported project (external project?) was skipped' })
      continue
    }
    const t = (p['pred_type'] || 'PR_FS').replace('PR_', '')
    const type: Relationship['type'] = t === 'SS' || t === 'FF' || t === 'SF' ? t : 'FS'
    if (p['pred_type'] && !['PR_FS', 'PR_SS', 'PR_FF', 'PR_SF'].includes(p['pred_type'])) ex.add({ severity: 'warning', entity: 'relationship', field: 'TASKPRED.pred_type', disposition: 'converted', example: `${pred.activityId} -> ${succ.activityId} (${p['pred_type']})`, message: 'Unknown relationship type read as finish-to-start' })
    // P6's default lag calendar is the predecessor's ("Calendar for scheduling relationship lag")
    const lagExact = (parseFloat(p['lag_hr_cnt'] || '0') || 0) / hoursPerDay(pred.calendarId)
    const lag = round2(lagExact)
    if (wasRounded(lagExact, lag)) ex.add({ severity: 'info', entity: 'relationship', field: 'TASKPRED.lag_hr_cnt', disposition: 'converted', example: `${pred.activityId} -> ${succ.activityId}`, message: 'Lag hours converted to work days on the predecessor calendar and rounded to 0.01 day' })
    relationships.push({ id: uuid(), scheduleId, predecessorId: pred.id, successorId: succ.id, type, lag })
  }

  // Tables Planora does not model. They stay in the stored original file and the .xer export of this
  // upload passes them through unchanged (see exportXerFromOriginal); other exports leave them out.
  const notModeled = Object.keys(tables).filter(t => !MODELED_TABLES.has(t) && tables[t].length > 0)
  for (const t of notModeled) {
    const [entity, severity] = TABLE_ENTITY[t] ?? ['other', 'info']
    ex.add({ severity, entity, field: t, disposition: 'preserved_in_raw', count: tables[t].length, examples: tables[t].map(rowKey),
      message: `${TABLE_LABELS[t] ? `${TABLE_LABELS[t][0].toUpperCase()}${TABLE_LABELS[t].slice(1)}` : `Table ${t}`}: not used by Planora; kept in the original file and in this upload's P6 (.xer) export, not in the MS Project, Excel or CSV exports` })
  }
  // Fields of the tables Planora reads that carry data it does not map.
  for (const [table, read] of Object.entries(READ_FIELDS)) {
    const rows = tables[table] || []
    if (!rows.length) continue
    const fields = new Set<string>()
    for (const r of rows) for (const f of Object.keys(r)) if (!read.has(f) && r[f] !== '') fields.add(f)
    for (const f of fields) {
      const withValue = rows.filter(r => r[f] !== '')
      const [entity, severity] = FIELD_ENTITY[`${table}.${f}`] ?? [TABLE_ENTITY[table]?.[0] ?? 'other', 'info' as ExceptionSeverity]
      ex.add({ severity, entity, field: `${table}.${f}`, disposition: 'preserved_in_raw', count: withValue.length, examples: withValue.map(r => r['task_code'] || rowKey(r)),
        message: FIELD_NOTES[`${table}.${f}`] ?? 'Field not mapped by Planora; kept in the original file and in this upload\'s P6 (.xer) export' })
    }
  }
  if (notModeled.length) {
    warnings.push(`Not used in Planora's analysis: ${notModeled.map(t => `${t} (${tables[t].length} ${tables[t].length === 1 ? 'row' : 'rows'}${TABLE_LABELS[t] ? `, ${TABLE_LABELS[t]}` : ''})`).join('; ')}. They are kept in the original file and in this upload's P6 (.xer) export, but not in the MS Project, Excel or CSV exports.`)
  }

  /* ── Scheduling options (P6 SCHEDOPTIONS) ─────────────── */
  const opt = (tables['SCHEDOPTIONS'] || []).find(o => !projId || !o['proj_id'] || o['proj_id'] === projId)
  const progressMode = progressModeFromSchedOptions(opt)
  if (opt && !progressMode) {
    warnings.push('The file schedules out-of-sequence progress with P6 "Actual Dates", which Planora does not model; Planora uses Retained Logic. Choose Progress Override for this upload if that matches your P6 settings better.')
    ex.add({ severity: 'warning', entity: 'project', field: 'SCHEDOPTIONS.sched_retained_logic', disposition: 'converted', example: project['proj_short_name'] || projId, message: 'Out-of-sequence progress "Actual Dates" is not modeled; Retained Logic is used' })
  }
  const lagCal = opt?.['sched_calendar_on_relationship_lag']
  if (lagCal && !/predecessor/i.test(lagCal)) ex.add({ severity: 'warning', entity: 'relationship', field: 'SCHEDOPTIONS.sched_calendar_on_relationship_lag', disposition: 'converted', example: lagCal, message: 'Lags are converted and scheduled on the predecessor calendar (P6 default); the file schedules lags on another calendar' })

  return {
    projectName, dataDate, projectStart, projectFinish, mustFinishBy, projectKey, progressMode,
    planoraExport: isPlanoraXer(content),
    activities, relationships, calendars, defaultCalendarId, warnings,
    exceptions: ex.report(),
    sourceType: 'p6_xer', embeddedBaseline,
    resourceCounts: tables['TASKRSRC'] ? resourceCountsFrom(tables['TASKRSRC'], tasks) : undefined,
    sourceTables: Object.keys(tables),
  }
}

/**
 * The P6 project baseline exported in the same XER as the imported project: the project its
 * sum_base_proj_id names, else a project whose orig_proj_id points at the imported one. Its TASK
 * dates by task_code are the per-activity baseline: P6 "BL Project Start/Finish" = the actual date
 * once the activity started/finished in the baseline, else its planned (target) date.
 */
export function embeddedBaselineOf(projects: Row[], project: Row, tasks: Row[]): EmbeddedBaseline | null {
  const pid = project['proj_id']
  if (!pid) return null
  const base = (project['sum_base_proj_id'] && project['sum_base_proj_id'] !== pid && projects.find(p => p['proj_id'] === project['sum_base_proj_id']))
    || projects.find(p => p['proj_id'] && p['proj_id'] !== pid && p['orig_proj_id'] === pid)
  if (!base) return null
  const starts: Record<string, string> = {}
  const finishes: Record<string, string> = {}
  for (const t of tasks) {
    if (t['proj_id'] !== base['proj_id'] || !t['task_code'] || t['task_type'] === 'TT_LOE' || t['task_type'] === 'TT_WBS') continue
    const st = isoDatePrefix(t['act_start_date']) || isoDatePrefix(t['target_start_date']) || isoDatePrefix(t['early_start_date'])
    const fi = isoDatePrefix(t['act_end_date']) || isoDatePrefix(t['target_end_date']) || isoDatePrefix(t['early_end_date'])
    if (st) starts[t['task_code']] = st
    if (fi) finishes[t['task_code']] = fi
  }
  if (!Object.keys(finishes).length) return null
  return {
    projectId: base['proj_id'], name: base['proj_short_name'] || base['proj_long_name'] || base['proj_id'],
    dataDate: isoDatePrefix(base['last_recalc_date']) || isoDatePrefix(base['next_data_date']) || null, starts, finishes,
  }
}

/**
 * P6 "When scheduling progressed activities use": Retained Logic (sched_retained_logic = Y), Progress
 * Override (sched_progress_override = Y) or Actual Dates (both N, returned as null: not modeled).
 */
export function progressModeFromSchedOptions(opt: Row | undefined | null): ProgressMode | null {
  if (!opt) return null
  const yes = (v: string | undefined) => (v || '').trim().toUpperCase() === 'Y'
  if (yes(opt['sched_progress_override'])) return 'override'
  if (yes(opt['sched_retained_logic'])) return 'retained'
  return null
}

/**
 * True when the XER was written by Planora's own exporter (its ERMHDR names Planora as the exporting
 * application), so a re-import is recognized as Planora's output rather than the project's record.
 */
export function isPlanoraXer(content: string): boolean {
  const first = content.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/, 1)[0] || ''
  const cols = first.split('\t')
  return cols[0].trim() === 'ERMHDR' && cols[5]?.trim() === 'Planora'
}

const MODELED_TABLES = new Set(['CALENDAR', 'PROJECT', 'PROJWBS', 'TASK', 'TASKPRED', 'SCHEDOPTIONS'])

/** Fields the importer reads from the tables it models; anything else with a value is reported. */
const READ_FIELDS: Record<string, Set<string>> = {
  PROJECT: new Set(['proj_id', 'proj_short_name', 'proj_long_name', 'plan_start_date', 'plan_end_date', 'scd_end_date', 'last_recalc_date', 'next_data_date', 'clndr_id', 'orig_proj_id', 'sum_base_proj_id']),
  CALENDAR: new Set(['clndr_id', 'clndr_name', 'clndr_data', 'default_flag', 'day_hr_cnt', 'proj_id']),
  PROJWBS: new Set(['wbs_id', 'proj_id', 'wbs_short_name', 'wbs_name', 'parent_wbs_id', 'proj_node_flag']),
  TASK: new Set(['task_id', 'proj_id', 'wbs_id', 'clndr_id', 'task_code', 'task_name', 'status_code', 'phys_complete_pct', 'complete_pct', 'complete_pct_type', 'task_type',
    'total_float_hr_cnt', 'free_float_hr_cnt', 'cstr_type', 'cstr_date', 'cstr_type2', 'target_drtn_hr_cnt', 'remain_drtn_hr_cnt', 'early_start_date', 'early_end_date',
    'restart_date', 'reend_date', 'late_start_date', 'late_end_date', 'act_start_date', 'act_end_date', 'target_start_date', 'target_end_date', 'driving_path_flag']),
  TASKPRED: new Set(['task_pred_id', 'task_id', 'pred_task_id', 'proj_id', 'pred_proj_id', 'pred_type', 'lag_hr_cnt']),
  SCHEDOPTIONS: new Set(['schedoptions_id', 'proj_id', 'sched_retained_logic', 'sched_progress_override', 'sched_calendar_on_relationship_lag']),
}
/** Entity and severity of the tables Planora does not model. */
const TABLE_ENTITY: Record<string, [ExceptionEntity, ExceptionSeverity]> = {
  ACTVTYPE: ['code', 'warning'], ACTVCODE: ['code', 'warning'], TASKACTV: ['code', 'warning'], PCATTYPE: ['code', 'info'], PCATVAL: ['code', 'info'], PROJPCAT: ['code', 'info'],
  RCATTYPE: ['code', 'info'], RCATVAL: ['code', 'info'], RSRCRCAT: ['code', 'info'],
  UDFTYPE: ['udf', 'warning'], UDFVALUE: ['udf', 'warning'],
  RSRC: ['resource', 'warning'], RSRCRATE: ['resource', 'info'], ROLES: ['resource', 'info'], ROLERATE: ['resource', 'info'], RSRCROLE: ['resource', 'info'], RSRCCURVDATA: ['resource', 'info'],
  TASKRSRC: ['assignment', 'warning'],
  ACCOUNT: ['other', 'info'], PROJCOST: ['other', 'info'], COSTTYPE: ['other', 'info'], FINDATES: ['other', 'info'], TRSRCFIN: ['other', 'info'], TASKFIN: ['other', 'info'],
  CURRTYPE: ['other', 'info'], TASKMEMO: ['activity', 'info'], MEMOTYPE: ['activity', 'info'], TASKPROC: ['activity', 'info'], OBS: ['other', 'info'],
  PROJWBS: ['activity', 'info'], TASK: ['activity', 'info'], TASKPRED: ['relationship', 'info'], CALENDAR: ['calendar', 'info'], PROJECT: ['project', 'info'], SCHEDOPTIONS: ['project', 'info'],
}
const FIELD_ENTITY: Record<string, [ExceptionEntity, ExceptionSeverity]> = {
  'TASK.cstr_date2': ['constraint', 'loss'], 'TASK.duration_type': ['activity', 'info'], 'TASK.float_path': ['activity', 'info'],
  'TASK.expect_end_date': ['activity', 'warning'], 'TASK.suspend_date': ['activity', 'warning'], 'TASK.resume_date': ['activity', 'warning'],
  'TASK.rsrc_id': ['resource', 'info'], 'CALENDAR.base_clndr_id': ['calendar', 'info'], 'PROJWBS.seq_num': ['activity', 'info'],
}
const FIELD_NOTES: Record<string, string> = {
  'TASK.cstr_date2': 'Secondary constraint dates are not modeled',
  'TASK.expect_end_date': 'Expected finish is not modeled; the remaining duration is used',
  'TASK.suspend_date': 'Suspend / resume dates are not modeled',
  'TASK.resume_date': 'Suspend / resume dates are not modeled',
  'CALENDAR.base_clndr_id': 'Base calendar link not kept; the calendar\'s own work week and exceptions are used',
}
/** Fields that identify a row to a scheduler, most telling first. */
const ROW_KEYS = ['task_code', 'wbs_short_name', 'proj_short_name', 'rsrc_short_name', 'role_short_name', 'short_name', 'clndr_name', 'actv_code_type', 'udf_type_label', 'acct_short_name', 'memo_type', 'fk_id', 'task_id']
/** A short identifier for a row of any table: a known name / code field, else its first *_id. */
function rowKey(r: Row): string {
  const k = ROW_KEYS.find(f => r[f]) || Object.keys(r).find(f => /_id$/.test(f) && r[f]) || Object.keys(r)[0]
  return k ? r[k] : ''
}
const TABLE_LABELS: Record<string, string> = {
  ACTVTYPE: 'activity code types', ACTVCODE: 'activity code values', TASKACTV: 'activity code assignments',
  UDFTYPE: 'user-defined fields', UDFVALUE: 'user-defined field values', RSRC: 'resources', TASKRSRC: 'resource assignments',
  ACCOUNT: 'cost accounts', PROJCOST: 'expenses', TASKMEMO: 'notebooks', MEMOTYPE: 'notebook topics', ROLES: 'roles',
  RSRCRATE: 'resource rates', OBS: 'OBS', CURRTYPE: 'currencies', SCHEDOPTIONS: 'scheduling options', TASKPROC: 'steps',
}

function resourceCountsFrom(rows: Row[], tasks: Row[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const t of tasks) if (t['task_id']) counts[t['task_id']] = 0
  for (const r of rows) if (r['task_id'] && r['task_id'] in counts) counts[r['task_id']]++
  return counts
}

/** Resource assignments per P6 task_id from an XER's TASKRSRC table; null when the file has no TASKRSRC table. */
export function xerResourceCounts(content: string): Record<string, number> | null {
  const tables = readTables(content)
  return tables['TASKRSRC'] ? resourceCountsFrom(tables['TASKRSRC'], tables['TASK'] || []) : null
}

/* ─── table reader ────────────────────────────────────── */

/** All tables of an XER as rows keyed by field name. */
export function readXerTables(content: string): Record<string, Row[]> {
  return readTables(content)
}

/** A P6 calendar row's hours per day and the time of day work starts and ends (from clndr_data). */
export function xerCalendarTimes(c: Row): { hoursPerDay: number; start: string; finish: string } {
  const warnings: string[] = []
  const cal = parseCalendarRow(c, warnings, null)
  const dow = findChild(c['clndr_data'] ? parseClndrData(c['clndr_data']) : null, 'DaysOfWeek')
  let start: number | null = null, finish: number | null = null
  for (const d of dow?.children || []) {
    for (const iv of d.children) {
      const a = attrMap(iv.attrs)
      const s = toMinutes(a['s']), f = toMinutes(a['f'])
      if (s !== null && (start === null || s < start)) start = s
      if (f !== null && (finish === null || (f === 0 ? 24 * 60 : f) > finish)) finish = f === 0 ? 24 * 60 : f
    }
    if (start !== null) break
  }
  const hm = (m: number) => `${String(Math.floor(Math.min(m, 23 * 60 + 59) / 60)).padStart(2, '0')}:${String(Math.min(m, 23 * 60 + 59) % 60).padStart(2, '0')}`
  return { hoursPerDay: cal.hoursPerDay, start: start !== null ? hm(start) : '08:00', finish: finish !== null ? hm(finish) : '17:00' }
}

function readTables(content: string): Record<string, Row[]> {
  const tables: Record<string, Row[]> = {}
  let current = ''
  let headers: string[] = []
  for (const raw of content.replace(/^﻿/, '').split(/\r\n|\n|\r/)) {
    if (!raw.trim()) continue
    const cols = raw.split('\t')
    const tag = cols[0].trim()
    if (tag === '%T') {
      current = (cols[1] || '').trim()
      tables[current] = []
    } else if (tag === '%F') {
      headers = cols.slice(1).map(h => h.trim())
    } else if (tag === '%R') {
      const row: Row = {}
      headers.forEach((h, i) => { row[h] = (cols[i + 1] ?? '').trim() })
      tables[current]?.push(row)
    }
  }
  return tables
}

/* ─── P6 calendar (clndr_data) ────────────────────────── */

interface CNode { name: string; attrs: string; children: CNode[] }

/** Parse P6's nested "(0||Name(attrs)(children))" format into a tree. */
export function parseClndrData(data: string): CNode | null {
  const s = data.replace(/[\x00-\x1f\x7f]/g, ' ')
  let i = s.indexOf('(')
  if (i < 0) return null
  const skipWs = () => { while (i < s.length && /\s/.test(s[i])) i++ }
  const node = (): CNode => {
    i++ // '('
    let header = ''
    while (i < s.length && s[i] !== '(' && s[i] !== ')') header += s[i++]
    const name = (header.includes('||') ? header.split('||')[1] : header).trim()
    let attrs = ''
    if (s[i] === '(') {
      i++
      while (i < s.length && s[i] !== ')') attrs += s[i++]
      i++
    }
    const children: CNode[] = []
    skipWs()
    if (s[i] === '(') {
      i++
      for (;;) {
        skipWs()
        if (i >= s.length) break
        if (s[i] === ')') { i++; break }
        if (s[i] === '(') children.push(node())
        else i++
      }
    }
    skipWs()
    if (s[i] === ')') i++
    return { name, attrs: attrs.trim(), children }
  }
  return node()
}

function attrMap(attrs: string): Record<string, string> {
  const parts = attrs.split('|')
  const m: Record<string, string> = {}
  for (let k = 0; k + 1 < parts.length; k += 2) m[parts[k].trim()] = parts[k + 1].trim()
  return m
}

function toMinutes(t: string | undefined): number | null {
  if (!t) return null
  const m = t.match(/^(\d{1,2}):(\d{2})/)
  return m ? +m[1] * 60 + +m[2] : null
}

function intervalHours(intervals: CNode[]): number {
  let mins = 0
  for (const iv of intervals) {
    const a = attrMap(iv.attrs)
    const s = toMinutes(a['s'])
    let f = toMinutes(a['f'])
    if (s === null || f === null) continue
    if (f <= s) f += 24 * 60 // "f|00:00" = midnight
    mins += f - s
  }
  return mins / 60
}

function findChild(n: CNode | null | undefined, name: string): CNode | undefined {
  if (!n) return undefined
  if (n.name.toLowerCase() === name.toLowerCase()) return n
  for (const c of n.children) {
    const f = findChild(c, name)
    if (f) return f
  }
  return undefined
}

function parseCalendarRow(c: Row, warnings: string[], ex: ExceptionCollector | null): WorkCalendar {
  const calName = c['clndr_name'] || `Calendar ${c['clndr_id']}`
  const tree = c['clndr_data'] ? parseClndrData(c['clndr_data']) : null
  const workDays: Weekday[] = []
  const dayHours: number[] = []
  let workTimes: WorkCalendar['workTimes']
  let workTimesHours = 0
  const dow = findChild(tree, 'DaysOfWeek')
  if (dow) {
    for (const d of dow.children) {
      const n = parseInt(d.name, 10)
      if (!(n >= 1 && n <= 7)) continue
      if (d.children.length > 0) {
        workDays.push((n - 1) as Weekday)
        const h = intervalHours(d.children)
        dayHours.push(h)
        // The working periods of the longest work day (the one hours per day comes from).
        if (h > workTimesHours) { workTimesHours = h; workTimes = workPeriods(d.children) }
      }
    }
  } else {
    workDays.push(1, 2, 3, 4, 5)
    warnings.push(`Calendar "${c['clndr_name']}" has no DaysOfWeek data; assumed Mon–Fri`)
    ex?.add({ severity: 'warning', entity: 'calendar', field: 'CALENDAR.clndr_data', disposition: 'defaulted', example: calName, message: 'Calendar without a work week; Monday–Friday assumed' })
  }
  workDays.sort((a, b) => a - b)

  const dayHr = parseFloat(c['day_hr_cnt'] || '')
  const derived = dayHours.length ? Math.max(...dayHours) : 0
  const hoursPerDay = dayHr > 0 ? dayHr : derived > 0 ? round2(derived) : 8

  const holidays: string[] = []
  const extraWorkDays: string[] = []
  const exc = findChild(tree, 'Exceptions')
  for (const e of exc?.children || []) {
    const serial = parseInt(attrMap(e.attrs)['d'] || '', 10)
    const iso = isNaN(serial) ? null : serialToIso(serial)
    if (!iso) continue
    const wd = new Date(iso + 'T00:00:00Z').getUTCDay() as Weekday
    if (e.children.length === 0) {
      if (workDays.includes(wd)) holidays.push(iso)
    } else if (!workDays.includes(wd)) {
      extraWorkDays.push(iso)
    } else if (Math.abs(intervalHours(e.children) - (dayHours[workDays.indexOf(wd)] ?? 0)) > 0.01) {
      ex?.add({ severity: 'info', entity: 'calendar', field: 'CALENDAR.clndr_data.Exceptions', disposition: 'converted', example: `${calName} ${iso}`, message: 'Exception changes the work hours of a work day; Planora counts it as a normal work day' })
    }
  }
  holidays.sort()
  extraWorkDays.sort()

  const name = calName
  return {
    id: c['clndr_id'],
    name,
    workDays,
    hoursPerDay,
    holidays,
    ...(extraWorkDays.length ? { extraWorkDays } : {}),
    ...(workTimes?.length ? { workTimes } : {}),
    sourceName: name,
  }
}

/** A work day's periods as HH:MM pairs in time order ("f|00:00" = midnight, written 24:00). */
function workPeriods(intervals: CNode[]): { from: string; to: string }[] {
  const out: [number, number][] = []
  for (const iv of intervals) {
    const a = attrMap(iv.attrs)
    const s = toMinutes(a['s'])
    let f = toMinutes(a['f'])
    if (s === null || f === null) continue
    if (f <= s) f += 24 * 60
    out.push([s, Math.min(f, 24 * 60)])
  }
  const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  return out.sort((x, y) => x[0] - y[0]).map(([s, f]) => ({ from: hm(s), to: hm(f) }))
}
