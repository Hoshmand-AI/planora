import { describe, it, expect } from 'vitest'
import { selectHistorySchedules, historyInclusionWarning, isAsBuilt, type HistoryCandidate } from './history-selection'
import { decideHistory, inheritSeriesProfile, seriesDataDateWarning } from './upload-rules'

const c = (id: string, f: Partial<HistoryCandidate> = {}): HistoryCandidate => ({
  id, name: id, version: 'Baseline', projectKey: null, dataDate: '2025-06-30', uploadedAt: '2026-01-01T00:00:00Z',
  inHistory: true, historyOverride: false, planoraExport: false, uploadOrigin: null, workCount: 20, openCount: 0, ...f,
})

describe('firm history: which uploads count', () => {
  it('accepts only as-built schedules unless explicitly overridden', () => {
    const r = selectHistorySchedules([c('done'), c('partial', { openCount: 3 }), c('forced', { openCount: 3, historyOverride: true })])
    expect(r.included.sort()).toEqual(['done', 'forced'])
    expect(r.excluded).toEqual([expect.objectContaining({ id: 'partial', reason: 'not_as_built', detail: expect.stringMatching(/3 of 20 activities have no actual finish/) })])
  })
  it('counts one project once across its update series: the latest as-built upload', () => {
    const r = selectHistorySchedules([
      c('u1', { projectKey: 'tower', dataDate: '2025-01-31', openCount: 10, historyOverride: true }),
      c('u2', { projectKey: 'tower', dataDate: '2025-05-31' }),
      c('u3', { projectKey: 'tower', dataDate: '2025-06-30' }),
      c('u4', { projectKey: 'tower', dataDate: '2025-07-31', openCount: 1, historyOverride: true }),
      c('other', { projectKey: 'clinic' }),
    ])
    expect(r.included.sort()).toEqual(['other', 'u3'])
    expect(r.excluded.filter(x => x.reason === 'superseded').map(x => x.id).sort()).toEqual(['u1', 'u2', 'u4'])
  })
  it('excludes re-imported Planora exports, third-party schedules and unmarked ones', () => {
    const r = selectHistorySchedules([c('px', { planoraExport: true }), c('tp', { uploadOrigin: 'third_party' }), c('off', { inHistory: false }), c('own', { uploadOrigin: 'own' })])
    expect(r.included).toEqual(['own'])
    expect(Object.fromEntries(r.excluded.map(x => [x.id, x.reason]))).toEqual({ px: 'planora_export', tp: 'third_party', off: 'not_included' })
  })
  it('the organization setting turns it all off', () => {
    const r = selectHistorySchedules([c('a'), c('b')], { orgOptOut: true })
    expect(r.included).toEqual([])
    expect(r.excluded.every(x => x.reason === 'org_opt_out')).toBe(true)
  })
  it('as-built ignores LOE / WBS summaries (counted by the caller) and needs activities', () => {
    expect(isAsBuilt({ workCount: 5, openCount: 0 })).toBe(true)
    expect(isAsBuilt({ workCount: 0, openCount: 0 })).toBe(false)
    expect(historyInclusionWarning({ workCount: 5, openCount: 0 }, false)).toBeNull()
  })
})

describe('upload rules: firm history defaults and warnings', () => {
  const base = { requested: null, origin: null, planoraExport: false, workCount: 10, openCount: 0 } as const
  it('own as-built uploads default in; incomplete ones default out', () => {
    expect(decideHistory({ ...base })).toEqual({ inHistory: true, historyOverride: false, warnings: [] })
    expect(decideHistory({ ...base, openCount: 4 }).inHistory).toBe(false)
  })
  it('third-party uploads default to inHistory=false (and refuse an explicit true with a warning)', () => {
    expect(decideHistory({ ...base, origin: 'third_party' }).inHistory).toBe(false)
    const forced = decideHistory({ ...base, origin: 'third_party', requested: true })
    expect(forced.inHistory).toBe(false)
    expect(forced.warnings[0]).toMatch(/Third-party schedules do not calibrate firm history/)
  })
  it('warns on inHistory=true for an incomplete schedule; counts it only with the override', () => {
    const asked = decideHistory({ ...base, openCount: 4, requested: true })
    expect(asked).toMatchObject({ inHistory: true, historyOverride: false })
    expect(asked.warnings[0]).toMatch(/not as-built \(4 of 10 activities have no actual finish\), so firm history will not use it/)
    const over = decideHistory({ ...base, openCount: 4, requested: true, override: true })
    expect(over).toMatchObject({ inHistory: true, historyOverride: true })
    expect(over.warnings[0]).toMatch(/included in firm history anyway/)
  })
  it('a Planora re-import is never used', () => {
    const r = decideHistory({ ...base, planoraExport: true, requested: true, override: true })
    expect(r).toMatchObject({ inHistory: false, historyOverride: false })
    expect(r.warnings[0]).toMatch(/Planora export re-imported/)
  })
})

describe('update series', () => {
  const m = (id: string, version: string, dataDate: string | null, uploadedAt: string, f: Partial<{ projectType: string | null; region: string | null; grossSqft: number | null }> = {}) =>
    ({ id, version, dataDate, uploadedAt, projectType: null, region: null, grossSqft: null, ...f })
  const series = [
    m('a', 'Baseline', '2026-01-31', '2026-02-01T00:00:00Z', { projectType: 'healthcare', region: 'CA', grossSqft: 120000 }),
    m('b', 'Update 1', '2026-02-28', '2026-03-01T00:00:00Z', { projectType: 'healthcare', region: 'CA' }),
  ]
  it('a later upload inherits the project type (and other tags) it omits', () => {
    expect(inheritSeriesProfile(series, { projectType: null, region: null, grossSqft: null })).toEqual({ projectType: 'healthcare', region: 'CA', grossSqft: null, inherited: ['projectType', 'region'] })
    expect(inheritSeriesProfile(series, { projectType: 'lab_research', region: null, grossSqft: 5 })).toMatchObject({ projectType: 'lab_research', region: 'CA', grossSqft: 5, inherited: ['region'] })
    expect(inheritSeriesProfile([], { projectType: null, region: null, grossSqft: null }).inherited).toEqual([])
  })
  it('warns on an out-of-order data date', () => {
    expect(seriesDataDateWarning(series, '2026-03-31', 'Update 2')).toBeNull()
    expect(seriesDataDateWarning(series, '2026-02-15', 'Update 2')).toMatch(/^Out of order: this upload's data date 02\/15\/2026 is earlier than "Update 1" \(data date 02\/28\/2026\)/)
    expect(seriesDataDateWarning(series, '2026-01-15', 'Update 2')).toMatch(/earlier than 2 uploads already in this series \(latest "Update 1"/)
    expect(seriesDataDateWarning(series, '2026-02-28', 'Update 2')).toMatch(/same data date \(02\/28\/2026\)/)
    expect(seriesDataDateWarning(series, null, 'x')).toBeNull()
  })
})
