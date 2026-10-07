// Building-plan findings from pilot testers (GC schedulers), round 3. One block per report.
import { describe, expect, it } from 'vitest'
import type { Answer, AnswerValue, GeneratedSchedule, PlanActivity } from './types'
import { PROJECT_TYPES } from './types'
import { applyAnswers, isOutsideUS, parseFloors, profileFrom, questionBank, SQFT_PER_M2 } from './elicitation'
import { evenSplit, generateSchedule, seasonalDates, segmentLabel } from './generator'
import { resolveRegional } from '@/lib/knowledge/regions'
import { listLongLeadItems } from '@/lib/knowledge/long-lead'
import { runDcma } from '@/lib/analysis/dcma'
import { fmtDate, fmtDates, dateOrderOf } from '@/lib/format'

const AT = '2026-01-01T00:00:00.000Z'
const TODAY = '2026-01-15'
const k = (value: AnswerValue): Answer => ({ status: 'known', value, answeredAt: AT })
const building = (type: string, extra: Record<string, Answer> = {}): Record<string, Answer> => ({
  'project.type': k(type), 'project.state': k('TX'), 'project.scope': k('new_construction'), 'project.gross_sqft': k(120000), 'project.stories': k(4),
  'project.target_start': k('2026-03-02'), 'project.federal': k(false), 'design.drawings': k(true), 'design.percent': k(100), ...extra,
})
const gen = (answers: Record<string, Answer>) => generateSchedule({ answers, today: TODAY })
const cats = (g: GeneratedSchedule) => new Set(g.activities.map(a => a.category))
const act = (g: GeneratedSchedule, id: string) => g.activities.find(a => a.id === id)!
const preds = (g: GeneratedSchedule, id: string) => g.links.filter(l => l.to === id).map(l => l.from)
const succs = (g: GeneratedSchedule, id: string) => g.links.filter(l => l.from === id).map(l => l.to)
/** Is there a logic path from a to b? */
function reaches(g: GeneratedSchedule, a: string, b: string): boolean {
  const seen = new Set<string>(), stack = [a]
  while (stack.length) {
    const x = stack.pop()!
    if (x === b) return true
    if (seen.has(x)) continue
    seen.add(x)
    stack.push(...succs(g, x))
  }
  return false
}
function expectClosed(g: GeneratedSchedule) {
  const from = new Set(g.links.map(l => l.from)), to = new Set(g.links.map(l => l.to))
  const finalId = g.activities.find(a => a.category === 'final_completion')!.id
  for (const a of g.activities) {
    if (a.id !== finalId) expect(from.has(a.id), `${a.name} has no successor`).toBe(true)
    if (a.id !== 'ntp') expect(to.has(a.id), `${a.name} has no predecessor`).toBe(true)
  }
  expect(g.cpm!.cycles).toEqual([])
}
const toAnalyzable = (g: GeneratedSchedule) => ({
  projectStart: g.projectStart, calendars: g.calendars, defaultCalendarId: g.defaultCalendarId, links: g.links,
  activities: g.activities.map(a => ({ ...a, earlyStart: g.cpm!.times[a.id].earlyStart, earlyFinish: g.cpm!.times[a.id].earlyFinish, totalFloat: g.cpm!.times[a.id].totalFloat })),
})
/** Floors named in a segment label: "Level 3", "Levels 3–4", "Floors 12, 14". */
function floorsIn(name: string): number[] | null {
  const m = name.match(/ — (?:Levels?|Floors?) ([\d–, ]+)$/)
  if (!m) return null
  const t = m[1].trim()
  const r = t.match(/^(\d+)–(\d+)$/)
  if (r) return Array.from({ length: Number(r[2]) - Number(r[1]) + 1 }, (_, i) => Number(r[1]) + i)
  return t.split(/,\s*/).map(Number)
}
const segmentsOf = (g: GeneratedSchedule, base: string): PlanActivity[] =>
  g.activities.filter(a => a.id.startsWith(base + '#')).sort((x, y) => Number(x.id.split('#')[1]) - Number(y.id.split('#')[1]))

describe('1. Level labels stay within the building and run upward', () => {
  it.each([4, 5, 3, 12])('%i stories: every level segment is ascending, in range, and covers each floor once', (stories) => {
    const g = gen(building('commercial_office', { 'project.stories': k(stories) }))
    const byBase = new Map<string, PlanActivity[]>()
    for (const a of g.activities) if (a.id.includes('#')) byBase.set(a.id.split('#')[0], segmentsOf(g, a.id.split('#')[0]))
    let checked = 0
    for (const [base, segs] of byBase) {
      const lists = segs.map(s => floorsIn(s.name))
      if (lists.every(l => l === null)) continue
      checked++
      const all = lists.flatMap(l => l ?? [])
      for (const f of all) { expect(f, `${base}: ${f}`).toBeGreaterThanOrEqual(1); expect(f).toBeLessThanOrEqual(stories) }
      expect(all, `${base} floors in order, each once`).toEqual(Array.from({ length: stories }, (_, i) => i + 1))
    }
    expect(checked).toBeGreaterThan(0)
  })
  it('names the reported cases correctly', () => {
    expect([0, 1, 2].map(i => segmentLabel('mep_rough', 'mep', i, 3, { stories: 4 }))).toEqual(['Level 1', 'Level 2', 'Levels 3–4'])
    expect([0, 1, 2].map(i => segmentLabel('framing_drywall', 'interiors', i, 3, { stories: 5 }))).toEqual(['Level 1', 'Levels 2–3', 'Levels 4–5'])
    // More segments than floors: by area, never past the top floor.
    expect(segmentLabel('mep_rough', 'mep', 2, 3, { stories: 2 })).toBe('Area 3 of 3')
  })
  it('never splits foundations or elevators by level', () => {
    const g = gen(building('commercial_office', { 'project.stories': k(6), 'project.gross_sqft': k(300000) }))
    for (const a of g.activities.filter(x => ['foundations', 'deep_foundations', 'slab_on_grade', 'elevators'].includes(x.category))) {
      expect(a.name, a.id).not.toMatch(/Levels? \d/)
    }
    expect(segmentLabel('foundations', 'structure', 0, 2, { stories: 4 })).toBe('Area 1 of 2')
    expect(segmentLabel('elevators', 'mep', 1, 2, { stories: 4 })).toBe('adjust, test & AHJ acceptance')
  })
})

describe('2. Deliveries feed their installation; field start is never gated on a delivery', () => {
  const field = ['mobilization', 'abatement', 'demolition']
  it.each(['renovation', 'renovation_occupied', 'new_construction'])('%s office: no procurement links into mobilization, abatement or demolition', (scope) => {
    const g = gen(building('commercial_office', { 'project.scope': k(scope) }))
    for (const a of g.activities.filter(x => field.includes(x.category))) {
      expect(preds(g, a.id).filter(p => p.startsWith('ll-')), a.name).toEqual([])
    }
    // Every delivery goes to work in the same trade as the item, never to field start.
    for (const l of g.links.filter(x => /^ll-.*-(fab|delivered)$/.test(x.from) && !x.to.startsWith('ll-') && !x.to.startsWith('dc-'))) {
      expect(field).not.toContain(act(g, l.to).category)
    }
    expectClosed(g)
  })
  it('renovation: roof and steel deliveries get their own installation activities', () => {
    const g = gen(building('commercial_office', { 'project.scope': k('renovation') }))
    const roof = succs(g, 'll-roofing-membrane-fab').map(id => act(g, id))
    expect(roof.map(a => a.category)).toEqual(['roofing'])
    expect(roof[0].name).toMatch(/Roof replacement/)
    expect(preds(g, roof[0].id)).toContain('t-demolition')
    const steel = succs(g, 'll-structural-steel-fab').map(id => act(g, id))
    expect(steel.map(a => a.id)).toEqual(['install-structure_steel'])
    // Out of scope: no installation.
    const g2 = gen(building('commercial_office', { 'project.scope': k('renovation'), 'procure.roofing-membrane.status': k('not_in_scope') }))
    expect(g2.activities.some(a => a.id === 'install-roofing')).toBe(false)
  })
  it('new construction: roofing delivery feeds the roofing work', () => {
    const g = gen(building('commercial_office'))
    expect(succs(g, 'll-roofing-membrane-fab').every(id => id.startsWith('t-roofing'))).toBe(true)
  })
  it('punch list follows permanent power and runs alongside commissioning', () => {
    for (const type of ['commercial_office', 'data_center', 'healthcare']) {
      const g = gen(building(type))
      const punch = g.activities.find(a => a.category === 'punchlist')!
      const cx = g.links.filter(l => l.to === punch.id && act(g, l.from).category === 'commissioning')
      expect(cx.length, type).toBeGreaterThan(0)
      expect(reaches(g, g.activities.find(a => a.id.startsWith('t-electrical_service'))!.id, punch.id), type).toBe(true)
    }
  })
})

describe('3. Permits answered "not required" or "issued" put no review on the path', () => {
  it('Texas TDLR/RAS not required: no registration review and no RAS inspection', () => {
    const base = gen(building('commercial_office'))
    expect(base.activities.some(a => a.id.startsWith('permit-tx-tdlr-tas'))).toBe(true)
    expect(base.activities.some(a => a.id === 'reg-tx-ras-inspection')).toBe(true)
    const g = gen(building('commercial_office', { 'permit.tx-tdlr-tas.status': k('not_required'), 'permit.tx-building.status': k('issued') }))
    expect(g.activities.some(a => a.id.startsWith('permit-tx-tdlr-tas') || a.id.startsWith('permit-tx-building'))).toBe(false)
    expect(g.activities.some(a => a.id === 'reg-tx-ras-inspection')).toBe(false)
    expectClosed(g)
  })
  it('TDLR registration already issued: no review, but the final RAS inspection stays off the critical path', () => {
    const g = gen(building('commercial_office', { 'permit.tx-tdlr-tas.status': k('issued') }))
    expect(g.activities.some(a => a.id.startsWith('permit-tx-tdlr-tas'))).toBe(false)
    expect(g.cpm!.criticalPath.some(id => id.startsWith('permit-tx-tdlr-tas'))).toBe(false)
  })
  it('right-of-way not required and railroad agreement issued: no ROW / railroad work package', () => {
    const civ = (extra: Record<string, Answer> = {}) => ({
      'project.type': k('highway_bridge'), 'project.state': k('IL'), 'project.scope': k('new_construction'), 'project.value_musd': k(40),
      'project.target_start': k('2026-03-02'), 'project.delivery': k('db'), 'design.drawings': k(true), 'design.percent': k(100), ...extra,
    })
    expect(cats(gen(civ())).has('row_utilities')).toBe(true)
    const g = gen(civ({ 'permit.us-row-certification.status': k('not_required'), 'permit.us-railroad-agreement.status': k('issued') }))
    expect(cats(g).has('row_utilities')).toBe(false)
    expect(g.activities.some(a => /^permit-us-(row-certification|railroad-agreement)/.test(a.id))).toBe(false)
    expect(g.assumptions.some(a => /Right-of-way.*removed/.test(a.text))).toBe(true)
    expectClosed(g)
    // Only one of the two resolved: the work package stays.
    expect(cats(gen(civ({ 'permit.us-row-certification.status': k('not_required') }))).has('row_utilities')).toBe(true)
  })
})

describe('4. Regional climate', () => {
  it('southern states get no frozen-ground winter default', () => {
    for (const st of ['GA', 'AL', 'SC', 'LA']) {
      const c = resolveRegional({ state: st }).climate
      expect(c.adverseMonths.some(m => [12, 1, 2].includes(m)), st).toBe(false)
      expect(c.seasonal ?? []).toEqual([])
    }
    const g = gen(building('commercial_office', { 'project.state': k('GA') }))
    expect(g.notes!.join(' ')).not.toMatch(/Generic temperate\/northern winter/)
    expect(g.calendars.map(c => c.id)).toEqual(['cal-field', 'cal-7d'])
  })
  it('northern states shut down paving, roofing and slab work for the winter via a calendar', () => {
    const g = gen(building('commercial_office', { 'project.state': k('MN'), 'project.target_start': k('2026-08-03') }))
    const paving = g.calendars.find(c => c.id === 'cal-season-paving')!
    const cold = g.calendars.find(c => c.id === 'cal-season-cold')!
    expect(paving.holidays).toEqual(expect.arrayContaining(['2026-12-20', '2027-01-15', '2027-04-15']))
    expect(paving.seasonalBaseId).toBe('cal-field')
    expect(cold.holidays).toEqual(expect.arrayContaining(['2027-01-15', '2027-02-28']))
    for (const a of g.activities) {
      if (a.category === 'paving_landscape') expect(a.calendarId).toBe('cal-season-paving')
      if (['roofing', 'foundations', 'slab_on_grade'].includes(a.category) && a.type === 'task') expect(a.calendarId, a.name).toBe('cal-season-cold')
    }
    // No paving work is scheduled inside the shutdown.
    const pave = g.activities.filter(a => a.category === 'paving_landscape')
    for (const a of pave) {
      const t = g.cpm!.times[a.id]
      expect(t.earlyStart.slice(5) >= '04-16' || t.earlyStart.slice(5) < '11-15', t.earlyStart).toBe(true)
    }
    expect(g.notes!.join(' ')).toMatch(/Winter paving & landscaping shutdown \(MN\)/)
    // The critical path test still holds (seasonal windows are calendar, not logic).
    expect(runDcma(toAnalyzable(g)).checks.find(c => c.id === 12)!.result).toBe('pass')
    // Answering "no weather days" turns the windows off too.
    expect(gen(building('commercial_office', { 'project.state': k('MN'), 'calendar.weather': k(false) })).calendars.length).toBe(2)
  })
  it('seasonal windows wrap the new year', () => {
    const d = seasonalDates({ id: 'x', label: 'x', start: '12-30', end: '01-02', categories: [], note: '' }, 2026, 2026)
    expect(d).toEqual(['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'])
  })
})

describe('5. Segments are even', () => {
  it('splits durations evenly, remainder one day at a time', () => {
    expect(evenSplit(38, 2)).toEqual([19, 19])
    expect(evenSplit(38, 3)).toEqual([13, 13, 12])
    expect(evenSplit(64, 4)).toEqual([16, 16, 16, 16])
  })
  it.each(['commercial_office', 'warehouse_industrial', 'data_center', 'healthcare'])('%s: segments of each activity differ by at most one day', (type) => {
    const g = gen(building(type))
    const bases = new Set(g.activities.filter(a => a.id.includes('#')).map(a => a.id.split('#')[0]))
    for (const b of bases) {
      const d = segmentsOf(g, b).map(a => a.duration)
      expect(Math.max(...d) - Math.min(...d), `${b}: ${d.join('/')}`).toBeLessThanOrEqual(1)
    }
  })
})

describe('6. Data center mission-critical backbone', () => {
  const g = gen(building('data_center', { 'project.stories': k(1), 'project.gross_sqft': k(200000) }))
  const one = (re: RegExp) => g.activities.filter(a => re.test(a.name))
  it('has substation, MV switchgear, generators, load bank, UPS, busway, containment and L1–L5 as separate activities', () => {
    expect(one(/substation/i).length).toBeGreaterThan(0)
    expect(one(/MV switchgear set/).length).toBe(1)
    expect(one(/set generators/).length).toBeGreaterThan(0)
    expect(one(/load bank testing/).length).toBe(1)
    expect(one(/UPS modules/).length).toBeGreaterThan(0)
    expect(one(/busway/i).length).toBeGreaterThan(0)
    expect(one(/containment/i).length).toBeGreaterThan(0)
    for (const lv of ['L1', 'L2', 'L3', 'L4']) expect(one(new RegExp(`^${lv} — `)).length, lv).toBe(1)
    expect(act(g, 't-commissioning').name).toMatch(/L5 IST/)
  })
  it('sequences the levels and feeds them from the backbone work', () => {
    expect(preds(g, 'dc-l2')).toEqual(expect.arrayContaining(['dc-l1', 't-electrical_service']))
    expect(preds(g, 'dc-l3')).toEqual(expect.arrayContaining(['dc-l2', 'dc-loadbank']))
    expect(preds(g, 'dc-l4')).toEqual(expect.arrayContaining(['dc-l3', 'dc-containment']))
    // L5 IST follows L4 and the closed-out punch list; it, not the finishes, drives substantial completion.
    expect(preds(g, 't-commissioning').sort()).toEqual(['dc-l4', 't-punchlist'])
    expect(reaches(g, 'dc-substation#1', 't-electrical_service') || reaches(g, 'dc-substation', 't-electrical_service')).toBe(true)
    expect(preds(g, 'dc-loadbank').some(p => p.startsWith('t-power_equipment'))).toBe(true)
    expect(preds(g, 'dc-containment').some(p => p.startsWith('dc-busway'))).toBe(true)
    // The utility's service application drives the substation, not the switchgear set.
    expect(preds(g, 't-electrical_service').some(p => p.startsWith('permit-'))).toBe(false)
    expectClosed(g)
  })
  it('other building types get none of it', () => {
    const office = gen(building('commercial_office'))
    expect(office.activities.some(a => a.id.startsWith('dc-'))).toBe(false)
  })
})

describe('7. Interiors / tenant improvement', () => {
  const ti = (extra: Record<string, Answer> = {}) => building('interiors_ti', {
    'project.scope': k('renovation'), 'project.gross_sqft': k(60000), 'project.floors': k('12-15'), 'project.state': k('IL'), ...extra,
  })
  it('is a project type', () => {
    expect(PROJECT_TYPES).toContain('interiors_ti')
    expect(applyAnswers({}, { 'project.type': { value: 'interiors_ti' } }, {}, AT).invalid).toEqual({})
  })
  it('asks no site, structure or envelope questions, and asks for actual floor numbers', () => {
    const a = ti()
    delete a['project.stories']
    const ids = questionBank({ answers: a }).all.map(q => q.id)
    for (const id of ['site.acres_disturbed', 'site.conditions', 'project.stories', 'envelope.curtain_wall', 'calendar.weather']) expect(ids).not.toContain(id)
    expect(ids).toContain('project.floors')
    for (const it of ['structural-steel', 'joists-deck', 'roofing-membrane', 'curtain-wall', 'elevators', 'padmount-transformer', 'precast', 'fire-pump']) {
      expect(ids, it).not.toContain(`procure.${it}.status`)
    }
    for (const it of ['ti-millwork-casework', 'ti-glass-partitions', 'ti-hvac-equipment']) expect(ids).toContain(`procure.${it}.status`)
    expect(questionBank({ answers: a }).permits.some(p => p.gates === 'earthwork' || p.gates === 'utilities_site')).toBe(false)
    expect(profileFrom(a)).toMatchObject({ floors: [12, 13, 14, 15], stories: 4, siteAcresDisturbed: undefined })
  })
  it('parses floor numbers as typed', () => {
    expect(parseFloors('12-15')).toEqual([12, 13, 14, 15])
    expect(parseFloors('3, 5, 7')).toEqual([3, 5, 7])
    expect(parseFloors('L2–L4')).toEqual([2, 3, 4])
    expect(parseFloors('Floors 10 to 12 and 20')).toEqual([10, 11, 12, 20])
    expect(parseFloors(8)).toEqual([8])
    expect(parseFloors('none')).toBeUndefined()
  })
  it('plans interior work only, floor by floor on the actual floors, overlapped like a GC', () => {
    const g = gen(ti())
    const c = cats(g)
    for (const cat of ['earthwork', 'utilities_site', 'foundations', 'slab_on_grade', 'structure_steel', 'structure_concrete', 'roofing', 'exterior_skin', 'windows_curtainwall', 'dry_in', 'paving_landscape', 'elevators'] as const) {
      expect(c.has(cat), cat).toBe(false)
    }
    for (const cat of ['demolition', 'mep_rough', 'framing_drywall', 'finishes', 'specialties', 'commissioning'] as const) expect(c.has(cat), cat).toBe(true)
    for (const base of ['t-demolition', 't-mep_rough', 't-framing_drywall', 't-finishes']) {
      expect(segmentsOf(g, base).map(a => a.name.split(' — ').pop())).toEqual(['Floor 12', 'Floor 13', 'Floor 14', 'Floor 15'])
    }
    // Trades overlap across floors: rough-in on floor 12 starts before demolition on floor 15 is done,
    // and each floor's work follows the previous trade on that same floor.
    const t = g.cpm!.times
    expect(t['t-mep_rough#1'].earlyStart < t['t-demolition#4'].earlyFinish).toBe(true)
    expect(preds(g, 't-mep_rough#2')).toContain('t-demolition#2')
    expect(preds(g, 't-framing_drywall#3')).toContain('t-mep_rough#3')
    expect(g.notes!.join(' ')).not.toMatch(/Regional climate/)
    expectClosed(g)
  })
  it('a first-generation space has no demolition; milestones skip structure and dry-in', () => {
    const g = gen(ti({ 'project.scope': k('new_construction') }))
    expect(cats(g).has('demolition')).toBe(false)
    expect(cats(g).has('earthwork')).toBe(false)
    const ms = questionBank({ answers: ti() }).all.filter(q => q.section === 'milestones').map(q => q.id)
    expect(ms).toEqual(['milestone.commissioning.target', 'milestone.substantial_completion.target'])
    expectClosed(g)
  })
})

describe('8. Laboratories: casework, fume hoods and process piping', () => {
  const g = gen(building('lab_research', { 'project.state': k('CA') }))
  it('installs lab process piping and casework / fume hoods as their own work', () => {
    const piping = g.activities.filter(a => a.category === 'process_equipment')
    expect(piping.length).toBeGreaterThan(0)
    expect(piping[0].name).toMatch(/process piping.*RO\/DI.*lab gases.*vacuum/)
    const casework = g.activities.filter(a => a.category === 'specialties')
    expect(casework[0].name).toMatch(/casework, fume hoods/)
    // Process systems delivery feeds the piping; hoods/casework follow it; commissioning waits for both.
    expect(succs(g, 'll-lab-process-systems-fab').some(id => id.startsWith('t-process_equipment'))).toBe(true)
    expect(succs(g, 'll-lab-casework-hoods-fab').some(id => id.startsWith('t-specialties'))).toBe(true)
    expect(reaches(g, piping[0].id, casework[0].id)).toBe(true)
    expect(reaches(g, casework[casework.length - 1].id, g.activities.find(a => a.id.startsWith('t-commissioning'))!.id)).toBe(true)
    expectClosed(g)
  })
  it('other types keep their network', () => {
    expect(cats(gen(building('commercial_office'))).has('process_equipment')).toBe(false)
    expect(listLongLeadItems({ projectType: 'commercial_office' }).some(i => i.id === 'lab-process-systems')).toBe(false)
  })
})

describe('9. Projects outside the US', () => {
  const abroad = () => {
    const r = applyAnswers(building('commercial_office'), { 'project.state': { value: 'Ontario, Canada' }, 'project.area_unit': { value: 'm2' }, 'project.gross_sqft': { value: 10000 } }, {}, AT)
    expect(r.invalid).toEqual({})
    const a = r.answers
    delete a['project.federal']
    return a
  }
  it('detects a typed non-US location', () => {
    const a = abroad()
    expect(a['project.state'].custom).toBe(true)
    expect(isOutsideUS(a)).toBe(true)
    expect(isOutsideUS({ 'project.state': { ...k('San Juan, Puerto Rico, USA'), custom: true } })).toBe(false)
    expect(isOutsideUS({ 'project.state': { ...k('Northern Virginia'), custom: true } })).toBe(false)
    expect(isOutsideUS(building('commercial_office'))).toBe(false)
  })
  it('asks no US federal / DoD questions and plans no US permits or holidays', () => {
    const a = abroad()
    const bank = questionBank({ answers: a })
    const ids = bank.all.map(q => q.id)
    for (const id of ['project.federal', 'project.federal_installation', 'calendar.holidays', 'security.classification']) expect(ids).not.toContain(id)
    expect(ids.some(id => id.startsWith('reg.us-'))).toBe(false)
    expect(bank.permits.map(p => p.id).sort()).toEqual(['intl-building', 'intl-utility'])
    const g = gen(a)
    expect(g.activities.some(a2 => /^permit-(us|def|tx)-/.test(a2.id) || a2.id.startsWith('reg-'))).toBe(false)
    expect(g.calendars[0].holidays).toEqual([])
    expect(g.notes!.join(' ')).toMatch(/outside the US/)
    expectClosed(g)
  })
  it('takes area in square metres', () => {
    expect(profileFrom(abroad()).grossSqft).toBe(Math.round(10000 * SQFT_PER_M2))
    expect(questionBank({ answers: abroad() }).all.find(q => q.id === 'project.gross_sqft')!.unit).toBe('m²')
    // US projects are not asked.
    expect(questionBank({ answers: building('commercial_office') }).all.some(q => q.id === 'project.area_unit')).toBe(false)
  })
  it('formats dates as DD/MM/YYYY on request, MM/DD/YYYY by default', () => {
    expect(fmtDate('2026-10-31')).toBe('10/31/2026')
    expect(fmtDate('2026-10-31', 'DMY')).toBe('31/10/2026')
    expect(fmtDates('due 2026-10-31 and 2027-01-05', 'DMY')).toBe('due 31/10/2026 and 05/01/2027')
    expect(dateOrderOf('DMY')).toBe('DMY')
    expect(dateOrderOf('YMD')).toBe('MDY')
    expect(dateOrderOf(undefined)).toBe('MDY')
  })
})
