// Activity template catalog: a complete, logically-sound building schedule network for every ProjectType.
//
// The catalog contains one or more VARIANTS per canonical category. templatesFor(profile) picks exactly one
// variant per category (first definite match, else first possible match), picks one structural system,
// and re-wires predecessor links around categories that do not apply (e.g., no demolition on new construction)
// by inheriting the missing activity's own predecessors. Durations are REFERENCE DEFAULTS in work days,
// calibrated so that a ~100,000 sf, 4-story steel office lands at roughly 14–20 months from mobilization to
// substantial completion. They are planning starting points, not productivity guarantees.

import type {
  Applicability,
  CanonicalCategory,
  LinkType,
  ProjectProfile,
  TemplateActivity,
} from '@/lib/planning/types'
import { CANONICAL_CATEGORIES, PROJECT_TYPES, isCivilType } from '@/lib/planning/types'
import { CIVIL_CATALOG } from './templates-civil'
import { appliesTri, type Tri } from './applicability'
import { phaseOf } from '@/lib/semantic/taxonomy'

export const DEFAULT_SQFT = 50000
export const DEFAULT_STORIES = 1
export const DEFAULT_VALUE_MUSD = 20

export const STRUCTURE_CATEGORIES: CanonicalCategory[] = ['structure_steel', 'structure_concrete', 'structure_wood']
const isStructure = (c: CanonicalCategory) => STRUCTURE_CATEGORIES.includes(c)

const NEW_WORK = { scopes: ['new_construction', 'addition'] } as const satisfies Applicability
const RENOVATION = { scopes: ['renovation', 'renovation_occupied'] } as const satisfies Applicability

type Pred = TemplateActivity['preds'][number]
const fs = (category: CanonicalCategory, lag = 0): Pred => ({ category, type: 'FS', lag })
const ss = (category: CanonicalCategory, lag = 0): Pred => ({ category, type: 'SS', lag })
const ff = (category: CanonicalCategory, lag = 0): Pred => ({ category, type: 'FF', lag })

function t(
  category: CanonicalCategory,
  name: string,
  appliesWhen: Applicability,
  duration: TemplateActivity['duration'],
  preds: Pred[],
  opts: { milestone?: boolean; note?: string } = {},
): TemplateActivity {
  return { category, name, phase: phaseOf(category), appliesWhen, duration, preds, ...opts }
}

const MS = { base: 0, min: 0, max: 0 }

/** Canonical catalog (variants listed most-specific first within a category). */
const CATALOG: TemplateActivity[] = [
  t('ntp', 'Notice to Proceed', {}, MS, [], { milestone: true }),

  // Design
  t('design_sd', 'Schematic design (SD)', {}, { base: 25, perKsf: 0.08, min: 20, max: 60 }, [fs('ntp')]),
  t('design_dd', 'Design development (DD)', {}, { base: 35, perKsf: 0.12, min: 25, max: 90 }, [fs('design_sd')]),
  t('design_cd', 'Construction documents (CD)', {}, { base: 45, perKsf: 0.15, min: 30, max: 120 }, [fs('design_dd')]),
  t('design_review', 'Agency design review & comment resolution (e.g., USACE/NAVFAC final review)', { projectTypes: ['federal_defense'] },
    { base: 25, perKsf: 0.03, min: 20, max: 45 }, [fs('design_cd')],
    { note: 'Represents the final government review cycle; staged 35/65/95% reviews are embedded in design durations.' }),
  t('design_review', 'Agency design review & comment resolution', { federalOnly: true },
    { base: 20, perKsf: 0.02, min: 15, max: 40 }, [fs('design_cd')]),

  // Permits (placeholders — the generator substitutes specific PermitSpec activities)
  t('permit_site', 'Site / grading & stormwater permits (placeholder)', NEW_WORK,
    { base: 30, perKsf: 0.02, min: 20, max: 60 }, [fs('design_dd')],
    { note: 'Replaced by regional PermitSpec activities (grading, NPDES/SWPPP, etc.).' }),
  t('permit_building', 'Building permit plan review & issuance (placeholder)', {},
    { base: 40, perKsf: 0.1, min: 30, max: 90 }, [fs('design_review')],
    { note: 'Replaced by regional PermitSpec activities (local building permit, HCAI, DSA, etc.).' }),

  // Procurement
  t('submittals', 'Submittals & shop drawings — primary trades', {}, { base: 25, perKsf: 0.05, min: 20, max: 60 }, [fs('design_review')],
    { note: 'Starts at contract award; long-lead items get their own submittal/fabrication activities.' }),
  t('procurement', 'Fabrication & delivery — structural package', {}, { base: 50, perKsf: 0.1, min: 40, max: 110 }, [fs('submittals')]),

  // Sitework
  t('mobilization', 'Mobilization & site setup', {}, { base: 8, perKsf: 0.01, min: 5, max: 15 }, [fs('permit_site'), fs('design_review')]),
  t('abatement', 'Hazardous materials abatement', RENOVATION, { base: 10, perKsf: 0.1, min: 5, max: 45 }, [fs('mobilization'), fs('permit_building')]),
  t('demolition', 'Selective demolition', RENOVATION, { base: 10, perKsf: 0.15, min: 10, max: 60 }, [fs('abatement')]),
  t('earthwork', 'Site clearing, mass excavation & grading', NEW_WORK, { base: 15, perKsf: 0.12, min: 10, max: 60 }, [fs('mobilization'), fs('permit_site')]),
  t('utilities_site', 'Site utilities (storm, sanitary, water, fire line, duct banks)', NEW_WORK,
    { base: 20, perKsf: 0.1, min: 15, max: 60 }, [ss('earthwork', 10)]),
  t('deep_foundations', 'Deep foundations (piles / drilled piers)', { ...NEW_WORK, projectTypes: ['data_center', 'healthcare'] },
    { base: 15, perKsf: 0.1, perStory: 1, min: 15, max: 60 }, [ss('earthwork', 10)],
    { note: 'Included by default for data center/healthcare; confirm with geotechnical report.' }),
  t('deep_foundations', 'Deep foundations (piles / drilled piers)', { ...NEW_WORK, minStories: 6 },
    { base: 15, perKsf: 0.1, perStory: 1, min: 15, max: 60 }, [ss('earthwork', 10)]),
  t('foundations', 'Foundations (footings, grade beams, pile caps) — F/R/P', NEW_WORK,
    { base: 18, perKsf: 0.12, min: 15, max: 70 }, [fs('deep_foundations'), fs('permit_building')]),
  t('slab_on_grade', 'Underslab utilities & slab on grade', NEW_WORK,
    { base: 10, perKsf: 0.1, min: 8, max: 45 }, [ss('foundations', 15), ss('utilities_site', 10)]),

  // Structure — exactly one is selected (first definite match in this order)
  t('structure_concrete', 'Cast-in-place concrete frame (columns, walls, elevated decks)', { ...NEW_WORK, projectTypes: ['federal_defense', 'lab_research'] },
    { base: 20, perKsf: 0.3, perStory: 12, min: 30, max: 300 }, [ss('foundations', 20), fs('procurement')],
    { note: 'Concrete frame assumed for progressive-collapse/antiterrorism (DoD) and vibration-sensitive labs.' }),
  t('structure_concrete', 'Cast-in-place / post-tensioned concrete frame', { ...NEW_WORK, projectTypes: ['multifamily'], minStories: 6 },
    { base: 20, perKsf: 0.25, perStory: 10, min: 30, max: 300 }, [ss('foundations', 20), fs('procurement')],
    { note: 'Above ~5 stories multifamily typically uses concrete (or podium + Type III/IV wood — adjust).' }),
  t('structure_wood', 'Wood framing (Type V/III), sheathing & trusses', { ...NEW_WORK, projectTypes: ['multifamily'] },
    { base: 15, perKsf: 0.35, perStory: 10, min: 20, max: 200 }, [fs('slab_on_grade'), fs('procurement')]),
  t('structure_steel', 'Tilt-up panel erection, steel roof framing, joists & deck', { ...NEW_WORK, projectTypes: ['warehouse_industrial'] },
    { base: 20, perKsf: 0.08, perStory: 5, min: 20, max: 120 }, [ss('foundations', 15), fs('procurement')],
    { note: 'Large single-story distribution buildings: productivity scales sub-linearly with area (multiple crews/cranes).' }),
  t('structure_steel', 'Structural steel erection, deck & detail', NEW_WORK,
    { base: 20, perKsf: 0.2, perStory: 5, min: 20, max: 160 }, [ss('foundations', 15), fs('procurement')]),

  // Envelope
  t('roofing', 'Roofing (membrane, insulation, flashing)', NEW_WORK, { base: 15, perKsf: 0.08, min: 10, max: 50 }, [fs('structure_steel')]),
  t('exterior_skin', 'Exterior panel finishes, sealants, dock equipment & overhead doors', { ...NEW_WORK, projectTypes: ['warehouse_industrial'] },
    { base: 25, perKsf: 0.05, min: 20, max: 90 }, [ss('structure_steel', 20)]),
  t('exterior_skin', 'Exterior skin / cladding & air barrier', NEW_WORK, { base: 30, perKsf: 0.3, perStory: 5, min: 25, max: 200 }, [ss('structure_steel', 20)]),
  t('windows_curtainwall', 'Office storefront, windows & clerestory glazing', { ...NEW_WORK, projectTypes: ['warehouse_industrial'] },
    { base: 10, perKsf: 0.01, min: 10, max: 30 }, [ss('exterior_skin', 15)]),
  // Data centers are precast / insulated-panel boxes: entrance and admin storefront only, unless the
  // interview says there is curtain wall (envelope.curtain_wall), and the envelope itself drives dry-in.
  t('windows_curtainwall', 'Entrance & admin-area storefront glazing', { ...NEW_WORK, projectTypes: ['data_center'] },
    { base: 8, perKsf: 0.01, min: 5, max: 20 }, [ss('exterior_skin', 15)]),
  t('windows_curtainwall', 'Windows, storefront & curtain wall', NEW_WORK, { base: 20, perKsf: 0.2, perStory: 3, min: 15, max: 150 }, [ss('exterior_skin', 15)]),
  t('dry_in', 'Building dried-in / watertight', { ...NEW_WORK, projectTypes: ['data_center'] }, MS, [fs('roofing'), fs('exterior_skin'), fs('windows_curtainwall')], { milestone: true }),
  t('dry_in', 'Building dried-in / watertight', NEW_WORK, MS, [fs('roofing'), fs('windows_curtainwall')], { milestone: true }),

  // MEP
  t('mep_rough', 'MEP rough-in (overhead distribution, office pod in-wall)', { projectTypes: ['warehouse_industrial'] }, { base: 30, perKsf: 0.08, min: 25, max: 120 },
    [ss('structure_steel', 25), fs('slab_on_grade'), fs('demolition')]),
  t('mep_rough', 'MEP rough-in (overhead & in-wall)', {}, { base: 40, perKsf: 0.35, perStory: 5, min: 30, max: 250 },
    [ss('structure_steel', 25), fs('slab_on_grade'), fs('demolition')]),
  // Data center power train: generators/paralleling gear and UPS/PDUs are set in parallel, then the
  // service is energized and backfeeds them. Their only predecessor (MEP rough-in) matches permanent
  // power's own, so other building types that skip them inherit no extra logic.
  t('power_equipment', 'Power train — set generators, paralleling switchgear & ATS; fuel system & connect', { projectTypes: ['data_center'] },
    { base: 30, perKsf: 0.2, min: 30, max: 120 }, [ss('mep_rough', 30)],
    { note: 'Generator and paralleling-gear deliveries usually drive this; see long-lead catalog.' }),
  t('conductors', 'Power train — UPS modules & batteries, PDUs / RPPs & overhead busway; terminate', { projectTypes: ['data_center'] },
    { base: 30, perKsf: 0.25, min: 30, max: 150 }, [ss('mep_rough', 30)],
    { note: 'UPS and battery deliveries usually drive this; lithium-ion systems may need fire-code review.' }),
  t('electrical_service', 'Permanent power — MV switchgear & utility service set, energize & backfeed the power train', { projectTypes: ['data_center'] },
    { base: 20, perKsf: 0.05, min: 10, max: 60 }, [fs('utilities_site'), ss('mep_rough', 30), fs('power_equipment'), fs('conductors')]),
  t('electrical_service', 'Permanent power — service equipment set & energize', {}, { base: 20, perKsf: 0.05, min: 10, max: 60 },
    [fs('utilities_site'), ss('mep_rough', 30), fs('power_equipment'), fs('conductors')], { note: 'Utility and switchgear long-lead items usually drive this; see long-lead catalog.' }),
  t('mechanical_equipment', 'Set mechanical equipment (AHUs/RTUs/chillers/CRAHs) & connect', { projectTypes: ['data_center'] },
    { base: 30, perKsf: 0.25, min: 25, max: 150 }, [ss('roofing', 10), ss('mep_rough', 20)]),
  t('mechanical_equipment', 'Set RTUs, unit heaters & exhaust fans', { projectTypes: ['warehouse_industrial'] },
    { base: 15, perKsf: 0.03, min: 15, max: 45 }, [ss('roofing', 10), ss('mep_rough', 20)]),
  t('mechanical_equipment', 'Set mechanical equipment (AHUs/RTUs/chillers) & connect', {},
    { base: 20, perKsf: 0.1, min: 15, max: 90 }, [ss('roofing', 10), ss('mep_rough', 20)]),
  t('fire_protection', 'ESFR sprinkler, fire pump & fire alarm installation', { projectTypes: ['warehouse_industrial'] }, { base: 30, perKsf: 0.07, min: 25, max: 110 }, [ss('mep_rough', 10)]),
  t('fire_protection', 'Fire sprinkler & fire alarm installation', {}, { base: 30, perKsf: 0.2, perStory: 3, min: 20, max: 150 }, [ss('mep_rough', 10)]),
  t('elevators', 'Elevator installation & state/AHJ acceptance', { minStories: 2 }, { base: 40, perStory: 5, min: 40, max: 160 },
    [fs('structure_steel', 10), fs('dry_in')]),
  t('low_voltage', 'Low voltage (data, security, access control)', { projectTypes: ['warehouse_industrial'] }, { base: 15, perKsf: 0.03, min: 15, max: 45 }, [ss('mep_rough', 30)]),
  t('low_voltage', 'Low voltage (data, security, AV, BAS controls)', {}, { base: 20, perKsf: 0.15, min: 15, max: 120 }, [ss('mep_rough', 30)]),

  // Interiors
  t('framing_drywall', 'Office pod framing & drywall', { projectTypes: ['warehouse_industrial'] }, { base: 20, perKsf: 0.02, min: 15, max: 60 },
    [ss('mep_rough', 30), fs('dry_in')]),
  t('framing_drywall', 'Interior framing, drywall hang/tape/finish', {}, { base: 30, perKsf: 0.35, perStory: 5, min: 25, max: 250 },
    [ss('mep_rough', 30), fs('dry_in')]),
  t('finishes', 'Office pod finishes, warehouse floor sealer & striping', { projectTypes: ['warehouse_industrial'] }, { base: 25, perKsf: 0.03, min: 20, max: 70 },
    [ss('framing_drywall', 15), ff('framing_drywall', 10)]),
  t('finishes', 'Interior finishes (paint, ceilings, flooring, doors, millwork)', {}, { base: 40, perKsf: 0.35, perStory: 5, min: 30, max: 250 },
    [ss('framing_drywall', 30), ff('framing_drywall', 15)]),
  t('specialties', 'Specialties & equipment (toilet accessories, signage, owner equipment)', {}, { base: 15, perKsf: 0.05, min: 10, max: 50 },
    [ss('finishes', 30), ff('finishes', 5)]),
  t('paving_landscape', 'Paving, striping, hardscape & landscaping', NEW_WORK, { base: 20, perKsf: 0.08, min: 15, max: 60 },
    [fs('exterior_skin'), fs('utilities_site')]),

  // Commissioning / completion
  t('inspections', 'Final inspections (building, fire, elevator, health) & certificate of occupancy', {}, { base: 10, perKsf: 0.05, min: 10, max: 30 },
    [fs('finishes'), fs('fire_protection'), fs('elevators'), fs('electrical_service'), fs('mechanical_equipment')]),
  t('commissioning', 'Commissioning (L1–L5) & integrated systems testing', { projectTypes: ['data_center'] },
    { base: 40, perKsf: 0.3, min: 40, max: 150 }, [fs('mechanical_equipment'), fs('electrical_service'), fs('fire_protection'), fs('low_voltage')],
    { note: 'Includes factory witness testing follow-up, load-bank and integrated systems tests (IST).' }),
  t('commissioning', 'Commissioning, TAB & life-safety/infection-control testing', { projectTypes: ['healthcare'] },
    { base: 40, perKsf: 0.25, min: 40, max: 130 }, [fs('mechanical_equipment'), fs('electrical_service'), fs('fire_protection'), fs('low_voltage')],
    { note: 'Includes pressure-relationship verification, NFPA 99 medical gas certification and essential electrical system testing.' }),
  t('commissioning', 'Commissioning, TAB & fume hood certification', { projectTypes: ['lab_research'] },
    { base: 35, perKsf: 0.25, min: 35, max: 120 }, [fs('mechanical_equipment'), fs('electrical_service'), fs('fire_protection'), fs('low_voltage')]),
  t('commissioning', 'Commissioning & test-and-balance (TAB)', {},
    { base: 20, perKsf: 0.1, min: 15, max: 60 }, [fs('mechanical_equipment'), fs('electrical_service'), fs('fire_protection'), fs('low_voltage')]),
  t('punchlist', 'Punch list & corrections', {}, { base: 15, perKsf: 0.05, min: 10, max: 40 }, [fs('finishes', -5), fs('specialties')]),
  t('substantial_completion', 'Substantial completion', {}, MS,
    [fs('punchlist'), fs('commissioning'), fs('inspections'), fs('paving_landscape')], { milestone: true }),
  t('closeout', 'Closeout (O&M manuals, as-builts, warranties, training, final punch)', {}, { base: 20, perKsf: 0.03, min: 15, max: 60 }, [fs('substantial_completion')]),
  t('final_completion', 'Final completion', {}, MS, [fs('closeout')], { milestone: true }),
]

/* ─── Selection & link resolution ─────────────────────── */

/** Default (definition) variant per category: the last, most generic variant in the catalog. */
const DEFINITION = new Map<CanonicalCategory, TemplateActivity>()
for (const v of CATALOG) DEFINITION.set(v.category, v)
const CIVIL_DEFINITION = new Map<CanonicalCategory, TemplateActivity>()
for (const v of CIVIL_CATALOG) CIVIL_DEFINITION.set(v.category, v)
/** Civil/infrastructure types use their own catalog. */
const catalogFor = (p: ProjectProfile) => (isCivilType(p.projectType) ? CIVIL_CATALOG : CATALOG)
const definitionsFor = (p: ProjectProfile) => (isCivilType(p.projectType) ? CIVIL_DEFINITION : DEFINITION)

function pick(variants: TemplateActivity[], p: ProjectProfile): TemplateActivity | undefined {
  let firstUnknown: TemplateActivity | undefined
  for (const v of variants) {
    const r: Tri = appliesTri(v.appliesWhen, p)
    if (r === 'yes') return v
    if (r === 'unknown' && !firstUnknown) firstUnknown = v
  }
  return firstUnknown
}

/** The structural-system category selected for this profile (undefined for pure renovations). */
export function selectedStructure(p: ProjectProfile): CanonicalCategory | undefined {
  return pick(catalogFor(p).filter((v) => isStructure(v.category)), p)?.category
}

function selectRaw(p: ProjectProfile): TemplateActivity[] {
  const CAT = catalogFor(p)
  const out: TemplateActivity[] = []
  const seen = new Set<CanonicalCategory>()
  const structure = pick(CAT.filter((v) => isStructure(v.category)), p)
  for (const v of CAT) {
    if (seen.has(v.category)) continue
    if (isStructure(v.category)) {
      if (structure && v === structure) {
        out.push(v)
        STRUCTURE_CATEGORIES.forEach((c) => seen.add(c))
      }
      continue
    }
    const chosen = pick(CAT.filter((x) => x.category === v.category), p)
    seen.add(v.category)
    if (chosen) out.push(chosen)
  }
  return out
}

/** Map a category (e.g., a permit `gates` value) onto the category used for this profile's network. */
export function mapToSelected(c: CanonicalCategory, p: ProjectProfile): CanonicalCategory {
  if (isStructure(c)) return selectedStructure(p) ?? c
  return c
}

function resolvePreds(
  preds: Pred[],
  selected: Set<CanonicalCategory>,
  structure: CanonicalCategory | undefined,
  visiting: Set<CanonicalCategory>,
  defs: Map<CanonicalCategory, TemplateActivity> = DEFINITION,
): Pred[] {
  const out: Pred[] = []
  for (const pr of preds) {
    let cat = pr.category
    if (isStructure(cat) && structure) cat = structure
    if (selected.has(cat)) {
      out.push({ ...pr, category: cat })
      continue
    }
    if (visiting.has(cat)) continue
    const def = defs.get(cat)
    if (!def) continue
    visiting.add(cat)
    // Inherit the missing activity's own predecessors (keeping their link types/lags).
    out.push(...resolvePreds(def.preds, selected, structure, visiting, defs))
    visiting.delete(cat)
  }
  return out
}

/** Filtered, one-activity-per-category template network with predecessors resolved for this profile. */
export function templatesFor(profile: ProjectProfile): TemplateActivity[] {
  const raw = selectRaw(profile)
  const selected = new Set(raw.map((v) => v.category))
  const structure = raw.find((v) => isStructure(v.category))?.category
  const out = raw.map((v) => {
    const resolved = resolvePreds(v.preds, selected, structure, new Set([v.category]), definitionsFor(profile)).filter((pr) => pr.category !== v.category)
    const seen = new Set<string>()
    const preds = resolved.filter((pr) => {
      const k = `${pr.category}|${pr.type}|${pr.lag}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    return { ...v, preds }
  })
  return pruneRedundant(out)
}

/**
 * Remove FS/0 links that are implied by another predecessor (e.g., A←P and A←Q where Q already
 * cannot finish before P finishes). Keeps the network free of redundant logic ties.
 */
function pruneRedundant(acts: TemplateActivity[]): TemplateActivity[] {
  const order = topoOrder(acts)
  if (!order) return acts
  const byCat = new Map(acts.map((a) => [a.category, a]))
  // F(q): activities guaranteed to finish no later than q finishes; S(q): ... no later than q starts
  const F = new Map<CanonicalCategory, Set<CanonicalCategory>>()
  const S = new Map<CanonicalCategory, Set<CanonicalCategory>>()
  for (const c of order) {
    const f = new Set<CanonicalCategory>()
    const st = new Set<CanonicalCategory>()
    for (const pr of byCat.get(c)!.preds) {
      if (pr.lag < 0) continue
      const fx = F.get(pr.category)!
      const sx = S.get(pr.category)!
      if (pr.type === 'FS') { st.add(pr.category); fx.forEach((x) => st.add(x)) }
      else if (pr.type === 'FF') { f.add(pr.category); fx.forEach((x) => f.add(x)) }
      else if (pr.type === 'SS') sx.forEach((x) => st.add(x))
    }
    st.forEach((x) => f.add(x))
    F.set(c, f)
    S.set(c, st)
  }
  return acts.map((a) => {
    const keep = a.preds.filter((p) => {
      if (p.type !== 'FS' || p.lag !== 0) return true
      return !a.preds.some((q) =>
        q !== p && q.category !== p.category && q.lag >= 0 &&
        ((q.type === 'FS' && F.get(q.category)!.has(p.category)) || (q.type === 'SS' && S.get(q.category)!.has(p.category))),
      )
    })
    return keep.length === a.preds.length ? a : { ...a, preds: keep }
  })
}

const INTERIOR_PHASES = new Set(['mep', 'interiors'])

/** Work days for a template given the profile (milestones = 0). */
export function computeTemplateDuration(t: TemplateActivity, profile: ProjectProfile): number {
  if (t.milestone) return 0
  // Civil templates are sized per USD 1M of construction value (default $20M); buildings per 1,000 sf.
  const ksf = isCivilType(profile.projectType)
    ? (profile.valueMusd && profile.valueMusd > 0 ? profile.valueMusd : DEFAULT_VALUE_MUSD)
    : (profile.grossSqft && profile.grossSqft > 0 ? profile.grossSqft : DEFAULT_SQFT) / 1000
  const stories = profile.stories && profile.stories > 0 ? profile.stories : DEFAULT_STORIES
  const d = t.duration
  let days = d.base + (d.perKsf ?? 0) * ksf + (d.perStory ?? 0) * stories
  days = Math.min(d.max, Math.max(d.min, days))
  // Occupied renovations: phasing, off-hours work and infection-control/ICRA barriers reduce interior productivity.
  if (profile.scope === 'renovation_occupied' && INTERIOR_PHASES.has(t.phase)) days *= 1.25
  return Math.max(1, Math.round(days))
}

/* ─── Quick forward pass (planning estimate only; the real CPM engine lives elsewhere) ── */

export interface TemplateNetworkEstimate {
  /** Early start / early finish in work days from NTP (day 0) */
  times: Partial<Record<CanonicalCategory, { es: number; ef: number; duration: number }>>
  finish: number
}

export function estimateTemplateNetwork(profile: ProjectProfile): TemplateNetworkEstimate {
  const acts = templatesFor(profile)
  const order = topoOrder(acts)
  if (!order) throw new Error('Template network contains a cycle')
  const byCat = new Map(acts.map((a) => [a.category, a]))
  const times: TemplateNetworkEstimate['times'] = {}
  let finish = 0
  for (const c of order) {
    const a = byCat.get(c)!
    const dur = computeTemplateDuration(a, profile)
    let es = 0
    for (const p of a.preds) {
      const pt = times[p.category]!
      const cand = linkStart(p.type, pt.es, pt.ef, p.lag, dur)
      if (cand > es) es = cand
    }
    times[c] = { es, ef: es + dur, duration: dur }
    finish = Math.max(finish, es + dur)
  }
  return { times, finish }
}

function linkStart(type: LinkType, pes: number, pef: number, lag: number, dur: number): number {
  switch (type) {
    case 'FS': return pef + lag
    case 'SS': return pes + lag
    case 'FF': return pef + lag - dur
    case 'SF': return pes + lag - dur
  }
}

function topoOrder(acts: TemplateActivity[]): CanonicalCategory[] | null {
  const indeg = new Map<CanonicalCategory, number>()
  const succ = new Map<CanonicalCategory, CanonicalCategory[]>()
  for (const a of acts) {
    indeg.set(a.category, indeg.get(a.category) ?? 0)
    for (const p of a.preds) {
      indeg.set(a.category, (indeg.get(a.category) ?? 0) + 1)
      succ.set(p.category, [...(succ.get(p.category) ?? []), a.category])
    }
  }
  const queue = acts.filter((a) => indeg.get(a.category) === 0).map((a) => a.category)
  const out: CanonicalCategory[] = []
  while (queue.length) {
    const c = queue.shift()!
    out.push(c)
    for (const s of succ.get(c) ?? []) {
      const n = (indeg.get(s) ?? 0) - 1
      indeg.set(s, n)
      if (n === 0) queue.push(s)
    }
  }
  return out.length === acts.length ? out : null
}

/* ─── Validation ──────────────────────────────────────── */

export interface TemplateValidation {
  ok: boolean
  errors: string[]
  checked: number
}

const SCOPES = ['new_construction', 'renovation', 'renovation_occupied', 'addition', undefined] as const
const SIZES: { grossSqft?: number; stories?: number }[] = [
  {},
  { grossSqft: 5000, stories: 1 },
  { grossSqft: 40000, stories: 2 },
  { grossSqft: 100000, stories: 4 },
  { grossSqft: 250000, stories: 8 },
  { grossSqft: 1000000, stories: 30 },
]

/** Checks every project type × scope × size: preds resolve, no cycles, one activity per category, single structure, sane durations. */
export function validateTemplates(extraProfiles: ProjectProfile[] = []): TemplateValidation {
  const errors: string[] = []
  const profiles: ProjectProfile[] = [...extraProfiles]
  for (const projectType of [...PROJECT_TYPES, undefined]) {
    for (const scope of SCOPES) {
      for (const size of SIZES) {
        for (const isFederal of [undefined, true, false]) profiles.push({ projectType, scope, isFederal, ...size })
      }
    }
  }
  const valid = new Set<string>(CANONICAL_CATEGORIES)
  for (const p of profiles) {
    const tag = JSON.stringify(p)
    const acts = templatesFor(p)
    const cats = acts.map((a) => a.category)
    const set = new Set(cats)
    if (set.size !== cats.length) errors.push(`${tag}: duplicate categories`)
    if (cats.filter(isStructure).length > 1) errors.push(`${tag}: more than one structural system`)
    for (const req of ['ntp', 'substantial_completion', 'final_completion'] as CanonicalCategory[]) {
      if (!set.has(req)) errors.push(`${tag}: missing ${req}`)
    }
    for (const a of acts) {
      if (!valid.has(a.category)) errors.push(`${tag}: invalid category ${a.category}`)
      if (a.category !== 'ntp' && a.preds.length === 0) errors.push(`${tag}: ${a.category} has no predecessors (open start)`)
      for (const pr of a.preds) {
        if (!set.has(pr.category)) errors.push(`${tag}: ${a.category} pred ${pr.category} does not resolve`)
      }
      const d = computeTemplateDuration(a, p)
      if (!Number.isFinite(d) || d < 0) errors.push(`${tag}: ${a.category} bad duration ${d}`)
      if (a.milestone && d !== 0) errors.push(`${tag}: milestone ${a.category} has duration`)
    }
    // every non-final activity should have a successor (no open ends except final_completion)
    const hasSucc = new Set(acts.flatMap((a) => a.preds.map((pr) => pr.category)))
    for (const a of acts) if (a.category !== 'final_completion' && !hasSucc.has(a.category)) errors.push(`${tag}: ${a.category} has no successor (open end)`)
    if (!topoOrder(acts)) errors.push(`${tag}: cycle detected`)
  }
  return { ok: errors.length === 0, errors, checked: profiles.length }
}

/** The generic (definition) variant of a category in the building catalog. */
export function genericVariant(category: CanonicalCategory): TemplateActivity | undefined {
  return DEFINITION.get(category)
}

/** Raw catalog (all variants), for inspection/UI. */
export function allTemplateVariants(): TemplateActivity[] {
  return [...CATALOG]
}
