import { describe, expect, it } from 'vitest'
import type { Answer, AnswerValue, AnalyzableSchedule, GeneratedSchedule } from '@/lib/planning/types'
import type { ParsedSchedule } from '@/lib/parsers/types'
import { generateSchedule } from '@/lib/planning/generator'
import { runCpm } from '@/lib/planning/cpm'
import { scheduleToCpmInput } from '@/lib/analysis/dcma'
import { parseXER } from '@/lib/parsers/xer-parser'
import { parseMSProjectXML } from '@/lib/parsers/xml-parser'
import { parseSpreadsheet } from '@/lib/parsers/excel-parser'
import { exportXer } from './xer'
import { exportMspXml } from './msp-xml'
import { exportImportXlsx } from './xlsx'

// Interoperability corpus: schedules of different types, calendars and logic are exported to P6
// (.xer), MS Project (.xml) and the Excel import workbook, read back by Planora's own importers, and
// then RE-SCHEDULED from scratch (stored dates and float discarded). The re-computed dates must match
// the original CPM, activity by activity, which proves logic, durations, lags, calendars, holidays
// and constraints survive the trip. (Parity with P6/MS Project themselves is the separate reference
// corpus in docs/governance/VALIDATION-PLAN.md.)

const k = (value: AnswerValue): Answer => ({ status: 'known', value, answeredAt: '2026-01-01T00:00:00Z' })
const base = (o: Record<string, AnswerValue>): Record<string, Answer> => Object.fromEntries(Object.entries({
  'project.state': 'VA', 'project.scope': 'new_construction', 'project.gross_sqft': 80000, 'project.stories': 3,
  'project.target_start': '2026-11-02', 'design.drawings': true, 'design.percent': 60, 'project.federal': false, ...o,
}).map(([id, v]) => [id, k(v)]))

const CORPUS: { name: string; answers: Record<string, Answer> }[] = [
  { name: 'data center, 5×8 with holidays', answers: base({ 'project.type': 'data_center', 'project.gross_sqft': 200000, 'project.stories': 2 }) },
  { name: 'healthcare, 6×10 week', answers: base({ 'project.type': 'healthcare', 'calendar.workweek': '6x10' }) },
  { name: 'office renovation, 4×10 week', answers: base({ 'project.type': 'commercial_office', 'project.scope': 'renovation', 'calendar.workweek': '4x10' }) },
  { name: 'federal / defense, design-build', answers: base({ 'project.type': 'federal_defense', 'project.delivery': 'db', 'project.state': 'TX' }) },
  { name: 'office, no holidays, CM at risk, required date', answers: base({ 'project.type': 'commercial_office', 'calendar.holidays': false, 'project.delivery': 'cmar', 'project.required_finish': '2028-03-31' }) },
]

function rescheduled(p: ParsedSchedule): { finish: string; byCode: Map<string, { es: string; ef: string; tf: number }> } {
  const a: AnalyzableSchedule = {
    dataDate: null, projectStart: p.projectStart, projectFinish: null, calendars: p.calendars, defaultCalendarId: p.defaultCalendarId,
    links: p.relationships.map(r => ({ from: r.predecessorId, to: r.successorId, type: r.type, lag: r.lag })),
    // Stored dates and float are discarded: everything is recomputed from logic and calendars.
    activities: p.activities.map(x => ({
      id: x.id, code: x.activityId, name: x.name, type: x.activityType, duration: x.duration, remaining: x.duration, percentComplete: 0, status: 'not_started',
      calendarId: x.calendarId ?? null, earlyStart: null, earlyFinish: null, lateStart: null, lateFinish: null, actualStart: null, actualFinish: null,
      baselineStart: null, baselineFinish: null, totalFloat: null,
      constraint: x.constraintType && x.constraintDate ? { type: x.constraintType as never, date: x.constraintDate } : null,
    })),
  }
  const input = scheduleToCpmInput(a)!
  const r = runCpm(input)
  const code = new Map(p.activities.map(x => [x.id, x.activityId]))
  return { finish: r.projectFinish, byCode: new Map(Object.entries(r.times).map(([id, t]) => [code.get(id)!, { es: t.earlyStart, ef: t.earlyFinish, tf: t.totalFloat }])) }
}

function expectSameSchedule(g: GeneratedSchedule, p: ParsedSchedule) {
  expect(p.activities).toHaveLength(g.activities.length)
  expect(p.relationships).toHaveLength(g.links.length)
  const r = rescheduled(p)
  expect(r.finish).toBe(g.cpm!.projectFinish)
  const mismatches: string[] = []
  for (const a of g.activities) {
    const t = g.cpm!.times[a.id], got = r.byCode.get(a.code)
    if (!got) { mismatches.push(`${a.code} missing`); continue }
    if (got.es !== t.earlyStart || got.ef !== t.earlyFinish) mismatches.push(`${a.code} ${got.es}–${got.ef} vs ${t.earlyStart}–${t.earlyFinish}`)
    if (!g.mustFinishBy && got.tf !== t.totalFloat) mismatches.push(`${a.code} TF ${got.tf} vs ${t.totalFloat}`)
  }
  expect(mismatches).toEqual([])
}

describe.each(CORPUS)('round trip: $name', ({ answers }) => {
  const g = generateSchedule({ answers, today: '2026-09-30' })
  it('P6 .xer → import → reschedule gives the same dates and float', () => {
    expectSameSchedule(g, parseXER(exportXer(g, 'Round trip'), 'rt'))
  })
  it('MS Project .xml → import → reschedule gives the same dates and float', () => {
    expectSameSchedule(g, parseMSProjectXML(exportMspXml(g, 'Round trip'), 'rt'))
  })
  it('Excel import workbook → import keeps every activity, duration and link (WBS summary rows are not activities)', async () => {
    const p = await parseSpreadsheet(await exportImportXlsx(g, 'Round trip'), 'rt.xlsx', 'rt')
    expect(p.activities.length).toBe(g.activities.length)
    expect(p.relationships.length).toBe(g.links.length)
    // The MS Project sheet numbers rows (ID); match activities by name and duration instead.
    const key = (name: string, d: number) => `${name}|${Math.round(d * 1000) / 1000}`
    expect(p.activities.map(a => key(a.name, a.duration)).sort()).toEqual(g.activities.map(a => key(a.name, a.duration)).sort())
  })
})
