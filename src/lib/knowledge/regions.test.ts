import { describe, expect, it } from 'vitest'
import { CANONICAL_CATEGORIES } from '@/lib/planning/types'
import { getRegion, listRegions, resolveRegional } from './regions'
import { applies, appliesTri } from './applicability'

const ids = (xs: { id: string }[]) => xs.map((x) => x.id)

describe('applicability', () => {
  it('tri-state semantics', () => {
    expect(appliesTri({}, {})).toBe('yes')
    expect(appliesTri({ projectTypes: ['healthcare'] }, {})).toBe('unknown')
    expect(appliesTri({ projectTypes: ['healthcare'] }, { projectType: 'retail' })).toBe('no')
    expect(appliesTri({ scopes: ['renovation'] }, {})).toBe('unknown')
    expect(appliesTri({ minAcresDisturbed: 1 }, {})).toBe('no')
    expect(appliesTri({ minStories: 2 }, { stories: 3 })).toBe('yes')
    expect(appliesTri({ federalOnly: true }, { projectType: 'federal_defense' })).toBe('yes')
    expect(appliesTri({ nonFederalOnly: true }, { isFederal: true })).toBe('no')
    expect(applies({ projectTypes: ['healthcare'] }, {})).toBe(true)
    expect(applies({ minSqft: 1000 }, {})).toBe(false)
  })
})

describe('regions', () => {
  it('lists federal, default and 8 states', () => {
    const codes = listRegions().map((r) => r.code)
    for (const c of ['US-FEDERAL', 'US-DEFAULT', 'CA', 'TX', 'NY', 'FL', 'WA', 'VA', 'MD', 'AZ']) expect(codes).toContain(c)
    expect(getRegion('ca')?.name).toBe('California')
  })

  it('every item cites a source, carries the AHJ caveat and uses valid categories', () => {
    const cats = new Set<string>(CANONICAL_CATEGORIES)
    for (const r of listRegions()) {
      for (const p of r.permits) {
        expect(p.source.length).toBeGreaterThan(5)
        expect(p.notes).toMatch(/AHJ/)
        expect(cats.has(p.gates)).toBe(true)
        expect(cats.has(p.submitAfter)).toBe(true)
        expect(p.reviewWeeks.low).toBeLessThanOrEqual(p.reviewWeeks.typical)
        expect(p.reviewWeeks.typical).toBeLessThanOrEqual(p.reviewWeeks.high)
      }
      for (const g of r.regulations) {
        expect(g.source.length).toBeGreaterThan(5)
        if (g.addsActivity) expect(cats.has(g.addsActivity.category)).toBe(true)
      }
    }
  })

  it('CA healthcare includes HCAI with a long review', () => {
    const r = resolveRegional({ state: 'CA', projectType: 'healthcare', isFederal: false })
    const hcai = r.permits.find((p) => p.id === 'ca-hcai')
    expect(hcai).toBeDefined()
    expect(hcai!.reviewWeeks.low).toBeGreaterThanOrEqual(26)
    expect(ids(r.permits)).not.toContain('ca-dsa')
    expect(r.regionCode).toBe('CA')
  })

  it('CA K-12 includes DSA', () => {
    const r = resolveRegional({ state: 'CA', projectType: 'k12_school', isFederal: false })
    expect(ids(r.permits)).toContain('ca-dsa')
    expect(ids(r.permits)).not.toContain('ca-hcai')
  })

  it('federal_defense includes UFC and NEPA and drops local building permits', () => {
    const r = resolveRegional({ state: 'VA', projectType: 'federal_defense' })
    expect(ids(r.regulations)).toContain('us-ufc-4-010-01')
    expect(ids(r.permits)).toContain('us-nepa')
    expect(ids(r.permits)).toContain('us-nhpa-106')
    expect(ids(r.permits)).not.toContain('va-building')
    expect(ids(r.permits)).not.toContain('def-building')
  })

  it('SCIF items only when classification is classified', () => {
    const base = { state: 'MD', projectType: 'federal_defense' as const }
    for (const classification of [undefined, 'unclassified', 'cui'] as const) {
      const r = resolveRegional({ ...base, classification })
      expect(ids(r.regulations)).not.toContain('us-icd705-accreditation')
    }
    const r = resolveRegional({ ...base, classification: 'classified' })
    const scif = r.regulations.find((g) => g.id === 'us-icd705-accreditation')!
    expect(scif.addsActivity).toMatchObject({ after: 'finishes', before: 'substantial_completion' })
  })

  it('≥1 acre disturbance includes NPDES; state program replaces EPA CGP', () => {
    expect(ids(resolveRegional({ state: 'OH', siteAcresDisturbed: 3 }).permits)).toContain('us-npdes-cgp')
    expect(ids(resolveRegional({ state: 'OH', siteAcresDisturbed: 0.5 }).permits)).not.toContain('us-npdes-cgp')
    const ca = ids(resolveRegional({ state: 'CA', siteAcresDisturbed: 2 }).permits)
    expect(ca).toContain('ca-cgp')
    expect(ca).not.toContain('us-npdes-cgp')
  })

  it('unknown/unsupported state falls back to US-DEFAULT', () => {
    const r = resolveRegional({ state: 'OH', isFederal: false })
    expect(r.regionCode).toBe('US-DEFAULT')
    expect(ids(r.permits)).toContain('def-building')
    expect(r.climate.adverseMonths.length).toBeGreaterThan(0)
    expect(resolveRegional({}).regionCode).toBe('US-DEFAULT')
  })

  it('building permit gates foundations after CDs', () => {
    const b = resolveRegional({ state: 'TX', isFederal: false }).permits.find((p) => p.id === 'tx-building')!
    expect(b.gates).toBe('foundations')
    expect(b.submitAfter).toBe('design_cd')
  })

  it('NYC gets DOB/FDNY; upstate gets local building department', () => {
    const nyc = ids(resolveRegional({ state: 'NY', city: 'Brooklyn', isFederal: false }).permits)
    expect(nyc).toContain('ny-nyc-dob')
    expect(nyc).toContain('ny-fdny')
    expect(nyc).not.toContain('ny-building')
    const alb = ids(resolveRegional({ state: 'NY', city: 'Albany', isFederal: false }).permits)
    expect(alb).toContain('ny-building')
    expect(alb).not.toContain('ny-nyc-dob')
  })

  it('climate reflects region', () => {
    expect(resolveRegional({ state: 'FL' }).climate.adverseMonths).toContain(8)
    expect(resolveRegional({ state: 'NY' }).climate.adverseMonths).toContain(1)
  })
})
