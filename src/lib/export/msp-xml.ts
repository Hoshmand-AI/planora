// Export a GeneratedSchedule as Microsoft Project XML (MSPDI), importable by MS Project
// and by parseMSProjectXML (round-trip tested).

import type { ConstraintType, GeneratedSchedule, LinkType, WorkCalendar } from '@/lib/planning/types'

const MSP_LINK_TYPE: Record<LinkType, number> = { FF: 0, FS: 1, SF: 2, SS: 3 }
const MSP_CONSTRAINT: Record<ConstraintType, number> = { MSO: 2, MFO: 3, SNET: 4, SNLT: 5, FNET: 6, FNLT: 7 }
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

/** Working intervals (minutes from midnight) totalling hoursPerDay, with a lunch hour when it fits. */
function intervals(hoursPerDay: number): [number, number][] {
  const h = Math.max(0, Math.min(24, hoursPerDay || 8))
  if (h <= 5) return [[480, 480 + h * 60]]
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

export function exportMspXml(s: GeneratedSchedule, projectName: string): string {
  const calendars: WorkCalendar[] = s.calendars.length
    ? s.calendars
    : [{ id: 'standard', name: 'Standard', workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidays: [] }]
  const calUid = new Map(calendars.map((c, i) => [c.id, i + 1]))
  const calById = new Map(calendars.map(c => [c.id, c]))
  const defaultCal = calById.get(s.defaultCalendarId) ?? calendars[0]
  const calOf = (id?: string) => (id && calById.get(id)) || defaultCal

  const uidById = new Map(s.activities.map((a, i) => [a.id, i + 1]))
  const times = s.cpm?.times ?? {}
  const finish = s.cpm?.projectFinish

  const hpd0 = defaultCal.hoursPerDay || 8
  let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  x += '<Project xmlns="http://schemas.microsoft.com/project">\n'
  const h = '  '
  x += tag('SaveVersion', 14, h)
  x += tag('Name', `${projectName}.xml`, h)
  x += tag('Title', projectName, h)
  x += tag('CreationDate', `${(s.generatedAt || '').slice(0, 10) || s.projectStart}T00:00:00`, h)
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
  x += tag('DefaultTaskType', 0, h)
  x += tag('DurationFormat', 7, h)
  x += tag('NewTasksEstimated', 0, h)
  x += `${h}<ExtendedAttributes>\n${h}  <ExtendedAttribute>\n${tag('FieldID', TEXT1_FIELD_ID, h + '    ')}${tag('FieldName', 'Text1', h + '    ')}${tag('Alias', 'Activity ID', h + '    ')}${h}  </ExtendedAttribute>\n${h}</ExtendedAttributes>\n`

  x += `${h}<Calendars>\n`
  calendars.forEach((c, i) => { x += calendarXml(c, i + 1) })
  x += `${h}</Calendars>\n`

  x += `${h}<Tasks>\n`
  s.activities.forEach((a, idx) => {
    const uid = idx + 1
    const cal = calOf(a.calendarId)
    const hpd = cal.hoursPerDay || 8
    const t = times[a.id]
    const isMs = a.type === 'milestone' || a.duration === 0
    const i = '      '
    x += '    <Task>\n'
    x += tag('UID', uid, i)
    x += tag('ID', uid, i)
    x += tag('Name', a.name, i)
    x += tag('Type', 0, i)
    x += tag('IsNull', 0, i)
    x += tag('WBS', uid, i)
    x += tag('OutlineNumber', uid, i)
    x += tag('OutlineLevel', 1, i)
    x += tag('Priority', 500, i)
    const start = t?.earlyStart ?? a.actualStart ?? s.projectStart
    x += tag('Start', `${start}T${dayStartTime(hpd)}`, i)
    if (t) x += tag('Finish', isMs ? `${t.earlyStart}T${dayStartTime(hpd)}` : `${t.earlyFinish}T${dayEndTime(hpd)}`, i)
    x += tag('Duration', durationPT(isMs ? 0 : a.duration * hpd), i)
    x += tag('DurationFormat', 7, i)
    if (a.remaining !== undefined) x += tag('RemainingDuration', durationPT(a.remaining * hpd), i)
    x += tag('Estimated', 0, i)
    x += tag('Milestone', isMs ? 1 : 0, i)
    x += tag('Summary', 0, i)
    if (t) x += tag('Critical', t.critical ? 1 : 0, i)
    if (t) {
      x += tag('EarlyStart', `${t.earlyStart}T${dayStartTime(hpd)}`, i)
      x += tag('EarlyFinish', `${t.earlyFinish}T${dayEndTime(hpd)}`, i)
      x += tag('LateStart', `${t.lateStart}T${dayStartTime(hpd)}`, i)
      x += tag('LateFinish', `${t.lateFinish}T${dayEndTime(hpd)}`, i)
      x += tag('FreeSlack', Math.round(t.freeFloat * hpd * 600), i)
      x += tag('TotalSlack', Math.round(t.totalFloat * hpd * 600), i)
    }
    if (a.actualStart) x += tag('ActualStart', `${a.actualStart}T${dayStartTime(hpd)}`, i)
    if (a.actualFinish) x += tag('ActualFinish', `${a.actualFinish}T${dayEndTime(hpd)}`, i)
    if (a.constraint) {
      x += tag('ConstraintType', MSP_CONSTRAINT[a.constraint.type], i)
      x += tag('CalendarUID', calUid.get(cal.id) ?? -1, i)
      const isFinishType = a.constraint.type === 'MFO' || a.constraint.type === 'FNET' || a.constraint.type === 'FNLT'
      x += tag('ConstraintDate', `${a.constraint.date}T${isFinishType ? dayEndTime(hpd) : dayStartTime(hpd)}`, i)
    } else {
      x += tag('ConstraintType', 0, i)
      x += tag('CalendarUID', calUid.get(cal.id) ?? -1, i)
    }
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
    x += `${i}<ExtendedAttribute>\n${tag('FieldID', TEXT1_FIELD_ID, i + '  ')}${tag('Value', a.code, i + '  ')}${i}</ExtendedAttribute>\n`
    x += '    </Task>\n'
  })
  x += `${h}</Tasks>\n`
  x += '</Project>\n'
  return x
}
