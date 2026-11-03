import { describe, expect, it } from 'vitest'
import type { Activity, Relationship } from '@/lib/db'
import { defaultCalendar } from '@/lib/planning/calendar'
import { CONCURRENCY_LABEL, parseFragnet, runTia, TIA_DISCLAIMER, tiaInputsHash, validateFragnet, type Fragnet, type TiaEventInput, type TiaNetwork, type TiaPrevious } from './tia'

// Fixture on a Mon–Fri calendar, data date Monday 01/05/2026:
//   A (10d) → B (10d) → SC (finish milestone "Substantial Completion")      driving: A, B, SC 01/30/2026
//   A → C (5d) → DI (milestone "Dry-in") → SC                               C / DI carry 5 wd float
const DD = '2026-01-05'
function act(id: string, name: string, duration: number, extra: Partial<Activity> = {}): Activity {
  return {
    id, scheduleId: 's1', activityId: id, name, wbs: '', duration, remainingDuration: duration, percentComplete: 0,
    earlyStart: null, earlyFinish: null, lateStart: null, lateFinish: null, actualStart: null, actualFinish: null, baselineStart: null, baselineFinish: null,
    totalFloat: 0, freeFloat: 0, isCritical: false, status: 'not_started', activityType: duration === 0 ? 'milestone' : 'task',
    milestoneKind: duration === 0 ? 'finish' : null, calendarId: 'default-5d', constraintType: null, constraintDate: null, category: null, sourceId: null, ...extra,
  }
}
const rel = (p: string, s: string, type: Relationship['type'] = 'FS', lag = 0): Relationship => ({ id: `${p}-${s}`, scheduleId: 's1', predecessorId: p, successorId: s, type, lag })

function network(over: { activities?: Activity[]; extra?: Partial<TiaNetwork> } = {}): TiaNetwork {
  const activities = over.activities ?? [
    act('NTP', 'Notice to Proceed', 0, { milestoneKind: 'start', status: 'complete', actualStart: '2025-12-15', actualFinish: '2025-12-15' }),
    act('A', 'Excavation', 10), act('B', 'Structure', 10), act('C', 'Roofing', 5),
    act('DI', 'Dry-in', 0), act('SC', 'Substantial Completion', 0),
  ]
  return {
    scheduleId: 's1', scheduleName: 'Test project', version: 'Update 3', activities,
    relationships: [rel('NTP', 'A'), rel('A', 'B'), rel('B', 'SC'), rel('A', 'C'), rel('C', 'DI'), rel('DI', 'SC')],
    calendars: [defaultCalendar()], defaultCalendarId: 'default-5d', projectStart: '2025-12-15', dataDate: DD, mustFinishBy: null, progressMode: 'retained',
    ...over.extra,
  }
}
const event = (fragnet: Fragnet, extra: Partial<TiaEventInput> = {}): TiaEventInput => ({ title: 'Differing site condition', responsibility: 'owner', eventStart: '2026-01-12', eventEnd: null, fragnet, ...extra })
const one = (code: string, duration: number, from: string, to: string, extra: Partial<Fragnet['activities'][number]> = {}): Fragnet => ({
  activities: [{ code, name: 'Delay work', duration, ...extra }],
  relationships: [{ from, to: code, type: 'FS', lag: 0 }, { from: code, to, type: 'FS', lag: 0 }],
})

describe('time impact analysis engine', () => {
  it('a fragnet on the driving path moves the contract milestone by its duration', () => {
    const { result } = runTia(network(), event(one('F1', 5, 'A', 'B')))
    expect(result.ok).toBe(true)
    expect(result.contractMilestone?.code).toBe('SC')
    const sc = result.milestones.find(m => m.code === 'SC')!
    expect(sc.kind).toBe('contract')
    expect(sc.before.logic).toBe('2026-01-30')
    expect(sc.after.logic).toBe('2026-02-06')
    expect(sc.impactWd).toEqual({ scheduled: 5, logic: 5 })
    expect(sc.impactCd).toEqual({ scheduled: 7, logic: 7 })
    expect(result.projectFinish.impactWd.logic).toBe(5)
    expect(result.drivingPath.fragnetOnPath).toEqual(['F1'])
    expect(result.drivingPath.after.map(s => s.code)).toEqual(['A', 'F1', 'B', 'SC'])
    expect(result.drivingPath.before.map(s => s.code)).toEqual(['A', 'B', 'SC'])
    expect(result.fragnet[0]).toMatchObject({ code: 'F1', start: '2026-01-19', finish: '2026-01-23', onDrivingPath: true })
  })

  it('a fragnet off the critical path is absorbed by float: no impact, float reduced', () => {
    const { result } = runTia(network(), event(one('F2', 3, 'A', 'C')))
    const sc = result.milestones.find(m => m.code === 'SC')!
    expect(sc.impactCd.logic).toBe(0)
    expect(sc.impactWd.logic).toBe(0)
    const di = result.milestones.find(m => m.code === 'DI')!
    expect(di.floatChange).toBe(-3)
    expect(di.before.totalFloat).toBe(5)
    expect(di.after.totalFloat).toBe(2)
    expect(result.fragnet[0]).toMatchObject({ totalFloat: 2, onDrivingPath: false })
    expect(result.drivingPath.fragnetOnPath).toEqual([])
    expect(result.findings.join(' ')).toMatch(/No fragnet activity is on the driving path/)
  })

  it('a fragnet longer than the float is partially absorbed', () => {
    const { result } = runTia(network(), event(one('F3', 8, 'A', 'C')))
    const sc = result.milestones.find(m => m.code === 'SC')!
    expect(sc.impactWd.logic).toBe(3) // 8 wd of delay − 5 wd of float
    expect(sc.after.totalFloat).toBe(0)
    expect(result.drivingPath.fragnetOnPath).toEqual(['F3'])
  })

  it('fragnet work cannot start before the data date (earliest start clamped, with a warning)', () => {
    const f: Fragnet = { activities: [{ code: 'F4', name: 'Stop work order', duration: 4, startNoEarlierThan: '2025-12-20' }], relationships: [{ from: 'F4', to: 'B', type: 'FS', lag: 0 }] }
    const v = validateFragnet(f, network())
    expect(v.errors).toEqual([])
    expect(v.warnings.join(' ')).toMatch(/before the data date 01\/05\/2026.*moved to 01\/05\/2026/)
    expect(v.activities[0].constraintDate).toBe(DD)
    const { result } = runTia(network(), event(f))
    expect(result.ok).toBe(true)
    expect(result.fragnet[0].start).toBe(DD)
    // A (10 wd from the data date) still drives B; the 4-day fragnet finishing 01/08 is absorbed.
    expect(result.milestones.find(m => m.code === 'SC')!.impactCd.logic).toBe(0)
  })

  it('completed activities are not moved: a tie into one is dropped with a warning', () => {
    const f: Fragnet = { activities: [{ code: 'F5', name: 'Late permit', duration: 3 }], relationships: [{ from: 'A', to: 'F5', type: 'FS', lag: 0 }, { from: 'F5', to: 'NTP', type: 'FS', lag: 0 }, { from: 'F5', to: 'SC', type: 'FS', lag: 0 }] }
    const v = validateFragnet(f, network())
    expect(v.errors).toEqual([])
    expect(v.warnings.join(' ')).toMatch(/NTP is complete/)
    expect(v.relationships.some(r => r.successorId === 'NTP')).toBe(false)
  })

  it('rejects an invalid fragnet: logic loop, missing reference, duplicate or existing code, negative duration', () => {
    const loop = runTia(network(), event({ activities: [{ code: 'F6', name: 'Loop', duration: 2 }], relationships: [{ from: 'B', to: 'F6', type: 'FS', lag: 0 }, { from: 'F6', to: 'A', type: 'FS', lag: 0 }] }))
    expect(loop.result.ok).toBe(false)
    expect(loop.result.validation.errors.join(' ')).toMatch(/logic loop: .*F6.*A.*B|logic loop/)
    expect(loop.result.milestones).toEqual([])
    const missing = validateFragnet({ activities: [{ code: 'F7', name: 'X', duration: 2 }], relationships: [{ from: 'ZZZ', to: 'F7', type: 'FS', lag: 0 }, { from: 'F7', to: 'B', type: 'FS', lag: 0 }] }, network())
    expect(missing.errors.join(' ')).toMatch(/no activity "ZZZ"/)
    const dup = validateFragnet({ activities: [{ code: 'F8', name: 'X', duration: 1 }, { code: 'f8', name: 'Y', duration: 1 }, { code: 'B', name: 'Z', duration: 1 }, { code: 'F9', name: 'N', duration: -2 }], relationships: [] }, network())
    expect(dup.errors.join(' ')).toMatch(/F8 is used twice/i)
    expect(dup.errors.join(' ')).toMatch(/B already exists/)
    expect(dup.errors.join(' ')).toMatch(/F9: duration must be 0 or more/)
    expect(parseFragnet({ activities: [{ code: 'X', name: 'Y', duration: 'abc' }] })).toHaveProperty('error')
  })

  it('requires ties in and out unless the open ends are intentional (then warnings)', () => {
    const f: Fragnet = { activities: [{ code: 'F10', name: 'Dangling', duration: 2 }], relationships: [{ from: 'A', to: 'F10', type: 'FS', lag: 0 }] }
    const strict = validateFragnet(f, network())
    expect(strict.errors.join(' ')).toMatch(/no successor/)
    const lenient = validateFragnet({ ...f, allowOpenEnds: true }, network())
    expect(lenient.errors).toEqual([])
    expect(lenient.warnings.join(' ')).toMatch(/intentional open end/)
  })

  it('a contract milestone held by a mandatory constraint: the logic-driven impact is reported', () => {
    const base = network()
    const acts = base.activities.map(a => (a.activityId === 'SC' ? { ...a, constraintType: 'MFO', constraintDate: '2026-01-30' } : a))
    const { result } = runTia(network({ activities: acts }), event(one('F1', 5, 'A', 'B')))
    const sc = result.milestones.find(m => m.code === 'SC')!
    expect(sc.contractDate).toBe('2026-01-30')
    expect(sc.impactCd.scheduled).toBe(0) // pinned by the MFO
    expect(sc.impactWd.logic).toBe(5)
    expect(sc.after.logic).toBe('2026-02-06')
    expect(sc.lateVsContract).toEqual({ before: 0, after: 7 })
    expect(result.findings.join(' ')).toMatch(/mandatory constraint holds it; the logic-driven date moves 7 cd/)
    expect(result.drivingPath.fragnetOnPath).toContain('F1')
  })

  it('is deterministic and reproducible: same inputs give the same hash and results', () => {
    const r1 = runTia(network(), event(one('F1', 5, 'A', 'B')))
    const r2 = runTia(network(), event(one('F1', 5, 'A', 'B')))
    expect(r1.result.inputsHash).toMatch(/^[0-9a-f]{64}$/)
    expect(r2.result.inputsHash).toBe(r1.result.inputsHash)
    expect(r2.result.resultHash).toBe(r1.result.resultHash)
    expect(JSON.stringify(r2.result)).toBe(JSON.stringify(r1.result))
    // Activity order in the network does not change the inputs.
    const shuffled = network()
    shuffled.activities = [...shuffled.activities].reverse()
    expect(tiaInputsHash(shuffled, event(one('F1', 5, 'A', 'B')))).toBe(r1.result.inputsHash)
    // A different lag, or a different network, is a different calculation.
    const lag = one('F1', 5, 'A', 'B'); lag.relationships[1].lag = 1
    expect(runTia(network(), event(lag)).result.inputsHash).not.toBe(r1.result.inputsHash)
    // Relabelling responsibility does not change the calculation inputs.
    expect(runTia(network(), event(one('F1', 5, 'A', 'B'), { responsibility: 'contractor' })).result.inputsHash).toBe(r1.result.inputsHash)
  })

  it('separates calculation from conclusion: the disclaimer and assumptions are on every result', () => {
    const { result } = runTia(network(), event(one('F1', 5, 'A', 'B')))
    expect(result.disclaimer).toBe(TIA_DISCLAIMER)
    expect(result.disclaimer).toMatch(/does not determine whether a delay is excusable, compensable/)
    expect(result.assumptions.join(' ')).toMatch(/data date 01\/05\/2026/)
    expect(result.assumptions.join(' ')).toMatch(/Standard 5-Day/)
    expect(result.event.responsibilityLabel).toBe('Owner')
    const bad = runTia(network(), event({ activities: [], relationships: [] }))
    expect(bad.result.disclaimer).toBe(TIA_DISCLAIMER)
  })

  it('flags activities on the pre-existing driving path that slipped since the previous update as potential concurrency', () => {
    const base = network()
    // B in progress, now finishing later than the previous update said.
    const acts = base.activities.map(a => (a.activityId === 'A' ? { ...a, status: 'in_progress' as const, actualStart: '2025-12-29', remainingDuration: 10 } : a))
    const previous: TiaPrevious = {
      scheduleId: 's0', label: 'Update 2', dataDate: '2025-12-29',
      activities: [
        { activityId: 'A', name: 'Excavation', earlyStart: '2025-12-29', earlyFinish: '2026-01-09', actualStart: null, actualFinish: null, status: 'not_started', remainingDuration: 10 },
        { activityId: 'B', name: 'Structure', earlyStart: '2026-01-12', earlyFinish: '2026-01-23', actualStart: null, actualFinish: null, status: 'not_started', remainingDuration: 10 },
      ],
    }
    const { result } = runTia(network({ activities: acts }), event(one('F1', 5, 'A', 'B')), previous)
    expect(result.concurrency.basis).toBe('previous_update')
    const a = result.concurrency.flags.find(f => f.code === 'A')!
    expect(a.indicator).toBe('slipped_since_previous')
    expect(a.slipCd).toBe(7)
    expect(a.label).toBe(CONCURRENCY_LABEL)
    expect(a.overlapsEvent).toBe(true)
    // Without a previous update, no comparison is claimed.
    expect(runTia(network({ activities: acts }), event(one('F1', 5, 'A', 'B'))).result.concurrency.flags).toEqual([])
  })
})
