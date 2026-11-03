import { describe, expect, it } from 'vitest'
import type { Answer, AnswerValue } from './types'
import { elicit } from './elicitation'
import { adaptiveInterview, prerequisitesOf } from './adaptive'
import { sampleProject } from './sample'

const k = (value: AnswerValue): Answer => ({ status: 'known', value, answeredAt: '2026-01-01T00:00:00Z' })
const run = (answers: Record<string, Answer>, budgetMs = 5000) => adaptiveInterview(answers, elicit({ answers }, { today: '2026-10-04' }), { today: '2026-10-04', budgetMs })

describe('adaptive interview', () => {
  it('starts with the foundations and holds back what depends on them', () => {
    const r = run({})
    expect(r.ask[0].id).toBe('project.type')
    expect(r.ask.slice(0, 3).map(q => q.id)).toEqual(['project.type', 'project.state', 'project.scope'])
    expect(r.enoughToBuild).toBe(false)
    for (const d of r.deferred) expect(d.waitingFor.length).toBeGreaterThan(0)
  })

  it('asks permits and long-lead questions only once type and location are known', () => {
    const typeOnly = run({ 'project.type': k('healthcare') })
    expect(typeOnly.ask.some(q => q.section === 'permits')).toBe(false)
    expect(typeOnly.deferred.some(d => d.waitingFor.includes('project.state'))).toBe(true)
    const withState = run({ 'project.type': k('healthcare'), 'project.state': k('VA') })
    expect([...withState.ask, ...withState.optional].some(q => q.section === 'permits')).toBe(true)
  })

  it('measures each question by how far it moves the finish, and asks the biggest first', () => {
    const a = { 'project.type': k('data_center'), 'project.state': k('VA'), 'project.scope': k('new_construction'), 'project.gross_sqft': k(200000), 'project.target_start': k('2026-11-02') }
    const r = run(a)
    expect(r.baselineFinish).toMatch(/^\d{4}-/)
    const drivers = r.ask.filter(q => r.insights[q.id].role === 'driver')
    expect(drivers.length).toBeGreaterThan(0)
    const swings = drivers.map(q => r.insights[q.id].swingDays!)
    expect([...swings].sort((x, y) => y - x)).toEqual(swings)
    expect(swings[0]).toBeGreaterThanOrEqual(r.thresholdDays)
    for (const q of r.optional) expect(['detail', 'no_effect', 'cost', 'anchor', 'unprobed'].includes(r.insights[q.id]?.role ?? 'anchor') || q.section === 'milestones' || q.section === 'history').toBe(true)
    expect(r.finishUncertaintyDays).toBeGreaterThan(0)
    expect(r.simulations).toBeGreaterThan(10)
  })

  it('says "enough to build" once nothing open can move the finish materially', () => {
    const { answers } = sampleProject('2026-10-04')
    const r = run(answers)
    expect(r.enoughToBuild).toBe(true)
    expect(r.remainingThatMatter).toBe(0)
  })

  it('never asks a detail before the answer it depends on', () => {
    expect(prerequisitesOf({ id: 'design.percent', section: 'design' } as never)).toEqual(['design.drawings'])
    const r = run({ 'project.type': k('commercial_office') })
    expect(r.ask.some(q => q.id === 'design.percent')).toBe(false)
  })

  it('stays within its time budget by ranking unprobed questions statically', () => {
    const a = { 'project.type': k('healthcare'), 'project.state': k('TX'), 'project.scope': k('new_construction') }
    const r = run(a, 0)
    expect(Object.values(r.insights).some(i => i.role === 'unprobed')).toBe(true)
    expect(r.ask.length).toBeGreaterThan(0)
  })
  it('asks a long-lead item that drives on its own as a driver; parallel items are grouped only when only together they move the finish', () => {
    // Generators ordered: the MV switchgear now drives the data center on its own (substation
    // energization → permanent power → L2–L5 commissioning), so it is a driver, not hidden in a checklist.
    const a = { 'project.type': k('data_center'), 'project.state': k('VA'), 'project.scope': k('new_construction'), 'project.gross_sqft': k(200000), 'project.target_start': k('2026-11-02'), 'procure.emergency-generator.status': k('released') }
    const r = run(a)
    expect(r.insights['procure.mv-switchgear.status'].role).toBe('driver')
    expect(r.insights['procure.mv-switchgear.status'].swingDays).toBeGreaterThanOrEqual(r.thresholdDays)
    for (const g of r.groups) {
      expect(g.swingDays).toBeGreaterThanOrEqual(r.thresholdDays)
      for (const id of g.questionIds) expect(r.insights[id].role).toBe('group')
      const idx = r.ask.map((q, i) => g.questionIds.includes(q.id) ? i : -1).filter(i => i >= 0)
      expect(idx[idx.length - 1] - idx[0]).toBe(idx.length - 1) // members are adjacent
    }
  })
})
