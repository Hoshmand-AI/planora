// Primavera P6 XML (PMXML, <APIBusinessObjects>) parser.
//
// Produces the same ParsedSchedule as the XER parser, with the same field semantics, so the XER and
// the P6 XML export of one project give identical activities, relationships, calendars and CPM:
//   PlannedDuration / RemainingDuration / TotalFloat / FreeFloat / Lag are hours, converted to work
//   days on the activity's calendar (lags on the predecessor's calendar, P6's default lag calendar);
//   PlannedStart/Finish are the target dates (baseline fields, as XER target_start/end_date);
//   PhysicalPercentComplete (else PercentComplete) is the progress, as XER phys_complete_pct.
// Resources, resource rates and assignments are read for resource analysis (./resources.ts), and
// assignment / expense costs for earned value (./costs.ts), with the XER semantics. Everything the file
// carries that Planora does not use (activity codes, UDFs, roles, resource curves, notes, other
// projects, baselines, unmapped fields) is listed in the import exception report.

import type { Activity, Relationship } from '@/lib/db'
import type { ConstraintType, ProgressMode, Weekday, WorkCalendar } from '@/lib/planning/types'
import type { EmbeddedBaseline } from '@/lib/analysis/baseline'
import { randomUUID as uuid } from 'crypto'
import { ParsedSchedule, makeActivity, isoDatePrefix, round2, constraintFromLabel } from './types'
import { ExceptionCollector, wasRounded, type ExceptionEntity, type ExceptionSeverity } from './exceptions'
import { parseXmlTree, child, children, childText, XmlError, type XNode } from './xml-tree'
import { p6XmlResourceData } from './resources'

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const yes = (v: string) => /^(true|1|y|yes)$/i.test(v.trim())

/** True when the text looks like a Primavera P6 XML export. */
export function isP6Xml(text: string): boolean {
  return /<(?:\w+:)?APIBusinessObjects[\s>]/.test(text)
}

/** Reads the document; malformed or empty input becomes a plain-language Error (the upload answers 400). */
function readRoot(content: string): XNode {
  if (!content.trim()) throw new Error('The P6 XML file is empty')
  let root: XNode
  try {
    root = parseXmlTree(content)
  } catch (e) {
    throw new Error(`The P6 XML file is not well-formed XML (${e instanceof XmlError ? e.message : 'unreadable'}). Export it from P6 again (File › Export › Primavera PM XML)`)
  }
  if (root.name !== 'APIBusinessObjects') throw new Error('This XML file is not a Primavera P6 XML export (no <APIBusinessObjects> root)')
  return root
}

/* ─── calendars ─────────────────────────────────────────── */

function minutes(t: string): number | null {
  const m = t.match(/(?:T|^)(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  return m ? +m[1] * 60 + +m[2] : null
}

/** P6 XML work periods: Finish is the last working minute (08:00–11:59 is four hours; 00:00 = midnight). */
function periods(workTimes: XNode[]): [number, number][] {
  const out: [number, number][] = []
  for (const wt of workTimes) {
    const s = minutes(childText(wt, 'Start'))
    let f = minutes(childText(wt, 'Finish'))
    if (s === null || f === null) continue
    if (f % 30 === 29) f += 1 // last working minute on P6's half-hour grid (11:59 = 12:00, 17:29 = 17:30)
    if (f <= s) f += 24 * 60
    out.push([s, Math.min(f, 24 * 60)])
  }
  return out.sort((a, b) => a[0] - b[0])
}

const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const hoursOf = (p: [number, number][]) => p.reduce((n, [s, f]) => n + f - s, 0) / 60

function parseCalendar(c: XNode, warnings: string[], ex: ExceptionCollector): { cal: WorkCalendar; isDefault: boolean } {
  const id = childText(c, 'ObjectId')
  const name = childText(c, 'Name') || `Calendar ${id}`
  const workDays: Weekday[] = []
  const dayHours = new Map<number, number>()
  let workTimes: WorkCalendar['workTimes']
  let workTimesHours = 0
  const week = child(c, 'StandardWorkWeek')
  if (week) {
    for (const d of children(week, 'StandardWorkHours')) {
      const n = DAY_NAMES.indexOf(childText(d, 'DayOfWeek').toLowerCase())
      if (n < 0) continue
      const p = periods(children(d, 'WorkTime'))
      if (!p.length) continue
      workDays.push(n as Weekday)
      const h = hoursOf(p)
      dayHours.set(n, h)
      if (h > workTimesHours) { workTimesHours = h; workTimes = p.map(([s, f]) => ({ from: hm(s), to: hm(f) })) }
    }
  } else {
    workDays.push(1, 2, 3, 4, 5)
    warnings.push(`Calendar "${name}" has no StandardWorkWeek data; assumed Mon–Fri`)
    ex.add({ severity: 'warning', entity: 'calendar', field: 'Calendar.StandardWorkWeek', disposition: 'defaulted', example: name, message: 'Calendar without a work week; Monday–Friday assumed' })
  }
  workDays.sort((a, b) => a - b)
  if (childText(c, 'BaseCalendarObjectId')) ex.add({ severity: 'info', entity: 'calendar', field: 'Calendar.BaseCalendarObjectId', disposition: 'dropped', example: name, message: 'Base calendar link not kept; the calendar\'s own work week and exceptions are used' })

  const declared = parseFloat(childText(c, 'HoursPerDay'))
  const derived = dayHours.size ? Math.max(...dayHours.values()) : 0
  const hoursPerDay = declared > 0 ? declared : derived > 0 ? round2(derived) : 8

  const holidays: string[] = []
  const extraWorkDays: string[] = []
  for (const e of children(child(c, 'HolidayExceptions'), 'HolidayException')) {
    const iso = isoDatePrefix(childText(e, 'Date'))
    if (!iso) continue
    const wd = new Date(iso + 'T00:00:00Z').getUTCDay()
    const p = periods(children(e, 'WorkTime'))
    if (!p.length) {
      if (workDays.includes(wd as Weekday)) holidays.push(iso)
    } else if (!workDays.includes(wd as Weekday)) {
      extraWorkDays.push(iso)
    } else if (Math.abs(hoursOf(p) - (dayHours.get(wd) ?? 0)) > 0.01) {
      ex.add({ severity: 'info', entity: 'calendar', field: 'Calendar.HolidayException.WorkTime', disposition: 'converted', example: `${name} ${iso}`, message: 'Exception changes the work hours of a work day; Planora counts it as a normal work day' })
    }
  }
  holidays.sort()
  extraWorkDays.sort()
  return {
    cal: {
      id, name, workDays, hoursPerDay, holidays,
      ...(extraWorkDays.length ? { extraWorkDays } : {}),
      ...(workTimes?.length ? { workTimes } : {}),
      sourceName: name,
    },
    isDefault: yes(childText(c, 'IsDefault')),
  }
}

/* ─── field coverage ────────────────────────────────────── */

const READ_PROJECT = new Set(['ObjectId', 'Id', 'Name', 'DataDate', 'PlannedStartDate', 'StartDate', 'MustFinishByDate', 'ScheduledFinishDate', 'FinishDate', 'ActivityDefaultCalendarObjectId',
  'CurrentBaselineProjectObjectId', 'LastRecalculationDate', 'Calendar', 'WBS', 'Activity', 'Relationship', 'ResourceAssignment', 'ScheduleOptions', 'ActivityCodeType', 'ActivityCode', 'UDF', 'ActivityNote', 'ProjectNote',
  'EarnedValueComputeType' /* earned value (./costs.ts) */])
const READ_ACTIVITY = new Set(['ObjectId', 'Id', 'Name', 'Type', 'Status', 'CalendarObjectId', 'WBSObjectId', 'ProjectObjectId', 'PlannedDuration', 'RemainingDuration', 'AtCompletionDuration', 'ActualDuration',
  'PhysicalPercentComplete', 'PercentComplete', 'DurationPercentComplete', 'PercentCompleteType', 'PlannedStartDate', 'PlannedFinishDate', 'ActualStartDate', 'ActualFinishDate',
  'EarlyStartDate', 'EarlyFinishDate', 'RemainingEarlyStartDate', 'RemainingEarlyFinishDate', 'LateStartDate', 'LateFinishDate', 'StartDate', 'FinishDate', 'TotalFloat', 'FreeFloat',
  'PrimaryConstraintType', 'PrimaryConstraintDate', 'SecondaryConstraintType', 'SecondaryConstraintDate', 'DrivingPathFlag', 'IsLongestPath', 'IsCritical', 'Code', 'UDF',
  'CalendarName', 'WBSCode', 'WBSName', 'ProjectId', 'GUID',
  // units % complete for earned value (./costs.ts)
  'ActualLaborUnits', 'ActualNonLaborUnits', 'RemainingLaborUnits', 'RemainingNonLaborUnits'])
const READ_RELATIONSHIP = new Set(['ObjectId', 'PredecessorActivityObjectId', 'SuccessorActivityObjectId', 'Type', 'Lag', 'PredecessorProjectObjectId', 'SuccessorProjectObjectId',
  'PredecessorActivityId', 'SuccessorActivityId', 'PredecessorProjectId', 'SuccessorProjectId'])
/** Values that carry no information (defaults P6 writes for every activity). */
const EMPTYISH = /^(|0|0\.0+|false|<none>)$/i

const ROOT_ENTITY: Record<string, [ExceptionEntity, ExceptionSeverity, string]> = {
  Role: ['resource', 'info', 'Roles are not modeled'],
  ActivityCodeType: ['code', 'warning', 'Activity code types are not modeled'],
  ActivityCode: ['code', 'warning', 'Activity code values are not modeled'],
  UDFType: ['udf', 'warning', 'User-defined field definitions are not modeled'],
  UDFValue: ['udf', 'warning', 'User-defined field values are not modeled'],
  BaselineProject: ['baseline', 'warning', 'Baseline projects other than the project\'s current baseline are not used'],
  CostAccount: ['other', 'info', 'Cost accounts are not modeled'],
  Currency: ['other', 'info', 'Currencies: only the base currency symbol is read, for earned value'],
  EPS: ['other', 'info', 'EPS nodes are not modeled'],
  OBS: ['other', 'info', 'OBS nodes are not modeled'],
  FinancialPeriod: ['other', 'info', 'Financial periods are not modeled'],
  NotebookTopic: ['other', 'info', 'Notebook topics are not modeled'],
  ProjectCodeType: ['code', 'info', 'Project code types are not modeled'],
  ProjectCode: ['code', 'info', 'Project codes are not modeled'],
  ResourceCodeType: ['code', 'info', 'Resource code types are not modeled'],
  ResourceCode: ['code', 'info', 'Resource codes are not modeled'],
  UnitOfMeasure: ['other', 'info', 'Units of measure are not modeled'],
  ExpenseCategory: ['other', 'info', 'Expense categories are not modeled'],
  ActivityExpense: ['other', 'info', 'Expenses are read only for earned value (from the stored file), not otherwise imported'],
  ProjectExpense: ['other', 'info', 'Expenses are read only for earned value (from the stored file), not otherwise imported'],
  ActivityStep: ['activity', 'info', 'Activity steps are not modeled'],
  ActivityNote: ['activity', 'info', 'Activity notebooks are not modeled'],
  ProjectNote: ['project', 'info', 'Project / WBS notebooks are not modeled'],
  WBSMilestone: ['activity', 'info', 'WBS milestones are not modeled'],
  Risk: ['other', 'info', 'Risks are not modeled'],
}
/** Root elements the import reads (resources, rates, units of measure and assignments: resource analysis). */
const READ_ROOT = new Set(['Project', 'Calendar', 'Relationship', 'Resource', 'ResourceRate', 'UnitOfMeasure', 'ResourceAssignment'])
/** Elements earned value reads from the stored file; the schedule import and Planora's exports do not carry them. */
const EV_ONLY = new Set(['ActivityExpense', 'ProjectExpense', 'Currency'])
const ORIGINAL_ONLY = 'The original file is kept with the upload; this data is not used by Planora and is not written by its exports'

/* ─── main ──────────────────────────────────────────────── */

export function parseP6Xml(content: string, scheduleId: string, opts: { projectId?: string | null } = {}): ParsedSchedule {
  const root = readRoot(content)
  const warnings: string[] = []
  const ex = new ExceptionCollector('import', 'p6_xml')

  /* ── Project ─────────────────────────────────────────── */
  const projects = children(root, 'Project')
  if (!projects.length) throw new Error('The P6 XML file contains no <Project>. Export a project (not only global data) from P6')
  const actsOf = (p: XNode) => children(p, 'Activity').length
  const want = (opts.projectId || '').trim().toLowerCase()
  const requested = want ? projects.find(p => childText(p, 'Id').toLowerCase() === want || childText(p, 'ObjectId') === want) : undefined
  const project = requested || projects.find(p => actsOf(p) > 0)
  if (!project) throw new Error('The P6 XML file has no activities in any project')
  const projObjectId = childText(project, 'ObjectId')
  const projLabel = childText(project, 'Id') || childText(project, 'Name') || projObjectId
  if (projects.length > 1) {
    const others = projects.filter(p => p !== project)
    warnings.push(`P6 XML contains ${projects.length} projects; imported "${projLabel}" only. Not imported: ${others.map(p => `"${childText(p, 'Id') || childText(p, 'ObjectId')}"`).join(', ')}.`)
    ex.add({ severity: 'warning', entity: 'project', field: 'Project', disposition: 'dropped', count: others.length, examples: others.map(p => childText(p, 'Id') || childText(p, 'ObjectId')), message: `Only "${projLabel}" was imported; ${ORIGINAL_ONLY.toLowerCase()}` })
    const otherActs = others.reduce((n, p) => n + actsOf(p), 0)
    if (otherActs) ex.add({ severity: 'warning', entity: 'activity', field: 'Activity (other projects)', disposition: 'dropped', count: otherActs, examples: others.flatMap(p => children(p, 'Activity').map(a => childText(a, 'Id'))), message: 'Activities of the projects not imported' })
  }

  const projectName = childText(project, 'Id') || childText(project, 'Name') || 'Imported Schedule'
  const projectKey = childText(project, 'Id') || projObjectId || null
  const projectStart = isoDatePrefix(childText(project, 'PlannedStartDate')) || isoDatePrefix(childText(project, 'StartDate'))
  const dataDate = isoDatePrefix(childText(project, 'DataDate')) || isoDatePrefix(childText(project, 'LastRecalculationDate')) || projectStart
  const mustFinishBy = isoDatePrefix(childText(project, 'MustFinishByDate'))
  const projectFinish = isoDatePrefix(childText(project, 'ScheduledFinishDate')) || mustFinishBy

  /* ── Calendars (global and project) ──────────────────── */
  const calendars: WorkCalendar[] = []
  const calById = new Map<string, WorkCalendar>()
  let defaultFlag: string | null = null
  for (const c of [...children(root, 'Calendar'), ...children(project, 'Calendar')]) {
    const { cal, isDefault } = parseCalendar(c, warnings, ex)
    if (!cal.id || calById.has(cal.id)) continue
    calendars.push(cal)
    calById.set(cal.id, cal)
    if (isDefault && !defaultFlag) defaultFlag = cal.id
  }
  const projCal = childText(project, 'ActivityDefaultCalendarObjectId')
  const defaultCalendarId = projCal && calById.has(projCal) ? projCal : defaultFlag ?? calendars[0]?.id ?? null
  const hoursPerDay = (calId: string | null | undefined): number => {
    const cal = (calId && calById.get(calId)) || (defaultCalendarId ? calById.get(defaultCalendarId) : undefined)
    return cal && cal.hoursPerDay > 0 ? cal.hoursPerDay : 8
  }

  /* ── WBS ─────────────────────────────────────────────── */
  const wbsNodes = new Map<string, XNode>()
  for (const w of children(project, 'WBS')) if (childText(w, 'ObjectId')) wbsNodes.set(childText(w, 'ObjectId'), w)
  const wbsCache = new Map<string, string>()
  const wbsPath = (wbsId: string): string => {
    if (!wbsId || wbsId === projObjectId) return ''
    const cached = wbsCache.get(wbsId)
    if (cached !== undefined) return cached
    const parts: string[] = []
    const seen = new Set<string>()
    let cur = wbsNodes.get(wbsId)
    while (cur && !seen.has(childText(cur, 'ObjectId'))) {
      seen.add(childText(cur, 'ObjectId'))
      parts.unshift(childText(cur, 'Code') || childText(cur, 'Name') || childText(cur, 'ObjectId'))
      cur = wbsNodes.get(childText(cur, 'ParentObjectId'))
    }
    const leaf = wbsNodes.get(wbsId)
    let path = parts.join('.')
    if (!leaf) path = wbsId
    else if (childText(leaf, 'Name') && childText(leaf, 'Name') !== childText(leaf, 'Code')) path = `${path} ${childText(leaf, 'Name')}`
    wbsCache.set(wbsId, path)
    return path
  }

  /* ── Activities ──────────────────────────────────────── */
  const seen = new Set<string>()
  const duplicates: string[] = []
  const actNodes = children(project, 'Activity').filter(a => {
    const id = childText(a, 'ObjectId')
    if (!id) return true
    if (seen.has(id)) { duplicates.push(`${id}${childText(a, 'Id') ? ` (${childText(a, 'Id')})` : ''}`); return false }
    seen.add(id)
    return true
  })
  if (duplicates.length) {
    warnings.push(`Activity ObjectId repeated: ${duplicates.slice(0, 10).join(', ')}${duplicates.length > 10 ? ` and ${duplicates.length - 10} more` : ''}; only the first of each was imported.`)
    ex.add({ severity: 'loss', entity: 'activity', field: 'Activity.ObjectId', disposition: 'dropped', count: duplicates.length, examples: duplicates, message: 'Repeated activity ObjectIds; only the first of each was imported' })
  }
  // Percentages: P6 XML writes fractions (0.4 = 40%); a file with any value above 1 is read as 0–100.
  const pctValues = actNodes.flatMap(a => ['PhysicalPercentComplete', 'PercentComplete', 'DurationPercentComplete'].map(f => parseFloat(childText(a, f)))).filter(n => !isNaN(n))
  const pctScale = pctValues.some(n => n > 1) ? 1 : 100

  const byObjectId = new Map<string, Activity>()
  const unmappedFields = new Map<string, string[]>()
  const activities: Activity[] = actNodes.map(t => {
    const code = childText(t, 'Id') || childText(t, 'ObjectId')
    const calRaw = childText(t, 'CalendarObjectId')
    const clndrId = calRaw || defaultCalendarId
    if (calRaw && !calById.has(calRaw)) {
      warnings.push(`Activity ${code}: calendar ${calRaw} not found in the file; using ${hoursPerDay(null)}h/day`)
      ex.add({ severity: 'warning', entity: 'calendar', field: 'Activity.CalendarObjectId', disposition: 'defaulted', example: code, message: 'Activity calendar not in the file; the project default calendar\'s hours per day were used' })
    }
    const hpd = hoursPerDay(clndrId)
    const hrs = (field: string, report = false) => {
      const v = childText(t, field)
      if (v === '') return null
      const exact = parseFloat(v) / hpd
      const r = round2(exact)
      if (report && wasRounded(exact, r)) ex.add({ severity: 'info', entity: 'activity', field: `Activity.${field}`, disposition: 'converted', example: code, message: 'Hours converted to work days on the activity calendar and rounded to 0.01 day' })
      return r
    }

    const st = childText(t, 'Status').toLowerCase().replace(/\s+/g, '')
    const status: Activity['status'] = st === 'completed' ? 'complete' : st === 'inprogress' ? 'in_progress' : 'not_started'

    const rawPct = childText(t, 'PhysicalPercentComplete') || childText(t, 'PercentComplete') || '0'
    let pct = round2((parseFloat(rawPct) || 0) * pctScale)
    if (pctScale === 100 && parseFloat(rawPct) > 0) ex.add({ severity: 'info', entity: 'activity', field: 'Activity.PhysicalPercentComplete', disposition: 'converted', example: code, message: 'P6 XML percent (a fraction, 0–1) converted to 0–100' })
    if (pct < 0 || pct > 100) {
      warnings.push(`Activity ${code}: percent complete ${pct} is outside 0–100; set to ${pct < 0 ? 0 : 100}`)
      ex.add({ severity: 'warning', entity: 'activity', field: 'Activity.PhysicalPercentComplete', disposition: 'converted', example: code, message: 'Percent complete outside 0–100 was clamped' })
      pct = pct < 0 ? 0 : 100
    }
    if (status === 'complete' && pct === 0) pct = 100
    const pctType = childText(t, 'PercentCompleteType')
    if (pctType && !/physical/i.test(pctType)) ex.add({ severity: 'info', entity: 'activity', field: 'Activity.PercentCompleteType', disposition: 'converted', example: code, message: `Percent complete type ${pctType}: earned value applies it; the schedule's progress (as for XER) is the physical % complete and the remaining duration` })

    const type = childText(t, 'Type').toLowerCase().replace(/\s+/g, '')
    let activityType: Activity['activityType'] = 'task'
    let milestoneKind: Activity['milestoneKind'] = null
    if (type === 'startmilestone' || type === 'finishmilestone') { activityType = 'milestone'; milestoneKind = type === 'startmilestone' ? 'start' : 'finish' }
    else if (type === 'levelofeffort') activityType = 'loe'
    else if (type === 'wbssummary') activityType = 'summary'
    else if (type === 'resourcedependent') ex.add({ severity: 'warning', entity: 'activity', field: 'Activity.Type', disposition: 'converted', example: code, message: 'Resource dependent activities are scheduled as task dependent (on the activity calendar, not resource calendars)' })
    else if (type && type !== 'taskdependent') ex.add({ severity: 'warning', entity: 'activity', field: 'Activity.Type', disposition: 'converted', example: `${code} (${childText(t, 'Type')})`, message: 'Unknown activity type read as a task' })

    const tf = hrs('TotalFloat')
    const ff = hrs('FreeFloat')

    let constraintType: ConstraintType | null = null
    let constraintDate: string | null = null
    const cstr = childText(t, 'PrimaryConstraintType')
    if (cstr) {
      const mapped = constraintFromLabel(cstr)
      if (mapped === 'ALAP') {
        warnings.push(`Activity ${code}: As Late As Possible constraint is not modeled; ignored`)
        ex.add({ severity: 'loss', entity: 'constraint', field: 'Activity.PrimaryConstraintType=As Late As Possible', disposition: 'dropped', example: code, message: 'As Late As Possible is not modeled; the activity is scheduled as soon as possible' })
      } else if (mapped) {
        constraintDate = isoDatePrefix(childText(t, 'PrimaryConstraintDate'))
        if (constraintDate) constraintType = mapped
        else {
          warnings.push(`Activity ${code}: constraint ${cstr} has no date; ignored`)
          ex.add({ severity: 'loss', entity: 'constraint', field: 'Activity.PrimaryConstraintDate', disposition: 'dropped', example: code, message: 'Constraint without a date was ignored' })
        }
      } else if (!/^\s*<?none>?\s*$/i.test(cstr)) {
        warnings.push(`Activity ${code}: unrecognized constraint type "${cstr}"`)
        ex.add({ severity: 'loss', entity: 'constraint', field: 'Activity.PrimaryConstraintType', disposition: 'dropped', example: `${code} (${cstr})`, message: 'Unrecognized constraint type was ignored' })
      }
    }
    const cstr2 = childText(t, 'SecondaryConstraintType')
    if (cstr2 && !/^\s*<?none>?\s*$/i.test(cstr2)) {
      warnings.push(`Activity ${code}: secondary constraint ${cstr2} ignored`)
      ex.add({ severity: 'loss', entity: 'constraint', field: 'Activity.SecondaryConstraintType', disposition: 'dropped', example: `${code} (${cstr2})`, message: 'Secondary constraints are not modeled; only the primary constraint is used' })
    }

    // Activity codes, UDF values and fields Planora does not map.
    const codes = children(t, 'Code').length
    if (codes) ex.add({ severity: 'warning', entity: 'code', field: 'Activity.Code', disposition: 'dropped', count: codes, example: code, message: `Activity code assignments are not modeled; ${ORIGINAL_ONLY.toLowerCase()}` })
    const udfs = children(t, 'UDF').length
    if (udfs) ex.add({ severity: 'warning', entity: 'udf', field: 'Activity.UDF', disposition: 'dropped', count: udfs, example: code, message: `User-defined field values are not modeled; ${ORIGINAL_ONLY.toLowerCase()}` })
    for (const f of t.children) {
      if (READ_ACTIVITY.has(f.name) || (!f.children.length && EMPTYISH.test(f.text.trim()))) continue
      const list = unmappedFields.get(f.name) || []
      list.push(code)
      unmappedFields.set(f.name, list)
    }

    const driving = yes(childText(t, 'DrivingPathFlag')) || yes(childText(t, 'IsLongestPath'))
    const a = makeActivity(scheduleId, {
      activityId: code,
      name: childText(t, 'Name') || 'Unnamed Activity',
      wbs: wbsPath(childText(t, 'WBSObjectId')),
      duration: hrs('PlannedDuration', true) ?? 0,
      remainingDuration: hrs('RemainingDuration', true) ?? 0,
      percentComplete: pct,
      earlyStart: isoDatePrefix(childText(t, 'EarlyStartDate')) || isoDatePrefix(childText(t, 'RemainingEarlyStartDate')),
      earlyFinish: isoDatePrefix(childText(t, 'EarlyFinishDate')) || isoDatePrefix(childText(t, 'RemainingEarlyFinishDate')),
      lateStart: isoDatePrefix(childText(t, 'LateStartDate')),
      lateFinish: isoDatePrefix(childText(t, 'LateFinishDate')),
      actualStart: isoDatePrefix(childText(t, 'ActualStartDate')),
      actualFinish: isoDatePrefix(childText(t, 'ActualFinishDate')),
      baselineStart: isoDatePrefix(childText(t, 'PlannedStartDate')),
      baselineFinish: isoDatePrefix(childText(t, 'PlannedFinishDate')),
      totalFloat: tf ?? 0,
      freeFloat: ff ?? 0,
      isCritical: activityType !== 'loe' && activityType !== 'summary' && (driving || (tf !== null && tf <= 0 && status !== 'complete')),
      status,
      activityType,
      milestoneKind,
      calendarId: clndrId || null,
      constraintType,
      constraintDate: constraintType ? constraintDate : null,
      sourceId: childText(t, 'ObjectId') || null,
    })
    if (childText(t, 'ObjectId')) byObjectId.set(childText(t, 'ObjectId'), a)
    return a
  })
  for (const [f, ids] of unmappedFields) {
    ex.add({ severity: 'info', entity: 'activity', field: `Activity.${f}`, disposition: 'dropped', count: ids.length, examples: ids, message: `Field not mapped by Planora; ${ORIGINAL_ONLY.toLowerCase()}` })
  }

  /* ── Relationships ───────────────────────────────────── */
  const relationships: Relationship[] = []
  const relNodes = [...children(project, 'Relationship'), ...children(root, 'Relationship')]
    .filter(r => byObjectId.has(childText(r, 'SuccessorActivityObjectId')))
  const relFields = new Map<string, number>()
  for (const r of relNodes) {
    const pred = byObjectId.get(childText(r, 'PredecessorActivityObjectId'))
    const succ = byObjectId.get(childText(r, 'SuccessorActivityObjectId'))!
    if (!pred) {
      warnings.push(`Relationship ${childText(r, 'PredecessorActivityObjectId')} → ${childText(r, 'SuccessorActivityObjectId')} references an activity not in this project (external project?); skipped`)
      ex.add({ severity: 'loss', entity: 'relationship', field: 'Relationship', disposition: 'dropped', example: `${childText(r, 'PredecessorActivityObjectId')} -> ${succ.activityId}`, message: 'Relationship to an activity not in the imported project (external project?) was skipped' })
      continue
    }
    const rt = childText(r, 'Type').toLowerCase().replace(/[^a-z]/g, '')
    const type: Relationship['type'] = rt === 'starttostart' ? 'SS' : rt === 'finishtofinish' ? 'FF' : rt === 'starttofinish' ? 'SF' : 'FS'
    if (rt && !['finishtostart', 'starttostart', 'finishtofinish', 'starttofinish'].includes(rt)) ex.add({ severity: 'warning', entity: 'relationship', field: 'Relationship.Type', disposition: 'converted', example: `${pred.activityId} -> ${succ.activityId} (${childText(r, 'Type')})`, message: 'Unknown relationship type read as finish-to-start' })
    const lagExact = (parseFloat(childText(r, 'Lag')) || 0) / hoursPerDay(pred.calendarId)
    const lag = round2(lagExact)
    if (wasRounded(lagExact, lag)) ex.add({ severity: 'info', entity: 'relationship', field: 'Relationship.Lag', disposition: 'converted', example: `${pred.activityId} -> ${succ.activityId}`, message: 'Lag hours converted to work days on the predecessor calendar and rounded to 0.01 day' })
    for (const f of r.children) if (!READ_RELATIONSHIP.has(f.name) && !EMPTYISH.test(f.text.trim())) relFields.set(f.name, (relFields.get(f.name) ?? 0) + 1)
    relationships.push({ id: uuid(), scheduleId, predecessorId: pred.id, successorId: succ.id, type, lag })
  }
  for (const [f, n] of relFields) ex.add({ severity: 'info', entity: 'relationship', field: `Relationship.${f}`, disposition: 'dropped', count: n, message: `Field not mapped by Planora; ${ORIGINAL_ONLY.toLowerCase()}` })

  /* ── Resources and assignments (resource analysis; counts for the DCMA resource check) ─ */
  const assignments = [...children(project, 'ResourceAssignment'), ...children(root, 'ResourceAssignment')].filter(r => byObjectId.has(childText(r, 'ActivityObjectId')))
  const resources = p6XmlResourceData(root, project, byObjectId, dataDate)
  const roleOnly = assignments.filter(r => !childText(r, 'ResourceObjectId'))
  if (roleOnly.length) ex.add({ severity: 'info', entity: 'assignment', field: 'ResourceAssignment.RoleObjectId', disposition: 'dropped', count: roleOnly.length, examples: roleOnly.map(r => byObjectId.get(childText(r, 'ActivityObjectId'))!.activityId), message: `Assignments to a role with no resource are not loaded for resource analysis (they count for the DCMA resource check); ${ORIGINAL_ONLY.toLowerCase()}` })
  const curved = assignments.filter(r => childText(r, 'ResourceCurveObjectId'))
  if (curved.length) ex.add({ severity: 'info', entity: 'assignment', field: 'ResourceAssignment.ResourceCurveObjectId', disposition: 'dropped', count: curved.length, examples: curved.map(r => byObjectId.get(childText(r, 'ActivityObjectId'))!.activityId), message: `Resource curves are not modeled; resource analysis spreads each assignment's units evenly over the activity; ${ORIGINAL_ONLY.toLowerCase()}` })
  let resourceCounts: Record<string, number> | undefined
  if (assignments.length || children(project, 'ResourceAssignment').length) {
    resourceCounts = {}
    for (const id of byObjectId.keys()) resourceCounts[id] = 0
    for (const r of assignments) resourceCounts[childText(r, 'ActivityObjectId')]++
  }

  /* ── Scheduling options ──────────────────────────────── */
  const so = child(project, 'ScheduleOptions')
  let progressMode: ProgressMode | null = null
  if (so) {
    const oos = childText(so, 'OutOfSequenceScheduleType').toLowerCase().replace(/[^a-z]/g, '')
    if (oos === 'progressoverride') progressMode = 'override'
    else if (oos === 'retainedlogic') progressMode = 'retained'
    else if (oos) {
      warnings.push('The file schedules out-of-sequence progress with P6 "Actual Dates", which Planora does not model; Planora uses Retained Logic. Choose Progress Override for this upload if that matches your P6 settings better.')
      ex.add({ severity: 'warning', entity: 'project', field: 'ScheduleOptions.OutOfSequenceScheduleType', disposition: 'converted', example: childText(so, 'OutOfSequenceScheduleType'), message: 'Out-of-sequence progress "Actual Dates" is not modeled; Retained Logic is used' })
    }
    const lagCal = childText(so, 'RelationshipLagCalendar')
    if (lagCal && !/predecessor/i.test(lagCal)) ex.add({ severity: 'warning', entity: 'relationship', field: 'ScheduleOptions.RelationshipLagCalendar', disposition: 'converted', example: lagCal, message: 'Lags are converted and scheduled on the predecessor calendar (P6 default); the file schedules lags on another calendar' })
  }

  /* ── Baseline (the project's current baseline, when exported with it) ─ */
  const baselines = children(root, 'BaselineProject')
  const baseId = childText(project, 'CurrentBaselineProjectObjectId')
  const base = (baseId && baselines.find(b => childText(b, 'ObjectId') === baseId)) || (baselines.length === 1 && !baseId ? baselines[0] : undefined)
  const embeddedBaseline = base ? baselineOf(base) : null
  if (embeddedBaseline) warnings.push(`The file carries the P6 project baseline "${embeddedBaseline.name}" (${Object.keys(embeddedBaseline.finishes).length} activities); variance, BEI and missed tasks are measured against it unless an upload of this project is designated as Baseline.`)

  /* ── Everything else in the file ─────────────────────── */
  const tally = new Map<string, { n: number; examples: string[] }>()
  const count = (name: string, node: XNode) => {
    const t = tally.get(name) || { n: 0, examples: [] }
    t.n++
    t.examples.push(childText(node, 'Id') || childText(node, 'Name') || childText(node, 'ObjectId'))
    tally.set(name, t)
  }
  for (const n of root.children) {
    if (READ_ROOT.has(n.name)) continue
    if (n.name === 'BaselineProject' && n === base) continue
    count(n.name, n)
  }
  for (const n of project.children) {
    if (READ_PROJECT.has(n.name) && !['ActivityCodeType', 'ActivityCode', 'UDF', 'ActivityNote', 'ProjectNote'].includes(n.name)) continue
    if (!n.children.length) {
      if (!EMPTYISH.test(n.text.trim())) count(`Project.${n.name}`, n)
      continue
    }
    count(n.name, n)
  }
  for (const [name, t] of tally) {
    const [entity, severity, message] = ROOT_ENTITY[name] ?? (name.startsWith('Project.') ? ['project', 'info', 'Project field not mapped by Planora'] : ['other', 'info', `Element <${name}> is not used by Planora`])
    ex.add({ severity, entity, field: name, disposition: 'dropped', count: t.n, examples: t.examples, message: `${message}; ${EV_ONLY.has(name) ? 'the original file is kept with the upload; Planora\'s exports do not write it' : ORIGINAL_ONLY.toLowerCase()}` })
  }
  const notUsed = Array.from(tally.entries()).filter(([n]) => !n.startsWith('Project.') && !EV_ONLY.has(n))
  if (notUsed.length) warnings.push(`Not used in Planora's analysis: ${notUsed.map(([n, t]) => `${n} (${t.n})`).join('; ')}. They are kept in the original file but not in Planora's exports.`)

  return {
    projectName, dataDate, projectStart, projectFinish, mustFinishBy, projectKey, progressMode,
    activities, relationships, calendars, defaultCalendarId, warnings,
    exceptions: ex.report(),
    sourceType: 'p6_xml', embeddedBaseline, resourceCounts, resources,
  }
}

/** Per-activity baseline dates of a P6 XML BaselineProject (same rule as the XER embedded baseline). */
function baselineOf(base: XNode): EmbeddedBaseline | null {
  const starts: Record<string, string> = {}
  const finishes: Record<string, string> = {}
  for (const t of children(base, 'Activity')) {
    const code = childText(t, 'Id')
    const type = childText(t, 'Type').toLowerCase().replace(/\s+/g, '')
    if (!code || type === 'levelofeffort' || type === 'wbssummary') continue
    const st = isoDatePrefix(childText(t, 'ActualStartDate')) || isoDatePrefix(childText(t, 'PlannedStartDate')) || isoDatePrefix(childText(t, 'EarlyStartDate'))
    const fi = isoDatePrefix(childText(t, 'ActualFinishDate')) || isoDatePrefix(childText(t, 'PlannedFinishDate')) || isoDatePrefix(childText(t, 'EarlyFinishDate'))
    if (st) starts[code] = st
    if (fi) finishes[code] = fi
  }
  if (!Object.keys(finishes).length) return null
  return {
    projectId: childText(base, 'ObjectId'), name: childText(base, 'Id') || childText(base, 'Name') || childText(base, 'ObjectId'),
    dataDate: isoDatePrefix(childText(base, 'DataDate')) || null, starts, finishes,
  }
}

/** Resource assignments per activity ObjectId of the P6 XML's imported project (DCMA resource check). */
export function p6XmlResourceCounts(content: string, opts: { projectId?: string | null } = {}): Record<string, number> | null {
  try {
    return parseP6Xml(content, 'resource-counts', opts).resourceCounts ?? null
  } catch {
    return null
  }
}
