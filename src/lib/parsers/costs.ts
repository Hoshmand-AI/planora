// Cost data for earned value (src/lib/analysis/evm.ts), read from the ORIGINAL uploaded file.
//
// The schedule parsers do not keep cost fields on activities (they model time, not money), and the
// original file of every upload is stored with its SHA-256. Earned value therefore reads costs from
// that stored file on demand, the way DCMA #10 reads P6 resource assignments, so no schema or parser
// change is needed and older uploads gain earned value without re-importing.
//
// What is read (nothing is estimated or defaulted from schedule-only data):
//   P6 XER      TASKRSRC target_cost (budget), act_reg_cost + act_ot_cost (actual), remain_cost;
//               PROJCOST (expenses) target_cost / act_cost / remain_cost; TASK complete_pct_type with
//               phys_complete_pct, durations or units for the percent EV earns; PROJECT ev_compute_type;
//               the base currency from CURRTYPE. Budgets are also kept per project and activity code,
//               so the P6 project baseline embedded in the same XER supplies its own budget.
//   MS Project  Task Cost / ActualCost / RemainingCost / BCWS / BCWP / ACWP, Baseline (number 0) Cost,
//   XML         PercentComplete / PhysicalPercentComplete with EarnedValueMethod; Assignment costs when
//               a task carries none. MSPDI writes currency in hundredths (cents); values are divided by
//               100. Summary tasks are skipped: their cost is the roll-up of their children.
//   Excel / CSV Columns such as "Budget" / "BAC" / "Budgeted cost", "Baseline cost", "Actual cost" /
//               "ACWP", "Remaining cost", "BCWS" / "Planned value", "BCWP" / "Earned value".
// Records are keyed by the activity's source id (P6 task_id, MSP UID, spreadsheet activity code), the
// same key the parsers store in Activity.sourceId.

import { readXerTables } from './xer-parser'
import { parseCsv } from './excel-parser'

export type CostSourceKind = 'p6_xer' | 'ms_xml' | 'excel'

/** How an activity's percent complete is earned (EV = budget × percent). */
export type EvPercentType = 'physical' | 'duration' | 'units' | 'zero_hundred' | 'fifty_fifty' | 'file_percent'

export interface ActivityCostRecord {
  /** Activity code (P6 task_code, MSP code/ID) when the extractor knows it */
  code?: string | null
  /** The file's planned budget at completion for the activity (P6 budgeted cost; MSP Cost; sheet Budget) */
  budget: number | null
  /** The file's own saved baseline cost (MSP Baseline Cost; sheet Baseline cost); null in P6 */
  baselineBudget: number | null
  actualCost: number | null
  remainingCost: number | null
  /** Earned-value figures the file itself carries (MSP / sheet), kept for reference and PV when stated */
  fileBcws: number | null
  fileBcwp: number | null
  fileAcwp: number | null
  /** Percent (0–100) EV earns on, per evPercentType; null = use the activity's percent complete */
  evPercent: number | null
  evPercentType: EvPercentType | null
}

export interface CostData {
  kind: CostSourceKind
  /** Keyed by Activity.sourceId */
  bySource: Record<string, ActivityCostRecord>
  /** P6: budgeted cost per project id and activity code (for an embedded P6 project baseline) */
  budgetByProjectCode?: Record<string, Record<string, number>>
  /** Which cost fields the file carries at all */
  fields: { budget: boolean; baselineBudget: boolean; actualCost: boolean; remainingCost: boolean; fileBcws: boolean; fileBcwp: boolean }
  currency: { code: string | null; symbol: string | null }
  /** How percent complete is earned, in words */
  evMethod: string
  notes: string[]
}

const num = (v: string | undefined | null): number | null => {
  if (v == null) return null
  const s = String(v).trim()
  if (!s) return null
  const n = parseFloat(s)
  return isFinite(n) ? n : null
}
const add = (a: number | null, b: number | null): number | null => (a == null && b == null ? null : (a ?? 0) + (b ?? 0))
const clampPct = (n: number) => Math.max(0, Math.min(100, n))
const round2 = (n: number) => Math.round(n * 100) / 100

/* ─── P6 XER ─────────────────────────────────────────────── */

export function xerCostData(content: string): CostData | null {
  const t = readXerTables(content)
  const rsrc = t['TASKRSRC'] || []
  const exp = t['PROJCOST'] || []
  if (!t['TASKRSRC'] && !t['PROJCOST']) return null
  const tasks = t['TASK'] || []
  const notes: string[] = []
  const projects = t['PROJECT'] || []
  const evCompute = (projects.find(p => !p['orig_proj_id']) ?? projects[0] ?? {})['ev_compute_type'] || ''
  const technique: EvPercentType | null = evCompute === 'EC_0_100' ? 'zero_hundred' : evCompute === 'EC_50_50' ? 'fifty_fifty' : null
  if (evCompute && !['EC_Cmp_pct', 'EC_0_100', 'EC_50_50'].includes(evCompute)) notes.push(`The project's P6 earned value technique (${evCompute}) is not modeled; activity percent complete is used.`)

  const bySource: Record<string, ActivityCostRecord> = {}
  const byTask = new Map(tasks.map(x => [x['task_id'], x]))
  const sums = new Map<string, { budget: number | null; actual: number | null; remaining: number | null }>()
  const sumInto = (taskId: string, budget: number | null, actual: number | null, remaining: number | null) => {
    const s = sums.get(taskId) ?? { budget: null, actual: null, remaining: null }
    s.budget = add(s.budget, budget); s.actual = add(s.actual, actual); s.remaining = add(s.remaining, remaining)
    sums.set(taskId, s)
  }
  const hasActualCol = rsrc.some(r => 'act_reg_cost' in r) || exp.some(r => 'act_cost' in r)
  const hasRemainCol = rsrc.some(r => 'remain_cost' in r) || exp.some(r => 'remain_cost' in r)
  for (const r of rsrc) if (r['task_id']) sumInto(r['task_id'], num(r['target_cost']) ?? 0, add(num(r['act_reg_cost']), num(r['act_ot_cost'])), num(r['remain_cost']))
  for (const r of exp) if (r['task_id']) sumInto(r['task_id'], num(r['target_cost']) ?? 0, num(r['act_cost']), num(r['remain_cost']))

  const budgetByProjectCode: Record<string, Record<string, number>> = {}
  for (const task of tasks) {
    const id = task['task_id']
    if (!id) continue
    const s = sums.get(id)
    const budget = s?.budget ?? 0
    const pid = task['proj_id'] || ''
    if (task['task_code']) (budgetByProjectCode[pid] ??= {})[task['task_code']] = round2(budget)
    const complete = task['status_code'] === 'TK_Complete'
    const started = complete || task['status_code'] === 'TK_Active' || !!task['act_start_date']
    let evPercent: number | null
    let evPercentType: EvPercentType
    if (technique === 'zero_hundred') { evPercentType = 'zero_hundred'; evPercent = complete ? 100 : 0 }
    else if (technique === 'fifty_fifty') { evPercentType = 'fifty_fifty'; evPercent = complete ? 100 : started ? 50 : 0 }
    else if (task['complete_pct_type'] === 'CP_Drtn') {
      evPercentType = 'duration'
      const od = num(task['target_drtn_hr_cnt']) ?? 0, rd = num(task['remain_drtn_hr_cnt']) ?? od
      evPercent = complete ? 100 : od > 0 ? clampPct((100 * (od - rd)) / od) : 0
    } else if (task['complete_pct_type'] === 'CP_Units') {
      evPercentType = 'units'
      const act = (num(task['act_work_qty']) ?? 0) + (num(task['act_equip_qty']) ?? 0)
      const rem = (num(task['remain_work_qty']) ?? 0) + (num(task['remain_equip_qty']) ?? 0)
      evPercent = complete ? 100 : act + rem > 0 ? clampPct((100 * act) / (act + rem)) : 0
    } else {
      evPercentType = 'physical'
      evPercent = complete ? 100 : clampPct(num(task['phys_complete_pct']) ?? 0)
    }
    bySource[id] = {
      code: task['task_code'] || null,
      budget: round2(budget), baselineBudget: null,
      actualCost: hasActualCol ? round2(s?.actual ?? 0) : null,
      remainingCost: hasRemainCol ? round2(s?.remaining ?? 0) : null,
      fileBcws: null, fileBcwp: null, fileAcwp: null,
      evPercent: round2(evPercent), evPercentType,
    }
  }
  const orphans = [...sums.keys()].filter(k => !byTask.has(k)).length
  if (orphans) notes.push(`${orphans} resource assignment or expense row${orphans === 1 ? '' : 's'} reference an activity not in the file and are left out.`)
  const curr = (t['CURRTYPE'] || []).find(c => num(c['base_exch_rate']) === 1) ?? (t['CURRTYPE'] || [])[0]
  return {
    kind: 'p6_xer', bySource, budgetByProjectCode,
    fields: { budget: true, baselineBudget: false, actualCost: hasActualCol, remainingCost: hasRemainCol, fileBcws: false, fileBcwp: false },
    currency: { code: curr?.['curr_short_name'] || null, symbol: curr?.['curr_symbol'] || null },
    evMethod: technique === 'zero_hundred' ? 'P6 0/100 technique: an activity earns its budget only when complete.'
      : technique === 'fifty_fifty' ? 'P6 50/50 technique: half the budget at the actual start, the rest at completion.'
      : "Each activity's P6 percent complete type: physical % complete (CP_Phys), duration % complete (CP_Drtn: (original − remaining) ÷ original duration) or units % complete (CP_Units: actual ÷ at-completion units).",
    notes,
  }
}

/* ─── MS Project XML ─────────────────────────────────────── */

function blocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g')
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) out.push(m[1])
  return out
}
function first(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`))
  return m ? m[1] : null
}
function strip(xml: string, tags: string[]): string {
  let out = xml
  for (const t of tags) out = out.replace(new RegExp(`<${t}(?:\\s[^>]*)?>[\\s\\S]*?</${t}>`, 'g'), '')
  return out
}
function text(xml: string, tag: string): string | null {
  const b = first(xml, tag)
  return b === null ? null : b.trim()
}
/** MSPDI currency: hundredths (cents) of the project currency. */
const money = (v: string | null): number | null => { const n = num(v); return n == null ? null : round2(n / 100) }

export function mspCostData(content: string): CostData | null {
  const xml = content.replace(/^﻿/, '')
  const header = strip(xml, ['Calendars', 'Tasks', 'Resources', 'Assignments', 'ExtendedAttributes', 'OutlineCodes', 'WBSMasks', 'Views', 'Filters', 'Groups', 'Tables', 'Maps', 'Reports'])
  const defaultMethod = text(header, 'DefaultTaskEVMethod')
  const tasks = blocks(first(xml, 'Tasks') || '', 'Task')
  const assignmentCost = new Map<string, { cost: number | null; actual: number | null; remaining: number | null; baseline: number | null }>()
  for (const a of blocks(first(xml, 'Assignments') || '', 'Assignment')) {
    const own = strip(a, ['Baseline', 'TimephasedData', 'ExtendedAttribute'])
    const uid = text(own, 'TaskUID')
    if (!uid) continue
    const bl = blocks(a, 'Baseline').find(b => text(b, 'Number') === '0')
    const cur = assignmentCost.get(uid) ?? { cost: null, actual: null, remaining: null, baseline: null }
    cur.cost = add(cur.cost, money(text(own, 'Cost')))
    cur.actual = add(cur.actual, money(text(own, 'ActualCost')))
    cur.remaining = add(cur.remaining, money(text(own, 'RemainingCost')))
    cur.baseline = add(cur.baseline, bl ? money(text(bl, 'Cost')) : null)
    assignmentCost.set(uid, cur)
  }
  const bySource: Record<string, ActivityCostRecord> = {}
  const fields = { budget: false, baselineBudget: false, actualCost: false, remainingCost: false, fileBcws: false, fileBcwp: false }
  let physical = 0, pctComplete = 0
  for (const block of tasks) {
    const own = strip(block, ['PredecessorLink', 'ExtendedAttribute', 'Baseline', 'TimephasedData'])
    const uid = text(own, 'UID')
    if (!uid || uid === '0' || text(own, 'OutlineLevel') === '0' || text(own, 'IsNull') === '1' || text(own, 'Summary') === '1') continue
    const asg = assignmentCost.get(uid)
    const bl = blocks(block, 'Baseline').find(b => text(b, 'Number') === '0')
    const cost = money(text(own, 'Cost')) ?? asg?.cost ?? null
    const actual = money(text(own, 'ActualCost')) ?? asg?.actual ?? null
    const remaining = money(text(own, 'RemainingCost')) ?? asg?.remaining ?? null
    const baseline = (bl ? money(text(bl, 'Cost')) : null) ?? asg?.baseline ?? null
    const rec: ActivityCostRecord = {
      code: null, budget: cost, baselineBudget: baseline, actualCost: actual, remainingCost: remaining,
      fileBcws: money(text(own, 'BCWS')), fileBcwp: money(text(own, 'BCWP')), fileAcwp: money(text(own, 'ACWP')),
      evPercent: null, evPercentType: null,
    }
    // EarnedValueMethod 0 = % Complete, 1 = Physical % Complete (task value, else the project default).
    const method = text(own, 'EarnedValueMethod') ?? defaultMethod ?? '0'
    if (method === '1') { rec.evPercent = clampPct(num(text(own, 'PhysicalPercentComplete')) ?? 0); rec.evPercentType = 'physical'; physical++ }
    else { rec.evPercent = clampPct(num(text(own, 'PercentComplete')) ?? 0); rec.evPercentType = 'duration'; pctComplete++ }
    if (cost != null) fields.budget = true
    if (baseline != null) fields.baselineBudget = true
    if (actual != null) fields.actualCost = true
    if (remaining != null) fields.remainingCost = true
    if (rec.fileBcws != null) fields.fileBcws = true
    if (rec.fileBcwp != null) fields.fileBcwp = true
    bySource[uid] = rec
  }
  if (!fields.budget && !fields.baselineBudget && !fields.actualCost) return null
  return {
    kind: 'ms_xml', bySource, fields,
    currency: { code: text(header, 'CurrencyCode'), symbol: text(header, 'CurrencySymbol') },
    evMethod: physical && pctComplete ? "Each task's MS Project earned value method: Physical % Complete or % Complete (duration)."
      : physical ? 'MS Project earned value method Physical % Complete.' : 'MS Project earned value method % Complete (duration percent complete).',
    notes: [],
  }
}

/* ─── Excel / CSV ────────────────────────────────────────── */

type CostField = 'code' | 'budget' | 'baselineBudget' | 'actualCost' | 'remainingCost' | 'fileBcws' | 'fileBcwp'
const COST_SYNONYMS: Record<CostField, string[]> = {
  code: ['activityid', 'taskid', 'id', 'actid', 'code', 'activitycode', 'taskcode', 'actcode', 'activitynumber', 'activityno', 'tasknumber'],
  budget: ['budget', 'budgetedcost', 'bac', 'budgetatcompletion', 'budgetedtotalcost', 'plannedcost', 'plannedtotalcost', 'budgetcost', 'budgetamount'],
  baselineBudget: ['baselinecost', 'blcost', 'baseline1cost', 'baselinebudget', 'blbudget', 'baselinetotalcost', 'blprojecttotalcost'],
  actualCost: ['actualcost', 'actualcosts', 'actualtotalcost', 'acwp', 'actcost', 'actualcosttodate', 'costtodate'],
  remainingCost: ['remainingcost', 'remainingtotalcost', 'etc', 'costtocomplete'],
  fileBcws: ['bcws', 'plannedvalue', 'pv', 'plannedvaluecost'],
  fileBcwp: ['bcwp', 'earnedvalue', 'ev', 'earnedvaluecost'],
}
const COST_LOOKUP = new Map<string, CostField>()
for (const [f, list] of Object.entries(COST_SYNONYMS) as [CostField, string[]][]) for (const s of list) COST_LOOKUP.set(s, f)
const normH = (h: string) => h.toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/%/g, 'pct').replace(/[^a-z0-9]/g, '')

type Cell = string | number | boolean | Date | null
const cellStr = (v: Cell): string => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim())
/** "$1,234.50" / "(1,000)" / 1234.5 → number; null when blank or not a number. */
export function parseMoney(v: Cell): number | null {
  if (typeof v === 'number') return isFinite(v) ? v : null
  const s = cellStr(v)
  if (!s) return null
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s.replace(/[^\d.-]/g, ''))
  const n = parseFloat(s.replace(/[^\d.]/g, ''))
  return isFinite(n) ? (neg ? -n : n) : null
}

export function sheetCostData(grids: Cell[][][]): CostData | null {
  for (const grid of grids) {
    for (let r = 0; r < Math.min(15, grid.length); r++) {
      const cols = new Map<CostField, number>()
      grid[r].forEach((c, i) => { const f = COST_LOOKUP.get(normH(cellStr(c))); if (f && !cols.has(f)) cols.set(f, i) })
      if (!cols.has('code') || cols.size < 2) continue
      const fields = { budget: cols.has('budget'), baselineBudget: cols.has('baselineBudget'), actualCost: cols.has('actualCost'), remainingCost: cols.has('remainingCost'), fileBcws: cols.has('fileBcws'), fileBcwp: cols.has('fileBcwp') }
      if (!fields.budget && !fields.baselineBudget && !fields.actualCost) continue
      const get = (row: Cell[], f: CostField) => (cols.has(f) ? parseMoney(row[cols.get(f)!] ?? null) : null)
      const bySource: Record<string, ActivityCostRecord> = {}
      for (const row of grid.slice(r + 1)) {
        const code = cellStr(row[cols.get('code')!] ?? null)
        if (!code || bySource[code]) continue
        bySource[code] = {
          code, budget: get(row, 'budget'), baselineBudget: get(row, 'baselineBudget'), actualCost: get(row, 'actualCost'), remainingCost: get(row, 'remainingCost'),
          fileBcws: get(row, 'fileBcws'), fileBcwp: get(row, 'fileBcwp'), fileAcwp: null, evPercent: null, evPercentType: null,
        }
      }
      return { kind: 'excel', bySource, fields, currency: { code: null, symbol: null }, evMethod: "The sheet's percent complete column.", notes: [] }
    }
  }
  return null
}

/** Cost data from a stored original file; null when the format carries none (PDF, or no cost fields). */
export async function costDataFromFile(fileName: string, content: Buffer): Promise<CostData | null> {
  const ext = (fileName.toLowerCase().match(/\.[a-z0-9]+$/) || [''])[0]
  if (ext === '.xer') {
    const { decodeXer } = await import('./xer-codec')
    return xerCostData(decodeXer(content).text)
  }
  if (ext === '.xml') return mspCostData(new TextDecoder('utf-8').decode(content))
  if (ext === '.csv') {
    let s: string
    try { s = new TextDecoder('utf-8', { fatal: true }).decode(content) } catch { s = content.toString('latin1') }
    return sheetCostData([parseCsv(s)])
  }
  if (ext === '.xlsx' || ext === '.xlsm') {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(content as unknown as ArrayBuffer)
    const grids: Cell[][][] = []
    wb.eachSheet(ws => {
      const g: Cell[][] = []
      for (let r = 1; r <= Math.min(ws.rowCount, 50000); r++) {
        const row = ws.getRow(r)
        const out: Cell[] = []
        for (let c = 1; c <= Math.min(ws.columnCount, 200); c++) {
          const v = row.getCell(c).value as unknown
          out.push(v == null ? null : typeof v === 'object' && !(v instanceof Date) ? ((v as { result?: Cell; text?: string }).result ?? (v as { text?: string }).text ?? null) : (v as Cell))
        }
        g.push(out)
      }
      grids.push(g)
    })
    return sheetCostData(grids)
  }
  return null
}
