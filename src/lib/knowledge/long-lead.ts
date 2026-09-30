// Long-lead procurement catalog.
//
// Lead times are REFERENCE DEFAULTS in calendar weeks from approved submittal to delivery at site, reflecting
// published 2024–2025 industry reporting and supplier quotes. Markets move quickly (electrical gear in particular);
// always confirm with current manufacturer/supplier quotes and record the quote date as schedule backup.

import type { Classification, LongLeadSpec, ProjectProfile } from '@/lib/planning/types'
import { appliesTri } from './applicability'

const SURVEY = 'Industry supplier lead-time reporting (e.g., AGC/ENR market reports, contractor & cost-consultant quarterly lead-time surveys, manufacturer quotes), 2024–2025'
const VERIFY = 'Reference default — verify with current supplier quotes; ranges are typical, not guaranteed.'

function item(s: LongLeadSpec): LongLeadSpec {
  return { ...s, notes: s.notes ? `${s.notes} ${VERIFY}` : VERIFY }
}

/** Extra conditions not expressible in Applicability */
const REQUIRES_CLASSIFICATION: Record<string, Classification[]> = {
  'scif-doors-tempest': ['classified'],
}

const MISSION_CRITICAL = ['healthcare', 'data_center', 'lab_research', 'federal_defense'] as const
const CENTRAL_PLANT = ['commercial_office', 'healthcare', 'data_center', 'lab_research', 'k12_school', 'federal_defense'] as const

const CATALOG: LongLeadSpec[] = [
  item({
    id: 'mv-switchgear',
    name: 'Medium-voltage switchgear (5–38 kV)',
    appliesWhen: { projectTypes: [...MISSION_CRITICAL, 'warehouse_industrial'] },
    leadWeeks: { low: 40, typical: 60, high: 100 },
    submittalWeeks: 6,
    gates: 'electrical_service',
    source: SURVEY,
    notes: 'Applies where the owner takes medium-voltage service or has an on-site distribution loop. Lead times roughly doubled vs. pre-2021 levels.',
  }),
  item({
    id: 'switchboards-panelboards',
    name: 'Low-voltage switchboards, distribution & panelboards',
    appliesWhen: { projectTypes: 'all' },
    leadWeeks: { low: 16, typical: 30, high: 52 },
    submittalWeeks: 4,
    gates: 'electrical_service',
    source: SURVEY,
    notes: 'Main switchboards with custom metering/utility sections are at the long end; standard panelboards shorter.',
  }),
  item({
    id: 'padmount-transformer',
    name: 'Pad-mount / distribution transformers (owner- or utility-furnished)',
    appliesWhen: { projectTypes: 'all' },
    leadWeeks: { low: 30, typical: 52, high: 104 },
    submittalWeeks: 4,
    gates: 'electrical_service',
    source: `${SURVEY}; NREL/DOE distribution transformer supply-chain assessments (2022–2024)`,
    notes: 'Utility-furnished transformers follow the utility’s queue; confirm who furnishes. Large substation power transformers can exceed 2–4 years.',
  }),
  item({
    id: 'emergency-generator',
    name: 'Emergency / standby diesel generators (≥500 kW) with enclosure',
    appliesWhen: { projectTypes: [...MISSION_CRITICAL] },
    leadWeeks: { low: 30, typical: 52, high: 90 },
    submittalWeeks: 5,
    gates: 'electrical_service',
    source: SURVEY,
    notes: 'Multi-MW data-center units and paralleling gear are at the upper end. Air-permit requirements for generators may also apply.',
  }),
  item({
    id: 'ups',
    name: 'UPS systems & battery cabinets (data center critical power)',
    appliesWhen: { projectTypes: ['data_center'] },
    leadWeeks: { low: 20, typical: 36, high: 60 },
    submittalWeeks: 5,
    gates: 'electrical_service',
    source: SURVEY,
    notes: 'Lithium-ion battery systems may require additional fire-code review (NFPA 855 / IFC 1207).',
  }),
  item({
    id: 'ats',
    name: 'Automatic transfer switches (ATS) & paralleling switchgear',
    appliesWhen: { projectTypes: [...MISSION_CRITICAL] },
    leadWeeks: { low: 16, typical: 26, high: 44 },
    submittalWeeks: 4,
    gates: 'electrical_service',
    source: SURVEY,
  }),
  item({
    id: 'chillers',
    name: 'Chillers (water- or air-cooled)',
    appliesWhen: { projectTypes: [...CENTRAL_PLANT], minSqft: 75000 },
    leadWeeks: { low: 20, typical: 32, high: 52 },
    submittalWeeks: 5,
    gates: 'mechanical_equipment',
    source: SURVEY,
    notes: 'Applies where a central chilled-water plant is the basis of design.',
  }),
  item({
    id: 'cooling-towers',
    name: 'Cooling towers / fluid coolers',
    appliesWhen: { projectTypes: [...CENTRAL_PLANT], minSqft: 75000 },
    leadWeeks: { low: 16, typical: 24, high: 40 },
    submittalWeeks: 4,
    gates: 'mechanical_equipment',
    source: SURVEY,
    notes: 'Field-erected towers add erection time after delivery.',
  }),
  item({
    id: 'ahu-custom',
    name: 'Custom / semi-custom air-handling units',
    appliesWhen: { projectTypes: [...CENTRAL_PLANT] },
    leadWeeks: { low: 20, typical: 30, high: 45 },
    submittalWeeks: 5,
    gates: 'mechanical_equipment',
    source: SURVEY,
    notes: 'Healthcare and lab units with 100% outside air, energy recovery and stainless components are at the upper end.',
  }),
  item({
    id: 'rtu',
    name: 'Packaged rooftop units (RTUs) / DOAS',
    appliesWhen: { projectTypes: ['commercial_office', 'retail', 'warehouse_industrial', 'multifamily', 'k12_school'] },
    leadWeeks: { low: 12, typical: 20, high: 36 },
    submittalWeeks: 3,
    gates: 'mechanical_equipment',
    source: SURVEY,
    notes: 'Refrigerant transition (A2L refrigerants, EPA AIM Act technology transitions from 2025) affected availability of some models.',
  }),
  item({
    id: 'crah-crac',
    name: 'CRAH / CRAC / fan-wall units (data center cooling)',
    appliesWhen: { projectTypes: ['data_center'] },
    leadWeeks: { low: 16, typical: 28, high: 44 },
    submittalWeeks: 4,
    gates: 'mechanical_equipment',
    source: SURVEY,
  }),
  item({
    id: 'elevators',
    name: 'Elevators (traction / MRL / hydraulic)',
    appliesWhen: { minStories: 2 },
    leadWeeks: { low: 16, typical: 26, high: 40 },
    submittalWeeks: 8,
    gates: 'elevators',
    source: SURVEY,
    notes: 'Lead time starts after approved shop drawings AND cab finish selections; hoistway must be ready (dry, rails-ready) for installation.',
  }),
  item({
    id: 'escalators',
    name: 'Escalators',
    appliesWhen: { projectTypes: ['retail'], minStories: 2 },
    leadWeeks: { low: 30, typical: 40, high: 52 },
    submittalWeeks: 8,
    gates: 'elevators',
    source: SURVEY,
    notes: 'Trusses are typically set during structural erection; confirm early-delivery requirements.',
  }),
  item({
    id: 'structural-steel',
    name: 'Structural steel (mill order + shop drawings + fabrication)',
    appliesWhen: { projectTypes: ['commercial_office', 'healthcare', 'data_center', 'k12_school', 'warehouse_industrial', 'retail'] },
    leadWeeks: { low: 12, typical: 20, high: 30 },
    submittalWeeks: 8,
    gates: 'structure_steel',
    source: `${SURVEY}; AISC fabricator capacity reports`,
    notes: 'Submittal weeks include connection design and shop-drawing cycles. Applies when a steel frame is the basis of design.',
  }),
  item({
    id: 'joists-deck',
    name: 'Steel joists, joist girders & metal deck',
    appliesWhen: { projectTypes: ['warehouse_industrial', 'retail', 'k12_school', 'commercial_office', 'data_center'] },
    leadWeeks: { low: 10, typical: 16, high: 26 },
    submittalWeeks: 4,
    gates: 'structure_steel',
    source: `${SURVEY}; Steel Joist Institute member reports`,
  }),
  item({
    id: 'curtain-wall',
    name: 'Unitized / stick curtain wall system (engineering + fabrication)',
    appliesWhen: { projectTypes: ['commercial_office', 'healthcare', 'lab_research', 'federal_defense'], minStories: 2 },
    leadWeeks: { low: 20, typical: 30, high: 45 },
    submittalWeeks: 10,
    gates: 'windows_curtainwall',
    source: SURVEY,
    notes: 'Includes performance mock-up testing (ASTM E283/E331/E330) where specified; glass (esp. coated/laminated) is often the driver.',
  }),
  item({
    id: 'storefront',
    name: 'Aluminum storefront & entrances',
    appliesWhen: { projectTypes: ['retail', 'commercial_office', 'multifamily', 'k12_school'] },
    leadWeeks: { low: 8, typical: 12, high: 20 },
    submittalWeeks: 4,
    gates: 'windows_curtainwall',
    source: SURVEY,
  }),
  item({
    id: 'precast',
    name: 'Architectural / structural precast concrete panels',
    appliesWhen: { projectTypes: ['data_center', 'healthcare', 'federal_defense', 'warehouse_industrial'] },
    leadWeeks: { low: 16, typical: 24, high: 36 },
    submittalWeeks: 8,
    gates: 'exterior_skin',
    source: `${SURVEY}; PCI producer backlog reporting`,
    notes: 'Applies when precast is the basis of design (tilt-up is site-cast and not procurement-limited). Producer backlog drives the start of casting.',
  }),
  item({
    id: 'roofing-membrane',
    name: 'Roofing membrane, insulation & accessories',
    appliesWhen: { projectTypes: 'all' },
    leadWeeks: { low: 3, typical: 6, high: 12 },
    submittalWeeks: 3,
    gates: 'roofing',
    source: SURVEY,
    notes: 'Supply largely normalized after 2021–2022 shortages; polyiso insulation and specific colors can still extend lead time.',
  }),
  item({
    id: 'fire-alarm',
    name: 'Fire alarm control panels & devices (incl. mass notification where required)',
    appliesWhen: { projectTypes: 'all' },
    leadWeeks: { low: 6, typical: 10, high: 16 },
    submittalWeeks: 5,
    gates: 'fire_protection',
    source: SURVEY,
    notes: 'Submittal includes AHJ/fire-marshal shop-drawing review.',
  }),
  item({
    id: 'fire-pump',
    name: 'Fire pump, controller & jockey pump',
    appliesWhen: { minStories: 4 },
    leadWeeks: { low: 14, typical: 22, high: 32 },
    submittalWeeks: 4,
    gates: 'fire_protection',
    source: SURVEY,
    notes: 'Needed where municipal pressure is insufficient (typical for high-rise and large sprinkler demands); UL/FM listed packages.',
  }),
  item({
    id: 'hollow-metal-hardware',
    name: 'Hollow metal doors/frames & finish hardware',
    appliesWhen: { projectTypes: 'all' },
    leadWeeks: { low: 10, typical: 16, high: 26 },
    submittalWeeks: 5,
    gates: 'framing_drywall',
    source: SURVEY,
    notes: 'Frames are needed at wall framing; electrified hardware and keying schedules often lag. Hardware gates door installation in finishes.',
  }),
  item({
    id: 'medical-gas',
    name: 'Medical gas equipment (manifolds, vacuum/air plants, zone valves, outlets, headwalls)',
    appliesWhen: { projectTypes: ['healthcare'] },
    leadWeeks: { low: 8, typical: 14, high: 22 },
    submittalWeeks: 4,
    gates: 'mep_rough',
    source: SURVEY,
    notes: 'NFPA 99 verification/certification required before use.',
  }),
  item({
    id: 'imaging-equipment',
    name: 'Imaging equipment (MRI / CT / cath lab / linear accelerator) — owner-furnished',
    appliesWhen: { projectTypes: ['healthcare'] },
    leadWeeks: { low: 16, typical: 26, high: 40 },
    submittalWeeks: 6,
    gates: 'specialties',
    source: `${SURVEY}; OEM site-planning guides`,
    notes: 'Vendor site drawings drive shielding (RF/lead), structural and MEP design; rigging path and shielding must be complete before delivery.',
  }),
  item({
    id: 'lab-casework-hoods',
    name: 'Laboratory casework & fume hoods',
    appliesWhen: { projectTypes: ['lab_research', 'healthcare'] },
    leadWeeks: { low: 16, typical: 24, high: 36 },
    submittalWeeks: 6,
    gates: 'specialties',
    source: SURVEY,
    notes: 'Fume hoods require ASHRAE 110 testing after installation and TAB.',
  }),
  item({
    id: 'scif-doors-tempest',
    name: 'SCIF / vault doors (GSA-approved Class 5), acoustic doors & RF/TEMPEST shielding materials',
    appliesWhen: { federalOnly: true },
    leadWeeks: { low: 12, typical: 20, high: 30 },
    submittalWeeks: 6,
    gates: 'finishes',
    source: `${SURVEY}; ICD/ICS 705 Technical Specifications; GSA Qualified Products List`,
    notes: 'Only applies to classified spaces. Components must be approved by the cognizant security authority; RF shielding precedes drywall close-in.',
  }),
  item({
    id: 'blast-windows',
    name: 'Blast-resistant / forced-entry windows & frames (UFC 4-010-01)',
    appliesWhen: { projectTypes: ['federal_defense'] },
    leadWeeks: { low: 20, typical: 30, high: 45 },
    submittalWeeks: 8,
    gates: 'windows_curtainwall',
    source: `${SURVEY}; UFC 4-010-01; ASTM F1642 / GSA-TS01 test standards`,
    notes: 'Laminated glazing, blast-rated frames and anchorage calculations; test reports or analysis required with submittal.',
  }),
]

const BY_ID = new Map(CATALOG.map((i) => [i.id, i]))

function classificationOk(id: string, p: ProjectProfile): boolean {
  const req = REQUIRES_CLASSIFICATION[id]
  if (!req) return true
  return !!p.classification && req.includes(p.classification)
}

/** All catalog items (unfiltered). */
export function allLongLeadItems(): LongLeadSpec[] {
  return [...CATALOG]
}

/** Items that apply (or may apply) to the profile. */
export function listLongLeadItems(profile: ProjectProfile): LongLeadSpec[] {
  return CATALOG.filter((i) => appliesTri(i.appliesWhen, profile) !== 'no' && classificationOk(i.id, profile))
}

export function getLongLead(id: string): LongLeadSpec | undefined {
  return BY_ID.get(id)
}
