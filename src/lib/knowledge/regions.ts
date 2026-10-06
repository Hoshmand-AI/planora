// Regional permitting & regulatory grounding catalog.
//
// IMPORTANT: every review-time range in this file is a REFERENCE DEFAULT compiled from published agency
// guidance, statutes and typical industry experience. Actual durations vary by jurisdiction, project
// complexity, submittal quality and agency workload. All values must be verified with the Authority
// Having Jurisdiction (AHJ) before being relied upon for a baseline or a delay analysis.

import type {
  Classification,
  PermitSpec,
  ProjectProfile,
  RegionSpec,
  ProjectType,
  RegulationSpec,
} from '@/lib/planning/types'
import { appliesTri } from './applicability'

export const AHJ_DISCLAIMER =
  'Reference default only: ranges are typical, not guaranteed. Verify current requirements and review times with the Authority Having Jurisdiction (AHJ).'

function note(text?: string): string {
  return text ? `${text} ${AHJ_DISCLAIMER}` : AHJ_DISCLAIMER
}

function permit(p: PermitSpec): PermitSpec {
  return { ...p, notes: note(p.notes) }
}

/* ─── Extra applicability conditions not expressible in Applicability ───── */

interface Extra {
  /** Only applies when profile.classification is one of these (unknown => does not apply) */
  classification?: Classification[]
  /** 'nyc' = only when city is in New York City; 'not_nyc' = only when city is known and outside NYC, or unknown */
  city?: 'nyc' | 'not_nyc'
  /** Federal/default item ids this state-specific item replaces */
  replaces?: string[]
}

const EXTRA: Record<string, Extra> = {}
function extra(id: string, e: Extra) {
  EXTRA[id] = e
}

const NYC_NAMES = ['new york', 'new york city', 'nyc', 'manhattan', 'brooklyn', 'queens', 'bronx', 'the bronx', 'staten island']
export function isNYC(city?: string): boolean {
  if (!city) return false
  const c = city.trim().toLowerCase().replace(/,.*$/, '').replace(/\./g, '')
  return NYC_NAMES.includes(c)
}

function extraOk(id: string, p: ProjectProfile): boolean {
  const e = EXTRA[id]
  if (!e) return true
  if (e.classification && (!p.classification || !e.classification.includes(p.classification))) return false
  if (e.city === 'nyc' && !isNYC(p.city)) return false
  if (e.city === 'not_nyc' && isNYC(p.city)) return false
  return true
}

/* ─── US-FEDERAL ───────────────────────────────────────── */

const FEDERAL: RegionSpec = {
  code: 'US-FEDERAL',
  name: 'United States — federal requirements',
  permits: [
    permit({
      id: 'us-npdes-cgp',
      name: 'NPDES Construction General Permit coverage (NOI + SWPPP)',
      authority: 'U.S. EPA (or the authorized state NPDES program)',
      jurisdiction: 'federal',
      appliesWhen: { minAcresDisturbed: 1 },
      reviewWeeks: { low: 1, typical: 3, high: 6 },
      gates: 'earthwork',
      submitAfter: 'design_dd',
      source: 'Clean Water Act §402; 40 CFR 122.26(b)(14)-(15); EPA 2022 Construction General Permit',
      notes:
        'Required for disturbance of ≥1 acre (or <1 acre if part of a larger common plan). Under the EPA CGP, coverage begins 14 days after EPA posts a complete NOI; SWPPP must be prepared before NOI submittal. In most states the authorized state program issues the permit instead.',
    }),
    permit({
      id: 'us-faa-7460',
      name: 'FAA Form 7460-1 Notice of Proposed Construction or Alteration (structure and cranes)',
      authority: 'Federal Aviation Administration (Obstruction Evaluation / Airport Airspace Analysis)',
      jurisdiction: 'federal',
      appliesWhen: { minStories: 14 },
      reviewWeeks: { low: 6, typical: 8, high: 16 },
      gates: 'structure_steel',
      submitAfter: 'design_dd',
      source: '14 CFR Part 77 (§77.9 notice criteria)',
      notes:
        'Required for structures or temporary cranes >200 ft AGL or within the §77.9 imaginary surfaces near airports/heliports — which can apply to low buildings and cranes near airports. File ≥45 days before construction; FAA aims for a determination within 45 days but studies are often longer. Use the FAA Notice Criteria Tool. Gates the structural erection category actually used (steel/concrete/wood).',
    }),
    permit({
      id: 'us-nepa',
      name: 'NEPA environmental review (CATEX / EA-FONSI / EIS)',
      authority: 'Lead federal agency',
      jurisdiction: 'federal',
      appliesWhen: { federalOnly: true },
      reviewWeeks: { low: 4, typical: 26, high: 104 },
      gates: 'earthwork',
      submitAfter: 'design_sd',
      source: 'National Environmental Policy Act, 42 U.S.C. §4321 et seq.; Fiscal Responsibility Act of 2023 (§107 deadlines); agency NEPA procedures',
      notes:
        'Categorical exclusions are typically weeks; Environmental Assessments commonly 6–12 months (statutory target 1 year); EISs up to 2 years (statutory target). CEQ NEPA regulations were rescinded in 2025 and agencies now apply their own procedures — confirm with the lead agency. No construction or irreversible commitment of resources before the decision document.',
    }),
    permit({
      id: 'us-nhpa-106',
      name: 'NHPA Section 106 consultation (SHPO/THPO)',
      authority: 'Lead federal agency with State/Tribal Historic Preservation Officer; ACHP',
      jurisdiction: 'federal',
      appliesWhen: { federalOnly: true },
      reviewWeeks: { low: 4, typical: 10, high: 52 },
      gates: 'earthwork',
      submitAfter: 'design_sd',
      source: '54 U.S.C. §306108; 36 CFR Part 800',
      notes:
        'SHPO has 30 days to respond to each finding (36 CFR 800.3–800.5); adverse effects require a Memorandum of Agreement which can add months. For renovations of historic buildings this also gates demolition.',
    }),
    permit({
      id: 'us-fed-installation',
      name: 'Installation / agency construction approvals (work clearance, dig permits, base access)',
      authority: 'Installation DPW / Base Civil Engineer / agency facility office',
      jurisdiction: 'federal',
      // On a base or federal campus only: federal funding (e.g. a federal-aid bridge) does not bring base access.
      appliesWhen: { federalOnly: true, federalInstallationOnly: true },
      reviewWeeks: { low: 2, typical: 4, high: 8 },
      gates: 'mobilization',
      submitAfter: 'design_cd',
      source: 'Agency/installation procedures (e.g., AF Form 332 / AF Form 103 work clearance, installation access control per DoDM 5200.08)',
      notes:
        'Federal work on federal property is generally not subject to local building permits; installation work clearance, utility locates/dig permits and contractor badging substitute for them. Leased or non-exclusive federal facilities may still require local permits.',
    }),
  ],
  regulations: [
    {
      id: 'us-davis-bacon',
      name: 'Davis-Bacon and Related Acts prevailing wages',
      appliesWhen: { federalOnly: true },
      scheduleImpact:
        'Wage determination must be incorporated at award; weekly certified payrolls (WH-347) and labor-compliance reviews add administrative lead time to subcontractor onboarding and pay applications. Reference default — verify with the contracting agency.',
      source: '40 U.S.C. §§3141–3148; 29 CFR Parts 1, 3, 5 (2023 final rule)',
      addsActivity: {
        name: 'Davis-Bacon wage determination, subcontractor onboarding & certified payroll setup',
        category: 'permit_other',
        days: { low: 5, typical: 10, high: 20 },
        after: 'design_cd',
        before: 'mobilization',
      },
    },
    {
      id: 'us-baba',
      name: 'Buy American Act / Build America, Buy America (BABA) domestic preference',
      appliesWhen: { federalOnly: true },
      scheduleImpact:
        'Restricts sourcing of iron/steel, manufactured products and construction materials; domestic-content certification and any waiver requests (commonly 2–5+ months) extend procurement durations for electrical gear, HVAC equipment and specialty items. Reference default — verify with the contracting agency.',
      source: '41 U.S.C. §§8301–8305; FAR Part 25; Infrastructure Investment and Jobs Act §§70901–70927 (BABA); 2 CFR Part 184',
      // Iron and steel are the first covered materials to be incorporated, so certification precedes the structure.
      addsActivity: {
        name: 'Buy America (BABA) domestic-content certifications & waiver requests',
        category: 'submittals',
        days: { low: 10, typical: 20, high: 60 },
        after: 'design_cd',
        before: 'structure_steel',
        beforeAlternatives: ['substructure', 'process_structures', 'foundations', 'mobilization'],
      },
    },
    {
      id: 'us-ufc-4-010-01',
      name: 'UFC 4-010-01 DoD Minimum Antiterrorism Standards for Buildings',
      appliesWhen: { projectTypes: ['federal_defense'] },
      scheduleImpact:
        'Standoff distances, laminated/blast-resistant glazing and frames, progressive-collapse design (UFC 4-023-03) and mass-notification systems lengthen design and add long-lead envelope items and testing. Reference default — verify with the design agent.',
      source: 'UFC 4-010-01 (2018, with Change 2), DoD Minimum Antiterrorism Standards for Buildings',
    },
    {
      id: 'us-ufc-4-010-06',
      name: 'UFC 4-010-06 cybersecurity of facility-related control systems (RMF authorization)',
      appliesWhen: { projectTypes: ['federal_defense'] },
      scheduleImpact:
        'Building control systems (BAS, EMCS, ACS, fire alarm interfaces) require Risk Management Framework documentation and an authorization decision before connection/turnover. Reference default — verify with the installation authorizing official.',
      source: 'UFC 4-010-06 Cybersecurity of Facility-Related Control Systems; DoDI 8510.01 (RMF)',
      addsActivity: {
        name: 'FRCS cybersecurity RMF testing & authorization (UFC 4-010-06)',
        category: 'commissioning',
        days: { low: 20, typical: 45, high: 120 },
        after: 'low_voltage',
        before: 'substantial_completion',
      },
    },
    {
      id: 'us-dod-design-review',
      name: 'USACE / NAVFAC / AFCEC staged design reviews',
      appliesWhen: { projectTypes: ['federal_defense'] },
      scheduleImpact:
        'Design submittals at staged completion points (e.g., 35/65/95/100% or per contract), each with a government review and comment-resolution cycle of roughly 2–4 weeks. Modeled by the template design_review activity. Reference default — verify with the contracting office.',
      source: 'USACE ER 1110-1-12 (Engineering and Design Quality Management); UFC 1-300-07A Design Build Technical Requirements; NAVFAC design-build RFP procedures',
    },
    {
      id: 'us-icd705-csp',
      name: 'ICD/ICS 705 SCIF Construction Security Plan (CSP) approval',
      appliesWhen: { federalOnly: true },
      scheduleImpact:
        'A Construction Security Plan approved by the Accrediting Official/Site Security Manager is required before SCIF construction begins; cleared/escorted workforce and material controls reduce productivity. Reference default — verify with the cognizant security authority.',
      source: 'ICD 705; ICS 705-1 and 705-2; IC Tech Spec for ICD/ICS 705',
      addsActivity: {
        name: 'SCIF Construction Security Plan (CSP) approval',
        category: 'permit_other',
        days: { low: 15, typical: 30, high: 60 },
        after: 'design_cd',
        before: 'mobilization',
      },
    },
    {
      id: 'us-icd705-accreditation',
      name: 'ICD/ICS 705 SCIF accreditation',
      appliesWhen: { federalOnly: true },
      scheduleImpact:
        'After construction, the Fixed Facility Checklist, TEMPEST countermeasure review, acoustic (STC) and RF testing and Accrediting Official inspection must be completed before the space can be accredited and used. Reference default — verify with the cognizant security authority.',
      source: 'ICD 705; ICS 705-1 and 705-2; IC Tech Spec for ICD/ICS 705',
      addsActivity: {
        name: 'SCIF accreditation — FFC, acoustic/RF testing & AO inspection (ICD 705)',
        category: 'inspections',
        days: { low: 20, typical: 40, high: 90 },
        after: 'finishes',
        before: 'substantial_completion',
      },
    },
  ],
  climate: { adverseMonths: [], adverseNote: 'No national climate default; see state region.', weatherDaysPerAdverseMonth: 0 },
}
extra('us-icd705-csp', { classification: ['classified'] })

// Federal contract front end (USACE / NAVFAC / AFCEC): nothing starts on site before the preconstruction
// conference, an accepted Accident Prevention Plan and QC Plan, and the submittal register; the
// baseline network analysis schedule must be accepted before the first progress payment.
const FED_CONTRACT = { federalOnly: true, federalInstallationOnly: true, civil: true } as const
FEDERAL.regulations.push(
  {
    id: 'us-fed-precon', name: 'Preconstruction conference (contract Section 01 31 19)', appliesWhen: FED_CONTRACT,
    scheduleImpact: 'The contracting officer holds the preconstruction conference after award; site work starts only after it and the acceptance of the safety and quality plans.',
    source: 'UFGS 01 31 19.05 20 Post-Award Conference; FAR 52.236-7 / 52.236-15',
    addsActivity: { name: 'Preconstruction conference with the contracting officer', category: 'permit_other', days: { low: 1, typical: 5, high: 10 }, after: 'ntp', before: 'mobilization' },
  },
  {
    id: 'us-em385-app', name: 'Accident Prevention Plan (APP) per EM 385-1-1', appliesWhen: FED_CONTRACT,
    scheduleImpact: 'The APP (with activity hazard analyses) must be accepted by the government before work on site; typical review 2–3 weeks with one resubmittal.',
    source: 'USACE EM 385-1-1 Safety and Health Requirements (Appendix A, Accident Prevention Plan); UFGS 01 35 26',
    addsActivity: { name: 'Accident Prevention Plan (EM 385-1-1) & AHAs — prepare, submit & government acceptance', category: 'submittals', days: { low: 15, typical: 25, high: 45 }, after: 'ntp', before: 'mobilization' },
  },
  {
    id: 'us-ufgs-qc-plan', name: 'Contractor Quality Control Plan (UFGS 01 45 00)', appliesWhen: FED_CONTRACT,
    scheduleImpact: 'The QC Plan and QC manager must be accepted before construction starts (a coordination and mutual-understanding meeting follows).',
    source: 'UFGS 01 45 00 Quality Control (Army / Navy / Air Force versions)',
    addsActivity: { name: 'Quality Control Plan (UFGS 01 45 00) — submit, coordination meeting & acceptance', category: 'submittals', days: { low: 15, typical: 20, high: 40 }, after: 'ntp', before: 'mobilization' },
  },
  {
    id: 'us-ufgs-submittal-register', name: 'Submittal register (UFGS 01 33 00)', appliesWhen: FED_CONTRACT,
    scheduleImpact: 'The submittal register (ENG Form 4288) is submitted with the QC Plan and drives the government review cycle for every submittal.',
    source: 'UFGS 01 33 00 Submittal Procedures',
    addsActivity: { name: 'Submittal register (ENG 4288) & submittal schedule — prepare and submit', category: 'submittals', days: { low: 5, typical: 10, high: 20 }, after: 'ntp', before: 'mobilization' },
  },
  {
    id: 'us-ufgs-nas', name: 'Baseline network analysis schedule (UFGS 01 32 17 / 01 32 01)', appliesWhen: FED_CONTRACT,
    scheduleImpact: 'A preliminary schedule is due shortly after NTP and the baseline NAS within about six weeks; the government withholds progress payments until the baseline is accepted.',
    source: 'UFGS 01 32 17.00 20 Cost-Loaded Critical Path Method Scheduling (NAVFAC); UFGS 01 32 01.00 10 Project Schedule (USACE)',
    addsActivity: { name: 'Baseline network analysis schedule (UFGS 01 32 17 / 01 32 01) — submit & government acceptance', category: 'submittals', days: { low: 20, typical: 30, high: 45 }, after: 'ntp', before: 'foundations', beforeAlternatives: ['earthwork', 'mobilization'] },
  },
)
extra('us-icd705-accreditation', { classification: ['classified'] })

/* ─── US-DEFAULT (generic local jurisdiction) ──────────── */

const localBuilding = (id: string, authority: string, low: number, typical: number, high: number, source: string, notesText?: string) =>
  permit({
    id,
    name: 'Local building permit (plan review & issuance)',
    authority,
    jurisdiction: 'local',
    appliesWhen: { nonFederalOnly: true },
    reviewWeeks: { low, typical, high },
    gates: 'foundations',
    submitAfter: 'design_cd',
    source,
    notes: notesText ?? 'Includes typical 1–2 correction/resubmittal cycles. Phased (foundation-only or shell) permits can allow earlier start.',
  })

const DEFAULT: RegionSpec = {
  code: 'US-DEFAULT',
  name: 'United States — generic local jurisdiction',
  permits: [
    permit({
      id: 'def-site-grading',
      name: 'Site development / grading permit',
      authority: 'Local public works / engineering department',
      jurisdiction: 'local',
      appliesWhen: { nonFederalOnly: true, scopes: ['new_construction', 'addition'] },
      reviewWeeks: { low: 4, typical: 8, high: 16 },
      gates: 'earthwork',
      submitAfter: 'design_dd',
      source: 'Local zoning & land-development ordinance (civil/site plan approval)',
    }),
    localBuilding('def-building', 'Local building department', 4, 8, 16, 'International Building Code (IBC) as adopted locally; local permit ordinance'),
    permit({
      id: 'def-fire-marshal',
      name: 'Fire marshal plan review (sprinkler, fire alarm, fire access)',
      authority: 'Local fire marshal / fire prevention bureau',
      jurisdiction: 'local',
      appliesWhen: { nonFederalOnly: true },
      reviewWeeks: { low: 2, typical: 4, high: 8 },
      gates: 'fire_protection',
      submitAfter: 'design_cd',
      source: 'International Fire Code (IFC) §105 as adopted locally; NFPA 13 / NFPA 72 shop-drawing review',
      notes: 'Sprinkler and fire-alarm shop drawings are usually deferred submittals reviewed after award.',
    }),
    permit({
      id: 'def-electric-service',
      name: 'Electric utility new-service application & design',
      authority: 'Serving electric utility',
      jurisdiction: 'local',
      appliesWhen: {},
      reviewWeeks: { low: 12, typical: 26, high: 52 },
      gates: 'electrical_service',
      submitAfter: 'design_dd',
      source: 'Utility tariff / service rules; 2023–2025 utility transformer supply constraints',
      notes: 'Utility engineering, easements and utility-furnished transformer lead times frequently control permanent power. Large loads (data centers) may require substation/interconnection studies of 1–3+ years.',
    }),
    permit({
      id: 'def-water-sewer',
      name: 'Water / sewer service connection (tap) permit',
      authority: 'Local water & sewer utility',
      jurisdiction: 'local',
      appliesWhen: { scopes: ['new_construction', 'addition'] },
      reviewWeeks: { low: 4, typical: 8, high: 16 },
      gates: 'utilities_site',
      submitAfter: 'design_dd',
      source: 'Local utility connection ordinance; backflow prevention requirements',
    }),
  ],
  regulations: [
    {
      id: 'def-special-inspections',
      name: 'IBC Chapter 17 special inspections & testing',
      appliesWhen: { nonInstallationOnly: true },
      scheduleImpact:
        'Statement of Special Inspections must be approved with the permit; special inspector reports and final report are prerequisites to certificate of occupancy. Reference default — verify with the AHJ.',
      source: 'International Building Code Chapter 17',
    },
  ],
  climate: {
    adverseMonths: [12, 1, 2],
    adverseNote: 'Generic temperate/northern winter: frozen ground, cold-weather concrete and roofing restrictions reduce exterior productivity. Replace with NOAA normals for the actual site.',
    weatherDaysPerAdverseMonth: 4,
  },
}

/* ─── State regions ────────────────────────────────────── */

const CA: RegionSpec = {
  code: 'CA',
  name: 'California',
  permits: [
    localBuilding('ca-building', 'City/county building department (e.g., LADBS, SF DBI, San Diego DSD)', 8, 16, 30, 'California Building Standards Code (Title 24) as adopted locally', 'Large-city commercial plan check with 2–3 correction cycles; Title 24 energy and CALGreen documentation reviewed with the permit.'),
    permit({
      id: 'ca-site-grading',
      name: 'Grading permit (city/county)',
      authority: 'City/county building & safety or public works',
      jurisdiction: 'local',
      appliesWhen: { nonFederalOnly: true, scopes: ['new_construction', 'addition'] },
      reviewWeeks: { low: 6, typical: 10, high: 20 },
      gates: 'earthwork',
      submitAfter: 'design_dd',
      source: 'Local grading ordinance; CBC Appendix J where adopted',
      notes: 'Many jurisdictions restrict grading during the rainy season (Oct 1 – Apr 15) or require wet-weather erosion control plans.',
    }),
    permit({
      id: 'ca-cgp',
      name: 'California Construction Stormwater General Permit (NPDES CAS000002) — NOI, SWPPP via SMARTS',
      authority: 'State Water Resources Control Board / Regional Water Quality Control Board',
      jurisdiction: 'state',
      appliesWhen: { minAcresDisturbed: 1 },
      reviewWeeks: { low: 1, typical: 2, high: 4 },
      gates: 'earthwork',
      submitAfter: 'design_dd',
      source: 'SWRCB Order WQ 2022-0057-DWQ (NPDES No. CAS000002), effective Sept 1, 2023',
      notes: 'SWPPP must be prepared by a Qualified SWPPP Developer; WDID number required before disturbance.',
    }),
    permit({
      id: 'ca-hcai',
      name: 'HCAI (formerly OSHPD) Facilities Development Division plan review & building permit',
      authority: 'California Department of Health Care Access and Information (HCAI)',
      jurisdiction: 'state',
      appliesWhen: { projectTypes: ['healthcare'], nonFederalOnly: true },
      reviewWeeks: { low: 26, typical: 40, high: 65 },
      gates: 'foundations',
      submitAfter: 'design_cd',
      source: 'Alfred E. Alquist Hospital Facilities Seismic Safety Act (Health & Safety Code §129675 et seq.); CBC Title 24 Part 2 (OSHPD 1/2/4 amendments)',
      notes:
        'Applies to general acute-care hospitals (OSHPD 1/1R), skilled nursing (OSHPD 2) and correctional treatment centers (OSHPD 4); OSHPD 3 clinics are usually reviewed by the local building department. Phased/incremental submittals are common. HCAI also requires an Inspector of Record and has lengthy field-change (ACD/CCD) processes.',
    }),
    permit({
      id: 'ca-dsa',
      name: 'Division of the State Architect (DSA) plan review & approval — public K-12',
      authority: 'Division of the State Architect (DGS)',
      jurisdiction: 'state',
      appliesWhen: { projectTypes: ['k12_school'], nonFederalOnly: true },
      reviewWeeks: { low: 12, typical: 18, high: 30 },
      gates: 'foundations',
      submitAfter: 'design_cd',
      source: 'Field Act (Education Code §17280 et seq.); CBC Title 24 Part 1 & 2; DSA procedures',
      notes: 'Applies to public schools and community colleges (private schools are reviewed locally). DSA also requires a DSA-certified Project Inspector and DSA certification at closeout.',
    }),
    permit({
      id: 'ca-ceqa',
      name: 'CEQA environmental review (exemption / Negative Declaration / EIR)',
      authority: 'Lead agency (city, county or state agency)',
      jurisdiction: 'state',
      appliesWhen: { nonFederalOnly: true },
      reviewWeeks: { low: 4, typical: 26, high: 78 },
      gates: 'earthwork',
      submitAfter: 'design_sd',
      source: 'California Environmental Quality Act, Public Resources Code §21000 et seq.; CEQA Guidelines (14 CCR §15000 et seq.)',
      notes: 'Applies to discretionary approvals. Categorical exemptions: weeks; (Mitigated) Negative Declarations: ~4–9 months; EIRs: ~12–18+ months (Guidelines target 1 year after application complete). Ministerial by-right projects may be exempt.',
    }),
    permit({
      id: 'ca-calosha',
      name: 'Cal/OSHA activity permit (excavations ≥5 ft, cranes, demolition, scaffolding >36 ft)',
      authority: 'Cal/OSHA (Division of Occupational Safety and Health)',
      jurisdiction: 'state',
      appliesWhen: {},
      reviewWeeks: { low: 1, typical: 2, high: 4 },
      gates: 'earthwork',
      submitAfter: 'design_cd',
      source: 'Labor Code §6500; 8 CCR §341 (permit requirements)',
      notes: 'Annual or project permit held by the performing contractor; must be in place before permitted activity starts.',
    }),
  ],
  regulations: [
    {
      id: 'ca-title24-energy',
      name: 'Title 24 Part 6 Energy Code compliance',
      appliesWhen: { nonInstallationOnly: true },
      scheduleImpact:
        'Energy compliance forms (NRCC) required at permit; acceptance testing by a certified Acceptance Test Technician (NRCA forms) before final inspection. Reference default — verify with the AHJ.',
      source: 'California Energy Code, Title 24 Part 6 (2022 edition; 2025 edition effective Jan 1, 2026)',
      addsActivity: {
        name: 'Title 24 Part 6 acceptance testing (NRCA)',
        category: 'commissioning',
        days: { low: 5, typical: 10, high: 20 },
        after: 'mechanical_equipment',
        before: 'inspections',
      },
    },
    {
      id: 'ca-calgreen',
      name: 'CALGreen (Title 24 Part 11) mandatory measures',
      appliesWhen: { nonInstallationOnly: true },
      scheduleImpact:
        'Construction waste diversion documentation, and for new nonresidential buildings ≥10,000 sf, owner project requirements/basis of design and commissioning per CALGreen §5.410.2. Reference default — verify with the AHJ.',
      source: 'California Green Building Standards Code, Title 24 Part 11',
    },
    {
      id: 'ca-dsa-closeout',
      name: 'DSA project certification (closeout)',
      appliesWhen: { projectTypes: ['k12_school'], nonFederalOnly: true },
      scheduleImpact:
        'Project Inspector verified reports, testing lab reports and DSA close-out documents must be submitted; uncertified projects are common when documentation lags. Reference default — verify with DSA.',
      source: 'DSA IR A-7 / PR 13-01 procedures; 24 CCR Part 1 §4-343',
      addsActivity: {
        name: 'DSA certification of construction (closeout)',
        category: 'closeout',
        days: { low: 20, typical: 45, high: 120 },
        after: 'substantial_completion',
        before: 'final_completion',
      },
    },
    {
      id: 'ca-dir-public-works',
      name: 'California prevailing wage / DIR public works registration',
      appliesWhen: { projectTypes: ['k12_school'], nonFederalOnly: true },
      scheduleImpact:
        'Public works projects require DIR contractor registration, PWC-100 project notice and electronic certified payroll; affects subcontractor onboarding. Reference default — verify with the awarding body.',
      source: 'California Labor Code §§1720–1861; SB 854 (2014)',
    },
  ],
  climate: {
    adverseMonths: [11, 12, 1, 2, 3],
    adverseNote: 'Rainy season (roughly Nov–Mar) slows earthwork, grading and roofing; many jurisdictions impose wet-season grading restrictions. Coastal/southern regions have fewer rain days; mountain regions have snow.',
    weatherDaysPerAdverseMonth: 4,
  },
}
extra('ca-cgp', { replaces: ['us-npdes-cgp'] })
extra('ca-building', { replaces: ['def-building'] })
extra('ca-site-grading', { replaces: ['def-site-grading'] })

const TX: RegionSpec = {
  code: 'TX',
  name: 'Texas',
  permits: [
    localBuilding('tx-building', 'City building department (e.g., Houston Permitting Center, Austin DSD, Dallas DSD)', 4, 10, 24, 'IBC as adopted by the municipality; Texas Local Government Code Ch. 214', 'Wide variation: some cities complete commercial review in weeks, Austin commercial review commonly takes months. Unincorporated county areas may have no building permit (but fire code/floodplain review still apply). HB 3699 (2023) and HB 1526-type shot-clock rules may apply to certain approvals.'),
    permit({
      id: 'tx-tceq-cgp',
      name: 'TCEQ Construction General Permit TXR150000 (NOI / site notice, SWP3)',
      authority: 'Texas Commission on Environmental Quality',
      jurisdiction: 'state',
      appliesWhen: { minAcresDisturbed: 1 },
      reviewWeeks: { low: 1, typical: 2, high: 4 },
      gates: 'earthwork',
      submitAfter: 'design_dd',
      source: 'TPDES General Permit TXR150000 (2023 reissuance); Texas Water Code Ch. 26',
      notes: 'Large construction (≥5 acres) requires an electronic NOI; small construction (1–5 acres) requires a posted site notice and SWP3.',
    }),
    permit({
      id: 'tx-tdlr-tas',
      name: 'TDLR Texas Accessibility Standards project registration & RAS plan review',
      authority: 'Texas Department of Licensing and Regulation / Registered Accessibility Specialist',
      jurisdiction: 'state',
      appliesWhen: { nonInstallationOnly: true },
      reviewWeeks: { low: 2, typical: 4, high: 8 },
      gates: 'framing_drywall',
      submitAfter: 'design_cd',
      source: 'Texas Architectural Barriers Act, Gov. Code Ch. 469; 16 TAC Ch. 68; 2012 Texas Accessibility Standards',
      notes: 'Projects with estimated construction cost ≥$50,000 must be registered and plans submitted to a RAS for review before construction starts. Modeled here as gating accessible interior build-out.',
    }),
    permit({
      id: 'tx-hhsc-healthcare',
      name: 'Texas HHSC architectural plan review (hospitals / ambulatory surgery / nursing facilities)',
      authority: 'Texas Health and Human Services Commission — Architectural Review',
      jurisdiction: 'state',
      appliesWhen: { projectTypes: ['healthcare'], nonFederalOnly: true },
      reviewWeeks: { low: 6, typical: 12, high: 26 },
      gates: 'foundations',
      submitAfter: 'design_cd',
      source: '25 TAC Ch. 133 (hospitals), 26 TAC Ch. 510/554 as applicable',
      notes: 'Plan review is optional for some licensed facility types but an HHSC construction inspection is required before licensing/occupancy.',
    }),
  ],
  regulations: [
    {
      id: 'tx-ras-inspection',
      name: 'TDLR RAS final accessibility inspection',
      appliesWhen: { nonInstallationOnly: true },
      scheduleImpact:
        'A RAS inspection must be requested within one year of construction completion; deficiencies must be corrected and reported. Does not usually gate certificate of occupancy. Reference default — verify with TDLR.',
      source: '16 TAC §68.51; Gov. Code Ch. 469',
      addsActivity: {
        name: 'TDLR / RAS accessibility inspection',
        category: 'inspections',
        days: { low: 5, typical: 10, high: 20 },
        after: 'substantial_completion',
        before: 'final_completion',
      },
    },
    {
      id: 'tx-tdlr-elevator',
      name: 'TDLR elevator/escalator registration & acceptance inspection',
      appliesWhen: { minStories: 2, nonInstallationOnly: true },
      scheduleImpact:
        'New conveyances require TDLR registration and an acceptance inspection by a licensed inspector before use. Reference default — verify with TDLR.',
      source: 'Texas Health & Safety Code Ch. 754; 16 TAC Ch. 74',
    },
  ],
  climate: {
    adverseMonths: [5, 6, 7, 8, 9],
    adverseNote: 'Spring severe thunderstorms and extreme summer heat reduce productivity (heat-illness work/rest cycles; hot-weather concreting). Gulf Coast sites carry hurricane-season risk Jun–Nov. North Texas has occasional winter ice events.',
    weatherDaysPerAdverseMonth: 3,
  },
}
extra('tx-tceq-cgp', { replaces: ['us-npdes-cgp'] })
extra('tx-building', { replaces: ['def-building'] })

const NY: RegionSpec = {
  code: 'NY',
  name: 'New York',
  permits: [
    permit({
      id: 'ny-nyc-dob',
      name: 'NYC DOB plan approval & work permit (DOB NOW: New Building / Alteration)',
      authority: 'New York City Department of Buildings',
      jurisdiction: 'local',
      appliesWhen: { nonFederalOnly: true },
      reviewWeeks: { low: 8, typical: 16, high: 36 },
      gates: 'foundations',
      submitAfter: 'design_cd',
      source: 'NYC Construction Codes (Administrative Code Title 28; 2022 NYC Building Code)',
      notes: 'Includes zoning review and multiple objection cycles; separate filings for foundation/earthwork, structural, MEP, sprinkler and standpipe. Professional certification can shorten plan review but increases audit risk. Site Safety Plan required for major buildings.',
    }),
    permit({
      id: 'ny-fdny',
      name: 'FDNY fire alarm / fire suppression plan review and acceptance tests',
      authority: 'Fire Department of the City of New York (Bureau of Fire Prevention)',
      jurisdiction: 'local',
      appliesWhen: { nonFederalOnly: true },
      reviewWeeks: { low: 6, typical: 12, high: 24 },
      gates: 'fire_protection',
      submitAfter: 'design_cd',
      source: 'NYC Fire Code (Administrative Code Title 29); FDNY Technology Management / Fire Suppression Units',
      notes: 'FDNY acceptance tests (fire alarm, sprinkler, standpipe, smoke control) must be scheduled before TCO and often become critical near completion.',
    }),
    permit({
      id: 'ny-nyc-dep',
      name: 'NYC DEP site connection proposal / sewer & water service approvals',
      authority: 'NYC Department of Environmental Protection',
      jurisdiction: 'local',
      appliesWhen: { scopes: ['new_construction', 'addition'] },
      reviewWeeks: { low: 6, typical: 12, high: 24 },
      gates: 'utilities_site',
      submitAfter: 'design_dd',
      source: 'NYC DEP Rules (15 RCNY Ch. 31 — sewer connection; stormwater performance standard)',
    }),
    permit({
      id: 'ny-coned',
      name: 'Con Edison new-service application (electric/gas)',
      authority: 'Consolidated Edison',
      jurisdiction: 'local',
      appliesWhen: {},
      reviewWeeks: { low: 20, typical: 36, high: 60 },
      gates: 'electrical_service',
      submitAfter: 'design_dd',
      source: 'Con Edison Specification EO-2022 (Blue Book) service requirements',
      notes: 'Network vault/transformer work and street openings frequently control permanent power in NYC.',
    }),
    localBuilding('ny-building', 'City/town/village building department (outside NYC)', 4, 8, 16, 'NYS Uniform Fire Prevention and Building Code (19 NYCRR Parts 1219–1228) as enforced locally'),
    permit({
      id: 'ny-spdes',
      name: 'NYSDEC SPDES General Permit for Construction Activity (NOI + SWPPP)',
      authority: 'New York State Department of Environmental Conservation',
      jurisdiction: 'state',
      appliesWhen: { minAcresDisturbed: 1 },
      reviewWeeks: { low: 1, typical: 2, high: 12 },
      gates: 'earthwork',
      submitAfter: 'design_dd',
      source: 'NYSDEC SPDES General Permit for Stormwater Discharges from Construction Activity (GP-0-25-001, successor to GP-0-20-001); ECL Article 17',
      notes: 'Coverage is typically 5 business days after NOI acknowledgment when an MS4-accepted SWPPP is provided, or 60 business days for certain projects (e.g., in TMDL watersheds or without MS4 acceptance). In NYC the DEP stormwater construction permit also applies.',
    }),
    permit({
      id: 'ny-seqra',
      name: 'SEQRA / CEQR environmental review',
      authority: 'Lead agency (NYC: CEQR via Mayor’s Office of Environmental Coordination)',
      jurisdiction: 'state',
      appliesWhen: { nonFederalOnly: true },
      reviewWeeks: { low: 4, typical: 16, high: 78 },
      gates: 'earthwork',
      submitAfter: 'design_sd',
      source: 'State Environmental Quality Review Act, ECL Article 8; 6 NYCRR Part 617; NYC Executive Order 91 (CEQR)',
      notes: 'Type II actions: none; Unlisted/Type I with negative declaration: months; positive declaration/EIS: 1+ years. Applies to discretionary approvals (e.g., ULURP, variances, public funding).',
    }),
    permit({
      id: 'ny-doh-article28',
      name: 'NYS DOH Certificate of Need / Article 28 construction approval',
      authority: 'New York State Department of Health',
      jurisdiction: 'state',
      appliesWhen: { projectTypes: ['healthcare'], nonFederalOnly: true },
      reviewWeeks: { low: 12, typical: 30, high: 52 },
      gates: 'foundations',
      submitAfter: 'design_dd',
      source: 'Public Health Law Article 28; 10 NYCRR Parts 710–712',
      notes: 'Review level (limited, administrative or full) depends on cost and scope; DOH pre-opening survey required before patient use.',
    }),
  ],
  regulations: [
    {
      id: 'ny-tco',
      name: 'NYC Temporary / final Certificate of Occupancy sequence',
      appliesWhen: { nonFederalOnly: true },
      scheduleImpact:
        'TCO requires signed-off DOB inspections, FDNY acceptance tests, elevator (DOB Elevator Unit) sign-off and special inspection TR1/TR8 reports; TCOs must be renewed (typically every 90 days) until final CO. Reference default — verify with DOB.',
      source: 'NYC Administrative Code §28-118; 1 RCNY §101-xx',
    },
  ],
  climate: {
    adverseMonths: [12, 1, 2, 3],
    adverseNote: 'Winter cold, snow and frozen ground (Dec–Mar) require cold-weather concrete protection, temporary heat and enclosure; upstate and western NY lake-effect snow is more severe.',
    weatherDaysPerAdverseMonth: 5,
  },
}
extra('ny-nyc-dob', { city: 'nyc', replaces: ['def-building'] })
extra('ny-fdny', { city: 'nyc', replaces: ['def-fire-marshal'] })
extra('ny-nyc-dep', { city: 'nyc', replaces: ['def-water-sewer'] })
extra('ny-coned', { city: 'nyc', replaces: ['def-electric-service'] })
extra('ny-building', { city: 'not_nyc', replaces: ['def-building'] })
extra('ny-spdes', { replaces: ['us-npdes-cgp'] })

const FL: RegionSpec = {
  code: 'FL',
  name: 'Florida',
  permits: [
    localBuilding('fl-building', 'County/city building department', 4, 8, 20, 'Florida Building Code (8th ed. 2023) as enforced locally; F.S. §553.79', 'F.S. §553.792 sets statutory review timeframes for many permits; private-provider plan review/inspection (F.S. §553.791) can shorten review.'),
    permit({
      id: 'fl-fdep-cgp',
      name: 'FDEP Generic Permit for Stormwater Discharge from Large and Small Construction Activities (NOI + SWPPP)',
      authority: 'Florida Department of Environmental Protection',
      jurisdiction: 'state',
      appliesWhen: { minAcresDisturbed: 1 },
      reviewWeeks: { low: 1, typical: 2, high: 4 },
      gates: 'earthwork',
      submitAfter: 'design_dd',
      source: 'Rule 62-621.300(4), F.A.C.; NPDES delegated program',
      notes: 'Coverage begins 48 hours after a complete NOI is submitted electronically; SWPPP must be implemented before disturbance.',
    }),
    permit({
      id: 'fl-erp',
      name: 'Environmental Resource Permit (ERP) — stormwater management system',
      authority: 'Water Management District (SFWMD, SWFWMD, SJRWMD, SRWMD, NWFWMD) or FDEP',
      jurisdiction: 'state',
      appliesWhen: { scopes: ['new_construction', 'addition'] },
      reviewWeeks: { low: 6, typical: 12, high: 26 },
      gates: 'earthwork',
      submitAfter: 'design_dd',
      source: 'F.S. Part IV Ch. 373; Rule 62-330, F.A.C.',
      notes: 'Statutory clock is 30 days for completeness and 60 days to decide after complete, but requests for additional information commonly extend review.',
    }),
    permit({
      id: 'fl-ahca',
      name: 'AHCA Office of Plans and Construction review (hospitals, nursing homes, ASCs)',
      authority: 'Agency for Health Care Administration — Office of Plans and Construction',
      jurisdiction: 'state',
      appliesWhen: { projectTypes: ['healthcare'], nonFederalOnly: true },
      reviewWeeks: { low: 8, typical: 16, high: 30 },
      gates: 'foundations',
      submitAfter: 'design_cd',
      source: 'F.S. §395.0163; Rule 59A-3.080 / 59A-4, F.A.C.; FBC Chapter 4 (Section 449/450)',
      notes: 'Staged schematic/preliminary/construction-document reviews plus AHCA construction surveys before occupancy.',
    }),
  ],
  regulations: [
    {
      id: 'fl-product-approval',
      name: 'Florida Product Approval / Miami-Dade NOA for envelope products',
      appliesWhen: { nonInstallationOnly: true },
      scheduleImpact:
        'Windows, doors, storefront, curtain wall, roofing and shutters must carry Florida Product Approval (or Miami-Dade Notice of Acceptance in the High-Velocity Hurricane Zone) with impact/pressure ratings; non-approved products require engineering evaluation and lengthen submittal review. Reference default — verify with the AHJ.',
      source: 'Florida Building Code; Rule 61G20-3, F.A.C.; Miami-Dade County Product Control (HVHZ)',
    },
    {
      id: 'fl-threshold-inspection',
      name: 'Threshold building special inspector',
      appliesWhen: { minStories: 4, nonInstallationOnly: true },
      scheduleImpact:
        'Threshold buildings (>3 stories or >50 ft, or assembly occupancy >5,000 sf with >500 occupants) require a threshold inspection plan and a special inspector for structural work; shoring/reshoring inspections affect structure cycle time. Reference default — verify with the AHJ.',
      source: 'F.S. §553.71(12) and §553.79(5)',
    },
    {
      id: 'fl-hurricane-prep',
      name: 'Hurricane preparedness plan',
      appliesWhen: {},
      scheduleImpact:
        'Named-storm watches/warnings trigger site securing (cranes weathervaned, materials tied down) and demobilization days; many contracts treat named storms as excusable delay. Reference default — verify with the contract and AHJ.',
      source: 'Local building department hurricane preparedness ordinances; OSHA hurricane guidance',
    },
  ],
  climate: {
    adverseMonths: [6, 7, 8, 9, 10],
    adverseNote: 'Wet season (Jun–Sep) daily afternoon thunderstorms and lightning stoppages, and Atlantic hurricane season (Jun 1 – Nov 30, peak Aug–Oct).',
    weatherDaysPerAdverseMonth: 5,
  },
}
extra('fl-fdep-cgp', { replaces: ['us-npdes-cgp'] })
extra('fl-building', { replaces: ['def-building'] })

const WA: RegionSpec = {
  code: 'WA',
  name: 'Washington',
  permits: [
    localBuilding('wa-building', 'City/county building department (e.g., Seattle SDCI)', 8, 20, 40, 'Washington State Building Code (RCW 19.27; WAC 51-50) as adopted locally', 'Seattle and other large jurisdictions frequently take 6–9+ months for complex commercial permits, including design review / MUP where required.'),
    permit({
      id: 'wa-sepa',
      name: 'SEPA environmental review (DNS / MDNS / EIS)',
      authority: 'Lead agency (city/county)',
      jurisdiction: 'state',
      appliesWhen: { nonFederalOnly: true },
      reviewWeeks: { low: 4, typical: 12, high: 52 },
      gates: 'earthwork',
      submitAfter: 'design_sd',
      source: 'State Environmental Policy Act, RCW 43.21C; WAC 197-11',
      notes: 'Includes 14-day comment and appeal periods for threshold determinations; categorically exempt projects skip this step.',
    }),
    permit({
      id: 'wa-ecology-cswgp',
      name: 'Ecology Construction Stormwater General Permit (NOI + SWPPP)',
      authority: 'Washington State Department of Ecology',
      jurisdiction: 'state',
      appliesWhen: { minAcresDisturbed: 1 },
      reviewWeeks: { low: 5, typical: 6, high: 10 },
      gates: 'earthwork',
      submitAfter: 'design_dd',
      source: 'Construction Stormwater General Permit (NPDES/State Waste Discharge General Permit, 2021/2026 cycle); RCW 90.48',
      notes: 'NOI requires public notice in a newspaper twice and a 30-day comment period before coverage — plan ≥31 days plus preparation.',
    }),
    permit({
      id: 'wa-li-elevator',
      name: 'L&I elevator/conveyance installation permit & plan review',
      authority: 'Washington State Department of Labor & Industries',
      jurisdiction: 'state',
      appliesWhen: { minStories: 2, nonInstallationOnly: true },
      reviewWeeks: { low: 4, typical: 8, high: 14 },
      gates: 'elevators',
      submitAfter: 'submittals',
      source: 'RCW 70.87; WAC 296-96',
      notes: 'Seattle, Spokane and some cities administer their own conveyance programs. L&I acceptance inspection required before use.',
    }),
    permit({
      id: 'wa-li-electrical',
      name: 'L&I electrical permit & inspections',
      authority: 'Washington State Department of Labor & Industries (or city electrical program)',
      jurisdiction: 'state',
      appliesWhen: { nonInstallationOnly: true },
      reviewWeeks: { low: 1, typical: 2, high: 6 },
      gates: 'mep_rough',
      submitAfter: 'design_cd',
      source: 'RCW 19.28; WAC 296-46B',
      notes: 'Plan review required for certain occupancies (e.g., healthcare, schools, larger commercial services). Several cities (e.g., Seattle, Tacoma) run their own electrical programs.',
    }),
    permit({
      id: 'wa-doh-crs',
      name: 'WA DOH Construction Review Services (healthcare facilities)',
      authority: 'Washington State Department of Health',
      jurisdiction: 'state',
      appliesWhen: { projectTypes: ['healthcare'], nonFederalOnly: true },
      reviewWeeks: { low: 8, typical: 14, high: 26 },
      gates: 'foundations',
      submitAfter: 'design_cd',
      source: 'RCW 70.41; WAC 246-320 (hospitals) and related facility chapters',
    }),
  ],
  regulations: [
    {
      id: 'wa-energy-code',
      name: 'Washington State Energy Code (commercial) and commissioning',
      appliesWhen: { nonInstallationOnly: true },
      scheduleImpact:
        'WSEC-C requires functional testing and a commissioning report for many systems; final approval can depend on the preliminary commissioning report. Reference default — verify with the AHJ.',
      source: 'WAC 51-11C (Washington State Energy Code — Commercial), Section C408',
    },
  ],
  climate: {
    adverseMonths: [10, 11, 12, 1, 2, 3, 4],
    adverseNote: 'Western WA wet season (Oct–Apr) limits earthwork with moisture-sensitive soils; many jurisdictions apply wet-season clearing/grading restrictions. Eastern WA has cold winters with frozen ground.',
    weatherDaysPerAdverseMonth: 5,
  },
}
extra('wa-ecology-cswgp', { replaces: ['us-npdes-cgp'] })
extra('wa-building', { replaces: ['def-building'] })

const VA: RegionSpec = {
  code: 'VA',
  name: 'Virginia',
  permits: [
    localBuilding('va-building', 'County/city building official (e.g., Fairfax County LDS)', 4, 10, 20, 'Virginia Uniform Statewide Building Code (13VAC5-63)', 'Northern Virginia jurisdictions (Fairfax, Loudoun, Prince William) commonly run longer for large commercial and data center work.'),
    permit({
      id: 'va-vesmp',
      name: 'VESMP land-disturbance approval & VPDES Construction General Permit coverage',
      authority: 'Local VESMP authority / Virginia DEQ',
      jurisdiction: 'state',
      appliesWhen: { minAcresDisturbed: 1 },
      reviewWeeks: { low: 4, typical: 8, high: 16 },
      gates: 'earthwork',
      submitAfter: 'design_dd',
      source: 'Virginia Erosion and Stormwater Management Act (Code of Virginia §62.1-44.15:24 et seq.); 9VAC25-875; 9VAC25-880 (General Permit)',
      notes: 'The VESMP consolidated the former VSMP/VESCP programs effective July 1, 2024. Threshold is 2,500 sf in Chesapeake Bay Preservation Areas; erosion & sediment control plans are required for ≥10,000 sf in most localities.',
    }),
    permit({
      id: 'va-copn',
      name: 'Certificate of Public Need (COPN) for regulated medical care facilities/services',
      authority: 'Virginia Department of Health',
      jurisdiction: 'state',
      appliesWhen: { projectTypes: ['healthcare'], nonFederalOnly: true },
      reviewWeeks: { low: 16, typical: 30, high: 52 },
      gates: 'foundations',
      submitAfter: 'design_sd',
      source: 'Code of Virginia §32.1-102.1 et seq.; 12VAC5-220',
      notes: 'Applies only to COPN-regulated projects/services; batch review cycles drive timing.',
    }),
  ],
  regulations: [],
  climate: {
    adverseMonths: [12, 1, 2],
    adverseNote: 'Winter cold snaps, snow/ice and frozen ground (Dec–Feb); wet spring can affect clay soils. Tidewater region has hurricane-season exposure (Aug–Oct).',
    weatherDaysPerAdverseMonth: 4,
  },
}
extra('va-vesmp', { replaces: ['us-npdes-cgp'] })
extra('va-building', { replaces: ['def-building'] })

const MD: RegionSpec = {
  code: 'MD',
  name: 'Maryland',
  permits: [
    localBuilding('md-building', 'County/city permitting (e.g., Montgomery County DPS, Prince George’s DPIE, Baltimore City DHCD)', 6, 12, 24, 'Maryland Building Performance Standards (COMAR 09.12.51) as adopted locally'),
    permit({
      id: 'md-mde-cgp',
      name: 'MDE General Permit for Stormwater Associated with Construction Activity (NOI)',
      authority: 'Maryland Department of the Environment',
      jurisdiction: 'state',
      appliesWhen: { minAcresDisturbed: 1 },
      reviewWeeks: { low: 2, typical: 4, high: 8 },
      gates: 'earthwork',
      submitAfter: 'design_dd',
      source: 'MDE General Permit 20-CP (NPDES MDR10); COMAR 26.17.01–02',
      notes: 'NOI is submitted after erosion & sediment control plan approval; coverage follows a public notice period.',
    }),
    permit({
      id: 'md-esc',
      name: 'Erosion & sediment control and stormwater management plan approval (Soil Conservation District / county)',
      authority: 'Soil Conservation District and county stormwater authority',
      jurisdiction: 'local',
      appliesWhen: { scopes: ['new_construction', 'addition'] },
      reviewWeeks: { low: 4, typical: 10, high: 20 },
      gates: 'earthwork',
      submitAfter: 'design_dd',
      source: 'Environment Article §4-101 et seq.; COMAR 26.17.01; 2011 Maryland Standards and Specifications for Soil Erosion and Sediment Control',
      notes: 'Required for disturbance ≥5,000 sf or ≥100 cubic yards.',
    }),
    permit({
      id: 'md-wssc',
      name: 'WSSC Water system extension / service connection approval',
      authority: 'WSSC Water (Montgomery & Prince George’s counties) or local utility',
      jurisdiction: 'local',
      appliesWhen: { scopes: ['new_construction', 'addition'] },
      reviewWeeks: { low: 8, typical: 20, high: 40 },
      gates: 'utilities_site',
      submitAfter: 'design_dd',
      source: 'WSSC Water Plumbing & Fuel Gas Code; WSSC Development Services procedures',
      notes: 'System extension permits (SEP) in the WSSC service area are frequently long; outside WSSC use the local utility timeframe.',
    }),
    permit({
      id: 'md-mhcc-con',
      name: 'Maryland Health Care Commission Certificate of Need',
      authority: 'Maryland Health Care Commission',
      jurisdiction: 'state',
      appliesWhen: { projectTypes: ['healthcare'], nonFederalOnly: true },
      reviewWeeks: { low: 16, typical: 36, high: 60 },
      gates: 'foundations',
      submitAfter: 'design_sd',
      source: 'Health-General Article §19-120; COMAR 10.24.01',
      notes: 'Applies to CON-regulated projects (capital thresholds, bed changes, certain services).',
    }),
  ],
  regulations: [],
  climate: {
    adverseMonths: [12, 1, 2],
    adverseNote: 'Winter cold, snow and ice (Dec–Feb); western MD more severe.',
    weatherDaysPerAdverseMonth: 4,
  },
}
extra('md-mde-cgp', { replaces: ['us-npdes-cgp'] })
extra('md-wssc', { replaces: ['def-water-sewer'] })
extra('md-building', { replaces: ['def-building'] })

const AZ: RegionSpec = {
  code: 'AZ',
  name: 'Arizona',
  permits: [
    localBuilding('az-building', 'City/county development services (e.g., Phoenix PDD, Maricopa County, Tucson PDSD)', 4, 8, 16, 'IBC as adopted locally; A.R.S. §9-835 licensing time frames'),
    permit({
      id: 'az-azpdes-cgp',
      name: 'ADEQ AZPDES Construction General Permit (NOI + SWPPP)',
      authority: 'Arizona Department of Environmental Quality',
      jurisdiction: 'state',
      appliesWhen: { minAcresDisturbed: 1 },
      reviewWeeks: { low: 1, typical: 2, high: 4 },
      gates: 'earthwork',
      submitAfter: 'design_dd',
      source: 'AZPDES Construction General Permit AZG2020-001; A.A.C. R18-9-A901 et seq.',
      notes: 'Coverage generally effective upon ADEQ acknowledgment of a complete NOI (longer waiting periods near impaired/Outstanding Arizona Waters).',
    }),
    permit({
      id: 'az-dust',
      name: 'Dust control (earthmoving) permit — Maricopa County Rule 310 / Pima County',
      authority: 'Maricopa County Air Quality Department (or Pima DEQ / local air agency)',
      jurisdiction: 'local',
      appliesWhen: { minAcresDisturbed: 0.1 },
      reviewWeeks: { low: 1, typical: 2, high: 4 },
      gates: 'earthwork',
      submitAfter: 'design_dd',
      source: 'Maricopa County Air Pollution Control Regulations Rule 310 (Fugitive Dust)',
      notes: 'Required in Maricopa County for disturbance ≥0.1 acre; dust control plan and trained site coordinator required.',
    }),
  ],
  regulations: [
    {
      id: 'az-heat',
      name: 'Extreme-heat work practices',
      appliesWhen: {},
      scheduleImpact:
        'Summer heat drives night concrete placements, shortened exterior shifts and work/rest cycles (Arizona heat-illness emphasis program). Reference default — verify with the contractor safety plan.',
      source: 'ADOSH Heat Illness Emphasis Program; OSHA National Emphasis Program on Heat (CPL 03-00-024)',
    },
  ],
  climate: {
    adverseMonths: [6, 7, 8, 9],
    adverseNote: 'Extreme heat (Jun–Sep) and North American monsoon storms (roughly Jul–Sep) with dust storms and flash flooding.',
    weatherDaysPerAdverseMonth: 3,
  },
}
extra('az-azpdes-cgp', { replaces: ['us-npdes-cgp'] })
extra('az-building', { replaces: ['def-building'] })

/* ─── Registry & resolution ────────────────────────────── */

/* ─── Civil / infrastructure ──────────────────────────── */

const HB_T: ProjectType[] = ['highway_bridge']
const WATERS: ProjectType[] = ['highway_bridge', 'water_wastewater', 'transit_rail', 'utility_power', 'industrial_process', 'aviation', 'marine_civil_works', 'epc_industrial']
const CIVIL_VERIFY = 'Reference durations — confirm with the agency; many depend on the project\'s environmental class and the agency\'s workload.'

FEDERAL.permits.push(
  permit({
    id: 'us-usace-404-bridge', name: 'USACE Section 404 / Section 10 permit (work in waters of the U.S.)', authority: 'U.S. Army Corps of Engineers (District)', jurisdiction: 'federal',
    appliesWhen: { projectTypes: HB_T, civil: true }, reviewWeeks: { low: 6, typical: 16, high: 52 }, gates: 'in_water_work', submitAfter: 'design_dd',
    source: 'Clean Water Act §404 (33 U.S.C. §1344); Rivers and Harbors Act §10; 33 CFR Parts 320–332',
    notes: `Nationwide permits are often 45–90 days; individual permits commonly 6–12 months. Usually paired with a state §401 water quality certification and a fish work window. ${CIVIL_VERIFY}`,
  }),
  permit({
    id: 'us-usace-404-utility', name: 'USACE Section 404 / Section 10 permit (crossings and outfalls)', authority: 'U.S. Army Corps of Engineers (District)', jurisdiction: 'federal',
    appliesWhen: { projectTypes: ['water_wastewater', 'transit_rail', 'utility_power', 'industrial_process', 'aviation', 'epc_industrial'], civil: true }, reviewWeeks: { low: 6, typical: 12, high: 52 }, gates: 'earthwork', submitAfter: 'design_dd',
    source: 'Clean Water Act §404; 33 CFR Parts 320–332', notes: `Answer "Not required" if no waters or wetlands are affected. ${CIVIL_VERIFY}`,
  }),
  permit({
    id: 'us-401-wqc', name: 'State §401 water quality certification', authority: 'State water quality agency', jurisdiction: 'state',
    appliesWhen: { projectTypes: WATERS, civil: true }, reviewWeeks: { low: 8, typical: 16, high: 52 }, gates: 'earthwork', submitAfter: 'design_dd',
    source: 'Clean Water Act §401 (33 U.S.C. §1341); 40 CFR Part 121', notes: `Required with a §404 permit; the agency has up to one year. ${CIVIL_VERIFY}`,
  }),
  permit({
    id: 'us-row-certification', name: 'Right-of-way certification & utility relocation agreements', authority: 'State DOT / FHWA (federal-aid) and utility owners', jurisdiction: 'state',
    appliesWhen: { projectTypes: ['highway_bridge', 'transit_rail'], civil: true }, reviewWeeks: { low: 12, typical: 26, high: 78 }, gates: 'earthwork', submitAfter: 'design_dd',
    source: '23 CFR 635.309 (ROW certification for federal-aid projects); Uniform Act (49 CFR Part 24)', notes: `Utility relocations by others are a leading cause of civil delay; track each owner separately. ${CIVIL_VERIFY}`,
  }),
  permit({
    id: 'us-railroad-agreement', name: 'Railroad construction & maintenance agreement (flagging, force account)', authority: 'Operating railroad', jurisdiction: 'local',
    appliesWhen: { projectTypes: ['highway_bridge', 'transit_rail'], civil: true }, reviewWeeks: { low: 12, typical: 26, high: 52 }, gates: 'substructure', submitAfter: 'design_dd',
    source: 'Railroad public-projects manuals (e.g., UP/BNSF guidelines); 23 CFR Part 646 Subpart B', notes: `Answer "Not required" if the work does not cross or abut a railroad. ${CIVIL_VERIFY}`,
  }),
  permit({
    id: 'us-traffic-control-plan', name: 'Traffic control / lane closure plan approval', authority: 'Road owner (state DOT / county / city)', jurisdiction: 'local',
    appliesWhen: { projectTypes: HB_T, civil: true }, reviewWeeks: { low: 2, typical: 4, high: 8 }, gates: 'traffic_control', submitAfter: 'design_cd',
    source: 'MUTCD Part 6; agency work zone policy (23 CFR Part 630 Subpart J)', notes: CIVIL_VERIFY,
  }),
  permit({
    id: 'us-water-construction-permit', name: 'State drinking water / wastewater construction permit (plan approval)', authority: 'State health department or environmental agency', jurisdiction: 'state',
    appliesWhen: { projectTypes: ['water_wastewater'], civil: true }, reviewWeeks: { low: 6, typical: 12, high: 30 }, gates: 'process_structures', submitAfter: 'design_cd',
    source: 'Safe Drinking Water Act state primacy programs; state wastewater construction permit rules', notes: CIVIL_VERIFY,
  }),
  permit({
    id: 'us-transit-safety-cert', name: 'Safety certification plan & State Safety Oversight review', authority: 'Transit agency safety office / State Safety Oversight Agency (FTA)', jurisdiction: 'state',
    // Certification is what allows revenue service, so it gates substantial completion (not the testing that feeds it).
    appliesWhen: { projectTypes: ['transit_rail'], civil: true }, reviewWeeks: { low: 8, typical: 16, high: 40 }, gates: 'substantial_completion', submitAfter: 'design_cd',
    source: '49 CFR Part 674 (State Safety Oversight); 49 CFR Part 673 (PTASP)', notes: `Revenue service cannot start until the safety certification is issued. ${CIVIL_VERIFY}`,
  }),
  permit({
    id: 'us-interconnection', name: 'Utility / ISO interconnection approval & outage scheduling', authority: 'Interconnecting utility / ISO-RTO', jurisdiction: 'state',
    appliesWhen: { projectTypes: ['utility_power'], civil: true }, reviewWeeks: { low: 12, typical: 26, high: 104 }, gates: 'cutover', submitAfter: 'design_dd',
    source: 'FERC Order 2023 interconnection procedures; utility outage coordination procedures', notes: `Outage windows are often granted months ahead and only in low-load seasons. ${CIVIL_VERIFY}`,
  }),
  permit({
    id: 'us-siting-cpcn', name: 'State siting approval / certificate of public convenience and necessity', authority: 'State public utility commission / siting board', jurisdiction: 'state',
    appliesWhen: { projectTypes: ['utility_power'], civil: true }, reviewWeeks: { low: 26, typical: 52, high: 104 }, gates: 'earthwork', submitAfter: 'design_sd',
    source: 'State utility siting statutes', notes: `Answer "Not required" when the facility is within an existing substation footprint. ${CIVIL_VERIFY}`,
  }),
  permit({
    id: 'us-air-construction', name: 'Air construction permit (state permit / NSR)', authority: 'State or local air agency (EPA where delegated)', jurisdiction: 'state',
    appliesWhen: { projectTypes: ['industrial_process', 'epc_industrial'], civil: true }, reviewWeeks: { low: 12, typical: 26, high: 78 }, gates: 'foundations', submitAfter: 'design_dd',
    source: 'Clean Air Act New Source Review (40 CFR 51.165–166, 52.21); state air permit rules', notes: `Construction of an emission unit generally cannot begin before the permit. ${CIVIL_VERIFY}`,
  }),
)

/* Aviation, marine / locks / dams / tunnels, remediation */
const MARINE: ProjectType[] = ['marine_civil_works']
FEDERAL.permits.push(
  permit({
    id: 'us-faa-cspp', name: 'FAA review of the Construction Safety and Phasing Plan (CSPP) & Safety Plan Compliance Document', authority: 'FAA Airports District Office / airport sponsor', jurisdiction: 'federal',
    appliesWhen: { projectTypes: ['aviation'], civil: true, features: ['airside'] }, reviewWeeks: { low: 3, typical: 6, high: 12 }, gates: 'traffic_control', submitAfter: 'design_cd',
    source: 'FAA AC 150/5370-2G Operational Safety on Airports During Construction; 14 CFR Part 139', notes: `No airside work, closure or NOTAM before the CSPP is approved and the SPCD accepted. ${CIVIL_VERIFY}`,
  }),
  permit({
    id: 'us-faa-7460-construction', name: 'FAA Form 7460-1 airspace determinations for construction equipment, cranes & haul routes', authority: 'FAA Obstruction Evaluation / Airport Airspace Analysis', jurisdiction: 'federal',
    appliesWhen: { projectTypes: ['aviation'], civil: true, features: ['airside'] }, reviewWeeks: { low: 4, typical: 7, high: 12 }, gates: 'mobilization', submitAfter: 'design_cd',
    source: '14 CFR Part 77; FAA AC 150/5370-2G §2.13', notes: `File at least 45 days before equipment is on the airfield. ${CIVIL_VERIFY}`,
  }),
  permit({
    id: 'us-faa-navaid-agreement', name: 'FAA Technical Operations reimbursable agreement for NAVAID shutdowns, relocation & restoration', authority: 'FAA Technical Operations (ATO)', jurisdiction: 'federal',
    appliesWhen: { projectTypes: ['aviation'], civil: true, features: ['airside'] }, reviewWeeks: { low: 12, typical: 26, high: 52 }, gates: 'controls_scada', submitAfter: 'design_dd',
    source: 'FAA Order 6000.15 (maintenance of NAS systems); FAA reimbursable agreement process', notes: `Answer "Not required" if no FAA-owned NAVAID (ILS, PAPI, REIL, ALS) is affected. ${CIVIL_VERIFY}`,
  }),
  permit({
    id: 'us-usace-404-marine', name: 'USACE Section 404 / Section 10 permit (in-water structures, dredging & fill)', authority: 'U.S. Army Corps of Engineers (District)', jurisdiction: 'federal',
    appliesWhen: { projectTypes: MARINE, civil: true, features: ['in_water'] }, reviewWeeks: { low: 8, typical: 20, high: 52 }, gates: 'in_water_work', submitAfter: 'design_dd',
    source: 'Clean Water Act §404; Rivers and Harbors Act §10; 33 CFR Parts 320–332', notes: `Answer "Not required" when USACE itself is the owner (civil works projects are authorized, not permitted). ${CIVIL_VERIFY}`,
  }),
  permit({
    id: 'us-usace-408', name: 'Section 408 permission to alter a USACE civil works project', authority: 'U.S. Army Corps of Engineers (District / Division)', jurisdiction: 'federal',
    appliesWhen: { projectTypes: MARINE, civil: true, features: ['lock_dam'] }, reviewWeeks: { low: 12, typical: 26, high: 52 }, gates: 'in_water_work', submitAfter: 'design_dd',
    source: '33 U.S.C. §408; EC 1165-2-220', notes: `Applies when a non-federal sponsor alters a federal lock, dam or levee; "Not required" for USACE-owned work. ${CIVIL_VERIFY}`,
  }),
  permit({
    id: 'us-esa-section7', name: 'ESA Section 7 consultation (NMFS / USFWS) for in-water work', authority: 'NOAA Fisheries / U.S. Fish and Wildlife Service', jurisdiction: 'federal',
    appliesWhen: { projectTypes: ['highway_bridge', 'marine_civil_works'], civil: true, features: ['in_water'] }, reviewWeeks: { low: 6, typical: 20, high: 52 }, gates: 'in_water_work', submitAfter: 'design_dd',
    source: 'Endangered Species Act §7 (16 U.S.C. §1536); 50 CFR Part 402', notes: `Formal consultation runs up to 135 days after initiation and sets the in-water work window. ${CIVIL_VERIFY}`,
  }),
  permit({
    id: 'us-dam-safety', name: 'State dam safety plan approval', authority: 'State dam safety agency', jurisdiction: 'state',
    appliesWhen: { projectTypes: MARINE, civil: true, features: ['lock_dam'] }, reviewWeeks: { low: 8, typical: 16, high: 40 }, gates: 'earthwork', submitAfter: 'design_cd',
    source: 'State dam safety statutes (Model State Dam Safety Program, FEMA P-316)', notes: `"Not required" for federally owned dams. ${CIVIL_VERIFY}`,
  }),
  permit({
    id: 'us-blasting-permit', name: 'Explosives storage & blasting permit (blast plan, vibration limits)', authority: 'State fire marshal / local fire department; ATF (storage)', jurisdiction: 'state',
    appliesWhen: { projectTypes: MARINE, civil: true, features: ['drill_blast'] }, reviewWeeks: { low: 3, typical: 6, high: 12 }, gates: 'tunneling', submitAfter: 'design_cd',
    source: '27 CFR Part 555 (explosives storage); NFPA 495; state blasting regulations', notes: CIVIL_VERIFY,
  }),
  permit({
    id: 'us-waste-disposal-approval', name: 'Disposal facility waste profile approval & acceptance', authority: 'Permitted disposal facility (RCRA Subtitle C / D) and state agency', jurisdiction: 'state',
    appliesWhen: { projectTypes: ['environmental_remediation'], civil: true }, reviewWeeks: { low: 2, typical: 4, high: 8 }, gates: 'remediation', submitAfter: 'design_cd',
    source: 'RCRA (40 CFR Parts 261–268); CERCLA Off-Site Rule (40 CFR 300.440)', notes: `Off-site disposal under CERCLA needs a facility the EPA region has found acceptable. ${CIVIL_VERIFY}`,
  }),
  permit({
    id: 'us-remediation-discharge', name: 'Treated groundwater discharge authorization (NPDES or POTW pretreatment permit)', authority: 'State NPDES program / local sewer authority', jurisdiction: 'state',
    appliesWhen: { projectTypes: ['environmental_remediation'], civil: true, features: ['groundwater'] }, reviewWeeks: { low: 6, typical: 12, high: 26 }, gates: 'startup_testing', submitAfter: 'design_cd',
    source: 'Clean Water Act §402 / §307(b); CERCLA §121(e) permit equivalency for on-site actions', notes: CIVIL_VERIFY,
  }),
)

// Generic environmental and labor requirements that also apply to civil work.
const CIVIL_OK = new Set([
  'us-npdes-cgp', 'us-nepa', 'us-nhpa-106', 'us-fed-installation', 'us-davis-bacon', 'us-baba',
  'def-site-grading', 'ca-site-grading', 'ca-cgp', 'ca-ceqa', 'ca-calosha', 'tx-tceq-cgp', 'ny-spdes', 'ny-seqra',
  'fl-fdep-cgp', 'fl-erp', 'fl-hurricane-prep', 'wa-sepa', 'wa-ecology-cswgp', 'va-vesmp', 'md-mde-cgp', 'md-esc', 'az-azpdes-cgp', 'az-dust', 'az-heat',
])

const REGIONS: RegionSpec[] = [FEDERAL, DEFAULT, CA, TX, NY, FL, WA, VA, MD, AZ]
for (const r of REGIONS) for (const x of [...r.permits, ...r.regulations]) if (CIVIL_OK.has(x.id)) x.appliesWhen = { ...x.appliesWhen, civil: true }
const BY_CODE = new Map(REGIONS.map((r) => [r.code, r]))

export const SUPPORTED_STATES = ['CA', 'TX', 'NY', 'FL', 'WA', 'VA', 'MD', 'AZ'] as const

export function getRegion(code: string): RegionSpec | undefined {
  return BY_CODE.get(code.trim().toUpperCase())
}

export function listRegions(): RegionSpec[] {
  return [...REGIONS]
}

export interface ResolvedRegional {
  /** State region code used, or 'US-DEFAULT' */
  regionCode: string
  permits: PermitSpec[]
  regulations: RegulationSpec[]
  climate: RegionSpec['climate']
}

/**
 * Merge US-FEDERAL + the state region (US-DEFAULT fills in anything the state does not replace, and is used
 * entirely when the state is unknown/unsupported), then filter by applicability.
 */
export function resolveRegional(profile: ProjectProfile): ResolvedRegional {
  const stateCode = profile.state?.trim().toUpperCase()
  const state = stateCode && stateCode !== 'US-FEDERAL' && stateCode !== 'US-DEFAULT' ? BY_CODE.get(stateCode) : undefined

  const ok = (id: string, a: PermitSpec['appliesWhen']) => appliesTri(a, profile) !== 'no' && extraOk(id, profile)

  const statePermits = (state?.permits ?? []).filter((p) => ok(p.id, p.appliesWhen))
  const stateRegs = (state?.regulations ?? []).filter((r) => ok(r.id, r.appliesWhen))

  // Anything replaced by an applicable state item is dropped from federal/default.
  const replaced = new Set<string>()
  for (const p of statePermits) for (const id of EXTRA[p.id]?.replaces ?? []) replaced.add(id)

  const basePermits = [...FEDERAL.permits, ...DEFAULT.permits].filter((p) => !replaced.has(p.id) && ok(p.id, p.appliesWhen))
  const baseRegs = [...FEDERAL.regulations, ...DEFAULT.regulations].filter((r) => ok(r.id, r.appliesWhen))

  return {
    regionCode: state?.code ?? 'US-DEFAULT',
    permits: [...basePermits, ...statePermits],
    regulations: [...baseRegs, ...stateRegs],
    climate: { ...(state ?? DEFAULT).climate },
  }
}
