// Spreadsheet schedule parser: .xlsx (exceljs) and .csv (built-in RFC 4180 reader).
// Real-world exports label columns inconsistently, so headers are matched through a synonym table.

import type { Activity, Relationship } from '@/lib/db'
import type { Weekday, WorkCalendar } from '@/lib/planning/types'
import ExcelJS from 'exceljs'
import { randomUUID as uuid } from 'crypto'
import {
  ParsedSchedule, makeActivity, isoFromUtcDate, serialToIso, round2, constraintFromLabel,
} from './types'

type Cell = string | number | boolean | Date | null

/* ─── CSV ───────────────────────────────────────────────── */

/** RFC 4180 CSV reader: quoted fields, "" escapes, embedded newlines, CRLF/LF, BOM. Auto-detects , ; or tab. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const delim = detectDelimiter(src)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += ch; i++; continue
    }
    if (ch === '"' && field === '') { inQuotes = true; i++; continue }
    if (ch === delim) { row.push(field); field = ''; i++; continue }
    if (ch === '\r' || ch === '\n') {
      row.push(field); rows.push(row); row = []; field = ''
      i += ch === '\r' && src[i + 1] === '\n' ? 2 : 1
      continue
    }
    field += ch; i++
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

function detectDelimiter(src: string): string {
  // Count candidate delimiters outside quotes over the first ~20 lines
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 }
  let inQ = false
  let lines = 0
  for (let i = 0; i < src.length && lines < 20; i++) {
    const c = src[i]
    if (c === '"') inQ = !inQ
    else if (!inQ && c === '\n') lines++
    else if (!inQ && c in counts) counts[c]++
  }
  const [best, n] = Object.entries(counts).sort((x, y) => y[1] - x[1])[0]
  return n > 0 ? best : ','
}

/* ─── header synonyms ───────────────────────────────────── */

type Field =
  | 'code' | 'name' | 'duration' | 'remaining' | 'start' | 'finish' | 'lateStart' | 'lateFinish'
  | 'actualStart' | 'actualFinish' | 'baselineStart' | 'baselineFinish' | 'totalFloat' | 'freeFloat'
  | 'pct' | 'wbs' | 'calendar' | 'preds' | 'succs' | 'type' | 'constraint' | 'constraintDate'
  | 'critical' | 'status' | 'milestone' | 'category'

const SYNONYMS: Record<Field, string[]> = {
  code: ['activityid', 'taskid', 'id', 'actid', 'code', 'activitycode', 'taskcode', 'actcode', 'activitynumber', 'activityno', 'tasknumber'],
  name: ['activityname', 'taskname', 'name', 'description', 'activitydescription', 'taskdescription', 'activity', 'task', 'actname'],
  duration: ['originalduration', 'duration', 'od', 'dur', 'durationdays', 'origdur', 'origduration', 'plannedduration', 'originaldur', 'baselineduration'],
  remaining: ['remainingduration', 'rd', 'remdur', 'remainingdur', 'remduration'],
  start: ['start', 'earlystart', 'es', 'plannedstart', 'startdate', 'scheduledstart', 'begin'],
  finish: ['finish', 'earlyfinish', 'ef', 'finishdate', 'plannedfinish', 'end', 'enddate', 'scheduledfinish'],
  lateStart: ['latestart', 'ls'],
  lateFinish: ['latefinish', 'lf'],
  actualStart: ['actualstart', 'as', 'actstart'],
  actualFinish: ['actualfinish', 'af', 'actfinish'],
  baselineStart: ['baselinestart', 'blstart', 'bl1start', 'baseline1start', 'blprojectstart', 'targetstart'],
  baselineFinish: ['baselinefinish', 'blfinish', 'bl1finish', 'baseline1finish', 'blprojectfinish', 'targetfinish'],
  totalFloat: ['totalfloat', 'tf', 'totalslack', 'float'],
  freeFloat: ['freefloat', 'ff', 'freeslack'],
  pct: ['pctcomplete', 'percentcomplete', 'physicalpctcomplete', 'activitypctcomplete', 'durationpctcomplete', 'pct', 'complete', 'progress', 'physicalpercentcomplete'],
  wbs: ['wbs', 'wbscode', 'wbspath', 'wbsname', 'outlinenumber'],
  calendar: ['calendar', 'calendarname', 'cal', 'taskcalendar', 'activitycalendar'],
  preds: ['predecessors', 'preds', 'predecessor', 'pred', 'predecessorlist'],
  succs: ['successors', 'succs', 'successor', 'succ', 'successorlist'],
  type: ['activitytype', 'type', 'tasktype', 'acttype'],
  constraint: ['constraint', 'primaryconstraint', 'constrainttype', 'primaryconstrainttype'],
  constraintDate: ['constraintdate', 'primaryconstraintdate'],
  critical: ['critical', 'iscritical', 'criticalpath'],
  status: ['activitystatus', 'status', 'taskstatus'],
  milestone: ['milestone', 'ismilestone'],
  category: ['category'],
}

const SYN_LOOKUP = new Map<string, Field>()
for (const [f, list] of Object.entries(SYNONYMS) as [Field, string[]][]) for (const s of list) SYN_LOOKUP.set(s, f)

function normHeader(h: string): string {
  return h.toLowerCase().replace(/%/g, 'pct').replace(/#/g, 'num').replace(/[^a-z0-9]/g, '')
}

function matchHeader(raw: string): Field | null {
  if (!raw.trim()) return null
  const a = SYN_LOOKUP.get(normHeader(raw))
  if (a) return a
  const noParen = raw.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
  return SYN_LOOKUP.get(normHeader(noParen)) ?? null
}

/* ─── value parsing ─────────────────────────────────────── */

function cellText(v: Cell): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return isoFromUtcDate(v) ?? ''
  return String(v).trim()
}

const DUR_UNITS: Record<string, number> = {
  '': 1, d: 1, dy: 1, dys: 1, day: 1, days: 1, wd: 1, wds: 1,
  h: 1 / 8, hr: 1 / 8, hrs: 1 / 8, hour: 1 / 8, hours: 1 / 8,
  w: 5, wk: 5, wks: 5, week: 5, weeks: 5,
  mo: 20, mon: 20, mons: 20, month: 20, months: 20,
  m: 1 / 480, min: 1 / 480, mins: 1 / 480, minute: 1 / 480, minutes: 1 / 480,
  ed: 1, eday: 1, edays: 1, eh: 1 / 24, ehr: 1 / 24, ew: 7, ewk: 7, emo: 30,
}

/** "10d" / "10" / "80h" (8h days) / "2w" / "1.5 days" / "-3d" → work days. null if unparseable/blank. */
export function parseDurationDays(v: Cell): number | null {
  if (v === null || v === undefined || v instanceof Date || typeof v === 'boolean') return null
  if (typeof v === 'number') return isFinite(v) ? v : null
  const s = v.trim().toLowerCase().replace(/[?,]/g, '').replace(/\s+/g, ' ')
  if (!s) return null
  const m = s.match(/^([+-]?\s*\d+(?:\.\d+)?)\s*([a-z]*)\.?$/)
  if (!m) return null
  const unit = DUR_UNITS[m[2]]
  if (unit === undefined) return null
  return round2(parseFloat(m[1].replace(/\s/g, '')) * unit)
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

function ymd(y: number, m: number, d: number): string | null {
  if (y < 100) y += y < 70 ? 2000 : 1900
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return isoFromUtcDate(dt)
}

/** Excel Date cells, serial numbers, ISO, US m/d/yyyy, "01-Mar-26" (P6), "Mon 3/2/26" (MSP), "March 2, 2026". */
export function parseDateCell(v: Cell): string | null {
  if (v === null || v === undefined || typeof v === 'boolean') return null
  if (v instanceof Date) return isoFromUtcDate(v)
  if (typeof v === 'number') return v > 20000 && v < 80000 ? serialToIso(v) : null
  let s = v.trim()
  if (!s || /^(n\/?a|-+|none)$/i.test(s)) return null
  s = s.replace(/\s+A$/, '').replace(/\*+$/, '').trim() // P6 "A" = actual, "*" = constrained
  s = s.replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i, '')
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (m) return ymd(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/)
  if (m) return ymd(+m[3], +m[1], +m[2])
  m = s.match(/^(\d{1,2})[-\s]([a-z]{3})[a-z]*\.?[-\s,]+(\d{2,4})\b/i)
  if (m && MONTHS[m[2].toLowerCase()]) return ymd(+m[3], MONTHS[m[2].toLowerCase()], +m[1])
  m = s.match(/^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{2,4})\b/i)
  if (m && MONTHS[m[1].toLowerCase()]) return ymd(+m[3], MONTHS[m[1].toLowerCase()], +m[2])
  if (/^\d{5}(\.\d+)?$/.test(s)) return parseDateCell(parseFloat(s))
  return null
}

function truthy(v: Cell): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  return /^(y|yes|true|1|x|critical)$/i.test(cellText(v))
}

function parseTypeLabel(v: string): Activity['activityType'] | null {
  const n = v.toLowerCase().replace(/[^a-z]/g, '')
  if (!n) return null
  if (n.includes('mile')) return 'milestone'
  if (n === 'loe' || n.includes('levelofeffort') || n === 'ttloe') return 'loe'
  if (n.includes('summary') || n === 'ttwbs' || n.includes('hammock')) return 'summary'
  return 'task'
}

function parseStatusLabel(v: string): Activity['status'] | null {
  const n = v.toLowerCase().replace(/[^a-z]/g, '')
  if (!n) return null
  if (n.startsWith('complete') || n === 'done' || n === 'tkcomplete') return 'complete'
  if (n.includes('progress') || n === 'active' || n === 'started' || n === 'tkactive') return 'in_progress'
  if (n.includes('notstarted') || n === 'planned' || n === 'tknotstart') return 'not_started'
  return null
}

/* ─── predecessor tokens ────────────────────────────────── */

interface PredRef { ref: string; type: Relationship['type']; lag: number }

/** Candidate interpretations of one predecessor token, most specific first. */
export function predCandidates(token: string): PredRef[] {
  const t = token.trim()
  if (!t) return []
  const out: PredRef[] = []
  const T = (s: string) => s.toUpperCase() as Relationship['type']
  const lagOf = (num: string, unit: string) => parseDurationDays(`${num.replace(/\s/g, '')}${unit.toLowerCase()}`) ?? 0
  // "A1010 SS 5d" / "A1010: FF 2" (P6 style, unsigned lag after the type)
  let m = t.match(/^(.*?)[\s:,]*\b(FS|SS|FF|SF)[\s:]+([+-]?\s*\d+(?:\.\d+)?)\s*([a-z]*)$/i)
  if (m && m[1]) out.push({ ref: m[1].trim(), type: T(m[2]), lag: lagOf(m[3], m[4]) })
  // "12FS+3d" / "12SS-2 days" / "12+3d" (MSP style)
  m = t.match(/^(.*?)\s*(FS|SS|FF|SF)?\s*([+-]\s*\d+(?:\.\d+)?)\s*([a-z]*)\??$/i)
  if (m && m[1]) out.push({ ref: m[1].replace(/[\s:]+$/, '').trim(), type: m[2] ? T(m[2]) : 'FS', lag: lagOf(m[3], m[4]) })
  // "14SS" / "A1000 SS" / "A1000: FF"
  m = t.match(/^(.*?)[\s:,]*(FS|SS|FF|SF)$/i)
  if (m && m[1]) out.push({ ref: m[1].trim(), type: T(m[2]), lag: 0 })
  out.push({ ref: t, type: 'FS', lag: 0 })
  return out
}

function splitList(v: string): string[] {
  return v.split(/[,;\n\r]+/).map(s => s.trim()).filter(Boolean)
}

/* ─── calendars from names ──────────────────────────────── */

function inferCalendar(name: string): WorkCalendar {
  const n = name.toLowerCase()
  let workDays: Weekday[] = [1, 2, 3, 4, 5]
  if (/\b7\s*-?\s*d(ay)?\b|seven|24\s*\/\s*7/.test(n)) workDays = [0, 1, 2, 3, 4, 5, 6]
  else if (/\b6\s*-?\s*d(ay)?\b|six/.test(n)) workDays = [1, 2, 3, 4, 5, 6]
  else if (/\b4\s*-?\s*d(ay)?\b|four/.test(n)) workDays = [1, 2, 3, 4]
  const h = n.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour)/)
  const hoursPerDay = h ? parseFloat(h[1]) : /24\s*\/\s*7/.test(n) ? 24 : 8
  return { id: name, name, workDays, hoursPerDay, holidays: [], sourceName: name }
}

/* ─── grid loading ──────────────────────────────────────── */

function normalizeExcelValue(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (v instanceof Date) return v
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>
    if ('result' in o) return normalizeExcelValue(o.result as ExcelJS.CellValue)
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map(r => r.text).join('')
    if ('text' in o && typeof o.text === 'string') return o.text
    if ('error' in o) return null
  }
  return String(v)
}

async function loadSheets(buffer: Buffer, isCsv: boolean): Promise<{ name: string; grid: Cell[][] }[]> {
  if (isCsv) {
    let text: string
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer) } catch { text = buffer.toString('latin1') }
    return [{ name: 'CSV', grid: parseCsv(text) }]
  }
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as unknown as ArrayBuffer)
  const sheets: { name: string; grid: Cell[][] }[] = []
  wb.eachSheet(ws => {
    const grid: Cell[][] = []
    const rows = Math.min(ws.rowCount, 50000)
    const cols = Math.min(ws.columnCount, 200)
    for (let r = 1; r <= rows; r++) {
      const row = ws.getRow(r)
      const out: Cell[] = []
      for (let c = 1; c <= cols; c++) out.push(normalizeExcelValue(row.getCell(c).value))
      grid.push(out)
    }
    sheets.push({ name: ws.name, grid })
  })
  return sheets
}

interface HeaderInfo { row: number; fields: Map<Field, number>; unrecognized: string[]; duplicates: string[] }

function detectHeader(grid: Cell[][]): HeaderInfo | null {
  let best: HeaderInfo | null = null
  let bestScore = 0
  for (let r = 0; r < Math.min(15, grid.length); r++) {
    const fields = new Map<Field, number>()
    const unrecognized: string[] = []
    const duplicates: string[] = []
    grid[r].forEach((c, i) => {
      const txt = cellText(c)
      if (!txt) return
      const f = matchHeader(txt)
      if (!f) unrecognized.push(txt)
      else if (fields.has(f)) duplicates.push(txt)
      else fields.set(f, i)
    })
    const score = fields.size
    if (score > bestScore && score >= 2 && (fields.has('name') || fields.has('code'))) {
      best = { row: r, fields, unrecognized, duplicates }
      bestScore = score
    }
  }
  return best
}

/* ─── main ──────────────────────────────────────────────── */

export async function parseSpreadsheet(buffer: Buffer, fileName: string, scheduleId: string): Promise<ParsedSchedule> {
  const isCsv = /\.(csv|tsv|txt)$/i.test(fileName)
  const sheets = await loadSheets(buffer, isCsv)
  const warnings: string[] = []

  let sheet: { name: string; grid: Cell[][] } | null = null
  let header: HeaderInfo | null = null
  for (const s of sheets) {
    const h = detectHeader(s.grid)
    if (h) { sheet = s; header = h; break }
  }
  if (!sheet || !header) {
    throw new Error('No schedule table found: expected a header row (within the first 15 rows) with columns such as "Activity ID", "Activity Name", "Duration", "Start", "Finish"')
  }
  if (!isCsv && sheets.length > 1) warnings.push(`Read worksheet "${sheet.name}" (workbook has ${sheets.length} sheets)`)
  if (header.unrecognized.length) warnings.push(`Unrecognized columns ignored: ${header.unrecognized.join(', ')}`)
  if (header.duplicates.length) warnings.push(`Duplicate columns ignored (an earlier column already supplies the field): ${header.duplicates.join(', ')}`)

  const F = header.fields
  const get = (row: Cell[], f: Field): Cell => (F.has(f) ? row[F.get(f)!] ?? null : null)
  const txt = (row: Cell[], f: Field) => cellText(get(row, f))

  // Percent columns may hold fractions (0.5) when formatted as % in Excel
  const dataRows = sheet.grid.slice(header.row + 1)
  let pctIsFraction = false
  if (F.has('pct')) {
    const nums = dataRows.map(r => get(r, 'pct')).filter((v): v is number => typeof v === 'number')
    pctIsFraction = nums.length > 0 && nums.every(n => n <= 1) && nums.some(n => n > 0)
  }
  const parsePct = (v: Cell): number => {
    if (typeof v === 'number') return pctIsFraction ? round2(v * 100) : v
    const n = parseFloat(cellText(v).replace('%', ''))
    return isNaN(n) ? 0 : n
  }

  const headerTexts = new Set(sheet.grid[header.row].map(c => normHeader(cellText(c))))
  const activities: Activity[] = []
  const rawPreds: { act: Activity; preds: string; succs: string; row: number }[] = []
  const calendars = new Map<string, WorkCalendar>()
  let group = ''
  let computedDurations = 0

  dataRows.forEach((row, idx) => {
    const rowNum = header!.row + idx + 2 // 1-based sheet row
    const code = txt(row, 'code')
    const name = txt(row, 'name')
    if (!code && !name) return
    if (headerTexts.has(normHeader(code || name)) && matchHeader(code || name)) return // repeated header row
    const durCell = get(row, 'duration')
    const start = parseDateCell(get(row, 'start'))
    const finish = parseDateCell(get(row, 'finish'))
    // WBS band / grouping row (P6 & MSP exports): a label with no id, duration or dates
    if (F.has('code') && !code && cellText(durCell) === '' && !start && !finish) { group = name; return }
    // Outline/summary row (MS Project "Outline Level" sheets number every row): no duration, dates or logic.
    if (F.has('duration') && cellText(durCell) === '' && !start && !finish && !txt(row, 'preds') && !txt(row, 'succs')) { group = name; return }

    let duration = parseDurationDays(durCell)
    if (duration === null && !F.has('duration') && start && finish) {
      duration = weekdaysBetween(start, finish)
      computedDurations++
    }
    const typeLabel = parseTypeLabel(txt(row, 'type'))
    const pct = parsePct(get(row, 'pct'))
    // P6 exports mark actual dates in the Start/Finish columns with a trailing " A"
    const actualMark = (c: Cell) => typeof c === 'string' && /\s+A\s*$/.test(c)
    const actualStart = parseDateCell(get(row, 'actualStart')) ?? (actualMark(get(row, 'start')) ? start : null)
    const actualFinish = parseDateCell(get(row, 'actualFinish')) ?? (actualMark(get(row, 'finish')) ? finish : null)
    let status: Activity['status'] = parseStatusLabel(txt(row, 'status')) ?? 'not_started'
    if (actualFinish || pct >= 100) status = 'complete'
    else if (status === 'not_started' && (actualStart || pct > 0)) status = 'in_progress'

    let activityType: Activity['activityType'] = typeLabel ?? 'task'
    if (F.has('milestone') && truthy(get(row, 'milestone'))) activityType = 'milestone'
    if (activityType === 'task' && duration === 0) activityType = 'milestone'

    const tf = parseDurationDays(get(row, 'totalFloat'))
    const ff = parseDurationDays(get(row, 'freeFloat'))
    const rd = parseDurationDays(get(row, 'remaining'))
    const isCritical = F.has('critical')
      ? truthy(get(row, 'critical'))
      : tf !== null && tf <= 0 && status !== 'complete'

    const cLabel = txt(row, 'constraint')
    const cType = constraintFromLabel(cLabel)
    const cDate = parseDateCell(get(row, 'constraintDate'))
    let constraintType: string | null = null
    let constraintDate: string | null = null
    if (cType === 'ALAP') warnings.push(`Row ${rowNum}: As Late As Possible constraint ignored`)
    else if (cType && cDate) { constraintType = cType; constraintDate = cDate }
    else if (cType) warnings.push(`Row ${rowNum}: constraint "${cLabel}" has no date; ignored`)
    else if (cLabel && !/^(none|asap|as soon as possible)$/i.test(cLabel)) warnings.push(`Row ${rowNum}: unrecognized constraint "${cLabel}"`)

    const calName = txt(row, 'calendar')
    if (calName && !calendars.has(calName)) calendars.set(calName, inferCalendar(calName))

    const act = makeActivity(scheduleId, {
      activityId: code || String(activities.length + 1),
      name: name || code,
      wbs: txt(row, 'wbs') || group,
      duration: duration ?? 0,
      remainingDuration: rd ?? (status === 'complete' ? 0 : duration ?? 0),
      percentComplete: pct,
      earlyStart: start,
      earlyFinish: finish,
      lateStart: parseDateCell(get(row, 'lateStart')),
      lateFinish: parseDateCell(get(row, 'lateFinish')),
      actualStart,
      actualFinish,
      baselineStart: parseDateCell(get(row, 'baselineStart')),
      baselineFinish: parseDateCell(get(row, 'baselineFinish')),
      totalFloat: tf ?? 0,
      freeFloat: ff ?? 0,
      isCritical,
      status,
      activityType,
      calendarId: calName || null,
      constraintType,
      constraintDate,
      category: txt(row, 'category') || null,
      sourceId: code || String(activities.length + 1),
    })
    activities.push(act)
    rawPreds.push({ act, preds: txt(row, 'preds'), succs: txt(row, 'succs'), row: rowNum })
  })

  if (computedDurations) warnings.push(`No duration column: ${computedDurations} durations computed as Mon–Fri days between Start and Finish`)
  if (calendars.size) warnings.push(`Calendar definitions inferred from names only (${Array.from(calendars.keys()).join(', ')}); verify work days, hours and holidays`)

  /* resolve logic */
  const byCode = new Map<string, Activity>()
  const byCodeLower = new Map<string, Activity>()
  for (const a of activities) {
    if (!byCode.has(a.activityId)) byCode.set(a.activityId, a)
    if (!byCodeLower.has(a.activityId.toLowerCase())) byCodeLower.set(a.activityId.toLowerCase(), a)
  }
  const resolve = (ref: string): Activity | undefined => {
    const r = ref.trim()
    const hit = byCode.get(r) ?? byCodeLower.get(r.toLowerCase())
    if (hit) return hit
    if (!F.has('code') && /^\d+$/.test(r)) return activities[parseInt(r, 10) - 1]
    return undefined
  }
  const relationships: Relationship[] = []
  const seen = new Set<string>()
  const unresolved: string[] = []
  const addLinks = (self: Activity, list: string, dir: 'pred' | 'succ', row: number) => {
    for (const token of splitList(list)) {
      let done = false
      for (const cand of predCandidates(token)) {
        const other = resolve(cand.ref)
        if (!other) continue
        done = true
        if (other === self) { warnings.push(`Row ${row}: ${self.activityId} references itself ("${token}"); skipped`); break }
        const [p, s] = dir === 'pred' ? [other, self] : [self, other]
        const key = `${p.id}|${s.id}|${cand.type}`
        if (!seen.has(key)) {
          seen.add(key)
          relationships.push({ id: uuid(), scheduleId, predecessorId: p.id, successorId: s.id, type: cand.type, lag: cand.lag })
        }
        break
      }
      if (!done) unresolved.push(`row ${row} ${self.activityId}: ${dir === 'pred' ? 'predecessor' : 'successor'} "${token}"`)
    }
  }
  for (const r of rawPreds) {
    if (r.preds) addLinks(r.act, r.preds, 'pred', r.row)
    if (r.succs) addLinks(r.act, r.succs, 'succ', r.row)
  }
  if (unresolved.length) warnings.push(`Unresolved logic references (${unresolved.length}): ${unresolved.slice(0, 50).join('; ')}${unresolved.length > 50 ? '; …' : ''}`)
  if (!F.has('preds') && !F.has('succs')) warnings.push('No Predecessors/Successors column: the spreadsheet carries no logic')

  const starts = activities.map(a => a.actualStart || a.earlyStart).filter((d): d is string => !!d).sort()
  const finishes = activities.map(a => a.actualFinish || a.earlyFinish).filter((d): d is string => !!d).sort()
  const calList = Array.from(calendars.values())
  const baseName = fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')

  return {
    projectName: baseName || sheet.name || 'Imported Schedule',
    dataDate: null,
    projectStart: starts[0] ?? null,
    projectFinish: finishes[finishes.length - 1] ?? null,
    activities,
    relationships,
    calendars: calList,
    defaultCalendarId: calList.length ? mostCommonCalendar(activities) : null,
    warnings,
    sourceType: isCsv ? 'csv' : 'excel',
  }
}

function mostCommonCalendar(acts: Activity[]): string | null {
  const counts = new Map<string, number>()
  for (const a of acts) if (a.calendarId) counts.set(a.calendarId, (counts.get(a.calendarId) ?? 0) + 1)
  let best: string | null = null
  let n = 0
  for (const [k, v] of Array.from(counts.entries())) if (v > n) { best = k; n = v }
  return best
}

/** Inclusive Mon–Fri count between two ISO dates. */
function weekdaysBetween(a: string, b: string): number {
  const s = Date.parse(a + 'T00:00:00Z')
  const e = Date.parse(b + 'T00:00:00Z')
  if (isNaN(s) || isNaN(e) || e < s) return 0
  let n = 0
  for (let t = s; t <= e; t += 86400000) {
    const wd = new Date(t).getUTCDay()
    if (wd !== 0 && wd !== 6) n++
  }
  return n
}
