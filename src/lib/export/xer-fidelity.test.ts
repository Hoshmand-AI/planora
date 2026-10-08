import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { Schedule } from '@/lib/db'
import { parseXER, readXerTables, xerResourceCounts } from '@/lib/parsers/xer-parser'
import { runDcma } from '@/lib/analysis/dcma'
import { analyzableFromDb } from '@/lib/planning/service'
import { parseScheduleFile } from '@/lib/parsers'
import { decodeXer, encodeXer } from '@/lib/parsers/xer-codec'
import { completeSchedule } from '@/lib/planning/complete-schedule'
import { analyzeSchedule } from '@/lib/analysis/schedule-analysis'
import { uploadedToGenerated } from '@/lib/planning/uploaded'
import { generateSchedule } from '@/lib/planning/generator'
import type { Answer, AnswerValue } from '@/lib/planning/types'
import { compareSchedules } from '@/lib/analysis/compare'
import { exportXer, exportXerFromOriginal, projShortName, xerUpdatesFrom, P6_NAME_MAX } from './xer'

const sample = fs.readFileSync(path.join(__dirname, '../parsers/__fixtures__/sample.xer'), 'latin1')

/** The sample file plus what real P6 exports carry: an LOE, Physical %, codes, UDFs, resources, a € calendar. */
function richXer(): string {
  const extra = [
    '%T\tACTVTYPE', '%F\tactv_code_type_id\tactv_short_len\tseq_num\tactv_code_type\tproj_id', '%R\t501\t10\t1\tArea\t1',
    '%T\tACTVCODE', '%F\tactv_code_id\tparent_actv_code_id\tactv_code_type_id\tactv_code_name\tshort_name\tseq_num', '%R\t601\t\t501\tNorth Building\tN\t1',
    '%T\tTASKACTV', '%F\ttask_id\tactv_code_type_id\tactv_code_id\tproj_id', '%R\t1004\t501\t601\t1',
    '%T\tUDFTYPE', '%F\tudf_type_id\ttable_name\tudf_type_name\tudf_type_label\tlogical_data_type', '%R\t701\tTASK\tuser_field_1\tCost Code\tFT_Text',
    '%T\tUDFVALUE', '%F\tudf_type_id\tfk_id\tproj_id\tudf_text', '%R\t701\t1004\t1\t03-30-00',
    '%T\tRSRC', '%F\trsrc_id\trsrc_name\trsrc_short_name\trsrc_type', '%R\t801\tConcrete Crew\tCONC\tRT_Labor',
    '%T\tTASKRSRC', '%F\ttaskrsrc_id\ttask_id\tproj_id\trsrc_id\ttarget_qty', '%R\t901\t1004\t1\t801\t64',
  ]
  return sample
    .replace('7 Day x 10h Earthwork', 'Équipe 7 jours € 10h')
    // An LOE spanning the work, with its own logic.
    .replace('%T\tTASKPRED', '%R\t1009\t1\t10\t100\t\tCP_Drtn\tTT_LOE\tTK_NotStart\tA1900\tGeneral Conditions\t\t\t480\t480\t\t\t\t\t\t2026-03-02 08:00\t2026-06-30 17:00\t\t\t\t\n%T\tTASKPRED')
    .replace('%E', '%R\t10\t1009\t1001\t1\t1\tPR_SS\t0\n' + extra.join('\n') + '\n%E')
    .replace(/\r?\n/g, '\r\n')
}

function load(text: string, id: string, fileName = 'rich.xer') {
  const p = parseXER(text, id)
  const done = completeSchedule({ activities: p.activities, relationships: p.relationships, calendars: p.calendars, defaultCalendarId: p.defaultCalendarId, projectStart: p.projectStart, projectFinish: p.projectFinish, dataDate: p.dataDate, mustFinishBy: p.mustFinishBy })
  const analysis = analyzeSchedule({ activities: done.activities, links: p.relationships.map(r => ({ from: r.predecessorId, to: r.successorId })), cpm: done.cpm, reportedFinish: p.projectFinish, mustFinishBy: p.mustFinishBy ?? null })
  const schedule = { id, name: p.projectName, version: 'Update 1', fileName, uploadedAt: '2026-10-01', projectStart: done.projectStart, dataDate: p.dataDate, calendars: p.calendars, defaultCalendarId: p.defaultCalendarId } as unknown as Schedule
  return { p, done, analysis, schedule }
}

describe('XER import checks', () => {
  it('warns on a duplicate task_id and keeps the first row', () => {
    const dup = sample.replace('%T\tTASKPRED', '%R\t1002\t1\t11\t100\t0\tCP_Phys\tTT_Task\tTK_NotStart\tA9999\tCopy of Mobilize\t\t\t8\t8\t\t\t\t\t\t\t\t\t\t\t\n%T\tTASKPRED')
    const p = parseXER(dup, 'd')
    expect(p.warnings.some(w => /repeats task_id 1002 \(A9999\)/.test(w))).toBe(true)
    expect(p.activities.some(a => a.activityId === 'A9999')).toBe(false)
    expect(p.activities.find(a => a.activityId === 'A1010')).toBeDefined()
  })

  it('clamps a negative percent complete to 0 with a warning', () => {
    const neg = sample.replace('1004\t1\t12\t100\t0\t', '1004\t1\t12\t100\t-15\t')
    const p = parseXER(neg, 'n')
    expect(p.activities.find(a => a.activityId === 'A1030')!.percentComplete).toBe(0)
    expect(p.warnings.some(w => /A1030: percent complete -15 is outside 0–100; set to 0/.test(w))).toBe(true)
  })

  it('names the tables Planora does not model and counts resource assignments', () => {
    const p = parseXER(richXer(), 'r')
    const w = p.warnings.find(x => x.startsWith('Not used in Planora'))!
    for (const t of ['ACTVTYPE', 'ACTVCODE', 'TASKACTV', 'UDFTYPE', 'UDFVALUE']) expect(w).toContain(t)
    // Resources and assignments are read (resource analysis), so they are not listed as unused.
    for (const t of ['RSRC', 'TASKRSRC']) expect(w).not.toMatch(new RegExp(`\\b${t} \\(`))
    expect(p.resources?.assignments).toHaveLength(1)
    expect(p.resourceCounts).toMatchObject({ '1004': 1, '1003': 0 })
    expect(parseXER(sample, 's').resourceCounts).toBeUndefined()
  })

  it('DCMA #10 assesses resource loading when the file has TASKRSRC rows', () => {
    const text = richXer()
    const x = load(text, 'r2')
    const counts = xerResourceCounts(text)!
    const check10 = (rc?: Record<string, number> | null) => runDcma(analyzableFromDb(x.schedule, x.done.activities, x.p.relationships, rc)).checks.find(c => c.id === 10)!
    expect(check10().result).toBe('n/a')
    expect(check10(counts).result).not.toBe('n/a')
    expect(JSON.stringify(check10(counts))).not.toMatch(/no resource data/)
  })
})

describe('XER export of an uploaded P6 file (original passed through)', () => {
  const text = richXer()
  const bytes = encodeXer(text, 'windows-1252')
  const a = load(text, 's1')
  const out = exportXerFromOriginal(text, xerUpdatesFrom(a.done.activities, a.done.cpm!), { forecastFinish: a.analysis.forecastFinish })
  const inT = readXerTables(text), outT = readXerTables(out)

  it('keeps calendar ids, names and work hours (no renumbering, no rewritten hours)', () => {
    expect(outT['CALENDAR']).toEqual(inT['CALENDAR'])
    const b = load(out, 's2')
    expect(b.p.calendars.map(c => [c.id, c.name, c.hoursPerDay])).toEqual(a.p.calendars.map(c => [c.id, c.name, c.hoursPerDay]))
    // Compare after a round trip reports no calendar change at all.
    const side = (x: typeof a) => ({ schedule: { id: x.schedule.id, name: 'R', version: x.schedule.id, dataDate: x.p.dataDate, forecastFinish: x.analysis.forecastFinish }, activities: x.done.activities, relationships: x.p.relationships, calendars: x.p.calendars, defaultCalendarId: x.p.defaultCalendarId })
    const cmp = compareSchedules(side(a), side(b))
    expect(cmp.changes.filter(c => c.field === 'calendar')).toEqual([])
    expect(cmp.calendarChanges).toEqual([])
  })

  it('keeps percent-complete type, LOE activities and their logic, milestone types, baselines and the WBS root', () => {
    const fields = ['task_id', 'task_code', 'task_name', 'complete_pct_type', 'task_type', 'clndr_id', 'wbs_id', 'target_start_date', 'target_end_date', 'act_start_date', 'act_end_date', 'phys_complete_pct', 'status_code']
    const pick = (rows: Record<string, string>[]) => rows.map(r => fields.map(f => r[f]))
    expect(pick(outT['TASK'])).toEqual(pick(inT['TASK']))
    expect(outT['TASK'].find(t => t['task_code'] === 'A1900')!['task_type']).toBe('TT_LOE')
    expect(outT['TASK'].find(t => t['task_code'] === 'A1000')!['task_type']).toBe('TT_Mile')
    expect(outT['TASK'].find(t => t['task_code'] === 'A1070')!['task_type']).toBe('TT_FinMile')
    expect(outT['TASKPRED']).toEqual(inT['TASKPRED'])
    expect(outT['PROJWBS']).toEqual(inT['PROJWBS'])
    expect(outT['PROJECT'][0]['proj_short_name']).toBe('Riverside Warehouse')
  })

  it('carries activity codes, UDFs and resources through unchanged', () => {
    for (const t of ['ACTVTYPE', 'ACTVCODE', 'TASKACTV', 'UDFTYPE', 'UDFVALUE', 'RSRC', 'TASKRSRC']) expect(outT[t]).toEqual(inT[t])
  })

  it('writes Planora dates and float on open activities, keeps the file times, flags the driving path', () => {
    const cpm = a.done.cpm!
    const byCode = new Map(a.done.activities.map(x => [x.activityId, x]))
    const row = (code: string) => outT['TASK'].find(t => t['task_code'] === code)!
    const t1050 = cpm.times[byCode.get('A1050')!.id]
    expect(row('A1050')['early_start_date'].slice(0, 10)).toBe(t1050.earlyStart)
    expect(row('A1050')['early_end_date'].slice(0, 10)).toBe(t1050.earlyFinish)
    expect(Number(row('A1050')['total_float_hr_cnt'])).toBe(t1050.totalFloat * 8)
    // The 10h calendar's finish time (17:30) is kept, not rewritten to an 08:00-based day.
    expect(row('A1020')['early_end_date']).toMatch(/ 17:30$/)
    // Completed activities are left exactly as reported.
    expect(row('A1010')).toEqual(inT['TASK'].find(t => t['task_code'] === 'A1010'))
    const driving = new Set(cpm.longestPath.map(id => a.done.activities.find(x => x.id === id)!.activityId))
    for (const r of outT['TASK']) if (r['status_code'] !== 'TK_Complete' && r['task_type'] !== 'TT_LOE') expect(r['driving_path_flag']).toBe(driving.has(r['task_code']) ? 'Y' : 'N')
  })

  it('round-trips a non-ASCII calendar name through Windows-1252 bytes', async () => {
    expect(bytes.includes(0x80)).toBe(true) // € is 0x80 in Windows-1252
    const dec = decodeXer(bytes)
    expect(dec.encoding).toBe('windows-1252')
    const again = encodeXer(exportXerFromOriginal(dec.text, new Map()), dec.encoding)
    expect(Buffer.compare(again, bytes)).toBe(0)
    const p = await parseScheduleFile('x.xer', again, 'enc')
    expect(p.calendars.map(c => c.name)).toContain('Équipe 7 jours € 10h')
  })
})

describe('XER export built from Planora\'s model', () => {
  it('keeps numeric calendar ids, does not invent baselines, truncates long names, flags the driving path', () => {
    const a = load(sample, 'm', 'sample.xer')
    const g = uploadedToGenerated(a.schedule, a.done.activities, a.p.relationships, a.done.cpm, a.analysis)
    g.activities[3].name = 'X'.repeat(200)
    const out = readXerTables(exportXer(g, a.p.projectName, { projectShortName: a.p.projectName }))
    expect(out['CALENDAR'].map(c => c['clndr_id']).sort()).toEqual(['100', '200'])
    expect(out['TASK'].every(t => t['task_name'].length <= P6_NAME_MAX)).toBe(true)
    // A1030 had no baseline/planned dates in the file; none are invented.
    expect(out['TASK'].find(t => t['task_code'] === 'A1030')!['target_start_date']).toBe('')
    const longest = new Set(a.done.cpm!.longestPath.map(id => a.done.activities.find(x => x.id === id)!.activityId))
    for (const t of out['TASK']) expect(t['driving_path_flag']).toBe(longest.has(t['task_code']) ? 'Y' : 'N')
    expect(out['PROJECT'][0]['proj_short_name']).toBe('Riverside Warehouse')
  })

  it('uses the project name as the P6 project ID, cut at a word boundary', () => {
    expect(projShortName('Riverside Warehouse & Yard (Phase 2)')).toBe('Riverside Warehouse & Yard (Phase 2)')
    expect(projShortName('Build a Data Center Schedule in Ashburn Virginia')).toBe('Build a Data Center Schedule in Ashburn')
  })

  it('writes override reasons to the activity notebook (TASKMEMO)', () => {
    const k = (value: AnswerValue): Answer => ({ status: 'known', value, answeredAt: '2026-01-01T00:00:00Z' })
    const g = generateSchedule({ answers: { 'project.type': k('warehouse_industrial'), 'project.state': k('VA'), 'project.target_start': k('2026-11-02') }, today: '2026-09-30' })
    const act = g.activities[2]
    act.overrides = [{ field: 'duration', from: 10, to: 15, reason: 'Owner asked for <extra> curing', by: 'ana@example.com', at: '2026-10-01T00:00:00Z' }]
    const out = readXerTables(exportXer(g, 'Memo test'))
    expect(out['MEMOTYPE']).toHaveLength(1)
    const taskId = out['TASK'].find(t => t['task_code'] === act.code)!['task_id']
    const memo = out['TASKMEMO'].find(m => m['task_id'] === taskId)!
    expect(memo['task_memo']).toContain('Owner asked for &lt;extra&gt; curing')
    expect(readXerTables(exportXer({ ...g, activities: g.activities.map(x => ({ ...x, overrides: undefined })) }, 'No memo'))['TASKMEMO']).toBeUndefined()
  })
})
