// Plan-generation bugs reported by pilot testers (round 2). One block per report.
import { describe, expect, it } from 'vitest'
import type { Answer, AnswerValue, GeneratedSchedule } from './types'
import { PROJECT_TYPES, projectTypeError } from './types'
import { applyAnswers, questionBank } from './elicitation'
import { generateSchedule } from './generator'
import { projectBrief } from '@/lib/analysis/brief'
import { buildWbs } from '@/lib/export/wbs'
import type { Activity, Schedule } from '@/lib/db'

const AT = '2026-01-01T00:00:00.000Z'
const TODAY = '2026-01-15'
const k = (value: AnswerValue): Answer => ({ status: 'known', value, answeredAt: AT })
const civil = (type: string, extra: Record<string, Answer> = {}): Record<string, Answer> => ({
  'project.type': k(type), 'project.state': k('IL'), 'project.scope': k('new_construction'), 'project.value_musd': k(60),
  'project.target_start': k('2026-03-02'), 'project.delivery': k('db'), 'design.drawings': k(true), 'design.percent': k(100), ...extra,
})
const building = (type: string, extra: Record<string, Answer> = {}): Record<string, Answer> => ({
  'project.type': k(type), 'project.state': k('TX'), 'project.scope': k('new_construction'), 'project.gross_sqft': k(120000), 'project.stories': k(3),
  'project.target_start': k('2026-03-02'), 'project.federal': k(false), 'design.drawings': k(true), 'design.percent': k(100), ...extra,
})
const gen = (answers: Record<string, Answer>) => generateSchedule({ answers, today: TODAY })
const cats = (g: GeneratedSchedule) => new Set(g.activities.map(a => a.category))
const names = (g: GeneratedSchedule) => g.activities.map(a => a.name.toLowerCase()).join(' | ')
const outOfScope = (...ids: string[]) => Object.fromEntries(ids.map(id => [`procure.${id}.status`, k('not_in_scope')]))
/** Every activity except the final milestone has a successor, and every one but NTP a predecessor. */
function expectClosed(g: GeneratedSchedule) {
  const from = new Set(g.links.map(l => l.from)), to = new Set(g.links.map(l => l.to))
  const finalId = g.activities.find(a => a.category === 'final_completion')!.id
  for (const a of g.activities) {
    if (a.id !== finalId) expect(from.has(a.id), `${a.name} has no successor`).toBe(true)
    if (a.id !== 'ntp') expect(to.has(a.id), `${a.name} has no predecessor`).toBe(true)
  }
}

describe('1. "Not in scope" removes installation work, civil categories included', () => {
  it('transit: special trackwork and traction power not in scope → no track or traction power work', () => {
    const base = civil('transit_rail')
    const before = gen(base)
    expect(cats(before).has('track_systems')).toBe(true)
    expect(names(before)).toMatch(/traction power/)
    const g = gen({ ...base, ...outOfScope('civ-special-trackwork', 'civ-traction-power') })
    expect(cats(g).has('track_systems')).toBe(false)
    expect(names(g)).not.toMatch(/traction power|overhead contact/)
    // MV switchgear is still in scope: its installation remains, named for what it is.
    expect(g.activities.find(a => a.category === 'power_equipment' && a.id.startsWith('t-'))?.name).toMatch(/^Install medium-voltage switchgear/)
    expect(g.assumptions.some(a => /Track & rail systems removed/.test(a.text))).toBe(true)
    expectClosed(g)
  })
  it.each([
    ['water_wastewater', ['civ-large-pumps', 'civ-process-valves', 'civ-treatment-equipment'], 'process_equipment'],
    ['industrial_process', ['civ-process-vessels', 'civ-rotating-equipment'], 'process_equipment'],
    ['highway_bridge', ['civ-steel-girders', 'civ-precast-girders', 'civ-bearings'], 'superstructure'],
    ['utility_power', ['civ-relay-panels'], 'controls_scada'],
    ['utility_power', ['civ-power-transformer', 'civ-hv-breakers'], 'power_equipment'],
  ] as const)('%s: %j not in scope → no %s work', (type, items, cat) => {
    expect(cats(gen(civil(type))).has(cat)).toBe(true)
    const g = gen({ ...civil(type), ...outOfScope(...items) })
    expect(cats(g).has(cat)).toBe(false)
    expectClosed(g)
  })
  it('bridge: only the girder type not used is out → girder erection stays', () => {
    const g = gen({ ...civil('highway_bridge'), ...outOfScope('civ-steel-girders') })
    expect(cats(g).has('superstructure')).toBe(true)
  })
  it('elevators "not_in_scope" through the PATCH path (answers in any order) → no elevator work', () => {
    const start = building('commercial_office', { 'project.stories': k(1) })
    // Sent before the story count that makes the question exist (the UI's batch order).
    const r = applyAnswers(start, { 'procure.elevators.status': { value: 'not_in_scope' }, 'project.stories': { value: '4' } }, {}, AT)
    expect(r.errors).toEqual({})
    expect(r.invalid).toEqual({})
    expect(r.answers['procure.elevators.status'].value).toBe('not_in_scope')
    const g = gen(r.answers)
    expect(cats(g).has('elevators')).toBe(false)
    expect(names(g)).not.toMatch(/elevator installation|elevators \(traction/)
    expectClosed(g)
    // The label typed instead of the value maps to the same option.
    expect(applyAnswers(r.answers, { 'procure.elevators.status': { value: 'Not in scope' } }, {}, AT).answers['procure.elevators.status'].value).toBe('not_in_scope')
  })
  it('retail: elevators out but escalators in → the activity installs escalators only', () => {
    const g = gen({ ...building('retail'), ...outOfScope('elevators') })
    const acts = g.activities.filter(a => a.category === 'elevators')
    expect(acts.length).toBeGreaterThan(0)
    for (const a of acts) expect(a.name).toMatch(/^Install escalators/)
    expect(names(gen({ ...building('retail'), ...outOfScope('elevators', 'escalators') }))).not.toMatch(/elevator installation|escalators/)
  })
})

describe('2. Interview answers are validated (PATCH /api/plans/[id])', () => {
  const office = building('retail')
  it('rejects an option that is not listed and names the valid ones', () => {
    const r = applyAnswers(office, { 'procure.escalators.status': { value: 'not_required' } }, {}, AT)
    expect(r.invalid['procure.escalators.status']).toBe('“not_required” is not a valid answer. Valid options: not_released, released, owner_furnished, not_in_scope.')
    expect(r.answers['procure.escalators.status']).toBeUndefined()
    const pm = questionBank({ answers: office }).permits[0]
    expect(applyAnswers(office, { [`permit.${pm.id}.status`]: { value: 'waived' } }, {}, AT).invalid[`permit.${pm.id}.status`]).toMatch(/Valid options: issued, submitted, not_submitted, not_required/)
  })
  it('accepts yes/no in the forms clients send and stores real booleans', () => {
    for (const [sent, stored] of [[true, true], ['false', false], ['Yes', true], ['NO', false], [0, false]] as const) {
      const r = applyAnswers({ 'project.type': k('commercial_office') }, { 'design.drawings': { value: sent as AnswerValue } }, {}, AT)
      expect(r.invalid).toEqual({})
      expect(r.answers['design.drawings'].value).toBe(stored)
    }
    expect(applyAnswers({}, { 'design.drawings': { value: 'maybe' } }, {}, AT).invalid['design.drawings']).toMatch(/yes or no/)
    // A legacy string "false" still turns holidays off.
    const g = gen({ ...building('commercial_office'), 'calendar.holidays': { ...k('false') } })
    expect(g.calendars[0].holidays).toEqual([])
  })
  it('accepts history.use when the firm has no history yet (a no-op preference)', () => {
    const r = applyAnswers(office, { 'history.use': { value: true } }, {}, AT)
    expect(r.errors).toEqual({})
    expect(r.answers['history.use'].value).toBe(true)
    expect(applyAnswers(office, { 'history.use': { value: 'sometimes' } }, {}, AT).invalid['history.use']).toMatch(/yes or no/)
  })
  it('still reports questions that do not exist', () => {
    expect(applyAnswers(office, { 'procure.flux-capacitor.status': { value: 'released' } }, {}, AT).errors['procure.flux-capacitor.status']).toMatch(/Unknown/)
  })
})

describe('3. Unknown project types are refused', () => {
  it('names every valid type', () => {
    expect(projectTypeError('spaceport')).toBe(`Unknown projectType “spaceport”. Valid types: ${PROJECT_TYPES.join(', ')}.`)
    expect(projectTypeError(42)).toMatch(/Unknown projectType/)
    for (const t of PROJECT_TYPES) expect(projectTypeError(t)).toBeNull()
    expect(projectTypeError(undefined)).toBeNull()
    expect(projectTypeError('')).toBeNull()
  })
  it('the interview rejects a typed facility type instead of planning a generic building', () => {
    const r = applyAnswers({}, { 'project.type': { value: 'Spaceport launch facility' } }, {}, AT)
    expect(r.invalid['project.type']).toMatch(/Valid options: commercial_office, healthcare, data_center/)
    expect(r.answers['project.type']).toBeUndefined()
  })
})

describe('4. Civil projects are described in civil terms', () => {
  const asDb = (g: GeneratedSchedule): Activity[] => g.activities.map(a => ({
    id: a.id, scheduleId: 's', activityId: a.code, name: a.name, wbs: '', duration: a.duration, remainingDuration: a.duration, percentComplete: 0,
    earlyStart: g.cpm!.times[a.id].earlyStart, earlyFinish: g.cpm!.times[a.id].earlyFinish, lateStart: null, lateFinish: null, actualStart: null, actualFinish: null,
    baselineStart: null, baselineFinish: null, totalFloat: g.cpm!.times[a.id].totalFloat, freeFloat: 0, isCritical: g.cpm!.times[a.id].critical,
    status: 'not_started', activityType: a.type, category: a.category,
  }))
  const schedule = (g: GeneratedSchedule, type: string | null) => ({ name: 'Line 3', projectType: type, region: 'IL', grossSqft: null, projectStart: g.projectStart, projectFinish: g.cpm!.projectFinish, dataDate: null } as unknown as Schedule)
  it.each(['highway_bridge', 'transit_rail', 'water_wastewater', 'utility_power', 'industrial_process'])('%s brief and WBS use civil phase names', (type) => {
    const g = gen(civil(type))
    const brief = projectBrief(schedule(g, type), asDb(g), { type, valueMusd: 60 })
    const text = `${brief.summary} ${brief.scope.join(' ')} ${brief.text}`
    expect(text).not.toMatch(/MEP|Interiors|Building|Envelope|\bsf\b/i)
    expect(brief.facts.find(f => f.label === 'Construction value')?.value).toBe('$60M')
    const wbs = buildWbs(g, 'Line 3').nodes.map(n => n.name).join(' | ')
    expect(wbs).not.toMatch(/MEP|Interiors|Building/)
  })
  it('a transit plan reads as track, power and train control with safety certification', () => {
    const g = gen(civil('transit_rail'))
    const brief = projectBrief(schedule(g, 'transit_rail'), asDb(g), { type: 'transit_rail' })
    expect(brief.scope.join(' ')).toMatch(/Track, Traction Power & Train Control/)
    expect(brief.scope.join(' ')).toMatch(/Systems Testing & Safety Certification/)
    // An uploaded civil schedule with no type set is still described in civil terms.
    expect(projectBrief(schedule(g, null), asDb(g)).scope.join(' ')).not.toMatch(/MEP|Interiors|Building/)
  })
  it('buildings keep building phase names', () => {
    const g = gen(building('commercial_office'))
    expect(projectBrief(schedule(g, 'commercial_office'), asDb(g), { type: 'commercial_office' }).scope.join(' ')).toMatch(/MEP Systems/)
  })
})

describe('5. Davis-Bacon / BABA questions that are offered can be answered', () => {
  it.each(PROJECT_TYPES.filter(t => t !== 'federal_defense'))('%s: answering them together with "federal" is accepted', (type) => {
    const base = { 'project.type': k(type), 'project.state': k('CA'), 'project.scope': k('new_construction') }
    const offered = questionBank({ answers: base }).all.filter(q => q.section === 'regulatory' && q.id.startsWith('reg.'))
    expect(offered.map(q => q.id)).toEqual(expect.arrayContaining(['reg.us-davis-bacon.applies', 'reg.us-baba.applies']))
    for (const federal of [true, false]) {
      // The regulatory checklist sends every answer at once; "federal" first makes the rest moot.
      const batch = { 'project.federal': { value: federal }, ...Object.fromEntries(offered.map(q => [q.id, { value: 'Yes' }])) }
      const r = applyAnswers(base, batch, {}, AT)
      expect(r.errors).toEqual({})
      expect(r.invalid).toEqual({})
      for (const q of offered) expect(r.answers[q.id].value).toBe(true)
    }
  })
})

describe('6. Federal installation permit and design-bid-build civil schedules', () => {
  const permitIds = (a: Record<string, Answer>) => questionBank({ answers: a }).permits.map(p => p.id)
  it('a federally funded bridge gets no base-access permit unless it is on a federal installation', () => {
    const fed = civil('highway_bridge', { 'project.federal': k(true) })
    expect(permitIds(fed)).toContain('us-nepa')
    expect(permitIds(fed)).not.toContain('us-fed-installation')
    expect(gen(fed).activities.some(a => a.id.startsWith('permit-us-fed-installation'))).toBe(false)
    expect(questionBank({ answers: fed }).all.some(q => q.id === 'project.federal_installation')).toBe(true)
    expect(permitIds({ ...fed, 'project.federal_installation': k(true) })).toContain('us-fed-installation')
    // Defense facilities are on an installation; a federal building keeps it unless told otherwise.
    expect(permitIds({ 'project.type': k('federal_defense') })).toContain('us-fed-installation')
    expect(permitIds(building('commercial_office', { 'project.federal': k(true) }))).toContain('us-fed-installation')
    expect(permitIds(building('commercial_office', { 'project.federal': k(true), 'project.federal_installation': k(false) }))).not.toContain('us-fed-installation')
  })
  it('design-bid-build bridge: no design or right-of-way work in the contractor schedule', () => {
    const dbb = gen(civil('highway_bridge', { 'project.delivery': k('dbb'), 'design.percent': k(30) }))
    const c = cats(dbb)
    for (const cat of ['design_sd', 'design_dd', 'design_cd', 'design_review', 'row_utilities'] as const) expect(c.has(cat)).toBe(false)
    expect(dbb.activities.some(a => a.id.startsWith('permit-us-row-certification'))).toBe(false)
    expect(dbb.assumptions.some(a => /Design-bid-build/.test(a.text))).toBe(true)
    expect(dbb.notes?.join(' ')).toMatch(/cannot be let until design is final/)
    expectClosed(dbb)
    // Design-build keeps both: the contractor designs and clears right-of-way.
    const db = gen(civil('highway_bridge', { 'project.delivery': k('db'), 'design.percent': k(30) }))
    expect(cats(db).has('row_utilities')).toBe(true)
    expect(cats(db).has('design_cd')).toBe(true)
  })
})

describe('7. Regulation answers add their compliance activity', () => {
  it('federal work gets Davis-Bacon and Buy America activities in the network', () => {
    const g = gen(civil('highway_bridge', { 'project.federal': k(true) }))
    const db = g.activities.find(a => a.id === 'reg-us-davis-bacon')!
    const baba = g.activities.find(a => a.id === 'reg-us-baba')!
    expect(db).toBeDefined()
    expect(baba).toBeDefined()
    // BABA certifications come before the first iron/steel work (substructure on a bridge).
    expect(g.links.some(l => l.from === baba.id && g.activities.find(a => a.id === l.to)?.category === 'substructure')).toBe(true)
    expect(g.links.some(l => l.from === db.id && g.activities.find(a => a.id === l.to)?.category === 'mobilization')).toBe(true)
  })
  it('not federal: none; federal status unknown: only when the rule itself is answered "applies"', () => {
    expect(gen(building('commercial_office')).activities.some(a => a.id.startsWith('reg-us-'))).toBe(false)
    const unknown = { ...building('commercial_office') }
    delete unknown['project.federal']
    expect(gen(unknown).activities.some(a => a.id === 'reg-us-baba')).toBe(false)
    expect(gen({ ...unknown, 'reg.us-baba.applies': k(true) }).activities.some(a => a.id === 'reg-us-baba')).toBe(true)
  })
})

describe('8. Data center envelope and power train', () => {
  const dc = building('data_center', { 'project.stories': k(1) })
  it('no curtain wall unless the envelope answer says so; the envelope drives dry-in', () => {
    const g = gen(dc)
    expect(names(g)).not.toMatch(/curtain wall/)
    expect(g.activities.find(a => a.category === 'windows_curtainwall')!.name).toMatch(/storefront/)
    const crit = new Set(g.cpm!.criticalPath)
    expect(g.activities.filter(a => a.category === 'windows_curtainwall' && crit.has(a.id))).toEqual([])
    // Dry-in waits for the exterior skin (through the weather allowance carried ahead of it).
    const dryIn = g.activities.find(a => a.category === 'dry_in')!
    const predCats = (id: string): string[] => g.links.filter(l => l.to === id).flatMap(l => {
      const p = g.activities.find(a => a.id === l.from)!
      return p.category === 'contingency' ? predCats(p.id) : [p.category]
    })
    expect(predCats(dryIn.id)).toContain('exterior_skin')
    expect(questionBank({ answers: dc }).all.some(q => q.id === 'envelope.curtain_wall')).toBe(true)
    expect(names(gen({ ...dc, 'envelope.curtain_wall': k(true) }))).toMatch(/curtain wall/)
  })
  it('has a power-train sequence fed by generator, ATS and UPS deliveries', () => {
    const g = gen(dc)
    const gens = g.activities.find(a => a.id.startsWith('t-power_equipment'))!
    const ups = g.activities.find(a => a.id.startsWith('t-conductors'))!
    expect(gens.name).toMatch(/generators/i)
    expect(ups.name).toMatch(/UPS.*PDU/)
    const into = (id: string) => g.links.filter(l => l.to === id).map(l => l.from)
    expect(into(gens.id)).toContain('ll-emergency-generator-fab')
    expect(into(gens.id)).toContain('ll-ats-fab')
    expect(into(ups.id)).toContain('ll-ups-fab')
    // Then the service is energized and backfeeds the power train, ahead of commissioning.
    const energize = g.activities.find(a => a.id.startsWith('t-electrical_service'))!
    expect(into(energize.id)).toEqual(expect.arrayContaining([expect.stringMatching(/^t-power_equipment/), expect.stringMatching(/^t-conductors/)]))
    expectClosed(g)
    // Offices are unchanged: no power train.
    const office = gen(building('commercial_office'))
    expect(cats(office).has('power_equipment')).toBe(false)
    expect(cats(office).has('conductors')).toBe(false)
  })
})

describe('9. Transit safety certification ties to revenue service', () => {
  it('the safety certification permit gates substantial completion (revenue service)', () => {
    const g = gen(civil('transit_rail'))
    const cert = g.activities.find(a => a.id === 'permit-us-transit-safety-cert')!
    const succ = g.links.filter(l => l.from === cert.id).map(l => g.activities.find(a => a.id === l.to)!)
    expect(succ.length).toBeGreaterThan(0)
    // Directly into the milestone, or into the contingency held just before it.
    expect(succ.some(a => a.category === 'substantial_completion' || a.id === 'contingency')).toBe(true)
    const sc = g.activities.find(a => a.category === 'substantial_completion')!
    expect(sc.name).toMatch(/revenue service/)
    expectClosed(g)
  })
})
