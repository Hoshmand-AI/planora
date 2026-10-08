// Export exception reports: what Planora could not write (or had to change) in a given export format,
// so nothing is dropped silently. Each export carries its report where provenance already goes: the
// XLSX Provenance sheet, an X-Planora-Export-Exceptions response header on every download, and the
// JSON report itself on request (?format=...&exceptions=json).
//
// The report lists (1) what the source file carried that Planora never imported (from the upload's
// import exception report), (2) activities the export model leaves out (WBS summaries, level of
// effort), and (3) what the target format cannot hold or holds differently.

import type { GeneratedSchedule, PlanActivity, ProgressMode, WorkCalendar } from '@/lib/planning/types'
import { ExceptionCollector, type ExceptionReport } from '@/lib/parsers/exceptions'
import { xerText, P6_NAME_MAX } from './xer'

export type ExportExceptionFormat = 'xer' | 'xer-original' | 'xml' | 'csv' | 'xlsx-import' | 'xlsx-p6'

export interface ExportExceptionContext {
  /** The upload's import exception report (null for Planora-built plans and older uploads) */
  importReport?: ExceptionReport | null
  /** Activities of the upload that the export model leaves out */
  excluded?: { code: string; type: 'summary' | 'loe' }[]
  progressMode?: ProgressMode | null
}

const FORMAT_LABEL: Record<ExportExceptionFormat, string> = {
  xer: 'P6 XER', 'xer-original': 'P6 XER', xml: 'MS Project XML', csv: 'CSV', 'xlsx-import': 'Excel import workbook', 'xlsx-p6': 'Excel P6 layout',
}

/** The working periods the P6 XER export writes for a calendar (see clndrData in ./xer). */
function xerWorkTimes(c: WorkCalendar): string {
  const h = c.hoursPerDay
  const hhmm = (x: number) => `${String(Math.floor(x)).padStart(2, '0')}:${String(Math.round((x - Math.floor(x)) * 60)).padStart(2, '0')}`
  return h > 6 ? `08:00-12:00,13:00-${hhmm(9 + h)}` : `08:00-${hhmm(8 + h)}`
}

const isPlanoraRationale = (a: PlanActivity) => !!a.rationale?.summary && !a.rationale.summary.startsWith('From the uploaded file')

export function exportExceptions(s: GeneratedSchedule, format: ExportExceptionFormat, ctx: ExportExceptionContext = {}): ExceptionReport {
  const ex = new ExceptionCollector('export', format)
  const label = FORMAT_LABEL[format]
  // The P6 export of an uploaded P6 file re-emits the original file row for row: everything the file
  // carried is written back, including what Planora does not model.
  if (format === 'xer-original') return ex.report()

  /* 1. What the source file carried that Planora never imported */
  for (const r of ctx.importReport?.records || []) {
    if (r.disposition !== 'dropped' && r.disposition !== 'preserved_in_raw') continue
    ex.add({
      severity: r.severity, entity: r.entity, field: r.field, disposition: 'dropped', count: r.count, examples: r.examples,
      message: `Not imported into Planora, so not in this ${label} export${r.disposition === 'preserved_in_raw' ? ' (it is in the original file and in the upload\'s P6 .xer export)' : ' (the original file is kept with the upload)'}: ${r.message}`,
    })
  }

  /* 2. Activities the export model leaves out */
  const summaries = (ctx.excluded || []).filter(x => x.type === 'summary')
  if (summaries.length) ex.add({ severity: 'warning', entity: 'activity', field: 'WBS summary activities', disposition: 'dropped', count: summaries.length, examples: summaries.map(x => x.code), message: 'WBS summary activities are not written; the WBS hierarchy is rebuilt from the activities\' WBS' })
  const loe = (ctx.excluded || []).filter(x => x.type === 'loe')
  if (loe.length && format !== 'xml') ex.add({ severity: 'loss', entity: 'activity', field: 'Level of effort activities', disposition: 'dropped', count: loe.length, examples: loe.map(x => x.code), message: `Level of effort activities (and their links) are not written to the ${label} export; the MS Project XML export keeps them` })

  /* 3. What the format cannot hold */
  const acts = s.activities
  const withConstraint = acts.filter(a => a.constraint)
  const started = acts.filter(a => a.actualStart || a.actualFinish || (a.status && a.status !== 'not_started'))
  const withBaseline = acts.filter(a => a.baselineStart || a.baselineFinish)
  const calById = new Map(s.calendars.map(c => [c.id, c]))
  const nonDefaultCal = acts.filter(a => a.calendarId && a.calendarId !== s.defaultCalendarId)
  const planoraRationale = acts.filter(isPlanoraRationale)
  const lossOfCalendars = () => {
    if (s.calendars.length) ex.add({ severity: 'loss', entity: 'calendar', field: 'Calendars', disposition: 'dropped', count: s.calendars.length, examples: s.calendars.map(c => c.name), message: `Calendar definitions (work week, hours per day, holidays) are not written to the ${label} export; durations are work days of each activity's calendar` })
  }
  const lossOfProject = () => {
    if (s.mustFinishBy) ex.add({ severity: 'loss', entity: 'project', field: 'Must Finish By', disposition: 'dropped', example: s.mustFinishBy, message: 'The required finish (Must Finish By) is not written; float in the export is not measured against it' })
    if (s.dataDate) ex.add({ severity: 'warning', entity: 'project', field: 'Data date', disposition: 'dropped', example: s.dataDate, message: 'The data date is not written' })
  }
  const assumptions = () => {
    if (s.assumptions.length) ex.add({ severity: 'info', entity: 'other', field: 'Assumptions', disposition: 'dropped', count: s.assumptions.length, message: 'Assumptions are in the Basis of Schedule narrative, not in this format' })
  }

  switch (format) {
    case 'xer': {
      const extra = s.calendars.filter(c => c.extraWorkDays?.length)
      if (extra.length) ex.add({ severity: 'loss', entity: 'calendar', field: 'CALENDAR.clndr_data (extra work days)', disposition: 'dropped', count: extra.reduce((n, c) => n + (c.extraWorkDays?.length ?? 0), 0), examples: extra.map(c => `${c.name}: ${c.extraWorkDays!.slice(0, 3).join(', ')}`), message: 'Work days added on a non-work weekday (calendar exceptions that add work) are not written; only holidays are' })
      const times = s.calendars.filter(c => c.workTimes?.length && c.workTimes.map(w => `${w.from}-${w.to}`).join(',') !== xerWorkTimes(c))
      if (times.length) ex.add({ severity: 'info', entity: 'calendar', field: 'CALENDAR.clndr_data (work times)', disposition: 'converted', count: times.length, examples: times.map(c => c.name), message: 'Work times of day are written as 08:00 starts with a 12:00–13:00 lunch; hours per day are kept' })
      const renamed = acts.filter(a => xerText(a.name) !== a.name)
      if (renamed.length) ex.add({ severity: 'info', entity: 'activity', field: 'TASK.task_name (characters)', disposition: 'converted', count: renamed.length, examples: renamed.map(a => a.code), message: 'Characters P6 cannot store in an XER (outside Windows-1252) were replaced' })
      const long = acts.filter(a => xerText(a.name).length > P6_NAME_MAX)
      if (long.length) ex.add({ severity: 'warning', entity: 'activity', field: 'TASK.task_name (length)', disposition: 'converted', count: long.length, examples: long.map(a => a.code), message: `Names longer than P6's ${P6_NAME_MAX} characters were shortened` })
      if (planoraRationale.length) ex.add({ severity: 'info', entity: 'activity', field: 'Rationale', disposition: 'dropped', count: planoraRationale.length, examples: planoraRationale.map(a => a.code), message: 'Why each activity exists (rationale and sources) is not written; overrides with reasons go into the notebook' })
      assumptions()
      break
    }
    case 'xml': {
      const two = withConstraint.filter(a => a.constraint!.type === 'SO' || a.constraint!.type === 'FO')
      if (two.length) ex.add({ severity: 'warning', entity: 'constraint', field: 'ConstraintType (Start On / Finish On)', disposition: 'converted', count: two.length, examples: two.map(a => `${a.code} (${a.constraint!.type})`), message: 'MS Project has no Start On / Finish On; written as Must Start On / Must Finish On, which overrule logic' })
      const loeIn = acts.filter(a => a.levelOfEffort)
      if (loeIn.length) ex.add({ severity: 'warning', entity: 'activity', field: 'Level of effort', disposition: 'converted', count: loeIn.length, examples: loeIn.map(a => a.code), message: 'MS Project has no level-of-effort type; written as tasks spanning their linked work, marked "Level of Effort" in Text2' })
      const hpd = (id?: string) => (calById.get(id || s.defaultCalendarId) ?? calById.get(s.defaultCalendarId))?.hoursPerDay ?? 8
      const byId = new Map(acts.map(a => [a.id, a]))
      const lagOnOtherCal = s.links.filter(l => l.lag !== 0 && hpd(byId.get(l.from)?.calendarId) !== hpd(byId.get(l.to)?.calendarId))
      if (lagOnOtherCal.length) ex.add({ severity: 'warning', entity: 'relationship', field: 'PredecessorLink.LinkLag', disposition: 'converted', count: lagOnOtherCal.length, examples: lagOnOtherCal.map(l => `${byId.get(l.from)?.code} -> ${byId.get(l.to)?.code}`), message: 'MS Project schedules lag on the successor\'s calendar; Planora (like P6) uses the predecessor\'s. Lags between calendars with different hours per day may schedule differently' })
      if (s.mustFinishBy) ex.add({ severity: 'info', entity: 'project', field: 'Must Finish By', disposition: 'converted', example: s.mustFinishBy, message: 'The required finish is written as a Deadline on the project\'s finish task' })
      if (ctx.progressMode) ex.add({ severity: 'info', entity: 'project', field: 'Out-of-sequence progress', disposition: 'dropped', example: ctx.progressMode === 'override' ? 'Progress override' : 'Retained logic', message: 'MS Project has no retained-logic / progress-override setting' })
      assumptions()
      break
    }
    case 'csv': {
      lossOfCalendars()
      if (nonDefaultCal.length) ex.add({ severity: 'loss', entity: 'calendar', field: 'Activity calendar', disposition: 'dropped', count: nonDefaultCal.length, examples: nonDefaultCal.map(a => a.code), message: 'Which calendar an activity uses is not written' })
      if (withConstraint.length) ex.add({ severity: 'loss', entity: 'constraint', field: 'Constraints', disposition: 'dropped', count: withConstraint.length, examples: withConstraint.map(a => `${a.code} (${a.constraint!.type} ${a.constraint!.date})`), message: 'Date constraints are not written' })
      const kinds = acts.filter(a => a.type === 'milestone' && a.milestoneKind)
      if (kinds.length) ex.add({ severity: 'info', entity: 'activity', field: 'Milestone type', disposition: 'converted', count: kinds.length, examples: kinds.map(a => a.code), message: 'Start vs finish milestones are not distinguished (both are zero-duration rows)' })
      lossOfProject()
      break
    }
    case 'xlsx-import': {
      lossOfCalendars()
      if (started.length) ex.add({ severity: 'loss', entity: 'activity', field: 'Progress (actual dates, % complete, remaining)', disposition: 'dropped', count: started.length, examples: started.map(a => a.code), message: 'Progress is not written; the import sheets describe the network to schedule' })
      if (withBaseline.length) ex.add({ severity: 'warning', entity: 'baseline', field: 'Baseline dates', disposition: 'dropped', count: withBaseline.length, examples: withBaseline.map(a => a.code), message: 'Baseline (target) dates are not written' })
      lossOfProject()
      break
    }
    case 'xlsx-p6': {
      lossOfCalendars()
      if (s.links.length) ex.add({ severity: 'loss', entity: 'relationship', field: 'Relationships', disposition: 'dropped', count: s.links.length, message: 'The P6 layout is a presentation of dates and float; it carries no logic (use the .xer or import workbook)' })
      if (withConstraint.length) ex.add({ severity: 'loss', entity: 'constraint', field: 'Constraints', disposition: 'dropped', count: withConstraint.length, examples: withConstraint.map(a => a.code), message: 'Date constraints are not written' })
      if (withBaseline.length) ex.add({ severity: 'warning', entity: 'baseline', field: 'Baseline dates', disposition: 'dropped', count: withBaseline.length, examples: withBaseline.map(a => a.code), message: 'Baseline (target) dates are not written' })
      if (started.length) ex.add({ severity: 'warning', entity: 'activity', field: 'Progress (% complete, remaining)', disposition: 'dropped', count: started.length, examples: started.map(a => a.code), message: 'Percent complete and remaining duration are not written' })
      lossOfProject()
      break
    }
  }
  return ex.report()
}
