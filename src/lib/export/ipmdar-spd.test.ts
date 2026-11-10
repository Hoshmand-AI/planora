import { describe, expect, it } from 'vitest'
import { inflateRawSync } from 'zlib'
import type { GeneratedSchedule, PlanActivity, PlanLink, Rationale } from '@/lib/planning/types'
import { runCpm } from '@/lib/planning/cpm'
import { readZipEntry } from '@/lib/rag/docx'
import { buildIpmdarSpd, zipIpmdarSpd, spdString, spdStringId, IPMDAR_SPD_FILE_NAMES } from './ipmdar-spd'

/* ─── The specification (FFS 2.2 / 2.4), written out independently of the exporter ─── */

const SPEC: Record<string, { singleton?: boolean; required: string[]; optional: string[]; key?: string[] }> = {
  DatasetMetadata: {
    singleton: true, required: ['SecurityMarking', 'ReportingPeriodEndDate'],
    optional: ['DistributionStatement', 'ContractorName', 'ContractorIDCodeTypeID', 'ContractorIDCode', 'ContractorAddress_Street', 'ContractorAddress_City', 'ContractorAddress_State', 'ContractorAddress_Country', 'ContractorAddress_ZipCode', 'PointOfContactName', 'PointOfContactTitle', 'PointOfContactTelephone', 'PointOfContactEmail', 'ContractName', 'ContractNumber', 'ContractType', 'ContractTaskOrEffortName', 'ProgramName', 'ProgramPhase'],
  },
  SourceSoftwareMetadata: { singleton: true, required: [], optional: ['Data_SoftwareName', 'Data_SoftwareVersion', 'Data_SoftwareCompanyName', 'Data_SoftwareComments', 'Export_SoftwareName', 'Export_SoftwareVersion', 'Export_SoftwareCompanyName', 'Export_SoftwareComments'] },
  ProjectScheduleData: { singleton: true, required: ['StatusDate', 'CurrentStartDate', 'CurrentFinishDate', 'DurationUnitsID'], optional: ['BaselineStartDate', 'BaselineFinishDate', 'ActualStartDate', 'ActualFinishDate'] },
  Calendars: { required: ['ID', 'Name'], optional: ['Comments'], key: ['ID'] },
  CalendarWorkshifts: { required: ['CalendarID'], optional: ['Ordinal', 'SundayWorkHours', 'MondayWorkHours', 'TuesdayWorkHours', 'WednesdayWorkHours', 'ThursdayWorkHours', 'FridayWorkHours', 'SaturdayWorkHours'], key: ['CalendarID', 'Ordinal'] },
  CalendarExceptions: { required: ['CalendarID', 'ExceptionDate'], optional: ['WorkHours'], key: ['CalendarID', 'ExceptionDate'] },
  Tasks: { required: ['ID', 'Name', 'TaskTypeID'], optional: ['TaskSubtypeID', 'TaskPlanningLevelID', 'WBSElementID', 'OBSElementID', 'ControlAccountID', 'WorkPackageID', 'IMPElementID', 'SOWReference', 'SubcontractorReference', 'EarnedValueTechniqueID', 'OtherEarnedValueTechnique', 'SourceSubprojectReference', 'SourceTaskReference', 'Comments'], key: ['ID'] },
  TaskScheduleData: {
    required: ['TaskID', 'CalendarID', 'CurrentDuration', 'CurrentStartDate', 'CurrentFinishDate', 'EarlyStartDate', 'EarlyFinishDate', 'LateStartDate', 'LateFinishDate', 'FreeFloatDuration', 'TotalFloatDuration', 'OnCriticalPath', 'CalculatedPercentComplete', 'RemainingDuration'],
    optional: ['OnDrivingPath', 'BaselineDuration', 'BaselineStartDate', 'BaselineFinishDate', 'StartVarianceDuration', 'FinishVarianceDuration', 'PhysicalPercentComplete', 'ActualStartDate', 'ActualFinishDate'], key: ['TaskID'],
  },
  TaskConstraints: { required: ['TaskID', 'ConstraintTypeID'], optional: ['OtherConstraintType', 'ConstraintDate'], key: ['TaskID', 'ConstraintTypeID'] },
  TaskRelationships: { required: ['PredecessorTaskID', 'SuccessorTaskID', 'RelationshipTypeID'], optional: ['LagDuration', 'LagCalendarID'], key: ['PredecessorTaskID', 'SuccessorTaskID', 'RelationshipTypeID'] },
  TaskOutlineStructure: { required: ['Level', 'TaskID'], optional: ['ParentTaskID'], key: ['TaskID'] },
  Resources: { required: ['ID', 'Name', 'ElementOfCostID'], optional: ['Comments'], key: ['ID'] },
  ResourceAssignments: { required: ['ResourceID', 'TaskID'], optional: ['Budget_AtCompletion_Dollars', 'Budget_AtCompletion_Hours', 'Estimate_ToComplete_Dollars', 'Estimate_ToComplete_Hours', 'Actual_ToDate_Dollars', 'Actual_ToDate_Hours', 'PhysicalPercentComplete'], key: ['ResourceID', 'TaskID'] },
}
const TASK_TYPES = ['ACTIVITY', 'MILESTONE', 'SUMMARY', 'HAMMOCK']
const PLANNING_LEVELS = ['SUMMARY_LEVEL_PLANNING_PACKAGE', 'CONTROL_ACCOUNT', 'PLANNING_PACKAGE', 'WORK_PACKAGE', 'ACTIVITY']
const CONSTRAINT_TYPES = ['START_NO_EARLIER_THAN', 'FINISH_NO_EARLIER_THAN', 'START_NO_LATER_THAN', 'FINISH_NO_LATER_THAN', 'MUST_START_ON', 'MUST_FINISH_ON', 'AS_LATE_AS_POSSIBLE', 'SHOULD_START_NO_LATER_THAN', 'SHOULD_FINISH_NO_LATER_THAN', 'SHOULD_START_ON', 'SHOULD_FINISH_ON', 'RESOURCE_LEVELING_START_DELAY', 'RESOURCE_LEVELING_FINISH_DELAY', 'DEADLINE', 'OTHER']
const RELATIONSHIP_TYPES = ['FINISH_TO_START', 'START_TO_START', 'FINISH_TO_FINISH', 'START_TO_FINISH']
const COST_ELEMENTS = ['LABOR', 'MATERIAL', 'OTHER_DIRECT_COSTS', 'SUBCONTRACT']
const DATE = /^\d{4}-\d{2}-\d{2}$/
const STRING_ID = /^[\x21-\x7E]+( [\x21-\x7E]+)*$/

/* ─── Fixture ─── */

const rationale: Rationale = { summary: 'test', sources: [], confidence: 'high' }
const act = (id: string, code: string, name: string, duration: number, extra: Partial<PlanActivity> = {}): PlanActivity =>
  ({ id, code, name, duration, type: duration === 0 ? 'milestone' : 'task', category: 'other', phase: 'sitework', rationale, ...extra })
const link = (from: string, to: string, type: PlanLink['type'], lag = 0): PlanLink => ({ id: `${from}>${to}`, from, to, type, lag, rationale })

function schedule(over: Partial<GeneratedSchedule> = {}, wbs = false): GeneratedSchedule {
  const w = (path: string) => (wbs ? { wbs: path } : {})
  const s: GeneratedSchedule = {
    generatedAt: '2026-01-14T00:00:00Z',
    projectStart: '2026-01-05',
    dataDate: '2026-01-14',
    calendars: [
      { id: 'cal5', name: '5-day × 8h', workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidays: ['2026-01-19', '2026-02-16'], extraWorkDays: ['2026-01-24'] },
      { id: 'cal7', name: '7-day  cure', workDays: [0, 1, 2, 3, 4, 5, 6], hoursPerDay: 10, holidays: [] },
    ],
    defaultCalendarId: 'cal5',
    activities: [
      act('a0', 'M100', 'Notice to Proceed', 0, { actualStart: '2026-01-05', actualFinish: '2026-01-05', status: 'complete', ...w('1 Site') }),
      act('a1', 'A100', 'Mobilize', 5, { actualStart: '2026-01-05', actualFinish: '2026-01-09', status: 'complete', percentComplete: 100, baselineStart: '2026-01-05', baselineFinish: '2026-01-08', ...w('1 Site') }),
      act('a2', 'A110', 'Excavate', 10, { actualStart: '2026-01-12', remaining: 6, status: 'in_progress', percentComplete: 40, baselineStart: '2026-01-12', baselineFinish: '2026-01-23', ...w('1.1 Earthwork') }),
      act('a3', 'A120', 'Foundations', 8, { ...w('2 Structure') }),
      act('a4', 'A130', 'Utilities', 5, { constraint: { type: 'SNET', date: '2026-01-26' }, ...w('1.2 Utilities') }),
      act('a5', 'A140', 'Concrete cure', 4, { calendarId: 'cal7', ...w('2 Structure') }),
      act('a6', 'A150', 'Backfill', 4, { ...w('1.1 Earthwork') }),
      act('a7', 'M900', 'Substantial Completion', 0, { ...w('2 Structure') }),
    ],
    links: [
      link('a0', 'a1', 'FS'), link('a1', 'a2', 'FS'), link('a2', 'a3', 'FS', 2), link('a2', 'a4', 'SS', 1),
      link('a3', 'a5', 'FS'), link('a5', 'a6', 'FF', 1), link('a4', 'a6', 'SF', -1), link('a6', 'a7', 'FS'),
    ],
    assumptions: [],
    ...over,
  }
  s.cpm = runCpm({ projectStart: s.projectStart, dataDate: s.dataDate, activities: s.activities, links: s.links, calendars: s.calendars, defaultCalendarId: s.defaultCalendarId })
  return s
}

type Row = Record<string, unknown>
const OPTS = { securityMarking: 'UNCLASSIFIED', reportingPeriodEndDate: '2026-01-31', softwareVersion: '1.0.0' }
function parse(files: Record<string, string>) {
  const t: Record<string, Row[]> = {}
  const one: Record<string, Row> = {}
  for (const [name, text] of Object.entries(files)) {
    if (!name.endsWith('.json')) continue
    const v = JSON.parse(text)
    const table = name.replace(/\.json$/, '')
    if (Array.isArray(v)) t[table] = v
    else one[table] = v
  }
  return { t, one }
}

/** Every structural rule of the spec that can be checked on a dataset. */
function checkDataset(files: Record<string, string>) {
  expect(files['FileType.txt']).toBe('IPMDAR_SCHEDULE_PERFORMANCE_DATASET/1.0')
  for (const name of Object.keys(files)) expect(IPMDAR_SPD_FILE_NAMES as readonly string[]).toContain(name)
  const { t, one } = parse(files)
  for (const [table, spec] of Object.entries(SPEC)) {
    const present = spec.singleton ? one[table] : t[table]
    if (spec.singleton) expect(present, `${table} is a single object`).toBeTypeOf('object')
    if (!present) continue
    expect(Array.isArray(JSON.parse(files[`${table}.json`]))).toBe(!spec.singleton)
    const rows: Row[] = spec.singleton ? [present as Row] : (present as Row[])
    if (!spec.singleton) expect(rows.length, `${table} is omitted when empty`).toBeGreaterThan(0)
    const allowed = new Set([...spec.required, ...spec.optional])
    const keys = new Set<string>()
    for (const r of rows) {
      for (const [k, v] of Object.entries(r)) {
        expect(allowed.has(k), `${table}.${k} is a field of the spec`).toBe(true)
        expect(v === null || v === '', `${table}.${k} is not null or empty`).toBe(false)
        if (/Date$/.test(k)) expect(v, `${table}.${k}`).toMatch(DATE)
        if (/(Duration|WorkHours|Hours|PercentComplete)$/.test(k)) expect(Number.isFinite(v), `${table}.${k} is a number`).toBe(true)
        if (/(ID|TaskID)$/.test(k) || k === 'ID') expect(v, `${table}.${k} is a StringID`).toMatch(STRING_ID)
        if (typeof v === 'string') expect(v).toBe(spdString(v))
        if (/PercentComplete$/.test(k)) { expect(v as number).toBeGreaterThanOrEqual(0); expect(v as number).toBeLessThanOrEqual(1) }
      }
      for (const k of spec.required) expect(r, `${table}.${k} is required`).toHaveProperty(k)
      if (spec.key) {
        const key = spec.key.map(k => String(r[k] ?? 0).toLowerCase()).join('|')
        expect(keys.has(key), `${table} key ${key} is unique`).toBe(false)
        keys.add(key)
      }
    }
  }
  // Every JSON file is one of the tables checked above.
  for (const name of Object.keys(files)) if (name.endsWith('.json')) expect(SPEC).toHaveProperty(name.replace(/\.json$/, ''))

  const ids = (rows: Row[] | undefined, f: string) => new Set((rows || []).map(r => r[f] as string))
  const taskIds = ids(t.Tasks, 'ID'), calIds = ids(t.Calendars, 'ID'), resIds = ids(t.Resources, 'ID')
  const taskType = new Map((t.Tasks || []).map(r => [r.ID as string, r.TaskTypeID as string]))
  expect(['DAYS', 'HOURS']).toContain(one.ProjectScheduleData.DurationUnitsID)
  // Enumerations
  for (const r of t.Tasks || []) {
    expect(TASK_TYPES).toContain(r.TaskTypeID)
    if (r.TaskTypeID === 'ACTIVITY') expect(PLANNING_LEVELS).toContain(r.TaskPlanningLevelID)
  }
  for (const r of t.TaskConstraints || []) {
    expect(CONSTRAINT_TYPES).toContain(r.ConstraintTypeID)
    if (r.ConstraintTypeID !== 'AS_LATE_AS_POSSIBLE' && r.ConstraintTypeID !== 'OTHER') expect(r.ConstraintDate).toMatch(DATE)
  }
  for (const r of t.TaskRelationships || []) expect(RELATIONSHIP_TYPES).toContain(r.RelationshipTypeID)
  for (const r of t.Resources || []) expect(COST_ELEMENTS).toContain(r.ElementOfCostID)
  // Referential integrity
  for (const r of t.TaskScheduleData || []) { expect(taskIds.has(r.TaskID as string)).toBe(true); expect(calIds.has(r.CalendarID as string)).toBe(true) }
  for (const id of taskIds) expect(ids(t.TaskScheduleData, 'TaskID').has(id), `task ${id} has schedule data`).toBe(true)
  for (const r of t.TaskConstraints || []) expect(taskIds.has(r.TaskID as string)).toBe(true)
  for (const r of t.TaskRelationships || []) {
    expect(taskIds.has(r.PredecessorTaskID as string)).toBe(true)
    expect(taskIds.has(r.SuccessorTaskID as string)).toBe(true)
    if (r.LagCalendarID !== undefined) expect(calIds.has(r.LagCalendarID as string)).toBe(true)
  }
  for (const r of t.CalendarWorkshifts || []) {
    expect(calIds.has(r.CalendarID as string)).toBe(true)
    const hours = Object.entries(r).filter(([k]) => k.endsWith('WorkHours')).map(([, v]) => v as number)
    expect(hours.every(h => h >= 0)).toBe(true)
    expect(hours.some(h => h > 0)).toBe(true)
  }
  for (const id of calIds) expect(ids(t.CalendarWorkshifts, 'CalendarID').has(id), `calendar ${id} has a workshift`).toBe(true)
  for (const r of t.CalendarExceptions || []) { expect(calIds.has(r.CalendarID as string)).toBe(true); expect(r.WorkHours as number).toBeGreaterThanOrEqual(0) }
  for (const r of t.ResourceAssignments || []) { expect(resIds.has(r.ResourceID as string)).toBe(true); expect(taskIds.has(r.TaskID as string)).toBe(true) }
  // Baseline fields: all or none
  for (const r of t.TaskScheduleData || []) {
    const n = ['BaselineDuration', 'BaselineStartDate', 'BaselineFinishDate', 'StartVarianceDuration', 'FinishVarianceDuration'].filter(k => k in r).length
    expect([0, 5]).toContain(n)
  }
  // Outline: depth-first, levels from 1, never skipping; parents are the implied SUMMARY tasks
  const outline = t.TaskOutlineStructure
  const summaries = [...taskType].filter(([, ty]) => ty === 'SUMMARY').map(([id]) => id)
  if (summaries.length) expect(outline).toBeDefined()
  if (outline) {
    const stack: Row[] = []
    let prev = 0
    for (const r of outline) {
      const level = r.Level as number
      expect(Number.isInteger(level) && level >= 1 && level <= prev + 1).toBe(true)
      expect(taskIds.has(r.TaskID as string)).toBe(true)
      stack.length = level - 1
      if (level === 1) expect(r).not.toHaveProperty('ParentTaskID')
      else {
        expect(r.ParentTaskID).toBe(stack[level - 2].TaskID)
        expect(taskType.get(r.ParentTaskID as string)).toBe('SUMMARY')
      }
      stack.push(r)
      prev = level
    }
    expect(outline[0].Level).toBe(1)
    for (const id of summaries) expect(outline.some(r => r.TaskID === id)).toBe(true)
  }
  return { t, one }
}

/* ─── Tests ─── */

describe('IPMDAR SPD export', () => {
  const s = schedule()
  const { files, warnings } = buildIpmdarSpd(s, OPTS)
  const { t, one } = parse(files)
  const sd = (id: string) => t.TaskScheduleData.find(r => r.TaskID === id)!

  it('writes FileType.txt exactly, with no quotes, BOM or newline', () => {
    expect(files['FileType.txt']).toBe('IPMDAR_SCHEDULE_PERFORMANCE_DATASET/1.0')
  })

  it('conforms to the spec: field names, required fields, enums, dates, keys, references', () => {
    checkDataset(files)
  })

  it('writes the expected files and omits empty tables', () => {
    expect(Object.keys(files).sort()).toEqual(['CalendarExceptions.json', 'CalendarWorkshifts.json', 'Calendars.json', 'DatasetMetadata.json', 'FileType.txt', 'ProjectScheduleData.json', 'SourceSoftwareMetadata.json', 'TaskConstraints.json', 'TaskRelationships.json', 'TaskScheduleData.json', 'Tasks.json'])
  })

  it('writes the singletons as single objects', () => {
    expect(one.DatasetMetadata).toEqual({ SecurityMarking: 'UNCLASSIFIED', ReportingPeriodEndDate: '2026-01-31' })
    expect(one.SourceSoftwareMetadata).toEqual({ Data_SoftwareName: 'RunF9', Data_SoftwareVersion: '1.0.0', Export_SoftwareName: 'RunF9', Export_SoftwareVersion: '1.0.0' })
    expect(one.ProjectScheduleData).toMatchObject({ StatusDate: '2026-01-14', CurrentStartDate: '2026-01-05', CurrentFinishDate: s.cpm!.projectFinish, ActualStartDate: '2026-01-05', DurationUnitsID: 'DAYS', BaselineStartDate: '2026-01-05', BaselineFinishDate: '2026-01-23' })
    expect(one.ProjectScheduleData).not.toHaveProperty('ActualFinishDate')
    expect(JSON.stringify(one)).not.toMatch(/EVMS/i)
  })

  it('maps milestones and activities, using the activity code as the stable task ID', () => {
    expect(t.Tasks.map(r => r.ID)).toEqual(['M100', 'A100', 'A110', 'A120', 'A130', 'A140', 'A150', 'M900'])
    expect(t.Tasks[0]).toEqual({ ID: 'M100', Name: 'Notice to Proceed', TaskTypeID: 'MILESTONE' })
    expect(t.Tasks[1]).toEqual({ ID: 'A100', Name: 'Mobilize', TaskTypeID: 'ACTIVITY', TaskPlanningLevelID: 'ACTIVITY' })
    expect(warnings.some(w => w.includes('TaskPlanningLevelID'))).toBe(true)
  })

  it('writes progress: percent as a fraction, actual dates, remaining duration', () => {
    expect(sd('A100')).toMatchObject({ CalculatedPercentComplete: 1, RemainingDuration: 0, ActualStartDate: '2026-01-05', ActualFinishDate: '2026-01-09', CurrentStartDate: '2026-01-05', CurrentFinishDate: '2026-01-09', CurrentDuration: 5 })
    const b = sd('A110')
    expect(b).toMatchObject({ CalculatedPercentComplete: 0.4, RemainingDuration: 6, ActualStartDate: '2026-01-12', CalendarID: 'cal5' })
    expect(b).not.toHaveProperty('ActualFinishDate')
    expect(b.CurrentFinishDate).toBe(s.cpm!.times.a2.earlyFinish)
    const c = sd('A120')
    expect(c).toMatchObject({ CalculatedPercentComplete: 0, RemainingDuration: 8, CurrentDuration: 8 })
    expect(c).not.toHaveProperty('ActualStartDate')
    expect(sd('M900')).toMatchObject({ CurrentDuration: 0, RemainingDuration: 0 })
    expect(sd('A140').CalendarID).toBe('cal7')
  })

  it('writes float, critical and driving path from the CPM', () => {
    for (const a of s.activities) {
      const tm = s.cpm!.times[a.id], r = sd(a.code)
      expect(r).toMatchObject({ EarlyStartDate: tm.earlyStart, EarlyFinishDate: tm.earlyFinish, LateStartDate: tm.lateStart, LateFinishDate: tm.lateFinish, TotalFloatDuration: tm.totalFloat, FreeFloatDuration: tm.freeFloat, OnCriticalPath: tm.critical, OnDrivingPath: s.cpm!.longestPath.includes(a.id) })
    }
  })

  it('writes baseline and variance (current minus baseline, in work days) together', () => {
    // Mobilize: baseline 01/05–01/08 (4 work days), finished 01/09: one work day late.
    expect(sd('A100')).toMatchObject({ BaselineDuration: 4, BaselineStartDate: '2026-01-05', BaselineFinishDate: '2026-01-08', StartVarianceDuration: 0, FinishVarianceDuration: 1 })
    expect(sd('A120')).not.toHaveProperty('BaselineStartDate')
  })

  it('writes all four relationship types with lag on the predecessor calendar', () => {
    expect(t.TaskRelationships).toEqual([
      { PredecessorTaskID: 'M100', SuccessorTaskID: 'A100', RelationshipTypeID: 'FINISH_TO_START', LagDuration: 0 },
      { PredecessorTaskID: 'A100', SuccessorTaskID: 'A110', RelationshipTypeID: 'FINISH_TO_START', LagDuration: 0 },
      { PredecessorTaskID: 'A110', SuccessorTaskID: 'A120', RelationshipTypeID: 'FINISH_TO_START', LagDuration: 2, LagCalendarID: 'cal5' },
      { PredecessorTaskID: 'A110', SuccessorTaskID: 'A130', RelationshipTypeID: 'START_TO_START', LagDuration: 1, LagCalendarID: 'cal5' },
      { PredecessorTaskID: 'A120', SuccessorTaskID: 'A140', RelationshipTypeID: 'FINISH_TO_START', LagDuration: 0 },
      { PredecessorTaskID: 'A140', SuccessorTaskID: 'A150', RelationshipTypeID: 'FINISH_TO_FINISH', LagDuration: 1, LagCalendarID: 'cal7' },
      { PredecessorTaskID: 'A130', SuccessorTaskID: 'A150', RelationshipTypeID: 'START_TO_FINISH', LagDuration: -1, LagCalendarID: 'cal5' },
      { PredecessorTaskID: 'A150', SuccessorTaskID: 'M900', RelationshipTypeID: 'FINISH_TO_START', LagDuration: 0 },
    ])
  })

  it('writes a constraint row only for constrained tasks', () => {
    expect(t.TaskConstraints).toEqual([{ TaskID: 'A130', ConstraintTypeID: 'START_NO_EARLIER_THAN', ConstraintDate: '2026-01-26' }])
  })

  it('maps every RunF9 constraint type to an SPD constraint ID', () => {
    const map = { SNET: 'START_NO_EARLIER_THAN', SNLT: 'START_NO_LATER_THAN', FNET: 'FINISH_NO_EARLIER_THAN', FNLT: 'FINISH_NO_LATER_THAN', SO: 'SHOULD_START_ON', FO: 'SHOULD_FINISH_ON', MSO: 'MUST_START_ON', MFO: 'MUST_FINISH_ON' } as const
    for (const [type, id] of Object.entries(map)) {
      const x = schedule()
      x.activities[3].constraint = { type: type as keyof typeof map, date: '2026-02-02' }
      const r = parse(buildIpmdarSpd(x, OPTS).files).t.TaskConstraints
      expect(r).toContainEqual({ TaskID: 'A120', ConstraintTypeID: id, ConstraintDate: '2026-02-02' })
    }
  })

  it('writes calendars as hours per weekday with holiday and extra-work-day exceptions', () => {
    expect(t.Calendars).toEqual([{ ID: 'cal5', Name: '5-day × 8h' }, { ID: 'cal7', Name: '7-day cure' }])
    expect(t.CalendarWorkshifts[0]).toEqual({ CalendarID: 'cal5', SundayWorkHours: 0, MondayWorkHours: 8, TuesdayWorkHours: 8, WednesdayWorkHours: 8, ThursdayWorkHours: 8, FridayWorkHours: 8, SaturdayWorkHours: 0 })
    expect(t.CalendarWorkshifts[1].SundayWorkHours).toBe(10)
    expect(t.CalendarExceptions).toEqual([
      { CalendarID: 'cal5', ExceptionDate: '2026-01-19', WorkHours: 0 },
      { CalendarID: 'cal5', ExceptionDate: '2026-01-24', WorkHours: 8 },
      { CalendarID: 'cal5', ExceptionDate: '2026-02-16', WorkHours: 0 },
    ])
  })

  it('never writes MM/DD/YYYY dates', () => {
    for (const text of Object.values(files)) expect(text).not.toMatch(/\d{2}\/\d{2}\/\d{4}/)
  })

  it('converts durations, float and lag to hours when asked', () => {
    const h = parse(buildIpmdarSpd(s, { ...OPTS, durationUnits: 'HOURS' }).files)
    expect(h.one.ProjectScheduleData.DurationUnitsID).toBe('HOURS')
    expect(h.t.TaskScheduleData.find(r => r.TaskID === 'A120')).toMatchObject({ CurrentDuration: 64, RemainingDuration: 64 })
    expect(h.t.TaskScheduleData.find(r => r.TaskID === 'A140')).toMatchObject({ CurrentDuration: 40 })
    expect(h.t.TaskRelationships.find(r => r.SuccessorTaskID === 'A120')).toMatchObject({ LagDuration: 16 })
    expect(h.t.TaskRelationships.find(r => r.RelationshipTypeID === 'FINISH_TO_FINISH')).toMatchObject({ LagDuration: 10 })
    expect(h.t.TaskScheduleData.find(r => r.TaskID === 'A110')!.CalculatedPercentComplete).toBe(0.4)
  })

  it('is deterministic', () => {
    expect(buildIpmdarSpd(schedule(), OPTS).files).toEqual(files)
  })
})

describe('IPMDAR SPD: warnings and dropped rows', () => {
  it('leaves the security marking out rather than guessing, and says so', () => {
    const r = buildIpmdarSpd(schedule())
    const meta = JSON.parse(r.files['DatasetMetadata.json'])
    expect(meta).toEqual({ ReportingPeriodEndDate: '2026-01-14' })
    expect(r.warnings.some(w => w.includes('SecurityMarking') && w.includes('left out'))).toBe(true)
    expect(r.warnings.some(w => w.includes('ReportingPeriodEndDate') && w.includes('2026-01-14'))).toBe(true)
  })

  it('falls back to the project start when there is no data date', () => {
    const r = buildIpmdarSpd(schedule({ dataDate: undefined }), OPTS)
    expect(JSON.parse(r.files['ProjectScheduleData.json']).StatusDate).toBe('2026-01-05')
    expect(r.warnings.some(w => w.includes('no data date'))).toBe(true)
  })

  it('drops rows that cannot be written and reports each kind', () => {
    const s = schedule()
    s.activities.push(act('zz', 'Z999', 'Not in the CPM', 3))                          // no dates
    s.links.push(link('a3', 'zz', 'FS'), link('a0', 'a1', 'FS'), link('a3', 'ghost', 'FS'), link('a3', 'a3', 'FS'))
    ;(s.activities[3] as { constraint?: unknown }).constraint = { type: 'ALAP_X', date: '2026-02-02' }
    s.activities[5].baselineStart = '2026-02-01'                                       // half a baseline
    s.activities[4].calendarId = 'nope'
    s.calendars[0].holidays.push('not-a-date')
    const r = buildIpmdarSpd(s, OPTS)
    const { t } = checkDataset(r.files)
    expect(t.Tasks.some(x => x.ID === 'Z999')).toBe(false)
    expect(t.TaskRelationships).toHaveLength(8)
    expect(t.TaskConstraints.some(x => x.TaskID === 'A120')).toBe(false)
    const has = (...parts: string[]) => r.warnings.some(w => parts.every(p => w.includes(p)))
    expect(has('Z999', 'left out')).toBe(true)
    expect(has('2 relationships were left out', 'not in the exported tasks')).toBe(true)
    expect(has('1 relationship repeats')).toBe(true)
    expect(has('1 relationship links an activity to itself')).toBe(true)
    expect(has('ALAP_X', 'TaskConstraints')).toBe(true)
    expect(has('A140', 'baseline')).toBe(true)
    expect(has('A130', 'default calendar')).toBe(true)
    expect(has('1 exception has no valid date')).toBe(true)
  })

  it('makes task IDs printable ASCII and unique ignoring case', () => {
    const s = schedule()
    s.activities[3].code = 'a100'          // collides with A100 when case is ignored
    s.activities[4].code = ' Früh\t 1 '
    const r = buildIpmdarSpd(s, OPTS)
    const { t } = checkDataset(r.files)
    expect(t.Tasks.map(x => x.ID)).toEqual(['M100', 'A100', 'A110', 'a100-2', 'Fr_h 1', 'A140', 'A150', 'M900'])
    expect(r.warnings.some(w => w.includes('a100-2') && w.includes('Fr_h 1'))).toBe(true)
    expect(spdStringId('  a\u0001b\n c ')).toBe('ab c')
  })

  it('reports started or finished work that has no actual date', () => {
    const s = schedule()
    s.activities[1].actualFinish = null    // status complete, no actual finish
    const r = buildIpmdarSpd(s, OPTS)
    expect(r.warnings.some(w => w.includes('no actual finish date') && w.includes('A100'))).toBe(true)
    expect(parse(r.files).t.TaskScheduleData.find(x => x.TaskID === 'A100')).not.toHaveProperty('ActualFinishDate')
  })

  it('passes optional metadata through and enforces the contractor ID rule', () => {
    const r = buildIpmdarSpd(schedule(), { ...OPTS, metadata: { ContractorName: ' Acme  Builders ', ContractorIDCode: '1ABC2', ContractNumber: 'W912-26-C-0001', ProgramName: '' } })
    expect(JSON.parse(r.files['DatasetMetadata.json'])).toEqual({ SecurityMarking: 'UNCLASSIFIED', ReportingPeriodEndDate: '2026-01-31', ContractorName: 'Acme Builders', ContractNumber: 'W912-26-C-0001' })
    expect(r.warnings.some(w => w.includes('contractor ID code'))).toBe(true)
    const ok = buildIpmdarSpd(schedule(), { ...OPTS, metadata: { ContractorIDCodeTypeID: 'CAGE', ContractorIDCode: '1ABC2' } })
    expect(JSON.parse(ok.files['DatasetMetadata.json'])).toMatchObject({ ContractorIDCodeTypeID: 'CAGE', ContractorIDCode: '1ABC2' })
    checkDataset(ok.files)
  })

  it('still produces the singletons for an empty schedule', () => {
    const r = buildIpmdarSpd({ generatedAt: '', projectStart: '2026-01-05', calendars: [], defaultCalendarId: 'x', activities: [], links: [], assumptions: [] }, OPTS)
    expect(Object.keys(r.files).sort()).toEqual(['DatasetMetadata.json', 'FileType.txt', 'ProjectScheduleData.json', 'SourceSoftwareMetadata.json'])
    expect(r.warnings.some(w => w.includes('CurrentFinishDate'))).toBe(true)
  })
})

describe('IPMDAR SPD: WBS outline', () => {
  const s = schedule({}, true)
  const r = buildIpmdarSpd(s, { ...OPTS, projectName: 'Test Project' })

  it('writes WBS elements as SUMMARY tasks with a valid outline', () => {
    const { t } = checkDataset(r.files)
    const summaries = t.Tasks.filter(x => x.TaskTypeID === 'SUMMARY')
    expect(summaries.map(x => x.ID).sort()).toEqual(['WBS-1', 'WBS-1.1', 'WBS-1.2', 'WBS-2'])
    expect(summaries.find(x => x.ID === 'WBS-1.1')).toEqual({ ID: 'WBS-1.1', Name: 'Earthwork', TaskTypeID: 'SUMMARY' })
    expect(t.TaskOutlineStructure).toHaveLength(12)
    expect(t.TaskOutlineStructure.find(x => x.TaskID === 'A110')).toEqual({ Level: 3, TaskID: 'A110', ParentTaskID: 'WBS-1.1' })
    expect(t.TaskOutlineStructure.find(x => x.TaskID === 'WBS-1.1')).toEqual({ Level: 2, TaskID: 'WBS-1.1', ParentTaskID: 'WBS-1' })
    expect(t.TaskOutlineStructure.find(x => x.TaskID === 'M100')).toEqual({ Level: 2, TaskID: 'M100', ParentTaskID: 'WBS-1' })
    expect(t.Tasks.find(x => x.ID === 'A110')!.WBSElementID).toBe('1.1')
    expect(r.warnings.some(w => w.includes('SUMMARY'))).toBe(true)
  })

  it('rolls summary dates and progress up from the activities beneath', () => {
    const { t } = parse(r.files)
    const top = t.TaskScheduleData.find(x => x.TaskID === 'WBS-1')!
    const kids = ['M100', 'A100', 'A110', 'A130', 'A150'].map(id => t.TaskScheduleData.find(x => x.TaskID === id)!)
    expect(top.CurrentStartDate).toBe('2026-01-05')
    expect(top.CurrentFinishDate).toBe(kids.map(k => k.CurrentFinishDate as string).sort().pop())
    expect(top.ActualStartDate).toBe('2026-01-05')
    expect(top).not.toHaveProperty('ActualFinishDate')
    expect(top.CalculatedPercentComplete as number).toBeGreaterThan(0)
    expect(top.CalculatedPercentComplete as number).toBeLessThan(1)
    expect(top.OnCriticalPath).toBe(kids.some(k => k.OnCriticalPath))
  })

  it('can be switched off', () => {
    const off = buildIpmdarSpd(s, { ...OPTS, outline: false })
    expect(off.files).not.toHaveProperty('TaskOutlineStructure.json')
    expect(parse(off.files).t.Tasks.every(x => x.TaskTypeID !== 'SUMMARY')).toBe(true)
  })
})

describe('IPMDAR SPD: resources', () => {
  it('writes resources and assignments, merging duplicates and dropping orphans', () => {
    const s = schedule()
    s.resources = {
      source: 'plan', notes: [],
      resources: [
        { id: 'r1', code: 'CARP', name: 'Carpenter', kind: 'labor' },
        { id: 'r2', code: 'EXC', name: 'Excavator', kind: 'nonlabor' },
        { id: 'r3', code: 'CONC', name: 'Concrete', kind: 'material', unit: 'CY' },
        { id: 'r4', code: 'IDLE', name: 'Unused', kind: 'labor' },
      ],
      assignments: [
        { activityId: 'a3', resourceId: 'r1', budgetUnits: 64, actualUnits: 0, remainingUnits: 64 },
        { activityId: 'a3', resourceId: 'r1', budgetUnits: 16, actualUnits: 0, remainingUnits: 16 },
        { activityId: 'a2', resourceId: 'r2', budgetUnits: 80, actualUnits: 32, remainingUnits: 48 },
        { activityId: 'a3', resourceId: 'r3', budgetUnits: 120, actualUnits: 0, remainingUnits: 120 },
        { activityId: 'gone', resourceId: 'r1', budgetUnits: 8, actualUnits: 0, remainingUnits: 8 },
        { activityId: 'a3', resourceId: 'nobody', budgetUnits: 8, actualUnits: 0, remainingUnits: 8 },
      ],
    }
    const r = buildIpmdarSpd(s, OPTS)
    const { t } = checkDataset(r.files)
    expect(t.Resources).toEqual([
      { ID: 'CARP', Name: 'Carpenter', ElementOfCostID: 'LABOR' },
      { ID: 'CONC', Name: 'Concrete', ElementOfCostID: 'MATERIAL' },
      { ID: 'EXC', Name: 'Excavator', ElementOfCostID: 'OTHER_DIRECT_COSTS' },
    ])
    expect(t.ResourceAssignments).toEqual([
      { ResourceID: 'CARP', TaskID: 'A120', Budget_AtCompletion_Hours: 80, Estimate_ToComplete_Hours: 80, Actual_ToDate_Hours: 0 },
      { ResourceID: 'CONC', TaskID: 'A120' },
      { ResourceID: 'EXC', TaskID: 'A110', Budget_AtCompletion_Hours: 80, Estimate_ToComplete_Hours: 48, Actual_ToDate_Hours: 32 },
    ])
    for (const part of ['1 resource has no assignment', 'not in the exported tasks', 'not in the schedule', 'added together', 'OTHER_DIRECT_COSTS', 'Material quantities', 'dollar fields']) {
      expect(r.warnings.some(w => w.includes(part)), part).toBe(true)
    }
  })
})

describe('IPMDAR SPD: ZIP', () => {
  const { files } = buildIpmdarSpd(schedule({}, true), { ...OPTS, metadata: { ProgramName: 'Programme Ünïcode — 測試' } })
  const zip = zipIpmdarSpd(files)

  /** Central directory entries, parsed independently of the writer. */
  function entries(buf: Buffer) {
    const eocd = buf.length - 22
    expect(buf.readUInt32LE(eocd)).toBe(0x06054b50)
    const count = buf.readUInt16LE(eocd + 10)
    let p = buf.readUInt32LE(eocd + 16)
    expect(p + buf.readUInt32LE(eocd + 12)).toBe(eocd)
    const out: { name: string; flags: number; method: number; crc: number; data: Buffer }[] = []
    for (let i = 0; i < count; i++) {
      expect(buf.readUInt32LE(p)).toBe(0x02014b50)
      const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16)
      const comp = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24), nameLen = buf.readUInt16LE(p + 28)
      const local = buf.readUInt32LE(p + 42)
      const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
      expect(buf.readUInt32LE(local)).toBe(0x04034b50)
      expect(buf.readUInt16LE(local + 6)).toBe(flags)
      expect(buf.readUInt16LE(local + 8)).toBe(method)
      expect(buf.readUInt32LE(local + 14)).toBe(crc)
      expect(buf.toString('utf8', local + 30, local + 30 + buf.readUInt16LE(local + 26))).toBe(name)
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
      const data = inflateRawSync(buf.subarray(start, start + comp))
      expect(data.length).toBe(size)
      out.push({ name, flags, method, crc, data })
      p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32)
    }
    expect(p).toBe(eocd)
    return out
  }

  /** Reference CRC-32 (bitwise), independent of zlib.crc32. */
  function crc(buf: Buffer) {
    let c = 0xffffffff
    for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1 }
    return (c ^ 0xffffffff) >>> 0
  }

  it('round-trips every file, DEFLATE, unencrypted, UTF-8 names, at the root', () => {
    const list = entries(zip)
    expect(list.map(e => e.name).sort()).toEqual(Object.keys(files).sort())
    expect(list[0].name).toBe('FileType.txt')
    for (const e of list) {
      expect(e.method).toBe(8)
      expect(e.flags & 0x0001).toBe(0)       // not encrypted
      expect(e.flags & 0x0800).toBe(0x0800)  // UTF-8 names
      expect(e.name).not.toMatch(/[\\/]/)
      expect(e.data.toString('utf8')).toBe(files[e.name])
      expect(e.crc).toBe(crc(e.data))
    }
    expect(list.find(e => e.name === 'DatasetMetadata.json')!.data.toString('utf8')).toContain('Programme Ünïcode — 測試')
  })

  it("is read by the product's own ZIP reader", () => {
    for (const [name, text] of Object.entries(files)) expect(readZipEntry(zip, name)?.toString('utf8')).toBe(text)
    expect(readZipEntry(zip, 'FileType.txt')!.toString('latin1')).toBe('IPMDAR_SCHEDULE_PERFORMANCE_DATASET/1.0')
    expect(readZipEntry(zip, 'Nope.json')).toBeNull()
  })

  it('is deterministic and handles an empty set', () => {
    expect(zipIpmdarSpd(files).equals(zip)).toBe(true)
    expect(entries(zipIpmdarSpd({}))).toEqual([])
  })
})
