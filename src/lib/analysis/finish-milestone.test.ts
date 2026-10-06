import { describe, it, expect } from 'vitest'
import { pickFinishCandidate, type FinishCandidate } from '@/lib/analysis/finish-milestone'

const c = (code: string, name: string, extra: Partial<FinishCandidate> = {}): FinishCandidate =>
  ({ id: code, code, name, isMilestone: true, hasSuccessor: false, finish: '2026-06-30', ...extra })

describe('pickFinishCandidate', () => {
  it('prefers Substantial Completion with a finish constraint over Final Completion and over an MFO interim milestone', () => {
    const pick = pickFinishCandidate([
      c('M2000', 'Dry-In', { constraintType: 'MFO', finish: '2027-01-01' }),
      c('M9000', 'Substantial Completion', { constraintType: 'CS_MEOB', hasSuccessor: true }),
      c('M9100', 'Final Completion', { finish: '2026-08-01' }),
    ])
    expect(pick?.pick.code).toBe('M9000')
  })
  it('never lets interim milestones (topping out, enclosure, mobilization, NTP) win over a completion milestone', () => {
    const interim = ['Topping Out', 'Building Enclosed', 'Mobilization', 'NTP', 'Notice to Proceed'].map((n, i) => c(`I${i}`, n, { constraintType: 'MFO', finish: '2028-01-01' }))
    expect(pickFinishCandidate([...interim, c('F', 'Project Completion', { hasSuccessor: true })])?.pick.code).toBe('F')
  })
  it('uses the P6 milestone type: a finish milestone beats a start milestone at the end of the network', () => {
    expect(pickFinishCandidate([c('S1', 'Milestone 1', { milestoneKind: 'start', finish: '2026-07-01' }), c('F1', 'Milestone 2', { milestoneKind: 'finish' })])?.pick.code).toBe('F1')
  })
  it('honours a designated milestone by id or code', () => {
    const list = [c('M9000', 'Substantial Completion'), c('M5000', 'Owner move-in', { hasSuccessor: true })]
    expect(pickFinishCandidate(list, 'M5000')).toMatchObject({ pick: { code: 'M5000' }, designated: true })
    expect(pickFinishCandidate(list, 'nope')).toMatchObject({ pick: { code: 'M9000' }, designated: false })
  })
})
