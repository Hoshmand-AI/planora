// A realistic "lean" P6 schedule for import regression tests, modeled on how GCs build a pursuit /
// SOQ schedule for import into P6: 330 activities, no baseline, no Must Finish By, the data date at
// the project start, 0% progress, a finish milestone without successors, open ends, SS/FF links with
// lags, two calendars, one level-of-effort and one WBS summary activity, and no calculated dates
// (the scheduler presses F9 in P6 after import). The same network is written as P6 XER, P6 XML and
// the P6 Excel import/export workbook (TASK + TASKPRED sheets), so each importer can be checked
// against the same expectations.

import { readFileSync } from 'fs'
import path from 'path'
import ExcelJS from 'exceljs'

export interface LeanActivity {
  code: string
  name: string
  wbs: string
  /** work days */
  duration: number
  type: 'TT_Task' | 'TT_Mile' | 'TT_FinMile' | 'TT_LOE' | 'TT_WBS'
  /** '100' = 5-day 8h, '200' = 7-day 10h */
  cal: '100' | '200'
}
export interface LeanLink { pred: string; succ: string; type: 'FS' | 'SS' | 'FF'; lag: number }

export const LEAN_AREAS = ['PRECON', 'DESIGN', 'PERMIT', 'PROCURE', 'SITE', 'BRIDGE', 'TRACK', 'STATION', 'SYSTEMS', 'CLOSEOUT'] as const
export const LEAN_START = '2026-11-02'

/** The network: 1 NTP + 10 areas x 32 tasks + 6 interim milestones + LOE + WBS summary + Substantial Completion = 330. */
export function leanSchedule(): { activities: LeanActivity[]; links: LeanLink[]; openEnds: string[] } {
  const activities: LeanActivity[] = []
  const links: LeanLink[] = []
  const openEnds: string[] = []
  activities.push({ code: 'MS1000', name: 'Notice to Proceed', wbs: 'PRECON', duration: 0, type: 'TT_Mile', cal: '100' })
  let prevAreaFifth = 'MS1000'
  LEAN_AREAS.forEach((area, ai) => {
    const codes: string[] = []
    for (let i = 0; i < 32; i++) {
      const code = `${area.slice(0, 3)}-${String(1000 + i * 10)}`
      codes.push(code)
      activities.push({ code, name: `${area} work package ${i + 1}`, wbs: area, duration: 5 + ((i * 7 + ai * 3) % 36), type: 'TT_Task', cal: area === 'SITE' || area === 'TRACK' ? '200' : '100' })
    }
    // Area start: SS + 5 from the 5th task of the previous area (NTP for the first)
    links.push({ pred: prevAreaFifth, succ: codes[0], type: ai === 0 ? 'FS' : 'SS', lag: ai === 0 ? 0 : 5 })
    for (let i = 1; i < 32; i++) {
      // Every 9th task is a dangling open end (no successor); its follower ties to the one before it.
      const pred = i >= 2 && (i - 1) % 9 === 8 ? codes[i - 2] : codes[i - 1]
      if (i % 4 === 0) links.push({ pred, succ: codes[i], type: 'SS', lag: 3 })
      else if (i % 7 === 0) links.push({ pred, succ: codes[i], type: 'FF', lag: 2 })
      else links.push({ pred, succ: codes[i], type: 'FS', lag: 0 })
    }
    for (let i = 0; i < 32; i++) if (i % 9 === 8 && i < 31) openEnds.push(codes[i])
    prevAreaFifth = codes[4]
    if (ai % 2 === 1) {
      const ms = `MS${2000 + ai * 10}`
      activities.push({ code: ms, name: `${area} complete`, wbs: area, duration: 0, type: 'TT_FinMile', cal: '100' })
      links.push({ pred: codes[31], succ: ms, type: 'FS', lag: 0 })
      links.push({ pred: ms, succ: 'MS9999', type: 'FS', lag: 0 })
    } else {
      links.push({ pred: codes[31], succ: 'MS9999', type: 'FS', lag: 0 })
    }
  })
  // One more interim milestone (6 in all) tied into the closeout
  activities.push({ code: 'MS2100', name: 'Revenue Service Readiness', wbs: 'CLOSEOUT', duration: 0, type: 'TT_FinMile', cal: '100' })
  links.push({ pred: 'SYS-1310', succ: 'MS2100', type: 'FS', lag: 0 })
  links.push({ pred: 'MS2100', succ: 'MS9999', type: 'FS', lag: 0 })
  activities.push({ code: 'LOE-100', name: 'Project Management (LOE)', wbs: 'PRECON', duration: 600, type: 'TT_LOE', cal: '100' })
  links.push({ pred: 'MS1000', succ: 'LOE-100', type: 'SS', lag: 0 })
  activities.push({ code: 'WBS-SUM', name: 'Design Phase Summary', wbs: 'DESIGN', duration: 120, type: 'TT_WBS', cal: '100' })
  activities.push({ code: 'MS9999', name: 'Substantial Completion', wbs: 'CLOSEOUT', duration: 0, type: 'TT_FinMile', cal: '100' })
  return { activities, links, openEnds }
}

const fixtures = path.join(__dirname)
const HPD = { '100': 8, '200': 10 } as const

/** P6 XER of the lean network: no calculated dates, no baseline, no Must Finish By, data date = start. */
export function leanXer(opts: { mustFinishBy?: string; withDates?: false } = {}): string {
  const { activities, links } = leanSchedule()
  const sample = readFileSync(path.join(fixtures, 'sample.xer'), 'utf8').split(/\r?\n/)
  const calStart = sample.findIndex(l => l === '%T\tCALENDAR')
  const calRows = sample.slice(calStart, calStart + 4)
  const ids = new Map(activities.map((a, i) => [a.code, String(5000 + i)]))
  const wbsIds = new Map(LEAN_AREAS.map((w, i) => [w, String(20 + i)]))
  const L: string[] = ['ERMHDR\t19.12\t2026-07-20\tProject\tadmin\tadmin\tdbxDatabaseNoName\tProject Management\tUSD', ...calRows]
  L.push('%T\tPROJECT', '%F\tproj_id\tproj_short_name\tclndr_id\tplan_start_date\tplan_end_date\tscd_end_date\tlast_recalc_date')
  L.push(`%R\t7\tMETRA-P2-LEAN\t100\t${LEAN_START} 00:00\t${opts.mustFinishBy ? `${opts.mustFinishBy} 17:00` : ''}\t\t${LEAN_START} 00:00`)
  L.push('%T\tPROJWBS', '%F\twbs_id\tproj_id\tproj_node_flag\twbs_short_name\twbs_name\tparent_wbs_id', '%R\t19\t7\tY\tMETRA\tMetra CREATE P2\t')
  for (const [w, id] of wbsIds) L.push(`%R\t${id}\t7\tN\t${w}\t${w}\t19`)
  L.push('%T\tTASK', '%F\ttask_id\tproj_id\twbs_id\tclndr_id\tphys_complete_pct\ttask_type\tstatus_code\ttask_code\ttask_name\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt')
  for (const a of activities) {
    const h = a.duration * HPD[a.cal]
    L.push(`%R\t${ids.get(a.code)}\t7\t${wbsIds.get(a.wbs as typeof LEAN_AREAS[number])}\t${a.cal}\t0\t${a.type}\tTK_NotStart\t${a.code}\t${a.name}\t${h}\t${h}`)
  }
  L.push('%T\tTASKPRED', '%F\ttask_pred_id\ttask_id\tpred_task_id\tproj_id\tpred_proj_id\tpred_type\tlag_hr_cnt')
  links.forEach((l, i) => {
    const predCal = activities.find(a => a.code === l.pred)!.cal
    L.push(`%R\t${i + 1}\t${ids.get(l.succ)}\t${ids.get(l.pred)}\t7\t7\tPR_${l.type}\t${l.lag * HPD[predCal]}`)
  })
  L.push('%E')
  return L.join('\r\n')
}

/** P6 XML of the lean network (relationships at the root, as P6 writes them for a single-project export). */
export function leanP6Xml(): string {
  const { activities, links } = leanSchedule()
  const eq = readFileSync(path.join(fixtures, 'p6-equivalence.xml'), 'utf8')
  const cals = eq.match(/<Calendar>[\s\S]*?<\/Calendar>/g)!.join('\n')
  const ids = new Map(activities.map((a, i) => [a.code, String(5000 + i)]))
  const wbsIds = new Map(LEAN_AREAS.map((w, i) => [w, String(20 + i)]))
  const typeName = { TT_Task: 'Task Dependent', TT_Mile: 'Start Milestone', TT_FinMile: 'Finish Milestone', TT_LOE: 'Level of Effort', TT_WBS: 'WBS Summary' } as const
  const relName = { FS: 'Finish to Start', SS: 'Start to Start', FF: 'Finish to Finish' } as const
  const acts = activities.map(a => `    <Activity>
      <CalendarObjectId>${a.cal}</CalendarObjectId>
      <EarlyFinishDate/>
      <EarlyStartDate/>
      <Id>${a.code}</Id>
      <Name>${a.name}</Name>
      <ObjectId>${ids.get(a.code)}</ObjectId>
      <PhysicalPercentComplete>0</PhysicalPercentComplete>
      <PlannedDuration>${a.duration * HPD[a.cal]}</PlannedDuration>
      <PrimaryConstraintType>&lt;None&gt;</PrimaryConstraintType>
      <RemainingDuration>${a.duration * HPD[a.cal]}</RemainingDuration>
      <Status>Not Started</Status>
      <TotalFloat/>
      <Type>${typeName[a.type]}</Type>
      <WBSObjectId>${wbsIds.get(a.wbs as typeof LEAN_AREAS[number])}</WBSObjectId>
    </Activity>`).join('\n')
  const rels = links.map((l, i) => {
    const predCal = activities.find(a => a.code === l.pred)!.cal
    return `  <Relationship>
    <Lag>${l.lag * HPD[predCal]}</Lag>
    <ObjectId>${i + 1}</ObjectId>
    <PredecessorActivityObjectId>${ids.get(l.pred)}</PredecessorActivityObjectId>
    <SuccessorActivityObjectId>${ids.get(l.succ)}</SuccessorActivityObjectId>
    <Type>${relName[l.type]}</Type>
  </Relationship>`
  }).join('\n')
  const wbs = [...wbsIds].map(([w, id]) => `    <WBS><Code>${w}</Code><Name>${w}</Name><ObjectId>${id}</ObjectId><ParentObjectId>7</ParentObjectId></WBS>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<APIBusinessObjects xmlns="http://xmlns.oracle.com/Primavera/P6/V19.12/API/BusinessObjects">
${cals}
  <Project>
    <ActivityDefaultCalendarObjectId>100</ActivityDefaultCalendarObjectId>
    <DataDate>${LEAN_START}T00:00:00</DataDate>
    <Id>METRA-P2-LEAN</Id>
    <MustFinishByDate/>
    <Name>Metra CREATE P2 - P6 Import LEAN</Name>
    <ObjectId>7</ObjectId>
    <PlannedStartDate>${LEAN_START}T00:00:00</PlannedStartDate>
${wbs}
${acts}
  </Project>
${rels}
</APIBusinessObjects>
`
}

/**
 * The P6 Excel import/export workbook (File > Export > Spreadsheet): a TASK sheet and a TASKPRED
 * sheet, each with P6 field names in row 1 and column titles in row 2, and no dates (a lean file
 * built for import; P6 schedules it). `taskSheetOnly` drops the TASKPRED sheet (no logic at all).
 */
export async function leanP6Workbook(opts: { taskSheetOnly?: boolean; withDates?: boolean } = {}): Promise<Buffer> {
  const { activities, links } = leanSchedule()
  const typeName = { TT_Task: 'Task Dependent', TT_Mile: 'Start Milestone', TT_FinMile: 'Finish Milestone', TT_LOE: 'Level of Effort', TT_WBS: 'WBS Summary' } as const
  const wb = new ExcelJS.Workbook()
  const task = wb.addWorksheet('TASK')
  task.addRow(['task_code', 'status_code', 'wbs_id', 'task_name', 'task_type', 'target_drtn_hr_cnt', 'clndr_id', 'delete_record_flag'])
  task.addRow(['Activity ID', 'Activity Status', 'WBS Code', 'Activity Name', 'Activity Type', 'Original Duration(d)', 'Calendar', 'Delete This Row'])
  for (const a of activities) {
    task.addRow([a.code, 'Not Started', `METRA.${a.wbs}`, a.name, typeName[a.type], a.duration, a.cal === '100' ? '5 Day x 8h' : '7 Day x 10h', ''])
  }
  if (!opts.taskSheetOnly) {
    const pred = wb.addWorksheet('TASKPRED')
    pred.addRow(['pred_task_id', 'task_id', 'pred_type', 'lag_hr_cnt', 'delete_record_flag'])
    pred.addRow(['Predecessor', 'Successor', 'Relationship Type', 'Lag(d)', 'Delete This Row'])
    for (const l of links) pred.addRow([l.pred, l.succ, `PR_${l.type}`, l.lag, ''])
  }
  wb.addWorksheet('USERDATA').addRow(['user_data', 'UserSettings Do Not Edit'])
  return Buffer.from(await wb.xlsx.writeBuffer())
}
