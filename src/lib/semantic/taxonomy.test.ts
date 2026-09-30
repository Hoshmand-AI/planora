import { describe, expect, it } from 'vitest'
import { CANONICAL_CATEGORIES, PHASES, type CanonicalCategory } from '@/lib/planning/types'
import { categoryLabel, classifyActivity, normalizeCalendar, phaseOf, TAXONOMY_RULES } from './taxonomy'

const CASES: [string, CanonicalCategory, string?][] = [
  ['NTP', 'ntp'],
  ['Notice to Proceed', 'ntp'],
  ['SD', 'design_sd'],
  ['Schematic Design Phase', 'design_sd'],
  ['DD', 'design_dd'],
  ['Design Development', 'design_dd'],
  ['CD 100%', 'design_cd'],
  ['Construction Documents', 'design_cd'],
  ['Design review', 'design_review'],
  ['65% Design Review - NAVFAC', 'design_review'],
  ['Bldg permit', 'permit_building'],
  ['Building Permit Issued', 'permit_building'],
  ['Grading permit', 'permit_site'],
  ['SWPPP / NOI', 'permit_site'],
  ['HCAI Approval', 'permit_other'],
  ['Submittal - Structural Steel', 'submittals'],
  ['Shop Drawings Elevators', 'submittals'],
  ['Procure switchgear', 'procurement'],
  ['Fabricate Structural Steel', 'procurement'],
  ['Deliver AHUs', 'procurement'],
  ['Mob', 'mobilization'],
  ['Mobilization', 'mobilization'],
  ['Abatement', 'abatement'],
  ['Asbestos abatement L2', 'abatement'],
  ['Demo', 'demolition'],
  ['Selective Demolition', 'demolition'],
  ['Excavation', 'earthwork'],
  ['Mass ex', 'earthwork'],
  ['Grading', 'earthwork'],
  ['Piles', 'deep_foundations'],
  ['Caissons', 'deep_foundations'],
  ['Drilled piers', 'deep_foundations'],
  ['Aggregate piers', 'deep_foundations'],
  ['F/R/P footings', 'foundations'],
  ['Pile caps & grade beams', 'foundations'],
  ['SOG', 'slab_on_grade'],
  ['Pour slab on grade', 'slab_on_grade'],
  ['Erect Stl', 'structure_steel'],
  ['Structural Steel Erection', 'structure_steel'],
  ['Deck & Detail', 'structure_steel'],
  ['CMU', 'structure_concrete'],
  ['Pour L3 elevated slab', 'structure_concrete'],
  ['Wood framing L2-L5', 'structure_wood'],
  ['Roof membrane', 'roofing'],
  ['Dry-in', 'dry_in'],
  ['Watertight', 'dry_in'],
  ['Curtainwall', 'windows_curtainwall'],
  ['Storefront', 'windows_curtainwall'],
  ['Brick veneer', 'exterior_skin'],
  ['Metal Panels', 'exterior_skin'],
  ['Rough-In MEP', 'mep_rough'],
  ['OH MEP rough', 'mep_rough'],
  ['Pull wire', 'mep_rough'],
  ['Energize', 'electrical_service'],
  ['Perm power', 'electrical_service'],
  ['Set switchgear', 'electrical_service'],
  ['Set RTUs', 'mechanical_equipment'],
  ['Chiller startup', 'commissioning'],
  ['Sprinkler rough', 'fire_protection'],
  ['FA devices', 'fire_protection'],
  ['Elevator install', 'elevators'],
  ['Low voltage cabling', 'low_voltage'],
  ['Hang/Tape/Finish GWB', 'framing_drywall'],
  ['Drywall', 'framing_drywall'],
  ['Metal stud framing', 'framing_drywall'],
  ['Paint', 'finishes'],
  ['Flooring - LVT', 'finishes'],
  ['Toilet accessories & signage', 'specialties'],
  ['Landscaping', 'paving_landscape'],
  ['Paving', 'paving_landscape'],
  ['Striping', 'paving_landscape'],
  ['Site utilities - storm', 'utilities_site'],
  ['Final inspection', 'inspections'],
  ['Fire marshal', 'inspections'],
  ['Cx', 'commissioning'],
  ['TAB', 'commissioning'],
  ['Test & Balance', 'commissioning'],
  ['Punch list', 'punchlist'],
  ['TCO', 'substantial_completion'],
  ['C of O', 'substantial_completion'],
  ['Sub Comp', 'substantial_completion'],
  ['SC', 'substantial_completion'],
  ['Substantial Completion', 'substantial_completion'],
  ['Closeout documents', 'closeout'],
  ['Final Completion', 'final_completion'],
  ['Weather contingency', 'contingency'],
]

describe('classifyActivity', () => {
  it.each(CASES)('%s -> %s', (name, expected) => {
    const c = classifyActivity(name)
    expect(c.category).toBe(expected)
    expect(c.phase).toBe(phaseOf(expected))
    expect(c.confidence).toBeGreaterThan(0.5)
  })

  it('covers at least 40 variants', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(40)
    expect(TAXONOMY_RULES.length).toBeGreaterThan(30)
  })

  it('unknown names -> other with low confidence', () => {
    const c = classifyActivity('Xyzzy placeholder 42')
    expect(c.category).toBe('other')
    expect(c.confidence).toBeLessThan(0.3)
  })

  it('uses WBS as a secondary signal', () => {
    const fromWbs = classifyActivity('Area A - Level 2', 'Interior Finishes')
    expect(fromWbs.category).toBe('finishes')
    expect(fromWbs.confidence).toBeLessThan(0.6)
    const agree = classifyActivity('Drywall', 'Framing & Drywall')
    const alone = classifyActivity('Drywall')
    expect(agree.confidence).toBeGreaterThan(alone.confidence)
  })
})

describe('labels & phases', () => {
  it('every category has a label and a valid phase', () => {
    for (const c of CANONICAL_CATEGORIES) {
      expect(categoryLabel(c).length).toBeGreaterThan(1)
      expect(PHASES).toContain(phaseOf(c))
    }
  })
})

describe('normalizeCalendar', () => {
  const cases: [string, number[], number][] = [
    ['Standard 5 Day', [1, 2, 3, 4, 5], 8],
    ['5x8', [1, 2, 3, 4, 5], 8],
    ['Mon-Fri', [1, 2, 3, 4, 5], 8],
    ['M-F 10hr', [1, 2, 3, 4, 5], 10],
    ['4x10', [1, 2, 3, 4], 10],
    ['6 Day Week', [1, 2, 3, 4, 5, 6], 8],
    ['Sat Work', [1, 2, 3, 4, 5, 6], 8],
    ['7 Day', [0, 1, 2, 3, 4, 5, 6], 8],
    ['24/7', [0, 1, 2, 3, 4, 5, 6], 24],
    ['Standard', [1, 2, 3, 4, 5], 8],
    ['Night Shift', [1, 2, 3, 4, 5], 8],
  ]
  it.each(cases)('%s', (name, days, hours) => {
    const n = normalizeCalendar({ name })
    expect(n.workDays).toEqual(days)
    expect(n.hoursPerDay).toBe(hours)
    expect(n.conflict).toBeUndefined()
    expect(n.confidence).toBeGreaterThan(0.5)
  })

  it('canonical text', () => {
    expect(normalizeCalendar({ name: 'Standard 5 Day' }).canonical).toBe('5-day (Mon–Fri) × 8h')
    expect(normalizeCalendar({ name: '4x10' }).canonical).toBe('4-day (Mon–Thu) × 10h')
    expect(normalizeCalendar({ name: 'Night Shift' }).canonical).toMatch(/night shift/)
  })

  it('trusts file work days and flags conflicts', () => {
    const ok = normalizeCalendar({ name: '5 Day', workDays: [1, 2, 3, 4, 5], hoursPerDay: 8 })
    expect(ok.conflict).toBeUndefined()
    expect(ok.confidence).toBeGreaterThanOrEqual(0.9)

    const bad = normalizeCalendar({ name: 'Standard 5 Day', workDays: [1, 2, 3, 4, 5, 6], hoursPerDay: 8 })
    expect(bad.workDays).toEqual([1, 2, 3, 4, 5, 6])
    expect(bad.canonical).toBe('6-day (Mon–Sat) × 8h')
    expect(bad.conflict).toMatch(/Mon–Fri/)
    expect(bad.confidence).toBeLessThan(0.6)

    const hrs = normalizeCalendar({ name: '4x10', workDays: [1, 2, 3, 4], hoursPerDay: 8 })
    expect(hrs.hoursPerDay).toBe(8)
    expect(hrs.conflict).toMatch(/10h/)
  })

  it('unknown label with file days is trusted; unknown label alone is low confidence', () => {
    const f = normalizeCalendar({ name: 'CAL-07', workDays: [1, 3, 5] })
    expect(f.canonical).toBe('3-day (Mon, Wed, Fri) × 8h')
    expect(f.confidence).toBeGreaterThan(0.8)
    expect(normalizeCalendar({ name: 'CAL-07' }).confidence).toBeLessThan(0.5)
  })
})
