// Activity networks for civil / infrastructure project types (highway & bridge, transit & rail,
// water & wastewater, power & substation, industrial process). These are separate from the building
// catalog: no roofing, drywall or elevators, and their own sequence (right-of-way and utility
// relocation, traffic staging, in-water work windows, girder fabrication, process startup, outages).
//
// Sizing: civil work is sized by construction value, not floor area. In these templates `perKsf`
// means work days per USD 1 million of construction value (computeTemplateDuration passes the
// value in millions where buildings pass thousands of square feet). Durations are REFERENCE
// DEFAULTS for planning — verify against the contract, the agency's specifications and your crews.

import type { CanonicalCategory, LinkType, ProjectType, TemplateActivity, WorkScope } from '@/lib/planning/types'
import { phaseOf } from '@/lib/semantic/taxonomy'

type Pred = { category: CanonicalCategory; type: LinkType; lag: number }
const fs = (category: CanonicalCategory, lag = 0): Pred => ({ category, type: 'FS', lag })
const ss = (category: CanonicalCategory, lag = 0): Pred => ({ category, type: 'SS', lag })
const ff = (category: CanonicalCategory, lag = 0): Pred => ({ category, type: 'FF', lag })

const ALL: ProjectType[] = ['highway_bridge', 'transit_rail', 'water_wastewater', 'utility_power', 'industrial_process']
const HB: ProjectType[] = ['highway_bridge']
const TR: ProjectType[] = ['transit_rail']
const WW: ProjectType[] = ['water_wastewater']
const UP: ProjectType[] = ['utility_power']
const IP: ProjectType[] = ['industrial_process']
const REHAB: WorkScope[] = ['renovation', 'renovation_occupied', 'addition']
const MS = { base: 0, min: 0, max: 0 }

function t(category: CanonicalCategory, name: string, types: ProjectType[], duration: TemplateActivity['duration'], preds: Pred[], opts: { milestone?: boolean; note?: string; scopes?: WorkScope[] } = {}): TemplateActivity {
  return { category, name, phase: phaseOf(category), appliesWhen: { projectTypes: types, civil: true, ...(opts.scopes ? { scopes: opts.scopes } : {}) }, duration, preds, milestone: opts.milestone, note: opts.note }
}
const d = (base: number, perM: number, min: number, max: number) => ({ base, perKsf: perM, min, max })

export const CIVIL_CATALOG: TemplateActivity[] = [
  t('ntp', 'Notice to Proceed', ALL, MS, [], { milestone: true }),
  t('design_sd', 'Preliminary engineering / 30% design', ALL, d(30, 0.6, 20, 120), [fs('ntp')]),
  t('design_dd', '60% design', ALL, d(35, 0.6, 25, 150), [fs('design_sd')]),
  t('design_cd', '90% / final design (plans, specifications & estimate)', ALL, d(40, 0.8, 30, 180), [fs('design_dd')]),
  t('design_review', 'Owner / agency design review & comment resolution', ALL, d(25, 0.2, 20, 60), [fs('design_cd')]),
  t('permit_site', 'Environmental & site permits (placeholder)', ALL, d(40, 0.2, 20, 120), [fs('design_dd')],
    { note: 'Replaced by the regional and federal permit activities (NEPA, Section 404/401, NPDES, agency agreements).' }),
  t('submittals', 'Submittals & shop drawings — primary materials', ALL, d(25, 0.2, 20, 60), [fs('design_review')]),
  t('procurement', 'Fabrication & delivery — primary materials', ALL, d(50, 0.6, 40, 200), [fs('submittals')],
    { note: 'Specific long-lead items (girders, special trackwork, pumps, transformers) get their own activities.' }),
  t('mobilization', 'Mobilization, field office & erosion and sediment controls', ALL, d(10, 0.05, 5, 25), [fs('permit_site'), fs('design_review')]),

  /* Highway & bridge */
  t('row_utilities', 'Right-of-way, utility relocations & railroad / agency agreements', HB, d(40, 1.2, 30, 250), [fs('design_dd')],
    { note: 'Utility relocation by others is a frequent driver; confirm each owner\'s relocation schedule.' }),
  t('traffic_control', 'Maintenance of traffic: install traffic control & stage 1 traffic switch', HB, d(10, 0.1, 5, 40), [fs('mobilization')]),
  t('demolition', 'Existing structure demolition (by stage)', HB, d(15, 0.4, 10, 90), [fs('traffic_control')], { scopes: REHAB }),
  t('earthwork', 'Clearing, excavation & embankment', HB, d(20, 0.6, 15, 150), [fs('mobilization'), fs('row_utilities'), fs('traffic_control')]),
  t('drainage', 'Drainage: culverts, inlets & storm pipe', HB, d(15, 0.4, 10, 90), [ss('earthwork', 10)]),
  t('in_water_work', 'Cofferdams, dewatering & in-water work (within the environmental work window)', HB, d(20, 0.5, 15, 120), [ss('earthwork', 5), fs('demolition')],
    { note: 'In-water work is usually limited to a fish / environmental window set by the permits; check the window against this date.' }),
  t('deep_foundations', 'Piles / drilled shafts', HB, d(15, 0.6, 10, 120), [fs('in_water_work')]),
  t('substructure', 'Substructure: footings, abutments, piers & caps', HB, d(30, 1.2, 25, 220), [fs('deep_foundations')]),
  t('superstructure', 'Girder erection, bearings & diaphragms', HB, d(15, 0.5, 10, 90), [fs('substructure'), fs('procurement')]),
  t('deck', 'Deck forming, rebar, pour & cure; barriers & expansion joints', HB, d(30, 0.8, 25, 150), [fs('superstructure')]),
  t('roadway', 'Approach roadway: subgrade, base, paving & guardrail', HB, d(25, 0.8, 15, 180), [ss('earthwork', 30), ff('deck', 10)]),
  t('cutover', 'Striping, signing & final traffic switch', HB, d(5, 0.05, 3, 20), [fs('deck'), fs('roadway'), fs('drainage')]),
  t('inspections', 'Final inspection, load rating & agency acceptance', HB, d(10, 0, 5, 30), [fs('cutover')]),
  t('punchlist', 'Punch list', HB, d(15, 0.1, 10, 40), [fs('cutover')]),

  /* Transit & rail */
  t('row_utilities', 'Right-of-way, utility relocations & railroad agreements', TR, d(45, 1.0, 30, 260), [fs('design_dd')]),
  t('traffic_control', 'Track access, outage plan & roadway worker protection (flagging)', TR, d(10, 0.05, 5, 30), [fs('mobilization')]),
  t('earthwork', 'Civil: subgrade, embankment & excavation', TR, d(25, 0.6, 15, 180), [fs('mobilization'), fs('row_utilities'), fs('traffic_control')]),
  t('drainage', 'Track drainage & underdrains', TR, d(15, 0.3, 10, 90), [fs('earthwork')]),
  t('substructure', 'Structures: retaining walls, platforms, guideway & foundations', TR, d(40, 1.0, 30, 300), [ss('earthwork', 20)]),
  t('track_systems', 'Track: ballast, ties, rail & special trackwork', TR, d(30, 0.8, 20, 220), [fs('substructure'), fs('procurement')]),
  t('power_equipment', 'Traction power substations & overhead contact system', TR, d(40, 0.8, 30, 250), [ss('track_systems', 20), fs('procurement')]),
  t('controls_scada', 'Signals, train control & communications', TR, d(45, 0.8, 30, 250), [ss('track_systems', 30)]),
  t('cutover', 'Weekend outages: cutovers & tie-ins to the operating line', TR, d(10, 0.1, 5, 40), [ff('track_systems'), ff('controls_scada')]),
  t('startup_testing', 'Systems integration testing & pre-revenue operations', TR, d(40, 0.3, 30, 180), [fs('power_equipment'), fs('controls_scada'), fs('cutover'), fs('drainage')]),
  t('inspections', 'Safety certification & regulator acceptance', TR, d(15, 0.1, 10, 60), [fs('startup_testing')]),
  t('punchlist', 'Punch list', TR, d(15, 0.1, 10, 45), [fs('startup_testing')]),

  /* Water & wastewater */
  t('demolition', 'Demolition of existing process units', WW, d(15, 0.2, 10, 60), [fs('mobilization')], { scopes: REHAB }),
  t('earthwork', 'Excavation, dewatering & shoring', WW, d(20, 0.5, 15, 150), [fs('mobilization'), fs('demolition')]),
  t('pipeline', 'Yard piping, transmission main & crossings', WW, d(30, 1.0, 20, 250), [ss('earthwork', 15)]),
  t('process_structures', 'Process structures: basins, tanks & wet wells (concrete) with leak testing', WW, d(60, 1.5, 40, 330), [ss('earthwork', 10)]),
  t('power_equipment', 'Electrical: switchgear, MCCs, VFDs & standby power', WW, d(40, 0.6, 30, 200), [ss('process_structures', 60), fs('procurement')]),
  t('process_equipment', 'Pumps, valves, screens & process equipment installation', WW, d(40, 0.8, 30, 220), [ss('process_structures', 90), fs('procurement')]),
  t('controls_scada', 'Instrumentation, controls & SCADA integration', WW, d(40, 0.4, 25, 160), [ss('process_equipment', 20), ss('power_equipment', 20)]),
  t('cutover', 'Tie-ins & shutdowns to the operating system', WW, d(10, 0.1, 5, 40), [ff('pipeline'), fs('process_equipment')],
    { note: 'Shutdown windows are set by the operator (often low-demand seasons or nights); confirm before committing.' }),
  t('startup_testing', 'Startup, testing & performance / acceptance testing', WW, d(30, 0.3, 20, 120), [fs('process_equipment'), fs('power_equipment'), fs('controls_scada'), fs('cutover')]),
  t('roadway', 'Site paving & restoration', WW, d(15, 0.2, 10, 60), [fs('pipeline')]),
  t('inspections', 'Regulatory inspection & approval to operate', WW, d(15, 0, 10, 45), [fs('startup_testing')]),
  t('punchlist', 'Punch list', WW, d(15, 0.1, 10, 45), [fs('startup_testing')]),

  /* Power, substation & transmission */
  t('earthwork', 'Site grading, access roads & grounding grid', UP, d(20, 0.4, 10, 120), [fs('mobilization')]),
  t('substructure', 'Foundations: equipment pads, structure & tower foundations', UP, d(30, 0.8, 20, 200), [ss('earthwork', 10)]),
  t('superstructure', 'Steel structures / tower erection', UP, d(20, 0.6, 15, 160), [fs('substructure'), fs('procurement')]),
  t('power_equipment', 'Set & dress transformers, breakers & switchgear', UP, d(30, 0.5, 20, 150), [fs('substructure'), fs('procurement')]),
  t('conductors', 'Bus work, conductor stringing & terminations', UP, d(25, 0.6, 15, 180), [fs('superstructure'), ss('power_equipment', 10)]),
  t('controls_scada', 'Protection & control: relay panels, wiring & SCADA', UP, d(35, 0.5, 25, 150), [ss('power_equipment', 15)]),
  t('startup_testing', 'Testing & commissioning (relay testing, energization checks)', UP, d(25, 0.2, 15, 90), [fs('conductors'), fs('controls_scada'), fs('power_equipment')]),
  t('cutover', 'Outage, tie-in & energization', UP, d(5, 0.05, 3, 20), [fs('startup_testing')],
    { note: 'Outage windows are granted by the utility / ISO and often months ahead; confirm the approved window.' }),
  t('inspections', 'Utility / ISO acceptance', UP, d(10, 0, 5, 30), [fs('cutover')]),
  t('punchlist', 'Punch list', UP, d(10, 0.1, 5, 30), [fs('cutover')]),

  /* Industrial & process */
  t('earthwork', 'Site preparation, excavation & underground', IP, d(20, 0.3, 15, 150), [fs('mobilization')]),
  t('deep_foundations', 'Piling', IP, d(15, 0.2, 10, 120), [ss('earthwork', 10)]),
  t('foundations', 'Equipment & structure foundations', IP, d(30, 0.4, 20, 200), [fs('deep_foundations')]),
  t('structure_steel', 'Pipe racks & structural steel', IP, d(30, 0.4, 20, 220), [ss('foundations', 20), fs('procurement')]),
  t('process_equipment', 'Set process equipment, vessels & packages', IP, d(30, 0.4, 20, 200), [ss('structure_steel', 20), fs('procurement')]),
  t('pipeline', 'Process piping fabrication, installation & hydrotest', IP, d(60, 1.0, 40, 400), [ss('process_equipment', 15)]),
  t('power_equipment', 'Electrical installation: substation, MCCs & cable', IP, d(50, 0.8, 30, 300), [ss('structure_steel', 30)]),
  t('controls_scada', 'Instrumentation, DCS & controls integration', IP, d(50, 0.6, 30, 300), [ss('pipeline', 30), ss('power_equipment', 30)]),
  t('startup_testing', 'Pre-commissioning, commissioning & startup', IP, d(40, 0.3, 30, 180), [fs('pipeline'), fs('controls_scada'), fs('power_equipment')]),
  t('inspections', 'PSM / regulatory inspections & permits to operate', IP, d(15, 0, 10, 45), [fs('startup_testing')]),
  t('punchlist', 'Punch list', IP, d(15, 0.1, 10, 45), [fs('startup_testing')]),

  /* Completion (all) */
  t('substantial_completion', 'Substantial Completion', ALL, MS, [fs('punchlist'), fs('inspections'), fs('roadway')], { milestone: true }),
  t('closeout', 'As-builts, O&M manuals, certified payrolls & closeout', ALL, d(30, 0.1, 20, 60), [fs('substantial_completion')]),
  t('final_completion', 'Final Completion', ALL, MS, [fs('closeout')], { milestone: true }),
]
