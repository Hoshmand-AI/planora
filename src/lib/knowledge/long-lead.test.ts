import { describe, expect, it } from 'vitest'
import { CANONICAL_CATEGORIES } from '@/lib/planning/types'
import { allLongLeadItems, getLongLead, listLongLeadItems } from './long-lead'

const ids = (xs: { id: string }[]) => xs.map((x) => x.id)

describe('long-lead catalog', () => {
  it('has ≥18 well-formed items', () => {
    const all = allLongLeadItems()
    expect(all.length).toBeGreaterThanOrEqual(18)
    const cats = new Set<string>(CANONICAL_CATEGORIES)
    for (const i of all) {
      expect(i.leadWeeks.low).toBeLessThanOrEqual(i.leadWeeks.typical)
      expect(i.leadWeeks.typical).toBeLessThanOrEqual(i.leadWeeks.high)
      expect(i.submittalWeeks).toBeGreaterThan(0)
      expect(i.source).toMatch(/202[45]/)
      expect(i.notes).toMatch(/verify/i)
      expect(cats.has(i.gates)).toBe(true)
    }
    expect(new Set(ids(all)).size).toBe(all.length)
  })

  it('UPS only for data centers', () => {
    expect(ids(listLongLeadItems({ projectType: 'data_center' }))).toContain('ups')
    expect(ids(listLongLeadItems({ projectType: 'data_center' }))).toContain('crah-crac')
    for (const projectType of ['commercial_office', 'healthcare', 'retail'] as const) {
      expect(ids(listLongLeadItems({ projectType }))).not.toContain('ups')
    }
  })

  it('elevators only when multi-story; SCIF doors only when classified', () => {
    expect(ids(listLongLeadItems({ projectType: 'retail', stories: 1 }))).not.toContain('elevators')
    expect(ids(listLongLeadItems({ projectType: 'retail', stories: 2 }))).toContain('elevators')
    expect(ids(listLongLeadItems({ projectType: 'federal_defense' }))).not.toContain('scif-doors-tempest')
    expect(ids(listLongLeadItems({ projectType: 'federal_defense', classification: 'classified' }))).toContain('scif-doors-tempest')
    expect(ids(listLongLeadItems({ projectType: 'federal_defense' }))).toContain('blast-windows')
  })

  it('getLongLead', () => {
    expect(getLongLead('mv-switchgear')?.gates).toBe('electrical_service')
    expect(getLongLead('nope')).toBeUndefined()
  })
})
