// Export a GeneratedSchedule as Microsoft Project XML (MSPDI), importable by MS Project
// and by parseMSProjectXML (round-trip tested).

import type { ConstraintType, GeneratedSchedule, LinkType, PlanActivity, WorkCalendar } from '@/lib/planning/types'
import { compileCalendar, fromDayNumber, toDayNumber } from '@/lib/planning/calendar'
import { buildWbs, type WbsNode } from './wbs'
import { markedTitle, type ExportMarking } from './markings'

const MSP_LINK_TYPE: Record<LinkType, number> = { FF: 0, FS: 1, SF: 2, SS: 3 }
// MS Project has no two-sided "Start On"/"Finish On"; its Must Start/Finish On is the closest match.
const MSP_CONSTRAINT: Record<ConstraintType, number> = { MSO: 2, MFO: 3, SO: 2, FO: 3, SNET: 4, SNLT: 5, FNET: 6, FNLT: 7 }
const TEXT1_FIELD_ID = '188743731'
/** Text2 carries "Level of Effort" for P6 LOE activities (MS Project has no LOE type); parseMSProjectXML reads it back. */
const TEXT2_FIELD_ID = '188743734'

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

const minutesOf = (t: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '')
  return m ? +m[1] * 60 + +m[2] : null
}

type CalTimes = Pick<WorkCalendar, 'hoursPerDay' | 'workTimes'>

/**
 * Working intervals (minutes from midnight) totalling hoursPerDay. The source calendar's own working
 * periods (e.g. 07:00-11:00, 11:30-15:30) when the file gave them and they add up to its hours per day.
 * Otherwise days start at 08:00; days of 8 hours or more take a lunch hour 12:00-13:00, so finish =
 * 8 + hours (+1 h lunch when hours >= 8), the same rule as the P6 export. Days too long to fit after
 * 08:00 run from midnight.
 */
export function intervals(cal: CalTimes): [number, number][] {
  const h = Math.max(0, Math.min(24, cal.hoursPerDay || 8))
  const own = (cal.workTimes || [])
    .map(w => [minutesOf(w.from), minutesOf(w.to)] as const)
    .filter((p): p is readonly [number, number] => p[0] !== null && p[1] !== null && p[1] > p[0])
    .map(([f, t]) => [f, Math.min(t, 1440)] as [number, number])
    .sort((a, b) => a[0] - b[0])
  if (own.length && Math.abs(own.reduce((n, [f, t]) => n + t - f, 0) / 60 - h) < 0.02) return own
  if (h < 8) return [[480, 480 + h * 60]]
  if (h <= 15) return [[480, 720], [780, 780 + (h - 4) * 60]]
  return [[0, h * 60]]
}

function dayEndTime(cal: CalTimes): string {
  const iv = intervals(cal)
  const end = iv[iv.length - 1][1]
  return end >= 1440 ? '23:59:00' : hhmm(end)
}

function dayStartTime(cal: CalTimes): string {
  return hhmm(intervals(cal)[0][0])
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
    for (const [f, t] of intervals(cal)) {
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
/** Finish constraints that are a date to finish by: written as the milestone's MS Project Deadline. */
const DEADLINE_TYPES = new Set<ConstraintType>(['MFO', 'FO', 'FNLT'])

/**
 * Progress of one activity: complete, in progress (has an actual start) or not started. Remaining is
 * the file's true remaining duration (it may exceed the original); actual is the work days from the
 * actual start up to the data date (the data date is the first day of remaining work); percent
 * complete is MS Project's duration % complete, actual / (actual + remaining).
 */
export function progressOf(a: PlanActivity, cal: WorkCalendar, dataDate?: string): { done: boolean; active: boolean; remaining: number; actual: number; pct: number } {
  const done = !!a.actualFinish || a.status === 'complete'
  const active = !done && !!a.actualStart
  const dur = a.type === 'milestone' ? 0 : a.duration
  const remaining = done || a.type === 'milestone' ? 0 : Math.max(0, a.remaining ?? dur)
  let actual = 0
  if (done) actual = dur
  else if (active && a.type !== 'milestone') {
    actual = dataDate && a.actualStart! < dataDate
      ? compileCalendar(cal).countInclusive(toDayNumber(a.actualStart!), toDayNumber(dataDate) - 1)
      : Math.max(0, dur - remaining)
  }
  const pct = done ? 100 : active
    ? actual + remaining > 0 ? Math.max(0, Math.min(99, Math.round((100 * actual) / (actual + remaining)))) : Math.max(0, Math.min(99, Math.round(a.percentComplete ?? 0)))
    : 0
  return { done, active, remaining, actual, pct }
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
  const actById = new Map(s.activities.map(a => [a.id, a]))
  const isLoe = (a: PlanActivity | undefined) => !!a?.levelOfEffort

  // Required finish → a Deadline on the project's finish activity only: the end activity (nothing
  // follows it) that finishes last, preferring a milestone and the end of the driving path. Interim
  // milestones never get it; a milestone's own finish constraint is its Deadline instead.
  const hasSucc = new Set(s.links.filter(l => !isLoe(actById.get(l.to))).map(l => l.from))
  const hasPred = new Set(s.links.filter(l => !isLoe(actById.get(l.from))).map(l => l.to))
  const finishOf = (a: PlanActivity) => a.actualFinish || times[a.id]?.earlyFinish || ''
  const ends = s.activities.filter(a => !isLoe(a) && !hasSucc.has(a.id))
  const endMilestones = ends.filter(a => a.type === 'milestone' || a.duration === 0)
  const pool = endMilestones.length ? endMilestones : ends
  const lastOnPath = s.cpm?.longestPath?.[s.cpm.longestPath.length - 1]
  const projectFinishId = (lastOnPath && pool.some(a => a.id === lastOnPath) ? lastOnPath : null)
    ?? [...pool].sort((a, b) => finishOf(b).localeCompare(finishOf(a)))[0]?.id
  const deadlineOf = (a: PlanActivity, isMs: boolean): string | null => {
    if (s.mustFinishBy && a.id === projectFinishId) return s.mustFinishBy
    return isMs && a.constraint && DEADLINE_TYPES.has(a.constraint.type) ? a.constraint.date : null
  }

  // Level of effort: spans the work it is linked to (start from its predecessors, finish from its
  // successors, as P6), else the file's dates.
  const datesOf = (id: string): { start: string; finish: string } | null => {
    const a = actById.get(id), t = times[id]
    if (!a || isLoe(a)) return null
    const start = a.actualStart || t?.earlyStart, finish = a.actualFinish || t?.earlyFinish
    return start && finish ? { start, finish } : null
  }
  const loeSpan = (a: PlanActivity, cal: WorkCalendar): { start: string; finish: string } => {
    const c = compileCalendar(cal)
    const starts: number[] = [], finishes: number[] = []
    for (const l of s.links) {
      if (l.to === a.id) {
        const p = datesOf(l.from)
        if (p) starts.push(l.type === 'SS' || l.type === 'SF' ? toDayNumber(p.start) : c.next(toDayNumber(p.finish) + 1))
      } else if (l.from === a.id) {
        const q = datesOf(l.to)
        if (q) finishes.push(l.type === 'FF' || l.type === 'SF' ? toDayNumber(q.finish) : c.prev(toDayNumber(q.start) - 1))
      }
    }
    const lo = a.levelOfEffort!
    const st = a.actualStart ? toDayNumber(a.actualStart) : starts.length ? Math.min(...starts) : toDayNumber(lo.start || s.projectStart)
    let fi = a.actualFinish ? toDayNumber(a.actualFinish) : finishes.length ? Math.max(...finishes) : toDayNumber(lo.finish || lo.start || s.projectStart)
    if (fi < st) fi = st
    return { start: fromDayNumber(st), finish: fromDayNumber(fi) }
  }

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
  x += tag('StartDate', `${s.projectStart}T${dayStartTime(defaultCal)}`, h)
  if (finish) x += tag('FinishDate', `${finish}T${dayEndTime(defaultCal)}`, h)
  x += tag('FYStartDate', 1, h)
  x += tag('CalendarUID', calUid.get(defaultCal.id) ?? 1, h)
  x += tag('DefaultStartTime', dayStartTime(defaultCal), h)
  x += tag('DefaultFinishTime', dayEndTime(defaultCal), h)
  x += tag('MinutesPerDay', Math.round(hpd0 * 60), h)
  x += tag('MinutesPerWeek', Math.round(hpd0 * 60 * Math.max(1, defaultCal.workDays.length)), h)
  x += tag('DaysPerMonth', 20, h)
  if (s.dataDate) x += tag('StatusDate', `${s.dataDate}T${dayStartTime(defaultCal)}`, h)
  x += tag('DefaultTaskType', 0, h)
  x += tag('DurationFormat', 7, h)
  x += tag('NewTasksEstimated', 0, h)
  x += `${h}<ExtendedAttributes>\n${h}  <ExtendedAttribute>\n${tag('FieldID', TEXT1_FIELD_ID, h + '    ')}${tag('FieldName', 'Text1', h + '    ')}${tag('Alias', 'Activity ID', h + '    ')}${h}  </ExtendedAttribute>\n`
  if (s.activities.some(isLoe)) x += `${h}  <ExtendedAttribute>\n${tag('FieldID', TEXT2_FIELD_ID, h + '    ')}${tag('FieldName', 'Text2', h + '    ')}${tag('Alias', 'Activity Type', h + '    ')}${h}  </ExtendedAttribute>\n`
  x += `${h}</ExtendedAttributes>\n`

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
    if (start) t += tag('Start', `${start}T${dayStartTime(defaultCal)}`, i)
    if (fin) t += tag('Finish', `${fin}T${dayEndTime(defaultCal)}`, i)
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
    const loe = isLoe(a)
    const t = loe ? undefined : times[a.id]
    const isMs = !loe && (a.type === 'milestone' || a.duration === 0)
    const prog = progressOf(a, cal, s.dataDate)
    // Times of day follow the activity's calendar (the source's own working times). A start milestone
    // sits at the start of its day, a finish milestone (and any finish) at the end of its day.
    const st = dayStartTime(cal), fi = dayEndTime(cal)
    const msKind = a.milestoneKind ?? (hasPred.has(a.id) ? 'finish' : 'start')
    const msAt = msKind === 'finish' ? fi : st
    const startAt = isMs ? msAt : st
    const msEnd = isMs ? msAt : fi
    // Level of effort: duration is its span; remaining the part of the span from the data date on.
    const span = loe ? loeSpan(a, cal) : null
    const cc = compileCalendar(cal)
    const loeDays = span ? cc.countInclusive(toDayNumber(span.start), toDayNumber(span.finish)) : 0
    const loeRemaining = span && !prog.done ? cc.countInclusive(Math.max(toDayNumber(span.start), s.dataDate ? toDayNumber(s.dataDate) : -Infinity), toDayNumber(span.finish)) : 0
    const durDays = isMs ? 0 : span ? loeDays : a.duration
    const remDays = isMs ? 0 : span ? loeRemaining : prog.remaining
    const actDays = isMs ? 0 : span ? Math.max(0, loeDays - loeRemaining) : prog.actual
    const pct = span && prog.active ? (loeDays ? Math.max(0, Math.min(99, Math.round((100 * actDays) / loeDays))) : 0) : prog.pct
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
    const start = span?.start || (started && a.actualStart) || t?.earlyStart || a.actualStart || s.projectStart
    x += tag('Start', `${start}T${startAt}`, i)
    const fin = span?.finish || (prog.done && a.actualFinish) || t?.earlyFinish
    if (fin) x += tag('Finish', `${fin}T${msEnd}`, i)
    // Duration is the original duration; RemainingDuration the true remaining (not capped at the
    // original); ActualDuration the work days from the actual start to the data date.
    x += tag('Duration', durationPT(durDays * hpd), i)
    x += tag('DurationFormat', 7, i)
    if (started) x += tag('ActualDuration', durationPT(actDays * hpd), i)
    x += tag('RemainingDuration', durationPT(remDays * hpd), i)
    x += tag('PercentComplete', pct, i)
    x += tag('Estimated', 0, i)
    x += tag('Milestone', isMs ? 1 : 0, i)
    x += tag('Summary', 0, i)
    if (t) x += tag('Critical', t.critical ? 1 : 0, i)
    else if (loe) x += tag('Critical', 0, i)
    if (t) {
      x += tag('EarlyStart', `${t.earlyStart}T${startAt}`, i)
      x += tag('EarlyFinish', `${t.earlyFinish}T${msEnd}`, i)
      x += tag('LateStart', `${t.lateStart}T${startAt}`, i)
      x += tag('LateFinish', `${t.lateFinish}T${msEnd}`, i)
      x += tag('FreeSlack', Math.round(t.freeFloat * hpd * 600), i)
      x += tag('TotalSlack', Math.round(t.totalFloat * hpd * 600), i)
    }
    if (started && a.actualStart) x += tag('ActualStart', `${a.actualStart}T${startAt}`, i)
    if (prog.done && a.actualFinish) x += tag('ActualFinish', `${a.actualFinish}T${msEnd}`, i)
    if (a.constraint) {
      x += tag('ConstraintType', MSP_CONSTRAINT[a.constraint.type], i)
      x += tag('CalendarUID', calUid.get(cal.id) ?? -1, i)
      x += tag('ConstraintDate', `${a.constraint.date}T${FINISH_TYPES.has(a.constraint.type) ? fi : st}`, i)
    } else {
      x += tag('ConstraintType', 0, i)
      x += tag('CalendarUID', calUid.get(cal.id) ?? -1, i)
    }
    const deadline = loe ? null : deadlineOf(a, isMs)
    if (deadline) x += tag('Deadline', `${deadline}T${fi}`, i)
    const note = [loe ? 'Level of effort (P6 LOE): spans the work it is linked to.' : '', a.rationale?.summary || ''].filter(Boolean).join(' ')
    if (note) x += tag('Notes', note, i)
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
      if (a.baselineStart) x += tag('Start', `${a.baselineStart}T${startAt}`, i + '  ')
      if (a.baselineFinish) x += tag('Finish', `${a.baselineFinish}T${msEnd}`, i + '  ')
      x += tag('Duration', durationPT(isMs ? 0 : a.duration * hpd), i + '  ')
      x += `${i}</Baseline>\n`
    }
    x += `${i}<ExtendedAttribute>\n${tag('FieldID', TEXT1_FIELD_ID, i + '  ')}${tag('Value', a.code, i + '  ')}${i}</ExtendedAttribute>\n`
    if (loe) x += `${i}<ExtendedAttribute>\n${tag('FieldID', TEXT2_FIELD_ID, i + '  ')}${tag('Value', 'Level of Effort', i + '  ')}${i}</ExtendedAttribute>\n`
    x += '    </Task>\n'
  })
  x += `${h}</Tasks>\n`
  x += '</Project>\n'
  return x
}
