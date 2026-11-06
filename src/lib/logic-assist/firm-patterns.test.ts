import { describe, expect, it } from 'vitest'
import { learnSequencing, patternNote, type PastProject } from './firm-patterns'
import { suggestLogic, type LogicActivity, type LogicLink } from './suggest'

/** A past project: rough-in, drywall, paint; the firm overlaps drywall with rough-in (SS +5). */
function project(id: string, o: { ss?: boolean; paint?: boolean } = {}): PastProject {
  const a = (n: string, name: string): LogicActivity => ({ id: `${id}-${n}`, activityId: n, name, activityType: 'task' })
  const activities = [a('A1', 'MEP rough-in Level 1'), a('A2', 'Drywall Level 1'), ...(o.paint === false ? [] : [a('A3', 'Paint Level 1')])]
  const links: LogicLink[] = [
    { predecessorId: `${id}-A1`, successorId: `${id}-A2`, type: o.ss === false ? 'FS' : 'SS', lag: o.ss === false ? 0 : 5 },
    ...(o.paint === false ? [] : [{ predecessorId: `${id}-A2`, successorId: `${id}-A3`, type: 'FS' as const, lag: 0 }]),
  ]
  return { scheduleId: id, activities, links }
}

describe('learning the firm\'s sequencing style from its past schedules', () => {
  it('counts each project once per pair and keeps the type and lag the firm uses most', () => {
    const f = learnSequencing([project('p1'), project('p2'), project('p3', { ss: false })])
    expect(f.projectCount).toBe(3)
    const rough = f.patterns.find(p => p.from === 'mepRough' && p.to === 'drywall')!
    expect(rough).toMatchObject({ projects: 3, of: 3, type: 'SS', typeProjects: 2, lag: 5, usual: true })
    expect(patternNote(rough)).toBe('Your firm tied MEP rough-in → drywall in 3 of 3 past projects, usually SS +5d.')
    expect(f.overlapShare).toBeCloseTo(2 / 6, 2)
  })

  it('needs the tie in at least two projects', () => {
    const f = learnSequencing([project('p1'), project('p2', { paint: false })])
    expect(f.patterns.some(p => p.to === 'drywall')).toBe(true)
    expect(f.patterns.some(p => p.from === 'drywall')).toBe(false)
    expect(learnSequencing([project('p1')]).patterns).toEqual([])
  })

  it('logic suggestions use the firm\'s link type and lag, and say why', () => {
    const firm = learnSequencing([project('p1'), project('p2'), project('p3')])
    const acts: LogicActivity[] = [
      { id: 's', activityId: 'S100', name: 'Notice to Proceed', activityType: 'milestone' },
      { id: 'r', activityId: 'A200', name: 'MEP rough-in Level 2', activityType: 'task' },
      { id: 'd', activityId: 'A210', name: 'Drywall Level 2', activityType: 'task' },
      { id: 'f', activityId: 'F900', name: 'Substantial Completion', activityType: 'milestone' },
    ]
    const links: LogicLink[] = [{ predecessorId: 's', successorId: 'r' }, { predecessorId: 'd', successorId: 'f' }]
    const plain = suggestLogic(acts, links).suggestions.find(x => x.predecessor.id === 'r' && x.successor.id === 'd')!
    expect([plain.type, plain.lag, plain.firm]).toEqual(['FS', 0, undefined])
    const withFirm = suggestLogic(acts, links, { firm }).suggestions.find(x => x.predecessor.id === 'r' && x.successor.id === 'd')!
    expect([withFirm.type, withFirm.lag]).toEqual(['SS', 5])
    expect(withFirm.firm).toEqual({ projects: 3, of: 3, type: 'SS', lag: 5 })
    expect(withFirm.reason).toMatch(/Your firm tied MEP rough-in → drywall in 3 of 3/)
    expect(withFirm.confidence).toBeGreaterThan(plain.confidence)
  })

  it('does not flag the firm\'s own habit as out of sequence', () => {
    // Paint before drywall runs against the usual order, but this firm does it on purpose (e.g. prime coat).
    const habit = (id: string): PastProject => ({ scheduleId: id, activities: [
      { id: `${id}-p`, activityId: 'P', name: 'Paint Level 1', activityType: 'task' }, { id: `${id}-d`, activityId: 'D', name: 'Drywall Level 1', activityType: 'task' },
    ], links: [{ predecessorId: `${id}-p`, successorId: `${id}-d`, type: 'FS', lag: 0 }] })
    const firm = learnSequencing([habit('h1'), habit('h2')])
    expect(firm.patterns[0]).toMatchObject({ from: 'finishes', to: 'drywall', usual: false })
    const acts: LogicActivity[] = [{ id: 'p', activityId: 'A1', name: 'Paint Level 3', activityType: 'task' }, { id: 'd', activityId: 'A2', name: 'Drywall Level 3', activityType: 'task' }]
    const links: LogicLink[] = [{ predecessorId: 'p', successorId: 'd' }]
    expect(suggestLogic(acts, links).suggestions.some(s => s.kind === 'out_of_sequence')).toBe(true)
    expect(suggestLogic(acts, links, { firm }).suggestions.some(s => s.kind === 'out_of_sequence')).toBe(false)
  })
})
