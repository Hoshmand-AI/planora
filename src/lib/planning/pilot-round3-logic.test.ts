// Round-3 pilot findings on generated plans: logic integrity, EPC parallelism, scope answers, the
// plan grade on late plans, plan-editor constraints and bridge in-water windows. One block per finding.
import { describe, expect, it } from 'vitest'
import type { Answer, AnswerValue, GeneratedSchedule } from './types'
import { PROJECT_TYPES, isCivilType } from './types'
import { generateSchedule } from './generator'
import { questionBank } from './elicitation'
import { checkPlanLogic } from './logic-check'
import { cappedGrade, evaluatePlan, LATE_THRESHOLD_DAYS, publishBlockers, toAnalyzable } from './evaluation'
import { applyEdit, EditError } from './overrides'
import { runDcma } from '@/lib/analysis/dcma'
import { exportXer } from '@/lib/export/xer'

const AT = '2026-01-01T00:00:00.000Z'
const TODAY = '2026-01-15'
const k = (value: AnswerValue): Answer => ({ status: 'known', value, answeredAt: AT })
const out = (id: string): Record<string, Answer> => ({ [`procure.${id}.status`]: k('not_in_scope') })
const building = (type: string, extra: Record<string, Answer> = {}): Record<string, Answer> => ({
  'project.type': k(type), 'project.state': k('TX'), 'project.scope': k('new_construction'), 'project.gross_sqft': k(120000), 'project.stories': k(4),
  'project.target_start': k('2026-03-02'), 'project.federal': k(false), 'design.drawings': k(true), 'design.percent': k(100), ...extra,
})
const civil = (type: string, extra: Record<string, Answer> = {}): Record<string, Answer> => ({
  'project.type': k(type), 'project.state': k('IL'), 'project.scope': k('new_construction'), 'project.value_musd': k(60),
  'project.target_start': k('2026-03-02'), 'project.delivery': k('db'), 'design.drawings': k(true), 'design.percent': k(100), ...extra,
})
const gen = (answers: Record<string, Answer>) => generateSchedule({ answers, today: TODAY })
const all = (g: GeneratedSchedule, id: string) => g.activities.filter(a => a.id === id || a.id.startsWith(`${id}#`))
const preds = (g: GeneratedSchedule, id: string) => g.links.filter(l => l.to === id).map(l => l.from)
const predsOf = (g: GeneratedSchedule, id: string) => preds(g, all(g, id)[0].id).map(p => p.replace(/#\d+$/, ''))
const names = (g: GeneratedSchedule) => g.activities.map(a => a.name).join(' | ')
const ef = (g: GeneratedSchedule, id: string) => g.cpm!.times[id].earlyFinish
const months = (g: GeneratedSchedule) => {
  const sc = g.activities.find(a => a.category === 'substantial_completion')!
  return (Date.parse(ef(g, sc.id)) - Date.parse(g.projectStart)) / (30.4 * 86_400_000)
}

/** Every project type × scope × design status × region, plus the civil network options. */
function matrix(): [string, Record<string, Answer>][] {
  const rows: [string, Record<string, Answer>][] = []
  for (const t of PROJECT_TYPES) {
    for (const scope of ['new_construction', 'renovation', 'renovation_occupied', 'addition']) {
      for (const pct of [100, 0]) {
        for (const state of ['TX', 'CA', 'IL']) {
          const base = isCivilType(t) ? civil(t, { 'project.state': k(state) }) : building(t, { 'project.state': k(state) })
          rows.push([`${t} ${scope} ${pct}% ${state}`, { ...base, 'project.scope': k(scope), 'design.percent': k(pct), 'design.drawings': k(pct > 0) }])
        }
      }
    }
  }
  const options: [string, Record<string, Answer>][] = [
    ['highway_bridge', { 'civil.mot_phases': k(3), 'civil.utilities': k('by_contractor'), 'civil.inwater_open': k('2026-06-01'), 'civil.inwater_close': k('2026-10-31') }],
    ['highway_bridge', { ...out('civ-steel-girders'), ...out('civ-precast-girders') }],
    ['highway_bridge', { 'permit.us-usace-404-bridge.status': k('not_required'), 'civil.utilities': k('none') }],
    ['transit_rail', { 'transit.guideway': k('elevated_segmental'), 'transit.stations': k(3) }],
    ['transit_rail', { 'project.scope': k('renovation'), ...out('civ-special-trackwork') }],
    ['transit_rail', { 'transit.stations': k(0) }],
    ['water_wastewater', { 'ww.structures': k(12), 'ww.facility': k('water_treatment') }],
    ['water_wastewater', { 'ww.structures': k(30), 'ww.facility': k('pump_station') }],
    ['aviation', { 'aviation.area': k('both') }],
    ['marine_civil_works', { 'marine.scope': k('tunnel'), 'marine.tunnel_method': k('drill_blast') }],
    ['marine_civil_works', { 'marine.scope': k('marine_structure') }],
    ['environmental_remediation', { 'remediation.groundwater': k(true) }],
    ['epc_industrial', { 'epc.delivery': k('epcm'), 'epc.heavy_lifts': k(false), 'epc.hydrotest_systems': k(1) }],
    ['epc_industrial', { 'epc.hydrotest_systems': k(6), 'design.percent': k(0), 'design.drawings': k(false), 'project.value_musd': k(250) }],
  ]
  for (const [t, extra] of options) rows.push([`${t} ${JSON.stringify(extra)}`, civil(t, extra)])
  rows.push(['data_center 300k sf, curtain wall', building('data_center', { 'project.gross_sqft': k(300000), 'envelope.curtain_wall': k(true) })])
  rows.push(['k12_school CA (DSA)', building('k12_school', { 'project.state': k('CA') })])
  rows.push(['interiors_ti 3 floors', building('interiors_ti', { 'project.floors': k('3-5') })])
  return rows
}

describe('1. Logic integrity across every template, project type and option', () => {
  it.each(matrix())('%s: no open ends, no work tied only to completion, phase order holds', (_label, answers) => {
    const g = gen(answers)
    expect(checkPlanLogic(g).map(i => `[${i.rule}] ${i.text}`)).toEqual([])
    expect(g.cpm!.cycles).toEqual([])
    const d = runDcma(toAnalyzable(g))
    for (const id of [1, 2, 3, 4, 5, 9, 12]) expect(`#${id} ${d.checks.find(x => x.id === id)!.result}`).toBe(`#${id} pass`)
  })

  it('the validator catches a segment tied only to substantial completion, and commissioning ahead of dry-in', () => {
    const g = structuredClone(gen(building('multifamily')))
    const seg = g.activities.find(a => a.id === 't-foundations#2') ?? g.activities.find(a => a.category === 'foundations')!
    const sc = g.activities.find(a => a.category === 'substantial_completion')!
    g.links = g.links.filter(l => l.from !== seg.id)
    g.links.push({ id: `${seg.id}>${sc.id}`, from: seg.id, to: sc.id, type: 'FS', lag: 0, rationale: { summary: 'x', sources: [], confidence: 'low' } })
    const cx = g.activities.find(a => a.id.startsWith('t-commissioning'))!
    g.links = g.links.filter(l => l.to !== cx.id)
    g.links.push({ id: `ntp>${cx.id}`, from: 'ntp', to: cx.id, type: 'FS', lag: 0, rationale: { summary: 'x', sources: [], confidence: 'low' } })
    const issues = checkPlanLogic(g)
    expect(issues.some(i => i.rule === 'completion_only' && i.activityId === seg.id)).toBe(true)
    expect(issues.some(i => i.rule === 'phase_order' && i.activityId === cx.id && /dried-in/.test(i.text))).toBe(true)
    expect(issues.some(i => i.rule === 'phase_order' && i.activityId === cx.id && /permanent power/.test(i.text))).toBe(true)
  })

  it('split foundation / structure / MEP / framing segments always feed technical work', () => {
    for (const [type, extra] of [['multifamily', {}], ['warehouse_industrial', {}], ['lab_research', {}], ['federal_defense', { 'project.federal': k(true) }], ['interiors_ti', { 'project.scope': k('renovation') }]] as const) {
      const g = gen(building(type, extra))
      const sc = g.activities.find(a => a.category === 'substantial_completion')!.id
      for (const a of g.activities.filter(x => /^t-(foundations|structure_|mep_rough|framing_drywall|demolition|earthwork)/.test(x.id))) {
        const s = g.links.filter(l => l.from === a.id).map(l => l.to)
        expect(s.filter(x => x !== sc && x !== 'contingency').length, `${type}: ${a.name}`).toBeGreaterThan(0)
      }
    }
  })

  it('commissioning and TAB follow dry-in and permanent power on every building type', () => {
    for (const t of PROJECT_TYPES.filter(x => !isCivilType(x))) {
      const g = gen(building(t))
      const issues = checkPlanLogic(g).filter(i => i.rule === 'phase_order')
      expect(issues, t).toEqual([])
      const dry = g.activities.find(a => a.id === 't-dry_in')
      if (!dry) continue
      for (const a of g.activities.filter(x => x.category === 'commissioning' && x.id !== 'dc-l1')) {
        expect(g.cpm!.times[a.id].earlyStart >= ef(g, dry.id), `${t}: ${a.name}`).toBe(true)
      }
    }
  })

  it('data center: substation energized after transformer and switchgear delivery; SC driven by IST, not finishes', () => {
    const g = gen(building('data_center', { 'project.gross_sqft': k(200000) }))
    expect(preds(g, 'dc-substation-energize').map(p => p.replace(/#\d+$/, ''))).toEqual(expect.arrayContaining(['dc-substation', 'll-padmount-transformer-fab', 'll-mv-switchgear-fab']))
    expect(preds(g, all(g, 't-electrical_service')[0].id)).toContain('dc-substation-energize')
    // Committed deliveries feed energization too.
    const d = gen(building('data_center', { 'procure.mv-switchgear.status': k('released'), 'procure.mv-switchgear.delivery': k('2027-06-01') }))
    expect(preds(d, 'dc-substation-energize')).toContain('ll-mv-switchgear-delivered')
    // What drives substantial completion is L5 IST; the punch list and the finishes come before it.
    const sc = g.activities.find(a => a.category === 'substantial_completion')!
    const scPreds = preds(g, sc.id).flatMap(p => (p === 'contingency' ? preds(g, p) : [p]))
    const driver = scPreds.sort((x, y) => ef(g, y).localeCompare(ef(g, x)))[0]
    expect(driver).toBe('t-commissioning')
    expect(preds(g, 't-commissioning')).toContain('t-punchlist')
    expect(g.cpm!.criticalPath).toContain('t-commissioning')
    expect(g.cpm!.criticalPath.some(id => id.startsWith('t-finishes'))).toBe(false)
  })
})

describe('2. EPC industrial: engineering by discipline, construction by area, systems in parallel', () => {
  it('mid-size EPC lands in 24–36 months from NTP (with engineering), not a serial 5-year schedule', () => {
    for (const value of [60, 150]) {
      const g = gen(civil('epc_industrial', { 'project.value_musd': k(value), 'design.percent': k(0), 'design.drawings': k(false) }))
      expect(months(g), `$${value}M`).toBeGreaterThanOrEqual(24)
      expect(months(g), `$${value}M`).toBeLessThanOrEqual(36)
    }
    const big = gen(civil('epc_industrial', { 'project.value_musd': k(600), 'design.percent': k(0), 'design.drawings': k(false) }))
    expect(months(big)).toBeLessThan(54)
  })
  it('construction areas and test systems run in parallel', () => {
    const g = gen(civil('epc_industrial', { 'epc.hydrotest_systems': k(4), 'design.percent': k(0), 'design.drawings': k(false) }))
    const es = (id: string) => g.cpm!.times[all(g, id)[0].id].earlyStart
    // Two areas: foundations and steel start together with separate crews.
    expect(es('t-foundations')).toBe(es('t-foundations_a2'))
    expect(all(g, 't-structure_steel_a2').length).toBeGreaterThan(0)
    // Piping by system: systems in different areas start together; hydrotests are not chained.
    expect(es('t-pipeline')).toBe(es('t-pipeline_s2'))
    for (const i of [2, 3, 4]) expect(predsOf(g, `t-hydrotest_${i}`)).not.toContain(`t-hydrotest_${i - 1}`)
    for (const i of [1, 2, 3, 4]) expect(predsOf(g, `t-commissioning_${i}`)).toEqual([`t-mc_${i}`])
    // Systems overlap in time: system 2 is tested and commissioned while system 1 still is.
    const span = (id: string) => ({ s: g.cpm!.times[all(g, id)[0].id].earlyStart, f: ef(g, all(g, id).slice(-1)[0].id) })
    for (const step of ['hydrotest', 'commissioning']) expect(span(`t-${step}_2`).s < span(`t-${step}_1`).f, step).toBe(true)
    // Engineering overlaps: IFC piping is issued off the vendor data, not after the civil IFC package.
    expect(predsOf(g, 't-ifc_piping')).toEqual(expect.arrayContaining(['t-hazop', 't-vendor_data']))
    expect(predsOf(g, 't-ifc_piping')).not.toContain('review-design_cd')
    // Equipment deliveries gate every area that sets equipment.
    for (const id of ['t-set_equipment', 't-set_equipment_a2', 't-process_equipment']) expect(preds(g, all(g, id)[0].id), id).toContain('ll-civ-process-vessels-fab')
  })
  it('design complete: vendor data still feeds the work (no open end)', () => {
    const g = gen(civil('epc_industrial'))
    expect(g.links.some(l => l.from === 't-vendor_data' && !l.rationale.sources.some(s => s.label.startsWith('Logic closure')))).toBe(true)
    expect(checkPlanLogic(g)).toEqual([])
  })
})

describe('3. Scope answers are honored', () => {
  it('bridge with girders not in scope: no girder erection (bearings only, or nothing)', () => {
    const g = gen(civil('highway_bridge', { ...out('civ-steel-girders'), ...out('civ-precast-girders') }))
    expect(names(g)).not.toMatch(/set girders|girder erection/i)
    const sup = g.activities.filter(a => a.category === 'superstructure')
    expect(sup.length).toBeGreaterThan(0)
    for (const a of sup) expect(a.name).toMatch(/^Install bridge bearings/i)
    const none = gen(civil('highway_bridge', { ...out('civ-steel-girders'), ...out('civ-precast-girders'), ...out('civ-bearings') }))
    expect(none.activities.some(a => a.category === 'superstructure')).toBe(false)
    expect(checkPlanLogic(none)).toEqual([])
    // One girder type out (precast used): girders are still set.
    expect(names(gen(civil('highway_bridge', out('civ-steel-girders'))))).toMatch(/Set girders/)
  })
  it('transit station rehab with trackwork not in scope: no track civil work and no "Track complete" question', () => {
    const answers = civil('transit_rail', { 'project.scope': k('renovation'), 'transit.stations': k(2), ...out('civ-special-trackwork') })
    const g = gen(answers)
    for (const id of ['t-earthwork', 't-drainage', 't-substructure', 't-track_systems']) expect(all(g, id), id).toEqual([])
    expect(names(g)).not.toMatch(/subgrade|embankment|track foundations|track drainage/i)
    expect(all(g, 't-station_structure').length).toBeGreaterThan(0)
    expect(questionBank({ answers }).all.some(q => q.id === 'milestone.track.target')).toBe(false)
    expect(questionBank({ answers: civil('transit_rail') }).all.some(q => q.id === 'milestone.track.target')).toBe(true)
    expect(g.assumptions.some(a => /Track & rail systems removed/.test(a.text) && /track drainage/.test(a.text))).toBe(true)
    expect(checkPlanLogic(g)).toEqual([])
  })
  it('water / wastewater: up to 12 structures planned individually; a larger count is capped with a stated assumption', () => {
    const ten = gen(civil('water_wastewater', { 'ww.structures': k(10) }))
    expect(ten.activities.filter(a => /_leak$/.test(a.id.replace(/#\d+$/, '')) && !a.id.includes('#2')).length).toBe(10)
    expect(ten.assumptions.some(a => a.questionId === 'ww.structures' && /capped|details 12/.test(a.text))).toBe(false)
    const thirty = gen(civil('water_wastewater', { 'ww.structures': k(30) }))
    expect(all(thirty, 't-structure_12_leak').length).toBeGreaterThan(0)
    expect(all(thirty, 't-structure_13_leak')).toEqual([])
    expect(thirty.assumptions.some(a => a.questionId === 'ww.structures' && /30 process structures/.test(a.text) && /12 structures/.test(a.text))).toBe(true)
    // Several concrete crews: structure 2 does not wait for structure 1 when there are 5+ structures.
    expect(predsOf(ten, 't-structure_2')).not.toContain('t-process_structures')
  })
  it('California DSA K-12: no certificate of occupancy; DSA certification is one activity, not split by area', () => {
    const g = gen(building('k12_school', { 'project.state': k('CA') }))
    expect(names(g)).not.toMatch(/certificate of occupancy/i)
    expect(g.activities.find(a => a.category === 'inspections' && a.id.startsWith('t-'))!.name).toMatch(/DSA/)
    const dsa = g.activities.filter(a => a.id.startsWith('reg-ca-dsa-closeout'))
    expect(dsa.map(a => a.id)).toEqual(['reg-ca-dsa-closeout'])
    expect(dsa[0].name).not.toMatch(/Area \d/)
    // A Texas school keeps its certificate of occupancy.
    expect(names(gen(building('k12_school')))).toMatch(/certificate of occupancy/i)
    // DSA answered not required (private school): local CO again.
    expect(names(gen(building('k12_school', { 'project.state': k('CA'), 'permit.ca-dsa.status': k('not_required') })))).toMatch(/certificate of occupancy/i)
  })
})

describe('4. Plan grade and publish blockers', () => {
  const base = building('commercial_office')
  it('a forecast that misses the required finish by more than the threshold caps the grade and blocks publish', () => {
    const g0 = gen(base)
    const finish = g0.cpm!.projectFinish
    const shift = (d: string, days: number) => new Date(Date.parse(d) + days * 86_400_000).toISOString().slice(0, 10)
    const onTime = { ...base, 'project.required_finish': k(shift(finish, 10)) }
    expect(publishBlockers(gen(onTime), onTime)).toEqual([])
    const slightly = { ...base, 'project.required_finish': k(shift(finish, -(LATE_THRESHOLD_DAYS - 5))) }
    expect(publishBlockers(gen(slightly), slightly)).toEqual([])
    const late = { ...base, 'project.required_finish': k(shift(finish, -60)) }
    const gl = gen(late)
    const b = publishBlockers(gl, late)
    expect(b).toHaveLength(1)
    expect(b[0]).toMatchObject({ code: 'late', maxGrade: 'C' })
    expect(b[0].days!).toBeGreaterThan(LATE_THRESHOLD_DAYS)
    const ev = evaluatePlan(gl, late, null, [{ at: '2999-01-01T00:00:00.000Z', by: 'Rev', verdict: 'approve', comment: 'ok' } as never])
    expect(['C', 'D']).toContain(ev.grade)
    expect(ev.blockers).toEqual(b)
    expect(ev.findings[0]).toMatch(/^Grade capped at C/)
    const veryLate = { ...base, 'project.required_finish': k(shift(finish, -200)) }
    expect(publishBlockers(gen(veryLate), veryLate)[0].maxGrade).toBe('D')
    expect(evaluatePlan(gen(veryLate), veryLate, null, []).grade).toBe('D')
  })
  it('a late contractual milestone target counts too', () => {
    const answers = { ...base, 'milestone.substantial_completion.target': k('2026-06-01') }
    const b = publishBlockers(gen(answers), answers)
    expect(b.map(x => x.code)).toEqual(['late'])
    expect(b[0].text).toMatch(/Substantial completion/)
  })
  it('a custom project type with no matching template caps the grade', () => {
    const answers = { ...base, 'project.type': { ...k('Cannabis grow facility'), custom: true } }
    const g = gen(answers)
    const b = publishBlockers(g, answers)
    expect(b.map(x => x.code)).toEqual(['no_template'])
    expect(cappedGrade('A', b)).toBe('C')
    expect(['C', 'D']).toContain(evaluatePlan(g, answers, null, []).grade)
  })
  it('cappedGrade never improves a grade', () => {
    expect(cappedGrade('D', [{ code: 'no_template', text: '', maxGrade: 'C' }])).toBe('D')
    expect(cappedGrade('B', [{ code: 'late', text: '', maxGrade: 'C' }, { code: 'late', text: '', maxGrade: 'D' }])).toBe('D')
  })
})

describe('5. Plan editor: constraint edits', () => {
  const g0 = gen(building('commercial_office'))
  const target = g0.activities.find(a => a.id.startsWith('t-roofing'))!
  it('sets, validates, records and clears a constraint; the CPM honors it and exports carry it', () => {
    const later = new Date(Date.parse(g0.cpm!.times[target.id].earlyStart) + 90 * 86_400_000).toISOString().slice(0, 10)
    const { schedule, impact, summary } = applyEdit(g0, { kind: 'constraint', activityId: target.id, constraint: { type: 'SNET', date: later }, reason: 'Roofer not available before this date' }, 'Ana')
    const a = schedule.activities.find(x => x.id === target.id)!
    expect(a.constraint).toEqual({ type: 'SNET', date: later })
    expect(a.overrides!.slice(-1)[0]).toMatchObject({ field: 'constraint', from: null, to: { type: 'SNET', date: later }, by: 'Ana', reason: 'Roofer not available before this date' })
    expect(a.rationale.summary).toMatch(/Overridden by Ana/)
    expect(schedule.cpm!.times[target.id].earlyStart >= later).toBe(true)
    expect(impact.finishDeltaDays).toBeGreaterThan(0)
    expect(summary).toMatch(/constraint none → SNET/)
    // Exported to P6 as the primary constraint.
    const xer = exportXer(schedule, 'Pilot')
    expect(xer).toContain('CS_MSOA')
    // Survives regeneration.
    const regen = generateSchedule({ answers: building('commercial_office'), previous: schedule, today: TODAY })
    expect(regen.activities.find(x => x.id === target.id)!.constraint).toEqual({ type: 'SNET', date: later })
    // Clearing it restores the logic dates, and that also survives regeneration.
    const cleared = applyEdit(schedule, { kind: 'constraint', activityId: target.id, constraint: null, reason: 'Roofer confirmed earlier start' }, 'Ana').schedule
    expect(cleared.activities.find(x => x.id === target.id)!.constraint).toBeUndefined()
    expect(cleared.cpm!.projectFinish).toBe(g0.cpm!.projectFinish)
    const regen2 = generateSchedule({ answers: building('commercial_office'), previous: cleared, today: TODAY })
    expect(regen2.activities.find(x => x.id === target.id)!.constraint).toBeUndefined()
  })
  it('accepts SNET, SNLT, FNET, FNLT, MSO and MFO; rejects anything else', () => {
    for (const type of ['SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO'] as const) {
      const r = applyEdit(g0, { kind: 'constraint', activityId: target.id, constraint: { type, date: '2027-01-04' }, reason: 'Contract date' }, 'Ana')
      expect(r.schedule.activities.find(x => x.id === target.id)!.constraint!.type).toBe(type)
    }
    const bad = (constraint: unknown, reason = 'Contract date') => () => applyEdit(g0, { kind: 'constraint', activityId: target.id, constraint: constraint as never, reason }, 'Ana')
    expect(bad({ type: 'SO', date: '2027-01-04' })).toThrow(EditError)
    expect(bad({ type: 'SNET', date: '2027-02-30' })).toThrow(/YYYY-MM-DD/)
    expect(bad({ type: 'SNET', date: '01/04/2027' })).toThrow(/YYYY-MM-DD/)
    expect(bad({ type: 'SNET', date: '2020-01-01' })).toThrow(/before the project start/)
    expect(bad({ type: 'SNET', date: '2027-01-04' }, '')).toThrow(/reason/)
    expect(bad(null)).toThrow(/no constraint to clear/)
    expect(() => applyEdit(g0, { kind: 'constraint', activityId: 'nope', constraint: { type: 'SNET', date: '2027-01-04' }, reason: 'Contract date' }, 'Ana')).toThrow(/not found/)
  })
})

describe('6. Bridge: in-water window as start and finish constraints; substructure cure', () => {
  it('a single in-water activity is held to both the window opening and its close', () => {
    // The work is ready before the window opens: it waits for the window and must be out by its close.
    const g = gen(civil('highway_bridge', { 'project.value_musd': k(20), 'project.target_start': k('2026-11-02'), 'civil.inwater_open': k('2026-09-01'), 'civil.inwater_close': k('2026-11-30') }))
    const iw = all(g, 't-in_water_work_s1')
    expect(iw.map(a => a.id)).toEqual(['t-in_water_work_s1'])
    expect(iw[0].constraint).toEqual({ type: 'FNLT', date: '2027-11-30' })
    const open = g.activities.find(a => a.id === 't-in_water_work_s1-window-opens')!
    expect(open).toMatchObject({ type: 'milestone', constraint: { type: 'SNET', date: '2027-09-01' } })
    expect(preds(g, iw[0].id)).toContain(open.id)
    expect(g.cpm!.times[iw[0].id].earlyStart >= '2027-09-01').toBe(true)
    expect(g.cpm!.times[iw[0].id].earlyFinish <= '2027-11-30').toBe(true)
    expect(checkPlanLogic(g)).toEqual([])
  })
  it('abutments and pier caps cure before bearings and girders are set', () => {
    const g = gen(civil('highway_bridge'))
    for (const k2 of ['abutments_cure_s1', 'piers_cure_s1']) {
      const a = all(g, `t-${k2}`)[0]
      expect(a.category).toBe('concrete_cure')
      expect(a.calendarId).toBe('cal-7d')
      expect(predsOf(g, 't-superstructure_s1')).toContain(`t-${k2}`)
    }
  })
})
