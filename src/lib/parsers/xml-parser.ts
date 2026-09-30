// Microsoft Project XML Parser (MSPDI, xmlns http://schemas.microsoft.com/project)

import type { Activity, Relationship } from '@/lib/db'
import type { ConstraintType, Weekday, WorkCalendar } from '@/lib/planning/types'
import { v4 as uuid } from 'uuid'
import { ParsedSchedule, makeActivity, isoDatePrefix, addDaysIso, round2 } from './types'

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

function buildCalendars(xml: string, warnings: string[]): { calendars: Map<string, WorkCalendar>; baseIds: Set<string> } {
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
    const holidays = new Set<string>(base?.holidays || [])
    const extra = new Set<string>(base?.extraWorkDays || [])

    const addException = (fromS: string, toS: string, working: boolean, label: string) => {
      const days = expandRange(isoDatePrefix(fromS), isoDatePrefix(toS))
      if (days === null) { warnings.push(`Calendar "${r.name}": exception "${label}" spans more than a year (recurring?); skipped`); return }
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
      }
    }
    for (const ex of allBlocks(firstBlock(r.block, 'Exceptions') || '', 'Exception')) {
      const tp = firstBlock(ex, 'TimePeriod') || ''
      const own = stripBlocks(ex, ['TimePeriod', 'WorkingTimes'])
      const type = tagText(own, 'Type')
      if (type && type !== '1') {
        warnings.push(`Calendar "${r.name}": recurring exception "${tagText(own, 'Name')}" (type ${type}) not expanded`)
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
      sourceName: r.name || undefined,
    }
    result.set(r.uid, cal)
    return cal
  }
  for (const r of raws) resolve(r)
  return { calendars: result, baseIds: new Set(raws.filter(r => r.isBase).map(r => r.uid)) }
}

/* ─── main ──────────────────────────────────────────────── */

export function parseMSProjectXML(content: string, scheduleId: string): ParsedSchedule {
  const warnings: string[] = []
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
  for (const ea of extAttrs) {
    const fid = tagText(ea, 'FieldID')
    const alias = tagText(ea, 'Alias')
    if (/\b(activity\s*id|activity\s*code|task\s*code|code)\b/i.test(alias)) codeFieldIds.add(fid)
  }

  const { calendars: calMap, baseIds } = buildCalendars(xml, warnings)
  const defaultCalendarId = projectCalUid && calMap.has(projectCalUid) ? projectCalUid : calMap.size ? Array.from(calMap.keys())[0] : null
  const defaultHpd = minutesPerDay > 0 ? minutesPerDay / 60 : (defaultCalendarId ? calMap.get(defaultCalendarId)!.hoursPerDay : 8)

  const tasksBlock = firstBlock(xml, 'Tasks') || ''
  const taskBlocks = allBlocks(tasksBlock, 'Task')
  const activities: Activity[] = []
  const byUid = new Map<string, Activity>()
  const hpdByUid = new Map<string, number>()
  let projectSummaryName = ''
  const pendingLinks: { succUid: string; block: string }[] = []

  for (const block of taskBlocks) {
    const own = stripBlocks(block, ['PredecessorLink', 'ExtendedAttribute', 'Baseline', 'TimephasedData'])
    const uid = tagText(own, 'UID')
    const name = tagText(own, 'Name')
    const outlineLevel = tagText(own, 'OutlineLevel')
    if (tagText(own, 'IsNull') === '1') continue
    if (uid === '0' || outlineLevel === '0') { projectSummaryName = name; continue } // project summary task
    if (!name) continue

    const isSummary = tagText(own, 'Summary') === '1'
    const calUidRaw = tagText(own, 'CalendarUID')
    const hasOwnCal = !!calUidRaw && calUidRaw !== '-1' && calMap.has(calUidRaw)
    if (calUidRaw && calUidRaw !== '-1' && !calMap.has(calUidRaw)) warnings.push(`Task "${name}": calendar UID ${calUidRaw} not found; using project calendar`)
    const calendarId = hasOwnCal ? calUidRaw : defaultCalendarId
    const hpd = hasOwnCal ? calMap.get(calUidRaw)!.hoursPerDay : defaultHpd
    const days = (d: string) => round2(mspDurationHours(d, hpd) / hpd)
    // Slack values are integers in tenths of minutes
    const slack = (v: string) => (v === '' ? null : round2(parseFloat(v) / (600 * hpd)))

    const duration = days(tagText(own, 'Duration'))
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
    if (mapped === 'ALAP') warnings.push(`Task "${name}": As Late As Possible constraint is not modeled; ignored`)
    else if (mapped) {
      constraintDate = isoDatePrefix(tagText(own, 'ConstraintDate'))
      if (constraintDate) constraintType = mapped
      else warnings.push(`Task "${name}": constraint ${mapped} has no ConstraintDate; ignored`)
    }

    let code = ''
    for (const ea of allBlocks(block, 'ExtendedAttribute')) {
      if (codeFieldIds.has(tagText(ea, 'FieldID'))) { code = tagText(ea, 'Value'); break }
    }
    const idTxt = tagText(own, 'ID') || uid

    let baselineStart: string | null = null
    let baselineFinish: string | null = null
    for (const bl of allBlocks(block, 'Baseline')) {
      if (tagText(bl, 'Number') === '0') {
        baselineStart = isoDatePrefix(tagText(bl, 'Start'))
        baselineFinish = isoDatePrefix(tagText(bl, 'Finish'))
      }
    }

    const isMilestone = tagText(own, 'Milestone') === '1'
    const a = makeActivity(scheduleId, {
      activityId: code || `A${idTxt}`,
      name,
      wbs: tagText(own, 'WBS') || tagText(own, 'OutlineNumber'),
      duration,
      remainingDuration: remTxt ? days(remTxt) : status === 'complete' ? 0 : duration,
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
      isCritical: isSummary ? false : isCritical,
      status,
      activityType: isSummary ? 'summary' : isMilestone ? 'milestone' : 'task',
      calendarId,
      constraintType,
      constraintDate: constraintType ? constraintDate : null,
      sourceId: uid,
    })
    activities.push(a)
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
      continue
    }
    const type = MSP_LINK_TYPES[tagText(block, 'Type')] ?? 'FS'
    const lagRaw = parseFloat(tagText(block, 'LinkLag') || '0') || 0
    const fmt = tagText(block, 'LagFormat')
    let lag: number
    if (fmt === '19' || fmt === '20') {
      // percentage lag: LinkLag is percent × 10 of the predecessor duration
      lag = round2((lagRaw / 1000) * pred.duration)
    } else if (['4', '6', '8', '10', '12', '36', '38', '40', '42', '44'].includes(fmt)) {
      // elapsed units: LinkLag is in tenths of minutes of wall-clock time
      lag = round2(lagRaw / 600 / 24)
      warnings.push(`Link ${pred.activityId} → ${succ.activityId}: elapsed lag converted to ${lag} calendar days`)
    } else {
      lag = round2(lagRaw / (600 * (hpdByUid.get(succUid) ?? defaultHpd)))
    }
    relationships.push({ id: uuid(), scheduleId, predecessorId: pred.id, successorId: succ.id, type, lag })
  }

  return {
    projectName: title || projectSummaryName || fileName || 'Imported Schedule',
    dataDate,
    projectStart,
    projectFinish,
    activities,
    relationships,
    // base calendars plus any (resource) calendar a task actually uses
    calendars: Array.from(calMap.values()).filter(c => baseIds.has(c.id) || c.id === defaultCalendarId || activities.some(a => a.calendarId === c.id)),
    defaultCalendarId,
    warnings,
    sourceType: 'ms_xml',
  }
}
