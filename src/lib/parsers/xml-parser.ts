// Microsoft Project XML Parser (MSPDI, xmlns http://schemas.microsoft.com/project)

import type { Activity, Relationship } from '@/lib/db'
import type { ConstraintType, Weekday, WorkCalendar } from '@/lib/planning/types'
import { randomUUID as uuid } from 'crypto'
import { ParsedSchedule, makeActivity, isoDatePrefix, addDaysIso, round2 } from './types'
import { ExceptionCollector, wasRounded, type ExceptionEntity, type ExceptionSeverity } from './exceptions'

/** Field id of Text1, which exportMspXml (and many P6→MSP exports) use for the activity code. */
export const MSP_TEXT1_FIELD_ID = '188743731'

const MSP_CONSTRAINTS: Record<string, ConstraintType | 'ALAP' | null> = {
  '0': null, '1': 'ALAP', '2': 'MSO', '3': 'MFO', '4': 'SNET', '5': 'SNLT', '6': 'FNET', '7': 'FNLT',
}
const MSP_LINK_TYPES: Record<string, Relationship['type']> = { '0': 'FF', '1': 'FS', '2': 'SF', '3': 'SS' }

/* ─── tiny XML helpers (no dependency) ─────────────────── */

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** All inner contents of <tag>…</tag> (exact tag name, non-greedy; tags we use are not self-nesting). */
function allBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g')
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) out.push(m[1])
  return out
}

function firstBlock(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`))
  return m ? m[1] : null
}

/** Remove nested child blocks so that tag lookups only see an element's own fields. */
function stripBlocks(xml: string, tags: string[]): string {
  let out = xml
  for (const t of tags) out = out.replace(new RegExp(`<${t}(?:\\s[^>]*)?>[\\s\\S]*?</${t}>`, 'g'), '')
  return out
}

function tagText(xml: string, tag: string): string {
  const b = firstBlock(xml, tag)
  return b === null ? '' : decodeXml(b.trim())
}

/* ─── durations ─────────────────────────────────────────── */

/** MSPDI duration "PT8H30M0S" / "P2DT4H0M0S" / "-PT8H0M0S" → hours (a "D" component counts as one work day). */
export function mspDurationHours(dur: string, hoursPerDay: number): number {
  if (!dur) return 0
  const m = dur.trim().match(/^(-)?P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/)
  if (!m) {
    const n = parseFloat(dur)
    return isNaN(n) ? 0 : n * hoursPerDay
  }
  const [, neg, , , d, h, mi, s] = m
  const hours = (d ? +d * hoursPerDay : 0) + (h ? +h : 0) + (mi ? +mi / 60 : 0) + (s ? +s / 3600 : 0)
  return neg ? -hours : hours
}

/* ─── calendars ─────────────────────────────────────────── */

interface RawCal { uid: string; name: string; base: string; isBase: boolean; block: string }

function timeToMin(t: string): number | null {
  const m = t.match(/(\d{1,2}):(\d{2})/)
  return m ? +m[1] * 60 + +m[2] : null
}

function workingTimeHours(block: string): number {
  let mins = 0
  for (const wt of allBlocks(block, 'WorkingTime')) {
    const f = timeToMin(tagText(wt, 'FromTime'))
    let t = timeToMin(tagText(wt, 'ToTime'))
    if (f === null || t === null) continue
    if (t <= f) t += 24 * 60
    mins += t - f
  }
  return mins / 60
}

/** A day's WorkingTime periods as HH:MM pairs in time order (ToTime 00:00 = midnight, written 24:00). */
function workingPeriods(block: string): { from: string; to: string }[] {
  const out: [number, number][] = []
  for (const wt of allBlocks(block, 'WorkingTime')) {
    const f = timeToMin(tagText(wt, 'FromTime'))
    let t = timeToMin(tagText(wt, 'ToTime'))
    if (f === null || t === null) continue
    if (t <= f) t += 24 * 60
    out.push([f, Math.min(t, 24 * 60)])
  }
  const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  return out.sort((x, y) => x[0] - y[0]).map(([f, t]) => ({ from: hm(f), to: hm(t) }))
}

function expandRange(from: string | null, to: string | null, max = 366): string[] | null {
  if (!from) return []
  const end = to || from
  const out: string[] = []
  let d = from
  while (d <= end) {
    out.push(d)
    if (out.length > max) return null
    d = addDaysIso(d, 1)
  }
  return out
}

function buildCalendars(xml: string, warnings: string[], ex: ExceptionCollector): { calendars: Map<string, WorkCalendar>; baseIds: Set<string> } {
  const calsBlock = firstBlock(xml, 'Calendars') || ''
  const raws: RawCal[] = allBlocks(calsBlock, 'Calendar').map(block => {
    const own = stripBlocks(block, ['WeekDays', 'Exceptions', 'WorkWeeks'])
    return {
      uid: tagText(own, 'UID'),
      name: tagText(own, 'Name'),
      base: tagText(own, 'BaseCalendarUID'),
      isBase: tagText(own, 'IsBaseCalendar') !== '0',
      block,
    }
  })
  const rawById = new Map(raws.map(r => [r.uid, r]))
  const result = new Map<string, WorkCalendar>()

  const resolve = (r: RawCal, depth = 0): WorkCalendar => {
    const done = result.get(r.uid)
    if (done) return done
    const baseRaw = r.base && r.base !== '-1' ? rawById.get(r.base) : undefined
    const base = baseRaw && depth < 10 ? resolve(baseRaw, depth + 1) : undefined
    const dayWorking = new Map<number, boolean>()
    const dayHours: number[] = []
    let workTimes = base?.workTimes
    let workTimesHours = 0
    const holidays = new Set<string>(base?.holidays || [])
    const extra = new Set<string>(base?.extraWorkDays || [])

    const addException = (fromS: string, toS: string, working: boolean, label: string) => {
      const days = expandRange(isoDatePrefix(fromS), isoDatePrefix(toS))
      if (days === null) {
        warnings.push(`Calendar "${r.name}": exception "${label}" spans more than a year (recurring?); skipped`)
        ex.add({ severity: 'loss', entity: 'calendar', field: 'Calendar.Exception', disposition: 'dropped', example: `${r.name}: ${label}`, message: 'Calendar exception spanning more than a year was skipped' })
        return
      }
      for (const d of days) {
        if (working) { extra.add(d); holidays.delete(d) } else { holidays.add(d); extra.delete(d) }
      }
    }

    const weekDays = firstBlock(r.block, 'WeekDays') || ''
    for (const wd of allBlocks(weekDays, 'WeekDay')) {
      const type = tagText(wd, 'DayType')
      const working = tagText(wd, 'DayWorking') === '1'
      if (type === '0') {
        // MSP 2003-style exception inside WeekDays
        const tp = firstBlock(wd, 'TimePeriod') || ''
        addException(tagText(tp, 'FromDate'), tagText(tp, 'ToDate'), working, 'exception')
        continue
      }
      const n = parseInt(type, 10)
      if (!(n >= 1 && n <= 7)) continue
      dayWorking.set(n - 1, working)
      if (working) {
        const h = workingTimeHours(wd)
        dayHours.push(h > 0 ? h : 8)
        if (h > workTimesHours) { workTimesHours = h; workTimes = workingPeriods(wd) }
      }
    }
    for (const exc of allBlocks(firstBlock(r.block, 'Exceptions') || '', 'Exception')) {
      const tp = firstBlock(exc, 'TimePeriod') || ''
      const own = stripBlocks(exc, ['TimePeriod', 'WorkingTimes'])
      const type = tagText(own, 'Type')
      if (type && type !== '1') {
        warnings.push(`Calendar "${r.name}": recurring exception "${tagText(own, 'Name')}" (type ${type}) not expanded`)
        ex.add({ severity: 'loss', entity: 'calendar', field: 'Calendar.Exception.Type', disposition: 'dropped', example: `${r.name}: ${tagText(own, 'Name')}`, message: 'Recurring calendar exceptions are not expanded; their non-work days are missing' })
        continue
      }
      addException(tagText(tp, 'FromDate'), tagText(tp, 'ToDate'), tagText(own, 'DayWorking') === '1', tagText(own, 'Name'))
    }

    const workDays: Weekday[] = []
    for (let d = 0 as Weekday; d <= 6; d = (d + 1) as Weekday) {
      const explicit = dayWorking.get(d)
      const w = explicit !== undefined ? explicit : base ? base.workDays.includes(d) : d >= 1 && d <= 5
      if (w) workDays.push(d)
    }
    const hoursPerDay = dayHours.length ? round2(Math.max(...dayHours)) : base?.hoursPerDay ?? 8
    // keep only exceptions that actually change the week pattern
    const hol = Array.from(holidays).filter(d => workDays.includes(new Date(d + 'T00:00:00Z').getUTCDay() as Weekday)).sort()
    const ext = Array.from(extra).filter(d => !workDays.includes(new Date(d + 'T00:00:00Z').getUTCDay() as Weekday)).sort()
    const cal: WorkCalendar = {
      id: r.uid,
      name: r.name || `Calendar ${r.uid}`,
      workDays,
      hoursPerDay,
      holidays: hol,
      ...(ext.length ? { extraWorkDays: ext } : {}),
      ...(workTimes?.length ? { workTimes } : {}),
      sourceName: r.name || undefined,
    }
    result.set(r.uid, cal)
    return cal
  }
  for (const r of raws) resolve(r)
  for (const r of raws) if (r.base && r.base !== '-1' && !rawById.has(r.base)) ex.add({ severity: 'warning', entity: 'calendar', field: 'Calendar.BaseCalendarUID', disposition: 'defaulted', example: r.name || r.uid, message: 'Base calendar not in the file; days the calendar does not define default to Monday–Friday' })
  return { calendars: result, baseIds: new Set(raws.filter(r => r.isBase).map(r => r.uid)) }
}

/* ─── main ──────────────────────────────────────────────── */

/** Task fields the importer reads (anything else carrying data is listed in the exception report). */
const MSP_TASK_READ = new Set(['UID', 'ID', 'Name', 'OutlineLevel', 'IsNull', 'Summary', 'WBS', 'OutlineNumber', 'CalendarUID', 'Duration', 'RemainingDuration', 'PercentComplete',
  'ActualStart', 'ActualFinish', 'TotalSlack', 'FreeSlack', 'Critical', 'ConstraintType', 'ConstraintDate', 'Milestone', 'Start', 'Finish', 'EarlyStart', 'EarlyFinish',
  'LateStart', 'LateFinish', 'Deadline',
  // derived by MS Project from the fields above, or bookkeeping without schedule meaning
  'GUID', 'CreateDate', 'Type', 'DurationFormat', 'ActualDuration', 'Estimated', 'Active', 'Manual', 'ManualStart', 'ManualFinish', 'ManualDuration', 'StartText', 'FinishText',
  'PercentWorkComplete', 'PhysicalPercentComplete', 'StartSlack', 'FinishSlack', 'IgnoreResourceCalendar', 'CalendarName'])
const MSP_EMPTYISH = /^(|0|0\.0+|-1|PT0H0M0S|false)$/i
const MSP_COLLECTIONS: [string, string, ExceptionEntity, ExceptionSeverity, string][] = [
  ['Resources', 'Resource', 'resource', 'warning', 'Resources are not modeled'],
  ['Assignments', 'Assignment', 'assignment', 'warning', 'Resource assignments are not modeled'],
  ['OutlineCodes', 'OutlineCode', 'code', 'warning', 'Outline code definitions are not modeled'],
  ['WBSMasks', 'WBSMask', 'other', 'info', 'WBS code masks are not modeled'],
  ['Views', 'View', 'other', 'info', 'Views are not imported'],
  ['Filters', 'Filter', 'other', 'info', 'Filters are not imported'],
  ['Groups', 'Group', 'other', 'info', 'Groups are not imported'],
  ['Tables', 'Table', 'other', 'info', 'Tables are not imported'],
  ['Maps', 'Map', 'other', 'info', 'Import/export maps are not imported'],
  ['Reports', 'Report', 'other', 'info', 'Reports are not imported'],
]

export function parseMSProjectXML(content: string, scheduleId: string): ParsedSchedule {
  const warnings: string[] = []
  const ex = new ExceptionCollector('import', 'ms_xml')
  const xml = content.replace(/^﻿/, '')

  // Project-level fields only (exclude nested collections that also contain <Name>, <Start>, …)
  const header = stripBlocks(xml, ['Calendars', 'Tasks', 'Resources', 'Assignments', 'ExtendedAttributes', 'OutlineCodes', 'WBSMasks', 'Views', 'Filters', 'Groups', 'Tables', 'Maps', 'Reports'])
  const title = tagText(header, 'Title')
  const fileName = tagText(header, 'Name').replace(/\.(xml|mpp)$/i, '')
  const projectStart = isoDatePrefix(tagText(header, 'StartDate'))
  const projectFinish = isoDatePrefix(tagText(header, 'FinishDate'))
  const dataDate = isoDatePrefix(tagText(header, 'StatusDate')) || isoDatePrefix(tagText(header, 'CurrentDate'))
  const minutesPerDay = parseFloat(tagText(header, 'MinutesPerDay'))
  const projectCalUid = tagText(header, 'CalendarUID')

  // Is Text1 used as an activity code?
  const extAttrs = allBlocks(firstBlock(xml, 'ExtendedAttributes') || '', 'ExtendedAttribute')
  const codeFieldIds = new Set<string>()
  const typeFieldIds = new Set<string>()
  for (const ea of extAttrs) {
    const fid = tagText(ea, 'FieldID')
    const alias = tagText(ea, 'Alias')
    if (/\b(activity\s*type|task\s*type)\b/i.test(alias)) typeFieldIds.add(fid)
    else if (/\b(activity\s*id|activity\s*code|task\s*code|code)\b/i.test(alias)) codeFieldIds.add(fid)
  }
  const fieldLabel = new Map(extAttrs.map(ea => [tagText(ea, 'FieldID'), tagText(ea, 'Alias') || tagText(ea, 'FieldName') || tagText(ea, 'FieldID')]))
  // Project-level collections Planora does not model.
  for (const [coll, item, entity, severity, message] of MSP_COLLECTIONS) {
    const items = allBlocks(firstBlock(xml, coll) || '', item)
      .filter(b => !(item === 'Resource' && tagText(b, 'UID') === '0') && !(item === 'Assignment' && tagText(b, 'ResourceUID') === '-1'))
    if (items.length) ex.add({ severity, entity, field: coll, disposition: 'dropped', count: items.length, examples: items.map(b => tagText(b, 'Name') || tagText(b, 'Alias') || tagText(b, 'UID')), message })
  }
  const unusedAttrs = extAttrs.filter(ea => !codeFieldIds.has(tagText(ea, 'FieldID')) && !typeFieldIds.has(tagText(ea, 'FieldID')))
  if (unusedAttrs.length) ex.add({ severity: 'warning', entity: 'udf', field: 'ExtendedAttributes', disposition: 'dropped', count: unusedAttrs.length, examples: unusedAttrs.map(ea => tagText(ea, 'Alias') || tagText(ea, 'FieldName') || tagText(ea, 'FieldID')), message: 'Custom field definitions (other than the activity ID and activity type fields) are not modeled' })

  const { calendars: calMap, baseIds } = buildCalendars(xml, warnings, ex)
  const defaultCalendarId = projectCalUid && calMap.has(projectCalUid) ? projectCalUid : calMap.size ? Array.from(calMap.keys())[0] : null
  const defaultHpd = minutesPerDay > 0 ? minutesPerDay / 60 : (defaultCalendarId ? calMap.get(defaultCalendarId)!.hoursPerDay : 8)

  const tasksBlock = firstBlock(xml, 'Tasks') || ''
  const taskBlocks = allBlocks(tasksBlock, 'Task')
  const activities: Activity[] = []
  const byUid = new Map<string, Activity>()
  const hpdByUid = new Map<string, number>()
  let projectSummaryName = ''
  const outlineStack: string[] = []
  const pendingLinks: { succUid: string; block: string }[] = []
  const deadlines: { a: Activity; date: string }[] = []

  for (const block of taskBlocks) {
    const own = stripBlocks(block, ['PredecessorLink', 'ExtendedAttribute', 'Baseline', 'TimephasedData'])
    const uid = tagText(own, 'UID')
    const name = tagText(own, 'Name')
    const outlineLevel = tagText(own, 'OutlineLevel')
    if (tagText(own, 'IsNull') === '1') { ex.add({ severity: 'info', entity: 'activity', field: 'Task.IsNull', disposition: 'dropped', example: `UID ${uid}`, message: 'Blank (null) task rows are skipped' }); continue }
    if (uid === '0' || outlineLevel === '0') { projectSummaryName = name; continue } // project summary task
    if (!name) { ex.add({ severity: 'loss', entity: 'activity', field: 'Task.Name', disposition: 'dropped', example: `UID ${uid}`, message: 'Task without a name was skipped' }); continue }

    const isSummary = tagText(own, 'Summary') === '1'
    // Outline: a work task belongs to the nearest summary above it; its WBS is that summary's path
    // ("1.2 Foundations", like the P6 parser's WBS path) so the hierarchy can be rebuilt on export.
    const level = parseInt(outlineLevel, 10)
    const ownWbs = tagText(own, 'WBS') || tagText(own, 'OutlineNumber')
    let parentWbs = ''
    if (level > 0) {
      outlineStack.length = Math.min(outlineStack.length, level - 1)
      for (let k = outlineStack.length - 1; k >= 0 && !parentWbs; k--) parentWbs = outlineStack[k] || ''
      if (isSummary) {
        while (outlineStack.length < level - 1) outlineStack.push('')
        outlineStack.push(ownWbs ? `${ownWbs} ${name}` : '')
      }
    }
    const calUidRaw = tagText(own, 'CalendarUID')
    const hasOwnCal = !!calUidRaw && calUidRaw !== '-1' && calMap.has(calUidRaw)
    if (calUidRaw && calUidRaw !== '-1' && !calMap.has(calUidRaw)) {
      warnings.push(`Task "${name}": calendar UID ${calUidRaw} not found; using project calendar`)
      ex.add({ severity: 'warning', entity: 'calendar', field: 'Task.CalendarUID', disposition: 'defaulted', example: name, message: 'Task calendar not in the file; the project calendar was used' })
    }
    const calendarId = hasOwnCal ? calUidRaw : defaultCalendarId
    const hpd = hasOwnCal ? calMap.get(calUidRaw)!.hoursPerDay : defaultHpd
    const days = (d: string, field?: string) => {
      const exact = mspDurationHours(d, hpd) / hpd
      const r = round2(exact)
      if (field && wasRounded(exact, r)) ex.add({ severity: 'info', entity: 'activity', field, disposition: 'converted', example: name, message: 'Duration converted to work days and rounded to 0.01 day' })
      return r
    }
    // Slack values are integers in tenths of minutes
    const slack = (v: string) => (v === '' ? null : round2(parseFloat(v) / (600 * hpd)))

    const duration = days(tagText(own, 'Duration'), 'Task.Duration')
    const remTxt = tagText(own, 'RemainingDuration')
    const pct = parseFloat(tagText(own, 'PercentComplete') || '0') || 0
    const actualStart = isoDatePrefix(tagText(own, 'ActualStart'))
    const actualFinish = isoDatePrefix(tagText(own, 'ActualFinish'))
    let status: Activity['status'] = 'not_started'
    if (pct >= 100 || actualFinish) status = 'complete'
    else if (pct > 0 || actualStart) status = 'in_progress'

    const tf = slack(tagText(own, 'TotalSlack'))
    const ff = slack(tagText(own, 'FreeSlack'))
    const critTxt = tagText(own, 'Critical')
    const isCritical = critTxt !== '' ? critTxt === '1' : tf !== null && tf <= 0 && status !== 'complete'

    let constraintType: ConstraintType | null = null
    let constraintDate: string | null = null
    const cCode = tagText(own, 'ConstraintType')
    const mapped = MSP_CONSTRAINTS[cCode]
    if (mapped === 'ALAP') {
      warnings.push(`Task "${name}": As Late As Possible constraint is not modeled; ignored`)
      ex.add({ severity: 'loss', entity: 'constraint', field: 'Task.ConstraintType=1 (ALAP)', disposition: 'dropped', example: name, message: 'As Late As Possible is not modeled; the task is scheduled as soon as possible' })
    } else if (mapped) {
      constraintDate = isoDatePrefix(tagText(own, 'ConstraintDate'))
      if (constraintDate) constraintType = mapped
      else {
        warnings.push(`Task "${name}": constraint ${mapped} has no ConstraintDate; ignored`)
        ex.add({ severity: 'loss', entity: 'constraint', field: 'Task.ConstraintDate', disposition: 'dropped', example: name, message: 'Constraint without a date was ignored' })
      }
    } else if (cCode && !(cCode in MSP_CONSTRAINTS)) {
      ex.add({ severity: 'loss', entity: 'constraint', field: 'Task.ConstraintType', disposition: 'dropped', example: `${name} (${cCode})`, message: 'Unrecognized constraint type was ignored' })
    }

    let code = ''
    let loe = false
    for (const ea of allBlocks(block, 'ExtendedAttribute')) {
      const fid = tagText(ea, 'FieldID')
      if (!codeFieldIds.has(fid) && !typeFieldIds.has(fid) && tagText(ea, 'Value') !== '') ex.add({ severity: 'warning', entity: 'udf', field: `Task.ExtendedAttribute[${fieldLabel.get(fid) || fid}]`, disposition: 'dropped', example: name, message: 'Custom field value not modeled' })
      if (!code && codeFieldIds.has(fid)) code = tagText(ea, 'Value')
      // A P6 level-of-effort activity exported to MS Project (which has no LOE type) is named in an "Activity Type" text field.
      if (typeFieldIds.has(fid) && /^\s*(level\s*of\s*effort|loe)\s*$/i.test(tagText(ea, 'Value'))) loe = true
    }
    const idTxt = tagText(own, 'ID') || uid

    let baselineStart: string | null = null
    let baselineFinish: string | null = null
    for (const bl of allBlocks(block, 'Baseline')) {
      const num = tagText(bl, 'Number')
      if (num === '0') {
        baselineStart = isoDatePrefix(tagText(bl, 'Start'))
        baselineFinish = isoDatePrefix(tagText(bl, 'Finish'))
      } else ex.add({ severity: 'warning', entity: 'baseline', field: `Task.Baseline[${num || '?'}]`, disposition: 'dropped', example: name, message: 'Only Baseline (0) is imported; other saved baselines are not' })
    }
    const timephased = allBlocks(block, 'TimephasedData').length
    if (timephased) ex.add({ severity: 'info', entity: 'other', field: 'Task.TimephasedData', disposition: 'dropped', count: timephased, example: name, message: 'Timephased data is not imported' })
    for (const oc of allBlocks(block, 'OutlineCode')) if (tagText(oc, 'ValueID') || tagText(oc, 'Value')) ex.add({ severity: 'warning', entity: 'code', field: 'Task.OutlineCode', disposition: 'dropped', example: name, message: 'Outline code values are not modeled' })
    // Simple fields Planora does not read that carry data.
    const simple = /<([A-Za-z][\w]*)>([^<]*)<\/\1>/g
    let fm: RegExpExecArray | null
    const ownFlat = stripBlocks(own, ['OutlineCode', 'TimephasedData'])
    while ((fm = simple.exec(ownFlat)) !== null) {
      if (MSP_TASK_READ.has(fm[1]) || MSP_EMPTYISH.test(fm[2].trim())) continue
      const entity: ExceptionEntity = /Work|Cost|Overtime|BCWS|BCWP|ACWP|CV|SV|VAC|EAC|Fixed/.test(fm[1]) ? 'assignment' : fm[1] === 'Notes' || fm[1] === 'Hyperlink' || fm[1] === 'HyperlinkAddress' ? 'other' : 'activity'
      ex.add({ severity: 'info', entity, field: `Task.${fm[1]}`, disposition: 'dropped', example: name, message: 'Field not mapped by Planora; the original file is kept with the upload' })
    }

    const isMilestone = tagText(own, 'Milestone') === '1'
    // Start vs finish milestone (P6 TT_Mile / TT_FinMile) from its time of day: at or before the
    // calendar's first working time = start milestone, at or after its last = finish milestone.
    let milestoneKind: Activity['milestoneKind'] = null
    if (isMilestone) {
      const t = timeToMin((tagText(own, 'Start').split('T')[1] || ''))
      const wt = (calendarId ? calMap.get(calendarId)?.workTimes : undefined) || [{ from: '08:00', to: '17:00' }]
      const dayStart = timeToMin(wt[0].from) ?? 480, dayEnd = timeToMin(wt[wt.length - 1].to) ?? 1020
      if (t !== null) milestoneKind = t <= dayStart ? 'start' : t >= dayEnd ? 'finish' : null
    }
    // MS Project Deadline: a target finish. Kept as the activity's finish constraint (or the project's
    // required finish on an end activity) once the links are known.
    const deadline = isoDatePrefix(tagText(own, 'Deadline'))
    const a = makeActivity(scheduleId, {
      activityId: code || `A${idTxt}`,
      name,
      wbs: isSummary ? ownWbs : parentWbs || ownWbs,
      duration,
      remainingDuration: remTxt ? days(remTxt, 'Task.RemainingDuration') : status === 'complete' ? 0 : duration,
      percentComplete: pct,
      earlyStart: isoDatePrefix(tagText(own, 'EarlyStart')) || isoDatePrefix(tagText(own, 'Start')),
      earlyFinish: isoDatePrefix(tagText(own, 'EarlyFinish')) || isoDatePrefix(tagText(own, 'Finish')),
      lateStart: isoDatePrefix(tagText(own, 'LateStart')),
      lateFinish: isoDatePrefix(tagText(own, 'LateFinish')),
      actualStart,
      actualFinish,
      baselineStart,
      baselineFinish,
      totalFloat: tf ?? 0,
      freeFloat: ff ?? 0,
      isCritical: isSummary || loe ? false : isCritical,
      status,
      activityType: isSummary ? 'summary' : isMilestone ? 'milestone' : loe ? 'loe' : 'task',
      milestoneKind,
      calendarId,
      constraintType,
      constraintDate: constraintType ? constraintDate : null,
      sourceId: uid,
    })
    activities.push(a)
    if (deadline && !isSummary) deadlines.push({ a, date: deadline })
    byUid.set(uid, a)
    hpdByUid.set(uid, hpd)
    for (const link of allBlocks(block, 'PredecessorLink')) pendingLinks.push({ succUid: uid, block: link })
  }

  const relationships: Relationship[] = []
  for (const { succUid, block } of pendingLinks) {
    const predUid = tagText(block, 'PredecessorUID')
    const pred = byUid.get(predUid)
    const succ = byUid.get(succUid)
    if (!pred || !succ) {
      warnings.push(`Predecessor UID ${predUid} of task UID ${succUid} not found${tagText(block, 'CrossProject') === '1' ? ' (cross-project link)' : ''}; skipped`)
      ex.add({ severity: 'loss', entity: 'relationship', field: 'PredecessorLink', disposition: 'dropped', example: `UID ${predUid} -> UID ${succUid}`, message: 'Link to a task not in the file (cross-project or summary) was skipped' })
      continue
    }
    if (!(tagText(block, 'Type') in MSP_LINK_TYPES) && tagText(block, 'Type') !== '') ex.add({ severity: 'warning', entity: 'relationship', field: 'PredecessorLink.Type', disposition: 'converted', example: `${pred.activityId} -> ${succ.activityId}`, message: 'Unknown link type read as finish-to-start' })
    const type = MSP_LINK_TYPES[tagText(block, 'Type')] ?? 'FS'
    const lagRaw = parseFloat(tagText(block, 'LinkLag') || '0') || 0
    const fmt = tagText(block, 'LagFormat')
    let lag: number
    if (fmt === '19' || fmt === '20') {
      // percentage lag: LinkLag is percent × 10 of the predecessor duration
      lag = round2((lagRaw / 1000) * pred.duration)
      ex.add({ severity: 'warning', entity: 'relationship', field: 'PredecessorLink.LagFormat (percent)', disposition: 'converted', example: `${pred.activityId} -> ${succ.activityId}`, message: 'Percentage lag converted to work days of the predecessor duration' })
    } else if (['4', '6', '8', '10', '12', '36', '38', '40', '42', '44'].includes(fmt)) {
      // elapsed units: LinkLag is in tenths of minutes of wall-clock time
      lag = round2(lagRaw / 600 / 24)
      warnings.push(`Link ${pred.activityId} → ${succ.activityId}: elapsed lag converted to ${lag} calendar days`)
      ex.add({ severity: 'warning', entity: 'relationship', field: 'PredecessorLink.LagFormat (elapsed)', disposition: 'converted', example: `${pred.activityId} -> ${succ.activityId}`, message: 'Elapsed lag converted to work days (one per calendar day)' })
    } else {
      const exact = lagRaw / (600 * (hpdByUid.get(succUid) ?? defaultHpd))
      lag = round2(exact)
      if (wasRounded(exact, lag)) ex.add({ severity: 'info', entity: 'relationship', field: 'PredecessorLink.LinkLag', disposition: 'converted', example: `${pred.activityId} -> ${succ.activityId}`, message: 'Lag converted to work days and rounded to 0.01 day' })
    }
    relationships.push({ id: uuid(), scheduleId, predecessorId: pred.id, successorId: succ.id, type, lag })
  }

  // Deadlines: an end activity's (nothing follows it) is the project's required finish (Planora's own
  // export writes the required finish there, as P6 Must Finish By); any other activity's becomes its
  // Finish On or Before constraint unless it already has a constraint, which it keeps.
  const hasSucc = new Set(relationships.map(r => r.predecessorId))
  let mustFinishBy: string | null = null
  for (const { a, date } of deadlines) {
    if (!hasSucc.has(a.id)) {
      if (!mustFinishBy || date > mustFinishBy) mustFinishBy = date
      ex.add({ severity: 'info', entity: 'project', field: 'Task.Deadline', disposition: 'converted', example: a.activityId, message: 'Deadline on an end task read as the project\'s required finish (Must Finish By)' })
    } else if (!a.constraintType) {
      a.constraintType = 'FNLT'; a.constraintDate = date
      ex.add({ severity: 'info', entity: 'constraint', field: 'Task.Deadline', disposition: 'converted', example: a.activityId, message: 'Deadline read as a Finish On or Before constraint' })
    } else ex.add({ severity: 'warning', entity: 'constraint', field: 'Task.Deadline', disposition: 'dropped', example: a.activityId, message: 'Deadline on a task that already has a constraint is not kept (the constraint is)' })
  }

  return {
    projectName: title || projectSummaryName || fileName || 'Imported Schedule',
    mustFinishBy,
    dataDate,
    projectStart,
    projectFinish,
    projectKey: title || projectSummaryName || fileName || null,
    activities,
    relationships,
    // base calendars plus any (resource) calendar a task actually uses
    calendars: Array.from(calMap.values()).filter(c => baseIds.has(c.id) || c.id === defaultCalendarId || activities.some(a => a.calendarId === c.id)),
    defaultCalendarId,
    warnings,
    exceptions: ex.report(),
    sourceType: 'ms_xml',
  }
}
