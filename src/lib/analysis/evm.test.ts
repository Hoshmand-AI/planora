import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { parseXER } from '@/lib/parsers/xer-parser'
import { parseMSProjectXML } from '@/lib/parsers/xml-parser'
import { mspCostData, sheetCostData, xerCostData, parseMoney } from '@/lib/parsers/costs'
import { applyBaseline, resolveBaseline } from './baseline'
import { computeEvm, evmMarkdown, evmSeries, type EvmInput } from './evm'
import { baselineBudgetFor, costByCode, CostCache } from '@/lib/planning/evm-service'
import type { ParsedSchedule } from '@/lib/parsers/types'
import type { CostData } from '@/lib/parsers/costs'

const fx = (f: string) => readFileSync(path.join(__dirname, '..', 'parsers', '__fixtures__', f), 'utf8')

async function inputFrom(parsed: ParsedSchedule, cost: CostData | null, over: Partial<EvmInput> = {}): Promise<EvmInput> {
  const baseline = resolveBaseline({ activities: parsed.activities, meta: parsed.embeddedBaseline ? { embedded: parsed.embeddedBaseline } : null })
  const activities = applyBaseline(parsed.activities, baseline)
  const current = cost ? costByCode(cost, activities) : null
  const baselineBudget = await baselineBudgetFor(baseline, {
    cache: new CostCache('org-test'), current,
    embeddedOwner: baseline.source === 'p6_embedded' ? { cost, projectId: parsed.embeddedBaseline?.projectId ?? null } : null,
  })
  return {
    scheduleId: 's1', version: 'Update 1', dataDate: parsed.dataDate, activities, calendars: parsed.calendars, defaultCalendarId: parsed.defaultCalendarId,
    baseline: { source: baseline.source, header: baseline.header, starts: baseline.starts, finishes: baseline.finishes },
    cost: current, baselineBudget, ...over,
  }
}

// Hand-computed for both fixtures (data date Monday 03/16/2026, Mon–Fri calendar):
//   A (03/02–03/13, BL $10,000)  complete            PV 10,000  EV 10,000  AC 12,000
//   B (03/09–03/20, BL $20,000)  physical 30%        PV 5/10 wd × 20,000 = 10,000  EV 6,000  AC 5,000
//   C (03/23–04/03, BL $30,000)  not started         PV 0       EV 0       AC 0
//   BAC 60,000 · PV 20,000 · EV 16,000 · AC 17,000 · SV −4,000 · CV −1,000 · SPI 0.8 · CPI 16/17 = 0.941
//   EAC(CPI) = 60,000 / 0.941176 = 63,750 · EAC(CPI×SPI) = 17,000 + 44,000 / 0.752941 = 75,437.50
//   ETC 46,750 · VAC −3,750 · TCPI(BAC) = 44,000 / 43,000 = 1.023 · TCPI(EAC) = 44,000 / 46,750 = 0.941
//   Earned schedule: cumulative PV before 03/12 (day 10) = 14,000, before 03/13 = 17,000
//   ES = 10 + 2,000 / 3,000 = 10.67 days; AT = 14 days; SPI(t) = 0.762; SV(t) = −3.3 days
function expectHandValues(e: ReturnType<typeof computeEvm>) {
  const m = e.metrics!
  expect(m.bac).toBe(60000)
  expect(m.pv).toBe(20000)
  expect(m.ev).toBe(16000)
  expect(m.ac).toBe(17000)
  expect(m.sv).toBe(-4000)
  expect(m.cv).toBe(-1000)
  expect(m.spi).toBe(0.8)
  expect(m.cpi).toBe(0.941)
  expect(m.eacCpi).toBeCloseTo(63750, 0)
  expect(m.eacCpiSpi).toBeCloseTo(75437.5, 0)
  expect(m.etcCpi).toBeCloseTo(46750, 0)
  expect(m.vac).toBeCloseTo(-3750, 0)
  expect(m.tcpiBac).toBe(1.023)
  expect(m.tcpiEac).toBe(0.941)
  const es = e.earnedSchedule!
  expect(es.baselineStart).toBe('2026-03-02')
  expect(es.at).toBe(14)
  expect(es.es).toBeCloseTo(10.67, 2)
  expect(es.esDate).toBe('2026-03-12')
  expect(es.spiT).toBe(0.762)
  expect(es.svT).toBe(-3.3)
}

describe('cost extraction', () => {
  it('reads P6 TASKRSRC and PROJCOST costs, percent complete types and the embedded baseline budget', () => {
    const c = xerCostData(fx('evm-costs.xer'))!
    expect(c.kind).toBe('p6_xer')
    expect(c.currency.code).toBe('USD')
    expect(c.bySource['101']).toMatchObject({ budget: 10000, actualCost: 12000, remainingCost: 0, evPercent: 100, evPercentType: 'duration' })
    expect(c.bySource['102']).toMatchObject({ budget: 20000, actualCost: 5000, remainingCost: 15000, evPercent: 30, evPercentType: 'physical' })
    expect(c.bySource['103']).toMatchObject({ budget: 32000, actualCost: 0, evPercent: 0, evPercentType: 'units' })
    expect(c.budgetByProjectCode!['2']).toEqual({ A1000: 10000, A1010: 20000, A1020: 30000 })
  })

  it('reads MS Project costs in hundredths, skips summary tasks and follows the earned value method', () => {
    const c = mspCostData(fx('evm-costs-msp.xml'))!
    expect(Object.keys(c.bySource).sort()).toEqual(['1', '2', '3'])
    expect(c.bySource['1']).toMatchObject({ budget: 12000, baselineBudget: 10000, actualCost: 12000, fileBcws: 10000, evPercentType: 'duration', evPercent: 100 })
    expect(c.bySource['2']).toMatchObject({ baselineBudget: 20000, actualCost: 5000, evPercentType: 'physical', evPercent: 30 })
    expect(c.fields.fileBcws).toBe(true)
  })

  it('reads cost columns from a sheet and parses money text', () => {
    const c = sheetCostData([[['Activity ID', 'Activity Name', 'Budgeted Cost', 'Actual Cost ($)'], ['A1', 'One', '$1,000.50', '(200)'], ['A2', 'Two', 2500, '']]])!
    expect(c.bySource['A1']).toMatchObject({ budget: 1000.5, actualCost: -200 })
    expect(c.bySource['A2']).toMatchObject({ budget: 2500, actualCost: null })
    expect(parseMoney('USD 12,345')).toBe(12345)
    expect(sheetCostData([[['Activity ID', 'Activity Name', 'Duration'], ['A1', 'One', 5]]])).toBeNull()
  })
})

describe('computeEvm', () => {
  it('P6 XER with the embedded baseline: hand-computed BAC, PV, EV, AC, indices, forecasts and earned schedule', async () => {
    const parsed = parseXER(fx('evm-costs.xer'), 's1')
    const e = computeEvm(await inputFrom(parsed, xerCostData(fx('evm-costs.xer'))))
    expect(e.status).toBe('available')
    expect(e.baseline.source).toBe('p6_embedded')
    expectHandValues(e)
    // Current budget is 62,000 (Structure re-budgeted), BAC stays on the baseline.
    expect(e.metrics!.fileAtCompletion).toBe(64000)
    expect(e.methods.pv).toMatch(/Time-phased/)
    expect(e.methods.ev).toMatch(/CP_Phys/)
    const site = e.wbs.find(w => w.key === 'SITE')!
    expect(site).toMatchObject({ bac: 30000, pv: 20000, ev: 16000, ac: 17000, spi: 0.8 })
    expect(e.checks.filter(c => c.result === 'flag')).toEqual([])
  })

  it('MS Project XML with Baseline Cost: the same hand-computed values from the file baseline', async () => {
    const parsed = parseMSProjectXML(fx('evm-costs-msp.xml'), 's1')
    const e = computeEvm(await inputFrom(parsed, mspCostData(fx('evm-costs-msp.xml'))))
    expect(e.baseline.source).toBe('file')
    expect(e.status).toBe('available')
    expectHandValues(e)
    expect(e.methods.bac).toMatch(/Baseline Cost/)
    // Summary task costs are a roll-up and never double counted.
    expect(e.activities.map(a => a.code).sort()).toEqual(['A2', 'A3', 'A4'])
    const md = evmMarkdown(e).join('\n')
    expect(md).toMatch(/## Earned value/)
    expect(md).toMatch(/\| SPI = EV ÷ PV \| 0\.80 \|/)
    expect(md).toMatch(/03\/16\/2026/)
  })

  it('uses the file BCWS when it is stated for every budgeted activity against the file baseline, and says so', async () => {
    const parsed = parseMSProjectXML(fx('evm-costs-msp.xml'), 's1')
    const cost = mspCostData(fx('evm-costs-msp.xml'))!
    cost.bySource['2'].fileBcws = 10000
    cost.bySource['3'].fileBcws = 0
    const e = computeEvm(await inputFrom(parsed, cost))
    expect(e.methods.pv).toMatch(/file's own BCWS/)
    expect(e.metrics!.pv).toBe(20000)
  })
})

describe('data-sufficiency gates', () => {
  it('not available without cost data, naming the missing input', async () => {
    const parsed = parseXER(fx('evm-costs.xer'), 's1')
    const e = computeEvm(await inputFrom(parsed, null, { costMissing: 'no_cost_data' }))
    expect(e.status).toBe('not_available')
    expect(e.missing.map(m => m.code)).toEqual(['no_cost_data'])
    expect(e.metrics).toBeNull()
    expect(evmMarkdown(e)).toEqual([])
    const f = computeEvm(await inputFrom(parsed, null, { costMissing: 'no_cost_file' }))
    expect(f.missing[0].message).toMatch(/not stored/)
  })

  it('not available without a baseline, or without a baseline budget', async () => {
    const parsed = parseMSProjectXML(fx('evm-costs-msp.xml'), 's1')
    const cost = mspCostData(fx('evm-costs-msp.xml'))!
    const noBl = computeEvm(await inputFrom(parsed, cost, { baseline: { source: 'none', header: 'Baseline: none.' }, baselineBudget: null }))
    expect(noBl.status).toBe('not_available')
    expect(noBl.missing.map(m => m.code)).toContain('no_baseline')
    for (const r of Object.values(cost.bySource)) r.baselineBudget = null
    const noBudget = computeEvm(await inputFrom(parsed, cost))
    expect(noBudget.status).toBe('not_available')
    expect(noBudget.missing.map(m => m.code)).toEqual(['no_baseline_budget'])
    expect(noBudget.missing[0].message).toMatch(/Baseline Cost/)
  })

  it('not available with no budget at all and no data date', async () => {
    const parsed = parseMSProjectXML(fx('evm-costs-msp.xml'), 's1')
    const cost = mspCostData(fx('evm-costs-msp.xml'))!
    for (const r of Object.values(cost.bySource)) { r.budget = 0; r.baselineBudget = 0 }
    const e = computeEvm(await inputFrom(parsed, cost, { dataDate: null }))
    expect(e.missing.map(m => m.code)).toEqual(['no_budget', 'no_baseline_budget', 'no_data_date'])
  })

  it('partial without actual costs: PV, EV and SPI only; CPI is never computed without AC', async () => {
    const parsed = parseMSProjectXML(fx('evm-costs-msp.xml'), 's1')
    const cost = mspCostData(fx('evm-costs-msp.xml'))!
    for (const r of Object.values(cost.bySource)) { r.actualCost = null; r.fileAcwp = null }
    cost.fields.actualCost = false
    const e = computeEvm(await inputFrom(parsed, cost))
    expect(e.status).toBe('partial')
    expect(e.missing.map(m => m.code)).toEqual(['no_actual_costs'])
    expect(e.metrics).toMatchObject({ pv: 20000, ev: 16000, spi: 0.8, ac: null, cv: null, cpi: null, eacCpi: null, eacCpiSpi: null, vac: null, tcpiBac: null })
    expect(e.labels[0]).toMatch(/Partial/)
    expect(e.earnedSchedule?.spiT).toBe(0.762)
  })

  it('treats all-zero actual costs on earned work as not recorded (partial)', async () => {
    const parsed = parseMSProjectXML(fx('evm-costs-msp.xml'), 's1')
    const cost = mspCostData(fx('evm-costs-msp.xml'))!
    for (const r of Object.values(cost.bySource)) { r.actualCost = 0; r.fileAcwp = 0 }
    const e = computeEvm(await inputFrom(parsed, cost))
    expect(e.status).toBe('partial')
    expect(e.metrics!.cpi).toBeNull()
    expect(e.missing[0].message).toMatch(/all zero/)
  })
})

describe('integrity checks (oriented to ANSI/EIA-748, not compliance)', () => {
  it('flags EV without an actual start, AC on not-started work, progress without budget and negative values, with activity evidence', async () => {
    const parsed = parseMSProjectXML(fx('evm-costs-msp.xml'), 's1')
    const cost = mspCostData(fx('evm-costs-msp.xml'))!
    const acts = parsed.activities.map(a => a.activityId === 'A3' ? { ...a, actualStart: null } : a)
    cost.bySource['3'].actualCost = 500
    cost.bySource['3'].remainingCost = -100
    const input = await inputFrom({ ...parsed, activities: acts }, cost)
    // A milestone-free activity with progress and no baseline budget
    input.activities = [...input.activities, { ...input.activities[1], id: 'x', activityId: 'X9', percentComplete: 20, status: 'in_progress', actualStart: '2026-03-10', actualFinish: null }]
    const e = computeEvm(input)
    const byId = Object.fromEntries(e.checks.map(c => [c.id, c]))
    expect(byId.ev_without_actual_start).toMatchObject({ result: 'flag', activityCodes: ['A3'] })
    expect(byId.ac_not_started).toMatchObject({ result: 'flag', activityCodes: ['A4'] })
    expect(byId.progress_without_budget).toMatchObject({ result: 'flag', activityCodes: ['X9'] })
    expect(byId.negative_values).toMatchObject({ result: 'flag', activityCodes: ['A4'] })
    expect(byId.baseline_budget_changed.result).toBe('n/a')
    expect(byId.bac_mismatch.result).toBe('n/a')
  })

  it('flags a baseline budget change without a recorded revision and a BAC mismatch between updates', async () => {
    const parsed = parseMSProjectXML(fx('evm-costs-msp.xml'), 's1')
    const input = await inputFrom(parsed, mspCostData(fx('evm-costs-msp.xml')))
    const e = computeEvm({ ...input, prior: { version: 'Update 0', dataDate: '2026-03-09', bac: 55000, baselineHeader: input.baseline.header, baselineBudgetByCode: { A2: 10000, A3: 15000, A4: 30000 } } })
    const byId = Object.fromEntries(e.checks.map(c => [c.id, c]))
    expect(byId.baseline_budget_changed).toMatchObject({ result: 'flag', activityCodes: ['A3'] })
    expect(byId.bac_mismatch.result).toBe('flag')
    expect(byId.bac_mismatch.detail).toMatch(/\$55,000 in Update 0/)
    // A re-designated baseline is a recorded revision.
    const r = computeEvm({ ...input, prior: { version: 'Update 0', dataDate: '2026-03-09', bac: 55000, baselineHeader: 'Baseline: Update 0', baselineBudgetByCode: { A3: 1 } } })
    expect(r.checks.find(c => c.id === 'baseline_budget_changed')!.result).toBe('pass')
  })
})

describe('evmSeries', () => {
  it('trends the update series, skipping a superseded reissue of the same data date', async () => {
    const parsed = parseMSProjectXML(fx('evm-costs-msp.xml'), 's1')
    const base = await inputFrom(parsed, mspCostData(fx('evm-costs-msp.xml')))
    const early = { ...base, scheduleId: 'u1', version: 'Update 1', dataDate: '2026-03-09' }
    const wrong = { ...base, scheduleId: 'u2', version: 'Update 2', dataDate: '2026-03-16', cost: { ...base.cost!, byCode: { ...base.cost!.byCode, A3: { ...base.cost!.byCode.A3, evPercent: 90 } } } }
    const reissue = { ...base, scheduleId: 'u2r', version: 'Update 2 (reissue)', dataDate: '2026-03-16' }
    const s = evmSeries([{ input: early }, { input: wrong }, { input: reissue }])
    expect(s.points.map(p => p.version)).toEqual(['Update 1', 'Update 2 (reissue)'])
    expect(s.superseded).toEqual([{ id: 'u2', version: 'Update 2', dataDate: '2026-03-16' }])
    expect(s.notes[0]).toMatch(/superseded by the reissue/)
    // Before 03/09 only A is planned: 5 work days × 1,000.
    expect(s.points[0].pv).toBe(5000)
    expect(s.points[1]).toMatchObject({ pv: 20000, ev: 16000, spi: 0.8, cpi: 0.941 })
    expect(s.latest?.checks.find(c => c.id === 'bac_mismatch')?.result).toBe('pass')
  })
})
