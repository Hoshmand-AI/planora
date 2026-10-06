// Export a GeneratedSchedule as Microsoft Project XML (MSPDI), importable by MS Project
// and by parseMSProjectXML (round-trip tested).

import type { ConstraintType, GeneratedSchedule, LinkType, PlanActivity, WorkCalendar } from '@/lib/planning/types'
import { compileCalendar, toDayNumber } from '@/lib/planning/calendar'
import { buildWbs, type WbsNode } from './wbs'
import { markedTitle, type ExportMarking } from './markings'

const MSP_LINK_TYPE: Record<LinkType, number> = { FF: 0, FS: 1, SF: 2, SS: 3 }
// MS Project has no two-sided "Start On"/"Finish On"; its Must Start/Finish On is the closest match.
const MSP_CONSTRAINT: Record<ConstraintType, number> = { MSO: 2, MFO: 3, SO: 2, FO: 3, SNET: 4, SNLT: 5, FNET: 6, FNLT: 7 }
const TEXT1_FIELD_ID = '188743731'

/** Escape text for XML element content / attributes and drop characters XML 1.0 forbids. */
export function escapeXml(v: unknown): string {
  return String(v ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

const pad2 = (n: number) => String(n).padStart(2, '0')
const hhmm = (min: number) => `${pad2(Math.floor(min / 60) % 24)}:${pad2(Math.round(min % 60))}:00`

/**
 * Working intervals (minutes from midnight) totalling hoursPerDay. Days start at 08:00; days of 8 hours
 * or more take a lunch hour 12:00-13:00, so finish = 8 + hours (+1 h lunch when hours >= 8), the same
 * rule as the P6 export. Days too long to fit after 08:00 run from midnight.
 */
function intervals(hoursPerDay: number): [number, number][] {
  const h = Math.max(0, Math.min(24, hoursPerDay || 8))
  if (h < 8) return [[480, 480 + h * 60]]
  if (h <= 15) return [[480, 720], [780, 780 + (h - 4) * 60]]
  return [[0, h * 60]]
}

function dayEndTime(hpd: number): string {
  const iv = intervals(hpd)
  const end = iv[iv.length - 1][1]
  return end >= 1440 ? '23:59:00' : hhmm(end)
}

function dayStartTime(hpd: number): string {
  return hhmm(intervals(hpd)[0][0])
}

const durationPT = (hours: number) => {
  const totalMin = Math.round(Math.abs(hours) * 60)
  return `${hours < 0 ? '-' : ''}PT${Math.floor(totalMin / 60)}H${totalMin % 60}M0S`
}

function tag(name: string, value: unknown, indent: string): string {
  return `${indent}<${name}>${escapeXml(value)}</${name}>\n`
}

function calendarXml(cal: WorkCalendar, uid: number): string {
  const i = '      '
  let x = '    <Calendar>\n'
  x += tag('UID', uid, i)
  x += tag('Name', cal.name, i)
  x += tag('IsBaseCalendar', 1, i)
  x += tag('BaseCalendarUID', -1, i)
  x += `${i}<WeekDays>\n`
  const wt = (ind: string) => {
    let s = `${ind}<WorkingTimes>\n`
    for (const [f, t] of intervals(cal.hoursPerDay)) {
      s += `${ind}  <WorkingTime>\n${tag('FromTime', hhmm(f), ind + '    ')}${tag('ToTime', t >= 1440 ? '00:00:00' : hhmm(t), ind + '    ')}${ind}  </WorkingTime>\n`
    }
    return s + `${ind}</WorkingTimes>\n`
  }
  for (let d = 0; d < 7; d++) {
    const working = cal.workDays.includes(d as 0)
    x += `${i}  <WeekDay>\n`
    x += tag('DayType', d + 1, i + '    ')
    x += tag('DayWorking', working ? 1 : 0, i + '    ')
    if (working) x += wt(i + '    ')
    x += `${i}  </WeekDay>\n`
  }
  x += `${i}</WeekDays>\n`
  const ex = [
    ...cal.holidays.map(d => ({ d, working: false })),
    ...(cal.extraWorkDays || []).map(d => ({ d, working: true })),
  ].sort((a, b) => a.d.localeCompare(b.d))
  if (ex.length) {
    x += `${i}<Exceptions>\n`
    for (const e of ex) {
      const j = i + '    '
      x += `${i}  <Exception>\n`
      x += tag('EnteredByOccurrences', 0, j)
      x += `${j}<TimePeriod>\n${tag('FromDate', `${e.d}T00:00:00`, j + '  ')}${tag('ToDate', `${e.d}T23:59:00`, j + '  ')}${j}</TimePeriod>\n`
      x += tag('Occurrences', 1, j)
      x += tag('Name', e.working ? 'Work day' : 'Holiday', j)
      x += tag('Type', 1, j)
      x += tag('DayWorking', e.working ? 1 : 0, j)
      if (e.working) x += wt(j)
      x += `${i}  </Exception>\n`
    }
    x += `${i}</Exceptions>\n`
  }
  x += '    </Calendar>\n'
  return x
}

const FINISH_TYPES = new Set<ConstraintType>(['MFO', 'FO', 'FNET', 'FNLT'])

/** Progress of one activity, as in the P6 export: complete, in progress (has an actual start) or not started. */
function progressOf(a: PlanActivity): { done: boolean; active: boolean; remaining: number; pct: number } {
  const done = !!a.actualFinish || a.status === 'complete'
  const active = !done && !!a.actualStart
  const dur = a.type === 'milestone' ? 0 : a.duration
  const remaining = done ? 0 : active ? Math.max(0, Math.min(dur, a.remaining ?? dur)) : dur
  const pct = done ? 100 : active ? Math.max(0, Math.min(99, Math.round(a.percentComplete ?? (dur ? 100 * (1 - remaining / dur) : 0)))) : 0
  return { done, active, remaining, pct }
}

type OutlineLine =
  | { kind: 'wbs'; node: WbsNode; level: number; outline: string; wbs: string }
  | { kind: 'act'; a: PlanActivity; level: number; outline: string; wbs: string }

/**
 * Task order and outline for MS Project: WBS summary tasks (Planora phases / work packages, or the
 * uploaded file's own WBS) with their activities nested one level below. The WBS field of a summary
 * is its WBS code without the project prefix ("03.02", or the source path "1.2.3"); an activity's
 * WBS is its parent's code plus its position.
 */
function outline(s: GeneratedSchedule, projectName: string): OutlineLine[] {
  const { root, rows } = buildWbs(s, projectName)
  const wbsCodeOf = (n: WbsNode) => (n.code.startsWith(`${root}.`) ? n.code.slice(root.length + 1) : n.code)
  const lines: OutlineLine[] = []
  const counters: number[] = []
  const wbsStack: string[] = []
  for (const r of rows) {
    const level = Math.max(1, r.level)
    counters.length = Math.min(counters.length, level)
    while (counters.length < level) counters.push(0)
    counters[level - 1]++
    const num = counters.join('.')
    wbsStack.length = Math.min(wbsStack.length, level - 1)
    if (r.kind === 'wbs' && r.node) {
      const wbs = wbsCodeOf(r.node)
      wbsStack.push(wbs)
      lines.push({ kind: 'wbs', node: r.node, level, outline: num, wbs })
    } else if (r.activity) {
      const parent = level >= 2 ? wbsStack[level - 2] : undefined
      lines.push({ kind: 'act', a: r.activity, level, outline: num, wbs: parent ? `${parent}.${counters[level - 1]}` : num })
    }
  }
  // Anything the WBS did not place still goes out, at the top level.
  const placed = new Set(lines.flatMap(l => (l.kind === 'act' ? [l.a.id] : [])))
  let top = counters[0] || 0
  for (const a of s.activities) {
    if (placed.has(a.id)) continue
    top++
    lines.push({ kind: 'act', a, level: 1, outline: String(top), wbs: String(top) })
  }
  return lines
}

export function exportMspXml(s: GeneratedSchedule, projectName: string, opts: { marking?: ExportMarking | null } = {}): string {
  const mk = opts.marking ?? null
  const calendars: WorkCalendar[] = s.calendars.length
    ? s.calendars
    : [{ id: 'standard', name: 'Standard', workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidays: [] }]
  const calUid = new Map(calendars.map((c, i) => [c.id, i + 1]))
  const calById = new Map(calendars.map(c => [c.id, c]))
  const defaultCal = calById.get(s.defaultCalendarId) ?? calendars[0]
  const calOf = (id?: string) => (id && calById.get(id)) || defaultCal

  // Activity UIDs stay 1..n in the schedule's own order (stable across exports, and what every
  // PredecessorLink points at); WBS summary tasks take the UIDs after them. ID is the row number.
  const uidById = new Map(s.activities.map((a, i) => [a.id, i + 1]))
  const times = s.cpm?.times ?? {}
  const finish = s.cpm?.projectFinish
  const hpd0 = defaultCal.hoursPerDay || 8
  const lines = outline(s, projectName)

  // Required finish → a Deadline on the finish milestone(s): the activities nothing follows.
  const hasSucc = new Set(s.links.map(l => l.from))
  const ends = s.activities.filter(a => !hasSucc.has(a.id))
  const endMilestones = ends.filter(a => a.type === 'milestone' || a.duration === 0)
  const deadlineIds = new Set((endMilestones.length ? endMilestones : ends).map(a => a.id))

  let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  x += '<Project xmlns="http://schemas.microsoft.com/project">\n'
  const h = '  '
  x += tag('SaveVersion', 14, h)
  x += tag('Name', projectName, h)
  // CUI: the banner leads the Title, the designation is the Subject and the project summary task's Notes.
  x += tag('Title', markedTitle(projectName, mk), h)
  if (mk) x += tag('Subject', `${mk.banner}. ${mk.designation.join('; ')}`, h)
  x += tag('CreationDate', `${String(s.generatedAt || '').slice(0, 10) || s.projectStart}T00:00:00`, h)
  x += tag('ScheduleFromStart', 1, h)
  x += tag('StartDate', `${s.projectStart}T${dayStartTime(hpd0)}`, h)
  if (finish) x += tag('FinishDate', `${finish}T${dayEndTime(hpd0)}`, h)
  x += tag('FYStartDate', 1, h)
  x += tag('CalendarUID', calUid.get(defaultCal.id) ?? 1, h)
  x += tag('DefaultStartTime', dayStartTime(hpd0), h)
  x += tag('DefaultFinishTime', dayEndTime(hpd0), h)
  x += tag('MinutesPerDay', Math.round(hpd0 * 60), h)
  x += tag('MinutesPerWeek', Math.round(hpd0 * 60 * Math.max(1, defaultCal.workDays.length)), h)
  x += tag('DaysPerMonth', 20, h)
  if (s.dataDate) x += tag('StatusDate', `${s.dataDate}T${dayStartTime(hpd0)}`, h)
  x += tag('DefaultTaskType', 0, h)
  x += tag('DurationFormat', 7, h)
  x += tag('NewTasksEstimated', 0, h)
  x += `${h}<ExtendedAttributes>\n${h}  <ExtendedAttribute>\n${tag('FieldID', TEXT1_FIELD_ID, h + '    ')}${tag('FieldName', 'Text1', h + '    ')}${tag('Alias', 'Activity ID', h + '    ')}${h}  </ExtendedAttribute>\n${h}</ExtendedAttributes>\n`

  x += `${h}<Calendars>\n`
  calendars.forEach((c, i) => { x += calendarXml(c, i + 1) })
  x += `${h}</Calendars>\n`

  const i = '      '
  const compiled = compileCalendar(defaultCal)
  const summaryTask = (uid: number, id: number, name: string, wbs: string, num: string, level: number, start: string | null, fin: string | null, critical: boolean, notes?: string) => {
    let t = '    <Task>\n'
    t += tag('UID', uid, i)
    t += tag('ID', id, i)
    t += tag('Name', name, i)
    t += tag('Type', 1, i)
    t += tag('IsNull', 0, i)
    t += tag('WBS', wbs, i)
    t += tag('OutlineNumber', num, i)
    t += tag('OutlineLevel', level, i)
    t += tag('Priority', 500, i)
    if (start) t += tag('Start', `${start}T${dayStartTime(hpd0)}`, i)
    if (fin) t += tag('Finish', `${fin}T${dayEndTime(hpd0)}`, i)
    const days = start && fin ? compiled.countInclusive(toDayNumber(start), toDayNumber(fin)) : 0
    t += tag('Duration', durationPT(days * hpd0), i)
    t += tag('DurationFormat', 7, i)
    t += tag('Estimated', 0, i)
    t += tag('Milestone', 0, i)
    t += tag('Summary', 1, i)
    t += tag('Critical', critical ? 1 : 0, i)
    t += tag('ConstraintType', 0, i)
    t += tag('CalendarUID', -1, i)
    if (notes) t += tag('Notes', notes, i)
    return t + '    </Task>\n'
  }

  x += `${h}<Tasks>\n`
  // UID 0 is MS Project's project summary task; it carries the project name.
  x += summaryTask(0, 0, projectName, '0', '0', 0, s.projectStart, finish ?? null, false, mk ? [mk.banner, ...mk.designation, mk.banner].join('\n') : undefined)
  let nextSummaryUid = s.activities.length + 1
  lines.forEach((ln, idx) => {
    const id = idx + 1
    if (ln.kind === 'wbs') {
      const n = ln.node
      x += summaryTask(nextSummaryUid++, id, n.name, ln.wbs, ln.outline, ln.level, n.start, n.finish, n.critical)
      return
    }
    const a = ln.a
    const uid = uidById.get(a.id)!
    const cal = calOf(a.calendarId)
    const hpd = cal.hoursPerDay || 8
    const t = times[a.id]
    const isMs = a.type === 'milestone' || a.duration === 0
    const prog = progressOf(a)
    // Times of day follow the activity's calendar: 08:00 start, finish after its hours (+ lunch).
    const st = dayStartTime(hpd), fi = dayEndTime(hpd)
    const msEnd = isMs ? st : fi
    x += '    <Task>\n'
    x += tag('UID', uid, i)
    x += tag('ID', id, i)
    x += tag('Name', a.name, i)
    x += tag('Type', 0, i)
    x += tag('IsNull', 0, i)
    x += tag('WBS', ln.wbs, i)
    x += tag('OutlineNumber', ln.outline, i)
    x += tag('OutlineLevel', ln.level, i)
    x += tag('Priority', 500, i)
    const started = prog.done || prog.active
    const start = (started && a.actualStart) || t?.earlyStart || a.actualStart || s.projectStart
    x += tag('Start', `${start}T${st}`, i)
    const fin = (prog.done && a.actualFinish) || t?.earlyFinish
    if (fin) x += tag('Finish', `${fin}T${msEnd}`, i)
    x += tag('Duration', durationPT(isMs ? 0 : a.duration * hpd), i)
    x += tag('DurationFormat', 7, i)
    if (started) x += tag('ActualDuration', durationPT(isMs ? 0 : (a.duration - prog.remaining) * hpd), i)
    x += tag('RemainingDuration', durationPT(isMs ? 0 : prog.remaining * hpd), i)
    x += tag('PercentComplete', prog.pct, i)
    x += tag('Estimated', 0, i)
    x += tag('Milestone', isMs ? 1 : 0, i)
    x += tag('Summary', 0, i)
    if (t) x += tag('Critical', t.critical ? 1 : 0, i)
    if (t) {
      x += tag('EarlyStart', `${t.earlyStart}T${st}`, i)
      x += tag('EarlyFinish', `${t.earlyFinish}T${msEnd}`, i)
      x += tag('LateStart', `${t.lateStart}T${st}`, i)
      x += tag('LateFinish', `${t.lateFinish}T${msEnd}`, i)
      x += tag('FreeSlack', Math.round(t.freeFloat * hpd * 600), i)
      x += tag('TotalSlack', Math.round(t.totalFloat * hpd * 600), i)
    }
    if (started && a.actualStart) x += tag('ActualStart', `${a.actualStart}T${st}`, i)
    if (prog.done && a.actualFinish) x += tag('ActualFinish', `${a.actualFinish}T${msEnd}`, i)
    if (a.constraint) {
      x += tag('ConstraintType', MSP_CONSTRAINT[a.constraint.type], i)
      x += tag('CalendarUID', calUid.get(cal.id) ?? -1, i)
      x += tag('ConstraintDate', `${a.constraint.date}T${FINISH_TYPES.has(a.constraint.type) ? fi : st}`, i)
    } else {
      x += tag('ConstraintType', 0, i)
      x += tag('CalendarUID', calUid.get(cal.id) ?? -1, i)
    }
    if (s.mustFinishBy && deadlineIds.has(a.id)) x += tag('Deadline', `${s.mustFinishBy}T${fi}`, i)
    if (a.rationale?.summary) x += tag('Notes', a.rationale.summary, i)
    for (const l of s.links) {
      if (l.to !== a.id) continue
      const predUid = uidById.get(l.from)
      if (!predUid) continue
      x += `${i}<PredecessorLink>\n`
      x += tag('PredecessorUID', predUid, i + '  ')
      x += tag('Type', MSP_LINK_TYPE[l.type], i + '  ')
      x += tag('CrossProject', 0, i + '  ')
      // LinkLag is in tenths of minutes; lag is in work days on the successor's calendar
      x += tag('LinkLag', Math.round(l.lag * hpd * 600), i + '  ')
      x += tag('LagFormat', 7, i + '  ')
      x += `${i}</PredecessorLink>\n`
    }
    if (a.baselineStart || a.baselineFinish) {
      x += `${i}<Baseline>\n${tag('Number', 0, i + '  ')}`
      if (a.baselineStart) x += tag('Start', `${a.baselineStart}T${st}`, i + '  ')
      if (a.baselineFinish) x += tag('Finish', `${a.baselineFinish}T${msEnd}`, i + '  ')
      x += tag('Duration', durationPT(isMs ? 0 : a.duration * hpd), i + '  ')
      x += `${i}</Baseline>\n`
    }
    x += `${i}<ExtendedAttribute>\n${tag('FieldID', TEXT1_FIELD_ID, i + '  ')}${tag('Value', a.code, i + '  ')}${i}</ExtendedAttribute>\n`
    x += '    </Task>\n'
  })
  x += `${h}</Tasks>\n`
  x += '</Project>\n'
  return x
}
