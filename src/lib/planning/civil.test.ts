import { describe, expect, it } from 'vitest'
import type { Answer, AnswerValue } from './types'
import { questionBank } from './elicitation'
import { generateSchedule } from './generator'
import { classifyActivity } from '@/lib/semantic/taxonomy'

const AT = '2026-01-01T00:00:00.000Z'
const k = (value: AnswerValue): Answer => ({ status: 'known', value, answeredAt: AT })
const bridge = (): Record<string, Answer> => ({
  'project.type': k('highway_bridge'), 'project.state': k('IL'), 'project.scope': k('renovation_occupied'), 'project.value_musd': k(42),
  'project.target_start': k('2026-03-02'), 'project.delivery': k('dbb'), 'design.drawings': k(true), 'design.percent': k(100), 'calendar.workweek': k('5x8'),
})

describe('civil / infrastructure projects (pilot finding: bridges got building schedules)', () => {
  it('asks civil questions, not building ones', () => {
    const { all } = questionBank({ answers: bridge() })
    const ids = all.map(q => q.id)
    expect(ids).toContain('project.value_musd')
    expect(ids).not.toContain('project.gross_sqft')
    expect(ids).not.toContain('project.stories')
    const text = all.map(q => q.prompt).join(' ').toLowerCase()
    for (const word of ['medical gas', 'mri', 'elevator', 'curtain wall', 'rooftop', 'fume hood', 'ups']) expect(text).not.toContain(word)
    expect(ids).toContain('permit.us-usace-404-bridge.status')
    expect(ids).toContain('procure.civ-steel-girders.status')
  })
  it('generates a bridge network with no building work', () => {
    const g = generateSchedule({ answers: bridge(), today: '2026-01-15' })
    const names = g.activities.map(a => a.name.toLowerCase()).join(' | ')
    for (const w of ['girder', 'deck', 'abutments', 'traffic', 'cofferdam']) expect(names).toContain(w)
    for (const w of ['drywall', 'roofing', 'curtain wall', 'elevator', 'dried-in']) expect(names).not.toContain(w)
    expect(g.cpm?.projectFinish).toBeTruthy()
  })
  it('scales civil durations with construction value', () => {
    const small = generateSchedule({ answers: { ...bridge(), 'project.value_musd': k(5) }, today: '2026-01-15' })
    const big = generateSchedule({ answers: { ...bridge(), 'project.value_musd': k(150) }, today: '2026-01-15' })
    expect(big.cpm!.projectFinish > small.cpm!.projectFinish).toBe(true)
  })
  it.each(['transit_rail', 'water_wastewater', 'utility_power', 'industrial_process'])('%s generates its own network', (type) => {
    const g = generateSchedule({ answers: { ...bridge(), 'project.type': k(type), 'project.scope': k('new_construction') }, today: '2026-01-15' })
    const names = g.activities.map(a => a.name.toLowerCase()).join(' | ')
    expect(names).not.toContain('drywall')
    expect(names).toMatch(/startup|energization|testing|track/)
  })
  it('classifies civil activity names from uploads', () => {
    expect(classifyActivity('Set girders span 2', '').category).toBe('superstructure')
    expect(classifyActivity('Pour bridge deck', '').category).toBe('deck')
    expect(classifyActivity('Install cofferdam pier 3', '').category).toBe('in_water_work')
    expect(classifyActivity('Clarifier No. 2 leak test', '').category).toBe('process_structures')
    expect(classifyActivity('Roof membrane', '').category).toBe('roofing')
  })
  it('drops installation work for systems answered "Not in scope" (pilot finding)', () => {
    const office: Record<string, Answer> = {
      'project.type': k('commercial_office'), 'project.state': k('TX'), 'project.scope': k('new_construction'), 'project.gross_sqft': k(60000), 'project.stories': k(3),
      'project.target_start': k('2026-03-02'), 'design.drawings': k(true), 'design.percent': k(100),
    }
    const ids = questionBank({ answers: office }).longLead.filter(it => it.gates === 'elevators').map(it => it.id)
    expect(ids.length).toBeGreaterThan(0)
    const with_ = generateSchedule({ answers: office, today: '2026-01-15' })
    const without = generateSchedule({ answers: { ...office, ...Object.fromEntries(ids.map(id => [`procure.${id}.status`, k('not_in_scope')])) }, today: '2026-01-15' })
    expect(with_.activities.some(a => a.category === 'elevators')).toBe(true)
    expect(without.activities.some(a => a.category === 'elevators')).toBe(false)
  })
  it('keeps activity IDs stable when the plan is regenerated (pilot finding)', () => {
    const g1 = generateSchedule({ answers: bridge(), today: '2026-01-15' })
    const g2 = generateSchedule({ answers: { ...bridge(), 'project.value_musd': k(80) }, previous: g1, today: '2026-01-15' })
    const before = new Map(g1.activities.map(a => [a.id, a.code]))
    const common = g2.activities.filter(a => before.has(a.id))
    expect(common.length).toBeGreaterThan(10)
    for (const a of common) expect(a.code).toBe(before.get(a.id))
    expect(new Set(g2.activities.map(a => a.code)).size).toBe(g2.activities.length)
  })
})
