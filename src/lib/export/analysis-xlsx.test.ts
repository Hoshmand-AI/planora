import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import type { Activity, Relationship } from '@/lib/db'
import { makeActivity } from '@/lib/parsers/types'
import { compareSchedules, type CompareSide } from '@/lib/analysis/compare'
import { exportComparisonXlsx, exportLookaheadXlsx, lookaheadRows, COMPARISON_SHEETS } from '@/lib/export/analysis-xlsx'
import { exportP6LayoutXlsx } from '@/lib/export/xlsx'
import type { Provenance } from '@/lib/export/provenance'
import { parseReviewInput } from '@/lib/analysis/review'
import type { GeneratedSchedule } from '@/lib/planning/types'
import { defaultCalendar } from '@/lib/planning/calendar'

const a = (sched: string, code: string, f: Partial<Activity> = {}) => makeActivity(sched, { activityId: code, name: code, duration: 5, ...f })
const rel = (sched: string, p: Activity, s: Activity, lag = 0): Relationship => ({ id: `${p.id}${s.id}`, scheduleId: sched, predecessorId: p.id, successorId: s.id, type: 'FS', lag })
const prov: Provenance = {
  sources: [
    { role: 'Earlier update', scheduleName: 'Riverside', version: 'Update 5', fileName: 'upd5.xer', sha256: '1'.repeat(64), dataDate: '2026-03-02', progressMode: 'retained' },
    { role: 'Later update', scheduleName: 'Riverside', version: 'Update 6', fileName: 'upd6.xer', sha256: '2'.repeat(64), dataDate: '2026-04-01', progressMode: 'retained' },
  ],
  release: 'abc1234', settings: ['CPM recalculation by Planora'], generatedAt: '2026-10-06T12:00:00.000Z',
}
const load = async (buf: Buffer) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as unknown as ArrayBuffer); return wb }

// Update 5 -> 6: A200's duration grows on the driving path, an MFO is added to the finish milestone,
// logic A300 -> A400 is replaced, and an activity is named like a spreadsheet formula.
const b1 = a('b', 'A100', { actualStart: '2026-03-02', actualFinish: '2026-03-06', status: 'complete' })
const b2 = a('b', 'A200', { earlyFinish: '2026-03-20', totalFloat: 0 })
const b3 = a('b', 'A300', { earlyFinish: '2026-03-27', totalFloat: 0 })
const b4 = a('b', 'F900', { activityType: 'milestone', duration: 0, earlyFinish: '2026-03-27' })
const before: CompareSide = {
  schedule: { id: 'B', name: 'Riverside', version: 'Update 5', dataDate: '2026-03-02', forecastFinish: '2026-03-27' },
  activities: [b1, b2, b3, b4], relationships: [rel('b', b1, b2), rel('b', b2, b3), rel('b', b3, b4)], longestPath: [b2.id, b3.id, b4.id],
  finishMilestone: { code: 'F900', forecastFinish: '2026-03-27' },
}
const c1 = a('c', 'A100', { actualStart: '2026-03-02', actualFinish: '2026-03-06', status: 'complete' })
const c2 = a('c', 'A200', { duration: 9, earlyFinish: '2026-03-26', totalFloat: -2 })
const c3 = a('c', 'A300', { earlyFinish: '2026-04-02', totalFloat: -2, name: '=HYPERLINK("http://x","click")' })
const c4 = a('c', 'F900', { activityType: 'milestone', duration: 0, earlyFinish: '2026-03-27', constraintType: 'MFO', constraintDate: '2026-03-27' })
const after: CompareSide = {
  schedule: { id: 'C', name: 'Riverside', version: 'Update 6', dataDate: '2026-04-01', forecastFinish: '2026-04-02' },
  activities: [c1, c2, c3, c4], relationships: [rel('c', c1, c2), rel('c', c2, c3), rel('c', c3, c4, 1)], longestPath: [c4.id],
  logicLongestPath: [c2.id, c3.id, c4.id],
  finishMilestone: { code: 'F900', forecastFinish: '2026-04-03' },
  violations: [{ id: c4.id, type: 'MFO', constraintDate: '2026-03-27', logicDate: '2026-04-03', days: 5 }],
}
const cmp = compareSchedules(before, after)

describe('compare: finish attribution and the logic-driven finish', () => {
  it('attributes finish movement to mandatory constraints, driving-path durations and logic', () => {
    expect(cmp.finishCauses.filter(x => x.kind === 'mandatory_constraint')).toEqual([expect.objectContaining({ code: 'F900', detail: expect.stringMatching(/mandatory constraint added: none → MFO 2026-03-27 \(overrules logic\)/) })])
    expect(cmp.finishCauses.filter(x => x.kind === 'driving_duration')).toEqual([expect.objectContaining({ code: 'A200', delta: 4 })])
    expect(cmp.finishCauses.filter(x => x.kind === 'driving_logic').map(x => x.detail)).toEqual(['lag A300 → F900 FS 0 → 1'])
    expect(cmp.summary.join(' ')).toMatch(/Likely causes of the finish movement: 1 mandatory constraint change \(F900\); 1 duration change on the driving path \(\+4 work days: A200\); 1 logic change touching the driving path \(F900\)/)
  })
  it('shows the logic-driven finish next to the constrained one', () => {
    expect(cmp.finishBasis.after).toEqual({ code: 'F900', type: 'MFO', constrainedFinish: '2026-03-27', logicFinish: '2026-04-03', days: 5 })
    expect(cmp.finishBasis.before).toBeNull()
    expect(cmp.summary.join(' ')).toMatch(/F900 is held by a Mandatory Finish at 03\/27\/2026; the logic-driven finish is 04\/03\/2026 \(5 work days later\)/)
  })
})

describe('compare XLSX export', () => {
  it('has a provenance sheet first, one sheet per change category, both data dates and safe text', async () => {
    const wb = await load(await exportComparisonXlsx(cmp, prov))
    expect(wb.worksheets.map(w => w.name)).toEqual(['Provenance', ...COMPARISON_SHEETS])
    expect(wb.keywords).toContain(`sha256:${'1'.repeat(64)}`)
    expect(wb.keywords).toContain(`sha256:${'2'.repeat(64)}`)
    expect(wb.description).toContain('Planora version (release): abc1234')
    const pv = wb.getWorksheet('Provenance')!
    const pvText = pv.getSheetValues().flat().map(String).join(' ')
    expect(pvText).toContain('upd6.xer')
    expect(pvText).toContain('04/01/2026')

    const dur = wb.getWorksheet('Durations')!
    const head = (dur.getRow(1).values as unknown[]).map(String)
    expect(head).toContain('Before: Update 5 (data date 03/02/2026)')
    expect(head).toContain('After: Update 6 (data date 04/01/2026)')
    expect(head).toContain('Data date Update 5')
    expect((dur.getRow(2).values as unknown[]).slice(1, 7)).toEqual(['A200', 'A200', 'duration', 5, 9, 4])
    expect((dur.getRow(2).getCell(7).value as Date).toISOString().slice(0, 10)).toBe('2026-03-02')

    const cs = wb.getWorksheet('Constraints')!
    expect((cs.getRow(2).values as unknown[]).slice(1, 6)).toEqual(['F900', 'F900', 'constraint', '', 'MFO 03/27/2026'])
    const logic = wb.getWorksheet('Logic')!
    expect(logic.rowCount).toBe(2)
    // A name that looks like a formula stays text (CSV-injection guard).
    const dates = wb.getWorksheet('Dates')!
    const names = dates.getSheetValues().slice(2).map(r => (r as unknown[])[2])
    expect(names).toContain('\'=HYPERLINK("http://x","click")')
    for (const ws of wb.worksheets) ws.eachRow(r => r.eachCell(c => { expect(c.type).not.toBe(ExcelJS.ValueType.Formula) }))
  })
})

describe('XLSX provenance on schedule exports', () => {
  it('adds a Provenance sheet and metadata to the P6 layout workbook', async () => {
    const cal = defaultCalendar()
    const g: GeneratedSchedule = {
      generatedAt: '2026-03-01T00:00:00.000Z', projectStart: '2026-03-02', dataDate: '2026-03-02', calendars: [cal], defaultCalendarId: cal.id, assumptions: [], links: [],
      activities: [{ id: 'x', code: 'A1', name: 'Pour', duration: 5, type: 'task', calendarId: cal.id, category: 'other', phase: 'construction', rationale: { summary: 'r', sources: [], confidence: 'medium' } } as unknown as GeneratedSchedule['activities'][number]],
    }
    const one: Provenance = { ...prov, sources: [prov.sources[1]] }
    const wb = await load(await exportP6LayoutXlsx(g, 'Riverside', one))
    expect(wb.worksheets.map(w => w.name)).toEqual(['Schedule', 'Provenance'])
    expect(wb.keywords).toBe(`sha256:${'2'.repeat(64)}`)
    expect(String(wb.getWorksheet('Schedule')!.getCell(3, 1).value)).toMatch(/Source upd6\.xer · SHA-256 2{64} · Planora abc1234 · Retained logic/)
  })
})

describe('3-week look-ahead', () => {
  const s = 'u'
  const done = a(s, 'A100', { actualStart: '2026-03-02', actualFinish: '2026-03-06', status: 'complete' })
  const prog = a(s, 'A200', { actualStart: '2026-03-09', status: 'in_progress', remainingDuration: 3, earlyStart: '2026-03-09', earlyFinish: '2026-03-18', totalFloat: 0 })
  const soon = a(s, 'A300', { earlyStart: '2026-04-06', earlyFinish: '2026-04-10', totalFloat: 4, wbs: 'STR' })
  const edge = a(s, 'A350', { earlyStart: '2026-04-07', earlyFinish: '2026-04-08', totalFloat: 9 })
  const later = a(s, 'A400', { earlyStart: '2026-04-08', earlyFinish: '2026-04-14', totalFloat: 0 })
  const rels = [rel(s, done, prog), rel(s, prog, soon, 2), { ...rel(s, prog, edge), type: 'SS' as const }]
  const rows = lookaheadRows([done, prog, soon, edge, later], rels, '2026-03-17')
  it('keeps work in progress or starting within 21 days of the data date', () => {
    expect(rows.map(r => r.code)).toEqual(['A200', 'A300', 'A350'])
    expect(rows[0]).toMatchObject({ status: 'In Progress', remaining: 3, totalFloat: 0, critical: true, predecessors: 'A100 FS (done)' })
    expect(rows[1]).toMatchObject({ status: 'Not Started', remaining: 5, totalFloat: 4, predecessors: 'A200 FS+2d (in progress)', wbs: 'STR' })
    expect(rows[2].predecessors).toBe('A200 SS (in progress)')
  })
  it('exports with a provenance sheet and the window in the title row', async () => {
    const wb = await load(await exportLookaheadXlsx(rows, { ...prov, sources: [prov.sources[1]] }, { project: 'Riverside (Update 6)', dataDate: '2026-03-17' }))
    expect(wb.worksheets.map(w => w.name)).toEqual(['Provenance', '3-Week Look-Ahead'])
    const ws = wb.getWorksheet('3-Week Look-Ahead')!
    expect(String(ws.getCell(1, 1).value)).toContain('03/17/2026 – 04/07/2026')
    expect(ws.getRow(2).getCell(8).value).toBe('Remaining Duration (wd)')
    expect(ws.getRow(3).getCell(1).value).toBe('A200')
  })
})

describe('reviewer disposition input', () => {
  it('accepts valid dispositions and enforces justifications and comments', () => {
    expect(parseReviewInput({ itemId: 'dcma:6', disposition: 'accepted' })).toEqual({ ok: true, value: { kind: 'item', itemId: 'dcma:6', disposition: 'accepted', justification: null } })
    expect(parseReviewInput({ itemId: 'dcma:6', disposition: 'exception', justification: 'short' }).ok).toBe(false)
    expect(parseReviewInput({ itemId: 'dcma:6', disposition: 'exception', justification: 'Owner-directed sequence per CO-12.' }).ok).toBe(true)
    expect(parseReviewInput({ itemId: 'dcma:15', disposition: 'accepted' }).ok).toBe(false)
    expect(parseReviewInput({ itemId: 'dcma:6', disposition: 'maybe' }).ok).toBe(false)
    expect(parseReviewInput({ submission: 'approved' })).toEqual({ ok: true, value: { kind: 'submission', disposition: 'approved', comments: null } })
    expect(parseReviewInput({ submission: 'revise_and_resubmit' }).ok).toBe(false)
    expect(parseReviewInput({ submission: 'revise_and_resubmit', comments: 'Add logic to the open ends.' }).ok).toBe(true)
  })
})
