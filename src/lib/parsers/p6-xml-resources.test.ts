import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { parseXER } from './xer-parser'
import { parseP6Xml } from './p6-xml-parser'
import { costDataFromFile, p6XmlCostData, xerCostData } from './costs'
import type { ParsedSchedule } from './types'
import type { CostData } from './costs'
import { completeSchedule } from '@/lib/planning/complete-schedule'
import { loadActivitiesOfData } from '@/lib/planning/resource-service'
import { analyzeResources } from '@/lib/analysis/resources'
import { applyBaseline, resolveBaseline } from '@/lib/analysis/baseline'
import { computeEvm, type EvmInput } from '@/lib/analysis/evm'
import { baselineBudgetFor, costByCode, CostCache } from '@/lib/planning/evm-service'

// The same project exported from P6 as XER and as P6 XML (p6-equivalence.*) gives the same resources,
// assignments, resource loading and earned value.

const fixtures = path.join(__dirname, '__fixtures__')
const xerText = readFileSync(path.join(fixtures, 'p6-equivalence.xer'), 'utf8')
const xmlText = readFileSync(path.join(fixtures, 'p6-equivalence.xml'), 'utf8')
const xer = parseXER(xerText, 's')
const xml = parseP6Xml(xmlText, 's')

/** Comparable view: resources by code, assignments by activity code + resource code. */
function view(p: ParsedSchedule) {
  const r = p.resources!
  const code = new Map(r.resources.map(x => [x.id, x.code]))
  const act = new Map(p.activities.map(a => [a.id, a.activityId]))
  return {
    resources: r.resources.map(({ id: _id, ...x }) => x),
    assignments: r.assignments.map(a => ({ act: act.get(a.activityId), res: code.get(a.resourceId), sourceKey: a.sourceKey, budget: a.budgetUnits, actual: a.actualUnits, remaining: a.remainingUnits, uph: a.unitsPerHour ?? null }))
      .sort((a, b) => `${a.act}${a.res}`.localeCompare(`${b.act}${b.res}`)),
    notes: r.notes,
  }
}

function loading(p: ParsedSchedule) {
  const done = completeSchedule({
    activities: p.activities, relationships: p.relationships, calendars: p.calendars, defaultCalendarId: p.defaultCalendarId,
    projectStart: p.projectStart, projectFinish: p.projectFinish, dataDate: p.dataDate, mustFinishBy: p.mustFinishBy ?? null, progressMode: p.progressMode ?? 'retained',
  })
  const a = analyzeResources({ activities: loadActivitiesOfData({ activities: done.activities }), calendars: p.calendars, defaultCalendarId: p.defaultCalendarId, dataDate: p.dataDate, data: p.resources }, { bucket: 'week', histogramFor: 'all' })
  // Activity ids are per-parse uuids: compare by activity code.
  let json = JSON.stringify({ state: a.state, totals: a.totals, resources: a.resources, overAllocations: a.overAllocations, unscheduled: a.unscheduled })
  for (const x of p.activities) json = json.split(x.id).join(x.activityId)
  return JSON.parse(json)
}

async function evmOf(parsed: ParsedSchedule, cost: CostData | null) {
  // The fixture's target dates are mostly its current dates, which the resolver does not accept as a
  // baseline on its own; measure against them as a designated file baseline (P6's own budget).
  const resolved = resolveBaseline({ activities: parsed.activities, meta: null })
  const baseline = { ...resolved, source: 'file' as const, header: "Baseline: the file's own P6 target dates" }
  const activities = applyBaseline(parsed.activities, baseline)
  const current = cost ? costByCode(cost, activities) : null
  const baselineBudget = await baselineBudgetFor(baseline, { cache: new CostCache('org-test'), current, embeddedOwner: null })
  const input: EvmInput = {
    scheduleId: 's1', version: 'Update 1', dataDate: parsed.dataDate, activities, calendars: parsed.calendars, defaultCalendarId: parsed.defaultCalendarId,
    baseline: { source: baseline.source, header: baseline.header, starts: baseline.starts, finishes: baseline.finishes },
    cost: current, baselineBudget,
  }
  return computeEvm(input)
}

describe('P6 XML resources: same as XER', () => {
  it('reads Resource, ResourceRate and ResourceAssignment with the XER semantics', () => {
    expect(xml.resources?.source).toBe('p6_xml')
    expect(xer.resources?.source).toBe('p6_xer')
    expect(view(xml)).toEqual(view(xer))
    const v = view(xml)
    // Max units/hour: the rate in effect on the data date (03/16/2026), not the later 06/01 rate.
    expect(v.resources).toEqual([
      { code: 'EXC', name: 'Excavator crew', kind: 'nonlabor', unit: 'h', maxUnitsPerHour: 1, calendarId: null },
      { code: 'IW', name: 'Ironworkers', kind: 'labor', unit: 'h', maxUnitsPerHour: 6, calendarId: null },
    ])
    expect(v.assignments).toEqual([
      { act: 'A1010', res: 'IW', sourceKey: '1002', budget: 80, actual: 82, remaining: 0, uph: 2 },
      { act: 'A1020', res: 'EXC', sourceKey: '1003', budget: 100, actual: 40, remaining: 60, uph: 1 },
      { act: 'A1050', res: 'IW', sourceKey: '1006', budget: 960, actual: 0, remaining: 960, uph: 8 },
    ])
  })

  it('gives the same resource loading (histograms, totals, over-allocation)', () => {
    const a = loading(xer), b = loading(xml)
    expect(a.state).toBe('ok')
    expect(a.totals.assignments).toBe(3)
    expect(b).toEqual(a)
  })

  it('reports resources and assignments as read, not as unused', () => {
    const r = xml.exceptions!
    for (const f of ['Resource', 'ResourceRate', 'ResourceAssignment', 'UnitOfMeasure']) expect(r.records.find(x => x.field === f), f).toBeUndefined()
    expect(xml.warnings.some(w => w.startsWith('Not used') && /Resource/.test(w))).toBe(false)
    // Expenses are read only for earned value: still listed (Planora's exports do not write them), with that said.
    expect(r.records.find(x => x.field === 'ActivityExpense')).toMatchObject({ count: 1, message: expect.stringMatching(/earned value/) })
    expect(xer.exceptions!.records.find(x => x.field === 'PROJCOST')).toMatchObject({ count: 1, message: expect.stringMatching(/earned value/) })
  })

  it('reports role-only assignments and resource curves, the parts resource analysis does not use', () => {
    const doc = xmlText.replace('<RemainingUnits>60</RemainingUnits>', '<RemainingUnits>60</RemainingUnits><ResourceCurveObjectId>4</ResourceCurveObjectId>')
      .replace('    <ScheduleOptions>', '    <ResourceAssignment><ActivityObjectId>1004</ActivityObjectId><ObjectId>9</ObjectId><PlannedUnits>16</PlannedUnits><RoleObjectId>3</RoleObjectId></ResourceAssignment>\n    <ScheduleOptions>')
    const p = parseP6Xml(doc, 's')
    expect(p.exceptions!.records.find(x => x.field === 'ResourceAssignment.RoleObjectId')).toMatchObject({ entity: 'assignment', count: 1, examples: ['A1030'] })
    expect(p.exceptions!.records.find(x => x.field === 'ResourceAssignment.ResourceCurveObjectId')).toMatchObject({ count: 1, examples: ['A1020'] })
    expect(p.resources!.notes.some(n => /role/.test(n))).toBe(true)
    expect(p.resourceCounts!['1004']).toBe(1)
  })
})

describe('P6 XML earned value: same as XER', () => {
  it('reads assignment and expense costs and percent complete like the XER', () => {
    const a = xerCostData(xerText)!, b = p6XmlCostData(xmlText)!
    expect(b.kind).toBe('p6_xml')
    expect(b.fields).toEqual(a.fields)
    expect(b.bySource).toEqual(a.bySource)
    expect(b.budgetByProjectCode).toEqual(a.budgetByProjectCode)
    expect(b.bySource['1003']).toMatchObject({ budget: 15000, actualCost: 6500, remainingCost: 9000, evPercent: 40, evPercentType: 'physical' })
    expect(b.bySource['1002']).toMatchObject({ budget: 6000, actualCost: 6300, evPercent: 100 })
    expect(b.bySource['1004']).toMatchObject({ budget: 2500, actualCost: 0, remainingCost: 2500 })
  })

  it('routes a stored P6 XML file to the P6 XML cost reader', async () => {
    expect((await costDataFromFile('eq.xml', Buffer.from(xmlText)))?.kind).toBe('p6_xml')
  })

  it('applies the activity percent complete type (duration, units)', () => {
    const a1020 = '<ObjectId>1003</ObjectId>\n      <PercentCompleteType>Physical'
    expect(xmlText).toContain(a1020)
    const c = p6XmlCostData(xmlText.replace(a1020, '<ObjectId>1003</ObjectId><PercentCompleteType>Duration'))!
    // A1020: 100 h original, 60 h remaining → 40% duration complete
    expect(c.bySource['1003']).toMatchObject({ evPercentType: 'duration', evPercent: 40 })
    const u = p6XmlCostData(xmlText.replace(a1020, '<ObjectId>1003</ObjectId><ActualNonLaborUnits>25</ActualNonLaborUnits><RemainingNonLaborUnits>75</RemainingNonLaborUnits><PercentCompleteType>Units'))!
    expect(u.bySource['1003']).toMatchObject({ evPercentType: 'units', evPercent: 25 })
  })

  it('gives the same EVM result (BAC, PV, EV, AC, indices, earned schedule)', async () => {
    const a = await evmOf(xer, xerCostData(xerText)), b = await evmOf(xml, p6XmlCostData(xmlText))
    expect(a.missing).toEqual([])
    expect(a.status).toBe('available')
    expect(b.status).toBe(a.status)
    expect(b.costSource).toBe('p6_xml')
    expect(a.metrics!.bac).toBe(95500)
    expect(b.metrics).toEqual(a.metrics)
    expect(b.earnedSchedule).toEqual(a.earnedSchedule)
    expect(b.activities).toEqual(a.activities)
    expect(b.curve).toEqual(a.curve)
    expect(b.methods.ac).toBe(a.methods.ac)
  })
})
