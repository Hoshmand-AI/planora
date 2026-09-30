// Primavera P6 native export (.xer). Tab-delimited tables: CALENDAR, PROJECT, PROJWBS, TASK, TASKPRED.
// Dates use P6's "yyyy-mm-dd hh:mm" form; durations and lags are hours on each activity's calendar.
// Text is kept to Windows-1252-safe characters because P6 reads XER in the client code page.

import type { GeneratedSchedule, LinkType, ConstraintType, WorkCalendar } from '@/lib/planning/types'
import { buildWbs } from './wbs'

const PRED: Record<LinkType, string> = { FS: 'PR_FS', SS: 'PR_SS', FF: 'PR_FF', SF: 'PR_SF' }
const CSTR: Record<ConstraintType, string> = { SNET: 'CS_MSOA', SNLT: 'CS_MSOB', FNET: 'CS_MEOA', FNLT: 'CS_MEOB', MSO: 'CS_MSO', MFO: 'CS_MEO' }

/** Characters P6 handles in XER (Windows-1252); others are replaced with ASCII equivalents. */
export function xerText(v: unknown): string {
  return String(v ?? '')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/[≥]/g, '>=').replace(/[≤]/g, '<=').replace(/[→]/g, '->').replace(/[←]/g, '<-')
    .replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '?')
}

const dt = (d: string | null | undefined, time: string) => (d ? `${d.slice(0, 10)} ${time}` : '')

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

export function exportXer(s: GeneratedSchedule, projectName: string, opts: { exportedBy?: string; now?: Date } = {}): string {
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
  const calId = new Map(s.calendars.map((c, i) => [c.id, 100 + i]))
  const hoursOf = (calendarId?: string) => s.calendars.find(c => c.id === (calendarId || s.defaultCalendarId))?.hoursPerDay || 8

  table('CALENDAR', ['clndr_id', 'default_flag', 'clndr_name', 'proj_id', 'base_clndr_id', 'last_chng_date', 'clndr_type', 'day_hr_cnt', 'week_hr_cnt', 'month_hr_cnt', 'year_hr_cnt', 'rsrc_private', 'clndr_data'],
    s.calendars.map(c => [calId.get(c.id)!, c.id === s.defaultCalendarId ? 'Y' : 'N', c.name, PROJ, '', dt(today, '00:00'), 'CA_Project', c.hoursPerDay, c.hoursPerDay * c.workDays.length, Math.round(c.hoursPerDay * c.workDays.length * 4.33), c.hoursPerDay * c.workDays.length * 52, 'N', clndrData(c)]))

  table('PROJECT', ['proj_id', 'fy_start_month_num', 'rsrc_self_add_flag', 'allow_complete_flag', 'rsrc_multi_assign_flag', 'checkout_flag', 'project_flag', 'step_complete_flag', 'cost_qty_recalc_flag', 'batch_sum_flag', 'name_sep_char', 'def_complete_pct_type', 'proj_short_name', 'acct_id', 'orig_proj_id', 'source_proj_id', 'base_type_id', 'clndr_id', 'sum_base_proj_id', 'task_code_base', 'task_code_step', 'priority_num', 'wbs_max_sum_level', 'strgy_priority_num', 'last_checksum', 'critical_drtn_hr_cnt', 'def_cost_per_qty', 'last_recalc_date', 'plan_start_date', 'plan_end_date', 'scd_end_date', 'add_date', 'last_tasksum_date', 'fcst_start_date', 'def_duration_type', 'task_code_prefix', 'guid', 'def_qty_type', 'add_by_name', 'web_local_root_path', 'proj_url', 'def_rate_type', 'add_act_remain_flag', 'act_this_per_link_flag', 'def_task_type', 'act_pct_link_flag', 'critical_path_type', 'task_code_prefix_flag', 'def_rollup_dates_flag', 'use_project_baseline_flag', 'rem_target_link_flag', 'reset_planned_flag', 'allow_neg_act_flag', 'sum_assign_level', 'last_fin_dates_id', 'last_baseline_update_date', 'cr_external_key', 'apply_actuals_date', 'location_id', 'loaded_scope_level', 'export_flag', 'new_fin_dates_id', 'baselines_to_export', 'baseline_names_to_export', 'next_data_date', 'close_period_flag', 'sum_refresh_date', 'trsrcsum_loaded'],
    [[PROJ, 1, 'Y', 'Y', 'Y', 'N', 'Y', 'N', 'N', 'Y', '.', 'CP_Drtn', root, '', '', '', '', calId.get(s.defaultCalendarId)!, '', 1000, 10, 10, 2, 500, '', 0, 0, dt(s.projectStart, '08:00'), dt(s.projectStart, '08:00'), dt(s.cpm?.projectFinish, '17:00'), dt(s.cpm?.projectFinish, '17:00'), dt(today, '00:00'), '', '', 'DT_FixedDUR2', 'A', '', 'QT_Hour', xerText(opts.exportedBy || 'Planora'), '', '', 'COST_PER_QTY', 'Y', 'Y', 'TT_Task', 'N', 'CT_TotFloat', 'Y', 'Y', 'Y', 'Y', 'N', 'N', 'SL_Taskrsrc', '', '', '', '', '', 7, 'Y', '', '', '', '', 'N', '', 'N']])

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
    const type = a.type === 'milestone' ? (hasPred.has(a.id) ? 'TT_FinMile' : 'TT_Mile') : 'TT_Task'
    const dur = a.duration * h
    taskRows.push([
      id, PROJ, wbsId.get(r.wbsCode) ?? projNode, calId.get(a.calendarId || s.defaultCalendarId) ?? calId.get(s.defaultCalendarId)!,
      0, 'N', 1, 'N', 'N', 'CP_Drtn', type, 'DT_FixedDUR2', 'TK_NotStart', a.code, a.name, '',
      (tm?.totalFloat ?? 0) * h, (tm?.freeFloat ?? 0) * h, dur, 0, 0, 0, dur, 0, 0, 0,
      a.constraint ? dt(a.constraint.date, '08:00') : '', '', '',
      dt(tm?.lateStart, '08:00'), dt(tm?.lateFinish, '17:00'), '',
      dt(tm?.earlyStart, '08:00'), dt(tm?.earlyFinish, '17:00'), dt(tm?.earlyStart, '08:00'), dt(tm?.earlyFinish, '17:00'),
      dt(tm?.earlyStart, '08:00'), dt(tm?.earlyFinish, '17:00'), dt(tm?.lateStart, '08:00'), dt(tm?.lateFinish, '17:00'),
      a.constraint ? CSTR[a.constraint.type] : '', 'PT_Normal', tm?.critical ? 'Y' : 'N',
    ])
  }
  table('TASK', ['task_id', 'proj_id', 'wbs_id', 'clndr_id', 'phys_complete_pct', 'rev_fdbk_flag', 'est_wt', 'lock_plan_flag', 'auto_compute_act_flag', 'complete_pct_type', 'task_type', 'duration_type', 'status_code', 'task_code', 'task_name', 'rsrc_id', 'total_float_hr_cnt', 'free_float_hr_cnt', 'remain_drtn_hr_cnt', 'act_work_qty', 'remain_work_qty', 'target_work_qty', 'target_drtn_hr_cnt', 'target_equip_qty', 'act_equip_qty', 'remain_equip_qty', 'cstr_date', 'act_start_date', 'act_end_date', 'late_start_date', 'late_end_date', 'expect_end_date', 'early_start_date', 'early_end_date', 'restart_date', 'reend_date', 'target_start_date', 'target_end_date', 'rem_late_start_date', 'rem_late_end_date', 'cstr_type', 'priority_type', 'driving_path_flag'], taskRows)

  let nextPred = 50000
  const predRows: (string | number)[][] = []
  for (const l of s.links) {
    const from = taskId.get(l.from), to = taskId.get(l.to)
    if (from === undefined || to === undefined) continue
    const succ = s.activities.find(a => a.id === l.to)
    predRows.push([nextPred++, to, from, PROJ, PROJ, PRED[l.type], l.lag * hoursOf(succ?.calendarId)])
  }
  table('TASKPRED', ['task_pred_id', 'task_id', 'pred_task_id', 'proj_id', 'pred_proj_id', 'pred_type', 'lag_hr_cnt'], predRows)

  lines.push('%E')
  return lines.join('\r\n') + '\r\n'
}
