import { describe, expect, it } from 'vitest'
import { PROJECT_TYPES, isCivilType, type ProjectProfile } from '@/lib/planning/types'
import {
  computeTemplateDuration,
  estimateTemplateNetwork,
  selectedStructure,
  templatesFor,
  validateTemplates,
} from './templates'

const WD_PER_MONTH = 21.7

describe('template network', () => {
  it('validates for every project type, scope and size (preds resolve, no cycles, no open ends)', () => {
    const v = validateTemplates()
    expect(v.errors).toEqual([])
    expect(v.ok).toBe(true)
    expect(v.checked).toBeGreaterThan(500)
  })

  it('returns one activity per category (per key for civil networks, which hold staged / per-structure activities)', () => {
    for (const projectType of PROJECT_TYPES) {
      const acts = templatesFor({ projectType, grossSqft: 120000, stories: 3, scope: 'new_construction' })
      const ids = acts.map((a) => a.key ?? a.category)
      expect(new Set(ids).size).toBe(ids.length)
      if (!isCivilType(projectType)) expect(acts.every((a) => a.key === undefined)).toBe(true)
    }
  })

  it('100k sf 4-story office: 14–20 months from mobilization to substantial completion', () => {
    const p: ProjectProfile = { projectType: 'commercial_office', grossSqft: 100000, stories: 4, scope: 'new_construction', isFederal: false }
    const e = estimateTemplateNetwork(p)
    const span = e.times.substantial_completion!.ef - e.times.mobilization!.es
    const months = span / WD_PER_MONTH
    expect(months).toBeGreaterThanOrEqual(14)
    expect(months).toBeLessThanOrEqual(20)
  })

  it('scales with size', () => {
    const small = estimateTemplateNetwork({ projectType: 'commercial_office', grossSqft: 20000, stories: 1, scope: 'new_construction' }).finish
    const large = estimateTemplateNetwork({ projectType: 'commercial_office', grossSqft: 400000, stories: 12, scope: 'new_construction' }).finish
    expect(large).toBeGreaterThan(small)
  })

  it('selects structural system by type/height', () => {
    expect(selectedStructure({ projectType: 'commercial_office', scope: 'new_construction' })).toBe('structure_steel')
    expect(selectedStructure({ projectType: 'multifamily', stories: 4, scope: 'new_construction' })).toBe('structure_wood')
    expect(selectedStructure({ projectType: 'multifamily', stories: 12, scope: 'new_construction' })).toBe('structure_concrete')
    expect(selectedStructure({ projectType: 'lab_research', scope: 'new_construction' })).toBe('structure_concrete')
    expect(selectedStructure({ projectType: 'commercial_office', scope: 'renovation' })).toBeUndefined()
  })

  it('renovation scopes get demo/abatement and no sitework/structure; new construction the reverse', () => {
    const reno = templatesFor({ projectType: 'healthcare', scope: 'renovation_occupied', grossSqft: 30000, stories: 2 }).map((a) => a.category)
    expect(reno).toContain('demolition')
    expect(reno).toContain('abatement')
    expect(reno).not.toContain('earthwork')
    expect(reno.some((c) => c.startsWith('structure_'))).toBe(false)
    const fresh = templatesFor({ projectType: 'healthcare', scope: 'new_construction', grossSqft: 30000, stories: 2 }).map((a) => a.category)
    expect(fresh).not.toContain('demolition')
    expect(fresh).toContain('earthwork')
    expect(fresh).toContain('deep_foundations')
  })

  it('deep foundations for tall buildings or data center/healthcare; elevators only ≥2 stories', () => {
    const office2 = templatesFor({ projectType: 'commercial_office', stories: 2, scope: 'new_construction' }).map((a) => a.category)
    expect(office2).not.toContain('deep_foundations')
    expect(office2).toContain('elevators')
    const office10 = templatesFor({ projectType: 'commercial_office', stories: 10, scope: 'new_construction' }).map((a) => a.category)
    expect(office10).toContain('deep_foundations')
    const wh = templatesFor({ projectType: 'warehouse_industrial', stories: 1, scope: 'new_construction' }).map((a) => a.category)
    expect(wh).not.toContain('elevators')
  })

  it('design_review only for federal work', () => {
    expect(templatesFor({ projectType: 'federal_defense' }).map((a) => a.category)).toContain('design_review')
    expect(templatesFor({ projectType: 'retail', isFederal: false }).map((a) => a.category)).not.toContain('design_review')
  })

  it('uses SS overlaps where typical', () => {
    const acts = templatesFor({ projectType: 'commercial_office', stories: 4, grossSqft: 100000, scope: 'new_construction' })
    const mep = acts.find((a) => a.category === 'mep_rough')!
    expect(mep.preds.some((p) => p.category === 'structure_steel' && p.type === 'SS' && p.lag > 0)).toBe(true)
    const fin = acts.find((a) => a.category === 'finishes')!
    expect(fin.preds.some((p) => p.category === 'framing_drywall' && p.type === 'SS')).toBe(true)
  })

  it('commissioning is longer for data centers than offices', () => {
    const p = { grossSqft: 150000, stories: 2, scope: 'new_construction' as const }
    const cxDc = templatesFor({ ...p, projectType: 'data_center' }).find((a) => a.category === 'commissioning')!
    const cxOf = templatesFor({ ...p, projectType: 'commercial_office' }).find((a) => a.category === 'commissioning')!
    expect(computeTemplateDuration(cxDc, { ...p, projectType: 'data_center' })).toBeGreaterThan(computeTemplateDuration(cxOf, { ...p, projectType: 'commercial_office' }))
  })

  it('clamps durations and gives milestones zero', () => {
    const acts = templatesFor({ projectType: 'commercial_office', scope: 'new_construction' })
    const steel = acts.find((a) => a.category === 'structure_steel')!
    expect(computeTemplateDuration(steel, { grossSqft: 10_000_000, stories: 100 })).toBe(steel.duration.max)
    expect(computeTemplateDuration(steel, { grossSqft: 100, stories: 1 })).toBeGreaterThanOrEqual(steel.duration.min)
    const cx = templatesFor({ projectType: 'data_center' }).find((a) => a.category === 'commissioning')!
    expect(computeTemplateDuration(cx, { projectType: 'data_center', grossSqft: 100 })).toBe(cx.duration.min)
    const sc = acts.find((a) => a.category === 'substantial_completion')!
    expect(computeTemplateDuration(sc, { grossSqft: 100000 })).toBe(0)
  })
})
