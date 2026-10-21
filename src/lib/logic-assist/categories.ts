// Activity classification into twelve MasterFormat-style work categories, through a finer "work
// stage" (Drywall, MEP rough-in, Slab on grade …) that also drives sequencing. Keyword and phrase
// rules on the normalised name; the matching terms are returned as the "why". The existing
// taxonomy (src/lib/semantic/taxonomy.ts) is a second opinion and a fallback.

import { classifyActivity as taxonomyClassify } from '@/lib/semantic/taxonomy'
import type { CanonicalCategory } from '@/lib/planning/types'
import { normalizeName } from './abbreviations'

export const CATEGORIES = {
  general: 'General requirements & preconstruction',
  permits: 'Permits & inspections',
  procurement: 'Procurement & submittals',
  sitework: 'Sitework',
  concrete: 'Concrete & foundations',
  structure: 'Structure',
  envelope: 'Envelope & roofing',
  mep: 'MEP rough-in & equipment',
  interiors: 'Interiors',
  finishes: 'Finishes',
  equipment: 'Equipment & specialties',
  closeout: 'Commissioning & closeout',
  unknown: 'Not recognised',
} as const
export type WorkCategory = keyof typeof CATEGORIES

export type StageId =
  | 'start' | 'precon' | 'permit' | 'submittal' | 'procure' | 'mobilize' | 'demo' | 'earthwork' | 'utilities'
  | 'deepfdn' | 'foundation' | 'cure' | 'underslab' | 'sog' | 'structure' | 'roofing' | 'skin' | 'dryin'
  | 'framing' | 'mepEquip' | 'mepRough' | 'power' | 'drywall' | 'finishes' | 'mepTrim' | 'specialties'
  | 'paving' | 'cx' | 'inspection' | 'punch' | 'completion' | 'closeoutDocs' | 'final'

export interface StageDef { id: StageId; category: WorkCategory; label: string; phrases: [string, number?][]; /** label takes a plural verb */ plural?: boolean }

/** Phrase weights default to 1 + 0.6 per extra word; a number overrides. */
export const STAGES: readonly StageDef[] = [
  { id: 'start', category: 'general', label: 'project start', phrases: [['notice to proceed', 3], ['project start', 2.5], ['construction start', 2.5], ['start construction', 2.5], ['contract award', 2.5], ['award contract', 2.5], ['kickoff'], ['kick off'], ['groundbreaking', 2]] },
  { id: 'precon', category: 'general', label: 'preconstruction', phrases: [['preconstruction', 2], ['design'], ['construction documents'], ['bid'], ['baseline schedule'], ['survey'], ['value engineering'], ['site investigation'], ['geotechnical']] },
  { id: 'mobilize', category: 'general', label: 'mobilization', phrases: [['mobilization', 2], ['mobilize', 2], ['site setup', 2], ['site set up', 2], ['temporary facilities', 2], ['temporary fence'], ['temporary fencing'], ['trailers'], ['trailer'], ['site logistics'], ['temporary power'], ['construction entrance']] },
  { id: 'demo', category: 'sitework', label: 'demolition', phrases: [['demolition', 2], ['demolish', 2], ['abatement', 2], ['asbestos'], ['hazardous materials'], ['strip out'], ['sawcut'], ['remove existing'], ['selective demolition', 2]] },
  { id: 'earthwork', category: 'sitework', label: 'earthwork', phrases: [['excavation', 1.5], ['excavate', 1.5], ['mass excavation', 2], ['grading'], ['rough grading', 2], ['cut and fill', 2], ['backfill', 1.5], ['compaction'], ['clearing'], ['grubbing'], ['clear and grub', 2], ['erosion and sediment control', 2], ['erosion control', 2], ['silt fence', 2], ['dewatering'], ['shoring'], ['subgrade'], ['earthwork', 2], ['site prep'], ['site preparation'], ['strip topsoil', 2]] },
  { id: 'utilities', plural: true, category: 'sitework', label: 'site utilities', phrases: [['site utilities', 2.5], ['underground utilities', 2.5], ['utilities'], ['storm'], ['sanitary'], ['sewer'], ['water line'], ['water main'], ['water service'], ['fire line'], ['duct bank'], ['manhole'], ['catch basin'], ['underground']] },
  { id: 'deepfdn', plural: true, category: 'concrete', label: 'deep foundations', phrases: [['piles', 2], ['piling', 2], ['pile', 1.5], ['caissons', 2], ['caisson', 2], ['drilled piers', 2], ['drilled shafts', 2], ['auger cast piles', 2], ['micropiles', 2], ['aggregate piers', 2], ['pile driving', 2.5]] },
  { id: 'foundation', plural: true, category: 'concrete', label: 'foundations', phrases: [['footings', 1.5], ['footing', 1.5], ['foundations', 1.5], ['foundation', 1.5], ['grade beams', 1.5], ['grade beam', 1.5], ['pile caps', 2], ['pile cap', 2], ['stem walls'], ['foundation walls', 2], ['piers'], ['spread footings', 2], ['mat foundation', 2], ['elevator pit', 1.5], ['form rebar pour', 0.8], ['concrete', 0.5], ['pour', 0.4], ['embeds']] },
  { id: 'cure', category: 'concrete', label: 'concrete curing', phrases: [['cure', 2], ['curing', 2], ['strength gain', 2]] },
  { id: 'underslab', plural: true, category: 'mep', label: 'under-slab utilities', phrases: [['under slab', 2.5], ['underslab', 2.5], ['below slab', 2.5], ['under slab plumbing', 3], ['underground plumbing', 2.5], ['in slab', 2]] },
  { id: 'sog', category: 'concrete', label: 'slab on grade', phrases: [['slab on grade', 2.5], ['ground floor slab', 2.5], ['slab prep', 2], ['floor slab', 1.2], ['vapor barrier'], ['slab', 0.5]] },
  { id: 'structure', category: 'structure', label: 'structure', phrases: [['erect', 1.5], ['erection', 1.5], ['structural steel', 2], ['steel'], ['structural'], ['columns'], ['column'], ['beams'], ['joists'], ['joist'], ['metal deck', 1.5], ['decking'], ['deck', 0.8], ['moment frame'], ['bracing'], ['bolt up'], ['plumb and bolt', 2], ['precast'], ['tilt up', 1.5], ['masonry'], ['concrete masonry unit', 1.5], ['block walls'], ['cast in place'], ['elevated slab', 2], ['slab on metal deck', 2.5], ['post tensioned', 1.5], ['shear walls'], ['wood framing', 2], ['trusses'], ['sheathing', 0.8], ['cross laminated timber', 2], ['mass timber', 2], ['superstructure', 2], ['structure'], ['topping out', 2], ['top out structure', 2], ['frame', 0.8]] },
  { id: 'roofing', category: 'envelope', label: 'roofing', phrases: [['roofing', 2], ['roof', 1.2], ['membrane'], ['thermoplastic polyolefin roofing', 2], ['epdm roofing', 2], ['built up roofing', 2], ['flashing'], ['coping'], ['roof insulation', 2]] },
  { id: 'skin', plural: true, category: 'envelope', label: 'exterior skin and windows', phrases: [['exterior'], ['cladding', 1.5], ['facade', 1.5], ['brick'], ['veneer'], ['exterior insulation finish system', 2], ['metal panels'], ['wall panels'], ['air barrier'], ['air vapor barrier'], ['waterproofing'], ['stucco'], ['siding'], ['rain screen'], ['curtain wall', 2], ['storefront', 2], ['windows', 1.5], ['window', 1.5], ['glazing', 1.5], ['glass'], ['skylights'], ['envelope']] },
  { id: 'dryin', category: 'envelope', label: 'dry-in', phrases: [['dry in', 3], ['dried in', 3], ['weather tight', 3], ['watertight', 3], ['building enclosed', 3], ['enclosure complete', 3], ['building enclosure', 2]] },
  { id: 'framing', category: 'interiors', label: 'interior framing', phrases: [['metal stud', 2], ['metal studs', 2], ['stud framing', 2], ['interior framing', 2.5], ['framing', 1], ['layout walls', 2], ['wall layout', 2], ['partitions'], ['soffits'], ['blocking']] },
  { id: 'mepEquip', category: 'mep', label: 'MEP equipment', phrases: [['rooftop unit', 2], ['rooftop units', 2], ['air handling unit', 2], ['air handling units', 2], ['chiller', 2], ['chillers', 2], ['boiler', 2], ['boilers', 2], ['cooling tower', 2], ['switchgear', 2], ['transformer', 2], ['transformers', 2], ['main switchboard', 2], ['generator', 2], ['automatic transfer switch', 2], ['uninterruptible power supply', 2], ['fire pump', 2], ['exhaust fan', 1.5], ['heat pump', 1.5], ['dedicated outdoor air system', 2], ['variable refrigerant flow', 1.5], ['mechanical equipment', 2], ['electrical equipment', 2], ['set equipment', 1.5], ['equipment pads', 1.5]] },
  { id: 'mepRough', category: 'mep', label: 'MEP rough-in', phrases: [['rough in', 2], ['mechanical electrical plumbing', 1.5], ['ductwork', 1.5], ['duct'], ['piping'], ['plumbing'], ['conduit'], ['electrical'], ['mechanical'], ['heating ventilation air conditioning', 1.2], ['sprinkler'], ['sprinklers'], ['fire protection'], ['fire alarm'], ['low voltage'], ['data cabling'], ['cabling'], ['overhead'], ['in wall', 1.5], ['top out', 1.5], ['wire pull', 1.5], ['pull wire', 1.5], ['feeders'], ['branch'], ['rough', 1.2], ['hangers'], ['variable air volume box']] },
  { id: 'power', category: 'mep', label: 'permanent power', phrases: [['permanent power', 3], ['energize', 2.5], ['energization', 2.5], ['power on', 2.5], ['utility power', 2.5], ['service entrance', 2]] },
  { id: 'drywall', category: 'interiors', label: 'drywall', phrases: [['drywall', 2], ['gypsum', 2], ['gypsum wall board', 2], ['sheetrock', 2], ['hang', 1.2], ['tape', 1], ['tape and finish', 2], ['insulation', 0.8], ['board', 0.6], ['shaft wall', 1.5]] },
  { id: 'finishes', plural: true, category: 'finishes', label: 'finishes', phrases: [['paint', 1.5], ['painting', 1.5], ['prime', 1], ['flooring', 1.5], ['carpet', 1.5], ['tile'], ['vinyl composition tile', 1.5], ['luxury vinyl tile', 1.5], ['ceilings'], ['ceiling'], ['acoustical ceiling tile', 1.5], ['ceiling grid', 1.5], ['millwork', 1.5], ['casework', 1.5], ['doors'], ['door'], ['hardware'], ['wall covering'], ['epoxy'], ['polished concrete'], ['terrazzo'], ['countertops'], ['cabinets'], ['trim', 0.8], ['finishes', 1.5], ['finish', 0.6], ['base', 0.6], ['hollow metal']] },
  { id: 'mepTrim', category: 'mep', label: 'MEP trim-out', phrases: [['trim out', 2], ['mechanical electrical plumbing trim', 2.5], ['electrical trim', 2.5], ['plumbing trim', 2.5], ['mechanical trim', 2.5], ['fixtures', 1.5], ['light fixtures', 2], ['lighting fixtures', 2], ['lighting', 1], ['plumbing fixtures', 2], ['devices', 1.5], ['diffusers', 1.5], ['grilles', 1.5], ['registers'], ['set fixtures', 2]] },
  { id: 'specialties', plural: true, category: 'equipment', label: 'equipment and specialties', phrases: [['elevator', 2], ['elevators', 2], ['escalator', 2], ['escalators', 2], ['specialties', 2], ['toilet partitions', 2], ['toilet accessories', 2], ['signage', 1.5], ['lockers', 1.5], ['fire extinguishers', 1.5], ['appliances', 1.5], ['food service equipment', 2], ['kitchen equipment', 2], ['furniture fixtures and equipment', 2], ['furniture', 1.5], ['owner equipment', 2], ['window treatments', 2], ['blinds'], ['equipment', 0.6]] },
  { id: 'paving', plural: true, category: 'sitework', label: 'paving and landscaping', phrases: [['paving', 2], ['pavement', 2], ['asphalt', 2], ['hot mix asphalt', 2], ['curb', 1.5], ['curbs', 1.5], ['gutter'], ['sidewalk', 1.5], ['sidewalks', 1.5], ['striping', 1.5], ['landscaping', 2], ['landscape', 2], ['irrigation', 1.5], ['sod'], ['seeding'], ['planting'], ['hardscape', 1.5], ['final grading', 2], ['site concrete', 2], ['parking lot', 2]] },
  { id: 'cx', category: 'closeout', label: 'commissioning', phrases: [['commissioning', 3], ['testing adjusting balancing', 3], ['testing and balancing', 3], ['test and balance', 3], ['startup', 2.5], ['start up', 2.5], ['functional performance test', 3], ['integrated systems test', 3], ['pre functional', 2.5], ['controls checkout', 2.5], ['flush', 1.5], ['building management system', 1], ['building automation system', 1], ['controls', 1]] },
  { id: 'inspection', plural: true, category: 'permits', label: 'final inspections', phrases: [['final inspection', 3], ['final inspections', 3], ['fire marshal', 3], ['life safety', 2.5], ['certificate of occupancy', 3], ['temporary certificate of occupancy', 3.5], ['authority having jurisdiction', 2], ['sign off', 1.5]] },
  { id: 'punch', category: 'closeout', label: 'punch list', phrases: [['punch list', 3], ['punch', 3], ['final clean', 2.5], ['final cleaning', 2.5], ['owner walkthrough', 2.5], ['walk through', 1.5]] },
  { id: 'completion', category: 'closeout', label: 'substantial completion', phrases: [['substantial completion', 3.5], ['beneficial occupancy', 3], ['turnover', 2], ['owner occupancy', 3], ['move in', 2]] },
  { id: 'closeoutDocs', plural: true, category: 'closeout', label: 'closeout documents', phrases: [['closeout', 3], ['close out', 3], ['as builts', 3], ['as built', 3], ['operations and maintenance', 3], ['warranties', 3], ['warranty', 3], ['training', 2.5], ['attic stock', 3], ['record drawings', 3], ['demobilization', 3], ['demobilize', 3]] },
  { id: 'final', category: 'closeout', label: 'final completion', phrases: [['final completion', 4], ['project complete', 3.5], ['project completion', 3.5], ['final acceptance', 4], ['contract completion', 3.5], ['project finish', 3]] },
  // Modifier stages: used when a submittal / procurement / permit / inspection activity names no trade.
  { id: 'permit', plural: true, category: 'permits', label: 'permits', phrases: [] },
  { id: 'submittal', plural: true, category: 'procurement', label: 'submittals', phrases: [] },
  { id: 'procure', category: 'procurement', label: 'procurement', phrases: [] },
]
export const STAGE_BY_ID = new Map(STAGES.map(s => [s.id, s]))
/** "follows" / "follow" for a stage label */
export const verb = (stage: StageId | null, singular: string, plural: string) => (stage && STAGE_BY_ID.get(stage)?.plural ? plural : singular)

export type Modifier = 'submittal' | 'procure' | 'permit' | 'inspect'
const MODIFIERS: { id: Modifier; phrases: string[] }[] = [
  { id: 'submittal', phrases: ['submittal', 'submittals', 'shop drawings', 'shop drawing', 'product data', 'samples', 'submit', 'mockup approval'] },
  { id: 'procure', phrases: ['procurement', 'procure', 'fabrication', 'fabricate', 'delivery', 'deliver', 'delivered', 'deliveries', 'purchase order', 'order', 'lead time', 'manufacture', 'manufacturing', 'buyout', 'release for fabrication'] },
  { id: 'permit', phrases: ['permit', 'permits', 'plan review', 'zoning', 'entitlements', 'stormwater pollution prevention plan'] },
  { id: 'inspect', phrases: ['inspection', 'inspections', 'inspect', 'pressure test', 'observation', 'cover inspection'] },
]
const MODIFIER_STAGE: Record<Modifier, StageId> = { submittal: 'submittal', procure: 'procure', permit: 'permit', inspect: 'inspection' }

export interface Classification {
  /** Where the activity sits in the work: its trade stage, or the modifier's own stage when no trade is named */
  stage: StageId | null
  /** The trade a submittal / procurement / permit / inspection is about ("Deliver steel" → structure) */
  trade: StageId | null
  modifier: Modifier | null
  category: WorkCategory
  categoryLabel: string
  stageLabel: string
  /** 0..1 */
  confidence: number
  /** The matching terms and expansions: the "why" */
  terms: string[]
  source: 'name' | 'wbs' | 'taxonomy' | 'neighbours' | 'none'
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const phraseRe = new Map<string, RegExp>()
function has(text: string, phrase: string): boolean {
  let re = phraseRe.get(phrase)
  if (!re) { re = new RegExp(`(?:^| )${esc(phrase)}(?= |$)`); phraseRe.set(phrase, re) }
  return re.test(text)
}
const weightOf = (p: string, w?: number) => w ?? 1 + 0.6 * (p.split(' ').length - 1)

interface Scored { stage: StageDef; score: number; terms: string[] }
// Longest phrases first, so "structural steel" is counted once and not again as "steel".
const BY_LENGTH = STAGES.map(st => ({ st, phrases: [...st.phrases].sort((x, y) => y[0].length - x[0].length) }))
function scoreStages(text: string): Scored[] {
  const out: Scored[] = []
  for (const { st, phrases } of BY_LENGTH) {
    let score = 0
    const terms: string[] = []
    for (const [p, w] of phrases) {
      // A phrase inside a longer matched phrase of the same stage does not count twice.
      if (has(text, p) && !terms.some(t => has(t, p))) { score += weightOf(p, w); terms.push(p) }
    }
    if (score > 0) out.push({ stage: st, score, terms })
  }
  return out.sort((x, y) => y.score - x.score)
}

function modifierOf(text: string): { id: Modifier; term: string } | null {
  for (const m of MODIFIERS) for (const p of m.phrases) if (has(text, p)) return { id: m.id, term: p }
  return null
}

/** The existing taxonomy's canonical categories, mapped to work stages (second opinion and fallback). */
const FROM_TAXONOMY: Partial<Record<CanonicalCategory, StageId>> = {
  ntp: 'start', design_sd: 'precon', design_dd: 'precon', design_cd: 'precon', design_review: 'precon',
  permit_site: 'permit', permit_building: 'permit', permit_other: 'permit', submittals: 'submittal', procurement: 'procure',
  mobilization: 'mobilize', demolition: 'demo', abatement: 'demo', earthwork: 'earthwork', erosion_control: 'earthwork',
  utilities_site: 'utilities', row_utilities: 'utilities', drainage: 'utilities', pipeline: 'utilities',
  deep_foundations: 'deepfdn', foundations: 'foundation', concrete_cure: 'cure', slab_on_grade: 'sog',
  structure_steel: 'structure', structure_concrete: 'structure', structure_wood: 'structure',
  roofing: 'roofing', exterior_skin: 'skin', windows_curtainwall: 'skin', dry_in: 'dryin',
  mep_rough: 'mepRough', fire_protection: 'mepRough', low_voltage: 'mepRough', electrical_service: 'power', mechanical_equipment: 'mepEquip',
  elevators: 'specialties', specialties: 'specialties', framing_drywall: 'drywall', finishes: 'finishes',
  paving_landscape: 'paving', roadway: 'paving', restoration: 'paving', commissioning: 'cx', startup_testing: 'cx',
  inspections: 'inspection', punchlist: 'punch', substantial_completion: 'completion', closeout: 'closeoutDocs', final_completion: 'final',
}

const round2 = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 100) / 100

function result(stage: StageId | null, trade: StageId | null, modifier: Modifier | null, confidence: number, terms: string[], source: Classification['source']): Classification {
  const st = stage ? STAGE_BY_ID.get(stage)! : null
  const tr = trade ? STAGE_BY_ID.get(trade)! : null
  // A trade-specific submittal / procurement / permit is filed under its own category; an inspection of
  // a trade is an inspection. The label names both ("structure procurement").
  const category: WorkCategory = modifier ? STAGE_BY_ID.get(MODIFIER_STAGE[modifier])!.category : st?.category ?? 'unknown'
  const stageLabel = modifier && tr ? `${tr.label} ${modifier === 'inspect' ? 'inspection' : STAGE_BY_ID.get(MODIFIER_STAGE[modifier])!.label.replace(/s$/, '')}` : st?.label ?? 'unrecognised work'
  return { stage, trade, modifier, category, categoryLabel: CATEGORIES[category], stageLabel, confidence: round2(confidence), terms, source }
}

function fromText(text: string): { best: Scored | null; runnerUp: Scored | null; modifier: { id: Modifier; term: string } | null } {
  const scored = scoreStages(text)
  const best = scored[0] ?? null
  const runnerUp = scored.find(s => best && s.stage.category !== best.stage.category) ?? null
  return { best, runnerUp, modifier: modifierOf(text) }
}

/**
 * Classify one activity name (WBS path as a secondary signal). Deterministic; returns the work stage,
 * its category, a confidence and the terms that matched.
 */
export function classifyName(name: string, wbs?: string | null): Classification {
  const n = normalizeName(name)
  const expansions = n.expansions.map(e => `${e.abbr.toUpperCase()} = ${e.full}`)
  const own = fromText(n.text)
  const w = wbs ? fromText(normalizeName(wbs).text) : null
  const tax = taxonomyClassify(name, wbs ?? undefined)
  const taxStage = tax.category !== 'other' ? FROM_TAXONOMY[tax.category] ?? null : null

  const finish = (best: Scored | null, runnerUp: Scored | null, mod: { id: Modifier; term: string } | null, base: number, source: Classification['source']): Classification | null => {
    // Stages that already are an inspection / completion / commissioning do not take a modifier.
    const intrinsic = best && ['inspection', 'cx', 'completion', 'final', 'closeoutDocs', 'start'].includes(best.stage.id)
    const modifier = mod && !intrinsic ? mod.id : null
    if (!best && !modifier) return null
    const trade = modifier && best ? best.stage.id : null
    const stage: StageId = modifier ? (modifier === 'inspect' && trade ? trade : MODIFIER_STAGE[modifier]) : best!.stage.id
    const score = (best?.score ?? 0) + (modifier ? 1.5 : 0)
    let conf = base * (0.4 + 0.25 * Math.min(score, 2.2))
    if (best && runnerUp && runnerUp.score >= 0.75 * best.score && !modifier) conf -= 0.15
    if (taxStage && (taxStage === stage || taxStage === trade)) conf += 0.05
    if (w?.best && (w.best.stage.id === stage || w.best.stage.id === trade)) conf += 0.05
    const terms = [...(best?.terms ?? []), ...(modifier && mod ? [mod.term] : []), ...expansions]
    return result(stage, trade, modifier, conf, source === 'wbs' ? terms.map(t => `WBS: ${t}`) : terms, source)
  }

  const byName = finish(own.best, own.runnerUp, own.modifier, 1, 'name')
  if (byName) return byName
  const byWbs = w ? finish(w.best, w.runnerUp, w.modifier, 0.7, 'wbs') : null
  if (byWbs) return byWbs
  if (taxStage) return result(taxStage, null, null, Math.min(0.6, tax.confidence * 0.7), [`taxonomy: ${tax.matched ?? tax.category}`, ...expansions], 'taxonomy')
  return result(null, null, null, 0, expansions, 'none')
}
