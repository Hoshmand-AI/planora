// Line-by-line review, round 2 (medium findings M1 to M6 and M8) for the exports.
import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import type { Activity, Relationship } from '@/lib/db'
import type { GeneratedSchedule } from '@/lib/planning/types'
import { defaultCalendar } from '@/lib/planning/calendar'
import { runTia, type DelayEvent, type TiaNetwork } from '@/lib/analysis/tia'
import { parseXER, readXerTables, xerCalendarTimes } from '@/lib/parsers/xer-parser'
import { buildWbs, sourceWbsSplitter } from './wbs'
import { exportMarking, markFilledSheet, markXer, XerMarkingError } from './markings'
import { exportImportXlsx, exportP6LayoutXlsx, P6_LAYOUT_STYLED_CELLS } from './xlsx'
import { exportLookaheadXlsx, type LookaheadRow } from './analysis-xlsx'
import { exportTiaXlsx } from './tia-report'
import { buildIpmdarSpd } from './ipmdar-spd'
import { clndrData, exportXer, exportXerFromOriginal, xerEditsFrom, xerWorkPeriods } from './xer'
import { exportExceptions } from './exceptions'
import type { Provenance } from './provenance'

const cui = exportMarking('cui', { controlledBy: 'Alpha Builders', poc: 'Ana Scheduler' })!
const prov: Provenance = { sources: [{ scheduleName: 'Clinic', version: 'Update 4', fileName: 'u4.xer', sha256: 'abc', dataDate: '2026-01-05', progressMode: 'retained' }], release: 'test', settings: [], generatedAt: '2026-01-14T10:00:00.000Z' }
const load = async (buf: Buffer) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as unknown as ArrayBuffer); return wb }

/** A small uploaded-style schedule: one activity per WBS path given. */
function sched(wbs: string[], over: Partial<GeneratedSchedule> = {}, count = wbs.length): GeneratedSchedule {
  const acts = Array.from({ length: count }, (_, i) => ({ id: `a${i}`, code: `A${i}`, name: `Act ${i}`, duration: 5, type: 'task', wbs: wbs[i % wbs.length], category: 'other', phase: 'structure', rationale: { summary: 'x', sources: [], confidence: 'medium' } }))
  const times: Record<string, unknown> = {}
  for (const a of acts) times[a.id] = { earlyStart: '2026-01-05', earlyFinish: '2026-01-09', lateStart: '2026-01-05', lateFinish: '2026-01-09', totalFloat: 0, freeFloat: 0, critical: true }
  return { projectStart: '2026-01-05', activities: acts, links: [], calendars: [{ id: 'x', name: 'Standard', workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidays: [] }], defaultCalendarId: 'x', assumptions: [], cpm: { times, projectFinish: '2026-01-09', longestPath: [], criticalPath: [] }, ...over } as unknown as GeneratedSchedule
}

describe('M1: WBS codes and band names with spaces are not merged', () => {
  it('spreadsheet bands "Level 1" and "Level 2" stay two nodes with their own names', () => {
    const { nodes } = buildWbs(sched(['Level 1', 'Level 2']), 'Pilot')
    expect(nodes.map(n => n.name)).toEqual(['Level 1', 'Level 2'])
    expect(new Set(nodes.map(n => n.code)).size).toBe(2)
    expect(nodes.every(n => n.activities.length === 1)).toBe(true)
  })
  it('P6 short names with spaces keep their hierarchy', () => {
    const { nodes } = buildWbs(sched(['Site Work.Area A Area A North', 'Site Work.Area B Area B South']), 'Pilot')
    expect(nodes.map(n => n.name)).toEqual(['Site Work'])
    expect(nodes[0].children).toHaveLength(2)
    expect(nodes[0].children.every(c => c.activities.length === 1)).toBe(true)
  })
  it('ordinary "code name" paths are read as before', () => {
    const { nodes } = buildWbs(sched(['1.1 Foundations', '1.2 Structure', '2 Closeout', '1.1 Foundations']), 'Pilot')
    expect(nodes.map(n => [n.code, n.name])).toEqual([['P.1', '1'], ['P.2', 'Closeout']])
    expect(nodes[0].children.map(c => [c.code, c.name, c.activities.length])).toEqual([['P.1.1', 'Foundations', 2], ['P.1.2', 'Structure', 1]])
    // A summary's own bare code ("1") next to its children's "1 Sitework" is not a disagreement.
    const split = sourceWbsSplitter(['1', '1 Sitework', '1 Sitework'])
    expect(split('1 Sitework')).toEqual({ code: '1', name: 'Sitework' })
  })
  it('IPMDAR WBSElementID and the rebuilt XER carry the whole code', () => {
    const s = sched(['Level 1', 'Level 2'])
    const spd = buildIpmdarSpd(s, { projectName: 'Pilot', securityMarking: 'UNCLASSIFIED' })
    const tasks = JSON.parse(spd.files['Tasks.json']) as { ID: string; WBSElementID?: string }[]
    expect(tasks.filter(t => /^A\d$/.test(t.ID)).map(t => t.WBSElementID)).toEqual(['Level 1', 'Level 2'])
    const wbs = readXerTables(exportXer(s, 'Pilot'))['PROJWBS']
    expect(wbs.filter(r => r['proj_node_flag'] !== 'Y').map(r => r['wbs_short_name'])).toEqual(['Level 1', 'Level 2'])
  })
})

describe('M2: the CUI banner rows are on every sheet of every workbook', () => {
  const marked = (wb: ExcelJS.Workbook) => {
    expect(wb.worksheets.length).toBeGreaterThan(1)
    for (const ws of wb.worksheets) {
      expect(`${ws.name}: ${String(ws.getRow(1).getCell(1).value)}`).toBe(`${ws.name}: CUI`)
      expect(String(ws.getRow(2).getCell(1).value)).toContain('Controlled by: Alpha Builders')
      expect(ws.headerFooter.oddHeader).toContain('CUI')
    }
  }
  it('schedule workbooks: the Provenance sheet is marked too', async () => {
    const s = sched(['1 A', '2 B'])
    marked(await load(await exportImportXlsx(s, 'Pilot', { marking: cui, prov })))
    marked(await load(await exportP6LayoutXlsx(s, 'Pilot', { marking: cui, prov })))
    const plain = await load(await exportImportXlsx(s, 'Pilot', { prov }))
    expect(String(plain.getWorksheet('Provenance')!.getRow(1).getCell(1).value)).toBe('Item')
  })
  it('analysis workbooks: every sheet, with the header, frozen pane and filter moved down', async () => {
    const rows: LookaheadRow[] = [{ code: 'A1', name: 'Pour', wbs: '1', status: 'Not Started', start: '2026-01-06', finish: '2026-01-09', duration: 4, remaining: 4, totalFloat: 0, critical: true, predecessors: '', constraint: '' }]
    const wb = await load(await exportLookaheadXlsx(rows, prov, { project: 'Clinic', dataDate: '2026-01-05' }, cui))
    marked(wb)
    const ws = wb.worksheets[1]
    expect(String(ws.getRow(3).getCell(1).value)).toContain('Clinic: activities in progress')
    expect(ws.getRow(4).getCell(1).value).toBe('Activity ID')
    expect(ws.getRow(5).getCell(1).value).toBe('A1')
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 4 })
    expect(JSON.stringify(ws.autoFilter)).toMatch(/A4/)
    // Unmarked workbooks are as before.
    const plain = (await load(await exportLookaheadXlsx(rows, prov, { project: 'Clinic', dataDate: '2026-01-05' }))).worksheets[1]
    expect(plain.getRow(2).getCell(1).value).toBe('Activity ID')
    expect(plain.views[0]).toMatchObject({ state: 'frozen', ySplit: 2 })
  })
  it('TIA workbook: every sheet', async () => {
    const act = (id: string, name: string, duration: number): Activity => ({
      id, scheduleId: 's1', activityId: id, name, wbs: '', duration, remainingDuration: duration, percentComplete: 0,
      earlyStart: null, earlyFinish: null, lateStart: null, lateFinish: null, actualStart: null, actualFinish: null, baselineStart: null, baselineFinish: null,
      totalFloat: 0, freeFloat: 0, isCritical: false, status: 'not_started', activityType: duration === 0 ? 'milestone' : 'task',
      milestoneKind: duration === 0 ? 'finish' : null, calendarId: 'default-5d', constraintType: null, constraintDate: null, category: null, sourceId: null,
    })
    const rel = (p: string, s: string): Relationship => ({ id: `${p}-${s}`, scheduleId: 's1', predecessorId: p, successorId: s, type: 'FS', lag: 0 })
    const net: TiaNetwork = {
      scheduleId: 's1', scheduleName: 'Clinic', version: 'Update 4', activities: [act('A', 'Excavation', 10), act('B', 'Structure', 10), act('SC', 'Substantial Completion', 0)],
      relationships: [rel('A', 'B'), rel('B', 'SC')], calendars: [defaultCalendar()], defaultCalendarId: 'default-5d', projectStart: '2026-01-05', dataDate: '2026-01-05', mustFinishBy: null, progressMode: 'retained',
    }
    const fragnet = { activities: [{ code: 'F1', name: 'Rock removal', duration: 5 }], relationships: [{ from: 'A', to: 'F1', type: 'FS' as const, lag: 0 }, { from: 'F1', to: 'B', type: 'FS' as const, lag: 0 }] }
    const event: DelayEvent = {
      id: 'e1', scheduleId: 's1', title: 'Unforeseen rock', description: 'Rock found at grid C.', responsibility: 'owner', eventStart: '2026-01-12', eventEnd: null, notifiedOn: '2026-01-13',
      evidence: [{ label: 'RFI 042', url: null }], fragnet, status: 'analyzed', statusNote: null,
      createdBy: 'u1', updatedBy: 'u1', createdAt: '2026-01-14T00:00:00.000Z', updatedAt: '2026-01-14T00:00:00.000Z',
    }
    const { result } = runTia(net, { title: event.title, responsibility: event.responsibility, eventStart: event.eventStart, fragnet })
    const run = { id: 'r1', createdAt: '2026-01-14T10:00:00.000Z', createdBy: 'u1', createdByName: 'Ana', inputsHash: result.inputsHash, resultHash: result.resultHash, engine: result.engine, result }
    const wb = await load(await exportTiaXlsx({ event, run, provenance: prov }, prov, cui))
    marked(wb)
    const fr = wb.getWorksheet('Fragnet')!
    expect(fr.getRow(3).getCell(1).value).toBe('ID')
    expect(fr.getRow(4).getCell(1).value).toBe('F1')
    expect(fr.views[0]).toMatchObject({ state: 'frozen', ySplit: 3 })
  })
  it('markFilledSheet keeps the header styling and does nothing without a marking', () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('S')
    ws.columns = [{ header: 'Item', key: 'k' }]
    ws.addRow({ k: 'v' })
    ws.getRow(1).getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2140' } }
    expect(markFilledSheet(ws, null)).toBe(0)
    expect(ws.getRow(1).getCell(1).value).toBe('Item')
    expect(markFilledSheet(ws, cui)).toBe(2)
    expect(ws.getRow(3).getCell(1).value).toBe('Item')
    expect(ws.getRow(3).getCell(1).fill).toMatchObject({ fgColor: { argb: 'FF0F2140' } })
    expect(ws.getRow(4).getCell(1).value).toBe('v')
  })
})

describe('M3: a CUI XER never goes out unmarked', () => {
  const xer = (wbs: string[]) => ['ERMHDR\t19.12', '%T\tPROJECT', '%F\tproj_id\tproj_short_name', '%R\t1\tP1', ...wbs, '%T\tTASK', '%F\ttask_id\tproj_id\twbs_id\ttask_code', '%R\t10\t1\t8\tA', '%E', ''].join('\r\n')
  it('no project node: the first top-level WBS node carries the marking', () => {
    const src = xer(['%T\tPROJWBS', '%F\twbs_id\tproj_id\tproj_node_flag\twbs_short_name\tparent_wbs_id', '%R\t9\t1\tN\tB\t8', '%R\t8\t1\tN\tA\t'])
    const t = readXerTables(markXer(src, cui))
    expect(t['WBSMEMO']).toHaveLength(1)
    expect(t['WBSMEMO'][0]['wbs_id']).toBe('8')
    expect(t['WBSMEMO'][0]['wbs_memo']).toContain('CUI')
    expect(t['MEMOTYPE'][0]['memo_type']).toBe('CUI Marking')
  })
  it('no WBS at all: refused, not returned unmarked', () => {
    expect(() => markXer(xer([]), cui)).toThrow(XerMarkingError)
    expect(() => markXer(xer(['%T\tPROJWBS', '%F\twbs_id\tproj_id\tproj_node_flag\twbs_short_name']), cui)).toThrow(/cannot be exported as XER/)
    // Unmarked exports are untouched.
    expect(markXer(xer([]), null)).toBe(xer([]))
  })
  it('a project node is still preferred', () => {
    const src = xer(['%T\tPROJWBS', '%F\twbs_id\tproj_id\tproj_node_flag\twbs_short_name\tparent_wbs_id', '%R\t8\t1\tN\tA\t7', '%R\t7\t1\tY\tP1\t'])
    const t = readXerTables(markXer(src, cui))
    expect(t['WBSMEMO'].map(r => r['wbs_id'])).toEqual(['7'])
  })
})

describe('M4: IPMDAR warns when level-of-effort activities are left out', () => {
  it('names the omitted activities; says nothing when there are none', () => {
    const s = sched(['1 A', '2 B'])
    const w = buildIpmdarSpd(s, { projectName: 'Pilot', securityMarking: 'UNCLASSIFIED', omittedLevelOfEffort: ['LOE-100', 'LOE-200'] }).warnings
    expect(w.find(x => /level-of-effort/.test(x))).toMatch(/2 level-of-effort activities are not in this dataset.*LOE-100, LOE-200/)
    expect(buildIpmdarSpd(s, { projectName: 'Pilot', securityMarking: 'UNCLASSIFIED' }).warnings.some(x => /not in this dataset/.test(x))).toBe(false)
    expect(buildIpmdarSpd(s, { projectName: 'Pilot', securityMarking: 'UNCLASSIFIED', omittedLevelOfEffort: [] }).warnings.some(x => /not in this dataset/.test(x))).toBe(false)
  })
})

describe('M5: a link edit changes one relationship of a pair, not all of them', () => {
  const original = [
    'ERMHDR\t19.12', '%T\tTASK', '%F\ttask_id\tproj_id\tclndr_id\ttask_code\tstatus_code', '%R\t1\t1\t\tA\tTK_NotStart', '%R\t2\t1\t\tB\tTK_NotStart', '%R\t3\t1\t\tC\tTK_NotStart',
    '%T\tTASKPRED', '%F\ttask_pred_id\ttask_id\tpred_task_id\tproj_id\tpred_proj_id\tpred_type\tlag_hr_cnt',
    '%R\t100\t2\t1\t1\t1\tPR_SS\t0', '%R\t101\t2\t1\t1\t1\tPR_FF\t0', '%R\t102\t3\t2\t1\t1\tPR_FS\t0', '%E', '',
  ].join('\r\n')
  const acts = [{ id: 'a', sourceId: '1' }, { id: 'b', sourceId: '2' }, { id: 'c', sourceId: '3' }]
  const preds = (x: string) => readXerTables(x)['TASKPRED'].map(r => `${r['pred_task_id']}>${r['task_id']} ${r['pred_type']} ${r['lag_hr_cnt']}`)
  const out = (changes: Record<string, unknown>[]) => preds(exportXerFromOriginal(original, new Map(), { edits: xerEditsFrom(acts, changes.map(change => ({ status: 'applied' as const, change })) as Parameters<typeof xerEditsFrom>[1]) }))
  it('link_set rewrites the first relationship of the pair only', () => {
    expect(out([{ kind: 'link_set', predecessorId: 'a', successorId: 'b', type: 'SS', lag: 2 }])).toEqual(['1>2 PR_SS 16', '1>2 PR_FF 0', '2>3 PR_FS 0'])
  })
  it('link_remove drops the first relationship of the pair only', () => {
    expect(out([{ kind: 'link_remove', predecessorId: 'a', successorId: 'b' }])).toEqual(['1>2 PR_FF 0', '2>3 PR_FS 0'])
  })
  it('edits are replayed in order, as RunF9 applied them', () => {
    // Remove the SS, then set: the remaining (FF) relationship is the one changed.
    expect(out([{ kind: 'link_remove', predecessorId: 'a', successorId: 'b' }, { kind: 'link_set', predecessorId: 'a', successorId: 'b', type: 'FS', lag: 1 }])).toEqual(['1>2 PR_FS 8', '2>3 PR_FS 0'])
    // Remove both, then set: a new row is added.
    expect(out([{ kind: 'link_remove', predecessorId: 'a', successorId: 'b' }, { kind: 'link_remove', predecessorId: 'a', successorId: 'b' }, { kind: 'link_set', predecessorId: 'a', successorId: 'b', type: 'SF', lag: 0 }])).toEqual(['2>3 PR_FS 0', '1>2 PR_SF 0'])
    // A new link, then removed again: nothing is added.
    expect(out([{ kind: 'link_set', predecessorId: 'a', successorId: 'c', type: 'FS', lag: 0 }, { kind: 'link_remove', predecessorId: 'a', successorId: 'c' }])).toEqual(['1>2 PR_SS 0', '1>2 PR_FF 0', '2>3 PR_FS 0'])
  })
  it('hand-built edits without the ordered list still work, one row per edit', () => {
    const x = exportXerFromOriginal(original, new Map(), { edits: { tasks: new Map(), setLinks: [{ pred: '2', succ: '3', type: 'SS', lagDays: 1 }, { pred: '1', succ: '3', type: 'FS', lagDays: 0 }], removeLinks: [{ pred: '1', succ: '2' }] } })
    expect(preds(x)).toEqual(['1>2 PR_FF 0', '2>3 PR_SS 8', '1>3 PR_FS 0'])
  })
})

describe('M6: long work days in the rebuilt XER have real clock times', () => {
  const cal = (h: number) => ({ id: 'c', name: `${h}h`, workDays: [0, 1, 2, 3, 4, 5, 6], hoursPerDay: h, holidays: [] }) as unknown as GeneratedSchedule['calendars'][number]
  const times = (h: number) => [...clndrData(cal(h)).matchAll(/s\|(\d\d:\d\d)\|f\|(\d\d:\d\d)/g)].slice(0, 2).map(m => `${m[1]}-${m[2]}`)
  it('no time of day is past 23:59', () => {
    for (let h = 1; h <= 24; h++) for (const m of clndrData(cal(h)).matchAll(/[sf]\|(\d\d):(\d\d)/g)) expect(Number(m[1])).toBeLessThan(24)
  })
  it('24-hour and 16-hour calendars are one period from midnight; ordinary days are unchanged', () => {
    expect(clndrData(cal(24))).toContain('(0||0(s|00:00|f|00:00)())')
    expect(times(16)[0]).toBe('00:00-16:00')
    expect(times(15)).toEqual(['08:00-12:00', '13:00-00:00'])
    expect(times(8)).toEqual(['08:00-12:00', '13:00-17:00'])
    expect(times(10)).toEqual(['08:00-12:00', '13:00-19:00'])
    expect(clndrData(cal(6))).toContain('(0||0(s|08:00|f|14:00)())')
    expect(xerWorkPeriods(24)).toEqual([[0, 24]])
  })
  it('a 24-hour calendar survives the round trip and is not reported as converted', () => {
    const s = sched(['1 A'], { calendars: [{ ...cal(24), workTimes: [{ from: '00:00', to: '00:00' }] }], defaultCalendarId: 'c' } as Partial<GeneratedSchedule>)
    const x = exportXer(s, 'Pilot')
    const row = readXerTables(x)['CALENDAR'][0]
    expect(xerCalendarTimes(row)).toMatchObject({ hoursPerDay: 24, start: '00:00', finish: '23:59' })
    expect(parseXER(x, 's1').calendars[0].hoursPerDay).toBe(24)
    expect(exportExceptions(s, 'xer').records.some(r => r.field.includes('work times'))).toBe(false)
    // Finish times of day on a 16-hour calendar end with its work period.
    const s16 = sched(['1 A'], { calendars: [cal(16)], defaultCalendarId: 'c' } as Partial<GeneratedSchedule>)
    expect(readXerTables(exportXer(s16, 'Pilot'))['TASK'][0]['early_end_date']).toBe('2026-01-09 16:00')
  })
})

describe('M8: P6 layout on very large schedules', () => {
  const gridCell = async (s: GeneratedSchedule) => {
    const ws = (await load(await exportP6LayoutXlsx(s, 'Pilot'))).getWorksheet('Schedule')!
    let row = 0
    ws.eachRow((r, n) => { if (!row && r.getCell(1).value === 'A0') row = n })
    // A time-scale cell far from the bar (bars are in the first week).
    return { data: ws.getRow(row).getCell(1), grid: ws.getRow(row).getCell(8 + 200), bar: ws.getRow(row).getCell(8) }
  }
  it('normal schedules keep the grid in the time scale', async () => {
    const s = sched(['1 A', '2 B'])
    s.cpm!.projectFinish = '2036-01-04'
    const c = await gridCell(s)
    expect(c.grid.border?.bottom?.style).toBe('hair')
    expect(c.data.border?.bottom?.style).toBe('hair')
  })
  it('past the cell budget only the bars are drawn in the time scale', async () => {
    const n = Math.ceil(P6_LAYOUT_STYLED_CELLS / 520) + 50
    const s = sched(['1 A', '2 B'], {}, n)
    s.cpm!.projectFinish = '2036-01-04'
    const t0 = Date.now()
    const c = await gridCell(s)
    expect(c.grid.border?.bottom).toBeUndefined()
    expect(c.data.border?.bottom?.style).toBe('hair')
    expect((c.bar.fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFE0301E')
    expect(Date.now() - t0).toBeLessThan(20_000)
  }, 60_000)
})
