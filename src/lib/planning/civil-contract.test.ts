// Contract-grade civil, federal and industrial networks (pilot round 3: heavy-civil, federal and
// industrial schedulers). One block per request.
import { describe, expect, it } from 'vitest'
import type { Answer, AnswerValue, GeneratedSchedule, PlanActivity } from './types'
import { PROJECT_TYPES, isCivilType } from './types'
import { questionBank } from './elicitation'
import { generateSchedule } from './generator'
import { toAnalyzable } from './evaluation'
import { runDcma } from '@/lib/analysis/dcma'
import { buildWbs, phaseLabelsFor } from '@/lib/export/wbs'
import { classifyActivity, classifySchedule } from '@/lib/semantic/taxonomy'
import { templatesFor, validateTemplates } from '@/lib/knowledge/templates'

const AT = '2026-01-01T00:00:00.000Z'
const TODAY = '2026-01-15'
const k = (value: AnswerValue): Answer => ({ status: 'known', value, answeredAt: AT })
const civil = (type: string, extra: Record<string, Answer> = {}): Record<string, Answer> => ({
  'project.type': k(type), 'project.state': k('IL'), 'project.scope': k('new_construction'), 'project.value_musd': k(60),
  'project.target_start': k('2026-03-02'), 'project.delivery': k('db'), 'design.drawings': k(true), 'design.percent': k(100), ...extra,
})
const gen = (answers: Record<string, Answer>) => generateSchedule({ answers, today: TODAY })
const byId = (g: GeneratedSchedule, id: string) => g.activities.find(a => a.id === id || a.id.startsWith(`${id}#`))
const all = (g: GeneratedSchedule, id: string) => g.activities.filter(a => a.id === id || a.id.startsWith(`${id}#`))
const preds = (g: GeneratedSchedule, id: string) => g.links.filter(l => l.to === id).map(l => l.from)
/** Predecessors of an activity's first segment, with segments of the same activity looked through. */
const predsOf = (g: GeneratedSchedule, id: string) => preds(g, all(g, id)[0].id).map(p => p.replace(/#\d+$/, ''))
const names = (g: GeneratedSchedule) => g.activities.map(a => a.name).join(' | ')
const es = (g: GeneratedSchedule, a: PlanActivity) => g.cpm!.times[a.id].earlyStart
const ef = (g: GeneratedSchedule, a: PlanActivity) => g.cpm!.times[a.id].earlyFinish

/** Connected network: one start, one finish, no open ends, no cycles; DCMA logic checks pass. */
function expectSound(g: GeneratedSchedule, checks = [1, 2, 3, 4, 5, 7, 9, 12]) {
  const from = new Set(g.links.map(l => l.from)), to = new Set(g.links.map(l => l.to))
  const finalId = g.activities.find(a => a.category === 'final_completion')!.id
  for (const a of g.activities) {
    if (a.id !== finalId) expect(from.has(a.id), `${a.name} has no successor`).toBe(true)
    if (a.id !== 'ntp') expect(to.has(a.id), `${a.name} has no predecessor`).toBe(true)
  }
  expect(g.cpm!.cycles).toEqual([])
  const d = runDcma(toAnalyzable(g))
  for (const id of checks) expect(`#${id} ${d.checks.find(x => x.id === id)!.result}`).toBe(`#${id} pass`)
}

describe('templates: every civil network and variant is closed and acyclic', () => {
  it('validates with civil variants (stages, guideway, facility, scope, delivery)', () => {
    const extra = [
      { projectType: 'highway_bridge' as const, scope: 'renovation_occupied' as const, civil: { motStages: 3, inWater: true, utilities: 'by_others' as const, utilityOwners: 3 } },
      { projectType: 'highway_bridge' as const, civil: { motStages: 1, inWater: false, utilities: 'none' as const, rowClear: true, railroad: 'none' as const } },
      { projectType: 'transit_rail' as const, civil: { guideway: 'elevated_segmental' as const, stations: 3 } },
      { projectType: 'transit_rail' as const, civil: { guideway: 'at_grade' as const, stations: 0 } },
      { projectType: 'water_wastewater' as const, scope: 'renovation' as const, civil: { wwFacility: 'water_treatment' as const, wwStructures: 4 } },
      { projectType: 'water_wastewater' as const, civil: { wwFacility: 'pump_station' as const, wwStructures: 1 } },
      { projectType: 'aviation' as const, civil: { airportArea: 'landside' as const } },
      { projectType: 'aviation' as const, scope: 'renovation' as const, civil: { airportArea: 'both' as const, winterShutdown: true } },
      { projectType: 'marine_civil_works' as const, civil: { marineScope: 'marine_structure' as const } },
      { projectType: 'marine_civil_works' as const, civil: { marineScope: 'tunnel' as const, tunnelMethod: 'tbm' as const } },
      { projectType: 'marine_civil_works' as const, civil: { marineScope: 'tunnel' as const, tunnelMethod: 'drill_blast' as const } },
      { projectType: 'environmental_remediation' as const, civil: { groundwaterTreatment: true } },
      { projectType: 'epc_industrial' as const, civil: { epcDelivery: 'epcm' as const, heavyLifts: false, hydrotestSystems: 1 } },
      { projectType: 'epc_industrial' as const, civil: { epcDelivery: 'epc' as const, heavyLifts: true, hydrotestSystems: 5 } },
    ]
    const v = validateTemplates(extra)
    expect(v.errors).toEqual([])
  })
  it('new types are civil, have their own phase labels and stay 25–60 template activities', () => {
    for (const t of ['aviation', 'marine_civil_works', 'environmental_remediation', 'epc_industrial'] as const) {
      expect(PROJECT_TYPES).toContain(t)
      expect(isCivilType(t)).toBe(true)
      expect(phaseLabelsFor(t).mep).not.toMatch(/MEP/)
      const n = templatesFor({ projectType: t }).length
      expect(n).toBeGreaterThanOrEqual(25)
      expect(n).toBeLessThanOrEqual(60)
    }
  })
})

describe('1. Highway & bridge: staged construction, deck sequence, windows, seasons, ROW', () => {
  // Railroad agreement in place (it gates the first substructure work while pending).
  const staged = civil('highway_bridge', { 'project.scope': k('renovation_occupied'), 'civil.mot_phases': k(2), 'project.state': k('TX'), 'permit.us-railroad-agreement.status': k('issued') })
  it('Stage 1 / Stage 2 behind traffic switches, parallel pier and abutment crews', () => {
    const g = gen(staged)
    expectSound(g)
    expect(byId(g, 't-traffic_control')!.name).toMatch(/Stage 1 traffic switch/)
    expect(predsOf(g, 't-traffic_switch_s2')).toContain('t-deck_finish_s1')
    expect(predsOf(g, 't-demolition_s2')).toContain('t-traffic_switch_s2')
    for (const s of [1, 2]) {
      // Crews A and B start together off the same foundations.
      expect(predsOf(g, `t-abutments_s${s}`)).toEqual([`t-deep_foundations_s${s}`])
      expect(predsOf(g, `t-piers_s${s}`)).toEqual([`t-deep_foundations_s${s}`])
      expect(es(g, all(g, `t-abutments_s${s}`)[0])).toBe(es(g, all(g, `t-piers_s${s}`)[0]))
      // Girders go on cured bridge seats and pier caps (separate cure activities on calendar days).
      expect(predsOf(g, `t-superstructure_s${s}`)).toEqual(expect.arrayContaining([`t-abutments_cure_s${s}`, `t-piers_cure_s${s}`]))
      expect(predsOf(g, `t-abutments_cure_s${s}`)).toEqual([`t-abutments_s${s}`])
      expect(byId(g, `t-piers_cure_s${s}`)!.calendarId).toBe('cal-7d')
    }
    expect(gen({ ...staged, 'civil.mot_phases': k(3) }).activities.some(a => a.id === 't-traffic_switch_s3')).toBe(true)
    expect(gen({ ...staged, 'civil.mot_phases': k(1), 'project.scope': k('new_construction') }).activities.some(a => /Stage/.test(a.name))).toBe(false)
  })
  it('deck split into forms, rebar, pour and a 7-calendar-day cure', () => {
    const g = gen(staged)
    const chain = ['deck_forms_s1', 'deck_rebar_s1', 'deck_pour_s1', 'deck_cure_s1', 'deck_finish_s1']
    for (let i = 1; i < chain.length; i++) expect(predsOf(g, `t-${chain[i]}`)).toContain(`t-${chain[i - 1]}`)
    const cure = byId(g, 't-deck_cure_s1')!
    expect(cure.calendarId).toBe('cal-7d')
    expect(cure.duration).toBe(7)
    expect(cure.category).toBe('concrete_cure')
  })
  it('the in-water work window is held as start/finish constraints, each stage in its own season', () => {
    const g = gen({ ...staged, 'civil.inwater_open': k('2026-06-01'), 'civil.inwater_close': k('2026-10-31') })
    expectSound(g, [1, 2, 3, 4, 9])
    for (const s of [1, 2]) {
      const segs = all(g, `t-in_water_work_s${s}`)
      expect(segs.length).toBeGreaterThan(0)
      const start = es(g, segs[0]), finish = ef(g, segs[segs.length - 1])
      expect(start.slice(5) >= '06-01' && start.slice(5) <= '10-31', `stage ${s} starts ${start}`).toBe(true)
      expect(segs.some(a => a.constraint?.type === 'FNLT' || a.constraint?.type === 'SNET')).toBe(true)
      expect(finish.slice(0, 4)).toBe(start.slice(0, 4))
    }
    expect(g.notes!.join(' ')).toMatch(/In-water work windows/)
    // Without the dates, the window is only a name.
    expect(gen(staged).activities.some(a => a.constraint && a.category === 'in_water_work')).toBe(false)
  })
  it('northern states: paving, striping and seeding cannot fall in the winter shutdown', () => {
    const g = gen({ ...staged, 'project.state': k('MN') })
    expectSound(g)
    const season = g.calendars.find(c => c.id === 'cal-season')!
    expect(season).toBeDefined()
    const seasonal = g.activities.filter(a => a.calendarId === 'cal-season')
    expect(seasonal.map(a => a.id.replace(/#\d+$/, ''))).toEqual(expect.arrayContaining(['t-paving', 't-cutover', 't-restoration']))
    for (const a of seasonal) for (const d of [es(g, a), ef(g, a)]) expect(['12', '01', '02', '03'], `${a.name} on ${d}`).not.toContain(d.slice(5, 7))
    expect(gen(staged).calendars.some(c => c.id === 'cal-season')).toBe(false) // Texas
    expect(gen({ ...staged, 'project.state': k('MN'), 'civil.winter_shutdown': k(false) }).calendars.some(c => c.id === 'cal-season')).toBe(false)
  })
  it('ROW certified / railroad not required / utilities done: nothing of them on the path', () => {
    const pending = gen(staged)
    expect(pending.activities.some(a => a.id.startsWith('permit-us-row-certification'))).toBe(true)
    expect(byId(pending, 't-row_utilities')!.name).toMatch(/railroad/)
    const clear = gen({
      ...staged, 'permit.us-row-certification.status': k('issued'), 'permit.us-railroad-agreement.status': k('not_required'), 'civil.utilities': k('complete'),
    })
    expectSound(clear)
    expect(clear.activities.some(a => a.id.startsWith('permit-us-row-certification') || a.id.startsWith('permit-us-railroad'))).toBe(false)
    expect(clear.activities.some(a => a.category === 'row_utilities')).toBe(false)
    expect(names(clear)).not.toMatch(/railroad|right-of-way/i)
    const crit = new Set(clear.cpm!.criticalPath)
    expect(clear.activities.filter(a => crit.has(a.id) && /right-of-way|utility reloc/i.test(a.name))).toEqual([])
    // Relocations by the owners stay, sized by how many owners there are.
    const one = byId(gen({ ...staged, 'civil.utilities': k('by_others'), 'civil.utility_owners': k(1) }), 't-row_utilities')!
    const four = all(gen({ ...staged, 'civil.utilities': k('by_others'), 'civil.utility_owners': k(4) }), 't-row_utilities')
    expect(four[0].name).toMatch(/4 owners/)
    expect(four.reduce((s, a) => s + a.duration, 0)).toBeGreaterThan(one.duration)
  })
  it('asks earthwork quantity, MOT stages and utility owners; federal-aid is not federal property', () => {
    const ids = questionBank({ answers: { ...staged, 'civil.utilities': k('by_others') } }).all.map(q => q.id)
    expect(ids).toEqual(expect.arrayContaining(['civil.earthwork_cy', 'civil.mot_phases', 'civil.utilities', 'civil.utility_owners', 'civil.inwater_open', 'civil.winter_shutdown']))
    const fed = questionBank({ answers: staged }).all.find(q => q.id === 'project.federal')!
    expect(fed.prompt).toMatch(/FHWA federal-aid/)
    expect(fed.why).toMatch(/asked separately/)
    const fedAid = questionBank({ answers: { ...staged, 'project.federal': k(true) } })
    expect(fedAid.all.find(q => q.id === 'project.federal_installation')!.fallback!.value).toBe(false)
    expect(fedAid.permits.map(p => p.id)).not.toContain('us-fed-installation')
    // Earthwork from the quantity: 300,000 CY at 1,500 CY/day = 200 work days (split into segments).
    const g = gen({ ...staged, 'civil.earthwork_cy': k(300000) })
    expect(all(g, 't-earthwork').reduce((s, a) => s + a.duration, 0)).toBe(200)
    expect(all(g, 't-earthwork')[0].rationale.summary).toMatch(/300,000 CY/)
    // No in-water permit → no cofferdams.
    expect(gen({ ...staged, 'permit.us-usace-404-bridge.status': k('not_required') }).activities.some(a => a.category === 'in_water_work')).toBe(false)
  })
})

describe('2. Water & wastewater: per-structure sequence, clean-water test, seeding, permit to operate', () => {
  it('each structure is poured, cured, leak tested and backfilled; equipment waits for its leak test', () => {
    const g = gen(civil('water_wastewater', { 'ww.structures': k(3) }))
    expectSound(g)
    for (const i of [1, 2, 3]) {
      const pour = i === 1 ? 't-process_structures' : `t-structure_${i}`
      expect(predsOf(g, `t-structure_${i}_cure`)).toContain(pour)
      expect(byId(g, `t-structure_${i}_cure`)!.calendarId).toBe('cal-7d')
      expect(predsOf(g, `t-structure_${i}_leak`)).toContain(`t-structure_${i}_cure`)
      expect(predsOf(g, `t-structure_${i}_backfill`)).toContain(`t-structure_${i}_leak`)
    }
    expect(predsOf(g, 't-process_equipment')).toContain('t-structure_1_leak')
    expect(predsOf(g, 't-process_equipment_rest')).toEqual(expect.arrayContaining(['t-structure_2_leak', 't-structure_3_leak']))
    const order = ['t-clean_water_test', 't-bio_seed', 't-startup_testing', 't-inspections']
    for (let i = 1; i < order.length; i++) expect(predsOf(g, order[i])).toContain(order[i - 1])
    expect(byId(g, 't-bio_seed')!.calendarId).toBe('cal-7d')
    expect(byId(g, 't-inspections')!.name).toMatch(/permit to operate/)
  })
  it('a water plant disinfects instead of seeding; a pump station does neither', () => {
    const w = gen(civil('water_wastewater', { 'ww.facility': k('water_treatment') }))
    expect(w.activities.some(a => a.id === 't-disinfection')).toBe(true)
    expect(w.activities.some(a => a.id === 't-bio_seed')).toBe(false)
    const ps = gen(civil('water_wastewater', { 'ww.facility': k('pump_station') }))
    expectSound(ps)
    expect(ps.activities.some(a => a.id === 't-bio_seed' || a.id === 't-disinfection')).toBe(false)
  })
})

describe('3. Transit: station ADA scope and the elevated segmental guideway', () => {
  it('stations get platform edges, elevators / escalators and general-order track outages', () => {
    const g = gen(civil('transit_rail', { 'transit.stations': k(2) }))
    expectSound(g)
    expect(byId(g, 't-platform_edge')!.name).toMatch(/tactile|ADA/)
    expect(predsOf(g, 't-platform_edge')).toContain('t-general_orders')
    expect(byId(g, 't-elevators')!.name).toMatch(/elevators & escalators/)
    expect(preds(g, all(g, 't-elevators')[0].id)).toContain('ll-civ-station-elevators-fab')
    expect(predsOf(g, 't-cutover')).toContain('t-general_orders')
    const none = gen(civil('transit_rail', { 'transit.stations': k(0) }))
    expect(none.activities.some(a => a.category === 'elevators' || a.id === 't-general_orders')).toBe(false)
  })
  it('elevated segmental: casting yard → segments, gantry, bearings, erection, elevated stations', () => {
    const g = gen(civil('transit_rail', { 'transit.guideway': k('elevated_segmental'), 'transit.stations': k(1) }))
    expectSound(g)
    for (const id of ['t-casting_yard', 't-segment_casting', 't-gantry', 't-bearings', 't-span_erection', 't-closure_pours', 't-station_structure', 't-elevators']) expect(byId(g, id), id).toBeDefined()
    expect(preds(g, all(g, 't-gantry')[0].id)).toContain('ll-civ-launching-gantry-fab')
    expect(predsOf(g, 't-span_erection')).toEqual(expect.arrayContaining(['t-gantry', 't-bearings']))
    expect(byId(g, 't-station_structure')!.name).toMatch(/Elevated station/)
    expect(questionBank({ answers: civil('transit_rail') }).all.find(q => q.id === 'transit.guideway')!.allowOther).toBe(false)
  })
})

describe('4. Federal / defense: contract front end, no state code or CO on an installation', () => {
  const fd = { 'project.type': k('federal_defense'), 'project.state': k('TX'), 'project.scope': k('new_construction'), 'project.gross_sqft': k(80000), 'project.stories': k(2), 'project.target_start': k('2026-03-02'), 'design.drawings': k(true), 'design.percent': k(100) }
  it('APP, QC Plan, baseline NAS, preconstruction conference and submittal register come first', () => {
    const g = gen(fd)
    expectSound(g)
    const mob = g.activities.find(a => a.category === 'mobilization')!.id
    for (const id of ['reg-us-fed-precon', 'reg-us-em385-app', 'reg-us-ufgs-qc-plan', 'reg-us-ufgs-submittal-register']) {
      expect(byId(g, id), id).toBeDefined()
      expect(g.links.some(l => l.from === id && l.to === mob), `${id} → mobilization`).toBe(true)
    }
    expect(byId(g, 'reg-us-em385-app')!.name).toMatch(/EM 385-1-1/)
    expect(byId(g, 'reg-us-ufgs-qc-plan')!.name).toMatch(/01 45 00/)
    expect(byId(g, 'reg-us-ufgs-nas')!.name).toMatch(/01 32 17/)
    expect(byId(g, 'reg-us-ufc-4-010-06')).toBeDefined()
    expect(byId(g, 'reg-us-baba')).toBeDefined()
    expect(g.assumptions.some(a => /UFC 4-010-06/.test(a.text))).toBe(true)
    expect(g.assumptions.some(a => /BABA/.test(a.text))).toBe(true)
  })
  it('drops state building-code and certificate-of-occupancy steps on the installation', () => {
    const b = questionBank({ answers: fd })
    const ids = [...b.permits, ...b.regulations].map(x => x.id)
    for (const id of ['tx-tdlr-tas', 'tx-ras-inspection', 'tx-tdlr-elevator', 'tx-building', 'def-special-inspections']) expect(ids).not.toContain(id)
    const g = gen(fd)
    expect(names(g)).not.toMatch(/certificate of occupancy|TDLR|state\/AHJ/i)
    expect(g.activities.find(a => a.category === 'inspections' && a.id.startsWith('t-'))!.name).toMatch(/DD Form 1354/)
    // A federally funded office NOT on federal property keeps the state code and the CO.
    const office = { ...fd, 'project.type': k('commercial_office'), 'project.federal': k(true), 'project.federal_installation': k(false) }
    const ob = questionBank({ answers: office })
    expect([...ob.permits, ...ob.regulations].map(x => x.id)).toEqual(expect.arrayContaining(['tx-ras-inspection', 'def-special-inspections']))
    expect(names(gen(office))).toMatch(/certificate of occupancy/)
  })
  it('asks about structural steel and RTUs', () => {
    const ll = questionBank({ answers: fd }).longLead.map(i => i.id)
    expect(ll).toEqual(expect.arrayContaining(['structural-steel', 'rtu']))
  })
})

describe('5. New project types', () => {
  const variants: [string, Record<string, Answer>][] = [
    ['aviation', {}], ['aviation', { 'aviation.area': k('landside') }], ['aviation', { 'aviation.area': k('both'), 'project.scope': k('renovation') }],
    ['marine_civil_works', {}], ['marine_civil_works', { 'marine.scope': k('marine_structure') }],
    ['marine_civil_works', { 'marine.scope': k('tunnel') }], ['marine_civil_works', { 'marine.scope': k('tunnel'), 'marine.tunnel_method': k('drill_blast') }],
    ['environmental_remediation', {}], ['environmental_remediation', { 'remediation.groundwater': k(true) }],
    ['epc_industrial', {}], ['epc_industrial', { 'epc.delivery': k('epcm'), 'design.percent': k(0), 'design.drawings': k(false) }],
  ]
  it.each(variants)('%s %j: connected network, DCMA logic checks pass, civil phase names', (type, extra) => {
    const g = gen(civil(type, extra))
    expectSound(g)
    const wbs = buildWbs(g, 'Pilot').nodes.map(n => n.name).join(' | ')
    expect(wbs).not.toMatch(/MEP|Interiors|Building/)
    expect(names(g)).not.toMatch(/drywall|\broofing|curtain wall|dried-in/i)
  })
  it('aviation airside: CSPP, NAVAID agreement and flight check before reopening', () => {
    const g = gen(civil('aviation'))
    const permits = g.activities.filter(a => a.id.startsWith('permit-')).map(a => a.id)
    expect(permits).toEqual(expect.arrayContaining(['permit-us-faa-cspp', 'permit-us-faa-navaid-agreement']))
    expect(g.links.some(l => l.from === 'permit-us-faa-cspp' && l.to === 't-traffic_control')).toBe(true)
    expect(g.links.some(l => l.from === 'permit-us-faa-navaid-agreement' && l.to.startsWith('t-controls_scada'))).toBe(true)
    expect(predsOf(g, 't-cutover')).toContain('t-flight_check')
    expect(byId(g, 't-flight_check')!.name).toMatch(/flight inspection/)
    const land = questionBank({ answers: civil('aviation', { 'aviation.area': k('landside') }) }).permits.map(p => p.id)
    expect(land).not.toContain('us-faa-cspp')
  })
  it('marine: cofferdam, dewatering, mass-concrete monoliths, gate machinery; tunnels by TBM or drill-and-blast', () => {
    const lock = gen(civil('marine_civil_works'))
    for (const id of ['t-in_water_work', 't-dewatering', 't-monoliths_base', 't-monoliths_walls', 't-embedded_metals', 't-mechanical_equipment', 't-cofferdam_removal']) expect(byId(lock, id), id).toBeDefined()
    expect(preds(lock, all(lock, 't-mechanical_equipment')[0].id)).toContain('ll-civ-gate-machinery-fab')
    expect(byId(lock, 't-base_cure')!.calendarId).toBe('cal-7d')
    const tbm = gen(civil('marine_civil_works', { 'marine.scope': k('tunnel') }))
    expect(byId(tbm, 't-tbm_mining')).toBeDefined()
    expect(preds(tbm, all(tbm, 't-tunneling')[0].id)).toContain('ll-civ-tbm-fab')
    expect(tbm.activities.some(a => a.category === 'in_water_work')).toBe(false)
    const db = gen(civil('marine_civil_works', { 'marine.scope': k('tunnel'), 'marine.tunnel_method': k('drill_blast') }))
    expect(byId(db, 't-tunnel_bench')).toBeDefined()
    expect(db.activities.some(a => a.id === 'permit-us-blasting-permit')).toBe(true)
    // In-water window applies to the cofferdam and its removal.
    const w = gen(civil('marine_civil_works', { 'civil.inwater_open': k('2026-07-01'), 'civil.inwater_close': k('2026-11-30') }))
    expect(all(w, 't-in_water_work').some(a => a.constraint)).toBe(true)
    expect(all(w, 't-cofferdam_removal').some(a => a.constraint)).toBe(true)
  })
  it('remediation: work plans and UFP-QAPP, regulator concurrence, excavation / T&D, confirmation sampling with lab turnaround', () => {
    const g = gen(civil('environmental_remediation'))
    expect(predsOf(g, 't-regulator_review')).toEqual(expect.arrayContaining(['t-work_plans', 't-qapp']))
    expect(byId(g, 't-regulator_review')!.calendarId).toBe('cal-7d')
    expect(predsOf(g, 't-mobilization')).toContain('t-concurrence')
    expect(predsOf(g, 't-confirmation_lab')).toContain('t-confirmation_sampling')
    expect(byId(g, 't-confirmation_lab')!.calendarId).toBe('cal-7d')
    expect(predsOf(g, 't-transport_disposal')).toContain('t-waste_lab')
    expect(g.links.some(l => l.from === 'permit-us-waste-disposal-approval' && l.to.startsWith('t-remediation'))).toBe(true)
  })
  it('EPC: FEED → P&IDs → HAZOP → IFC, long-lead POs off the process design basis, heavy lifts, hydrotest by system, MC, commissioning, startup', () => {
    const g = gen(civil('epc_industrial', { 'design.drawings': k(false), 'design.percent': k(0), 'epc.hydrotest_systems': k(3) }))
    expectSound(g)
    expect(byId(g, 't-design_sd')!.name).toMatch(/process design basis/i)
    expect(byId(g, 't-design_dd')!.name).toMatch(/P&IDs/)
    expect(predsOf(g, 't-hazop')).toEqual(expect.arrayContaining([expect.stringMatching(/design_dd/)]))
    expect(predsOf(g, 't-ifc_piping')).toContain('t-hazop')
    expect(predsOf(g, 't-ll_po_award')[0]).toMatch(/design_sd/)
    // Long-lead submittals start from the PO award, not from IFC drawings.
    expect(preds(g, 'll-civ-process-vessels-sub')).toEqual(['t-ll_po_award'])
    expect(preds(g, all(g, 't-process_equipment')[0].id)).toContain('ll-civ-process-vessels-fab')
    expect(byId(g, 't-process_equipment')!.name).toMatch(/Heavy lifts/)
    // Hydrotest, MC and commissioning run system by system in parallel (not one serial chain).
    expect(predsOf(g, 't-hydrotest_2')).not.toContain('t-hydrotest_1')
    for (const i of [1, 2, 3]) {
      expect(predsOf(g, `t-mc_${i}`)).toContain(`t-hydrotest_${i}`)
      expect(predsOf(g, `t-commissioning_${i}`)).toContain(`t-mc_${i}`)
      expect(predsOf(g, 't-mc')).toContain(`t-mc_${i}`)
    }
    const chain = ['t-mc', 't-commissioning', 't-inspections', 't-startup_testing']
    for (let i = 1; i < chain.length; i++) expect(predsOf(g, chain[i])).toContain(chain[i - 1])
    expect(byId(g, 't-inspections')!.name).toMatch(/PSSR/)
    const epcm = gen(civil('epc_industrial', { 'epc.delivery': k('epcm') }))
    expect(predsOf(epcm, 't-mobilization')).toContain('t-construction_contracts')
    // The mechanical-completion target lands on MC, not on the PSSR that shares its category.
    const target = gen(civil('epc_industrial', { 'milestone.mechanical_completion.target': k('2029-01-01') }))
    expect(target.milestoneTargets!.find(m => m.key === 'mechanical_completion')!.activityId).toMatch(/^t-mc/)
  })
})

describe('6. Upload categories: highway schedules read as civil work', () => {
  it('road vocabulary: paving / base, signals, seeding, utilities, E&S, restoration, cure', () => {
    const road = { roadway: true }
    expect(classifyActivity('Asphalt paving - mainline', '', road).category).toBe('roadway')
    expect(classifyActivity('Aggregate base course', '', road).category).toBe('roadway')
    expect(classifyActivity('Install traffic signals at SR 9', '', road).category).toBe('signals_lighting')
    expect(classifyActivity('Electrical conduit & pull boxes', '', road).category).toBe('signals_lighting')
    expect(classifyActivity('Permanent seeding & mulch', '', road).category).toBe('restoration')
    expect(classifyActivity('Landscaping', '', road).category).toBe('restoration')
    expect(classifyActivity('Water main relocation', '', road).category).toBe('row_utilities')
    expect(classifyActivity('Sanitary sewer', '', road).category).toBe('utilities_site')
    expect(classifyActivity('Install silt fence & inlet protection', '', road).category).toBe('erosion_control')
    expect(classifyActivity('Cure deck - Stage 2', '', road).category).toBe('concrete_cure')
    expect(classifyActivity('Pour deck span 1', '', road).category).toBe('deck')
    expect(classifyActivity('Paint structural steel', '', road).category).toBe('superstructure')
    expect(classifyActivity('Deck waterproofing membrane', '', road).category).toBe('deck')
    // The same names on a building keep building meanings; biological seeding stays startup.
    expect(classifyActivity('Roof membrane', '').category).toBe('roofing')
    expect(classifyActivity('Electrical rough-in', '').category).toBe('mep_rough')
    expect(classifyActivity('Biological seeding & acclimation', '').category).toBe('startup_testing')
  })
  it('an untyped upload that is mostly road work is classified with the road vocabulary', () => {
    const acts = ['MOT Stage 1 traffic switch', 'Clearing & grubbing', 'Culvert extension', 'Set girders span 1', 'Pour bridge deck', 'Asphalt paving', 'Permanent seeding', 'Electrical conduit']
      .map(name => ({ name }))
    const r = classifySchedule(acts)
    expect(r.roadway).toBe(true)
    expect(r.results[5].category).toBe('roadway')
    expect(r.results[7].category).toBe('signals_lighting')
    const office = classifySchedule(['Footings', 'Steel erection', 'Roofing', 'Electrical rough-in', 'Drywall', 'Paint'].map(name => ({ name })))
    expect(office.roadway).toBe(false)
    expect(office.results[3].category).toBe('mep_rough')
    expect(classifySchedule([{ name: 'Asphalt paving' }], 'aviation').results[0].category).toBe('roadway')
  })
})
