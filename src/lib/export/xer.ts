// Primavera P6 native export (.xer). Tab-delimited tables: CALENDAR, PROJECT, PROJWBS, TASK, TASKPRED
// (+ MEMOTYPE/TASKMEMO when activities carry override reasons).
// Dates use P6's "yyyy-mm-dd hh:mm" form; durations and lags are hours on each activity's calendar.
// Text is kept to Windows-1252 characters because P6 reads XER in the client code page; encode the
// result with encodeXer() from '@/lib/parsers/xer-codec' (the importer decodes with the same table).
//
// Two paths:
//  - exportXer: builds a new XER from a schedule (Planora plans, MS Project / Excel uploads).
//  - exportXerFromOriginal: for an uploaded P6 file, re-emits the original file row for row and only
//    replaces the dates and float Planora recalculated, so calendars (ids, names, work hours), percent
//    complete types, LOE activities, milestone types, WBS, baselines, activity codes, UDFs, resources,
//    cost accounts and notebooks survive the round trip untouched.

import type { CpmResult, GeneratedSchedule, LinkType, ConstraintType, ProgressMode, WorkCalendar } from '@/lib/planning/types'
import { buildWbs } from './wbs'
import { isCp1252 } from '@/lib/parsers/xer-codec'
import { readXerTables, xerCalendarTimes } from '@/lib/parsers/xer-parser'

const PRED: Record<LinkType, string> = { FS: 'PR_FS', SS: 'PR_SS', FF: 'PR_FF', SF: 'PR_SF' }
const CSTR: Record<ConstraintType, string> = { SNET: 'CS_MSOA', SNLT: 'CS_MSOB', FNET: 'CS_MEOA', FNLT: 'CS_MEOB', SO: 'CS_MSO', FO: 'CS_MEO', MSO: 'CS_MANDSTART', MFO: 'CS_MANDFIN' }

/** Characters P6 handles in XER (Windows-1252); others are replaced with ASCII equivalents or '?'. */
export function xerText(v: unknown): string {
  return Array.from(String(v ?? '')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/[≥]/g, '>=').replace(/[≤]/g, '<=').replace(/[→]/g, '->').replace(/[←]/g, '<-')
    .replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...'))
    .map(ch => (ch >= ' ' && ch !== '\x7f' && !(ch >= '\x80' && ch < '\xa0') && isCp1252(ch) ? ch : '?'))
    .join('')
}

/** P6 limits activity names to 120 characters. */
export const P6_NAME_MAX = 120

const dt = (d: string | null | undefined, time: string) => (d ? `${d.slice(0, 10)} ${time}` : '')
/** Finish time of day for a calendar: 08:00 start, its work hours, plus a lunch hour on 8h+ days. */
const finishTime = (hours: number) => {
  const end = 8 + hours + (hours >= 8 ? 1 : 0)
  return end >= 24 ? '23:59' : `${String(Math.floor(end)).padStart(2, '0')}:${String(Math.round((end % 1) * 60)).padStart(2, '0')}`
}
/**
 * P6 project ID (proj_short_name, 40 characters max): the project's own name, cut at a word boundary
 * when it is longer. Characters P6 rejects in IDs (quotes, '|', backslash) are dropped.
 */
export function projShortName(name: string): string {
  const clean = xerText(name).replace(/["'|\\]/g, '').replace(/\s+/g, ' ').trim()
  if (clean.length <= 40) return clean || 'PLANORA'
  const cut = clean.slice(0, 41)
  const atWord = cut.lastIndexOf(' ')
  return (atWord >= 20 ? cut.slice(0, atWord) : clean.slice(0, 40)).trim()
}

/** Excel serial day number used by P6 calendar exceptions (days since 1899-12-30). */
function serial(iso: string): number {
  return Math.round((Date.parse(iso + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86_400_000)
}

function hhmm(h: number): string {
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60)
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/** P6 clndr_data: working days 1=Sunday..7=Saturday with time intervals; exceptions are holidays. */
export function clndrData(c: WorkCalendar): string {
  const lunch = c.hoursPerDay > 6
  const first = lunch ? 4 : c.hoursPerDay
  const day = (d: number) => {
    if (!c.workDays.includes(d as WorkCalendar['workDays'][number])) return `(0||${d + 1}()())`
    const parts = [`(0||0(s|08:00|f|${hhmm(8 + first)})())`]
    if (lunch) parts.push(`(0||1(s|${hhmm(8 + first + 1)}|f|${hhmm(8 + c.hoursPerDay + 1)})())`)
    return `(0||${d + 1}()(${parts.join('')}))`
  }
  const days = [0, 1, 2, 3, 4, 5, 6].map(day).join('')
  const exc = (c.holidays || []).map((h, i) => `(0||${i}(d|${serial(h)})())`).join('')
  return `(0||CalendarData()((0||DaysOfWeek()(${days}))(0||VIEW(ShowTotal|Y)())(0||Exceptions()(${exc}))))`
}

/**
 * Calendar ids for the XER: the schedule's own ids when they are already P6 ids (positive integers,
 * e.g. an uploaded P6 file), so a round trip does not renumber calendars; otherwise 100, 101, ...
 */
function calendarIds(cals: WorkCalendar[]): Map<string, number> {
  const numeric = cals.map(c => (/^[1-9]\d{0,9}$/.test(c.id) ? Number(c.id) : NaN))
  if (numeric.every(n => !isNaN(n)) && new Set(numeric).size === numeric.length) return new Map(cals.map((c, i) => [c.id, numeric[i]]))
  return new Map(cals.map((c, i) => [c.id, 100 + i]))
}

export function exportXer(s: GeneratedSchedule, projectName: string, opts: { exportedBy?: string; now?: Date; projectShortName?: string; progressMode?: ProgressMode } = {}): string {
  const now = opts.now || new Date()
  const today = now.toISOString().slice(0, 10)
  const t = s.cpm?.times || {}
  const { root, nodes, rows } = buildWbs(s, projectName)
  const lines: string[] = []
  const table = (name: string, fields: string[], data: (string | number)[][]) => {
    lines.push(`%T\t${name}`, `%F\t${fields.join('\t')}`)
    for (const r of data) lines.push(`%R\t${r.map(xerText).join('\t')}`)
  }
  lines.push(['ERMHDR', '19.12', today, 'Project', xerText(opts.exportedBy || 'Planora'), 'Planora', 'dbxDatabaseNoName', 'Project Management', 'USD'].join('\t'))

  const PROJ = 1
  const calId = calendarIds(s.calendars)
  const driving = new Set(s.cpm?.longestPath ?? [])
  const hoursOf = (calendarId?: string) => s.calendars.find(c => c.id === (calendarId || s.defaultCalendarId))?.hoursPerDay || 8

  table('CALENDAR', ['clndr_id', 'default_flag', 'clndr_name', 'proj_id', 'base_clndr_id', 'last_chng_date', 'clndr_type', 'day_hr_cnt', 'week_hr_cnt', 'month_hr_cnt', 'year_hr_cnt', 'rsrc_private', 'clndr_data'],
    s.calendars.map(c => [calId.get(c.id)!, c.id === s.defaultCalendarId ? 'Y' : 'N', c.name, PROJ, '', dt(today, '00:00'), 'CA_Project', c.hoursPerDay, c.hoursPerDay * c.workDays.length, Math.round(c.hoursPerDay * c.workDays.length * 4.33), c.hoursPerDay * c.workDays.length * 52, 'N', clndrData(c)]))

  table('PROJECT', ['proj_id', 'fy_start_month_num', 'rsrc_self_add_flag', 'allow_complete_flag', 'rsrc_multi_assign_flag', 'checkout_flag', 'project_flag', 'step_complete_flag', 'cost_qty_recalc_flag', 'batch_sum_flag', 'name_sep_char', 'def_complete_pct_type', 'proj_short_name', 'acct_id', 'orig_proj_id', 'source_proj_id', 'base_type_id', 'clndr_id', 'sum_base_proj_id', 'task_code_base', 'task_code_step', 'priority_num', 'wbs_max_sum_level', 'strgy_priority_num', 'last_checksum', 'critical_drtn_hr_cnt', 'def_cost_per_qty', 'last_recalc_date', 'plan_start_date', 'plan_end_date', 'scd_end_date', 'add_date', 'last_tasksum_date', 'fcst_start_date', 'def_duration_type', 'task_code_prefix', 'guid', 'def_qty_type', 'add_by_name', 'web_local_root_path', 'proj_url', 'def_rate_type', 'add_act_remain_flag', 'act_this_per_link_flag', 'def_task_type', 'act_pct_link_flag', 'critical_path_type', 'task_code_prefix_flag', 'def_rollup_dates_flag', 'use_project_baseline_flag', 'rem_target_link_flag', 'reset_planned_flag', 'allow_neg_act_flag', 'sum_assign_level', 'last_fin_dates_id', 'last_baseline_update_date', 'cr_external_key', 'apply_actuals_date', 'location_id', 'loaded_scope_level', 'export_flag', 'new_fin_dates_id', 'baselines_to_export', 'baseline_names_to_export', 'next_data_date', 'close_period_flag', 'sum_refresh_date', 'trsrcsum_loaded'],
    [[PROJ, 1, 'Y', 'Y', 'Y', 'N', 'Y', 'N', 'N', 'Y', '.', 'CP_Drtn', projShortName(opts.projectShortName || projectName), '', '', '', '', calId.get(s.defaultCalendarId)!, '', 1000, 10, 10, 2, 500, '', 0, 0,
      // last_recalc_date = data date; plan_end_date = P6 "Must Finish By" (the required finish, so float after F9 matches); scd_end_date = forecast
      dt(s.dataDate || s.projectStart, '08:00'), dt(s.projectStart, '08:00'), s.mustFinishBy ? dt(s.mustFinishBy, finishTime(hoursOf())) : '', dt(s.cpm?.projectFinish, finishTime(hoursOf())), dt(today, '00:00'), '', '', 'DT_FixedDUR2', 'A', '', 'QT_Hour', xerText(opts.exportedBy || 'Planora'), '', '', 'COST_PER_QTY', 'Y', 'Y', 'TT_Task', 'N', 'CT_TotFloat', 'Y', 'Y', 'Y', 'Y', 'N', 'N', 'SL_Taskrsrc', '', '', '', '', '', 7, 'Y', '', '', '', dt(s.dataDate || s.projectStart, '08:00'), 'N', '', 'N']])

  // Scheduling options: how out-of-sequence progress is scheduled (P6 Retained Logic / Progress Override),
  // so P6 recalculates the file the way Planora did.
  const mode = opts.progressMode ?? 'retained'
  table('SCHEDOPTIONS', ['schedoptions_id', 'proj_id', 'sched_retained_logic', 'sched_progress_override'], [[1, PROJ, mode === 'retained' ? 'Y' : 'N', mode === 'override' ? 'Y' : 'N']])

  // WBS: project node + phases + work packages.
  const wbsId = new Map<string, number>()
  const wbsRows: (string | number)[][] = []
  let nextWbs = 1000
  const projNode = nextWbs++
  wbsRows.push([projNode, PROJ, '', 1, 1, 'Y', 'N', 'WS_Open', root, xerText(projectName), '', ''])
  const addNode = (n: (typeof nodes)[number], parent: number, seq: number) => {
    const id = nextWbs++
    wbsId.set(n.code, id)
    wbsRows.push([id, PROJ, '', seq, 1, 'N', 'N', 'WS_Open', n.code.split('.').pop()!, n.name, '', parent])
    n.children.forEach((c, i) => addNode(c, id, (i + 1) * 10))
  }
  nodes.forEach((n, i) => addNode(n, projNode, (i + 1) * 10))
  table('PROJWBS', ['wbs_id', 'proj_id', 'obs_id', 'seq_num', 'est_wt', 'proj_node_flag', 'sum_data_flag', 'status_code', 'wbs_short_name', 'wbs_name', 'phase_id', 'parent_wbs_id'], wbsRows)

  // Activities.
  const taskId = new Map<string, number>()
  let nextTask = 10000
  const hasPred = new Set(s.links.map(l => l.to))
  const taskRows: (string | number)[][] = []
  for (const r of rows) {
    if (r.kind !== 'activity' || !r.activity) continue
    const a = r.activity
    const tm = t[a.id]
    const id = nextTask++
    taskId.set(a.id, id)
    const h = hoursOf(a.calendarId)
    const fin = finishTime(h)
    const msKind = a.milestoneKind ?? (hasPred.has(a.id) ? 'finish' : 'start')
    const type = a.type === 'milestone' ? (msKind === 'finish' ? 'TT_FinMile' : 'TT_Mile') : 'TT_Task'
    // Uploaded activities carry their own baseline fields (possibly empty); never invent planned/target
    // dates for them. Planora-built plans have no baseline yet, so their planned dates are the CPM dates.
    const fromUpload = a.baselineStart !== undefined || a.baselineFinish !== undefined
    const targetStart = fromUpload ? a.baselineStart : tm?.earlyStart
    const targetFinish = fromUpload ? a.baselineFinish : tm?.earlyFinish
    const dur = a.duration * h
    const done = !!a.actualFinish || a.status === 'complete'
    const active = !done && !!a.actualStart
    const remaining = done ? 0 : active ? (a.remaining ?? a.duration) * h : dur
    const pct = done ? 100 : active ? Math.max(0, Math.min(99, Math.round(a.percentComplete ?? (dur ? 100 * (1 - remaining / dur) : 0)))) : 0
    const constraintTime = a.constraint && (a.constraint.type === 'FNET' || a.constraint.type === 'FNLT' || a.constraint.type === 'FO' || a.constraint.type === 'MFO') ? fin : '08:00'
    taskRows.push([
      id, PROJ, wbsId.get(r.wbsCode) ?? projNode, calId.get(a.calendarId || s.defaultCalendarId) ?? calId.get(s.defaultCalendarId)!,
      pct, 'N', 1, 'N', 'N', 'CP_Drtn', type, 'DT_FixedDUR2', done ? 'TK_Complete' : active ? 'TK_Active' : 'TK_NotStart', a.code, xerText(a.name).slice(0, P6_NAME_MAX), '',
      (tm?.totalFloat ?? 0) * h, (tm?.freeFloat ?? 0) * h, remaining, 0, 0, 0, dur, 0, 0, 0,
      a.constraint ? dt(a.constraint.date, constraintTime) : '', dt(a.actualStart, '08:00'), dt(a.actualFinish, fin),
      dt(tm?.lateStart, '08:00'), dt(tm?.lateFinish, fin), '',
      dt(tm?.earlyStart, '08:00'), dt(tm?.earlyFinish, fin), dt(tm?.earlyStart, '08:00'), dt(tm?.earlyFinish, fin),
      dt(targetStart, '08:00'), dt(targetFinish, fin), dt(tm?.lateStart, '08:00'), dt(tm?.lateFinish, fin),
      a.constraint ? CSTR[a.constraint.type] : '', 'PT_Normal', driving.has(a.id) ? 'Y' : 'N',
    ])
  }
  table('TASK', ['task_id', 'proj_id', 'wbs_id', 'clndr_id', 'phys_complete_pct', 'rev_fdbk_flag', 'est_wt', 'lock_plan_flag', 'auto_compute_act_flag', 'complete_pct_type', 'task_type', 'duration_type', 'status_code', 'task_code', 'task_name', 'rsrc_id', 'total_float_hr_cnt', 'free_float_hr_cnt', 'remain_drtn_hr_cnt', 'act_work_qty', 'remain_work_qty', 'target_work_qty', 'target_drtn_hr_cnt', 'target_equip_qty', 'act_equip_qty', 'remain_equip_qty', 'cstr_date', 'act_start_date', 'act_end_date', 'late_start_date', 'late_end_date', 'expect_end_date', 'early_start_date', 'early_end_date', 'restart_date', 'reend_date', 'target_start_date', 'target_end_date', 'rem_late_start_date', 'rem_late_end_date', 'cstr_type', 'priority_type', 'driving_path_flag'], taskRows)

  let nextPred = 50000
  const predRows: (string | number)[][] = []
  for (const l of s.links) {
    const from = taskId.get(l.from), to = taskId.get(l.to)
    if (from === undefined || to === undefined) continue
    // Lag is in work days on the predecessor's calendar (P6's default lag calendar)
    const pred = s.activities.find(a => a.id === l.from)
    predRows.push([nextPred++, to, from, PROJ, PROJ, PRED[l.type], l.lag * hoursOf(pred?.calendarId)])
  }
  table('TASKPRED', ['task_pred_id', 'task_id', 'pred_task_id', 'proj_id', 'pred_proj_id', 'pred_type', 'lag_hr_cnt'], predRows)

  // Notebook: the reasons recorded for the scheduler's overrides, so they travel with the activity.
  const memoRows: (string | number)[][] = []
  let nextMemo = 70000
  for (const a of s.activities) {
    const id = taskId.get(a.id)
    const reasons = (a.overrides || []).filter(o => o.reason)
    if (id === undefined || !reasons.length) continue
    const esc = (v: string) => v.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!))
    const text = reasons.map(o => `${o.field}${o.from !== undefined || o.to !== undefined ? ` ${String(o.from ?? '')} -> ${String(o.to ?? '')}` : ''}: ${o.reason} (${o.by}, ${String(o.at).slice(0, 10)})`)
    memoRows.push([nextMemo++, id, 1, PROJ, `<HTML><BODY><P>Planora overrides</P>${text.map(x => `<P>${esc(x)}</P>`).join('')}</BODY></HTML>`])
  }
  if (memoRows.length) {
    table('MEMOTYPE', ['memo_type_id', 'seq_num', 'eps_flag', 'proj_flag', 'wbs_flag', 'task_flag', 'memo_type'], [[1, 1, 'N', 'N', 'N', 'Y', 'Planora overrides']])
    table('TASKMEMO', ['memo_id', 'task_id', 'memo_type_id', 'proj_id', 'task_memo'], memoRows)
  }

  lines.push('%E')
  return lines.join('\r\n') + '\r\n'
}

/* ─── Uploaded P6 files: pass the original through ─────── */

/** Planora's recalculated values for one P6 activity (dates ISO yyyy-mm-dd, float in work days). */
export interface XerTaskUpdate {
  earlyStart: string
  earlyFinish: string
  lateStart: string
  lateFinish: string
  totalFloat: number
  freeFloat: number
  driving: boolean
}

/** Recalculated values keyed by P6 task_id, from an uploaded schedule's activities and Planora's CPM. */
export function xerUpdatesFrom(activities: { id: string; sourceId?: string | null }[], cpm: CpmResult): Map<string, XerTaskUpdate> {
  const driving = new Set(cpm.longestPath)
  const out = new Map<string, XerTaskUpdate>()
  for (const a of activities) {
    const t = cpm.times[a.id]
    if (!a.sourceId || !t) continue
    out.set(a.sourceId, { earlyStart: t.earlyStart, earlyFinish: t.earlyFinish, lateStart: t.lateStart, lateFinish: t.lateFinish, totalFloat: t.totalFloat, freeFloat: t.freeFloat, driving: driving.has(a.id) })
  }
  return out
}

/** Edits made in Planora, keyed by P6 task_id, to write into the original XER (durations in work days). */
export interface XerEdits {
  tasks: Map<string, { remainingDays?: number; originalDays?: number; constraint?: { type: ConstraintType; date: string } | null }>
  setLinks: { pred: string; succ: string; type: LinkType; lagDays: number }[]
  removeLinks: { pred: string; succ: string }[]
}

type EditLike = { status: 'applied' | 'skipped'; change: { kind: string; activityId?: string; remaining?: number; predecessorId?: string; successorId?: string; type?: LinkType; lag?: number; constraint?: { type: ConstraintType; date: string } | null } }

/** Replay the applied edits of an uploaded schedule onto P6 task ids (the last edit of a field wins). */
export function xerEditsFrom(activities: { id: string; sourceId?: string | null; status?: string }[], edits: EditLike[]): XerEdits {
  const byId = new Map(activities.map(a => [a.id, a]))
  const src = (id?: string) => (id ? byId.get(id)?.sourceId || null : null)
  const tasks: XerEdits['tasks'] = new Map()
  const set = new Map<string, XerEdits['setLinks'][number]>()
  const removed = new Map<string, XerEdits['removeLinks'][number]>()
  for (const e of edits) {
    if (e.status !== 'applied') continue
    const c = e.change
    if (c.kind === 'duration' || c.kind === 'constraint') {
      const t = src(c.activityId)
      if (!t) continue
      const cur = tasks.get(t) || {}
      if (c.kind === 'duration') {
        cur.remainingDays = c.remaining
        if (byId.get(c.activityId!)?.status !== 'in_progress') cur.originalDays = c.remaining
      } else cur.constraint = c.constraint ?? null
      tasks.set(t, cur)
    } else if (c.kind === 'link_set' || c.kind === 'link_remove') {
      const pred = src(c.predecessorId), succ = src(c.successorId)
      if (!pred || !succ) continue
      const key = `${pred}>${succ}`
      if (c.kind === 'link_set') { removed.delete(key); set.set(key, { pred, succ, type: c.type || 'FS', lagDays: c.lag ?? 0 }) }
      else { set.delete(key); removed.set(key, { pred, succ }) }
    }
  }
  return { tasks, setLinks: [...set.values()], removeLinks: [...removed.values()] }
}

/**
 * Re-emit an uploaded XER with Planora's recalculated early/late dates, float and driving-path flag on
 * open activities, and Planora's forecast as the project's scheduled finish. Every other table, row
 * and field (including the file's own time of day on unchanged dates) is written back exactly as read.
 * With `opts.edits`, the edits made in Planora are written in too: durations (target/remaining hours),
 * primary constraints, and TASKPRED rows changed, removed or added.
 */
export function exportXerFromOriginal(original: string, updates: Map<string, XerTaskUpdate>, opts: { forecastFinish?: string | null; edits?: XerEdits | null; progressMode?: ProgressMode | null } = {}): string {
  const tables = readXerTables(original)
  const cal = new Map((tables['CALENDAR'] || []).map(c => [c['clndr_id'], xerCalendarTimes(c)]))
  const edits = opts.edits && (opts.edits.tasks.size || opts.edits.setLinks.length || opts.edits.removeLinks.length) ? opts.edits : null
  const projOfTasks = new Set<string>()
  for (const t of tables['TASK'] || []) if (updates.has(t['task_id']) && t['proj_id']) projOfTasks.add(t['proj_id'])
  const projCal = new Map((tables['PROJECT'] || []).map(p => [p['proj_id'], p['clndr_id']]))
  const defaultCal = (tables['CALENDAR'] || []).find(c => c['default_flag'] === 'Y')?.['clndr_id']

  /** Replace the date part; keep the file's own value when the date did not change, else its time of day. */
  const withDate = (orig: string, iso: string, time: string) => {
    const o = orig.trim()
    if (o.slice(0, 10) === iso) return orig
    const m = o.match(/^\d{4}-\d{1,2}-\d{1,2}[ T](\d{1,2}:\d{2})/)
    return `${iso} ${m ? m[1] : time}`
  }
  const hrs = (days: number, hpd: number) => String(Math.round(days * hpd * 100) / 100)
  const taskRow = new Map((tables['TASK'] || []).map(t => [t['task_id'], t]))
  const calOfTask = (taskId: string) => {
    const t = taskRow.get(taskId)
    return (t && (cal.get(t['clndr_id']) || cal.get(projCal.get(t['proj_id']) || ''))) || cal.get(defaultCal || '')
  }
  const linkKey = (pred: string, succ: string) => `${pred.trim()}>${succ.trim()}`
  const setLinks = new Map((edits?.setLinks || []).map(l => [linkKey(l.pred, l.succ), l]))
  const removeLinks = new Set((edits?.removeLinks || []).map(l => linkKey(l.pred, l.succ)))
  const pendingAdds = new Map(setLinks)
  let nextPredId = Math.max(0, ...(tables['TASKPRED'] || []).map(p => Number(p['task_pred_id']) || 0)) + 1
  const predFields = ['task_pred_id', 'task_id', 'pred_task_id', 'proj_id', 'pred_proj_id', 'pred_type', 'lag_hr_cnt']
  /** New TASKPRED rows for the relationships added in Planora, in the table's own column order. */
  const addRows = (fieldIdx: Map<string, number>) => {
    const rows: string[] = []
    const width = Math.max(0, ...fieldIdx.values()) + 1
    for (const l of pendingAdds.values()) {
      const cols = new Array<string>(width).fill('')
      cols[0] = '%R'
      const put = (f: string, v: string) => { const i = fieldIdx.get(f); if (i !== undefined) cols[i] = v }
      const succ = taskRow.get(l.succ), pred = taskRow.get(l.pred)
      put('task_pred_id', String(nextPredId++)); put('task_id', l.succ); put('pred_task_id', l.pred)
      put('proj_id', succ?.['proj_id'] || ''); put('pred_proj_id', pred?.['proj_id'] || '')
      put('pred_type', PRED[l.type]); put('lag_hr_cnt', hrs(l.lagDays, calOfTask(l.pred)?.hoursPerDay || 8))
      rows.push(cols.join('\t'))
    }
    pendingAdds.clear()
    return rows
  }

  const eol = original.includes('\r\n') ? '\r\n' : '\n'
  const endsWithNl = /(\r\n|\n|\r)$/.test(original)
  const lines = original.replace(/^﻿/, '').split(/\r\n|\n|\r/)
  if (endsWithNl && lines[lines.length - 1] === '') lines.pop()
  let table = ''
  let idx = new Map<string, number>()
  let sawPredTable = false
  const out = lines.flatMap((line): string[] => {
    const cols = line.split('\t')
    const tag = cols[0].trim()
    // Relationships added in Planora go at the end of the TASKPRED table (or a new one before %E).
    const flushAdds = (): string[] => (table === 'TASKPRED' && pendingAdds.size ? addRows(idx) : [])
    if (tag === '%T') { const added = flushAdds(); table = (cols[1] || '').trim(); if (table === 'TASKPRED') sawPredTable = true; return [...added, line] }
    if (tag === '%E') {
      const added = flushAdds()
      if (!sawPredTable && pendingAdds.size) {
        const fidx = new Map(predFields.map((f, i) => [f, i + 1]))
        return [...added, '%T\tTASKPRED', ['%F', ...predFields].join('\t'), ...addRows(fidx), line]
      }
      return [...added, line]
    }
    if (tag === '%F') { idx = new Map(cols.slice(1).map((f, i) => [f.trim(), i + 1])); return [line] }
    if (tag !== '%R') return [line]
    const get = (f: string) => (idx.has(f) ? (cols[idx.get(f)!] ?? '') : '')
    const set = (f: string, v: string) => { const i = idx.get(f); if (i === undefined) return; while (cols.length <= i) cols.push(''); cols[i] = v }
    if (table === 'TASKPRED' && edits) {
      const key = linkKey(get('pred_task_id'), get('task_id'))
      if (removeLinks.has(key)) return []
      const l = setLinks.get(key)
      if (!l) return [line]
      pendingAdds.delete(key)
      set('pred_type', PRED[l.type])
      set('lag_hr_cnt', hrs(l.lagDays, calOfTask(get('pred_task_id').trim())?.hoursPerDay || 8))
      return [cols.join('\t')]
    }
    if (table === 'TASK') {
      const u = updates.get(get('task_id').trim())
      const te = edits?.tasks.get(get('task_id').trim())
      const c = cal.get(get('clndr_id').trim()) || cal.get(projCal.get(get('proj_id').trim()) || '') || cal.get(defaultCal || '')
      const finish = c?.finish || '17:00', hpd = c?.hoursPerDay || 8
      if (te) {
        if (te.remainingDays !== undefined) set('remain_drtn_hr_cnt', hrs(te.remainingDays, hpd))
        if (te.originalDays !== undefined) set('target_drtn_hr_cnt', hrs(te.originalDays, hpd))
        if (te.constraint !== undefined) {
          set('cstr_type', te.constraint ? CSTR[te.constraint.type] : '')
          const atStart = !!te.constraint && ['SNET', 'SNLT', 'SO', 'MSO'].includes(te.constraint.type)
          set('cstr_date', te.constraint ? `${te.constraint.date} ${atStart ? c?.start || '08:00' : finish}` : '')
        }
      }
      if (!u || get('status_code').trim() === 'TK_Complete') return [te ? cols.join('\t') : line]
      // A finish milestone starts and finishes at the end of its day.
      const start = get('task_type').trim() === 'TT_FinMile' ? finish : c?.start || '08:00'
      // An in-progress activity's early start is its actual start in P6; only its finish moves.
      if (get('status_code').trim() !== 'TK_Active') set('early_start_date', withDate(get('early_start_date'), u.earlyStart, start))
      set('early_end_date', withDate(get('early_end_date'), u.earlyFinish, finish))
      set('late_start_date', withDate(get('late_start_date'), u.lateStart, start))
      set('late_end_date', withDate(get('late_end_date'), u.lateFinish, finish))
      set('restart_date', withDate(get('restart_date'), u.earlyStart, start))
      set('reend_date', withDate(get('reend_date'), u.earlyFinish, finish))
      set('rem_late_start_date', withDate(get('rem_late_start_date'), u.lateStart, start))
      set('rem_late_end_date', withDate(get('rem_late_end_date'), u.lateFinish, finish))
      set('total_float_hr_cnt', hrs(u.totalFloat, hpd))
      // Free float never exceeds total float in P6 (a date constraint can limit total float alone).
      set('free_float_hr_cnt', hrs(Math.min(u.freeFloat, Math.max(0, u.totalFloat)), hpd))
      set('driving_path_flag', u.driving ? 'Y' : 'N')
      return [cols.join('\t')]
    }
    // The progress option Planora scheduled with, when it was changed from the file's own.
    if (table === 'SCHEDOPTIONS' && opts.progressMode && (!projOfTasks.size || !get('proj_id').trim() || projOfTasks.has(get('proj_id').trim()))) {
      const retained = opts.progressMode === 'retained' ? 'Y' : 'N', override = opts.progressMode === 'override' ? 'Y' : 'N'
      if (get('sched_retained_logic').trim() === retained && get('sched_progress_override').trim() === override) return [line]
      set('sched_retained_logic', retained)
      set('sched_progress_override', override)
      return [cols.join('\t')]
    }
    if (table === 'PROJECT' && opts.forecastFinish && projOfTasks.has(get('proj_id').trim())) {
      const c = cal.get(get('clndr_id').trim()) || cal.get(defaultCal || '')
      set('scd_end_date', withDate(get('scd_end_date'), opts.forecastFinish, c?.finish || '17:00'))
      return [cols.join('\t')]
    }
    return [line]
  })
  return out.join(eol) + (endsWithNl ? eol : '')
}
