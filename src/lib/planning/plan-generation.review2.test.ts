import { describe, expect, it } from 'vitest'
import type { Answer, AnswerValue } from './types'
import { generateSchedule } from './generator'
import { applyAnswers, isOutsideUS, questionBank } from './elicitation'
import { civilOptionsFrom, CIVIL_COUNT_CAPS } from './civil-options'
import { rulesPrefill } from './document-prefill'
import { sampleProject } from './sample'

// Medium findings of the line-by-line review of plan generation (M1 to M10), each reproduced before its fix.
const AT = '2026-11-10T00:00:00.000Z'
const k = (value: AnswerValue): Answer => ({ status: 'known', value, answeredAt: AT })
const base = (o: Record<string, AnswerValue>): Record<string, Answer> =>
  Object.fromEntries(Object.entries({ 'project.target_start': '2027-01-04', 'project.scope': 'new_construction', ...o }).map(([q, v]) => [q, k(v)]))
const gen = (a: Record<string, Answer>) => generateSchedule({ answers: a, today: '2026-11-10' })
const office = { 'project.type': 'commercial_office', 'project.state': 'TX', 'project.gross_sqft': 100000, 'project.stories': 4 }
const invalid = (current: Record<string, Answer>, id: string, value: AnswerValue) => applyAnswers(current, { [id]: { value } }).invalid[id]

describe('M1: dates that do not exist are rejected when answered', () => {
  it('rejects 02/31, month 13 and far-off years; accepts a leap day', () => {
    const a = base(office)
    expect(invalid(a, 'project.target_start', '2027-02-31')).toMatch(/does not exist/)
    expect(invalid(a, 'project.target_start', '2027-13-45')).toMatch(/does not exist/)
    expect(invalid(a, 'project.required_finish', '9999-12-31')).toMatch(/between 1990 and 2100/)
    expect(invalid(a, 'project.target_start', '03/02/2027')).toMatch(/yyyy-mm-dd/)
    expect(invalid(a, 'project.target_start', '2028-02-29')).toBeUndefined()
    expect(invalid(a, 'project.required_finish', '2029-06-30')).toBeUndefined()
  })
})

describe('M2: number answers are finite and bounded', () => {
  it('rejects absurd story counts, non-finite numbers and thousands of withheld constraints', () => {
    const a = base(office)
    expect(invalid(a, 'project.stories', 3_000_000)).toBe('Must be 200 or less.')
    expect(invalid(a, 'project.stories', 'Infinity')).toBe('Enter a number.')
    expect(invalid(a, 'project.stories', '1e999')).toBe('Enter a number.')
    expect(invalid(a, 'project.gross_sqft', Number.NaN)).toBe('Enter a number.')
    expect(invalid(a, 'project.stories', 60)).toBeUndefined()
    expect(invalid(a, 'project.gross_sqft', 2_500_000)).toBeUndefined()
    const classified = base({ 'project.type': 'federal_defense', 'project.state': 'VA', 'security.classification': 'classified' })
    expect(invalid(classified, 'security.withheld_count', 20_000)).toBe('Must be 50 or less.')
    expect(invalid(classified, 'security.withheld_count', 3)).toBeUndefined()
  })
  it('still accepts a count above a planning cap (the plan says it is capped, see M8)', () => {
    expect(invalid(base({ 'project.type': 'highway_bridge', 'project.state': 'OH' }), 'civil.mot_phases', 6)).toBeUndefined()
  })
})

describe('M3: no contractual finish date reserves no contingency', () => {
  it('a fully answered plan without a required date has no contingency activity', () => {
    const { answers } = sampleProject('2026-10-04')
    const noDate = { ...answers }
    delete noDate['project.required_finish']
    const g = generateSchedule({ answers: noDate, today: '2026-10-04' })
    expect(g.activities.find(x => x.id === 'contingency')).toBeUndefined()
    // Still listed as not answered, with no buffer.
    expect(g.assumptions.find(x => x.questionId === 'project.required_finish')).toMatchObject({ bufferDays: 0 })
    const dontKnow = generateSchedule({ answers: { ...noDate, 'project.required_finish': { status: 'unknown', answeredAt: AT } }, today: '2026-10-04' })
    expect(dontKnow.activities.find(x => x.id === 'contingency')).toBeUndefined()
  })
  it('other unknowns still reserve contingency', () => {
    const { answers } = sampleProject('2026-10-04')
    const g = generateSchedule({ answers: { ...answers, 'project.gross_sqft': { status: 'unknown', answeredAt: AT } }, today: '2026-10-04' })
    expect(g.activities.find(x => x.id === 'contingency')!.duration).toBeGreaterThan(0)
  })
})

describe('M4: weather days on civil projects', () => {
  it('are not asked about (the answer had no effect), and the plan says none are added', () => {
    const bridge = base({ 'project.type': 'highway_bridge', 'project.state': 'WA', 'project.value_musd': 30 })
    expect(questionBank({ answers: bridge }).all.map(q => q.id)).not.toContain('calendar.weather')
    expect(questionBank({ answers: base({ ...office, 'project.state': 'WA' }) }).all.map(q => q.id)).toContain('calendar.weather')
    const g = gen(bridge)
    expect(g.activities.find(x => x.id === 'weather')).toBeUndefined()
    expect(g.notes!.join(' ')).toMatch(/Regional climate:.*No weather days are added/)
    expect(gen(base({ ...office, 'project.state': 'WA' })).notes!.join(' ')).not.toMatch(/No weather days are added/)
  })
})

describe('M5: installation added on a renovation for a default-scope item', () => {
  const reno = base({ 'project.type': 'commercial_office', 'project.state': 'TX', 'project.gross_sqft': 40000, 'project.stories': 2, 'project.scope': 'renovation' })
  it('is called an assumption, not something the interview said', () => {
    const g = gen(reno)
    const roof = g.activities.find(x => x.id === 'install-roofing')!
    expect(roof).toBeDefined()
    expect(roof.rationale.summary).not.toMatch(/The interview has/)
    expect(roof.rationale.summary).toMatch(/assumed to be in scope/)
    expect(roof.rationale.sources.some(s => s.kind === 'user')).toBe(false)
    expect(roof.rationale.sources.some(s => s.kind === 'assumption')).toBe(true)
  })
  it('is attributed to the interview once the question is answered', () => {
    const first = gen(reno)
    const item = first.links.find(l => l.to === 'install-roofing' && /^ll-.+-fab$/.test(l.from))!.from.replace(/^ll-(.+)-fab$/, '$1')
    const roof = gen({ ...reno, [`procure.${item}.status`]: k('not_released') }).activities.find(x => x.id === 'install-roofing')!
    expect(roof.rationale.summary).toMatch(/The interview has/)
    expect(roof.rationale.sources.some(s => s.kind === 'user')).toBe(true)
  })
})

describe('M6: US territories are inside the US', () => {
  const typed = (v: string) => ({ 'project.state': { ...k(v), custom: true } })
  it('Guam, Puerto Rico and the other territories are not treated as outside the US', () => {
    for (const v of ['Naval Base Guam', 'San Juan, Puerto Rico', 'Pago Pago, American Samoa', 'Saipan, Northern Mariana Islands', 'St. Croix, Virgin Islands']) expect(isOutsideUS(typed(v)), v).toBe(false)
    for (const v of ['Tortola, British Virgin Islands', 'Ontario, Canada', 'Dubai']) expect(isOutsideUS(typed(v)), v).toBe(true)
  })
  it('a base on Guam gets the federal question and US holidays', () => {
    const a = { ...base({ 'project.type': 'commercial_office', 'project.gross_sqft': 50000 }), ...typed('Naval Base Guam') }
    const ids = questionBank({ answers: a }).all.map(q => q.id)
    expect(ids).toContain('project.federal')
    expect(ids).toContain('calendar.holidays')
    expect(gen(a).calendars[0].holidays.length).toBeGreaterThan(0)
  })
})

describe('M7: milestone targets the plan cannot hold', () => {
  const tunnel = base({ 'project.type': 'marine_civil_works', 'project.state': 'WA', 'project.value_musd': 200, 'marine.scope': 'tunnel' })
  const landside = base({ 'project.type': 'aviation', 'project.state': 'TX', 'project.value_musd': 30, 'aviation.area': 'landside' })
  it('are not asked: a tunnel has no in-water work, landside work reopens no runway', () => {
    expect(questionBank({ answers: tunnel }).all.map(q => q.id)).not.toContain('milestone.cofferdam_removed.target')
    expect(questionBank({ answers: landside }).all.map(q => q.id)).not.toContain('milestone.airfield_reopen.target')
    expect(questionBank({ answers: { ...landside, 'aviation.area': k('airside') } }).all.map(q => q.id)).toContain('milestone.airfield_reopen.target')
    expect(questionBank({ answers: { ...tunnel, 'marine.scope': k('lock_dam') } }).all.map(q => q.id)).toContain('milestone.cofferdam_removed.target')
  })
  it('an answer already given is reported as not held, never dropped silently or pinned to other work', () => {
    const t = gen({ ...tunnel, 'milestone.cofferdam_removed.target': k('2028-06-30') })
    expect(t.milestoneTargets!.some(m => m.key === 'cofferdam_removed')).toBe(false)
    expect(t.assumptions.find(x => x.questionId === 'milestone.cofferdam_removed.target')!.text).toMatch(/In-water work complete.*06\/30\/2028 is not held/)
    const l = gen({ ...landside, 'milestone.airfield_reopen.target': k('2027-09-30') })
    expect(l.activities.some(x => x.constraint?.type === 'FNLT' && x.constraint.date === '2027-09-30')).toBe(false)
    expect(l.assumptions.find(x => x.questionId === 'milestone.airfield_reopen.target')!.text).toMatch(/is not held/)
  })
  it('a target the plan can hold is still held, with no such note', () => {
    const g = gen({ ...landside, 'aviation.area': k('airside'), 'milestone.airfield_reopen.target': k('2028-09-30') })
    expect(g.milestoneTargets!.some(m => m.key === 'airfield_reopen')).toBe(true)
    expect(g.assumptions.some(x => x.questionId === 'milestone.airfield_reopen.target')).toBe(false)
  })
})

describe('M8: counts above the planning cap are said', () => {
  const cases: [string, Record<string, AnswerValue>, string][] = [
    ['civil.mot_phases', { 'project.type': 'highway_bridge', 'project.state': 'OH', 'project.value_musd': 30, 'civil.mot_phases': 6 }, '6 maintenance-of-traffic stages'],
    ['civil.utility_owners', { 'project.type': 'highway_bridge', 'project.state': 'OH', 'project.value_musd': 30, 'civil.utilities': 'by_others', 'civil.utility_owners': 15 }, '15 utility owners'],
    ['transit.stations', { 'project.type': 'transit_rail', 'project.state': 'CA', 'project.value_musd': 300, 'transit.stations': 25 }, '25 stations'],
    ['epc.hydrotest_systems', { 'project.type': 'epc_industrial', 'project.state': 'TX', 'project.value_musd': 300, 'epc.hydrotest_systems': 9 }, '9 test systems'],
  ]
  for (const [qid, answers, said] of cases) {
    it(`${qid} above its cap adds an assumption and a note`, () => {
      const g = gen(base(answers))
      expect(g.assumptions.find(x => x.questionId === qid && x.kind === 'inferred')!.text).toContain(said)
      expect(g.notes!.join(' ')).toMatch(/capped at \d+ \(you answered \d+\)/)
    })
  }
  it('a count within the cap adds nothing, and the caps match what the plan builds', () => {
    const g = gen(base({ 'project.type': 'highway_bridge', 'project.state': 'OH', 'project.value_musd': 30, 'civil.mot_phases': 3 }))
    expect(g.assumptions.some(x => x.questionId === 'civil.mot_phases')).toBe(false)
    expect(g.notes!.join(' ')).not.toMatch(/capped at/)
    const opt = { 'civil.mot_phases': 'motStages', 'civil.utility_owners': 'utilityOwners', 'transit.stations': 'stations', 'epc.hydrotest_systems': 'hydrotestSystems' } as const
    for (const cap of CIVIL_COUNT_CAPS) {
      const o = civilOptionsFrom(cap.type, { [cap.questionId]: k(9999) })
      expect(o[opt[cap.questionId as keyof typeof opt]], cap.questionId).toBe(cap.max)
    }
  })
})

describe('M9: a stage percentage in a document is not the whole design', () => {
  const pct = (text: string) => rulesPrefill([{ page: 1, text }]).find(p => p.questionId === 'design.percent')
  it('100% schematic design is 30% overall and 100% DD is 60%', () => {
    expect(pct('The design is at 100% schematic design and a drawing list is attached.')).toMatchObject({ value: 30 })
    expect(pct('The drawings issued with this request are 100% DD for the building.')).toMatchObject({ value: 60 })
    expect(pct('The architect has issued 50% design development drawings for pricing.')).toMatchObject({ value: 45 })
    expect(pct('The design is at 100% schematic design and a drawing list is attached.')!.display).toMatch(/30% overall \(100% schematic design\)/)
  })
  it('construction documents and plain design percentages are unchanged', () => {
    expect(pct('The design is at 95% construction documents; a drawing list is attached.')).toMatchObject({ value: 95, display: '95%' })
    expect(pct('The project is at 60% design at the time of this solicitation.')).toMatchObject({ value: 60 })
  })
})

describe('M10: winter shutdown calendar without holidays', () => {
  it('covers the years of the project, not 2025 to 2034', () => {
    const g = gen(base({ 'project.type': 'highway_bridge', 'project.state': 'MN', 'project.value_musd': 30, 'project.target_start': '2036-03-03', 'calendar.holidays': false }))
    const season = g.calendars.find(c => c.id === 'cal-season')!
    expect(season).toBeDefined()
    expect(season.holidays).toContain('2037-01-15')
    expect(season.holidays).toContain('2038-12-15')
    // No paving, striping or seeding activity is worked in the shutdown.
    for (const a of g.activities.filter(x => x.calendarId === 'cal-season' && x.type === 'task')) {
      const t = g.cpm!.times[a.id]
      for (const d of [t.earlyStart, t.earlyFinish]) expect(/-(12|01|02|03)-/.test(d), `${a.name} ${d}`).toBe(false)
    }
  })
})
