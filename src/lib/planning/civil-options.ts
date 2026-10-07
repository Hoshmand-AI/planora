// Interview questions and network options for civil / infrastructure project types: maintenance-of-
// traffic staging, utility owners, in-water work windows, seasonal paving limits, guideway type,
// per-structure sequences, airside/landside scope, marine scope and tunneling method, EPC delivery.
// The answers (with conservative defaults) become ProjectProfile.civil, which shapes the activity
// network in templates-civil.ts, and ProjectProfile.features, which filters catalog items.

import type { Answer, AnswerValue, CivilOptions, ProjectProfile, ProjectType, Question } from './types'

const known = (answers: Record<string, Answer>, id: string): AnswerValue | undefined => {
  const a = answers[id]
  return a && a.status === 'known' ? a.value : undefined
}
const num = (v: AnswerValue | undefined) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)) ? Number(v) : undefined)
const bool = (v: AnswerValue | undefined): boolean | undefined => {
  if (typeof v === 'boolean') return v
  if (typeof v !== 'string') return undefined
  const t = v.trim().toLowerCase()
  return ['true', 'yes', 'y', '1'].includes(t) ? true : ['false', 'no', 'n', '0'].includes(t) ? false : undefined
}
const clampInt = (v: number | undefined, lo: number, hi: number, dflt: number) => (v === undefined || !Number.isFinite(v) ? dflt : Math.min(hi, Math.max(lo, Math.round(v))))

/**
 * States where asphalt plants close and agencies suspend paving, striping and seeding in winter
 * (typical DOT seasonal limits run about mid-November to mid-April; confirm in the special provisions).
 */
export const NORTHERN_STATES = new Set(['AK', 'CO', 'CT', 'IA', 'ID', 'IL', 'IN', 'MA', 'ME', 'MI', 'MN', 'MT', 'ND', 'NE', 'NH', 'NJ', 'NY', 'OH', 'PA', 'RI', 'SD', 'VT', 'WI', 'WY'])
/** Seasonal shutdown: no seasonal work from December 1 through March 31 (month-day, inclusive). */
export const WINTER_SHUTDOWN = { from: '12-01', to: '03-31', label: 'December 1 – March 31' }

/** Water / wastewater: most process structures planned individually (pour, cure, leak test, backfill). */
export const WW_MAX_STRUCTURES = 12

const SEASONAL_TYPES: ProjectType[] =['highway_bridge', 'aviation']
const IN_WATER_TYPES: ProjectType[] = ['highway_bridge', 'marine_civil_works']

function permitStatus(answers: Record<string, Answer>, id: string): string | undefined {
  const v = known(answers, `permit.${id}.status`)
  return typeof v === 'string' ? v : undefined
}

/** Network options for a civil type, from the answers; unanswered questions take their defaults. */
export function civilOptionsFrom(type: ProjectType, answers: Record<string, Answer>, state?: string, scope?: string): CivilOptions {
  const o: CivilOptions = {}
  const stagedScope = scope === 'renovation_occupied' || scope === 'addition'
  if (type === 'highway_bridge') {
    o.motStages = clampInt(num(known(answers, 'civil.mot_phases')), 1, 4, stagedScope ? 2 : 1)
    const row = permitStatus(answers, 'us-row-certification')
    o.rowClear = row === 'issued' || row === 'not_required'
    const rr = permitStatus(answers, 'us-railroad-agreement')
    o.railroad = rr === 'not_required' ? 'none' : rr === 'issued' ? 'issued' : 'pending'
    const ut = known(answers, 'civil.utilities')
    o.utilities = ut === 'none' || ut === 'complete' || ut === 'by_others' || ut === 'by_contractor' ? ut : 'by_others'
    o.utilityOwners = clampInt(num(known(answers, 'civil.utility_owners')), 1, 12, 2)
    o.inWater = permitStatus(answers, 'us-usace-404-bridge') !== 'not_required'
  }
  if (type === 'transit_rail') {
    o.guideway = known(answers, 'transit.guideway') === 'elevated_segmental' ? 'elevated_segmental' : 'at_grade'
    o.stations = clampInt(num(known(answers, 'transit.stations')), 0, 20, 1)
    o.trackwork = known(answers, 'procure.civ-special-trackwork.status') !== 'not_in_scope'
  }
  if (type === 'water_wastewater') {
    const f = known(answers, 'ww.facility')
    o.wwFacility = f === 'water_treatment' || f === 'pump_station' ? f : 'wastewater_treatment'
    // Up to WW_MAX_STRUCTURES structures are planned one by one; a larger count is capped and the
    // generator says so in the assumptions.
    o.wwStructures = clampInt(num(known(answers, 'ww.structures')), 1, WW_MAX_STRUCTURES, o.wwFacility === 'pump_station' ? 1 : 2)
  }
  if (type === 'aviation') {
    const a = known(answers, 'aviation.area')
    o.airportArea = a === 'landside' || a === 'both' ? a : 'airside'
  }
  if (type === 'marine_civil_works') {
    const m = known(answers, 'marine.scope')
    o.marineScope = m === 'marine_structure' || m === 'tunnel' ? m : 'lock_dam'
    o.tunnelMethod = known(answers, 'marine.tunnel_method') === 'drill_blast' ? 'drill_blast' : 'tbm'
    o.inWater = o.marineScope !== 'tunnel'
  }
  if (type === 'environmental_remediation') o.groundwaterTreatment = bool(known(answers, 'remediation.groundwater')) === true
  if (type === 'epc_industrial') {
    o.epcDelivery = known(answers, 'epc.delivery') === 'epcm' ? 'epcm' : 'epc'
    o.heavyLifts = bool(known(answers, 'epc.heavy_lifts')) !== false
    o.hydrotestSystems = clampInt(num(known(answers, 'epc.hydrotest_systems')), 1, 6, 3)
  }
  if (SEASONAL_TYPES.includes(type)) {
    const w = bool(known(answers, 'civil.winter_shutdown'))
    o.winterShutdown = w ?? (!!state && NORTHERN_STATES.has(state))
  }
  return o
}

/** Scope features catalog items can require (Applicability.features). */
export function featuresFrom(type: ProjectType, o: CivilOptions): string[] {
  const f: string[] = []
  if (type === 'aviation') {
    if (o.airportArea !== 'landside') f.push('airside')
    if (o.airportArea !== 'airside') f.push('landside')
  }
  if (type === 'marine_civil_works' && o.marineScope) {
    f.push(o.marineScope)
    if (o.marineScope === 'tunnel' && o.tunnelMethod) f.push(o.tunnelMethod)
  }
  if (type === 'transit_rail') {
    if ((o.stations ?? 0) > 0) f.push('stations')
    if (o.guideway) f.push(o.guideway)
  }
  if (type === 'environmental_remediation' && o.groundwaterTreatment) f.push('groundwater')
  if (type === 'epc_industrial' && o.epcDelivery) f.push(o.epcDelivery)
  if (o.inWater) f.push('in_water')
  return f
}

const strict = <T extends Question>(q: T): T => ({ ...q, allowOther: false })

/** Civil interview questions for this project type (empty for buildings). */
export function civilQuestions(p: ProjectProfile, answers: Record<string, Answer>): Question[] {
  const t = p.projectType
  if (!t) return []
  const o = p.civil ?? {}
  const qs: Question[] = []
  const northern = !!p.state && NORTHERN_STATES.has(p.state)
  if (t === 'highway_bridge') {
    const staged = p.scope === 'renovation_occupied' || p.scope === 'addition'
    qs.push(
      {
        id: 'civil.mot_phases', section: 'site', kind: 'number', unit: 'stages', impact: 60, allowWithheld: true,
        prompt: 'How many maintenance-of-traffic (MOT) stages does the traffic control plan use?',
        why: 'Each stage is built behind a traffic switch: demolition, foundations, substructure, girders and deck repeat per stage, and the next switch waits for the previous stage’s deck and barriers.',
        fallback: { value: staged ? 2 : 1, explanation: staged ? 'Assumed two-stage construction (Stage 1 / Stage 2) with traffic kept on the existing structure.' : 'Assumed no staging (new alignment or full closure / detour).' },
      },
      {
        id: 'civil.earthwork_cy', section: 'site', kind: 'number', unit: 'cubic yards', impact: 45, allowWithheld: true,
        prompt: 'Roughly how many cubic yards of excavation and embankment are in the contract?',
        why: 'Earthwork is sized from the quantity at a typical production rate (about 1,500 CY per day for a spread) instead of from the construction value.',
        fallback: { value: '', explanation: 'Earthwork sized from construction value (no quantity given).' },
      },
      strict({
        id: 'civil.utilities', section: 'site', kind: 'choice', impact: 55, allowWithheld: true,
        prompt: 'What is the status of utility relocations?',
        why: 'Relocations by the utility owners are a leading cause of civil delay: they gate earthwork and foundations and are outside the contractor’s control. Relocations already complete come off the schedule.',
        options: [
          { value: 'none', label: 'No utility conflicts' }, { value: 'complete', label: 'Relocated before NTP' },
          { value: 'by_others', label: 'Relocated by the utility owners during the contract' }, { value: 'by_contractor', label: 'Relocated by the contractor (in the contract)' },
        ],
        fallback: { value: 'by_others', explanation: 'Assumed relocations by the utility owners during the contract (conservative).' },
      }),
    )
    if (o.utilities === 'by_others' || o.utilities === 'by_contractor') {
      qs.push({
        id: 'civil.utility_owners', section: 'site', kind: 'number', unit: 'utility owners', impact: 35, allowWithheld: true,
        prompt: 'How many utility owners have facilities to relocate (power, gas, telecom, water, sewer)?',
        why: 'Each owner schedules its own crews and design; relocation time grows with the number of owners that must be sequenced.',
        fallback: { value: 2, explanation: 'Assumed two utility owners.' },
      })
    }
  }
  if (t === 'transit_rail') {
    qs.push(
      strict({
        id: 'transit.guideway', section: 'design', kind: 'choice', impact: 70, allowWithheld: true,
        prompt: 'Is the alignment at grade, or an elevated segmental guideway?',
        why: 'An elevated segmental guideway adds a casting yard, precast segments, a launching gantry, bearings and elevated stations with vertical circulation; at-grade track is built on subgrade and ballast.',
        options: [{ value: 'at_grade', label: 'At grade / embankment' }, { value: 'elevated_segmental', label: 'Elevated precast segmental guideway' }],
        fallback: { value: 'at_grade', explanation: 'Assumed an at-grade alignment.' },
      }),
      {
        id: 'transit.stations', section: 'design', kind: 'number', unit: 'stations', impact: 45, allowWithheld: true,
        prompt: 'How many stations are new or rebuilt in this contract (0 if none)?',
        why: 'Station ADA scope (elevators, escalators, platform edges) needs track outages under the railroad’s general orders and state elevator acceptance before revenue service.',
        fallback: { value: 1, explanation: 'Assumed one station with ADA elevator, escalator and platform-edge work.' },
      },
    )
  }
  if (t === 'water_wastewater') {
    qs.push(
      strict({
        id: 'ww.facility', section: 'design', kind: 'choice', impact: 55, allowWithheld: true,
        prompt: 'What kind of facility is it?',
        why: 'A wastewater plant needs biological seeding and acclimation before performance testing; a water plant needs disinfection and bacteriological sampling; a pump station needs neither.',
        options: [{ value: 'wastewater_treatment', label: 'Wastewater treatment plant' }, { value: 'water_treatment', label: 'Water treatment plant' }, { value: 'pump_station', label: 'Pump station / lift station' }],
        fallback: { value: 'wastewater_treatment', explanation: 'Assumed a wastewater treatment plant.' },
      }),
      {
        id: 'ww.structures', section: 'design', kind: 'number', unit: 'structures', impact: 50, allowWithheld: true,
        prompt: 'How many major concrete process structures (basins, clarifiers, tanks, wet wells) are built?',
        why: `Each structure is poured, cured, leak tested (ACI 350.1) and backfilled (one concrete crew per four structures); equipment cannot be set until its structure passes the leak test. Up to ${WW_MAX_STRUCTURES} structures are planned individually.`,
        fallback: { value: o.wwFacility === 'pump_station' ? 1 : 2, explanation: 'Assumed two major process structures built by one concrete crew in sequence.' },
      },
    )
  }
  if (t === 'aviation') {
    qs.push(strict({
      id: 'aviation.area', section: 'site', kind: 'choice', impact: 70, allowWithheld: true,
      prompt: 'Is the work airside (runways, taxiways, aprons), landside (roads, parking, curbs), or both?',
      why: 'Airside work runs under an FAA-approved Construction Safety and Phasing Plan with runway / taxiway closures, NAVAID shutdowns and flight checks before reopening; landside work is road work.',
      options: [{ value: 'airside', label: 'Airside' }, { value: 'landside', label: 'Landside' }, { value: 'both', label: 'Both' }],
      fallback: { value: 'airside', explanation: 'Assumed airside work under a CSPP.' },
    }))
  }
  if (t === 'marine_civil_works') {
    qs.push(strict({
      id: 'marine.scope', section: 'design', kind: 'choice', impact: 80, allowWithheld: true,
      prompt: 'What is the main structure?',
      why: 'Locks and dams are built in the dry behind cofferdams with mass-concrete monoliths and gate machinery; wharves and piers are built from barges; tunnels are mined by drill-and-blast or a TBM.',
      options: [{ value: 'lock_dam', label: 'Lock / dam / spillway' }, { value: 'marine_structure', label: 'Wharf, pier or bulkhead' }, { value: 'tunnel', label: 'Tunnel' }],
      fallback: { value: 'lock_dam', explanation: 'Assumed a lock or dam built in the dry behind a cofferdam.' },
    }))
    if (o.marineScope === 'tunnel') {
      qs.push(strict({
        id: 'marine.tunnel_method', section: 'design', kind: 'choice', impact: 60, allowWithheld: true,
        prompt: 'How will the tunnel be excavated?',
        why: 'A TBM has a long fabrication lead and an assembly / launch period but mines fast with a segmental lining; drill-and-blast starts sooner, needs a blasting permit and advances by heading and bench.',
        options: [{ value: 'tbm', label: 'Tunnel boring machine (TBM)' }, { value: 'drill_blast', label: 'Drill-and-blast' }],
        fallback: { value: 'tbm', explanation: 'Assumed a TBM-driven tunnel.' },
      }))
    }
  }
  if (t === 'environmental_remediation') {
    qs.push({
      id: 'remediation.groundwater', section: 'site', kind: 'boolean', impact: 40, allowWithheld: true,
      prompt: 'Does the remedy include a groundwater treatment system?',
      why: 'A treatment system adds equipment procurement, installation, a discharge permit and a startup / shakedown period.',
      fallback: { value: false, explanation: 'Assumed soil excavation and off-site disposal only.' },
    })
  }
  if (t === 'epc_industrial') {
    qs.push(
      strict({
        id: 'epc.delivery', section: 'project', kind: 'choice', impact: 50, allowWithheld: true,
        prompt: 'Is this lump-sum EPC or EPCm (owner holds the construction contracts)?',
        why: 'Under EPCm the construction packages are bid and awarded after IFC drawings, which adds a contracting step before mobilization.',
        options: [{ value: 'epc', label: 'EPC (single contractor)' }, { value: 'epcm', label: 'EPCm (engineering, procurement & construction management)' }],
        fallback: { value: 'epc', explanation: 'Assumed lump-sum EPC.' },
      }),
      {
        id: 'epc.heavy_lifts', section: 'site', kind: 'boolean', impact: 35, allowWithheld: true,
        prompt: 'Are there heavy lifts (columns, reactors, large modules) needing a heavy-lift crane?',
        why: 'Heavy lifts need lift plans, ground preparation and a crane mobilization window, and they gate the steel and piping around them.',
        fallback: { value: true, explanation: 'Assumed heavy lifts of the main process vessels.' },
      },
      {
        id: 'epc.hydrotest_systems', section: 'site', kind: 'number', unit: 'systems', impact: 30, allowWithheld: true,
        prompt: 'Into how many test systems / turnover packages is the piping divided?',
        why: 'Hydrotests run system by system and turnover to commissioning follows mechanical completion of each system.',
        fallback: { value: 3, explanation: 'Assumed three hydrotest systems.' },
      },
    )
  }
  if (SEASONAL_TYPES.includes(t)) {
    qs.push({
      id: 'civil.winter_shutdown', section: 'calendar', kind: 'boolean', impact: 40, allowWithheld: false,
      prompt: `Is there a seasonal winter shutdown for paving, striping and seeding (${WINTER_SHUTDOWN.label})?`,
      why: 'Asphalt plants close and agencies suspend paving, pavement markings and seeding in northern winters. Those activities are put on a seasonal calendar so they cannot be scheduled in the shutdown.',
      fallback: northern
        ? { value: true, explanation: `Northern state: paving, striping and seeding have no work days ${WINTER_SHUTDOWN.label}.` }
        : { value: false, explanation: 'No seasonal paving shutdown assumed.' },
    })
  }
  if (IN_WATER_TYPES.includes(t) && o.inWater) {
    qs.push(
      {
        id: 'civil.inwater_open', section: 'permits', kind: 'date', impact: 40, allowWithheld: true,
        prompt: 'When does the in-water work window open (first season)?',
        why: 'Permits limit in-water work (cofferdams, pile driving in water) to a fish / environmental window. The work is held to start no earlier than the window and to finish before it closes; if it cannot, the plan rolls to the next season or shows negative float.',
        fallback: { value: '', explanation: 'No in-water window restriction applied — confirm the window in the §404 / §401 permits.' },
      },
      {
        id: 'civil.inwater_close', section: 'permits', kind: 'date', impact: 40, allowWithheld: true,
        prompt: 'When does the in-water work window close?',
        why: 'In-water work must be finished (or the cofferdam secured) by the close of the window.',
        fallback: { value: '', explanation: 'No in-water window restriction applied.' },
      },
    )
  }
  return qs
}

/** The in-water work window as month-day strings, when both dates are answered. */
export function inWaterWindow(answers: Record<string, Answer>): { open: string; close: string } | undefined {
  const o = known(answers, 'civil.inwater_open'), c = known(answers, 'civil.inwater_close')
  const ok = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  if (!ok(o) || !ok(c)) return undefined
  return { open: o.slice(5), close: c.slice(5) }
}
