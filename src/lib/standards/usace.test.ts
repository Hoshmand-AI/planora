import { describe, expect, it } from 'vitest'
import { DCMA_RULES } from './dcma-pack'
import { GAO_RULES } from './gao'
import { COMPOSITE_VERSION, engineConfig, evaluateRule, frameworkVersionOf, rulesOf, rulesVersionOf, runStandards, RULE_PACKS } from './engine'
import { unknownRuleCitations } from './explain'
import { buildNetwork } from './network'
import { normalizeFrameworkList } from './config'
import { PMI_RULES } from './pmi'
import { actOf, allComplete, clean, link, ms, mutate, noLinks, progressed, task } from './test-fixtures'
import { FRAMEWORKS, FRAMEWORK_LABELS, RULE_KIND_LABELS, RUNNABLE_FRAMEWORKS, isRunnableFramework, type RuleResult, type StandardsInput } from './types'
import { PROCUREMENT_WORDS, USACE_DISCLAIMER, USACE_RULES, USACE_VERSION } from './usace'

const cfg = engineConfig()
const run = (id: string, input: StandardsInput): RuleResult => evaluateRule(USACE_RULES.find(r => r.ruleId === id)!, buildNetwork(input), cfg)

describe('USACE and PMI pack metadata', () => {
  const both = [...USACE_RULES, ...PMI_RULES]
  it('every rule has a citation, a unique ruleId and a version', () => {
    const everyId = [...GAO_RULES, ...DCMA_RULES, ...both].map(r => r.ruleId)
    expect(new Set(everyId).size).toBe(everyId.length)
    for (const r of both) {
      expect(r.ruleId).toMatch(/^(USACE|PMI)-\d{2}$/)
      expect(r.version).toBeGreaterThanOrEqual(1)
      expect(r.frameworkVersion).toBeTruthy()
      expect(r.calculation).toBeTruthy()
      expect(r.sourceReference.length).toBeGreaterThan(20)
      expect(r.sourceReference.length).toBeLessThan(120)
      expect(Object.keys(RULE_KIND_LABELS)).toContain(r.kind)
      // Credentials for people are never a framework or a source
      expect(`${r.title} ${r.message} ${r.sourceReference} ${r.framework}`).not.toMatch(/\bPSP\b|PMI-SP|PMP\b/)
      // RunF9's own plain wording: no em dashes
      expect(`${r.title} ${r.message}`).not.toMatch(/—/)
    }
  })
  it('USACE rules cite the specification edition and a paragraph, as a guide specification', () => {
    expect(USACE_RULES.map(r => r.ruleId)).toEqual(Array.from({ length: 10 }, (_, i) => `USACE-${String(i + 1).padStart(2, '0')}`))
    for (const r of USACE_RULES) {
      expect(r.framework).toBe('USACE_UFGS')
      expect(r.kind).toBe('guide_specification')
      expect(r.frameworkVersion).toBe(USACE_VERSION)
      expect(r.sourceReference).toMatch(/^UFGS 01 32 01\.00 10 \(August 2026\), paragraph 3\.\d+(\.\d+)+$/)
    }
    expect(RULE_KIND_LABELS.guide_specification).toBe('Guide specification')
  })
  it('the disclaimer says drawn from, not compliant with, and names who governs', () => {
    expect(USACE_DISCLAIMER).toMatch(/drawn from/)
    expect(USACE_DISCLAIMER).toMatch(/not affiliated with or endorsed by USACE/)
    expect(USACE_DISCLAIMER).toMatch(/contract's own edited specification governs/)
    expect(USACE_DISCLAIMER).not.toMatch(/compliant with|certified|approved by|—/i)
    expect(runStandards(clean(), ['USACE_UFGS']).frameworks[0].disclaimer).toBe(USACE_DISCLAIMER)
  })
})

describe('registration', () => {
  it('both packs are known, runnable and labelled', () => {
    for (const fw of ['USACE_UFGS', 'PMI_SCHEDULING'] as const) {
      expect(FRAMEWORKS).toContain(fw)
      expect(RUNNABLE_FRAMEWORKS).toContain(fw)
      expect(isRunnableFramework(fw)).toBe(true)
      expect(rulesOf(fw)).toBe(RULE_PACKS[fw])
      expect(normalizeFrameworkList([fw])).toEqual([fw])
    }
    expect(FRAMEWORK_LABELS.USACE_UFGS).toBe('USACE UFGS 01 32 01.00 10 (Project Schedule)')
    expect(FRAMEWORK_LABELS.PMI_SCHEDULING).toBe('PMI Practice Standard for Scheduling')
    expect(frameworkVersionOf('USACE_UFGS')).toBe(USACE_VERSION)
    // Credentials for people are not frameworks
    expect(isRunnableFramework('AACE_PSP')).toBe(false)
    expect(isRunnableFramework('PMI_SP')).toBe(false)
  })
  it('a USACE run groups by category and reports no conflicts', () => {
    const out = runStandards(clean(), ['USACE_UFGS'])
    const f = out.frameworks[0]
    expect(f.label).toBe(FRAMEWORK_LABELS.USACE_UFGS)
    expect(f.frameworkVersion).toBe(USACE_VERSION)
    expect(f.groupBy).toBe('category')
    expect(f.groups.map(g => g.label)).toEqual(['Durations', 'Logic', 'Constraints', 'Status', 'Critical path'])
    expect(f.groups.flatMap(g => g.rules)).toHaveLength(USACE_RULES.length)
    expect(f.conflicts).toEqual([])
    expect(out.rulesVersion).toBe(rulesVersionOf(['USACE_UFGS'], cfg))
    expect(out.rulesVersion).not.toBe(rulesVersionOf(['PMI_SCHEDULING'], cfg))
  })
  it('new ruleIds are recognised as citations', () => {
    const out = runStandards(clean(), ['USACE_UFGS', 'PMI_SCHEDULING'])
    expect(unknownRuleCitations('USACE-07 and PMI-03 passed; USACE-99 and PMI-42 did not.', out)).toEqual(['USACE-99', 'PMI-42'])
  })
})

describe('the composite is unchanged', () => {
  it('still runs GAO then DCMA only, under the same version string and rules hash', () => {
    expect(rulesOf('RUNF9_COMPOSITE').map(r => r.ruleId)).toEqual([...GAO_RULES, ...DCMA_RULES].map(r => r.ruleId))
    expect(rulesOf('RUNF9_COMPOSITE')).toHaveLength(41)
    expect(rulesOf('RUNF9_COMPOSITE').some(r => r.framework === 'USACE_UFGS' || r.framework === 'PMI_SCHEDULING')).toBe(false)
    expect(COMPOSITE_VERSION).toBe('RunF9 Composite 1.0')
    expect(frameworkVersionOf('RUNF9_COMPOSITE')).toBe('RunF9 Composite 1.0')
    // Hashes recorded before the USACE and PMI packs were added: stored runs stay comparable.
    expect(rulesVersionOf(['RUNF9_COMPOSITE'], cfg)).toBe('0c6515040a9406c7')
    expect(rulesVersionOf(['GAO_SCHEDULE_GUIDE'], cfg)).toBe('5246c553a95bd2be')
    expect(rulesVersionOf(['DCMA_14'], cfg)).toBe('5dad0080a66d8c79')
  })
})

describe('USACE rules on a clean schedule', () => {
  const res = Object.fromEntries(runStandards(clean(), ['USACE_UFGS']).frameworks[0].groups.flatMap(g => g.rules).map(x => [x.ruleId, x.result]))
  it('nothing fails, and what lacks data is not assessable', () => {
    expect(Object.entries(res).filter(([, v]) => v === 'fail')).toEqual([])
    expect(res['USACE-09']).toBe('not_assessable') // no progress yet
    expect(res['USACE-06']).toBe('warning')        // no completion date on the last activity
  })
})

describe('USACE-01 durations (3.3.2)', () => {
  it('passes at 20 work days and fails above', () => {
    const ok = run('USACE-01', mutate(i => { actOf(i, 'A3').duration = 20 }))
    expect(ok.result).toBe('pass')
    expect(ok.threshold).toMatchObject({ metricKey: 'duration.long_days', value: 20, source: 'published' })
    const r = run('USACE-01', mutate(i => { actOf(i, 'A3').duration = 21 }))
    expect(r.result).toBe('fail'); expect(r.evidence).toEqual(['A3'])
  })
  it('leaves out procurement, recognised by wording, and says so', () => {
    const byName = run('USACE-01', mutate(i => { Object.assign(actOf(i, 'A3'), { duration: 60, name: 'Fabricate and deliver switchgear' }) }))
    expect(byName.result).toBe('pass')
    expect(byName.reason).toMatch(/recognised by wording only/)
    expect(byName.reason).toMatch(/left out as procurement: A3/)
    const byWbs = run('USACE-01', mutate(i => { actOf(i, 'A4').duration = 45; i.wbs!.A4 = '2.1 Procurement' }))
    expect(byWbs.result).toBe('pass')
    for (const w of ['Submittal review', 'Long-lead equipment', 'Purchase order', 'Shop drawings']) expect(PROCUREMENT_WORDS.test(w), w).toBe(true)
    for (const w of ['Pour slab on grade', 'Install ductwork', 'Order of work']) expect(PROCUREMENT_WORDS.test(w), w).toBe(false)
  })
  it('is not assessable with no open tasks', () => expect(run('USACE-01', allComplete()).result).toBe('not_assessable'))
})

describe('USACE-02 open ends (3.3.11)', () => {
  it('passes with only the first and last activity open-ended', () => expect(run('USACE-02', clean()).result).toBe('pass'))
  it('fails on a third open end', () => {
    const r = run('USACE-02', mutate(i => { i.schedule.activities.push(task('B1')); i.schedule.links.push(link('S', 'B1')) }))
    expect(r.result).toBe('fail'); expect(r.evidence).toEqual(['B1'])
    expect(run('USACE-02', mutate(i => { i.schedule.activities.push(ms('M2')); i.schedule.links.push(link('A3', 'M2')) })).result).toBe('fail')
    expect(run('USACE-02', noLinks()).result).toBe('fail')
  })
  it('is not assessable with nothing open', () => expect(run('USACE-02', allComplete()).result).toBe('not_assessable'))
})

describe('USACE-03 relationship types on each end (3.3.11)', () => {
  it('passes on finish-to-start logic', () => expect(run('USACE-03', clean()).result).toBe('pass'))
  it('fails when a start has only a finish-to-finish predecessor, or a finish only a start-to-start successor', () => {
    const r = run('USACE-03', mutate(i => { i.schedule.links.find(l => l.to === 'A4')!.type = 'FF'; i.schedule.links.find(l => l.from === 'A7')!.type = 'SS' }))
    expect(r.result).toBe('fail')
    expect(r.evidence).toEqual(expect.arrayContaining(['A4 (start)', 'A7 (finish)']))
  })
  it('is not assessable without relationships', () => expect(run('USACE-03', noLinks()).result).toBe('not_assessable'))
})

describe('USACE-04 mandatory and zero-float constraints (3.3.8)', () => {
  it('passes with none, and with a constraint that is not mandatory', () => {
    expect(run('USACE-04', clean()).result).toBe('pass')
    expect(run('USACE-04', mutate(i => { actOf(i, 'A3').constraint = { type: 'SNET', date: '2026-04-01' } })).result).toBe('pass')
  })
  it('fails on a mandatory constraint and on a named zero-float setting', () => {
    const r = run('USACE-04', mutate(i => { actOf(i, 'A3').constraint = { type: 'MSO', date: '2026-04-01' }; actOf(i, 'A5').constraint = { type: 'Mandatory Finish', date: '2026-05-01' }; actOf(i, 'A6').constraint = { type: 'ALAP' } }))
    expect(r.result).toBe('fail')
    expect(r.evidence).toEqual(['A3 (MSO)', 'A5 (MFO)', 'A6 (ALAP)'])
    expect(r.reason).toMatch(/does not show the file has none/)
  })
  it('is not assessable with nothing open', () => expect(run('USACE-04', allComplete()).result).toBe('not_assessable'))
})

describe('USACE-05 other date constraints (3.3.8)', () => {
  it('passes with none, leaving out the last activity and mandatory constraints', () => {
    expect(run('USACE-05', clean()).result).toBe('pass')
    expect(run('USACE-05', mutate(i => { actOf(i, 'F').constraint = { type: 'FNLT', date: '2026-12-31' }; actOf(i, 'A3').constraint = { type: 'MSO', date: '2026-04-01' } })).result).toBe('pass')
  })
  it('warns, never fails, and shows the date as MM/DD/YYYY', () => {
    const r = run('USACE-05', mutate(i => { actOf(i, 'A3').constraint = { type: 'SNET', date: '2026-04-01' } }))
    expect(r.result).toBe('warning'); expect(r.evidence).toEqual(['A3 (SNET 04/01/2026)'])
  })
  it('is not assessable with nothing open', () => expect(run('USACE-05', allComplete()).result).toBe('not_assessable'))
})

describe('USACE-06 completion date on the last activity (3.3.8.2)', () => {
  it('passes with a finish constraint on the last activity or a project required finish', () => {
    const r = run('USACE-06', mutate(i => { actOf(i, 'F').constraint = { type: 'FNLT', date: '2026-12-31' } }))
    expect(r.result).toBe('pass'); expect(r.metric).toBe('F: FNLT 12/31/2026')
    expect(run('USACE-06', mutate(i => { i.schedule.mustFinishBy = '2026-12-31' })).result).toBe('pass')
  })
  it('warns when no date is set', () => {
    const r = run('USACE-06', clean())
    expect(r.result).toBe('warning'); expect(r.evidence).toEqual(['F'])
  })
  it('is not assessable when the last activity is complete or cannot be identified', () => {
    expect(run('USACE-06', allComplete()).result).toBe('not_assessable')
    expect(run('USACE-06', mutate(i => { i.schedule.activities = []; i.schedule.links = [] })).result).toBe('not_assessable')
  })
})

describe('USACE-07 leads (3.3.16)', () => {
  it('passes with none and with a positive lag', () => {
    expect(run('USACE-07', clean()).result).toBe('pass')
    expect(run('USACE-07', mutate(i => { i.schedule.links[3].lag = 2 })).result).toBe('pass')
  })
  it('fails on a negative lag', () => {
    const r = run('USACE-07', mutate(i => { i.schedule.links[3].lag = -2 }))
    expect(r.result).toBe('fail'); expect(r.evidence).toEqual(['A3 → A4 (-2d)'])
    expect(r.threshold).toMatchObject({ metricKey: 'logic.leads_count', value: 0, source: 'published' })
  })
  it('is not assessable without relationships', () => expect(run('USACE-07', noLinks()).result).toBe('not_assessable'))
})

describe('USACE-08 start-to-finish (3.3.16)', () => {
  it('passes with none', () => expect(run('USACE-08', clean()).result).toBe('pass'))
  it('fails on a start-to-finish relationship', () => {
    const r = run('USACE-08', mutate(i => { i.schedule.links.push(link('A2', 'A6', 'SF')) }))
    expect(r.result).toBe('fail'); expect(r.evidence).toEqual(['A2 → A6 (SF)'])
  })
  it('is not assessable without relationships', () => expect(run('USACE-08', noLinks()).result).toBe('not_assessable'))
})

describe('USACE-09 out-of-sequence progress (3.3.13)', () => {
  it('passes when progress follows the logic', () => expect(run('USACE-09', progressed()).result).toBe('pass'))
  it('warns, never fails, when work started before its predecessor finished', () => {
    const r = run('USACE-09', mutate(i => { Object.assign(actOf(i, 'A5'), { actualStart: '2026-03-10', status: 'in_progress', percentComplete: 10 }) }, progressed()))
    expect(r.result).toBe('warning'); expect(r.evidence).toEqual(['A4 → A5'])
    expect(r.reason).toMatch(/cannot see whether an approval was given/)
  })
  it('is not assessable before progress, without logic, or on a plan', () => {
    expect(run('USACE-09', clean()).result).toBe('not_assessable')
    expect(run('USACE-09', mutate(i => { i.schedule.links = [] }, progressed())).result).toBe('not_assessable')
    expect(run('USACE-09', mutate(i => { i.subject.kind = 'plan' }, progressed())).result).toBe('not_assessable')
  })
})

describe('USACE-10 critical path is the longest path (3.5.4.3)', () => {
  /** The chain with stored float of 10 days, plus a side task B1 (S → B1 → F) carrying `tf`. */
  const withSide = (tf: number) => mutate(i => {
    for (const a of i.schedule.activities) a.totalFloat = 10
    i.schedule.activities.push(task('B1', 5, { totalFloat: tf }))
    i.schedule.links.push(link('S', 'B1'), link('B1', 'F'))
  })
  it('passes when nothing off the longest path has less float, ties included', () => {
    expect(run('USACE-10', clean()).result).toBe('pass')
    expect(run('USACE-10', withSide(10)).result).toBe('pass')
    expect(run('USACE-10', withSide(30)).result).toBe('pass')
  })
  it('warns when an activity off the longest path has less float', () => {
    const r = run('USACE-10', withSide(-5))
    expect(r.result).toBe('warning'); expect(r.evidence).toEqual(['B1 (-5d)'])
    expect(r.reason).toMatch(/stored in the file/)
  })
  it('is not assessable without logic, with a logic loop, or without a start date', () => {
    expect(run('USACE-10', noLinks()).result).toBe('not_assessable')
    expect(run('USACE-10', mutate(i => { i.schedule.links.push(link('A5', 'A3')) })).result).toBe('not_assessable')
    expect(run('USACE-10', mutate(i => { i.schedule.projectStart = null; i.schedule.dataDate = null })).result).toBe('not_assessable')
  })
})
