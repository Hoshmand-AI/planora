// US DoD IPMDAR Schedule Performance Dataset (SPD) v1.0 export.
//
// Format: "IPMDAR Schedule Performance Dataset, Version 1.0", File Format Specification (FFS) and
// Data Exchange Instructions (DEI), March 12, 2020. One ZIP holding FileType.txt plus one JSON file
// per table; singletons are one object, every other table an array of objects. Dates are
// "yyyy-mm-dd" strings, durations are decimals in the one unit declared in ProjectScheduleData
// (DAYS or HOURS), percent complete is a fraction (0.05 = 5%).
//
// Pure: no I/O, no clock. buildIpmdarSpd() returns the file texts and a list of plain-English
// warnings (every required field the schedule could not fill, and every row left out);
// zipIpmdarSpd() packs them (DEFLATE, not encrypted, UTF-8 names, entries at the archive root).
//
// Left out on purpose: the two optional EVMS acceptance fields of DatasetMetadata (their exact
// spelling could not be confirmed against the specification), and every field RunF9 has no data for.

import { crc32 as zlibCrc32, deflateRawSync } from 'zlib'
import type { GeneratedSchedule, PlanActivity, WorkCalendar } from '@/lib/planning/types'
import type { ResourceKind } from '@/lib/planning/resource-types'
import { countWorkDaysInclusive, isValidDate, workDaysBetween } from '@/lib/planning/calendar'
import { buildWbs } from './wbs'
import type { WbsNode } from './wbs'

/* ─── Names fixed by the specification ───────────────── */

export const IPMDAR_SPD_FILE_TYPE = 'IPMDAR_SCHEDULE_PERFORMANCE_DATASET/1.0'

/** ZIP entry names in the order the FFS lists them (FFS 3.2). */
export const IPMDAR_SPD_FILE_NAMES = [
  'FileType.txt', 'DatasetMetadata.json', 'SourceSoftwareMetadata.json', 'ProjectScheduleData.json',
  'ProjectCustomFieldDefinitions.json', 'ProjectCustomFieldValues.json',
  'Calendars.json', 'CalendarWorkshifts.json', 'CalendarExceptions.json',
  'Tasks.json', 'TaskScheduleData.json', 'TaskCustomFieldDefinitions.json', 'TaskCustomFieldValues.json',
  'TaskConstraints.json', 'TaskRelationships.json', 'TaskOutlineStructure.json',
  'Resources.json', 'ResourceCustomFieldDefinitions.json', 'ResourceCustomFieldValues.json', 'ResourceAssignments.json',
] as const

export type SpdDurationUnits = 'DAYS' | 'HOURS'
export type SpdTaskType = 'ACTIVITY' | 'MILESTONE' | 'SUMMARY' | 'HAMMOCK'
export type SpdRelationshipType = 'FINISH_TO_START' | 'START_TO_START' | 'FINISH_TO_FINISH' | 'START_TO_FINISH'
export type SpdConstraintType =
  | 'START_NO_EARLIER_THAN' | 'FINISH_NO_EARLIER_THAN' | 'START_NO_LATER_THAN' | 'FINISH_NO_LATER_THAN'
  | 'MUST_START_ON' | 'MUST_FINISH_ON' | 'SHOULD_START_ON' | 'SHOULD_FINISH_ON'
export type SpdElementOfCost = 'LABOR' | 'MATERIAL' | 'OTHER_DIRECT_COSTS' | 'SUBCONTRACT'

const RELATIONSHIP: Record<string, SpdRelationshipType> = { FS: 'FINISH_TO_START', SS: 'START_TO_START', FF: 'FINISH_TO_FINISH', SF: 'START_TO_FINISH' }
/**
 * RunF9 constraint -> SPD constraint. SO / FO are P6 "Start On" / "Finish On": the date limits both
 * ways but logic still moves the early dates later, which is the DEI's description of the soft
 * SHOULD_* forms. MSO / MFO override logic: MUST_*.
 */
const CONSTRAINT: Record<string, SpdConstraintType> = {
  SNET: 'START_NO_EARLIER_THAN', SNLT: 'START_NO_LATER_THAN', FNET: 'FINISH_NO_EARLIER_THAN', FNLT: 'FINISH_NO_LATER_THAN',
  SO: 'SHOULD_START_ON', FO: 'SHOULD_FINISH_ON', MSO: 'MUST_START_ON', MFO: 'MUST_FINISH_ON',
}
const ELEMENT_OF_COST: Record<ResourceKind, SpdElementOfCost> = { labor: 'LABOR', material: 'MATERIAL', nonlabor: 'OTHER_DIRECT_COSTS' }
const CONTRACTOR_ID_TYPES = ['DUNS', 'DUNS_PLUS_4', 'CAGE']
const WEEKDAY_FIELDS = ['SundayWorkHours', 'MondayWorkHours', 'TuesdayWorkHours', 'WednesdayWorkHours', 'ThursdayWorkHours', 'FridayWorkHours', 'SaturdayWorkHours'] as const

/* ─── Records (property names are the spec's field names) ─ */

/**
 * Optional DatasetMetadata fields the caller may supply; none of them can be read from a schedule.
 * The two EVMS acceptance fields of the specification are not offered (spelling unconfirmed).
 */
export interface SpdDatasetMetadataInput {
  DistributionStatement?: string | null
  ContractorName?: string | null
  ContractorIDCodeTypeID?: 'DUNS' | 'DUNS_PLUS_4' | 'CAGE' | null
  ContractorIDCode?: string | null
  ContractorAddress_Street?: string | null
  ContractorAddress_City?: string | null
  ContractorAddress_State?: string | null
  ContractorAddress_Country?: string | null
  ContractorAddress_ZipCode?: string | null
  PointOfContactName?: string | null
  PointOfContactTitle?: string | null
  PointOfContactTelephone?: string | null
  PointOfContactEmail?: string | null
  ContractName?: string | null
  ContractNumber?: string | null
  ContractType?: string | null
  ContractTaskOrEffortName?: string | null
  ProgramName?: string | null
  ProgramPhase?: string | null
}
const METADATA_TEXT_FIELDS = new Set(['DistributionStatement', 'ContractorAddress_Street'])
const METADATA_FIELDS: (keyof SpdDatasetMetadataInput)[] = [
  'DistributionStatement', 'ContractorName', 'ContractorIDCodeTypeID', 'ContractorIDCode',
  'ContractorAddress_Street', 'ContractorAddress_City', 'ContractorAddress_State', 'ContractorAddress_Country', 'ContractorAddress_ZipCode',
  'PointOfContactName', 'PointOfContactTitle', 'PointOfContactTelephone', 'PointOfContactEmail',
  'ContractName', 'ContractNumber', 'ContractType', 'ContractTaskOrEffortName', 'ProgramName', 'ProgramPhase',
]

export interface SpdTask {
  ID: string
  Name: string
  TaskTypeID: SpdTaskType
  TaskPlanningLevelID?: 'ACTIVITY'
  WBSElementID?: string
}

export interface SpdTaskScheduleData {
  TaskID: string
  CalendarID: string
  CurrentDuration: number
  CurrentStartDate: string
  CurrentFinishDate: string
  EarlyStartDate: string
  EarlyFinishDate: string
  LateStartDate: string
  LateFinishDate: string
  FreeFloatDuration: number
  TotalFloatDuration: number
  OnCriticalPath: boolean
  OnDrivingPath?: boolean
  BaselineDuration?: number
  BaselineStartDate?: string
  BaselineFinishDate?: string
  StartVarianceDuration?: number
  FinishVarianceDuration?: number
  CalculatedPercentComplete: number
  RemainingDuration: number
  ActualStartDate?: string
  ActualFinishDate?: string
}

export interface SpdTaskConstraint { TaskID: string; ConstraintTypeID: SpdConstraintType; ConstraintDate: string }
export interface SpdTaskRelationship { PredecessorTaskID: string; SuccessorTaskID: string; RelationshipTypeID: SpdRelationshipType; LagDuration: number; LagCalendarID?: string }
export interface SpdTaskOutline { Level: number; TaskID: string; ParentTaskID?: string }
export interface SpdCalendar { ID: string; Name: string }
export type SpdCalendarWorkshift = { CalendarID: string } & Record<(typeof WEEKDAY_FIELDS)[number], number>
export interface SpdCalendarException { CalendarID: string; ExceptionDate: string; WorkHours: number }
export interface SpdResource { ID: string; Name: string; ElementOfCostID: SpdElementOfCost }
export interface SpdResourceAssignment { ResourceID: string; TaskID: string; Budget_AtCompletion_Hours?: number; Estimate_ToComplete_Hours?: number; Actual_ToDate_Hours?: number }

/* ─── Options ─────────────────────────────────────────── */

export interface IpmdarSpdOptions {
  /** Project name; only used to build the WBS outline (the SPD has no project-name field). */
  projectName?: string
  /**
   * DatasetMetadata.SecurityMarking (required by the spec), e.g. "UNCLASSIFIED" or "CUI". RunF9 never
   * guesses a marking: without it the field is left out and a warning says the file will not validate.
   */
  securityMarking?: string | null
  /** DatasetMetadata.ReportingPeriodEndDate (yyyy-mm-dd). Defaults to the status date, with a warning. */
  reportingPeriodEndDate?: string | null
  /** Optional DatasetMetadata fields (contractor, contract, program, point of contact). */
  metadata?: SpdDatasetMetadataInput
  /** Unit of every duration in the dataset. Default DAYS (work days, RunF9's own unit). */
  durationUnits?: SpdDurationUnits
  /** SourceSoftwareMetadata.Data_SoftwareName: the tool the schedule is managed in. Default "RunF9". */
  dataSoftwareName?: string
  /** RunF9 version, written to Export_SoftwareVersion (and Data_SoftwareVersion when the data software is RunF9). */
  softwareVersion?: string
  /**
   * Write WBS nodes as SUMMARY tasks with a TaskOutlineStructure. Default: only when the activities
   * carry a source WBS (uploaded schedules). True also outlines RunF9's own phases.
   */
  outline?: boolean
}

export interface IpmdarSpdResult {
  /** File name -> UTF-8 text. Tables with no rows are left out, as the FFS allows. */
  files: Record<string, string>
  warnings: string[]
}

/* ─── Text and number helpers ─────────────────────────── */

const PROHIBITED_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

/** SPD "String": no prohibited control characters, single spaces only, no leading/trailing space. */
export function spdString(v: unknown): string {
  return String(v ?? '').replace(PROHIBITED_CONTROL, '').replace(/\s+/g, ' ').trim()
}

/** SPD "Text": prohibited control characters removed; line breaks and tabs kept. */
export function spdText(v: unknown): string {
  return String(v ?? '').replace(PROHIBITED_CONTROL, '').trim()
}

/** SPD "StringID": printable ASCII (U+0020–U+007E) with normalized whitespace; other characters become "_". */
export function spdStringId(v: unknown): string {
  return spdString(v).replace(/[^\x20-\x7E]/g, '_')
}

const round6 = (n: number) => {
  const r = Math.round(n * 1e6) / 1e6
  return Number.isFinite(r) ? r + 0 : 0
}
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
const day = (d: string | null | undefined): string | null => {
  const x = typeof d === 'string' ? d.slice(0, 10) : ''
  return /^\d{4}-\d{2}-\d{2}$/.test(x) && isValidDate(x) ? x : null
}
const minDate = (a: string | null, b: string | null) => (!a ? b : !b ? a : a < b ? a : b)
const maxDate = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b)
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const sample = (ids: string[], max = 10) => (ids.length > max ? `${ids.slice(0, max).join(', ')} and ${ids.length - max} more` : ids.join(', '))

/** Hands out IDs that stay unique when compared without case (SPD keys are not case sensitive). */
function idAllocator() {
  const used = new Set<string>()
  return (wanted: string, fallback: string): { id: string; changed: boolean } => {
    const base = spdStringId(wanted) || spdStringId(fallback) || 'ID'
    let id = base
    for (let n = 2; used.has(id.toLowerCase()); n++) id = `${base}-${n}`
    used.add(id.toLowerCase())
    return { id, changed: id !== base }
  }
}

/* ─── Build ───────────────────────────────────────────── */

/**
 * Build the SPD files from a schedule (the same `GeneratedSchedule` the P6 XER exporter takes: a
 * RunF9 plan, or an uploaded schedule converted for export, with `cpm` calculated).
 */
export function buildIpmdarSpd(input: GeneratedSchedule, opts: IpmdarSpdOptions = {}): IpmdarSpdResult {
  const s = input
  const warnings: string[] = []
  const units: SpdDurationUnits = opts.durationUnits === 'HOURS' ? 'HOURS' : 'DAYS'
  const times = s.cpm?.times || {}
  if (!s.cpm) warnings.push('The schedule has not been calculated (no CPM results), so early/late dates and float are missing; activities without actual start and finish dates are left out.')
  else if (s.cpm.cycles?.length) warnings.push(`The schedule logic has ${plural(s.cpm.cycles.length, 'loop', 'loops')}; the dates and float written for the activities involved are best-effort.`)

  /* Calendars */
  const calendars: SpdCalendar[] = []
  const workshifts: SpdCalendarWorkshift[] = []
  const exceptions: SpdCalendarException[] = []
  const calId = new Map<string, string>()
  const calOf = new Map<string, WorkCalendar>()
  const allocCal = idAllocator()
  for (const c of s.calendars || []) {
    if (calOf.has(c.id)) { warnings.push(`Calendar "${c.name || c.id}" appears more than once in the schedule; only the first is written.`); continue }
    const { id, changed } = allocCal(c.id, `CAL-${calendars.length + 1}`)
    if (changed) warnings.push(`Calendar ID "${c.id}" duplicates another calendar's ID when case is ignored; it is written as "${id}".`)
    calId.set(c.id, id)
    calOf.set(c.id, c)
    const name = spdString(c.name) || id
    if (!spdString(c.name)) warnings.push(`Calendar "${id}" has no name (Calendars.Name is required); its ID is written as the name.`)
    calendars.push({ ID: id, Name: name })

    let hours = c.hoursPerDay
    if (!(hours > 0)) {
      hours = 8
      warnings.push(`Calendar "${name}" has no work hours per day; 8 hours is written for each work day.`)
    }
    let workDays = (c.workDays || []).filter(d => Number.isInteger(d) && d >= 0 && d <= 6)
    if (!workDays.length) {
      workDays = [0, 1, 2, 3, 4, 5, 6]
      warnings.push(`Calendar "${name}" has no work days defined; it is written as a 7-day calendar, the way RunF9 schedules on it.`)
    }
    const shift = { CalendarID: id } as SpdCalendarWorkshift
    WEEKDAY_FIELDS.forEach((f, d) => { shift[f] = workDays.includes(d as 0) ? round6(hours) : 0 })
    workshifts.push(shift)

    // Exceptions: holidays (0 hours) and extra work days (a full day). A date listed as both is a work day.
    const extra = new Set<string>()
    const seen = new Set<string>()
    let bad = 0
    for (const d of c.extraWorkDays || []) { const x = day(d); if (x) extra.add(x); else bad++ }
    const rows: SpdCalendarException[] = []
    for (const d of c.holidays || []) {
      const x = day(d)
      if (!x) { bad++; continue }
      if (extra.has(x) || seen.has(x)) continue
      seen.add(x)
      rows.push({ CalendarID: id, ExceptionDate: x, WorkHours: 0 })
    }
    for (const x of extra) rows.push({ CalendarID: id, ExceptionDate: x, WorkHours: round6(hours) })
    rows.sort((a, b) => a.ExceptionDate.localeCompare(b.ExceptionDate))
    exceptions.push(...rows)
    if (bad) warnings.push(`Calendar "${name}": ${plural(bad, 'exception has', 'exceptions have')} no valid date and ${bad === 1 ? 'is' : 'are'} left out.`)
  }
  const defaultCal: WorkCalendar | undefined = calOf.get(s.defaultCalendarId) || (s.calendars || [])[0]
  if (!defaultCal) warnings.push('The schedule has no calendar. TaskScheduleData.CalendarID is required, so no activities can be written.')
  else if (!calOf.has(s.defaultCalendarId)) warnings.push(`The schedule's default calendar is not among its calendars; "${defaultCal.name || defaultCal.id}" is used instead.`)
  const hoursOf = (c: WorkCalendar) => (c.hoursPerDay > 0 ? c.hoursPerDay : 8)
  /** Work days on a calendar -> the dataset's duration unit. */
  const dur = (days: number, c: WorkCalendar) => round6(units === 'HOURS' ? days * hoursOf(c) : days)

  /* Tasks and their schedule data */
  const tasks: SpdTask[] = []
  const scheduleData: SpdTaskScheduleData[] = []
  const constraints: SpdTaskConstraint[] = []
  const taskId = new Map<string, string>()           // RunF9 activity id -> SPD task ID
  const taskCal = new Map<string, WorkCalendar>()    // RunF9 activity id -> calendar
  const rowOf = new Map<string, SpdTaskScheduleData>()
  const allocTask = idAllocator()
  const driving = s.cpm?.longestPath ? new Set(s.cpm.longestPath) : null
  const seenActivity = new Set<string>()
  const noDates: string[] = [], renamed: string[] = [], unnamed: string[] = [], badCal: string[] = []
  const noActualStart: string[] = [], noActualFinish: string[] = [], partBaseline: string[] = [], loe: string[] = []
  const badConstraint: string[] = []
  let planningLevelDefaulted = 0

  const sourceWbsId = (a: PlanActivity) => (a.wbs ? spdStringId(a.wbs.trim().split(/\s+/)[0]) : '')

  for (const a of s.activities || []) {
    const label = spdString(a.code) || spdString(a.name) || a.id
    if (seenActivity.has(a.id)) { warnings.push(`Activity "${label}" appears more than once in the schedule; only the first is written.`); continue }
    seenActivity.add(a.id)
    if (!defaultCal) continue
    let cal = calOf.get(a.calendarId || s.defaultCalendarId)
    if (!cal) { cal = defaultCal; if (a.calendarId) badCal.push(label) }
    const tm = times[a.id]
    const isLoe = !!a.levelOfEffort
    const isMilestone = a.type === 'milestone' && !isLoe
    const actualStart = day(a.actualStart), actualFinish = day(a.actualFinish)
    const done = !!actualFinish || a.status === 'complete'
    const started = done || !!actualStart || a.status === 'in_progress'

    // Level-of-effort activities are outside the CPM: their dates span the work they are tied to.
    const early = isLoe && !tm ? { start: day(a.levelOfEffort!.start), finish: day(a.levelOfEffort!.finish) } : { start: day(tm?.earlyStart) ?? actualStart, finish: day(tm?.earlyFinish) ?? actualFinish }
    const late = { start: day(tm?.lateStart) ?? early.start, finish: day(tm?.lateFinish) ?? early.finish }
    const currentStart = actualStart ?? early.start
    const currentFinish = actualFinish ?? early.finish
    if (!early.start || !early.finish || !late.start || !late.finish || !currentStart || !currentFinish) { noDates.push(label); continue }

    const { id, changed } = allocTask(a.code, a.id)
    if (changed || id !== spdString(a.code)) renamed.push(`${label} -> ${id}`)
    let name = spdString(a.name)
    if (!name) { name = id; unnamed.push(id) }
    const task: SpdTask = { ID: id, Name: name, TaskTypeID: isLoe ? 'HAMMOCK' : isMilestone ? 'MILESTONE' : 'ACTIVITY' }
    if (task.TaskTypeID === 'ACTIVITY') { task.TaskPlanningLevelID = 'ACTIVITY'; planningLevelDefaulted++ }
    if (isLoe) loe.push(id)
    const wbsElement = sourceWbsId(a)
    if (wbsElement) task.WBSElementID = wbsElement
    tasks.push(task)
    taskId.set(a.id, id)
    taskCal.set(a.id, cal)

    // Durations in work days on the activity's calendar.
    const planned = Math.max(0, a.duration || 0)
    const remainingDays = done ? 0 : Math.max(0, a.remaining ?? planned)
    let currentDays: number
    if (isMilestone) currentDays = 0
    else if (isLoe) currentDays = countWorkDaysInclusive(currentStart, currentFinish, cal)
    else if (!started) currentDays = remainingDays
    // Started work: the working time actually spanned from the actual start to the (actual or forecast) finish.
    else if (actualStart && currentFinish >= actualStart) currentDays = countWorkDaysInclusive(actualStart, currentFinish, cal)
    else currentDays = planned
    let pct = 0
    if (done) pct = 1
    else if (started) pct = clamp01(a.percentComplete != null && Number.isFinite(a.percentComplete) ? a.percentComplete / 100 : currentDays > 0 ? 1 - remainingDays / currentDays : 0)

    const row: SpdTaskScheduleData = {
      TaskID: id,
      CalendarID: calId.get(cal.id)!,
      CurrentDuration: dur(currentDays, cal),
      CurrentStartDate: currentStart,
      CurrentFinishDate: currentFinish,
      EarlyStartDate: early.start,
      EarlyFinishDate: early.finish,
      LateStartDate: late.start,
      LateFinishDate: late.finish,
      FreeFloatDuration: dur(tm?.freeFloat ?? 0, cal),
      TotalFloatDuration: dur(tm?.totalFloat ?? 0, cal),
      OnCriticalPath: !!tm?.critical,
      CalculatedPercentComplete: round6(pct),
      RemainingDuration: dur(isMilestone ? 0 : remainingDays, cal),
    }
    if (driving && tm) row.OnDrivingPath = driving.has(a.id)
    // Baseline fields are all-or-nothing in the spec.
    const bs = day(a.baselineStart), bf = day(a.baselineFinish)
    if (bs && bf) {
      row.BaselineDuration = dur(isMilestone ? 0 : countWorkDaysInclusive(bs, bf, cal), cal)
      row.BaselineStartDate = bs
      row.BaselineFinishDate = bf
      row.StartVarianceDuration = dur(workDaysBetween(bs, currentStart, cal), cal)
      row.FinishVarianceDuration = dur(workDaysBetween(bf, currentFinish, cal), cal)
    } else if (bs || bf) partBaseline.push(id)
    if (actualStart) row.ActualStartDate = actualStart
    else if (started) noActualStart.push(id)
    if (actualFinish) row.ActualFinishDate = actualFinish
    else if (done) noActualFinish.push(id)
    scheduleData.push(row)
    rowOf.set(a.id, row)

    // Constraints. "As soon as possible" is the SPD default: no row.
    const c = a.constraint as { type?: string; date?: string | null } | null | undefined
    if (c && c.type) {
      const type = CONSTRAINT[c.type]
      const date = day(c.date)
      if (!type) badConstraint.push(`${id} (type "${spdString(c.type)}" has no SPD equivalent)`)
      else if (!date) badConstraint.push(`${id} (${c.type} has no valid date)`)
      else constraints.push({ TaskID: id, ConstraintTypeID: type, ConstraintDate: date })
    }
  }

  if (noDates.length) warnings.push(`${plural(noDates.length, 'activity has', 'activities have')} no calculated or actual start and finish dates (required in TaskScheduleData) and ${noDates.length === 1 ? 'is' : 'are'} left out, with ${noDates.length === 1 ? 'its' : 'their'} relationships, constraints and assignments: ${sample(noDates)}.`)
  if (renamed.length) warnings.push(`${plural(renamed.length, 'task ID was', 'task IDs were')} changed to fit the SPD rules (printable ASCII, single spaces, unique when case is ignored): ${sample(renamed)}.`)
  if (unnamed.length) warnings.push(`${plural(unnamed.length, 'activity has', 'activities have')} no name (Tasks.Name is required); the task ID is written as the name: ${sample(unnamed)}.`)
  if (badCal.length) warnings.push(`${plural(badCal.length, 'activity refers', 'activities refer')} to a calendar that is not in the schedule; the default calendar is written instead: ${sample(badCal)}.`)
  if (planningLevelDefaulted) warnings.push(`Tasks.TaskPlanningLevelID is required for activities, and the schedule does not say which are work packages, planning packages or control accounts; "ACTIVITY" (none of the others applies) is written for all ${plural(planningLevelDefaulted, 'activity', 'activities')}.`)
  if (loe.length) warnings.push(`${plural(loe.length, 'level-of-effort activity is', 'level-of-effort activities are')} written as HAMMOCK tasks spanning the work they are tied to, with late dates equal to early dates and zero float when RunF9 did not calculate them: ${sample(loe)}.`)
  if (noActualStart.length) warnings.push(`${plural(noActualStart.length, 'started activity has', 'started activities have')} no actual start date (required once a task has started); ActualStartDate is left out: ${sample(noActualStart)}.`)
  if (noActualFinish.length) warnings.push(`${plural(noActualFinish.length, 'completed activity has', 'completed activities have')} no actual finish date (required once a task has finished); ActualFinishDate is left out: ${sample(noActualFinish)}.`)
  if (partBaseline.length) warnings.push(`${plural(partBaseline.length, 'activity has', 'activities have')} only one of the two baseline dates; the SPD baseline fields must be all present or all absent, so they are left out: ${sample(partBaseline)}.`)
  if (badConstraint.length) warnings.push(`${plural(badConstraint.length, 'constraint was', 'constraints were')} left out of TaskConstraints: ${sample(badConstraint)}.`)

  /* Relationships */
  const relationships: SpdTaskRelationship[] = []
  const relKeys = new Set<string>()
  let relMissing = 0, relDup = 0, relSelf = 0, relType = 0
  for (const l of s.links || []) {
    const from = taskId.get(l.from), to = taskId.get(l.to)
    if (!from || !to) { relMissing++; continue }
    if (from === to) { relSelf++; continue }
    const type = RELATIONSHIP[l.type]
    if (!type) { relType++; continue }
    const key = `${from.toLowerCase()}\u0000${to.toLowerCase()}\u0000${type}`
    if (relKeys.has(key)) { relDup++; continue }
    relKeys.add(key)
    const predCal = taskCal.get(l.from)!
    const lag = Number.isFinite(l.lag) ? l.lag : 0
    const row: SpdTaskRelationship = { PredecessorTaskID: from, SuccessorTaskID: to, RelationshipTypeID: type, LagDuration: dur(lag, predCal) }
    // RunF9 (like P6) counts lag on the predecessor's calendar; the SPD default is the successor's.
    if (lag !== 0) row.LagCalendarID = calId.get(predCal.id)!
    relationships.push(row)
  }
  if (relMissing) warnings.push(`${plural(relMissing, 'relationship was', 'relationships were')} left out because the predecessor or successor is not in the exported tasks.`)
  if (relSelf) warnings.push(`${plural(relSelf, 'relationship links', 'relationships link')} an activity to itself and ${relSelf === 1 ? 'was' : 'were'} left out.`)
  if (relType) warnings.push(`${plural(relType, 'relationship has', 'relationships have')} a type the SPD does not define and ${relType === 1 ? 'was' : 'were'} left out.`)
  if (relDup) warnings.push(`${plural(relDup, 'relationship repeats', 'relationships repeat')} the same predecessor, successor and type as another (the SPD allows one) and ${relDup === 1 ? 'was' : 'were'} left out.`)

  /* WBS outline: WBS nodes become SUMMARY tasks, activities their leaves. */
  const outline: SpdTaskOutline[] = []
  const wantOutline = opts.outline ?? (s.activities || []).some(a => a.wbs)
  if (wantOutline && tasks.length && defaultCal) {
    const { root, nodes, rows } = buildWbs(s, opts.projectName || 'Project')
    const activityTasks = tasks.length
    const summaryId = new Map<WbsNode, string>()
    const leaves = (n: WbsNode): PlanActivity[] => [...n.activities, ...n.children.flatMap(leaves)]
    const stack: { level: number; id: string }[] = []
    const placed = new Set<string>()
    const push = (level: number, id: string) => {
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop()
      const parent = stack[stack.length - 1]
      // Levels never skip: a child sits exactly one below its parent.
      const lvl = parent ? parent.level + 1 : 1
      outline.push(parent ? { Level: lvl, TaskID: id, ParentTaskID: parent.id } : { Level: lvl, TaskID: id })
      return lvl
    }
    for (const r of rows) {
      if (r.kind === 'activity') {
        const id = r.activity && taskId.get(r.activity.id)
        if (!id || placed.has(id)) continue
        placed.add(id)
        // Activity rows sit one level under their WBS node; they are never parents.
        while (stack.length && stack[stack.length - 1].level >= r.level) stack.pop()
        const parent = stack[stack.length - 1]
        outline.push(parent ? { Level: parent.level + 1, TaskID: id, ParentTaskID: parent.id } : { Level: 1, TaskID: id })
        continue
      }
      const n = r.node!
      const kids = leaves(n).filter(a => rowOf.has(a.id))
      if (!kids.length) continue // nothing exported under this node
      const code = n.code.startsWith(`${root}.`) ? n.code.slice(root.length + 1) : n.code
      const { id } = allocTask(`WBS-${code}`, `WBS-${summaryId.size + 1}`)
      summaryId.set(n, id)
      tasks.push({ ID: id, Name: spdString(n.name) || id, TaskTypeID: 'SUMMARY' })
      scheduleData.push(summaryRow(id, kids.map(a => ({ row: rowOf.get(a.id)!, a, cal: taskCal.get(a.id)! }))))
      const lvl = push(r.level, id)
      stack.push({ level: lvl, id })
    }
    // Activities the WBS did not place (should not happen) go at the top level.
    for (const a of s.activities) {
      const id = taskId.get(a.id)
      if (id && !placed.has(id)) { placed.add(id); outline.push({ Level: 1, TaskID: id }) }
    }
    if (summaryId.size) warnings.push(`${plural(summaryId.size, 'WBS element is', 'WBS elements are')} written as SUMMARY tasks (IDs starting "WBS-") with a TaskOutlineStructure. Their dates, float and percent complete are rolled up from the ${activityTasks} activities beneath them; durations are counted on the default calendar.`)
  }

  /** Roll-up of a WBS node from the exported activities under it, on the default calendar. */
  function summaryRow(id: string, kids: { row: SpdTaskScheduleData; a: PlanActivity; cal: WorkCalendar }[]): SpdTaskScheduleData {
    const cal = defaultCal!
    const rows = kids.map(k => k.row)
    const lo = (f: (r: SpdTaskScheduleData) => string | undefined) => rows.reduce<string | null>((m, r) => minDate(m, f(r) ?? null), null)
    const hi = (f: (r: SpdTaskScheduleData) => string | undefined) => rows.reduce<string | null>((m, r) => maxDate(m, f(r) ?? null), null)
    const start = lo(r => r.CurrentStartDate)!, finish = hi(r => r.CurrentFinishDate)!
    const current = countWorkDaysInclusive(start, finish, cal)
    const allDone = rows.every(r => r.CalculatedPercentComplete >= 1)
    const anyStarted = rows.some(r => r.ActualStartDate || r.CalculatedPercentComplete > 0)
    const status = day(s.dataDate) || day(s.projectStart)
    const remaining = allDone ? 0 : !anyStarted || !status || status <= start ? current : status > finish ? 0 : countWorkDaysInclusive(status, finish, cal)
    // Percent complete: the activities' percent weighted by their current durations.
    const weight = kids.reduce((t, k) => t + k.row.CurrentDuration, 0)
    const pct = allDone ? 1 : weight > 0 ? kids.reduce((t, k) => t + k.row.CurrentDuration * k.row.CalculatedPercentComplete, 0) / weight : 0
    const tfDays = Math.min(...kids.map(k => times[k.a.id]?.totalFloat ?? 0))
    const ffDays = Math.min(...kids.map(k => times[k.a.id]?.freeFloat ?? 0))
    const out: SpdTaskScheduleData = {
      TaskID: id,
      CalendarID: calId.get(cal.id)!,
      CurrentDuration: dur(current, cal),
      CurrentStartDate: start,
      CurrentFinishDate: finish,
      EarlyStartDate: lo(r => r.EarlyStartDate)!,
      EarlyFinishDate: hi(r => r.EarlyFinishDate)!,
      LateStartDate: lo(r => r.LateStartDate)!,
      LateFinishDate: hi(r => r.LateFinishDate)!,
      FreeFloatDuration: dur(ffDays, cal),
      TotalFloatDuration: dur(tfDays, cal),
      OnCriticalPath: rows.some(r => r.OnCriticalPath),
      CalculatedPercentComplete: round6(clamp01(pct)),
      RemainingDuration: dur(remaining, cal),
    }
    if (rows.every(r => r.BaselineStartDate && r.BaselineFinishDate)) {
      const bs = lo(r => r.BaselineStartDate)!, bf = hi(r => r.BaselineFinishDate)!
      out.BaselineDuration = dur(countWorkDaysInclusive(bs, bf, cal), cal)
      out.BaselineStartDate = bs
      out.BaselineFinishDate = bf
      out.StartVarianceDuration = dur(workDaysBetween(bs, start, cal), cal)
      out.FinishVarianceDuration = dur(workDaysBetween(bf, finish, cal), cal)
    }
    const as = lo(r => r.ActualStartDate)
    if (as) out.ActualStartDate = as
    if (allDone && rows.every(r => r.ActualFinishDate)) out.ActualFinishDate = hi(r => r.ActualFinishDate)!
    return out
  }

  /* Resources and assignments */
  const resources: SpdResource[] = []
  const assignments: SpdResourceAssignment[] = []
  const rd = s.resources
  if (rd && rd.resources?.length) {
    const byId = new Map(rd.resources.map(r => [r.id, r]))
    let noTask = 0, noResource = 0, merged = 0
    const used = new Map<string, Map<string, { budget: number; remaining: number; actual: number }>>()
    for (const x of rd.assignments || []) {
      if (!byId.has(x.resourceId)) { noResource++; continue }
      const t = taskId.get(x.activityId)
      if (!t) { noTask++; continue }
      const perTask = used.get(x.resourceId) || new Map()
      used.set(x.resourceId, perTask)
      const cur = perTask.get(t)
      if (cur) merged++
      perTask.set(t, { budget: (cur?.budget ?? 0) + (x.budgetUnits || 0), remaining: (cur?.remaining ?? 0) + (x.remainingUnits || 0), actual: (cur?.actual ?? 0) + (x.actualUnits || 0) })
    }
    const allocRes = idAllocator()
    const equipment: string[] = [], material: string[] = []
    const list = rd.resources.filter(r => used.has(r.id)).sort((a, b) => String(a.code).localeCompare(String(b.code)))
    for (const r of list) {
      const { id } = allocRes(r.code, r.id)
      resources.push({ ID: id, Name: spdString(r.name) || id, ElementOfCostID: ELEMENT_OF_COST[r.kind] ?? 'OTHER_DIRECT_COSTS' })
      if (r.kind === 'nonlabor') equipment.push(id)
      if (r.kind === 'material') material.push(id)
      for (const [t, q] of used.get(r.id)!) {
        const row: SpdResourceAssignment = { ResourceID: id, TaskID: t }
        // Labor and equipment units are hours; material quantities are in the material's own unit, which the SPD cannot carry.
        if (r.kind !== 'material') {
          row.Budget_AtCompletion_Hours = round6(q.budget)
          row.Estimate_ToComplete_Hours = round6(q.remaining)
          row.Actual_ToDate_Hours = round6(q.actual)
        }
        assignments.push(row)
      }
    }
    const unused = rd.resources.length - list.length
    if (unused) warnings.push(`${plural(unused, 'resource has', 'resources have')} no assignment on an exported task and ${unused === 1 ? 'is' : 'are'} left out of Resources.`)
    if (noResource) warnings.push(`${plural(noResource, 'resource assignment refers', 'resource assignments refer')} to a resource that is not in the schedule and ${noResource === 1 ? 'was' : 'were'} left out.`)
    if (noTask) warnings.push(`${plural(noTask, 'resource assignment is', 'resource assignments are')} on an activity that is not in the exported tasks and ${noTask === 1 ? 'was' : 'were'} left out.`)
    if (merged) warnings.push(`${plural(merged, 'resource assignment repeats', 'resource assignments repeat')} the same resource on the same task (the SPD allows one); the hours were added together.`)
    if (equipment.length) warnings.push(`The SPD has no equipment element of cost; ${plural(equipment.length, 'equipment (nonlabor) resource is', 'equipment (nonlabor) resources are')} written as OTHER_DIRECT_COSTS: ${sample(equipment)}.`)
    if (material.length) warnings.push(`Material quantities are not hours or dollars, so the assignments of ${plural(material.length, 'material resource are', 'material resources are')} written without amounts: ${sample(material)}.`)
    if (assignments.length) warnings.push('The schedule holds resource hours but no costs; the dollar fields of ResourceAssignments are left out.')
  }

  /* Singletons */
  const statusDate = day(s.dataDate) ?? day(s.projectStart)
  if (!day(s.dataDate)) {
    warnings.push(statusDate
      ? `The schedule has no data date; the project start (${statusDate}) is written as ProjectScheduleData.StatusDate.`
      : 'The schedule has no data date or project start; the required ProjectScheduleData.StatusDate is left out and the file will not validate.')
  }
  const leafRows = [...rowOf.values()]
  const projectStart = leafRows.reduce<string | null>((m, r) => minDate(m, r.CurrentStartDate), null) ?? day(s.projectStart)
  const projectFinish = leafRows.reduce<string | null>((m, r) => maxDate(m, r.CurrentFinishDate), null) ?? day(s.cpm?.projectFinish)
  if (!leafRows.length) warnings.push('No tasks could be written; the project start and finish are taken from the schedule header where it has them.')
  const projectData: Record<string, string> = {}
  if (statusDate) projectData.StatusDate = statusDate
  if (projectStart) projectData.CurrentStartDate = projectStart
  else warnings.push('The required ProjectScheduleData.CurrentStartDate could not be determined and is left out; the file will not validate.')
  if (projectFinish) projectData.CurrentFinishDate = projectFinish
  else warnings.push('The required ProjectScheduleData.CurrentFinishDate could not be determined and is left out; the file will not validate.')
  const baselined = leafRows.filter(r => r.BaselineStartDate && r.BaselineFinishDate)
  if (baselined.length) {
    projectData.BaselineStartDate = baselined.reduce<string | null>((m, r) => minDate(m, r.BaselineStartDate!), null)!
    projectData.BaselineFinishDate = baselined.reduce<string | null>((m, r) => maxDate(m, r.BaselineFinishDate!), null)!
    if (baselined.length < leafRows.length) warnings.push(`Only ${baselined.length} of ${leafRows.length} tasks have baseline dates; the project baseline start and finish cover those tasks only.`)
  }
  const actualStart = leafRows.reduce<string | null>((m, r) => minDate(m, r.ActualStartDate ?? null), null)
  if (actualStart) projectData.ActualStartDate = actualStart
  if (leafRows.length && leafRows.every(r => r.ActualFinishDate)) projectData.ActualFinishDate = leafRows.reduce<string | null>((m, r) => maxDate(m, r.ActualFinishDate!), null)!
  projectData.DurationUnitsID = units
  if (units === 'HOURS') warnings.push('Durations, float and lag are converted from work days to hours using each calendar\'s hours per day (lag on the predecessor\'s calendar).')

  const dataset: Record<string, string> = {}
  const marking = spdString(opts.securityMarking)
  if (marking) dataset.SecurityMarking = marking
  else warnings.push('DatasetMetadata.SecurityMarking is required and was not supplied. RunF9 does not guess a security marking, so the field is left out and the file will not validate until it is set (for unclassified data: "UNCLASSIFIED").')
  const meta = opts.metadata || {}
  const text = (k: keyof SpdDatasetMetadataInput) => (METADATA_TEXT_FIELDS.has(k) ? spdText(meta[k]) : spdString(meta[k]))
  if (text('DistributionStatement')) dataset.DistributionStatement = text('DistributionStatement')
  const period = day(opts.reportingPeriodEndDate) ?? statusDate
  if (period) dataset.ReportingPeriodEndDate = period
  if (!day(opts.reportingPeriodEndDate)) {
    warnings.push(period
      ? `DatasetMetadata.ReportingPeriodEndDate was not supplied; the status date (${period}) is written. Set it if the accounting period ends on a different day.`
      : 'DatasetMetadata.ReportingPeriodEndDate is required and could not be determined; it is left out and the file will not validate.')
  }
  const idType = spdStringId(meta.ContractorIDCodeTypeID)
  const idTypeOk = CONTRACTOR_ID_TYPES.includes(idType)
  if (idType && !idTypeOk) warnings.push(`ContractorIDCodeTypeID "${idType}" is not one of DUNS, DUNS_PLUS_4 or CAGE; it and the contractor ID code are left out.`)
  else if (!idType && text('ContractorIDCode')) warnings.push('A contractor ID code was supplied without its type (DUNS, DUNS_PLUS_4 or CAGE); the SPD does not allow that, so the code is left out.')
  for (const k of METADATA_FIELDS) {
    if (k === 'DistributionStatement') continue
    if (k === 'ContractorIDCodeTypeID') { if (idTypeOk) dataset[k] = idType; continue }
    if (k === 'ContractorIDCode' && !idTypeOk) continue
    if (text(k)) dataset[k] = text(k)
  }

  const software: Record<string, string> = {}
  const dataSoftware = spdString(opts.dataSoftwareName) || 'RunF9'
  const version = spdString(opts.softwareVersion)
  software.Data_SoftwareName = dataSoftware
  if (version && dataSoftware === 'RunF9') software.Data_SoftwareVersion = version
  software.Export_SoftwareName = 'RunF9'
  if (version) software.Export_SoftwareVersion = version

  /* Files */
  const json = (v: unknown) => JSON.stringify(v, null, 2)
  const files: Record<string, string> = {
    'FileType.txt': IPMDAR_SPD_FILE_TYPE,
    'DatasetMetadata.json': json(dataset),
    'SourceSoftwareMetadata.json': json(software),
    'ProjectScheduleData.json': json(projectData),
  }
  const table = (name: string, rows: unknown[]) => { if (rows.length) files[name] = json(rows) }
  // A calendar is written only with its workshift; all calendars are kept (tasks, lags and summaries refer to them).
  table('Calendars.json', calendars)
  table('CalendarWorkshifts.json', workshifts)
  table('CalendarExceptions.json', exceptions)
  table('Tasks.json', tasks)
  table('TaskScheduleData.json', scheduleData)
  table('TaskConstraints.json', constraints)
  table('TaskRelationships.json', relationships)
  table('TaskOutlineStructure.json', outline)
  table('Resources.json', resources)
  table('ResourceAssignments.json', assignments)
  return { files, warnings }
}

/* ─── ZIP ─────────────────────────────────────────────── */

let crcTable: Uint32Array | null = null
function crc32(buf: Buffer): number {
  // zlib.crc32 exists from Node 20.15 / 22.2; older runtimes use the table.
  if (typeof zlibCrc32 === 'function') return zlibCrc32(buf) >>> 0
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * Pack the SPD files into a ZIP: every entry DEFLATE-compressed, not encrypted, UTF-8 names (general
 * purpose bit 11), entries at the archive root in the FFS's order (FileType.txt first). The output is
 * the same for the same input (fixed 1980-01-01 timestamps).
 */
export function zipIpmdarSpd(files: Record<string, string>): Buffer {
  const order = new Map<string, number>(IPMDAR_SPD_FILE_NAMES.map((n, i) => [n, i]))
  const names = Object.keys(files).sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999) || (a < b ? -1 : a > b ? 1 : 0))
  if (names.length > 0xffff) throw new Error('Too many files for a ZIP archive.')
  const FLAGS = 0x0800, METHOD = 8, VERSION = 20, DOS_TIME = 0, DOS_DATE = 0x0021
  const local: Buffer[] = [], central: Buffer[] = []
  let offset = 0
  for (const name of names) {
    if (!name || /[\\\u0000]/.test(name) || name.startsWith('/')) throw new Error(`Invalid ZIP entry name: ${JSON.stringify(name)}`)
    const nameBuf = Buffer.from(name, 'utf8')
    const data = Buffer.from(files[name], 'utf8')
    const comp = deflateRawSync(data)
    const crc = crc32(data)
    if (data.length > 0xfffffffe || comp.length > 0xfffffffe || offset > 0xfffffffe) throw new Error('The dataset is too large for a ZIP archive without ZIP64.')
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(VERSION, 4)
    lh.writeUInt16LE(FLAGS, 6)
    lh.writeUInt16LE(METHOD, 8)
    lh.writeUInt16LE(DOS_TIME, 10)
    lh.writeUInt16LE(DOS_DATE, 12)
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(comp.length, 18)
    lh.writeUInt32LE(data.length, 22)
    lh.writeUInt16LE(nameBuf.length, 26)
    lh.writeUInt16LE(0, 28)
    local.push(lh, nameBuf, comp)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(VERSION, 4)        // version made by (MS-DOS attribute compatibility)
    ch.writeUInt16LE(VERSION, 6)        // version needed to extract
    ch.writeUInt16LE(FLAGS, 8)
    ch.writeUInt16LE(METHOD, 10)
    ch.writeUInt16LE(DOS_TIME, 12)
    ch.writeUInt16LE(DOS_DATE, 14)
    ch.writeUInt32LE(crc, 16)
    ch.writeUInt32LE(comp.length, 20)
    ch.writeUInt32LE(data.length, 24)
    ch.writeUInt16LE(nameBuf.length, 28)
    // extra length, comment length, disk number, internal attributes, external attributes: all zero
    ch.writeUInt32LE(offset, 42)
    central.push(ch, nameBuf)
    offset += 30 + nameBuf.length + comp.length
  }
  const centralBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(names.length, 8)
  end.writeUInt16LE(names.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, centralBuf, end])
}
