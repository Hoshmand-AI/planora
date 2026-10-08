import { describe, expect, it } from 'vitest'
import type { AnalyzableActivity, CpmLink } from '@/lib/planning/types'
import { defaultCalendar } from '@/lib/planning/calendar'
import { runDcma, DEFAULT_DCMA_RULES } from '@/lib/analysis/dcma'
import { sampleProject } from '@/lib/planning/sample'
import type { Plan } from '@/lib/db'
import { normalizeSettings } from '@/lib/server/settings'
import { DCMA_RULES } from './dcma-pack'
import { GAO_RULES, GAO_DISCLAIMER } from './gao'
import { detectConflicts, engineConfig, evaluateRule, rulesVersionOf, runStandards } from './engine'
import { buildNetwork } from './network'
import { normalizeFrameworkList, normalizeStandardsSettings, DEFAULT_GAO_THRESHOLDS } from './config'
import { planStandardsInput } from './inputs'
import { standardsPromptContext, unknownRuleCitations } from './explain'
import type { RuleResult, StandardsInput } from './types'

const cal = defaultCalendar()
const task = (id: string, duration = 5, extra: Partial<AnalyzableActivity> = {}): AnalyzableActivity =>
  ({ id, code: id, name: `Task ${id}`, type: 'task', duration, baselineStart: '2026-03-02', baselineFinish: '2026-12-31', ...extra })
const ms = (id: string, extra: Partial<AnalyzableActivity> = {}): AnalyzableActivity =>
  ({ id, code: id, name: `Milestone ${id}`, type: 'milestone', duration: 0, baselineStart: '2026-03-02', baselineFinish: '2026-12-31', ...extra })
const fs = (from: string, to: string, lag = 0): CpmLink => ({ from, to, type: 'FS', lag })

/** A clean 20-task chain S → A1..A20 → F, not started, with WBS and a baseline. */
function clean(over: Partial<StandardsInput> = {}, n = 20): StandardsInput {
  const acts: AnalyzableActivity[] = [ms('S', { milestoneKind: 'start' })]
  const links: CpmLink[] = []
  let prev = 'S'
  for (let i = 1; i <= n; i++) { acts.push(task(`A${i}`)); links.push(fs(prev, `A${i}`)); prev = `A${i}` }
  acts.push(ms('F', { milestoneKind: 'finish' }))
  links.push(fs(prev, 'F'))
  return {
    subject: { kind: 'schedule', id: 'sch1', name: 'Test', version: 'Update 1' },
    schedule: { projectStart: '2026-03-02', dataDate: '2026-03-02', activities: acts, links, calendars: [cal], defaultCalendarId: cal.id },
    wbs: Object.fromEntries(acts.map(a => [a.id, '1.1 Work'])),
    baseline: { source: 'baseline_upload', label: 'Baseline' },
    riskAnalysis: null,
    ...over,
  }
}
/** Same network with progress: S and A1 complete, A2 in progress, data date 03/16/2026. */
function progressed(): StandardsInput {
  const inp = clean()
  const a = inp.schedule.activities
  a[0] = { ...a[0], actualStart: '2026-03-02', actualFinish: '2026-03-02', status: 'complete' }
  a[1] = { ...a[1], actualStart: '2026-03-02', actualFinish: '2026-03-06', status: 'complete', percentComplete: 100 }
  a[2] = { ...a[2], actualStart: '2026-03-09', status: 'in_progress', percentComplete: 50, remaining: 3 }
  inp.schedule.dataDate = '2026-03-16'
  return inp
}

const cfg = engineConfig()
const rule = (id: string) => [...GAO_RULES, ...DCMA_RULES].find(r => r.ruleId === id)!
const run = (id: string, input: StandardsInput, c = cfg): RuleResult => evaluateRule(rule(id), buildNetwork(input), c)
const mutate = (fn: (i: StandardsInput) => void, base = clean()) => { fn(base); return base }
const actOf = (i: StandardsInput, id: string) => i.schedule.activities.find(a => a.id === id)!

describe('rule metadata', () => {
  const all = [...GAO_RULES, ...DCMA_RULES]
  it('ruleIds are unique and every rule carries provenance', () => {
    expect(new Set(all.map(r => r.ruleId)).size).toBe(all.length)
    for (const r of all) {
      expect(r.version).toBeGreaterThanOrEqual(1)
      expect(r.frameworkVersion).toBeTruthy()
      expect(r.calculation).toBeTruthy()
      expect(r.sourceReference.length).toBeLessThan(120)
      expect(['standard_guidance', 'assessment_metric', 'recommended_practice', 'contract_requirement']).toContain(r.kind)
      // Credentials are never standards
      expect(`${r.title} ${r.message} ${r.sourceReference} ${r.framework}`).not.toMatch(/\bPSP\b|PMI-SP|PMP\b/)
    }
  })
  it('GAO profile covers best practices 1–10 under the four characteristics', () => {
    const bps = new Set(GAO_RULES.map(r => r.bestPractice))
    for (let i = 1; i <= 10; i++) expect(bps.has(i), `BP${i}`).toBe(true)
    const charOf = (bp: number) => GAO_RULES.find(r => r.bestPractice === bp)!.characteristic
    expect([1, 3, 4].map(charOf)).toEqual(['comprehensive', 'comprehensive', 'comprehensive'])
    expect([2, 6, 7].map(charOf)).toEqual(['well_constructed', 'well_constructed', 'well_constructed'])
    expect([5, 8].map(charOf)).toEqual(['credible', 'credible'])
    expect([9, 10].map(charOf)).toEqual(['controlled', 'controlled'])
    for (const r of GAO_RULES) { expect(r.framework).toBe('GAO_SCHEDULE_GUIDE'); expect(r.frameworkVersion).toBe('GAO-16-89G') }
  })
  it('DCMA pack has 14 assessment metrics', () => {
    expect(DCMA_RULES.map(r => r.ruleId)).toEqual(Array.from({ length: 14 }, (_, i) => `DCMA-${String(i + 1).padStart(2, '0')}`))
    expect(DCMA_RULES.every(r => r.kind === 'assessment_metric')).toBe(true)
  })
})

describe('GAO rules on a clean schedule', () => {
  const r = runStandards(clean(), ['GAO_SCHEDULE_GUIDE'])
  const res = Object.fromEntries(r.frameworks[0].groups.flatMap(g => g.rules).map(x => [x.ruleId, x.result]))
  it('no rule fails', () => expect(Object.entries(res).filter(([, v]) => v === 'fail')).toEqual([]))
  it('data the schedule lacks is not assessable, never a fake pass', () => {
    expect(res['GAO-BP3-01']).toBe('not_assessable')  // no resource data
    expect(res['GAO-BP8-01']).toBe('not_assessable')  // no SRA on record
    expect(res['GAO-BP9-02']).toBe('not_assessable')  // no progress yet
  })
  it('groups by characteristic and carries the disclaimer', () => {
    expect(r.frameworks[0].groups.map(g => g.key)).toEqual(['comprehensive', 'well_constructed', 'credible', 'controlled'])
    expect(r.frameworks[0].disclaimer).toBe(GAO_DISCLAIMER)
    expect(GAO_DISCLAIMER).toMatch(/not a determination of compliance/)
    expect(r.disclaimer).toMatch(/not a GAO compliance determination/)
  })
})

describe('GAO BP1 capturing all activities', () => {
  it('WBS coverage: pass / fail / not assessable', () => {
    expect(run('GAO-BP1-01', clean()).result).toBe('pass')
    const half = clean(); for (const k of Object.keys(half.wbs!).slice(0, 12)) half.wbs![k] = ''
    const r = run('GAO-BP1-01', half)
    expect(r.result).toBe('fail'); expect(r.evidence).toContain('A1')
    expect(run('GAO-BP1-01', clean({ wbs: {} })).result).toBe('not_assessable')
  })
  it('start/finish milestones: pass / fail', () => {
    expect(run('GAO-BP1-02', clean()).result).toBe('pass')
    const none = mutate(i => { i.schedule.activities = i.schedule.activities.map(a => ({ ...a, type: 'task', duration: a.duration || 1 })) })
    expect(run('GAO-BP1-02', none).result).toBe('fail')
  })
  it('LOE identified: support work typed as a task is a warning', () => {
    expect(run('GAO-BP1-03', clean()).result).toBe('pass')
    const r = run('GAO-BP1-03', mutate(i => { actOf(i, 'A5').name = 'Project management and supervision' }))
    expect(r.result).toBe('warning'); expect(r.evidence).toEqual(['A5'])
  })
})

describe('GAO BP2 sequencing', () => {
  it('open ends: pass / fail / not assessable', () => {
    expect(run('GAO-BP2-01', clean()).result).toBe('pass')
    const r = run('GAO-BP2-01', mutate(i => { i.schedule.links = i.schedule.links.filter(l => l.to !== 'A7') }))
    expect(r.result).toBe('fail'); expect(r.evidence).toContain('A7')
    const done = mutate(i => { i.schedule.activities = i.schedule.activities.map(a => ({ ...a, status: 'complete', actualStart: '2026-03-02', actualFinish: '2026-03-02' })) })
    expect(run('GAO-BP2-01', done).result).toBe('not_assessable')
  })
  it('dangling logic: an FF-only predecessor leaves the start dangling', () => {
    expect(run('GAO-BP2-02', clean()).result).toBe('pass')
    const r = run('GAO-BP2-02', mutate(i => { i.schedule.links = i.schedule.links.map(l => l.to === 'A4' ? { ...l, type: 'FF' } : l) }))
    expect(r.result).toBe('fail'); expect(r.evidence).toContain('A4 (start)')
    expect(run('GAO-BP2-02', clean({ schedule: { ...clean().schedule, links: [] } })).result).toBe('not_assessable')
  })
  it('leads fail; lags warn; SF links warn', () => {
    expect(run('GAO-BP2-03', mutate(i => { i.schedule.links[3].lag = -2 })).result).toBe('fail')
    expect(run('GAO-BP2-03', clean()).result).toBe('pass')
    const lag = run('GAO-BP2-04', mutate(i => { i.schedule.links[3].lag = 3 }))
    expect(lag.result).toBe('warning'); expect(lag.threshold?.source).toBe('planora_default')
    expect(run('GAO-BP2-04', clean()).result).toBe('pass')
    expect(run('GAO-BP2-05', mutate(i => { i.schedule.links[3].type = 'SF' })).result).toBe('warning')
    expect(run('GAO-BP2-05', clean()).result).toBe('pass')
  })
  it('hard constraints: one is a warning, many fail', () => {
    expect(run('GAO-BP2-06', clean()).result).toBe('pass')
    expect(run('GAO-BP2-06', mutate(i => { actOf(i, 'A3').constraint = { type: 'MSO', date: '2026-04-01' } })).result).toBe('warning')
    const many = run('GAO-BP2-06', mutate(i => { for (const id of ['A3', 'A4', 'A5']) actOf(i, id).constraint = { type: 'FNLT', date: '2026-09-01' } }))
    expect(many.result).toBe('fail'); expect(many.evidence).toContain('A4 (FNLT)')
  })
})

describe('GAO BP3 resources', () => {
  it('not assessable without resource data; pass when loaded; fail when bare', () => {
    expect(run('GAO-BP3-01', clean()).result).toBe('not_assessable')
    expect(run('GAO-BP3-01', clean()).reason).toMatch(/not a pass/)
    const loaded = mutate(i => { i.schedule.activities = i.schedule.activities.map(a => ({ ...a, resourceCount: 1 })) })
    expect(run('GAO-BP3-01', loaded).result).toBe('pass')
    const bare = mutate(i => { i.schedule.activities = i.schedule.activities.map(a => ({ ...a, resourceCount: 0 })) })
    expect(run('GAO-BP3-01', bare).result).toBe('fail')
  })
})

describe('GAO BP4 durations', () => {
  it('long durations and zero-duration tasks', () => {
    expect(run('GAO-BP4-01', clean()).result).toBe('pass')
    expect(run('GAO-BP4-01', mutate(i => { actOf(i, 'A2').duration = 60 })).result).toBe('warning')
    expect(run('GAO-BP4-01', mutate(i => { for (const id of ['A2', 'A3']) actOf(i, id).duration = 60 })).result).toBe('fail')
    expect(run('GAO-BP4-02', mutate(i => { actOf(i, 'A2').duration = 0 })).result).toBe('warning')
    expect(run('GAO-BP4-02', clean()).result).toBe('pass')
  })
})

describe('GAO BP5 traceability', () => {
  it('milestone with no detailed work driving it fails vertical traceability', () => {
    expect(run('GAO-BP5-01', clean()).result).toBe('pass')
    const r = run('GAO-BP5-01', mutate(i => {
      i.schedule.activities.push(ms('M1'))
      i.schedule.links.push(fs('S', 'M1'), fs('M1', 'F'))
    }))
    expect(r.result).toBe('fail'); expect(r.evidence).toEqual(['M1'])
    const noMs = mutate(i => { i.schedule.activities = i.schedule.activities.filter(a => a.id !== 'F'); i.schedule.links = i.schedule.links.filter(l => l.to !== 'F') })
    expect(run('GAO-BP5-01', noMs).result).toBe('not_assessable')
  })
  it('logic on WBS summaries is a warning', () => {
    expect(run('GAO-BP5-02', clean()).result).toBe('pass')
    const r = run('GAO-BP5-02', mutate(i => { i.schedule.activities.push({ id: 'W1', code: 'W1', name: 'Summary', type: 'summary', duration: 0 }); i.schedule.links.push(fs('W1', 'A3')) }))
    expect(r.result).toBe('warning'); expect(r.evidence).toEqual(['W1 → A3'])
  })
  it('work with no path to the finish fails horizontal traceability', () => {
    expect(run('GAO-BP5-03', clean()).result).toBe('pass')
    const r = run('GAO-BP5-03', mutate(i => { i.schedule.activities.push(task('X1'), task('X2')); i.schedule.links.push(fs('S', 'X1'), fs('X1', 'X2')) }))
    expect(r.result).toBe('fail'); expect(r.evidence).toEqual(['X1', 'X2'])
    expect(run('GAO-BP5-03', clean({ schedule: { ...clean().schedule, links: [] } })).result).toBe('not_assessable')
  })
})

describe('GAO BP6 critical path', () => {
  it('continuous driving path passes; loops fail; no logic is not assessable', () => {
    const ok = run('GAO-BP6-01', clean())
    expect(ok.result).toBe('pass'); expect(ok.evidence[0]).toBe('S'); expect(ok.evidence.at(-1)).toBe('F')
    expect(run('GAO-BP6-01', mutate(i => { i.schedule.links.push(fs('A5', 'A3')) })).result).toBe('fail')
    expect(run('GAO-BP6-01', clean({ schedule: { ...clean().schedule, links: [] } })).result).toBe('not_assessable')
  })
  it('lags on the driving path are a warning', () => {
    expect(run('GAO-BP6-02', clean()).result).toBe('pass')
    expect(run('GAO-BP6-02', mutate(i => { i.schedule.links[5].lag = 4 })).result).toBe('warning')
  })
})

describe('GAO BP7 total float', () => {
  it('high float is flagged for justification; negative float fails; no float is not assessable', () => {
    expect(run('GAO-BP7-01', clean()).result).toBe('pass')
    const hi = mutate(i => { i.schedule.activities = i.schedule.activities.map(a => ({ ...a, totalFloat: a.id === 'A9' ? 80 : 0 })) })
    const r = run('GAO-BP7-01', hi)
    expect(r.result).toBe('warning'); expect(r.evidence).toEqual(['A9 (80d)'])
    expect(r.parameters[0]).toMatchObject({ metricKey: 'float.high_days', value: 44 })
    const neg = mutate(i => { i.schedule.activities = i.schedule.activities.map(a => ({ ...a, totalFloat: a.id === 'A9' ? -3 : 0 })) })
    expect(run('GAO-BP7-02', neg).result).toBe('fail')
    expect(run('GAO-BP7-02', clean()).result).toBe('pass')
    const noTf = mutate(i => { i.schedule.projectStart = null; i.schedule.dataDate = null })
    expect(run('GAO-BP7-01', noTf).result).toBe('not_assessable')
  })
})

describe('GAO BP8 schedule risk analysis', () => {
  it('not assessable without a record; pass with one; warning when older than the data date', () => {
    expect(run('GAO-BP8-01', clean()).result).toBe('not_assessable')
    expect(run('GAO-BP8-01', clean({ riskAnalysis: { recordedAt: '2026-03-05T10:00:00Z', ranges: 12, events: 3, source: 'risk inputs' } })).result).toBe('pass')
    const p = progressed(); p.riskAnalysis = { recordedAt: '2026-03-01T10:00:00Z', ranges: 12, events: 3, source: 'risk inputs' }
    expect(run('GAO-BP8-01', p).result).toBe('warning')
    expect(run('GAO-BP8-01', clean({ riskAnalysis: { recordedAt: '2026-03-05', ranges: 0, events: 0, source: 'x' } })).result).toBe('not_assessable')
  })
})

describe('GAO BP9 updating with actuals', () => {
  it('data date: pass / fail / not assessable for a plan', () => {
    expect(run('GAO-BP9-01', progressed()).result).toBe('pass')
    expect(run('GAO-BP9-01', mutate(i => { i.schedule.dataDate = null })).result).toBe('fail')
    expect(run('GAO-BP9-01', clean({ subject: { kind: 'plan', id: 'p', name: 'P' } })).result).toBe('not_assessable')
  })
  it('future actuals', () => {
    expect(run('GAO-BP9-02', progressed()).result).toBe('pass')
    expect(run('GAO-BP9-02', mutate(i => { actOf(i, 'A2').actualStart = '2026-04-01' }, progressed())).result).toBe('fail')
    expect(run('GAO-BP9-02', clean()).result).toBe('not_assessable')
  })
  it('out-of-sequence progress', () => {
    expect(run('GAO-BP9-03', progressed()).result).toBe('pass')
    const r = run('GAO-BP9-03', mutate(i => { Object.assign(actOf(i, 'A4'), { actualStart: '2026-03-12', status: 'in_progress', percentComplete: 10 }) }, progressed()))
    expect(r.result).toBe('warning'); expect(r.evidence).toEqual(['A3 → A4'])
  })
  it('progress without actual dates', () => {
    expect(run('GAO-BP9-04', progressed()).result).toBe('pass')
    const r = run('GAO-BP9-04', mutate(i => { actOf(i, 'A2').actualStart = null }, progressed()))
    expect(r.result).toBe('fail'); expect(r.evidence).toEqual(['A2 (no actual start)'])
  })
  it('unstatused work before the data date', () => {
    expect(run('GAO-BP9-05', progressed()).result).toBe('pass')
    const r = run('GAO-BP9-05', mutate(i => { Object.assign(actOf(i, 'A3'), { earlyStart: '2026-03-10', earlyFinish: '2026-03-14' }) }, progressed()))
    expect(r.result).toBe('fail'); expect(r.evidence).toContain('A3')
    expect(run('GAO-BP9-05', mutate(i => { i.schedule.dataDate = null }, progressed())).result).toBe('not_assessable')
  })
})

describe('GAO BP10 baseline', () => {
  it('designated baseline: pass / fail / not assessable for an unpublished plan', () => {
    expect(run('GAO-BP10-01', clean()).result).toBe('pass')
    expect(run('GAO-BP10-01', clean({ baseline: { source: 'none' } })).result).toBe('fail')
    expect(run('GAO-BP10-01', clean({ baseline: { source: 'none' }, subject: { kind: 'plan', id: 'p', name: 'P' } })).result).toBe('not_assessable')
  })
  it('baseline coverage of current work', () => {
    expect(run('GAO-BP10-02', clean()).result).toBe('pass')
    const r = run('GAO-BP10-02', mutate(i => { for (const id of ['A1', 'A2']) actOf(i, id).baselineFinish = null }))
    expect(r.result).toBe('warning'); expect(r.evidence).toEqual(['A1', 'A2'])
    expect(run('GAO-BP10-02', clean({ baseline: { source: 'none' } })).result).toBe('not_assessable')
  })
})

describe('DCMA adapter parity with dcma.ts', () => {
  const fixtures: [string, StandardsInput][] = [
    ['clean', clean()],
    ['progressed', progressed()],
    ['flawed', mutate(i => {
      i.schedule.links = i.schedule.links.filter(l => l.to !== 'A7')
      i.schedule.links[2].lag = 5; i.schedule.links[4].lag = -1; i.schedule.links[6].type = 'SS'
      actOf(i, 'A3').constraint = { type: 'MSO', date: '2026-05-01' }
      actOf(i, 'A9').duration = 70
      i.schedule.activities = i.schedule.activities.map(a => ({ ...a, resourceCount: a.id === 'A4' ? 0 : 1 }))
    }, progressed())],
  ]
  for (const [name, input] of fixtures) {
    for (const rules of [DEFAULT_DCMA_RULES, { ...DEFAULT_DCMA_RULES, maxPct: 10, highFloatDays: 20 }]) {
      it(`${name} (maxPct ${rules.maxPct}): every rule equals runDcma`, () => {
        const ref = runDcma(input.schedule, rules)
        const out = runStandards(input, ['DCMA_14'], engineConfig({ dcma: rules })).frameworks[0]
        const got = out.groups.flatMap(g => g.rules)
        expect(got).toHaveLength(14)
        const map = { pass: 'pass', fail: 'fail', warn: 'warning', 'n/a': 'not_assessable' } as const
        for (const c of ref.checks) {
          const r = got.find(x => x.ruleId === `DCMA-${String(c.id).padStart(2, '0')}`)!
          expect(r.result, `DCMA #${c.id}`).toBe(map[c.result])
          expect(r.evidence).toEqual(c.offenders.slice(0, 200))
          expect(r.evidenceTotal).toBe(c.offenders.length)
          expect(r.metric.startsWith(c.metric)).toBe(true)
        }
        expect(out.counts.pass).toBe(ref.passed)
      })
    }
  }
})

describe('Planora Composite', () => {
  const r = runStandards(clean(), ['PLANORA_COMPOSITE']).frameworks[0]
  const rules = r.groups.flatMap(g => g.rules)
  it('applies GAO and DCMA rules, each keeping its own source', () => {
    expect(rules.some(x => x.framework === 'GAO_SCHEDULE_GUIDE')).toBe(true)
    expect(rules.some(x => x.framework === 'DCMA_14')).toBe(true)
    expect(rules.find(x => x.ruleId === 'DCMA-06')!.sourceReference).toMatch(/DCMA/)
    expect(r.groups.map(g => g.key)).toEqual(['comprehensive', 'well_constructed', 'credible', 'controlled'])
  })
  it('reports threshold conflicts between packs instead of blending them', () => {
    const keys = r.conflicts.map(c => c.metricKey)
    expect(keys).toEqual(expect.arrayContaining(['float.high_share_pct', 'logic.lags_share_pct', 'logic.open_ends_pct', 'resources.loaded_pct']))
    expect(keys).not.toContain('logic.leads_count')     // both packs agree (0)
    expect(keys).not.toContain('float.high_days')       // both 44 work days by default
    const lags = r.conflicts.find(c => c.metricKey === 'logic.lags_share_pct')!
    expect(lags.sides.map(s => [s.ruleId, s.framework, s.threshold.value, s.threshold.source])).toEqual([
      ['GAO-BP2-04', 'GAO_SCHEDULE_GUIDE', 0, 'planora_default'],
      ['DCMA-03', 'DCMA_14', 5, 'published'],
    ])
    expect(lags.resolution).toMatch(/does not merge/)
  })
  it('a finding that differs by source shows both results', () => {
    const one = mutate(i => { i.schedule.links[3].lag = 2 })
    const rs = runStandards(one, ['PLANORA_COMPOSITE']).frameworks[0]
    const c = rs.conflicts.find(x => x.metricKey === 'logic.lags_share_pct')!
    expect(c.sides.map(s => s.result)).toEqual(['warning', 'pass'])
  })
  it('conflicts follow the organization\'s thresholds', () => {
    const aligned = engineConfig({ gao: { ...DEFAULT_GAO_THRESHOLDS, lagsMaxPct: 5, highFloatMaxPct: 5, openEndsMaxPct: 5 } })
    const rs = runStandards(clean(), ['PLANORA_COMPOSITE'], aligned).frameworks[0]
    expect(rs.conflicts.map(c => c.metricKey)).toEqual(['resources.loaded_pct'])
    const dayConflict = runStandards(clean(), ['PLANORA_COMPOSITE'], engineConfig({ dcma: { highFloatDays: 30 } })).frameworks[0]
    const hd = dayConflict.conflicts.find(c => c.metricKey === 'float.high_days')!
    expect(hd.sides.find(s => s.framework === 'DCMA_14')!.threshold.source).toBe('org_configured')
  })
  it('only the composite reports conflicts', () => {
    const multi = runStandards(clean(), ['GAO_SCHEDULE_GUIDE', 'DCMA_14'])
    expect(multi.frameworks.map(f => f.conflicts.length)).toEqual([0, 0])
    expect(detectConflicts(multi.frameworks[0].groups.flatMap(g => g.rules))).toEqual([])
  })
})

describe('engine determinism and versioning', () => {
  it('same input and rules give identical output', () => {
    expect(JSON.stringify(runStandards(clean(), ['PLANORA_COMPOSITE', 'GAO_SCHEDULE_GUIDE', 'DCMA_14'])))
      .toBe(JSON.stringify(runStandards(clean(), ['PLANORA_COMPOSITE', 'GAO_SCHEDULE_GUIDE', 'DCMA_14'])))
  })
  it('rules version changes with thresholds and framework set, not with data', () => {
    const v = rulesVersionOf(['GAO_SCHEDULE_GUIDE'], cfg)
    expect(v).toMatch(/^[0-9a-f]{16}$/)
    expect(runStandards(progressed(), ['GAO_SCHEDULE_GUIDE']).rulesVersion).toBe(v)
    expect(rulesVersionOf(['GAO_SCHEDULE_GUIDE'], engineConfig({ gao: { highFloatDays: 30 } }))).not.toBe(v)
    expect(rulesVersionOf(['DCMA_14'], cfg)).not.toBe(v)
  })
  it('evidence is capped but the total is kept', () => {
    const big = clean({}, 260)
    big.schedule.activities = big.schedule.activities.map(a => ({ ...a, resourceCount: 0 }))
    const r = run('GAO-BP3-01', big)
    expect(r.evidence).toHaveLength(200); expect(r.evidenceTotal).toBe(260)
  })
})

describe('plan input', () => {
  it('a generated plan runs through every framework; status and resources are not assessable', () => {
    const { generated, answers } = sampleProject('2026-01-15')
    const plan = { id: 'plan1', orgId: 'o', userId: 'u', name: 'Sample', answers, extraQuestions: [], generated, reviews: [], audit: [], decisions: {}, scheduleId: null, createdAt: '', updatedAt: '', version: 3 } as Plan
    const input = planStandardsInput(plan)!
    expect(input.subject).toMatchObject({ kind: 'plan', id: 'plan1', version: '3' })
    const out = runStandards(input, ['PLANORA_COMPOSITE'])
    const res = Object.fromEntries(out.frameworks[0].groups.flatMap(g => g.rules).map(x => [x.ruleId, x.result]))
    expect(res['GAO-BP3-01']).toBe('not_assessable')
    expect(res['GAO-BP9-04']).toBe('not_assessable')
    expect(res['GAO-BP10-01']).toBe('not_assessable')
    expect(res['GAO-BP2-01']).not.toBe('not_assessable')
    expect(planStandardsInput({ ...plan, generated: null })).toBeNull()
  })
})

describe('AI explanation context', () => {
  const out = runStandards(clean(), ['PLANORA_COMPOSITE'])
  it('cites ruleIds and states that results are authoritative', () => {
    const ctx = standardsPromptContext(out)
    expect(ctx).toMatch(/GAO-BP2-01 \[PASS\]/)
    expect(ctx).toMatch(/DCMA-06/)
    expect(ctx).toMatch(/do not re-judge/)
  })
  it('flags ruleIds the model invented', () => {
    expect(unknownRuleCitations('Per GAO-BP2-01 and DCMA-06 and GAO-BP11-01, DCMA-15', out)).toEqual(['GAO-BP11-01', 'DCMA-15'])
  })
})

describe('organization settings', () => {
  it('defaults to Planora Composite and normalizes input', () => {
    expect(normalizeSettings({}).standards.defaultFrameworks).toEqual(['PLANORA_COMPOSITE'])
    expect(normalizeStandardsSettings({ defaultFrameworks: ['DCMA_14', 'bogus', 'DCMA_14'], gao: { highFloatDays: 9999, lagsMaxPct: 'x' } }))
      .toEqual({ defaultFrameworks: ['DCMA_14'], gao: { ...DEFAULT_GAO_THRESHOLDS, highFloatDays: 260 } })
    expect(normalizeFrameworkList('CUSTOMER')).toEqual(['PLANORA_COMPOSITE'])
  })
})
