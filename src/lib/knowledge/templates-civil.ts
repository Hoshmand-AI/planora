// Activity networks for civil / infrastructure project types: highway & bridge, transit & rail, water &
// wastewater, power & substation, industrial process, aviation, marine / locks / dams / tunnels,
// environmental remediation and EPC industrial. These are separate from the building catalog: no
// roofing, drywall or elevators-by-floor, and their own sequence (right-of-way and utility relocation,
// traffic staging, in-water work windows, girder fabrication, process startup, outages).
//
// Unlike the building catalog (one activity per category), a civil network can hold several activities
// of one category, each with its own `key`: Stage 1 and Stage 2 decks, a leak test per structure, a
// hydrotest per system. Predecessors name keys. The interview's civil answers (ProjectProfile.civil)
// shape the network: MOT stages, utility status, guideway type, facility and scope variants.
//
// Sizing: civil work is sized by construction value, not floor area. In these templates `perKsf`
// means work days per USD 1 million of construction value (computeTemplateDuration passes the
// value in millions where buildings pass thousands of square feet). Durations are REFERENCE
// DEFAULTS for planning — verify against the contract, the agency's specifications and your crews.

import type { CanonicalCategory, CivilOptions, LinkType, ProjectProfile, ProjectType, TemplateActivity, WorkScope } from '@/lib/planning/types'
import { civilOptionsFrom } from '@/lib/planning/civil-options'
import { phaseOf } from '@/lib/semantic/taxonomy'

type P = { key: string; type: LinkType; lag: number }
const fs = (key: string, lag = 0): P => ({ key, type: 'FS', lag })
const ss = (key: string, lag = 0): P => ({ key, type: 'SS', lag })
const ff = (key: string, lag = 0): P => ({ key, type: 'FF', lag })

type Dur = TemplateActivity['duration']
interface Node {
  key: string
  category: CanonicalCategory
  name: string
  duration: Dur
  preds: P[]
  milestone?: boolean
  note?: string
  scopes?: WorkScope[]
  calendar?: '7d' | 'season'
}

const REHAB: WorkScope[] = ['renovation', 'renovation_occupied', 'addition']
const MS: Dur = { base: 0, min: 0, max: 0 }
const d = (base: number, perM: number, min: number, max: number): Dur => ({ base, perKsf: perM, min, max })
/** A fixed number of days (cure periods, lab turnaround). */
const fixed = (days: number): Dur => ({ base: days, min: days, max: days })
/** Work split over `n` stages / structures: each share is 1/n of the whole, kept above a working minimum. */
const share = (n: number, base: number, perM: number, min: number, max: number): Dur =>
  d(Math.max(min, Math.round(base / n)), Math.round((perM / n) * 1000) / 1000, min, Math.max(min, Math.round(max / n)))

function n(key: string, category: CanonicalCategory, name: string, duration: Dur, preds: P[], opts: Partial<Pick<Node, 'milestone' | 'note' | 'scopes' | 'calendar'>> = {}): Node {
  return { key, category, name, duration, preds, ...opts }
}
/** A node whose key is its category (one activity of that category in the network). */
function c(category: CanonicalCategory, name: string, duration: Dur, preds: P[], opts: Partial<Pick<Node, 'milestone' | 'note' | 'scopes' | 'calendar'>> = {}): Node {
  return n(category, category, name, duration, preds, opts)
}

/* ─── Shared front end and completion ───────────────────── */

interface FrontOpts {
  design?: [string, string, string, string]
  mobilization?: string
  /** Extra predecessors of mobilization (work-plan approval, EPCm contract award) */
  mobilizationAfter?: string[]
}

function front(o: FrontOpts = {}): Node[] {
  const [sd, dd, cd, rev] = o.design ?? ['Preliminary engineering / 30% design', '60% design', '90% / final design (plans, specifications & estimate)', 'Owner / agency design review & comment resolution']
  return [
    c('ntp', 'Notice to Proceed', MS, [], { milestone: true }),
    c('design_sd', sd, d(30, 0.6, 20, 120), [fs('ntp')]),
    c('design_dd', dd, d(35, 0.6, 25, 150), [fs('design_sd')]),
    c('design_cd', cd, d(40, 0.8, 30, 180), [fs('design_dd')]),
    c('design_review', rev, d(25, 0.2, 20, 60), [fs('design_cd')]),
    c('permit_site', 'Environmental & site permits (placeholder)', d(40, 0.2, 20, 120), [fs('design_dd')],
      { note: 'Replaced by the regional and federal permit activities (NEPA, Section 404/401, NPDES, agency agreements).' }),
    c('submittals', 'Submittals & shop drawings — primary materials', d(25, 0.2, 20, 60), [fs('design_review')]),
    c('procurement', 'Fabrication & delivery — primary materials', d(50, 0.6, 40, 200), [fs('submittals')],
      { note: 'Specific long-lead items (girders, special trackwork, pumps, transformers) get their own activities.' }),
    c('mobilization', o.mobilization ?? 'Mobilization, field office & erosion and sediment controls', d(10, 0.05, 5, 25),
      [fs('permit_site'), fs('design_review'), ...(o.mobilizationAfter ?? []).map(k => fs(k))]),
  ]
}

function completion(scName = 'Substantial Completion', extraPreds: string[] = [], closeoutName = 'As-builts, O&M manuals, certified payrolls & closeout'): Node[] {
  return [
    c('substantial_completion', scName, MS, [fs('punchlist'), fs('inspections'), ...extraPreds.map(k => fs(k))], { milestone: true }),
    c('closeout', closeoutName, d(30, 0.1, 20, 60), [fs('substantial_completion')]),
    c('final_completion', 'Final Completion', MS, [fs('closeout')], { milestone: true }),
  ]
}

/* ─── Highway & bridge ───────────────────────────────────── */

function highway(o: CivilOptions): Node[] {
  const S = Math.max(1, o.motStages ?? 1)
  const stage = (s: number) => (S > 1 ? ` — Stage ${s}` : '')
  const out: Node[] = [...front({ mobilization: 'Mobilization & field office' })]
  // Right-of-way certification is a permit activity (skipped when issued / not required); relocations
  // by the utility owners stay in the plan until the interview says they are done or not needed.
  const utilPending = o.utilities !== 'none' && o.utilities !== 'complete'
  if (utilPending) {
    const owners = Math.max(1, o.utilityOwners ?? 2)
    const who = o.utilities === 'by_contractor' ? 'by the contractor (in contract)' : 'by the utility owners'
    out.push(c('row_utilities', `Utility relocations ${who} — ${owners} owner${owners > 1 ? 's' : ''}${o.railroad === 'none' ? '' : ', with railroad coordination'}`,
      d(20 + 10 * (owners - 1), 0.5, 15, 220), [fs('design_dd')],
      { note: 'Utility relocation by others is a frequent driver; confirm each owner\'s relocation schedule.' }))
  }
  out.push(
    c('erosion_control', 'Install perimeter erosion & sediment controls (silt fence, inlet protection, construction entrances)', d(5, 0.05, 3, 15), [fs('mobilization')]),
    c('traffic_control', S > 1 ? 'MOT: install work-zone traffic control, temporary widening & Stage 1 traffic switch' : 'MOT: install work-zone traffic control & detour / lane closures',
      d(10, 0.1, 5, 40), [fs('mobilization')]),
    c('earthwork', 'Clearing & grubbing, excavation & embankment', d(20, 0.6, 15, 150), [fs('erosion_control'), fs('row_utilities'), fs('traffic_control')]),
    c('drainage', 'Drainage: culverts, inlets & storm pipe', d(15, 0.4, 10, 90), [ss('earthwork', 10)]),
  )
  for (let s = 1; s <= S; s++) {
    const sw = s === 1 ? 'traffic_control' : `traffic_switch_s${s}`
    if (s > 1) out.push(n(sw, 'traffic_control', `MOT: Stage ${s} traffic switch (traffic moved onto the Stage ${s - 1} structure)`, d(3, 0.02, 2, 10), [fs(`deck_finish_s${s - 1}`)]))
    const demo = `demolition_s${s}`
    out.push(n(demo, 'demolition', `Demolish existing structure${S > 1 ? ` — Stage ${s} portion` : ''}`, share(S, 15, 0.4, 8, 90), [fs(sw)], { scopes: REHAB }))
    const inWater = `in_water_work_s${s}`
    if (o.inWater !== false) {
      out.push(n(inWater, 'in_water_work', `Cofferdams, dewatering & in-water work${stage(s)} (within the environmental work window)`, share(S, 20, 0.5, 10, 120),
        s === 1 ? [ss('earthwork', 5), fs(demo)] : [fs(sw), fs(demo)],
        { note: 'In-water work is limited to the fish / environmental window set by the permits; the window dates are held as constraints when given.' }))
    }
    const deep = `deep_foundations_s${s}`
    out.push(n(deep, 'deep_foundations', `Piles / drilled shafts${stage(s)}`, share(S, 15, 0.6, 8, 120),
      o.inWater !== false ? [fs(inWater)] : s === 1 ? [ss('earthwork', 10), fs(demo)] : [fs(sw), fs(demo)]))
    out.push(
      n(`abutments_s${s}`, 'substructure', `Abutments & wingwalls${stage(s)} (crew A)`, share(S, 15, 0.5, 8, 110), [fs(deep)]),
      n(`piers_s${s}`, 'substructure', `Piers & pier caps${stage(s)} (crew B, in parallel with crew A)`, share(S, 20, 0.7, 10, 120), [fs(deep)]),
      n(`superstructure_s${s}`, 'superstructure', `Set girders, bearings & diaphragms${stage(s)}`, share(S, 15, 0.5, 8, 90), [fs(`abutments_s${s}`), fs(`piers_s${s}`), fs('procurement')]),
      n(`deck_forms_s${s}`, 'deck', `Deck forming, overhang brackets & screed rails${stage(s)}`, share(S, 10, 0.25, 5, 60), [fs(`superstructure_s${s}`)]),
      n(`deck_rebar_s${s}`, 'deck', `Deck rebar & embedments; pre-pour inspection${stage(s)}`, share(S, 8, 0.2, 4, 45), [fs(`deck_forms_s${s}`)]),
      n(`deck_pour_s${s}`, 'deck', `Deck pour & finish (bridge finishing machine)${stage(s)}`, d(2, 0.02, 1, 5), [fs(`deck_rebar_s${s}`)]),
      n(`deck_cure_s${s}`, 'concrete_cure', `Deck wet cure — 7 calendar days${stage(s)}`, fixed(7), [fs(`deck_pour_s${s}`)],
        { calendar: '7d', note: 'Wet cure runs on calendar days (7-day calendar), weekends included; extend for HPC decks or cold weather per the specifications.' }),
      n(`deck_finish_s${s}`, 'deck', `Barriers / parapets, expansion joints & approach slabs${stage(s)}`, share(S, 10, 0.2, 5, 50), [fs(`deck_cure_s${s}`)]),
    )
  }
  out.push(
    n('roadway_base', 'roadway', 'Approach roadway: subgrade, aggregate base & curb', d(15, 0.4, 10, 120), [fs('drainage')]),
    c('signals_lighting', 'Lighting, signals & ITS devices', d(8, 0.1, 5, 40), [fs('roadway_base')]),
    n('paving', 'roadway', 'HMA / PCC paving — approaches, tie-ins & overlays', d(10, 0.3, 5, 80), [fs('roadway_base'), fs(`deck_finish_s${S}`)], { calendar: 'season' }),
    n('guardrail', 'roadway', 'Guardrail, attenuators & permanent signing', d(5, 0.1, 3, 25), [fs('paving')]),
    c('cutover', 'Final pavement markings & final traffic switch (all lanes open)', d(5, 0.05, 3, 20), [fs('paving'), fs('guardrail'), fs('signals_lighting')], { calendar: 'season' }),
    c('restoration', 'Permanent seeding, mulch & restoration; remove erosion controls', d(5, 0.1, 3, 25), [fs('cutover')], { calendar: 'season' }),
    c('inspections', 'Final inspection, load rating & agency acceptance', d(10, 0, 5, 30), [fs('cutover')]),
    c('punchlist', 'Punch list', d(15, 0.1, 10, 40), [fs('cutover')]),
    ...completion('Substantial Completion', ['restoration']),
  )
  return out
}

/* ─── Transit & rail ─────────────────────────────────────── */

function transit(o: CivilOptions): Node[] {
  const elevated = o.guideway === 'elevated_segmental'
  const N = Math.max(0, o.stations ?? 1)
  const st = `${N} station${N === 1 ? '' : 's'}`
  const out: Node[] = [
    ...front(),
    c('row_utilities', 'Right-of-way, utility relocations & railroad agreements', d(45, 1.0, 30, 260), [fs('design_dd')]),
    c('traffic_control', 'Track access, outage plan & roadway worker protection (flagging)', d(10, 0.05, 5, 30), [fs('mobilization')]),
    c('earthwork', 'Civil: subgrade, embankment & excavation', d(25, 0.6, 15, 180), [fs('mobilization'), fs('row_utilities'), fs('traffic_control')]),
    c('drainage', 'Track drainage & underdrains', d(15, 0.3, 10, 90), [fs('earthwork')]),
  ]
  if (N > 0) {
    out.push(n('general_orders', 'permit_other', 'General orders & track outage approvals for station and tie-in work (operating railroad)', d(30, 0, 20, 60), [fs('design_review')],
      { calendar: '7d', note: 'Outages are requested weeks ahead under the railroad\'s general-order process and granted for nights / weekends; confirm the outage calendar.' }))
  }
  if (!elevated) {
    out.push(
      c('substructure', 'Structures: retaining walls, culverts & track foundations', d(40, 1.0, 30, 300), [ss('earthwork', 20)]),
      c('track_systems', 'Track: ballast, ties, rail & special trackwork', d(30, 0.8, 20, 220), [fs('substructure'), fs('procurement')]),
    )
  } else {
    out.push(
      n('casting_yard', 'mobilization', 'Casting yard setup, segment molds & trial casting', d(30, 0.1, 20, 60), [fs('mobilization')]),
      c('deep_foundations', 'Guideway foundations: drilled shafts & pile caps', d(30, 0.6, 20, 250), [ss('earthwork', 10)]),
      c('substructure', 'Guideway piers & pier caps (parallel crews)', d(40, 0.8, 30, 250), [fs('deep_foundations')]),
      n('gantry', 'superstructure', 'Launching gantry: delivery, assembly & load test', d(25, 0, 20, 40), [ss('substructure', 20), fs('procurement')]),
      n('segment_casting', 'superstructure', 'Cast precast segments (match-cast, cure & store)', d(60, 1.0, 40, 300), [fs('casting_yard'), fs('procurement')]),
      n('bearings', 'superstructure', 'Pier bearings & pier-head segments', d(15, 0.2, 10, 60), [fs('substructure')]),
      n('span_erection', 'superstructure', 'Segment erection & post-tensioning (span-by-span with the launching gantry)', d(60, 1.2, 40, 300), [fs('gantry'), fs('bearings'), ss('segment_casting', 30)]),
      n('closure_pours', 'deck', 'Closure pours, continuity post-tensioning & guideway plinths', d(20, 0.3, 15, 90), [fs('span_erection')]),
      n('closure_cure', 'concrete_cure', 'Closure-pour & plinth cure — 7 calendar days', fixed(7), [fs('closure_pours')], { calendar: '7d' }),
      c('track_systems', 'Direct-fixation track, rail & special trackwork on the guideway', d(30, 0.6, 20, 200), [fs('closure_cure'), fs('procurement')]),
    )
  }
  if (N > 0) {
    out.push(
      n('station_structure', 'substructure', elevated ? `Elevated station structures: platforms, canopies & mezzanines (${st})` : `Station platforms, canopies & site work (${st})`,
        d(30 + 10 * N, 0.2, 20, 200), [elevated ? fs('substructure') : fs('drainage')]),
      n('platform_edge', 'finishes', `Platform edges: tactile warning strips, gap fillers & ADA boarding areas — under track outages (${st})`, d(8 + 4 * N, 0.05, 8, 80), [fs('station_structure'), fs('general_orders')]),
      c('elevators', `Station ADA elevators & escalators (vertical circulation): install, test & state acceptance (${st})`, d(35 + 10 * N, 0.1, 35, 200), [fs('station_structure'), fs('procurement')],
        { note: 'Elevator and escalator acceptance by the state inspector precedes revenue service; ADA access must be in service at opening.' }),
    )
  }
  out.push(
    c('power_equipment', 'Traction power substations & overhead contact system', d(40, 0.8, 30, 250), [ss('track_systems', 20), fs('procurement')]),
    c('controls_scada', 'Signals, train control & communications', d(45, 0.8, 30, 250), [ss('track_systems', 30)]),
    c('cutover', 'Weekend outages: cutovers & tie-ins to the operating line', d(10, 0.1, 5, 40), [ff('track_systems'), ff('controls_scada'), fs('general_orders')]),
    c('startup_testing', 'Systems integration testing & pre-revenue operations', d(40, 0.3, 30, 180), [fs('power_equipment'), fs('controls_scada'), fs('cutover'), fs('drainage'), fs('platform_edge'), fs('elevators')]),
    c('inspections', 'Safety certification & regulator acceptance', d(15, 0.1, 10, 60), [fs('startup_testing')]),
    c('punchlist', 'Punch list', d(15, 0.1, 10, 45), [fs('startup_testing')]),
    ...completion('Substantial Completion — ready for revenue service'),
  )
  return out
}

/* ─── Water & wastewater ─────────────────────────────────── */

function water(o: CivilOptions): Node[] {
  const N = Math.max(1, o.wwStructures ?? 2)
  const facility = o.wwFacility ?? 'wastewater_treatment'
  const pour = (i: number) => (i === 1 ? 'process_structures' : `structure_${i}`)
  const out: Node[] = [
    ...front(),
    c('demolition', 'Demolition of existing process units', d(15, 0.2, 10, 60), [fs('mobilization')], { scopes: REHAB }),
    c('earthwork', 'Excavation, dewatering & shoring', d(20, 0.5, 15, 150), [fs('mobilization'), fs('demolition')]),
    c('pipeline', 'Yard piping, transmission main & crossings', d(30, 1.0, 20, 250), [ss('earthwork', 15)]),
    n('pipe_test', 'pipeline', 'Yard piping pressure tests & disinfection', d(8, 0.1, 5, 25), [fs('pipeline')]),
  ]
  for (let i = 1; i <= N; i++) {
    const of = N > 1 ? `Structure ${i} of ${N}` : 'Process structure'
    out.push(
      n(pour(i), 'process_structures', `${of}: base slab, walls & elevated slabs — form, rebar & pour`, share(N, 60, 1.5, 20, 330), i === 1 ? [ss('earthwork', 10)] : [fs(pour(i - 1))]),
      n(`structure_${i}_cure`, 'concrete_cure', `${of}: cure to design strength before leak testing — 14 calendar days`, fixed(14), [fs(pour(i))], { calendar: '7d' }),
      n(`structure_${i}_leak`, 'process_structures', `${of}: hydrostatic leak test (ACI 350.1) & repairs`, d(7, 0.02, 5, 15), [fs(`structure_${i}_cure`)]),
      n(`structure_${i}_backfill`, 'earthwork', `${of}: backfill & grading around the structure`, d(5, 0.05, 3, 20), [fs(`structure_${i}_leak`)]),
    )
  }
  const lastEquip = N > 1 ? 'process_equipment_rest' : 'process_equipment'
  out.push(
    c('power_equipment', 'Electrical: switchgear, MCCs, VFDs & standby power', d(40, 0.6, 30, 200), [fs('process_structures'), fs('procurement')]),
    c('process_equipment', N > 1 ? 'Install pumps, valves, screens & process equipment — Structure 1' : 'Install pumps, valves, screens & process equipment', d(30, 0.6, 20, 200),
      [fs('structure_1_leak'), fs('procurement')]),
  )
  if (N > 1) {
    out.push(n('process_equipment_rest', 'process_equipment', `Install process equipment — Structures 2–${N}`, d(20, 0.4, 15, 150),
      [fs('process_equipment'), ...Array.from({ length: N - 1 }, (_, j) => fs(`structure_${j + 2}_leak`))]))
  }
  out.push(
    c('controls_scada', 'Instrumentation, controls & SCADA integration', d(40, 0.4, 25, 160), [ss('process_equipment', 20), ss('power_equipment', 20)]),
    c('cutover', 'Tie-ins & shutdowns to the operating system', d(10, 0.1, 5, 40), [fs('pipe_test'), fs(lastEquip)],
      { note: 'Shutdown windows are set by the operator (often low-demand seasons or nights); confirm before committing.' }),
    n('clean_water_test', 'startup_testing', 'Clean-water testing: fill units, functional tests of pumps, valves & controls', d(15, 0.1, 10, 45),
      [fs(lastEquip), fs('power_equipment'), fs('controls_scada')]),
  )
  const beforeStartup = ['clean_water_test', 'cutover']
  if (facility === 'wastewater_treatment') {
    out.push(n('bio_seed', 'startup_testing', 'Biological seeding & process acclimation (seed sludge, ramp up to stable effluent) — calendar days', d(30, 0, 21, 60),
      [fs('clean_water_test'), fs('cutover')], { calendar: '7d', note: 'Biology runs every day; acclimation time depends on temperature and the seed source.' }))
    beforeStartup.push('bio_seed')
  } else if (facility === 'water_treatment') {
    out.push(n('disinfection', 'startup_testing', 'Disinfection & bacteriological sampling (AWWA C651 / C652) — results before service', d(10, 0, 7, 21),
      [fs('clean_water_test'), fs('cutover')], { calendar: '7d' }))
    beforeStartup.push('disinfection')
  }
  out.push(
    c('startup_testing', 'Process startup & performance / acceptance testing', d(30, 0.3, 20, 120), beforeStartup.map(k => fs(k))),
    c('inspections', 'Regulatory inspection & permit to operate / approval to place in service', d(15, 0, 10, 45), [fs('startup_testing')]),
    c('restoration', 'Site paving, seeding & restoration', d(15, 0.2, 10, 60), [fs('pipe_test'), ...Array.from({ length: N }, (_, j) => fs(`structure_${j + 1}_backfill`))]),
    c('punchlist', 'Punch list', d(15, 0.1, 10, 45), [fs('startup_testing')]),
    ...completion('Substantial Completion', ['restoration']),
  )
  return out
}

/* ─── Power, substation & transmission ───────────────────── */

function power(): Node[] {
  return [
    ...front(),
    c('earthwork', 'Site grading, access roads & grounding grid', d(20, 0.4, 10, 120), [fs('mobilization')]),
    c('substructure', 'Foundations: equipment pads, structure & tower foundations', d(30, 0.8, 20, 200), [ss('earthwork', 10)]),
    c('superstructure', 'Steel structures / tower erection', d(20, 0.6, 15, 160), [fs('substructure'), fs('procurement')]),
    c('power_equipment', 'Set & dress transformers, breakers & switchgear', d(30, 0.5, 20, 150), [fs('substructure'), fs('procurement')]),
    c('conductors', 'Bus work, conductor stringing & terminations', d(25, 0.6, 15, 180), [fs('superstructure'), ss('power_equipment', 10)]),
    c('controls_scada', 'Protection & control: relay panels, wiring & SCADA', d(35, 0.5, 25, 150), [ss('power_equipment', 15)]),
    c('startup_testing', 'Testing & commissioning (relay testing, energization checks)', d(25, 0.2, 15, 90), [fs('conductors'), fs('controls_scada'), fs('power_equipment')]),
    c('cutover', 'Outage, tie-in & energization', d(5, 0.05, 3, 20), [fs('startup_testing')],
      { note: 'Outage windows are granted by the utility / ISO and often months ahead; confirm the approved window.' }),
    c('inspections', 'Utility / ISO acceptance', d(10, 0, 5, 30), [fs('cutover')]),
    c('punchlist', 'Punch list', d(10, 0.1, 5, 30), [fs('cutover')]),
    ...completion(),
  ]
}

/* ─── Industrial & process ───────────────────────────────── */

function industrial(): Node[] {
  return [
    ...front(),
    c('earthwork', 'Site preparation, excavation & underground', d(20, 0.3, 15, 150), [fs('mobilization')]),
    c('deep_foundations', 'Piling', d(15, 0.2, 10, 120), [ss('earthwork', 10)]),
    c('foundations', 'Equipment & structure foundations', d(30, 0.4, 20, 200), [fs('deep_foundations')]),
    c('structure_steel', 'Pipe racks & structural steel', d(30, 0.4, 20, 220), [ss('foundations', 20), fs('procurement')]),
    c('process_equipment', 'Set process equipment, vessels & packages', d(30, 0.4, 20, 200), [ss('structure_steel', 20), fs('procurement')]),
    c('pipeline', 'Process piping fabrication, installation & hydrotest', d(60, 1.0, 40, 400), [ss('process_equipment', 15)]),
    c('power_equipment', 'Electrical installation: substation, MCCs & cable', d(50, 0.8, 30, 300), [ss('structure_steel', 30)]),
    c('controls_scada', 'Instrumentation, DCS & controls integration', d(50, 0.6, 30, 300), [ss('pipeline', 30), ss('power_equipment', 30)]),
    c('startup_testing', 'Pre-commissioning, commissioning & startup', d(40, 0.3, 30, 180), [fs('pipeline'), fs('controls_scada'), fs('power_equipment')]),
    c('inspections', 'PSM / regulatory inspections & permits to operate', d(15, 0, 10, 45), [fs('startup_testing')]),
    c('punchlist', 'Punch list', d(15, 0.1, 10, 45), [fs('startup_testing')]),
    ...completion(),
  ]
}

/* ─── Aviation (airside / landside) ──────────────────────── */

function aviation(o: CivilOptions): Node[] {
  const air = o.airportArea !== 'landside'
  const land = o.airportArea !== 'airside'
  const out: Node[] = [
    ...front({
      design: ['Preliminary design & draft CSPP (30%)', '60% design', '90% / final design (plans, specifications & engineer\'s report)', 'Sponsor / FAA design review (AC 150/5370-2 CSPP, AC 150/5300-13 standards)'],
      mobilization: 'Mobilization, field office & badged access / escort setup',
    }),
    c('erosion_control', 'Erosion & sediment controls and FOD controls at haul routes', d(5, 0.05, 3, 15), [fs('mobilization')]),
  ]
  if (air) {
    out.push(
      c('traffic_control', 'Airside phasing per the CSPP: NOTAMs issued, closure barricades, temporary markings & lighting', d(5, 0.05, 3, 15), [fs('mobilization')]),
      c('demolition', 'Pavement removal: milling, PCC panel removal & demolition', d(10, 0.3, 5, 60), [fs('traffic_control')], { scopes: REHAB }),
      c('earthwork', 'Excavation, subgrade preparation & stabilization', d(15, 0.5, 10, 120), [fs('traffic_control'), fs('demolition'), fs('erosion_control')]),
      c('drainage', 'Storm drainage, underdrains & edge drains', d(10, 0.3, 5, 80), [ss('earthwork', 10)]),
      // Lighting is listed before its duct banks so fixture deliveries gate the fixture installation.
      c('signals_lighting', 'Airfield lighting: fixtures, signs, constant-current regulators & ALCMS', d(15, 0.3, 10, 90), [fs('duct_bank'), fs('procurement')]),
      n('duct_bank', 'signals_lighting', 'Airfield lighting duct banks, light bases & cans', d(10, 0.2, 5, 60), [ss('earthwork', 10)]),
      n('base', 'roadway', 'Subbase & base courses (P-154 / P-209 / stabilized base)', d(12, 0.4, 8, 100), [fs('drainage'), fs('duct_bank')]),
      n('paving', 'roadway', 'Airfield paving: PCC (P-501) / HMA (P-401) surface', d(15, 0.5, 10, 150), [fs('base')], { calendar: 'season' }),
      n('paving_cure', 'concrete_cure', 'PCC cure & flexural-strength verification before opening — 14 calendar days', fixed(14), [fs('paving')], { calendar: '7d' }),
      n('grooving', 'roadway', 'Joint sealing, saw-cut grooving & shoulder grading', d(8, 0.1, 5, 40), [fs('paving_cure')]),
      c('controls_scada', 'NAVAID shutdown, relocation & restoration (ILS / PAPI / REIL — FAA Technical Operations)', d(10, 0.1, 5, 40), [fs('traffic_control')],
        { note: 'FAA-owned NAVAIDs are shut down and restored by FAA Tech Ops under a reimbursable agreement; their dates are set by the FAA.' }),
      n('marking', 'roadway', 'Permanent pavement markings (two applications, cure between)', d(5, 0.05, 3, 15), [fs('grooving')], { calendar: 'season' }),
      n('flight_check', 'startup_testing', 'FAA flight inspection (flight check) of NAVAIDs, lighting & approach procedures', d(10, 0, 5, 30),
        [fs('controls_scada'), fs('signals_lighting'), fs('marking')], { calendar: '7d', note: 'Flight checks are scheduled by FAA Flight Program Operations; procedures may need publication cycles.' }),
      c('cutover', 'Part 139 inspection, NOTAM cancellation & reopen runway / taxiway to aircraft', d(2, 0, 1, 5), [fs('flight_check')]),
    )
  }
  if (land) {
    const k = (airKey: string, onlyKey: string) => (air ? airKey : onlyKey)
    out.push(
      n(k('landside_mot', 'traffic_control'), 'traffic_control', 'Landside MOT: terminal roadway, curbside & parking phasing', d(5, 0.05, 3, 15), [fs('mobilization')]),
      n(k('landside_earthwork', 'earthwork'), 'earthwork', 'Landside excavation, utilities & subgrade', d(15, 0.4, 10, 120), [fs(k('landside_mot', 'traffic_control')), fs('erosion_control')]),
      n('landside_paving', 'roadway', 'Landside base, paving, curbs & sidewalks', d(15, 0.4, 10, 120), [fs(k('landside_earthwork', 'earthwork'))], { calendar: 'season' }),
      n(k('landside_signals', 'signals_lighting'), 'signals_lighting', 'Landside lighting, signals & wayfinding signs', d(10, 0.15, 5, 60), [fs(k('landside_earthwork', 'earthwork')), fs('procurement')]),
      n(k('landside_open', 'cutover'), 'cutover', 'Landside markings & traffic switch to the final configuration', d(3, 0.02, 2, 10),
        [fs('landside_paving'), fs(k('landside_signals', 'signals_lighting'))], { calendar: 'season' }),
    )
  }
  out.push(
    c('restoration', 'Safety-area grading, topsoil, seeding & restoration', d(8, 0.1, 5, 40), [fs('cutover'), fs('landside_open')], { calendar: 'season' }),
    c('inspections', 'Sponsor / FAA final inspection, as-built survey & AIP closeout documentation', d(10, 0, 5, 30), [fs('cutover'), fs('landside_open')]),
    c('punchlist', 'Punch list', d(10, 0.1, 5, 30), [fs('cutover'), fs('landside_open')]),
    ...completion(air ? 'Substantial Completion — airfield open to aircraft' : 'Substantial Completion', ['restoration']),
  )
  return out
}

/* ─── Marine, locks, dams & tunnels ──────────────────────── */

function marine(o: CivilOptions): Node[] {
  const scope = o.marineScope ?? 'lock_dam'
  const out: Node[] = [...front()]
  if (scope === 'lock_dam') {
    out.push(
      c('in_water_work', 'Cofferdam construction (sheet-pile / cellular) — in-water work window', d(30, 0.4, 20, 200), [fs('mobilization')],
        { note: 'Cofferdam installation and removal are in-water work limited to the permit window.' }),
      n('dewatering', 'in_water_work', 'Dewater the cofferdam; install wells, pumps & instrumentation', d(10, 0.05, 5, 30), [fs('in_water_work')]),
      c('earthwork', 'Excavation to rock & foundation preparation (in the dry)', d(20, 0.4, 15, 200), [fs('dewatering')]),
      c('deep_foundations', 'Foundation treatment: grout curtain, rock anchors & piles', d(20, 0.3, 15, 150), [fs('earthwork')]),
      // Gate machinery (the long-lead item) is listed before the embedded metals so deliveries gate it.
      c('mechanical_equipment', 'Install lock / spillway gates, valves & operating machinery (hydraulic / electric)', d(30, 0.4, 20, 150), [fs('walls_cure'), fs('procurement')]),
      n('monoliths_base', 'mass_concrete', 'Mass-concrete monoliths — base slab & lower lifts (thermal control plan)', d(30, 1.0, 20, 300), [fs('deep_foundations')]),
      n('base_cure', 'concrete_cure', 'Lift cooling & cure before upper lifts — 14 calendar days (thermal monitoring)', fixed(14), [fs('monoliths_base')], { calendar: '7d' }),
      n('embedded_metals', 'mechanical_equipment', 'Embedded metals: gate anchorages, guides & valve frames', d(10, 0.1, 5, 40), [fs('monoliths_base'), fs('procurement')]),
      n('monoliths_walls', 'mass_concrete', 'Mass-concrete monoliths — walls / piers & upper lifts', d(40, 1.2, 25, 350), [fs('base_cure'), fs('embedded_metals')]),
      n('walls_cure', 'concrete_cure', 'Upper-lift cure before gate installation — 14 calendar days', fixed(14), [fs('monoliths_walls')], { calendar: '7d' }),
      c('controls_scada', 'Electrical, controls & SCADA for gate and valve operation', d(25, 0.2, 15, 90), [ss('mechanical_equipment', 10)]),
      n('cofferdam_removal', 'in_water_work', 'Flood the cofferdam & remove it — in-water work window', d(15, 0.2, 10, 60), [fs('mechanical_equipment'), fs('controls_scada')]),
      c('startup_testing', 'Dry & wet testing of gates and valves; operational trials', d(15, 0.1, 10, 40), [fs('cofferdam_removal')]),
    )
  } else if (scope === 'marine_structure') {
    out.push(
      c('in_water_work', 'Dredging & in-water demolition — in-water work window', d(15, 0.3, 10, 120), [fs('mobilization')]),
      c('deep_foundations', 'Pile driving from barge — in-water work window', d(30, 0.8, 20, 250), [fs('in_water_work'), fs('procurement')]),
      c('substructure', 'Pile caps & bents (precast or cast-in-place)', d(20, 0.5, 15, 150), [fs('deep_foundations')]),
      c('deck', 'Deck: precast panels & cast-in-place topping', d(25, 0.6, 15, 200), [fs('substructure')]),
      n('deck_cure', 'concrete_cure', 'Deck topping cure — 7 calendar days', fixed(7), [fs('deck')], { calendar: '7d' }),
      c('mechanical_equipment', 'Fenders, bollards, crane rail & utilities', d(20, 0.3, 10, 90), [fs('deck_cure'), fs('procurement')]),
      c('startup_testing', 'Load testing, utility testing & operational acceptance', d(10, 0.05, 5, 30), [fs('mechanical_equipment')]),
    )
  } else {
    const tbm = o.tunnelMethod !== 'drill_blast'
    out.push(c('earthwork', 'Launch & reception shafts / portals: support of excavation & excavation', d(30, 0.4, 20, 200), [fs('mobilization')]))
    if (tbm) {
      out.push(
        c('tunneling', 'TBM delivery, assembly, testing & launch', d(30, 0, 25, 60), [fs('earthwork'), fs('procurement')],
          { note: 'TBM fabrication is a long-lead item (see procurement); launch needs the shaft, the segment supply and muck handling ready.' }),
        n('tbm_mining', 'tunneling', 'TBM mining & segmental lining installation', d(60, 1.5, 40, 500), [fs('tunneling')]),
        n('tbm_breakthrough', 'tunneling', 'TBM breakthrough, disassembly & removal', d(15, 0, 10, 30), [fs('tbm_mining')]),
        c('mass_concrete', 'Invert concrete, walkways & cross passages', d(30, 0.6, 20, 200), [fs('tbm_breakthrough')]),
      )
    } else {
      out.push(
        c('tunneling', 'Drill-and-blast excavation & initial support (rock bolts, shotcrete) — top heading', d(60, 1.5, 40, 500), [fs('earthwork')],
          { note: 'Blasting needs an explosives / blasting permit, vibration monitoring and blast windows.' }),
        n('tunnel_bench', 'tunneling', 'Bench excavation & invert', d(30, 0.6, 20, 250), [ss('tunneling', 20)]),
        n('tunnel_waterproofing', 'tunneling', 'Waterproofing membrane & final-lining reinforcement', d(20, 0.4, 15, 150), [fs('tunnel_bench')]),
        c('mass_concrete', 'Cast-in-place final lining (formwork traveler)', d(40, 1.0, 25, 300), [fs('tunnel_waterproofing')]),
      )
    }
    out.push(
      n('lining_cure', 'concrete_cure', 'Lining / invert cure — 7 calendar days', fixed(7), [fs('mass_concrete')], { calendar: '7d' }),
      c('controls_scada', 'Tunnel systems: ventilation, lighting, fire & life safety, communications', d(40, 0.5, 30, 200), [fs('lining_cure'), fs('procurement')]),
      c('startup_testing', 'Systems integration testing & fire / life-safety acceptance', d(20, 0.1, 15, 60), [fs('controls_scada')]),
    )
  }
  out.push(
    c('inspections', 'Owner / USACE final inspection & acceptance', d(10, 0, 5, 30), [fs('startup_testing')]),
    c('punchlist', 'Punch list', d(15, 0.1, 10, 45), [fs('startup_testing')]),
    ...completion(),
  )
  return out
}

/* ─── Environmental remediation ──────────────────────────── */

function remediation(o: CivilOptions): Node[] {
  const out: Node[] = [
    ...front({
      design: ['Pre-design investigation & 30% remedial design', '60% remedial design', '90% / final remedial design & specifications', 'Regulator / owner design review & comment resolution'],
      mobilization: 'Mobilization, field office & temporary facilities',
      mobilizationAfter: ['concurrence'],
    }),
    n('work_plans', 'submittals', 'Remedial action work plan, HASP, waste management & air monitoring plans', d(20, 0.1, 15, 45), [fs('design_review')]),
    n('qapp', 'submittals', 'UFP-QAPP (Uniform Federal Policy QAPP): data quality objectives, sampling design & laboratory', d(20, 0.1, 15, 45), [fs('design_review')]),
    n('regulator_review', 'permit_other', 'Regulator review of the work plans & UFP-QAPP (EPA / state) — calendar days', d(45, 0, 30, 90), [fs('work_plans'), fs('qapp')], { calendar: '7d' }),
    n('concurrence', 'permit_other', 'Resolve comments; regulator concurrence / approval of the final plans', d(10, 0, 5, 20), [fs('regulator_review')]),
    c('erosion_control', 'Site controls: exclusion zones, decon pad, erosion controls & perimeter air monitoring', d(5, 0.05, 3, 15), [fs('mobilization')]),
    n('baseline_sampling', 'sampling_analysis', 'Baseline air monitoring & pre-excavation delineation sampling', d(5, 0.05, 3, 15), [fs('erosion_control')]),
    c('remediation', 'Excavate contaminated soil by grid; stockpile or direct-load', d(20, 1.2, 10, 250), [fs('erosion_control'), fs('baseline_sampling')]),
    n('waste_characterization', 'sampling_analysis', 'Waste characterization sampling of stockpiles', d(3, 0.02, 2, 8), [ss('remediation', 5)]),
    n('waste_lab', 'sampling_analysis', 'Laboratory analysis — waste characterization (standard turnaround, calendar days)', d(10, 0, 7, 21), [fs('waste_characterization')], { calendar: '7d' }),
    n('transport_disposal', 'remediation', 'Load-out, transport & disposal (T&D) to the permitted facility; manifests', d(15, 0.8, 8, 200), [fs('waste_lab')]),
    n('confirmation_sampling', 'sampling_analysis', 'Confirmation sampling of the excavation floor & sidewalls', d(3, 0.05, 2, 15), [fs('remediation')]),
    n('confirmation_lab', 'sampling_analysis', 'Laboratory analysis & data validation — confirmation samples (calendar days)', d(21, 0, 14, 35), [fs('confirmation_sampling')],
      { calendar: '7d', note: 'Turnaround includes the laboratory and third-party data validation; expedited turnaround shortens it at a cost.' }),
    n('over_excavation', 'remediation', 'Over-excavate grids that fail cleanup levels & resample (contingent)', d(5, 0.1, 3, 20), [fs('confirmation_lab')]),
    c('earthwork', 'Backfill with certified clean fill & compaction testing', d(10, 0.4, 5, 120), [fs('over_excavation'), fs('procurement')]),
  ]
  if (o.groundwaterTreatment) {
    out.push(
      c('process_equipment', 'Groundwater extraction wells & treatment system installation', d(30, 0.3, 20, 120), [fs('mobilization'), fs('procurement')]),
      c('startup_testing', 'Treatment system startup, shakedown & discharge compliance sampling', d(15, 0, 10, 30), [fs('process_equipment')]),
    )
  }
  out.push(
    c('restoration', 'Topsoil, seeding & site restoration; remove site controls', d(8, 0.1, 5, 30), [fs('earthwork')]),
    c('inspections', 'Final inspection & regulator concurrence that the remedial action is complete', d(10, 0, 5, 30), [fs('restoration'), fs('transport_disposal'), fs('startup_testing')]),
    c('punchlist', 'Punch list', d(10, 0.05, 5, 30), [fs('restoration')]),
    ...completion('Substantial Completion', [], 'Remedial action completion report, waste manifests & closeout'),
  )
  return out
}

/* ─── EPC / EPCm industrial ──────────────────────────────── */

function epc(o: CivilOptions): Node[] {
  const epcm = o.epcDelivery === 'epcm'
  const heavy = o.heavyLifts !== false
  const H = Math.max(1, o.hydrotestSystems ?? 3)
  const eq = heavy ? 'set_equipment' : 'process_equipment'
  const out: Node[] = [
    ...front({
      design: ['Process design basis, PFDs & heat and material balances (FEED)', 'P&IDs, plot plan & equipment specifications (issued for design)', 'IFC civil, structural & foundation drawings', 'Owner review & IFC release'],
      mobilizationAfter: epcm ? ['construction_contracts'] : [],
    }),
    n('hazop', 'design_dd', 'HAZOP / LOPA review & P&ID revisions (P&IDs issued for construction)', d(15, 0.05, 10, 40), [fs('design_dd')]),
    n('ll_po_award', 'procurement', 'Long-lead equipment RFQs, bid evaluation & PO award (off the process design basis)', d(30, 0.05, 20, 60), [fs('design_sd')],
      { note: 'Vessels, compressors and electrical gear are bought off the process design basis, ahead of IFC drawings.' }),
    n('vendor_data', 'submittals', 'Vendor data: certified GA drawings, loads & nozzle orientations — calendar days', d(56, 0, 42, 90), [fs('ll_po_award')], { calendar: '7d' }),
    n('ifc_piping', 'design_cd', 'IFC piping isometrics & 3D model review (90%)', d(30, 0.3, 20, 120), [fs('hazop'), fs('vendor_data'), fs('design_cd')]),
    n('ifc_ei', 'design_cd', 'IFC electrical & instrument drawings (single lines, loop diagrams, cable schedules)', d(25, 0.2, 15, 90), [fs('hazop'), fs('vendor_data'), fs('design_cd')]),
  ]
  if (epcm) out.push(n('construction_contracts', 'procurement', 'Construction packages (civil, mechanical, E&I): bid, evaluate & award — EPCm, owner contracts', d(40, 0.05, 30, 70), [fs('design_cd')]))
  out.push(
    c('earthwork', 'Site preparation, excavation & grading', d(20, 0.3, 15, 150), [fs('mobilization')]),
    c('utilities_site', 'Underground: process drains, sewers, fire water, grounding & duct banks', d(20, 0.3, 15, 150), [ss('earthwork', 10)]),
    c('deep_foundations', 'Piling', d(15, 0.2, 10, 120), [ss('earthwork', 10)]),
    c('foundations', 'Equipment & structure foundations', d(30, 0.4, 20, 200), [fs('deep_foundations'), fs('utilities_site')]),
    c('structure_steel', 'Pipe racks & structural steel', d(30, 0.4, 20, 220), [ss('foundations', 20), fs('procurement')]),
  )
  if (heavy) out.push(c('process_equipment', 'Heavy lifts: crane mobilization, lift plans & set columns / reactors', d(15, 0.1, 10, 40), [fs('foundations'), fs('procurement')],
    { note: 'Heavy-lift cranes are booked months ahead; ground bearing preparation and lift plans precede the lift window.' }))
  out.push(
    n(eq, 'process_equipment', heavy ? 'Set remaining equipment, pumps, compressors & packages' : 'Set process equipment, vessels, pumps & packages', d(25, 0.3, 15, 150),
      [ss('structure_steel', 20), fs('procurement'), ...(heavy ? [fs('process_equipment')] : [])]),
    c('pipeline', 'Process piping: spool fabrication & field erection', d(60, 1.0, 40, 400), [fs('ifc_piping'), ss(eq, 15)]),
    c('power_equipment', 'Electrical: substation, MCCs, cable tray & cable pulling', d(50, 0.8, 30, 300), [ss('structure_steel', 30), fs('ifc_ei')]),
    c('controls_scada', 'Instrumentation installation, DCS & loop checks', d(50, 0.6, 30, 300), [ss('pipeline', 30), ss('power_equipment', 30), fs('ifc_ei')]),
  )
  for (let i = 1; i <= H; i++) {
    out.push(n(`hydrotest_${i}`, 'startup_testing', `Hydrotest, flush & reinstate — test system ${i} of ${H}`, d(8, 0.05, 5, 20),
      i === 1 ? [ss('pipeline', 30)] : [fs(`hydrotest_${i - 1}`), ...(i === H ? [fs('pipeline')] : [])]))
  }
  out.push(
    n('mc', 'inspections', 'Mechanical completion — system walkdowns, punch A cleared & turnover packages', d(10, 0.05, 5, 25),
      [fs(`hydrotest_${H}`), fs('controls_scada'), fs('power_equipment'), fs('pipeline')]),
    c('commissioning', 'Commissioning: energize, run-in rotating equipment, loop & functional tests, utilities in service', d(30, 0.2, 20, 120), [fs('mc')]),
    c('inspections', 'Pre-startup safety review (PSSR, OSHA 1910.119) & permits to operate', d(10, 0, 5, 20), [fs('commissioning')]),
    c('startup_testing', 'Introduce feedstock, startup & performance test run', d(20, 0.1, 15, 60), [fs('inspections')]),
    c('punchlist', 'Punch list (punch B)', d(15, 0.1, 10, 45), [fs('startup_testing')]),
    ...completion('Substantial Completion — performance test passed; care, custody & control to the owner', ['startup_testing']),
  )
  return out
}

/* ─── Selection ──────────────────────────────────────────── */

function networkFor(type: ProjectType, o: CivilOptions): Node[] {
  switch (type) {
    case 'highway_bridge': return highway(o)
    case 'transit_rail': return transit(o)
    case 'water_wastewater': return water(o)
    case 'utility_power': return power()
    case 'industrial_process': return industrial()
    case 'aviation': return aviation(o)
    case 'marine_civil_works': return marine(o)
    case 'environmental_remediation': return remediation(o)
    case 'epc_industrial': return epc(o)
    default: return industrial()
  }
}

/**
 * The civil network for this profile: nodes that do not apply to the scope (e.g. demolition on new
 * work) are dropped and their successors inherit the dropped node's predecessors; predecessors name
 * keys, with the category kept for the generator's fallback resolution.
 */
export function civilTemplatesFor(profile: ProjectProfile): TemplateActivity[] {
  const type = profile.projectType as ProjectType
  const o = profile.civil ?? civilOptionsFrom(type, {}, profile.state, profile.scope)
  const all = networkFor(type, o)
  const defs = new Map(all.map(x => [x.key, x]))
  const keep = all.filter(x => !x.scopes || !profile.scope || x.scopes.includes(profile.scope))
  const kept = new Set(keep.map(x => x.key))
  const resolve = (preds: P[], visiting: Set<string>): P[] => preds.flatMap(p => {
    if (kept.has(p.key)) return [p]
    const def = defs.get(p.key)
    if (!def || visiting.has(p.key)) return []
    visiting.add(p.key)
    const r = resolve(def.preds, visiting)
    visiting.delete(p.key)
    return r
  })
  return keep.map(x => {
    const seen = new Set<string>()
    const preds = resolve(x.preds, new Set([x.key])).filter(p => {
      const id = `${p.key}|${p.type}|${p.lag}`
      if (p.key === x.key || seen.has(id)) return false
      seen.add(id)
      return true
    })
    const calendar = x.calendar === 'season' ? (o.winterShutdown ? 'season' : undefined) : x.calendar
    return {
      key: x.key, category: x.category, name: x.name, phase: phaseOf(x.category),
      appliesWhen: { projectTypes: [type], civil: true, ...(x.scopes ? { scopes: x.scopes } : {}) },
      duration: x.duration,
      preds: preds.map(p => ({ category: defs.get(p.key)!.category, key: p.key, type: p.type, lag: p.lag })),
      ...(x.milestone ? { milestone: true } : {}),
      ...(x.note ? { note: x.note } : {}),
      ...(calendar ? { calendar } : {}),
    }
  })
}

const CIVIL_TYPES: ProjectType[] = ['highway_bridge', 'transit_rail', 'water_wastewater', 'utility_power', 'industrial_process', 'aviation', 'marine_civil_works', 'environmental_remediation', 'epc_industrial']

/** Every civil activity with default options (for inspection and the category definitions). */
export const CIVIL_CATALOG: TemplateActivity[] = CIVIL_TYPES.flatMap(type => civilTemplatesFor({ projectType: type }))
