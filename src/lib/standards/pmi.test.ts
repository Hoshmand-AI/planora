import { describe, expect, it } from 'vitest'
import { detectConflicts, engineConfig, evaluateRule, frameworkVersionOf, rulesVersionOf, runStandards } from './engine'
import { GAO_RULES } from './gao'
import { buildNetwork } from './network'
import { PMI_DISCLAIMER, PMI_RULES, PMI_VERSION } from './pmi'
import { actOf, allComplete, clean, link, mutate, noLinks, progressed, task } from './test-fixtures'
import { FRAMEWORK_LABELS, type RuleResult, type StandardsInput } from './types'
import { USACE_RULES } from './usace'

const cfg = engineConfig()
const run = (id: string, input: StandardsInput, c = cfg): RuleResult => evaluateRule(PMI_RULES.find(r => r.ruleId === id)!, buildNetwork(input), c)
const loe = (id: string, totalFloat?: number) => ({ id, code: id, name: 'Site supervision', type: 'loe' as const, duration: 50, ...(totalFloat === undefined ? {} : { totalFloat }) })

describe('PMI pack metadata', () => {
  it('nine rules, each citing section 3.4 of the second edition as standard guidance', () => {
    expect(PMI_RULES.map(r => r.ruleId)).toEqual(Array.from({ length: 9 }, (_, i) => `PMI-${String(i + 1).padStart(2, '0')}`))
    for (const r of PMI_RULES) {
      expect(r.framework).toBe('PMI_SCHEDULING')
      expect(r.kind).toBe('standard_guidance')
      expect(r.version).toBe(1)
      expect(r.frameworkVersion).toBe(PMI_VERSION)
      expect(r.sourceReference).toMatch(/^PMI Practice Standard for Scheduling, 2nd edition, section 3\.4/)
    }
  })
  it('no threshold claims to be a published PMI value', () => {
    for (const r of PMI_RULES) {
      for (const t of [r.threshold?.(cfg), ...(r.parameters?.(cfg) ?? [])]) if (t) expect(t.source, r.ruleId).toBe('runf9_default')
    }
    const tuned = engineConfig({ gao: { highFloatDays: 30, lagsMaxPct: 10 } })
    expect(PMI_RULES.find(r => r.ruleId === 'PMI-09')!.threshold!(tuned)).toMatchObject({ value: 30, source: 'org_configured' })
    expect(PMI_RULES.find(r => r.ruleId === 'PMI-04')!.threshold!(tuned)).toMatchObject({ value: 10, source: 'org_configured' })
  })
  it('the pack and its disclaimer do not mention a conformance score or a credential', () => {
    const text = JSON.stringify(PMI_RULES.map(({ title, message, sourceReference, calculation }) => ({ title, message, sourceReference, calculation }))) + PMI_DISCLAIMER + PMI_VERSION
    expect(text).not.toMatch(/conformance index|PMI-SP|\bPSP\b|certif|—/i)
    expect(PMI_DISCLAIMER).toMatch(/drawn from/)
    expect(PMI_DISCLAIMER).toMatch(/RunF9 screening default/)
    expect(PMI_DISCLAIMER).toMatch(/not affiliated with or endorsed by PMI/)
  })
  it('a PMI run groups by category, carries the disclaimer and has its own rules version', () => {
    const out = runStandards(clean(), ['PMI_SCHEDULING'])
    const f = out.frameworks[0]
    expect(f.label).toBe(FRAMEWORK_LABELS.PMI_SCHEDULING)
    expect(f.frameworkVersion).toBe(PMI_VERSION)
    expect(frameworkVersionOf('PMI_SCHEDULING')).toBe(PMI_VERSION)
    expect(f.groupBy).toBe('category')
    expect(f.groups.map(g => g.label)).toEqual(['Logic', 'Constraints', 'Status', 'Critical path', 'Float'])
    expect(f.disclaimer).toBe(PMI_DISCLAIMER)
    expect(f.groups.flatMap(g => g.rules).filter(r => r.result === 'fail')).toEqual([])
    expect(out.rulesVersion).toBe(rulesVersionOf(['PMI_SCHEDULING'], cfg))
  })
  it('shares metric keys with the other packs, so differing limits can be compared', () => {
    const keys = (rules: typeof PMI_RULES) => new Set(rules.flatMap(r => [r.threshold?.(cfg), ...(r.parameters?.(cfg) ?? [])]).filter(Boolean).map(t => t!.metricKey))
    const gao = keys(GAO_RULES)
    for (const k of keys(PMI_RULES)) expect(gao.has(k), k).toBe(true)
    // USACE's 20-day limit and GAO's 44-day screening value sit on the same metric and are reported as a conflict
    const net = buildNetwork(clean())
    const results = [...GAO_RULES, ...USACE_RULES].map(r => evaluateRule(r, net, cfg))
    expect(detectConflicts(results).map(c => c.metricKey)).toContain('duration.long_days')
  })
})

describe('PMI-01 open-ended activities', () => {
  it('passes with only the start and finish open-ended', () => expect(run('PMI-01', clean()).result).toBe('pass'))
  it('fails above the RunF9 limit and warns within an organization limit', () => {
    const open = () => mutate(i => { i.schedule.activities.push(task('B1')); i.schedule.links.push(link('S', 'B1')) })
    const r = run('PMI-01', open())
    expect(r.result).toBe('fail'); expect(r.evidence).toEqual(['B1'])
    expect(r.threshold).toMatchObject({ metricKey: 'logic.open_ends_pct', value: 0, source: 'runf9_default' })
    expect(r.reason).toMatch(/not a value from the practice standard/)
    expect(run('PMI-01', open(), engineConfig({ gao: { openEndsMaxPct: 20 } })).result).toBe('warning')
  })
  it('is not assessable with nothing open', () => expect(run('PMI-01', allComplete()).result).toBe('not_assessable'))
})

describe('PMI-02 date constraints', () => {
  it('passes with none', () => expect(run('PMI-02', clean()).result).toBe('pass'))
  it('warns on any constraint and lists it with its date', () => {
    const r = run('PMI-02', mutate(i => { actOf(i, 'A3').constraint = { type: 'SNET', date: '2026-04-01' }; actOf(i, 'A6').constraint = { type: 'MFO', date: '2026-06-01' } }))
    expect(r.result).toBe('warning')
    expect(r.evidence).toEqual(['A3 (SNET 04/01/2026)', 'A6 (MFO 06/01/2026)'])
    expect(r.metric).toMatch(/1 of them can override logic/)
    expect(r.threshold).toBeNull()
  })
  it('is not assessable with nothing open', () => expect(run('PMI-02', allComplete()).result).toBe('not_assessable'))
})

describe('PMI-03 leads', () => {
  it('passes with none', () => expect(run('PMI-03', clean()).result).toBe('pass'))
  it('warns on a negative lag', () => {
    const r = run('PMI-03', mutate(i => { i.schedule.links[3].lag = -3 }))
    expect(r.result).toBe('warning'); expect(r.evidence).toEqual(['A3 → A4 (-3d)'])
    expect(r.threshold).toMatchObject({ metricKey: 'logic.leads_count', source: 'runf9_default' })
  })
  it('is not assessable without relationships', () => expect(run('PMI-03', noLinks()).result).toBe('not_assessable'))
})

describe('PMI-04 lags', () => {
  it('passes with none', () => expect(run('PMI-04', clean()).result).toBe('pass'))
  it('warns above the RunF9 limit and passes within an organization limit', () => {
    const lagged = () => mutate(i => { i.schedule.links[3].lag = 4 })
    const r = run('PMI-04', lagged())
    expect(r.result).toBe('warning'); expect(r.evidence).toEqual(['A3 → A4 (+4d)'])
    expect(r.threshold).toMatchObject({ metricKey: 'logic.lags_share_pct', source: 'runf9_default' })
    expect(run('PMI-04', lagged(), engineConfig({ gao: { lagsMaxPct: 25 } })).result).toBe('pass')
  })
  it('is not assessable without relationships', () => expect(run('PMI-04', noLinks()).result).toBe('not_assessable'))
})

describe('PMI-05 start-to-finish relationships', () => {
  it('passes with none', () => expect(run('PMI-05', clean()).result).toBe('pass'))
  it('warns on a start-to-finish relationship', () => {
    const r = run('PMI-05', mutate(i => { i.schedule.links.push(link('A2', 'A6', 'SF')) }))
    expect(r.result).toBe('warning'); expect(r.evidence).toEqual(['A2 → A6 (SF)'])
  })
  it('is not assessable without relationships', () => expect(run('PMI-05', noLinks()).result).toBe('not_assessable'))
})

describe('PMI-06 links to or from summary activities', () => {
  const summary = { id: 'W1', code: 'W1', name: 'Structure', type: 'summary' as const, duration: 0 }
  it('passes with no summaries, and with a summary that carries no relationship', () => {
    expect(run('PMI-06', clean()).result).toBe('pass')
    expect(run('PMI-06', mutate(i => { i.schedule.activities.push(summary) })).result).toBe('pass')
  })
  it('warns on a relationship from a summary', () => {
    const r = run('PMI-06', mutate(i => { i.schedule.activities.push(summary); i.schedule.links.push(link('W1', 'A3')) }))
    expect(r.result).toBe('warning'); expect(r.evidence).toEqual(['W1 → A3'])
  })
})

describe('PMI-07 out-of-sequence logic', () => {
  it('passes when progress follows the logic', () => expect(run('PMI-07', progressed()).result).toBe('pass'))
  it('warns when work started before its predecessor finished', () => {
    const r = run('PMI-07', mutate(i => { Object.assign(actOf(i, 'A5'), { actualStart: '2026-03-10', status: 'in_progress', percentComplete: 10 }) }, progressed()))
    expect(r.result).toBe('warning'); expect(r.evidence).toEqual(['A4 → A5'])
  })
  it('is not assessable before progress, without logic, or on a plan', () => {
    expect(run('PMI-07', clean()).result).toBe('not_assessable')
    expect(run('PMI-07', mutate(i => { i.schedule.links = [] }, progressed())).result).toBe('not_assessable')
    expect(run('PMI-07', mutate(i => { i.subject.kind = 'plan' }, progressed())).result).toBe('not_assessable')
  })
})

describe('PMI-08 level-of-effort activities on the critical path', () => {
  it('passes when level of effort carries positive float', () => {
    expect(run('PMI-08', mutate(i => { i.schedule.activities.push(loe('L1', 12)) })).result).toBe('pass')
  })
  it('warns when the file shows level of effort with zero or negative float', () => {
    const r = run('PMI-08', mutate(i => { i.schedule.activities.push(loe('L1', 0), loe('L2', 12)) }))
    expect(r.result).toBe('warning'); expect(r.evidence).toEqual(['L1 (0d)'])
  })
  it('is not assessable, and says it is not a pass, when no level of effort is typed or it has no float', () => {
    const none = run('PMI-08', clean())
    expect(none.result).toBe('not_assessable'); expect(none.reason).toMatch(/not a pass/)
    expect(run('PMI-08', mutate(i => { i.schedule.activities.push(loe('L1')) })).result).toBe('not_assessable')
  })
})

describe('PMI-09 total float', () => {
  const floats = (tf: number) => mutate(i => { for (const a of i.schedule.activities) a.totalFloat = 5; actOf(i, 'A4').totalFloat = tf })
  it('passes when float is known and within the screening value', () => {
    const r = run('PMI-09', floats(5))
    expect(r.result).toBe('pass')
    expect(r.threshold).toMatchObject({ metricKey: 'float.high_days', value: 44, source: 'runf9_default' })
    expect(run('PMI-09', clean()).result).toBe('pass') // calculated float on a single chain is zero
  })
  it('warns on negative float and on float above the screening value', () => {
    const neg = run('PMI-09', floats(-3))
    expect(neg.result).toBe('warning'); expect(neg.evidence).toEqual(['A4 (-3d)'])
    const high = run('PMI-09', floats(60))
    expect(high.result).toBe('warning'); expect(high.evidence).toEqual(['A4 (60d)'])
    expect(run('PMI-09', floats(60), engineConfig({ gao: { highFloatDays: 90 } })).result).toBe('pass')
  })
  it('is not assessable when float is neither stored nor calculable, or nothing is open', () => {
    expect(run('PMI-09', mutate(i => { i.schedule.projectStart = null; i.schedule.dataDate = null })).result).toBe('not_assessable')
    expect(run('PMI-09', allComplete()).result).toBe('not_assessable')
  })
})
