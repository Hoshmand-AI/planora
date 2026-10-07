import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { Activity, Schedule } from '@/lib/db'
import { parseXER, readXerTables } from '@/lib/parsers/xer-parser'
import { completeSchedule } from './complete-schedule'
import { analyzeSchedule } from '@/lib/analysis/schedule-analysis'
import { applyScheduleEdits, reasonError, validateEditChange, type ScheduleEdit, type ScheduleEditChange } from './uploaded-edits'
import { evaluateNetwork, uploadedRecoveryOptions, type NetworkInput } from './uploaded-recovery'
import { uploadedToGenerated } from './uploaded'
import { runSra, distributionFor } from './sra'
import { workKind } from './work-kind'
import { parseRiskInputs } from './risk-inputs'
import { exportXerFromOriginal, xerEditsFrom, xerUpdatesFrom } from '@/lib/export/xer'
import { editsSection } from '@/lib/export/reports'
import { guidanceFor } from '@/lib/analysis/dcma-guidance'

const xer = fs.readFileSync(path.join(__dirname, '../parsers/__fixtures__/sample.xer'), 'latin1')
// The sample's finish milestone is pinned by a Finish On constraint (06/30/2026), so nothing upstream
// can move the finish; without it, logic drives the finish (A1040 -> A1050 -> A1070).
const logicDriven = xer.replace('\tCS_MEO\t', '\t\t')

function load(text = xer, id = 's1') {
  const p = parseXER(text, id)
  const net: NetworkInput = {
    activities: p.activities, relationships: p.relationships, calendars: p.calendars, defaultCalendarId: p.defaultCalendarId,
    projectStart: p.projectStart, dataDate: p.dataDate, mustFinishBy: p.mustFinishBy ?? null, progressMode: 'retained',
  }
  return { p, net }
}
const code = (acts: Activity[], c: string) => acts.find(a => a.activityId === c)!
let n = 0
const edit = (change: ScheduleEditChange, reason = 'Test reason'): ScheduleEdit => ({ id: `e${++n}`, change, reason, by: 'u1', byName: 'Ana', at: `2026-10-0${1 + (n % 5)}T00:00:00.000Z` })

function recalc(net: NetworkInput, edits: ScheduleEdit[]) {
  const e = applyScheduleEdits(net.activities, net.relationships, edits)
  const done = completeSchedule({ ...net, activities: e.activities, relationships: e.relationships, projectFinish: null })
  return { ...e, done }
}

describe('edits on uploaded schedules (override layer)', () => {
  const { p, net } = load(logicDriven)
  const base = recalc(net, [])
  const driving = base.done.cpm!.longestPath.map(id => p.activities.find(a => a.id === id)!).filter(a => a.activityType === 'task' && a.status === 'not_started')
  const steel = code(p.activities, 'A1050')

  it('a shorter remaining duration on a driving activity pulls the CPM finish in, without mutating the import', () => {
    expect(driving.map(a => a.activityId)).toContain('A1050')
    const r = recalc(net, [edit({ kind: 'duration', activityId: steel.id, remaining: 10 })])
    expect(r.done.cpm!.logicFinish < base.done.cpm!.logicFinish).toBe(true)
    expect(code(r.activities, 'A1050').duration).toBe(10)
    expect(steel.duration).toBe(15) // imported activity untouched
    expect(r.applied[0]).toMatchObject({ status: 'applied', before: '15d', after: '10d' })
    expect(r.editedActivityIds).toEqual([steel.id])
  })

  it('an in-progress activity keeps its original duration; only the remaining changes', () => {
    const exc = code(p.activities, 'A1020')
    const r = recalc(net, [edit({ kind: 'duration', activityId: exc.id, remaining: 2 })])
    const a = code(r.activities, 'A1020')
    expect(a.remainingDuration).toBe(2)
    expect(a.duration).toBe(exc.duration)
  })

  it('adds, changes and removes relationships and sets/clears constraints; replays in order', () => {
    const slab = code(p.activities, 'A1040'), cure = code(p.activities, 'A1060'), sc = code(p.activities, 'A1070')
    const r = recalc(net, [
      edit({ kind: 'link_set', predecessorId: cure.id, successorId: steel.id, type: 'FS', lag: 2 }),
      edit({ kind: 'link_set', predecessorId: slab.id, successorId: steel.id, type: 'SS', lag: 3 }),
      edit({ kind: 'link_remove', predecessorId: cure.id, successorId: sc.id }),
      edit({ kind: 'constraint', activityId: slab.id, constraint: null }),
      edit({ kind: 'constraint', activityId: steel.id, constraint: { type: 'SNET', date: '2026-05-04' } }),
    ])
    expect(r.applied.every(x => x.status === 'applied')).toBe(true)
    expect(r.relationships.find(x => x.predecessorId === cure.id && x.successorId === steel.id)).toMatchObject({ type: 'FS', lag: 2 })
    expect(r.relationships.find(x => x.predecessorId === slab.id && x.successorId === steel.id)).toMatchObject({ type: 'SS', lag: 3 })
    expect(r.relationships.some(x => x.predecessorId === cure.id && x.successorId === sc.id)).toBe(false)
    expect(code(r.activities, 'A1040').constraintType).toBeNull()
    expect(r.done.cpm!.times[steel.id].earlyStart >= '2026-05-04').toBe(true)
    expect(r.applied[1]).toMatchObject({ before: 'FS', after: 'SS +3d' })
    expect(net.relationships.find(x => x.predecessorId === slab.id && x.successorId === steel.id)!.type).toBe('FS')
  })

  it('skips edits that no longer apply instead of failing the schedule', () => {
    const done = code(p.activities, 'A1010')
    const r = applyScheduleEdits(net.activities, net.relationships, [edit({ kind: 'duration', activityId: done.id, remaining: 3 }), edit({ kind: 'duration', activityId: 'gone', remaining: 3 })])
    expect(r.applied.map(x => x.status)).toEqual(['skipped', 'skipped'])
    expect(r.applied[0].note).toMatch(/complete/)
  })

  it('validates edits: codes resolve, loops and completed work are refused, a reason is required', () => {
    const ok = validateEditChange({ kind: 'duration', activityId: 'a1050', remaining: 12 }, p.activities, p.relationships)
    expect(ok).toEqual({ change: { kind: 'duration', activityId: steel.id, remaining: 12 } })
    expect(validateEditChange({ kind: 'link_set', predecessorId: 'A1070', successorId: 'A1030', type: 'FS', lag: 0 }, p.activities, p.relationships)).toMatchObject({ error: expect.stringMatching(/logic loop/) })
    expect(validateEditChange({ kind: 'duration', activityId: 'A1010', remaining: 2 }, p.activities, p.relationships)).toMatchObject({ error: expect.stringMatching(/complete/) })
    expect(validateEditChange({ kind: 'constraint', activityId: 'A1050', constraint: { type: 'XX', date: '2026-05-01' } }, p.activities, p.relationships)).toHaveProperty('error')
    expect(validateEditChange({ kind: 'link_set', predecessorId: 'A1040', successorId: 'A1050', type: 'FS', lag: 0 }, p.activities, p.relationships)).toMatchObject({ error: expect.stringMatching(/already/) })
    expect(reasonError('')).toBeTruthy()
    expect(reasonError('Second crew confirmed')).toBeNull()
  })

  it('edits become overrides with reasons on exported activities', () => {
    const r = recalc(net, [edit({ kind: 'duration', activityId: steel.id, remaining: 12 }, 'Erector adds a crew')])
    const analysis = analyzeSchedule({ activities: r.done.activities, links: r.relationships.map(x => ({ from: x.predecessorId, to: x.successorId })), cpm: r.done.cpm, reportedFinish: null, mustFinishBy: null })
    const s = { id: 's1', name: p.projectName, fileName: 'sample.xer', uploadedAt: '2026-10-01', projectStart: r.done.projectStart, dataDate: p.dataDate, calendars: p.calendars, defaultCalendarId: p.defaultCalendarId } as unknown as Schedule
    const g = uploadedToGenerated(s, r.done.activities, r.relationships, r.done.cpm, analysis, r.applied)
    expect(g.activities.find(a => a.code === 'A1050')!.overrides).toEqual([expect.objectContaining({ field: 'duration', from: '15d', to: '12d', reason: 'Erector adds a crew', by: 'Ana' })])
  })
})

describe('XER export from the original applies the edits', () => {
  const { p, net } = load()
  it('writes durations, constraints and TASKPRED changes; other rows are untouched', () => {
    const steel = code(p.activities, 'A1050'), slab = code(p.activities, 'A1040'), cure = code(p.activities, 'A1060'), sc = code(p.activities, 'A1070')
    const r = recalc(net, [
      edit({ kind: 'duration', activityId: steel.id, remaining: 12 }),
      edit({ kind: 'constraint', activityId: slab.id, constraint: null }),
      edit({ kind: 'link_set', predecessorId: slab.id, successorId: steel.id, type: 'SS', lag: 2 }),
      edit({ kind: 'link_remove', predecessorId: cure.id, successorId: sc.id }),
      edit({ kind: 'link_set', predecessorId: cure.id, successorId: steel.id, type: 'FS', lag: 1 }),
    ])
    const out = exportXerFromOriginal(xer, xerUpdatesFrom(r.done.activities, r.done.cpm!), { edits: xerEditsFrom(r.activities, r.applied) })
    const t = readXerTables(out)
    const task = (c: string) => t['TASK'].find(x => x['task_code'] === c)!
    expect(task('A1050')['target_drtn_hr_cnt']).toBe('96')
    expect(task('A1050')['remain_drtn_hr_cnt']).toBe('96')
    expect(task('A1040')['cstr_type']).toBe('')
    const pred = (a: string, b: string) => t['TASKPRED'].find(x => x['pred_task_id'] === a && x['task_id'] === b)
    expect(pred('1005', '1006')).toMatchObject({ pred_type: 'PR_SS', lag_hr_cnt: '16' })
    expect(pred('1007', '1008')).toBeUndefined()
    expect(pred('1007', '1006')).toMatchObject({ pred_type: 'PR_FS', lag_hr_cnt: '10', proj_id: '1', task_pred_id: '10' })
    // Re-importing the export gives the edited network.
    const again = parseXER(out, 's2')
    const done = completeSchedule({ activities: again.activities, relationships: again.relationships, calendars: again.calendars, defaultCalendarId: again.defaultCalendarId, projectStart: again.projectStart, projectFinish: null, dataDate: again.dataDate, mustFinishBy: again.mustFinishBy })
    expect(done.cpm!.logicFinish).toBe(r.done.cpm!.logicFinish)
    expect(t['CALENDAR']).toEqual(readXerTables(xer)['CALENDAR'])
  })
  it('without edits the file round-trips byte for byte', () => {
    expect(exportXerFromOriginal(xer, new Map(), { edits: { tasks: new Map(), setLinks: [], removeLinks: [] } })).toBe(xer)
  })
})

describe('what-if and recovery options on an uploaded network', () => {
  const { p, net } = load(logicDriven)
  const plan = uploadedRecoveryOptions(net)!

  it('models options on the driving path, each with the finish and float the real network gives', () => {
    expect(plan.options.length).toBeGreaterThan(0)
    for (const o of plan.options) {
      const r = evaluateNetwork(net, o.changes)
      expect(o.newFinish).toBe(r.finish)
      expect(o.minFloatAfter).toBe(r.minFloat)
      expect(o.daysSaved > 0 || (o.minFloatAfter ?? 0) > (o.minFloatBefore ?? 0)).toBe(true)
      expect(o.reason.length).toBeGreaterThan(5)
    }
    const crash = plan.options.find(o => o.id === `crash-${code(p.activities, 'A1050').id}`)!
    expect(crash.changes).toEqual([{ kind: 'duration', activityId: code(p.activities, 'A1050').id, remaining: 12 }])
    expect(crash.daysSaved).toBeGreaterThan(0)
  })

  it('offers an overlap (FS → SS with lag) between driving field activities', () => {
    const overlap = plan.options.find(o => o.id.startsWith('overlap-'))
    expect(overlap).toBeDefined()
    expect(overlap!.changes[0]).toMatchObject({ kind: 'link_set', type: 'SS' })
    expect((overlap!.changes[0] as { lag: number }).lag).toBeGreaterThan(0)
  })

  it('applying an option as edits gives the finish the option promised', () => {
    const o = plan.options[0]
    const r = recalc(net, o.changes.map(c => edit(c, o.reason)))
    expect(r.done.cpm!.logicFinish).toBe(o.newFinish)
  })

  it('a finish pinned by a date constraint still shows the logic chain that drives it', () => {
    const pinned = uploadedRecoveryOptions(load().net)!
    expect(pinned.drivers.map(d => d.code)).toEqual(expect.arrayContaining(['A1050', 'A1040']))
    // Nothing upstream can move a Finish On date, so no option claims days saved.
    expect(pinned.options.every(o => o.daysSaved <= 0 || o.newFinish < pinned.finish)).toBe(true)
  })

  it('a required finish turns the options into recovery: gap and whether each meets it', () => {
    const late = uploadedRecoveryOptions({ ...net, mustFinishBy: '2026-04-20' })!
    expect(late.gapDays).toBeGreaterThan(0)
    expect(late.minFloat!).toBeLessThan(0)
    expect(late.options.every(o => typeof o.meetsDate === 'boolean')).toBe(true)
    expect(late.explanation[0]).toMatch(/after the required 04\/20\/2026/)
  })
})

describe('Monte Carlo on uploads: the scheduler’s ranges, risk events, name rules', () => {
  const text = logicDriven.replace('Erect Structural Steel', 'Fabricate and Deliver Structural Steel')
  const { p } = load(text)
  const done = completeSchedule({ activities: p.activities, relationships: p.relationships, calendars: p.calendars, defaultCalendarId: p.defaultCalendarId, projectStart: p.projectStart, projectFinish: p.projectFinish, dataDate: p.dataDate, mustFinishBy: p.mustFinishBy })
  const analysis = analyzeSchedule({ activities: done.activities, links: p.relationships.map(r => ({ from: r.predecessorId, to: r.successorId })), cpm: done.cpm, reportedFinish: p.projectFinish, mustFinishBy: p.mustFinishBy ?? null })
  const s = { id: 's1', name: p.projectName, fileName: 'sample.xer', uploadedAt: '2026-10-01', projectStart: done.projectStart, dataDate: p.dataDate, calendars: p.calendars, defaultCalendarId: p.defaultCalendarId } as unknown as Schedule
  const g = uploadedToGenerated(s, done.activities, p.relationships, done.cpm, analysis)
  const steel = g.activities.find(a => a.code === 'A1050')!
  const cure = g.activities.find(a => a.code === 'A1060')!

  it('classifies fabrication / delivery / procurement and cure by name', () => {
    expect(workKind('Fabricate and Deliver Structural Steel')).toBe('procurement')
    expect(workKind('Submittal review - curtain wall')).toBe('procurement')
    expect(workKind('Switchgear lead time')).toBe('procurement')
    expect(workKind('Cure Footings')).toBe('cure')
    expect(workKind('Secure site fencing')).toBe('field')
    const ctx = { history: null, catalog: new Map(), nameRules: true }
    expect(distributionFor(steel, ctx)!.basis).toMatch(/procurement/i)
    expect(distributionFor(cure, ctx)).toBeNull()
    // Without name rules (plans built in Planora) the old behavior stays.
    expect(distributionFor(cure, { history: null, catalog: new Map() })).not.toBeNull()
  })

  it('the scheduler’s three-point range wins over every rule and moves the percentiles', () => {
    const plain = runSra(g, {}, null, { iterations: 300, seed: 7, inputs: { nameRules: true } })
    const wide = runSra(g, {}, null, { iterations: 300, seed: 7, inputs: { nameRules: true, ranges: [{ activityId: steel.id, optimistic: 20, mostLikely: 25, pessimistic: 40 }] } })
    expect(wide.percentiles.p50 > plain.percentiles.p50).toBe(true)
    expect(wide.sensitivity.find(x => x.code === 'A1050')?.basis).toMatch(/Scheduler's range: 20–25–40/)
    expect(wide.inputsUsed).toMatchObject({ ranges: 1, fixed: 1, procurementByName: 0 })
    expect(plain.inputsUsed).toMatchObject({ ranges: 0, fixed: 1, procurementByName: 1 })
    expect(wide.assumptions.some(a => /scheduler's own optimistic/.test(a))).toBe(true)
  })

  it('a certain risk event on a driving activity adds its impact to every iteration', () => {
    const fixed = { ranges: g.activities.filter(a => a.type === 'task' && !a.actualFinish).map(a => { const b = a.remaining ?? a.duration; return { activityId: a.id, optimistic: b, mostLikely: b, pessimistic: b } }).filter(r => r.pessimistic > 0) }
    const none = runSra(g, {}, null, { iterations: 50, seed: 1, inputs: fixed })
    const sure = runSra(g, {}, null, { iterations: 50, seed: 1, inputs: { ...fixed, events: [{ id: 'ev1', name: 'Steel inspection fails', probability: 1, impactDays: 10, activityId: steel.id }] } })
    expect(none.percentiles.p10).toBe(none.percentiles.p90) // all ranges fixed: deterministic
    expect(sure.percentiles.p50 > none.percentiles.p50).toBe(true)
    expect(sure.events).toEqual([expect.objectContaining({ id: 'ev1', code: 'A1050', occurred: 1 })])
    const half = runSra(g, {}, null, { iterations: 400, seed: 3, inputs: { ...fixed, events: [{ id: 'ev2', name: 'Late steel', probability: 0.5, impactDays: 10, activityId: steel.id }] } })
    expect(half.events![0].occurred).toBeGreaterThan(0.35)
    expect(half.events![0].occurred).toBeLessThan(0.65)
    expect(half.events![0].finishDeltaDays).toBeGreaterThan(7)
  })

  it('validates risk inputs (ordered ranges, probability 0–1, open tasks only)', () => {
    expect(parseRiskInputs({ ranges: [{ activityId: 'A1050', optimistic: 10, mostLikely: 15, pessimistic: 25 }], events: [{ name: 'Crane down', probability: 0.2, impactDays: 5, activityId: 'A1050' }] }, p.activities))
      .toMatchObject({ ranges: [{ activityId: code(p.activities, 'A1050').id }], events: [{ name: 'Crane down', probability: 0.2 }] })
    expect(parseRiskInputs({ ranges: [{ activityId: 'A1050', optimistic: 20, mostLikely: 15, pessimistic: 25 }] }, p.activities)).toHaveProperty('error')
    expect(parseRiskInputs({ events: [{ name: 'x', probability: 30, impactDays: 5, activityId: 'A1050' }] }, p.activities)).toHaveProperty('error')
    expect(parseRiskInputs({ events: [{ name: 'x', probability: 0.3, impactDays: 5, activityId: 'A1010' }] }, p.activities)).toMatchObject({ error: expect.stringMatching(/complete/) })
    // A risk event may attach to a milestone (it delays the milestone); ranges may not.
    expect(parseRiskInputs({ events: [{ name: 'x', probability: 0.3, impactDays: 5, activityId: 'A1070' }] }, p.activities)).toMatchObject({ events: [{ activityId: code(p.activities, 'A1070').id }] })
    expect(parseRiskInputs({ ranges: [{ activityId: 'A1070', optimistic: 1, mostLikely: 2, pessimistic: 3 }] }, p.activities)).toMatchObject({ error: expect.stringMatching(/not a task/) })
  })
})

describe('reports and quality guidance for uploads', () => {
  it('lists the edits made in Planora with before/after and reasons', () => {
    const md = editsSection([{ label: 'A1050 Erect Structural Steel: remaining duration', before: '15d', after: '12d', reason: 'Second crew', by: 'u1', byName: 'Ana', at: '2026-10-05T10:00:00.000Z', status: 'applied', source: 'recovery' }])
    expect(md).toMatch(/^## Edits made in Planora/)
    expect(md).toContain('| 10/05/2026 | Ana | A1050 Erect Structural Steel: remaining duration | 15d | 12d | Second crew | Recovery option |')
    expect(editsSection([])).toBe('')
  })

  it('negative float / CPLI guidance on an upload links to its own what-if options, not plan recovery', () => {
    const c = (id: number) => guidanceFor({ id, name: '', metric: '', threshold: '', result: 'fail', offenders: ['A1'], explanation: '' }, { generated: false, uploadedRecoveryHref: '/dashboard?schedule=s1#recovery' })
    for (const id of [7, 13]) {
      const g = c(id)
      expect(g.actions[0]).toEqual({ kind: 'link', label: 'Open what-if and recovery options', href: '/dashboard?schedule=s1#recovery' })
      expect(g.steps.join(' ')).not.toMatch(/Use the recovery options/)
      expect(g.steps.join(' ')).toMatch(/What-if and recovery on the schedule dashboard/)
    }
    // Without logic (no options), the guidance says to fix the source file.
    const plain = guidanceFor({ id: 7, name: '', metric: '', threshold: '', result: 'fail', offenders: [], explanation: '' }, { generated: false })
    expect(plain.steps.join(' ')).toMatch(/P6 \/ MS Project/)
    expect(plain.actions.some(a => a.kind === 'recovery')).toBe(false)
  })
})
