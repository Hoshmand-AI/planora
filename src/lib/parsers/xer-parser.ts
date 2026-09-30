// Primavera P6 XER File Parser
// XER is a tab-separated text format: %T table, %F field names, %R rows, %E end.

import type { Activity, Relationship } from '@/lib/db'
import type { ConstraintType, Weekday, WorkCalendar } from '@/lib/planning/types'
import { v4 as uuid } from 'uuid'
import {
  ParsedSchedule, makeActivity, isoDatePrefix, serialToIso, round2, constraintFromLabel,
} from './types'

type Row = Record<string, string>

export function parseXER(content: string, scheduleId: string): ParsedSchedule {
  const warnings: string[] = []
  const tables = readTables(content)

  /* ── Project ─────────────────────────────────────────── */
  const projects = tables['PROJECT'] || []
  const project = projects[0] || {}
  if (projects.length > 1) warnings.push(`XER contains ${projects.length} projects; all activities were imported, project dates taken from "${project['proj_short_name'] || project['proj_id']}"`)
  const projectName = project['proj_short_name'] || project['proj_long_name'] || 'Imported Schedule'
  const projectStart = isoDatePrefix(project['plan_start_date'])
  const dataDate = isoDatePrefix(project['last_recalc_date']) || isoDatePrefix(project['next_data_date']) || projectStart
  const projectFinish = isoDatePrefix(project['scd_end_date']) || isoDatePrefix(project['plan_end_date'])

  /* ── Calendars ───────────────────────────────────────── */
  const calendars: WorkCalendar[] = []
  const calById = new Map<string, WorkCalendar>()
  let defaultCalFlag: string | null = null
  for (const c of tables['CALENDAR'] || []) {
    const id = c['clndr_id']
    if (!id) continue
    const cal = parseCalendarRow(c, warnings)
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
  const tasks = tables['TASK'] || []
  const byTaskId = new Map<string, Activity>()
  const activities: Activity[] = tasks.map(t => {
    const clndrId = t['clndr_id'] || defaultCalendarId
    if (t['clndr_id'] && !calById.has(t['clndr_id'])) warnings.push(`Activity ${t['task_code']}: calendar ${t['clndr_id']} not found in CALENDAR table; using ${hoursPerDay(null)}h/day`)
    const hpd = hoursPerDay(clndrId)
    const hrs = (v: string | undefined) => (v === undefined || v === '' ? null : round2(parseFloat(v) / hpd))

    let status: Activity['status'] = 'not_started'
    if (t['status_code'] === 'TK_Complete') status = 'complete'
    else if (t['status_code'] === 'TK_Active') status = 'in_progress'

    let pct = parseFloat(t['phys_complete_pct'] || t['complete_pct'] || '0') || 0
    if (status === 'complete' && pct === 0) pct = 100

    let activityType: Activity['activityType'] = 'task'
    if (t['task_type'] === 'TT_Mile' || t['task_type'] === 'TT_FinMile') activityType = 'milestone'
    else if (t['task_type'] === 'TT_LOE') activityType = 'loe'
    else if (t['task_type'] === 'TT_WBS') activityType = 'summary'

    const tf = hrs(t['total_float_hr_cnt'])
    const ff = hrs(t['free_float_hr_cnt'])

    let constraintType: ConstraintType | null = null
    let constraintDate: string | null = null
    const cstr = t['cstr_type']
    if (cstr) {
      const mapped = constraintFromLabel(cstr)
      if (mapped === 'ALAP') warnings.push(`Activity ${t['task_code']}: As Late As Possible constraint is not modeled; ignored`)
      else if (mapped) {
        constraintType = mapped
        constraintDate = isoDatePrefix(t['cstr_date'])
        if (!constraintDate) warnings.push(`Activity ${t['task_code']}: constraint ${cstr} has no date; ignored`)
        if (!constraintDate) constraintType = null
      } else warnings.push(`Activity ${t['task_code']}: unrecognized constraint type "${cstr}"`)
    }
    if (t['cstr_type2']) warnings.push(`Activity ${t['task_code']}: secondary constraint ${t['cstr_type2']} ignored`)

    const a = makeActivity(scheduleId, {
      activityId: t['task_code'] || t['task_id'] || '',
      name: t['task_name'] || 'Unnamed Activity',
      wbs: wbsPath(t['wbs_id'] || ''),
      duration: hrs(t['target_drtn_hr_cnt']) ?? 0,
      remainingDuration: hrs(t['remain_drtn_hr_cnt']) ?? 0,
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
      isCritical: t['driving_path_flag'] === 'Y' || (tf !== null && tf <= 0 && status !== 'complete'),
      status,
      activityType,
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
      continue
    }
    const t = (p['pred_type'] || 'PR_FS').replace('PR_', '')
    const type: Relationship['type'] = t === 'SS' || t === 'FF' || t === 'SF' ? t : 'FS'
    // P6 lag is measured on the successor's calendar by default
    const lag = round2((parseFloat(p['lag_hr_cnt'] || '0') || 0) / hoursPerDay(succ.calendarId))
    relationships.push({ id: uuid(), scheduleId, predecessorId: pred.id, successorId: succ.id, type, lag })
  }

  return {
    projectName, dataDate, projectStart, projectFinish,
    activities, relationships, calendars, defaultCalendarId, warnings,
    sourceType: 'p6_xer',
  }
}

/* ─── table reader ────────────────────────────────────── */

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

function parseCalendarRow(c: Row, warnings: string[]): WorkCalendar {
  const tree = c['clndr_data'] ? parseClndrData(c['clndr_data']) : null
  const workDays: Weekday[] = []
  const dayHours: number[] = []
  const dow = findChild(tree, 'DaysOfWeek')
  if (dow) {
    for (const d of dow.children) {
      const n = parseInt(d.name, 10)
      if (!(n >= 1 && n <= 7)) continue
      if (d.children.length > 0) {
        workDays.push((n - 1) as Weekday)
        dayHours.push(intervalHours(d.children))
      }
    }
  } else {
    workDays.push(1, 2, 3, 4, 5)
    warnings.push(`Calendar "${c['clndr_name']}" has no DaysOfWeek data; assumed Mon–Fri`)
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
    }
  }
  holidays.sort()
  extraWorkDays.sort()

  const name = c['clndr_name'] || `Calendar ${c['clndr_id']}`
  return {
    id: c['clndr_id'],
    name,
    workDays,
    hoursPerDay,
    holidays,
    ...(extraWorkDays.length ? { extraWorkDays } : {}),
    sourceName: name,
  }
}
