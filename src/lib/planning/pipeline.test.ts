import { describe, expect, it } from 'vitest'
import type { Answer, AnswerValue, GeneratedSchedule } from './types'
import { PROJECT_TYPES } from './types'
import { elicit, questionBank, validateAnswer, coerceAnswer } from './elicitation'
import { generateSchedule } from './generator'
import { applyEdit, EditError } from './overrides'
import { evaluatePlan, backtest } from './evaluation'
import { computeFirmHistory } from './history'
import { redactedBrief, validateSuggestions } from './ai-questions'
import { runDcma } from '@/lib/analysis/dcma'
import { toAnalyzable } from './evaluation'
import type { HistoryRow } from '@/lib/db'

const AT = '2026-01-01T00:00:00.000Z'
const k = (value: AnswerValue): Answer => ({ status: 'known', value, answeredAt: AT })
const unknown: Answer = { status: 'unknown', answeredAt: AT }
const withheld: Answer = { status: 'withheld', answeredAt: AT }

function healthcareCA(): Record<string, Answer> {
  return {
    'project.type': k('healthcare'), 'project.state': k('CA'), 'project.city': k('Sacramento'),
    'project.scope': k('new_construction'), 'project.gross_sqft': k(120000), 'project.stories': k(4),
    'project.target_start': k('2026-03-02'), 'project.delivery': k('dbb'), 'project.federal': k(false),
    'design.drawings': k(true), 'design.percent': k(60), 'calendar.workweek': k('5x8'),
  }
}

function checkNetwork(g: GeneratedSchedule) {
  const ids = new Set(g.activities.map(a => a.id))
  const hasPred = new Set(g.links.map(l => l.to))
  const hasSucc = new Set(g.links.map(l => l.from))
  for (const l of g.links) { expect(ids.has(l.from)).toBe(true); expect(ids.has(l.to)).toBe(true) }
  const opens = g.activities.filter(a => a.category !== 'ntp' && !hasPred.has(a.id))
  const ends = g.activities.filter(a => !hasSucc.has(a.id))
  expect(opens.map(a => a.name)).toEqual([])
  expect(ends.length).toBe(1)
  expect(g.cpm!.cycles).toEqual([])
  expect(new Set(g.activities.map(a => a.code)).size).toBe(g.activities.length)
  for (const a of g.activities) {
    expect(a.rationale.summary.length).toBeGreaterThan(10)
    expect(a.rationale.sources.length).toBeGreaterThan(0)
  }
  for (const l of g.links) expect(l.rationale.summary.length).toBeGreaterThan(5)
}

describe('elicitation', () => {
  it('asks the highest-impact question first and knows nothing at the start', () => {
    const r = elicit({ answers: {} })
    expect(r.questions[0].id).toBe('project.type')
    expect(r.readiness).toBe(0)
  })

  it('pulls jurisdiction-specific permits once type and region are known', () => {
    const r = elicit({ answers: healthcareCA() })
    const permitQs = r.questions.filter(q => q.section === 'permits')
    expect(permitQs.length).toBeGreaterThan(2)
    expect(permitQs.some(q => /HCAI/i.test(q.prompt))).toBe(true)
    for (const q of permitQs) expect(q.groundedBy?.[0].kind).toBe('catalog')
    const ll = r.questions.filter(q => q.section === 'procurement')
    expect(ll.some(q => /generator/i.test(q.prompt))).toBe(true)
  })

  it('asks follow-ups that depend on earlier answers', () => {
    const noDrawings = questionBank({ answers: { 'design.drawings': k(false) } }).all.map(q => q.id)
    expect(noDrawings).not.toContain('design.percent')
    const withDrawings = questionBank({ answers: { 'design.drawings': k(true) } }).all.map(q => q.id)
    expect(withDrawings).toContain('design.percent')
    const a = healthcareCA()
    const bank = questionBank({ answers: a }).all
    const pq = bank.find(q => q.id.startsWith('permit.') && q.id.endsWith('.status'))!
    const pid = pq.id.split('.')[1]
    a[pq.id] = k('submitted')
    expect(questionBank({ answers: a }).all.map(q => q.id)).toContain(`permit.${pid}.expected`)
  })

  it('turns unknown and withheld answers into explicit assumptions with buffers', () => {
    const a = { ...healthcareCA(), 'project.gross_sqft': unknown, 'project.city': withheld }
    const r = elicit({ answers: a })
    expect(r.assumptions.find(x => x.questionId === 'project.gross_sqft')?.bufferDays).toBeGreaterThan(0)
    expect(r.assumptions.find(x => x.questionId === 'project.city')?.kind).toBe('withheld')
    expect(r.readiness).toBeGreaterThan(0)
    expect(r.readiness).toBeLessThan(100)
  })

  it('flags classified work pointed at a cloud model and contradictory answers', () => {
    const a = { 'project.type': k('federal_defense'), 'security.classification': k('classified'), 'design.drawings': k(false) }
    expect(elicit({ answers: a }, { aiMode: 'cloud' }).conflicts.join(' ')).toMatch(/air-gapped/)
    expect(elicit({ answers: a }, { aiMode: 'local' }).conflicts.join(' ')).not.toMatch(/air-gapped/)
    const bad = { 'project.gross_sqft': k(3000), 'project.stories': k(10) }
    expect(elicit({ answers: bad }).conflicts.join(' ')).toMatch(/1,500 sf per floor/)
  })

  it('validates and coerces answers by kind', () => {
    const bank = questionBank({ answers: { 'design.drawings': k(true) } }).all
    const pct = bank.find(q => q.id === 'design.percent')!
    expect(validateAnswer(pct, coerceAnswer(pct, k('150')))).toMatch(/0 and 100/)
    expect(validateAnswer(pct, coerceAnswer(pct, k('60')))).toBeNull()
    const type = bank.find(q => q.id === 'project.type')!
    expect(validateAnswer(type, withheld)).toMatch(/cannot be withheld/)
    // Anything not listed can be typed in; it is kept verbatim and flagged.
    const spaceport = coerceAnswer(type, k('Spaceport launch facility'))
    expect(validateAnswer(type, spaceport)).toBeNull()
    expect(spaceport.custom).toBe(true)
    expect(validateAnswer(type, coerceAnswer(type, k('x')))).toMatch(/type your own/)
  })

  it('lists all 50 states + DC and accepts a typed location outside the list', () => {
    const state = questionBank({ answers: {} }).all.find(q => q.id === 'project.state')!
    expect(state.options).toHaveLength(51)
    expect(state.allowOther).toBe(true)
    expect(state.otherPrompt).toMatch(/country and state or location/)
    const va = coerceAnswer(state, k('virginia'))
    expect(va).toMatchObject({ value: 'VA' })
    expect(va.custom).toBeUndefined()
    const abroad = coerceAnswer(state, k('Ontario, Canada'))
    expect(abroad.custom).toBe(true)
    const r = elicit({ answers: { 'project.type': k('data_center'), 'project.state': abroad } })
    expect(r.profile.state).toBeUndefined()
    const a = r.assumptions.find(x => x.questionId === 'project.state')!
    expect(a.kind).toBe('custom')
    expect(a.text).toMatch(/Ontario, Canada/)
    // Every choice question offers "Other".
    for (const q of questionBank({ answers: healthcareCA() }).all.filter(x => x.kind === 'choice')) expect(q.allowOther).toBe(true)
  })

  it('generates with custom answers and records how they were interpreted', () => {
    const a = { ...healthcareCA(), 'project.state': { ...k('Alberta, Canada'), custom: true }, 'calendar.workweek': { ...k('5 x 9h'), custom: true } }
    const g = generateSchedule({ answers: a, today: '2026-01-15' })
    checkNetwork(g)
    expect(g.assumptions.filter(x => x.kind === 'custom').map(x => x.questionId).sort()).toEqual(['calendar.workweek', 'project.state'])
  })
})

describe('generator', () => {
  it('builds a closed, acyclic, fully explained network for a CA hospital', () => {
    const g = generateSchedule({ answers: healthcareCA(), today: '2026-01-15' })
    checkNetwork(g)
    const hcai = g.activities.find(a => a.id.startsWith('permit-') && /HCAI/.test(a.name) && !a.id.endsWith('-submit'))!
    expect(hcai).toBeDefined()
    expect(hcai.calendarId).toBe('cal-7d')
    // Permit gates construction: the permit must drive something in the field.
    expect(g.links.some(l => l.from === hcai.id)).toBe(true)
    // Design is 60% → SD is done, DD done, CD partially remains.
    expect(g.activities.some(a => a.category === 'design_sd')).toBe(false)
    expect(g.activities.some(a => a.category === 'design_cd')).toBe(true)
    // Long-lead chain: submittal → fabricate → installation
    const fab = g.activities.filter(a => a.id.endsWith('-fab'))
    expect(fab.length).toBeGreaterThan(3)
    const years = (Date.parse(g.cpm!.projectFinish) - Date.parse(g.projectStart)) / (365 * 86_400_000)
    expect(years).toBeGreaterThan(1.5)
    expect(years).toBeLessThan(5)
    const dcma = runDcma(toAnalyzable(g))
    expect(dcma.checks.find(c => c.id === 1)!.result).toBe('pass')
    expect(dcma.checks.find(c => c.id === 2)!.result).toBe('pass')
  })

  it('uses committed dates and issued permits instead of catalog defaults', () => {
    const a = healthcareCA()
    const bank = questionBank({ answers: a })
    for (const pm of bank.permits) a[`permit.${pm.id}.status`] = k('issued')
    const gen = bank.longLead.find(l => /generator/i.test(l.name))!
    a[`procure.${gen.id}.status`] = k('released')
    a[`procure.${gen.id}.delivery`] = k('2026-11-02')
    const g = generateSchedule({ answers: a, today: '2026-01-15' })
    expect(g.activities.some(x => x.category.startsWith('permit'))).toBe(false)
    const del = g.activities.find(x => x.id === `ll-${gen.id}-delivered`)!
    expect(del.constraint).toEqual({ type: 'SNET', date: '2026-11-02' })
    expect(g.cpm!.times[del.id].earlyStart >= '2026-11-02').toBe(true)
    expect(g.assumptions.some(x => x.kind === 'inferred' && /already issued/.test(x.text))).toBe(true)
  })

  it('plans around withheld classified constraints without their details', () => {
    const a: Record<string, Answer> = {
      'project.type': k('federal_defense'), 'project.state': k('VA'), 'project.gross_sqft': k(60000), 'project.stories': k(2),
      'project.scope': k('new_construction'), 'project.target_start': k('2026-04-06'), 'design.drawings': k(true), 'design.percent': k(100),
      'security.classification': k('classified'), 'security.withheld_count': k(2), 'security.withheld_days': k(30),
    }
    const g = generateSchedule({ answers: a, today: '2026-01-15' })
    checkNetwork(g)
    const ph = g.activities.filter(x => x.placeholder)
    expect(ph).toHaveLength(2)
    expect(ph.every(x => x.duration === 15)).toBe(true)
    expect(ph[0].rationale.summary).toMatch(/classified/)
    expect(g.activities.some(x => /SCIF|accreditation/i.test(x.name))).toBe(true)
    // The model-facing brief never contains withheld values.
    const brief = redactedBrief({ ...a, 'project.city': { status: 'withheld', value: 'Fort Secret', answeredAt: AT } }, questionBank({ answers: a }).all)
    expect(brief).not.toMatch(/Fort Secret/)
    expect(brief).toMatch(/1 answers withheld/)
  })

  it('adds an explicit contingency for unknowns instead of padding durations', () => {
    const a = { ...healthcareCA(), 'project.gross_sqft': unknown }
    const g = generateSchedule({ answers: a, today: '2026-01-15' })
    const c = g.activities.find(x => x.id === 'contingency')!
    expect(c.duration).toBeGreaterThan(0)
    expect(c.rationale.assumptions!.join(' ')).toMatch(/gross building area/)
  })

  it('scales durations for 10-hour days', () => {
    const base = generateSchedule({ answers: healthcareCA(), today: '2026-01-15' })
    const ten = generateSchedule({ answers: { ...healthcareCA(), 'calendar.workweek': k('5x10') }, today: '2026-01-15' })
    const d8 = base.activities.find(a => a.category === 'finishes')!.duration
    const d10 = ten.activities.find(a => a.category === 'finishes')!.duration
    expect(d10).toBeLessThan(d8)
  })
})

describe('generator sweep: every facility type yields a sound network', () => {
  const configs = [
    { state: 'CA', sf: 120000, stories: 4, pct: 60, scope: 'new_construction' },
    { state: 'TX', sf: 40000, stories: 1, pct: 100, scope: 'new_construction' },
    { state: 'NY', sf: 300000, stories: 12, pct: 0, scope: 'new_construction' },
    { state: 'WA', sf: 60000, stories: 3, pct: 90, scope: 'renovation_occupied' },
  ]
  for (const t of PROJECT_TYPES) {
    for (const c of configs) {
      it(`${t} ${c.state} ${c.sf}sf ${c.scope}`, () => {
        const a: Record<string, Answer> = {
          'project.type': k(t), 'project.state': k(c.state), 'project.scope': k(c.scope), 'project.gross_sqft': k(c.sf),
          'project.stories': k(c.stories), 'project.target_start': k('2026-03-02'), 'design.drawings': k(c.pct > 0),
          'design.percent': k(c.pct), 'project.federal': k(t === 'federal_defense'),
        }
        const g = generateSchedule({ answers: a, today: '2026-01-15' })
        checkNetwork(g)
        const d = runDcma(toAnalyzable(g))
        for (const id of [1, 2, 3, 4, 5, 7, 9, 12]) expect(`#${id} ${d.checks.find(x => x.id === id)!.result}`).toBe(`#${id} pass`)
        // Field work is detailed to ≤44 work days.
        for (const x of g.activities) if (x.calendarId === 'cal-field' && x.type === 'task' && x.phase !== 'design' && x.category !== 'contingency' && !x.placeholder) expect(x.duration).toBeLessThanOrEqual(44)
        const months = (Date.parse(g.cpm!.projectFinish) - Date.parse(g.projectStart)) / (30.4 * 86_400_000)
        expect(months).toBeGreaterThan(8)
        expect(months).toBeLessThan(60)
      })
    }
  }
})

describe('overrides (human in control)', () => {
  const g0 = generateSchedule({ answers: healthcareCA(), today: '2026-01-15' })
  const crit = g0.activities.find(a => a.type === 'task' && g0.cpm!.times[a.id].critical && a.calendarId === 'cal-field')!

  it('requires a reason and reports the impact on the finish', () => {
    expect(() => applyEdit(g0, { kind: 'duration', activityId: crit.id, value: crit.duration + 20, reason: '' }, 'Ana')).toThrow(EditError)
    const { schedule, impact } = applyEdit(g0, { kind: 'duration', activityId: crit.id, value: crit.duration + 20, reason: 'Sub has one crew' }, 'Ana')
    expect(impact.finishDeltaDays).toBeGreaterThan(20)
    const a = schedule.activities.find(x => x.id === crit.id)!
    expect(a.overrides![0]).toMatchObject({ field: 'duration', from: crit.duration, to: crit.duration + 20, by: 'Ana', reason: 'Sub has one crew' })
    expect(a.rationale.summary).toMatch(/Overridden by Ana/)
    expect(a.rationale.sources[0].kind).toBe('override')
  })

  it('lets the scheduler add missing work, which survives regeneration', () => {
    const after = g0.activities.find(a => a.category === 'finishes')!
    const { schedule, impact } = applyEdit(g0, { kind: 'add_activity', name: 'Owner kitchen equipment install', duration: 30, after: after.id, reason: 'Owner scope added late' }, 'Ana')
    const added = schedule.activities.find(a => a.name === 'Owner kitchen equipment install')!
    expect(added.id.startsWith('user:act:')).toBe(true)
    expect(added.rationale.summary).toMatch(/Added by Ana/)
    checkNetwork(schedule)
    expect(impact.finishAfter >= impact.finishBefore).toBe(true)
    const again = generateSchedule({ answers: healthcareCA(), previous: schedule, today: '2026-01-15' })
    expect(again.activities.some(a => a.id === added.id)).toBe(true)
    checkNetwork(again)
    expect(() => applyEdit(g0, { kind: 'add_activity', name: '', duration: 3, after: after.id, reason: 'x y z' }, 'Ana')).toThrow(/name/)
  })

  it('rejects logic loops', () => {
    const fin = g0.activities.find(a => a.category === 'final_completion')!
    const ntp = g0.activities.find(a => a.category === 'ntp')!
    expect(() => applyEdit(g0, { kind: 'add_link', from: fin.id, to: ntp.id, type: 'FS', lag: 0, reason: 'test' }, 'Ana')).toThrow(/loop/)
  })

  it('keeps overrides and deletions when the schedule is regenerated', () => {
    let s = applyEdit(g0, { kind: 'duration', activityId: crit.id, value: 99, reason: 'Owner-directed' }, 'Ana').schedule
    const victim = s.activities.find(a => a.category === 'specialties' || a.category === 'paving_landscape')!
    s = applyEdit(s, { kind: 'remove_activity', activityId: victim.id, reason: 'By others' }, 'Ana').schedule
    expect(s.activities.some(a => a.id === victim.id)).toBe(false)
    checkNetwork(s)
    const again = generateSchedule({ answers: healthcareCA(), previous: s, today: '2026-01-15' })
    expect(again.activities.find(a => a.id === crit.id)!.duration).toBe(99)
    expect(again.activities.some(a => a.id === victim.id)).toBe(false)
    checkNetwork(again)
  })
})

describe('evaluation', () => {
  // Synthetic firm history: 3 healthcare projects whose finishes ran ~30% longer than planned.
  const rows: HistoryRow[] = []
  const cats = ['foundations', 'framing_drywall', 'finishes', 'mep_rough', 'commissioning']
  ;['p1', 'p2', 'p3'].forEach((sid, i) => {
    cats.forEach((cat, j) => {
      const start = `2023-0${j + 1}-02`
      const plannedEnd = `2023-0${j + 2}-02`
      const actualEnd = `2023-0${j + 2}-${String(12 + i * 2).padStart(2, '0')}`
      rows.push({ scheduleId: sid, projectType: 'healthcare', region: 'CA', grossSqft: 100000, category: cat, name: cat, calendarId: null, duration: 22, baselineStart: start, baselineFinish: plannedEnd, actualStart: start, actualFinish: actualEnd })
    })
  })
  const history = computeFirmHistory(rows, {}, 'healthcare')

  it('computes private firm statistics', () => {
    expect(history.projectCount).toBe(3)
    expect(history.byCategory.finishes!.projects).toBe(3)
    expect(history.overallOverrunMedian!).toBeGreaterThan(1.2)
  })

  it('grounds durations in firm actuals and scores the plan', () => {
    const answers = { ...healthcareCA(), 'history.use': k(true) }
    const g = generateSchedule({ answers, history, today: '2026-01-15' })
    const fin = g.activities.find(a => a.category === 'finishes')!
    expect(fin.rationale.sources.some(s => s.kind === 'firm_history')).toBe(true)
    const ev = evaluatePlan(g, answers, history, [])
    expect(ev.benchmark.rows.length).toBeGreaterThan(0)
    expect(ev.forecast.p80 >= ev.forecast.p50).toBe(true)
    expect(ev.forecast.p50 >= ev.forecast.deterministic).toBe(true)
    expect(ev.coverage.every(c => c.status !== 'missing')).toBe(true)
    expect(ev.review.status).toBe('none')
    expect(['A', 'B', 'C', 'D']).toContain(ev.grade)
    const reviewed = evaluatePlan(g, answers, history, [{ id: 'r', reviewer: 'Sr', verdict: 'approve', comment: '', at: new Date(Date.now() + 1000).toISOString() }])
    expect(reviewed.review.status).toBe('approved')
    expect(reviewed.score).toBeGreaterThan(ev.score)
  })

  it('flags durations shorter than the firm has ever achieved', () => {
    const answers = healthcareCA()
    const g = generateSchedule({ answers, history: null, today: '2026-01-15' })
    // Shrink every segment of the finishes package to 1 day.
    let edited = g
    for (const seg of g.activities.filter(a => a.category === 'finishes')) edited = applyEdit(edited, { kind: 'duration', activityId: seg.id, value: 1, reason: 'aggressive' }, 'Ana').schedule
    const fin = g.activities.find(a => a.category === 'finishes')!
    const ev = evaluatePlan(edited, answers, history, [])
    expect(ev.benchmark.rows.find(r => r.activityId === fin.id.split('#')[0])!.verdict).toBe('optimistic')
    expect(ev.findings.join(' ')).toMatch(/shorter than 80%/)
  })

  it('backtests leave-one-out against completed projects', () => {
    const bt = backtest([
      { scheduleId: 'p1', name: 'P1', projectType: 'healthcare', state: 'CA', grossSqft: 100000 },
      { scheduleId: 'p2', name: 'P2', projectType: 'healthcare', state: 'CA', grossSqft: 100000 },
      { scheduleId: 'px', name: 'Untagged', projectType: null, state: null, grossSqft: null },
    ], rows, {})
    expect(bt.projects).toHaveLength(2)
    expect(bt.mape).not.toBeNull()
    expect(bt.skipped[0].reason).toMatch(/not tagged/)
  })
})

describe('AI suggestions are validated', () => {
  it('accepts well-formed items, drops repeats and junk, caps at three', () => {
    const existing = questionBank({ answers: {} }).all
    const out = validateSuggestions([
      { question: existing[0].prompt, why: 'dup of an existing question' },
      { question: 'Is there a tower crane restriction from the adjacent hospital helipad?', why: 'Crane restrictions change steel erection sequence', section: 'site' },
      { question: 'x', why: 'too short' },
      { question: 'Will the owner phase move-in by department?', why: 'Phased occupancy splits commissioning and closeout', section: 'weird' },
    ], existing)
    expect(out).toHaveLength(2)
    expect(out[1].section).toBe('project')
    expect(out.every(q => q.id.startsWith('ai.'))).toBe(true)
    expect(() => validateSuggestions({ not: 'array' }, existing)).toThrow()
  })
})
