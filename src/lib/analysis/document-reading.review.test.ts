import { describe, it, expect } from 'vitest'
import { projectWatch } from './project-watch'
import { extractSignals } from './correspondence'

// False alarms and missed delays found by a line-by-line review, each reproduced before the fix.
const acts = [
  { id: 'a1', code: 'S2010', name: 'Level 2 slab formwork', started: true, done: false },
  { id: 'a2', code: 'E4020', name: 'Set Medium-Voltage Switchgear', started: true, done: false },
]
const doc = (docType: string, text: string) => ({ documentId: docType, title: `The ${docType}`, docType, citation: '§1', text })
const ctx = { daysBehind: 38, delaysReported: [], openChangeItems: 0, staleDays: 12, projectType: 'data_center' }
const sigActs = [{ id: 'a2', code: 'E4020', name: 'Set Medium-Voltage Switchgear', open: true }]
const mail = (text: string) => ({ documentId: 'd1', title: 'Email', docType: 'email', citation: '§1', text })

describe('field reports', () => {
  it('"75% complete" is progress, not a finished activity', () => {
    const w = projectWatch([doc('daily_report', 'Level 2 slab formwork is 75% complete as of today.')], acts, ctx)
    expect(w.field.some(f => f.reported === 'finished')).toBe(false)
  })
  it('"100% complete" and "completed" still read as finished', () => {
    expect(projectWatch([doc('daily_report', 'Level 2 slab formwork is 100% complete and signed off.')], acts, ctx).field[0]).toMatchObject({ reported: 'finished' })
    expect(projectWatch([doc('daily_report', 'Level 2 slab formwork completed this afternoon.')], acts, ctx).field[0]).toMatchObject({ reported: 'finished' })
  })
})

describe('contract watch', () => {
  it('a ceiling on damages is not the daily amount', () => {
    const w = projectWatch([doc('contract', 'The Contractor shall pay the Owner two thousand dollars ($2,000) for each calendar day of delay as liquidated damages, not to exceed $500,000.')], acts, ctx)
    const ld = w.contract.find(c => c.kind === 'damages')!
    expect(ld.perDay).toBe(2000)
    expect(ld.exposure).toBe(76000)
  })
  it('a cap with no daily amount in the sentence gives no daily amount', () => {
    const w = projectWatch([doc('contract', 'Liquidated damages under this Article shall not exceed, and are capped at $500,000 in the aggregate.')], acts, ctx)
    expect(w.contract.find(c => c.kind === 'damages')!.perDay).toBeNull()
  })
  it('a look-ahead at the weekly meeting does not make schedule updates weekly', () => {
    const w = projectWatch([doc('contract', 'The Contractor shall present a three-week look-ahead schedule at each weekly progress meeting. The Contractor shall submit an updated schedule monthly with each payment application.')], acts, ctx)
    const u = w.contract.find(c => c.kind === 'update')!
    expect(u.days).toBe(31)
    expect(u.active).toBe(false)
  })
})

describe('correspondence', () => {
  it('a delay is kept when the sentence denies being on schedule', () => {
    const s = extractSignals([mail('The medium-voltage switchgear is delayed 3 weeks and will not finish on schedule.')], sigActs)
    expect(s[0]).toMatchObject({ kind: 'delay', days: 15 })
  })
  it('"on schedule" and "no delays" still mean no delay', () => {
    expect(extractSignals([mail('Switchgear delivery remains on schedule despite the earlier delay concerns raised.')], sigActs).filter(x => x.kind === 'delay')).toEqual([])
    expect(extractSignals([mail('No delays were reported on the medium-voltage switchgear this week.')], sigActs).filter(x => x.kind === 'delay')).toEqual([])
  })
  it('a lead time is not a slip; "by N weeks" is', () => {
    const a = extractSignals([mail('Switchgear lead time has increased to 30 weeks per the vendor.')], sigActs)
    expect(a[0]?.days ?? null).toBeNull()
    const b = extractSignals([mail('Switchgear lead time has increased by 4 weeks per the vendor.')], sigActs)
    expect(b[0]).toMatchObject({ kind: 'delay', days: 20 })
  })
})
