import { describe, expect, it } from 'vitest'
import type { Answer, AnswerValue } from './types'
import { generateSchedule } from './generator'

// Defects found by a line-by-line review of plan generation, each reproduced before the fix.
const k = (value: AnswerValue): Answer => ({ status: 'known', value, answeredAt: '2026-11-10T00:00:00.000Z' })
const base = (o: Record<string, AnswerValue>): Record<string, Answer> =>
  Object.fromEntries(Object.entries({ 'project.target_start': '2027-01-04', 'project.scope': 'new_construction', ...o }).map(([q, v]) => [q, k(v)]))
const gen = (a: Record<string, Answer>) => generateSchedule({ answers: a, today: '2026-11-10' })
const ids = (g: ReturnType<typeof gen>) => g.activities.map(a => a.id).join(' ')

describe('federal permits', () => {
  const dc = { 'project.type': 'data_center', 'project.state': 'VA', 'project.gross_sqft': 250000, 'design.drawings': true, 'design.percent': 100 }
  it('are not scheduled while the federal question is unanswered (the plan says "assumed not federal")', () => {
    const unanswered = gen(base(dc)), no = gen(base({ ...dc, 'project.federal': false })), yes = gen(base({ ...dc, 'project.federal': true }))
    expect(ids(unanswered)).not.toMatch(/us-nepa|nhpa-106|us-fed-installation/)
    expect(unanswered.cpm!.projectFinish).toBe(no.cpm!.projectFinish)
    expect(ids(yes)).toMatch(/us-nepa/)
  })
  it('federal money on non-federal land keeps the local building permit', () => {
    const h = { 'project.type': 'healthcare', 'project.state': 'VA', 'project.gross_sqft': 60000, 'project.stories': 3, 'project.federal': true }
    const off = gen(base({ ...h, 'project.federal_installation': false })), on = gen(base({ ...h, 'project.federal_installation': true }))
    expect(ids(off)).toMatch(/va-building/)
    expect(ids(on)).not.toMatch(/va-building/)
  })
})

describe('design durations', () => {
  it('do not change with the field work week, and design does not run on weekends', () => {
    const office = (ww: string) => gen(base({ 'project.type': 'commercial_office', 'project.state': 'TX', 'project.gross_sqft': 100000, 'project.stories': 4, 'design.drawings': false, 'calendar.workweek': ww }))
    const sd = (g: ReturnType<typeof gen>) => g.activities.find(a => a.id === 't-design_sd')!
    const five = office('5x8'), seven = office('7x12')
    expect(sd(seven).duration).toBe(sd(five).duration)
    expect(five.cpm!.times['t-design_cd'].earlyFinish).toBe(seven.cpm!.times['t-design_cd'].earlyFinish)
    const cal = seven.calendars.find(c => c.id === sd(seven).calendarId)!
    expect(cal.workDays).toEqual([1, 2, 3, 4, 5])
    expect(five.calendars.length).toBe(2)
  })
})

describe('in-water work window', () => {
  it('holds wharf pile driving named for the window to the window', () => {
    const g = gen(base({ 'project.type': 'marine_civil_works', 'project.state': 'WA', 'project.value_musd': 40, 'marine.scope': 'marine_structure', 'civil.inwater_open': '2027-07-15', 'civil.inwater_close': '2027-09-30', 'design.drawings': true, 'design.percent': 100 }))
    const piles = g.activities.filter(a => /in-water work window/i.test(a.name))
    expect(piles.length).toBeGreaterThan(0)
    // The last piece of the work holds the window's closing date (finish no later than).
    expect(piles.some(p => p.constraint?.type === 'FNLT' && p.constraint.date === '2027-09-30')).toBe(true)
  })
})
