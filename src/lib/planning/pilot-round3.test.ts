// Round-3 pilot findings: Planora edits are a named scenario (as submitted by default), recovery and
// Monte Carlo target the contract milestone, recovery domain rules, classified data refused on the
// commercial cloud.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { Activity, Relationship, Schedule } from '@/lib/db'
import { parseXER } from '@/lib/parsers/xer-parser'
import { completeSchedule } from './complete-schedule'
import { analyzeSchedule } from '@/lib/analysis/schedule-analysis'
import { evaluateNetwork, overlapSplit, uploadedRecoveryOptions, type NetworkInput } from './uploaded-recovery'
import { uploadedToGenerated } from './uploaded'
import { runSra } from './sra'
import { workKind } from './work-kind'
import { parseRiskInputs } from './risk-inputs'
import { contractTarget, trackedMilestones } from './contract-target'
import { provenanceRows, type Provenance } from '@/lib/export/provenance'
import { editsSection } from '@/lib/export/reports'
import { classifiedCloudRefusal, CLASSIFIED_CLOUD_REFUSAL, planMarkedClassified } from '@/lib/server/classification'

const xer = fs.readFileSync(path.join(__dirname, '../parsers/__fixtures__/sample.xer'), 'latin1')
// Logic drives the finish milestone A1070 (its Finish On constraint removed): A1040 -> A1050 -> A1070.
const logicDriven = xer.replace('\tCS_MEO\t', '\t\t')

function load(text = logicDriven, id = 's1') {
  const p = parseXER(text, id)
  const net: NetworkInput = {
    activities: p.activities, relationships: p.relationships, calendars: p.calendars, defaultCalendarId: p.defaultCalendarId,
    projectStart: p.projectStart, dataDate: p.dataDate, mustFinishBy: p.mustFinishBy ?? null, progressMode: 'retained',
  }
  return { p, net }
}
const code = (acts: Activity[], c: string) => acts.find(a => a.activityId === c)!

/** Adds a 30-day "Punch list and closeout" after A1070, so work continues past the contract milestone. */
function withCloseout(net: NetworkInput): NetworkInput {
  const ms = code(net.activities, 'A1070')
  const punch: Activity = { ...code(net.activities, 'A1050'), id: 'punch', activityId: 'A1080', name: 'Punch List and Closeout', duration: 30, remainingDuration: 30, constraintType: null, constraintDate: null, sourceId: null }
  const rel: Relationship = { id: 'r-punch', scheduleId: ms.scheduleId, predecessorId: ms.id, successorId: 'punch', type: 'FS', lag: 0 }
  return { ...net, activities: [...net.activities, punch], relationships: [...net.relationships, rel] }
}

describe('A. edits are a named scenario; outputs say which basis they use', () => {
  it('provenance of a scenario says "with N Planora edits" and derives from the SHA-256 instead of claiming it', () => {
    const sha = 'a'.repeat(64)
    const p = (editsApplied?: number): Provenance => ({ sources: [{ scheduleName: 'P', version: 'U1', fileName: 'f.xer', sha256: sha, dataDate: '2026-04-01', progressMode: 'retained', editsApplied }], release: 'abc', settings: [], generatedAt: '2026-10-07T00:00:00.000Z' })
    const asSubmitted = Object.fromEntries(provenanceRows(p()))
    expect(asSubmitted['Basis']).toBe('as submitted')
    expect(asSubmitted['SHA-256']).toBe(sha)
    const scenario = Object.fromEntries(provenanceRows(p(3)))
    expect(scenario['Basis']).toBe('with 3 Planora edits')
    expect(scenario['SHA-256']).toMatch(new RegExp(`^derived from ${sha} with 3 edits`))
  })

  it('a report on the schedule as submitted lists the edits but says they are not in its figures', () => {
    const e = [{ label: 'A1050 Steel: remaining duration', before: '15d', after: '10d', reason: 'Crane added', by: 'u1', at: '2026-10-01T00:00:00.000Z', status: 'applied' as const }]
    expect(editsSection(e, [], false)).toMatch(/as submitted: its forecast, float and driving path do NOT include the 1 edit/)
    expect(editsSection(e, [], true)).toMatch(/include 1 edit made in Planora/)
  })
})

// loadScheduleData with a mocked database: the default is the schedule as submitted.
const db = vi.hoisted(() => ({ schedule: null as unknown as Schedule, acts: [] as Activity[], rels: [] as Relationship[], edits: [] as unknown[], updates: [] as unknown[] }))
vi.mock('@/lib/db', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/db')>()),
  getScheduleById: async () => db.schedule,
  getActivities: async () => db.acts,
  getRelationships: async () => db.rels,
  getScheduleEdits: async () => db.edits,
  getScheduleSeries: async () => [],
  updateScheduleAnalysis: async (...args: unknown[]) => { db.updates.push(args) },
}))

describe('A. loadScheduleData: as submitted by default, the scenario on request', () => {
  beforeEach(() => {
    const { p } = load()
    db.acts = p.activities; db.rels = p.relationships; db.updates = []
    db.schedule = { id: 's1', userId: 'u', orgId: 'o', name: 'P', version: 'U1', sourceType: 'p6_xer', fileName: 'sample.xer', uploadedAt: '2026-10-01', activityCount: p.activities.length, relationshipCount: p.relationships.length, projectStart: p.projectStart, projectFinish: p.projectFinish, dataDate: p.dataDate, varianceDays: null, criticalCount: 0, percentComplete: 0, calendars: p.calendars, defaultCalendarId: p.defaultCalendarId, warnings: [], planId: null, projectType: null, region: null, grossSqft: null, analysis: null, classification: null }
    db.edits = [{ id: 'e1', change: { kind: 'duration', activityId: code(p.activities, 'A1050').id, remaining: 5 }, reason: 'What-if crane', by: 'u1', at: '2026-10-01T00:00:00.000Z', revertedAt: null }]
  })

  it('applies no edits by default, still lists them, and stores the as-submitted headline only', async () => {
    const { loadScheduleData } = await import('./service')
    const sub = (await loadScheduleData('s1', 'o'))!
    expect(sub.basis).toBe('submitted')
    expect(sub.editsApplied).toBe(1)
    expect(code(sub.activities, 'A1050').duration).toBe(15)
    expect(sub.editedActivityIds).toEqual([])
    expect(sub.schedule.warnings[0]).toMatch(/as submitted\. 1 Planora edit is not applied/)
    expect(db.updates.length).toBe(1)
    const sc = (await loadScheduleData('s1', 'o', { basis: 'scenario' }))!
    expect(sc.basis).toBe('scenario')
    expect(code(sc.activities, 'A1050').duration).toBe(5)
    expect(sc.analysis.forecastFinish! < sub.analysis.forecastFinish!).toBe(true)
    expect(sc.schedule.warnings[0]).toMatch(/with 1 Planora edit applied/)
    // The scenario never overwrites the stored (portfolio / dashboard) analysis.
    expect(db.updates.length).toBe(1)
  })

  it('basisFrom reads ?basis=scenario or scenario=1; anything else is as submitted', async () => {
    const { basisFrom } = await import('./service')
    expect(basisFrom(new URLSearchParams('format=xer'))).toBe('submitted')
    expect(basisFrom(new URLSearchParams('format=xer&scenario=1'))).toBe('scenario')
    expect(basisFrom(new URLSearchParams('basis=scenario'))).toBe('scenario')
    expect(basisFrom({ basis: 'edits-please' })).toBe('submitted')
  })

  it('D. a schedule marked classified is refused (409) on the commercial cloud', async () => {
    const { loadScheduleData } = await import('./service')
    db.schedule = { ...db.schedule, classification: 'classified' }
    const prev = process.env.PLANORA_DEPLOYMENT
    delete process.env.PLANORA_DEPLOYMENT
    await expect(loadScheduleData('s1', 'o')).rejects.toMatchObject({ status: 409, code: 'classified_on_commercial_cloud' })
    process.env.PLANORA_DEPLOYMENT = 'onprem'
    await expect(loadScheduleData('s1', 'o')).resolves.toBeTruthy()
    if (prev === undefined) delete process.env.PLANORA_DEPLOYMENT; else process.env.PLANORA_DEPLOYMENT = prev
  })
})

describe('B. recovery targets the contract milestone and its constraint date', () => {
  const { p, net } = load()
  const ms = code(p.activities, 'A1070')
  const contract = { milestoneId: ms.id, code: 'A1070', name: ms.name, date: '2026-04-20', dateSource: 'A1070 FNLT constraint', designated: true }
  const n2 = withCloseout({ ...net, contract })

  it('measures required, gap and meetsDate at the milestone, not at the project finish after closeout', () => {
    const plan = uploadedRecoveryOptions(n2)!
    const base = evaluateNetwork(n2)
    expect(plan.milestone).toMatchObject({ code: 'A1070', designated: true })
    expect(plan.finish).toBe(base.measured)
    expect(plan.projectFinish > plan.finish).toBe(true)
    expect(plan.required).toBe('2026-04-20')
    expect(plan.gapDays).toBe(Math.round((Date.parse(plan.finish) - Date.parse('2026-04-20')) / 86_400_000))
    expect(plan.explanation[0]).toMatch(/A1070 .*after the required 04\/20\/2026 \(A1070 FNLT constraint\)/)
    expect(plan.explanation.some(x => /Work after A1070 .*close-out/.test(x))).toBe(true)
    for (const o of plan.options) {
      const r = evaluateNetwork(n2, o.changes)
      expect(o.newFinish).toBe(r.measured)
      expect(o.meetsDate).toBe(r.measured! <= '2026-04-20')
      // Never touches the closeout after the milestone.
      expect(o.changes.some(c => 'activityId' in c && c.activityId === 'punch')).toBe(false)
    }
    expect(plan.options.length).toBeGreaterThan(0)
  })

  it('contractTarget: the milestone constraint date wins over Must Finish By', () => {
    const fm = { id: 'm', code: 'M1', name: 'Substantial Completion', baselineFinish: null, forecastFinish: '2026-06-01', constraint: { type: 'FNLT', date: '2026-05-15' }, varianceDays: null, designated: false }
    expect(contractTarget({ finishMilestone: fm, mustFinishBy: '2026-07-01' })).toMatchObject({ milestoneId: 'm', date: '2026-05-15', dateSource: 'M1 FNLT constraint' })
    expect(contractTarget({ finishMilestone: { ...fm, constraint: { type: 'SNET', date: '2026-05-15' } }, mustFinishBy: '2026-07-01' })).toMatchObject({ date: '2026-07-01', dateSource: 'Must Finish By' })
    expect(contractTarget({ finishMilestone: null, mustFinishBy: null })).toBeNull()
  })
})

describe('B. Monte Carlo reports P50 / P80 and probability for the contract milestone and constrained milestones', () => {
  const text = logicDriven
  const { p } = load(text)
  const done = completeSchedule({ activities: p.activities, relationships: p.relationships, calendars: p.calendars, defaultCalendarId: p.defaultCalendarId, projectStart: p.projectStart, projectFinish: p.projectFinish, dataDate: p.dataDate, mustFinishBy: p.mustFinishBy })
  const analysis = analyzeSchedule({ activities: done.activities, links: p.relationships.map(r => ({ from: r.predecessorId, to: r.successorId })), cpm: done.cpm, reportedFinish: p.projectFinish, mustFinishBy: p.mustFinishBy ?? null })
  const s = { id: 's1', name: p.projectName, fileName: 'sample.xer', uploadedAt: '2026-10-01', projectStart: done.projectStart, dataDate: p.dataDate, calendars: p.calendars, defaultCalendarId: p.defaultCalendarId } as unknown as Schedule
  const g = uploadedToGenerated(s, done.activities, p.relationships, done.cpm, analysis)
  const ms = g.activities.find(a => a.code === 'A1070')!
  const steel = g.activities.find(a => a.code === 'A1050')!

  it('tracks the contract milestone with its date', () => {
    const r = runSra(g, {}, null, { iterations: 300, seed: 5, inputs: { nameRules: true, milestones: [{ id: ms.id, required: '2026-05-01', requiredSource: 'A1070 FNLT constraint', contract: true }] } })
    const m = r.milestones![0]
    expect(m).toMatchObject({ code: 'A1070', contract: true, required: '2026-05-01' })
    expect(m.p80 >= m.p50).toBe(true)
    expect(m.probability).toBeGreaterThanOrEqual(0)
    expect(m.probability).toBeLessThanOrEqual(1)
  })

  it('C. a risk event attached to the milestone delays it', () => {
    const fixed = { ranges: g.activities.filter(a => a.type === 'task' && !a.actualFinish).map(a => { const b = a.remaining ?? a.duration; return { activityId: a.id, optimistic: b, mostLikely: b, pessimistic: b } }).filter(r => r.pessimistic > 0) }
    const milestones = [{ id: ms.id, required: '2026-05-01', contract: true }]
    const none = runSra(g, {}, null, { iterations: 50, seed: 1, inputs: { ...fixed, milestones } })
    const sure = runSra(g, {}, null, { iterations: 50, seed: 1, inputs: { ...fixed, milestones, events: [{ id: 'ev', name: 'Owner acceptance late', probability: 1, impactDays: 10, activityId: ms.id }] } })
    expect(sure.milestones![0].p50 > none.milestones![0].p50).toBe(true)
    expect(sure.events![0]).toMatchObject({ code: 'A1070', occurred: 1 })
  })

  it('C. a committed delivery date holds the activity near-deterministic and flags a forecast past it', () => {
    const r = runSra(g, {}, null, { iterations: 100, seed: 2, inputs: { nameRules: true, commitments: [{ activityId: steel.id, date: '2026-04-01' }] } })
    expect(r.assumptions.some(a => /1 activity has a committed delivery date/.test(a))).toBe(true)
    expect(r.inputsUsed!.commitments).toBe(1)
    expect(r.warnings.some(w => /A1050 .*after its committed delivery date 04\/01\/2026/.test(w))).toBe(true)
  })

  it('trackedMilestones: the contract milestone first, then milestones with finish constraints', () => {
    const acts = [
      { id: 'a', activityId: 'M1', activityType: 'milestone' as const, actualFinish: null, status: 'not_started' as const, constraintType: 'FNLT', constraintDate: '2026-05-01' },
      { id: 'b', activityId: 'M2', activityType: 'milestone' as const, actualFinish: null, status: 'not_started' as const, constraintType: 'SNET', constraintDate: '2026-05-01' },
      { id: 'c', activityId: 'SC', activityType: 'milestone' as const, actualFinish: null, status: 'not_started' as const, constraintType: 'MFO', constraintDate: '2026-06-30' },
    ]
    const t = trackedMilestones(acts, { finishMilestone: { id: 'c', code: 'SC', name: 'SC', baselineFinish: null, forecastFinish: null, constraint: { type: 'MFO', date: '2026-06-30' }, varianceDays: null }, mustFinishBy: null })
    expect(t).toEqual([
      { id: 'c', required: '2026-06-30', requiredSource: 'SC MFO constraint', contract: true },
      { id: 'a', required: '2026-05-01', requiredSource: 'M1 FNLT constraint', contract: false },
    ])
  })

  it('C. risk inputs accept committed dates and refuse bad ones', () => {
    expect(parseRiskInputs({ commitments: [{ activityId: 'A1050', date: '2026-04-20', note: 'Supplier letter 09/12' }] }, p.activities)).toMatchObject({ commitments: [{ activityId: code(p.activities, 'A1050').id, date: '2026-04-20' }] })
    expect(parseRiskInputs({ commitments: [{ activityId: 'A1050', date: '04/20/2026' }] }, p.activities)).toHaveProperty('error')
    expect(parseRiskInputs({ commitments: [{ activityId: 'A1070', date: '2026-04-20' }] }, p.activities)).toMatchObject({ error: expect.stringMatching(/not a task/) })
  })
})

describe('C. recovery domain rules', () => {
  it('classifies work by others, fixed-duration processes, regulatory periods and closeout', () => {
    expect(workKind('Relocate Overhead Power - by others')).toBe('by_others')
    expect(workKind('Utility relocation (Dominion)')).toBe('by_others')
    expect(workKind('Install owner-furnished equipment')).toBe('by_others')
    expect(workKind('Biological seeding and acclimation')).toBe('fixed')
    expect(workKind('Lab testing turnaround - compaction')).toBe('fixed')
    expect(workKind('State DEP permit review')).toBe('permit')
    expect(workKind('Final building inspection')).toBe('permit')
    expect(workKind('Punch List')).toBe('closeout')
    expect(workKind('Defects liability period')).toBe('closeout')
    expect(workKind('As-builts and closeout documents')).toBe('closeout')
    expect(workKind('Fabricate and Deliver Structural Steel')).toBe('procurement')
    expect(workKind('Slab on Grade')).toBe('field')
    expect(workKind('Install lab casework')).toBe('field')
  })

  it('never crashes or overlaps work by others or fixed-duration work on the driving path', () => {
    const text = logicDriven.replace('Erect Structural Steel', 'Utility Relocation by Others').replace('Slab on Grade', 'Biological Seeding and Acclimation')
    const { p, net } = load(text)
    const plan = uploadedRecoveryOptions(net)!
    const steel = code(p.activities, 'A1050'), slab = code(p.activities, 'A1040')
    for (const o of plan.options) {
      for (const c of o.changes) {
        const ids = 'activityId' in c ? [c.activityId] : [c.predecessorId, c.successorId]
        expect(ids).not.toContain(steel.id)
        expect(ids).not.toContain(slab.id)
      }
    }
    expect(plan.excluded.map(x => x.code)).toEqual(expect.arrayContaining(['A1050', 'A1040']))
    expect(plan.explanation.some(x => /Never crashed or overlapped: .*A1050 .*work by others/.test(x))).toBe(true)
  })

  it('overlap wording follows the project type', () => {
    expect(overlapSplit('commercial_office').by).toBe('by area or floor')
    expect(overlapSplit('highway_bridge').by).toMatch(/segment/)
    expect(overlapSplit('water_wastewater').by).toMatch(/process train/)
    const { net } = load()
    const civil = uploadedRecoveryOptions({ ...net, projectType: 'highway_bridge' })!
    const ov = civil.options.find(o => o.id.startsWith('overlap-'))!
    expect(ov.description).not.toMatch(/floor/)
    expect(ov.description).toMatch(/segment/)
  })
})

describe('D. classified data on the commercial cloud', () => {
  it('refuses classified only on the commercial cloud, pointing to the on-prem package', () => {
    expect(classifiedCloudRefusal('classified', 'commercial_cloud')).toBe(CLASSIFIED_CLOUD_REFUSAL)
    expect(CLASSIFIED_CLOUD_REFUSAL).toMatch(/on-premises \/ air-gapped Planora package/)
    expect(CLASSIFIED_CLOUD_REFUSAL).toMatch(/ON-PREM-INSTALL\.md/)
    expect(classifiedCloudRefusal('classified', 'on_prem')).toBeNull()
    expect(classifiedCloudRefusal('classified', 'airgapped')).toBeNull()
    expect(classifiedCloudRefusal('cui', 'commercial_cloud')).toBeNull()
    expect(classifiedCloudRefusal(null, 'commercial_cloud')).toBeNull()
  })
  it('a plan is marked classified by an explicit answer (withheld is not a marking)', () => {
    expect(planMarkedClassified({ 'security.classification': { status: 'known', value: 'classified' } })).toBe(true)
    expect(planMarkedClassified({ 'security.classification': { status: 'withheld' } })).toBe(false)
    expect(planMarkedClassified({ 'security.classification': { status: 'known', value: 'cui' } })).toBe(false)
    expect(planMarkedClassified({})).toBe(false)
  })
})
