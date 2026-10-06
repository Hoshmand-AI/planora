// Elicitation: figure out what we don't know and ask — the way a senior scheduler would —
// instead of guessing. Pure and deterministic; the model can only ADD questions (see suggestQuestions).

import type {
  CanonicalCategory, Answer, AnswerValue, Assumption, ElicitationResult, InterviewState, ProjectProfile, ProjectType,
  Question, SourceRef, WorkScope, DeliveryMethod, Classification, PermitSpec, LongLeadSpec, RegulationSpec,
} from './types'
import { PROJECT_TYPES, PROJECT_TYPE_LABELS, isCivilType } from './types'
import { resolveRegional, SUPPORTED_STATES } from '@/lib/knowledge/regions'
import { US_STATES } from '@/lib/knowledge/us-states'
import { listLongLeadItems } from '@/lib/knowledge/long-lead'
import { appliesTri } from '@/lib/knowledge/applicability'
import { categoryLabel } from '@/lib/semantic/taxonomy'
import { midSentence } from '@/lib/format'

export interface HistorySummary {
  /** Firm's own past schedules with categorized activities */
  projectCount: number
  similarCount: number
}

export interface ElicitationContext {
  history?: HistorySummary
  /** From llmStatus(): used to warn when classified work is pointed at a cloud model */
  aiMode?: 'cloud' | 'local' | 'offline'
  /** Model-proposed questions stored on the plan */
  extraQuestions?: Question[]
  today?: string
}

/* ─── Answer helpers ─────────────────────────────────── */

export function known(answers: Record<string, Answer>, id: string): AnswerValue | undefined {
  const a = answers[id]
  return a && a.status === 'known' ? a.value : undefined
}
const num = (v: AnswerValue | undefined) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)) ? Number(v) : undefined)
const str = (v: AnswerValue | undefined) => (typeof v === 'string' && v ? v : undefined)
/** Yes/no in any form a browser or API client sends: true/false, "Yes"/"No", "true"/"false", "y"/"n", 1/0. */
export function parseBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v
  if (v === 1 || v === 0) return v === 1
  if (typeof v !== 'string') return undefined
  const t = v.trim().toLowerCase()
  if (['true', 'yes', 'y', '1'].includes(t)) return true
  if (['false', 'no', 'n', '0'].includes(t)) return false
  return undefined
}
const bool = (v: AnswerValue | undefined) => parseBool(v)
/** A known yes/no answer, whatever form it was stored in (older answers may hold "false" or "No"). */
export const knownBool = (answers: Record<string, Answer>, id: string): boolean | undefined => parseBool(known(answers, id))

/** Square feet per square metre (gross area typed in m² is planned in sf, the catalogs' unit). */
export const SQFT_PER_M2 = 10.7639

const US_WORDS = /\b(usa|u\.s\.a?\.?|us|united states|america)\b/i
const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/**
 * The location typed instead of picking a US state ("Ontario, Canada", "Dubai") is outside the US
 * unless it names the US or a US state.
 */
export function isOutsideUS(answers: Record<string, Answer>): boolean {
  const a = answers['project.state']
  if (!a || a.status !== 'known' || !a.custom || typeof a.value !== 'string') return false
  const t = a.value.trim()
  if (US_WORDS.test(t)) return false
  const lower = t.toLowerCase()
  return !US_STATES.some(st => new RegExp(`\\b${escapeRe(st.name.toLowerCase())}\\b`).test(lower))
}

/**
 * Floor numbers typed for an interiors / TI project: "12-15", "3, 5, 7", "L2–L4", "Floors 10 to 12".
 * Returned ascending and de-duplicated; a range spans at most 200 floors.
 */
export function parseFloors(v: AnswerValue | undefined): number[] | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 ? [v] : undefined
  const text = (Array.isArray(v) ? v.join(',') : String(v)).toLowerCase().replace(/floors?|levels?|\bl(?=\d)/g, ' ')
  const out = new Set<number>()
  for (const part of text.split(/[,;&]|\band\b/)) {
    const m = part.match(/(\d+)\s*(?:-|–|—|to|through|thru)\s*(\d+)/)
    if (m) {
      const a = Number(m[1]), b = Number(m[2])
      const lo = Math.min(a, b), hi = Math.max(a, b)
      if (hi - lo <= 200) for (let f = lo; f <= hi; f++) out.add(f)
      continue
    }
    for (const n of part.match(/\d+/g) || []) out.add(Number(n))
  }
  const floors = [...out].filter(f => f > 0).sort((a, b) => a - b)
  return floors.length ? floors : undefined
}

export function profileFrom(answers: Record<string, Answer>): ProjectProfile {
  const type = str(known(answers, 'project.type')) as ProjectType | undefined
  const outsideUS = isOutsideUS(answers)
  // Outside the US there is no US federal undertaking (a defense facility keeps its own rules).
  const federal = outsideUS && type !== 'federal_defense' ? false : bool(known(answers, 'project.federal'))
  const civil = isCivilType(type)
  const ti = type === 'interiors_ti'
  const area = civil ? undefined : num(known(answers, 'project.gross_sqft'))
  const sqft = area !== undefined && known(answers, 'project.area_unit') === 'm2' ? Math.round(area * SQFT_PER_M2) : area
  const floors = ti ? parseFloors(known(answers, 'project.floors')) : undefined
  const stories = floors ? floors.length : ti ? undefined : num(known(answers, 'project.stories'))
  const acres = ti ? undefined : num(known(answers, 'site.acres_disturbed'))
  const classification = str(known(answers, 'security.classification')) as Classification | undefined
  return {
    projectType: type && (PROJECT_TYPES as readonly string[]).includes(type) ? type : undefined,
    // A typed location ("Ontario, Canada") is kept for the record but uses generic permitting.
    state: answers['project.state']?.custom ? undefined : str(known(answers, 'project.state'))?.toUpperCase(),
    city: str(known(answers, 'project.city')),
    grossSqft: sqft,
    stories,
    scope: str(known(answers, 'project.scope')) as WorkScope | undefined,
    // Unknown disturbed area: estimate footprint ×2 for laydown/parking so NPDES-type rules can still fire.
    // An interiors / TI fit-out disturbs no ground.
    siteAcresDisturbed: ti ? undefined : acres ?? (sqft && stories ? Math.round((sqft / stories / 43560) * 2 * 10) / 10 : undefined),
    isFederal: type === 'federal_defense' ? true : federal,
    onFederalInstallation: type === 'federal_defense' ? true : federal === false ? false : bool(known(answers, 'project.federal_installation')),
    classification: classification ?? (answers['security.classification']?.status === 'withheld' ? 'classified' : undefined),
    deliveryMethod: str(known(answers, 'project.delivery')) as DeliveryMethod | undefined,
    valueMusd: civil ? num(known(answers, 'project.value_musd')) : undefined,
    ...(floors ? { floors } : {}),
    ...(outsideUS ? { outsideUS } : {}),
  }
}

/* ─── Question bank ──────────────────────────────────── */

const src = (kind: SourceRef['kind'], label: string, detail?: string): SourceRef => ({ kind, label, detail })

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function baseQuestions(p: ProjectProfile, answers: Record<string, Answer>, ctx: ElicitationContext): Question[] {
  const today = ctx.today || new Date().toISOString().slice(0, 10)
  const civil = isCivilType(p.projectType)
  const ti = p.projectType === 'interiors_ti'
  const intl = !!p.outsideUS
  const qs: Question[] = [
    {
      id: 'project.type', section: 'project', kind: 'choice', impact: 100, allowWithheld: false,
      prompt: 'What type of project is this?',
      why: 'Project type drives the activity network, commissioning or startup rigor, required permits (e.g. healthcare/school state reviews, Section 404, utility interconnection) and long-lead equipment.',
      options: PROJECT_TYPES.map(t => ({ value: t, label: PROJECT_TYPE_LABELS[t] })),
    },
    {
      id: 'project.state', section: 'project', kind: 'choice', impact: 90, allowWithheld: true,
      prompt: 'Which state is the project in?',
      why: `Permits, review times, and regional regulations are jurisdiction-specific. We pull the permit list for this project type in this region (detailed catalogs for ${SUPPORTED_STATES.join(', ')}; other states use generic US permitting).`,
      options: US_STATES.map(st => ({ value: st.code, label: `${st.name}${(SUPPORTED_STATES as readonly string[]).includes(st.code) ? '' : ' (generic US permitting)'}` })),
      otherPrompt: "If you don't see your state or the project is outside the US, enter your country and state or location",
      fallback: { value: 'OTHER', explanation: 'Generic US local permitting durations are used.' },
    },
    {
      id: 'project.city', section: 'project', kind: 'text', impact: 25, allowWithheld: true,
      prompt: 'Which city or county is the Authority Having Jurisdiction?',
      why: 'Local review cycles vary widely within a state (e.g. NYC DOB vs upstate). Used to flag city-specific requirements.',
    },
    {
      id: 'project.scope', section: 'project', kind: 'choice', impact: 80, allowWithheld: false,
      prompt: civil ? 'Is this new work, an expansion, or rehabilitation / replacement of an existing asset?' : 'Is this new construction, an addition, or a renovation?',
      why: civil
        ? 'Rehabilitation and replacement add demolition and staging around the existing asset; work kept in service adds outages and traffic or shutdown windows.'
        : 'Renovations add demolition/abatement and, if occupied, phasing constraints; new construction adds full site and foundation work.',
      options: civil
        ? [
            { value: 'new_construction', label: 'New (greenfield / new alignment)' }, { value: 'addition', label: 'Expansion / widening' },
            { value: 'renovation', label: 'Rehabilitation or replacement (out of service)' }, { value: 'renovation_occupied', label: 'Rehabilitation or replacement kept in service (staged)' },
          ]
        : ti
        ? [
            { value: 'new_construction', label: 'First-generation space (shell, no demolition)' },
            { value: 'renovation', label: 'Second-generation space (demolish existing build-out)' },
            { value: 'renovation_occupied', label: 'Occupied building or floor (phased, after-hours work)' },
          ]
        : [
            { value: 'new_construction', label: 'New construction' }, { value: 'addition', label: 'Addition' },
            { value: 'renovation', label: 'Renovation (vacant)' }, { value: 'renovation_occupied', label: 'Renovation (occupied / phased)' },
          ],
    },
    ...(civil ? [{
      id: 'project.value_musd', section: 'project' as const, kind: 'number' as const, unit: 'USD millions', impact: 85, allowWithheld: true,
      prompt: 'Roughly what is the construction value, in millions of dollars?',
      why: 'Civil work packages are sized by construction value rather than floor area. Without it, durations use a $20M reference project.',
    }] : [{
      id: 'project.gross_sqft', section: 'project' as const, kind: 'number' as const,
      unit: known(answers, 'project.area_unit') === 'm2' ? 'm²' : 'sf', impact: 85, allowWithheld: true,
      prompt: ti ? 'What is the fit-out area?' : 'What is the gross building area?',
      why: 'Work-package durations scale with area. Without it every duration is a guess.',
    },
    ...(intl ? [{
      id: 'project.area_unit', section: 'project' as const, kind: 'choice' as const, impact: 30, allowWithheld: false,
      prompt: 'Is the area in square metres or square feet?',
      why: 'Durations are sized per 1,000 sf; an area in m² is converted (1 m² = 10.76 sf).',
      options: [{ value: 'm2', label: 'Square metres (m²)' }, { value: 'sf', label: 'Square feet (sf)' }],
      fallback: { value: 'sf', explanation: 'Assumed square feet.' },
    }] : []),
    ti ? {
      id: 'project.floors', section: 'project' as const, kind: 'text' as const, impact: 60, allowWithheld: true,
      prompt: 'Which floors are in the fit-out? Enter the floor numbers, for example 12-15 or 3, 5, 7.',
      why: 'Demolition, rough-in, drywall and finishes move floor by floor; the plan sequences and labels the work by your actual floor numbers.',
      fallback: { value: '1', explanation: 'Assumed a single floor.' },
    } : {
      id: 'project.stories', section: 'project' as const, kind: 'number' as const, unit: 'stories', impact: 60, allowWithheld: true,
      prompt: 'How many stories above grade?',
      why: 'Stories drive the structure cycle, elevator scope, and deep-foundation likelihood.',
      fallback: { value: 1, explanation: 'Assumed single story.' },
    }]),
    {
      id: 'project.target_start', section: 'project', kind: 'date', impact: 70, allowWithheld: true,
      prompt: 'When is Notice to Proceed (or the target start)?',
      why: 'Anchors the calendar; seasonal weather and permit timing depend on it.',
      fallback: { value: addDays(today, 30), explanation: 'Assumed NTP 30 days from today.' },
    },
    {
      id: 'project.required_finish', section: 'project', kind: 'date', impact: 45, allowWithheld: true,
      prompt: 'Is there a contractual or owner-required completion date?',
      why: 'Lets us compute float against the real deadline and show negative float if the plan cannot make it.',
    },
    {
      id: 'project.delivery', section: 'project', kind: 'choice', impact: 40, allowWithheld: false,
      prompt: 'What is the delivery method?',
      why: 'Design-build and CMAR allow early packages (foundations, steel) to overlap design; design-bid-build does not.',
      options: [{ value: 'dbb', label: 'Design-bid-build' }, { value: 'db', label: 'Design-build' }, { value: 'cmar', label: 'CM at risk' }, { value: 'ipd', label: 'IPD' }],
      fallback: { value: 'dbb', explanation: 'Assumed design-bid-build (no design/construction overlap).' },
    },
    {
      id: 'design.drawings', section: 'design', kind: 'boolean', impact: 90, allowWithheld: false,
      prompt: 'Do you have drawings for this project?',
      why: 'Drawing maturity decides whether design, permitting and procurement are still ahead of construction.',
    },
  ]

  // Outside the US there are no US federal funding / property questions (or their Davis-Bacon, NEPA follow-ups).
  if (p.projectType !== 'federal_defense' && !intl) {
    qs.push({
      id: 'project.federal', section: 'regulatory', kind: 'boolean', impact: 55, allowWithheld: false,
      prompt: 'Is this federally funded or on federal property?',
      why: 'Federal projects add NEPA/Section 106 reviews, Davis-Bacon administration and agency design reviews.',
      fallback: { value: false, explanation: 'Assumed not federal.' },
    })
    // Federal money is not federal land: base access and installation work clearances only apply on an installation.
    if (p.isFederal === true) {
      qs.push({
        id: 'project.federal_installation', section: 'regulatory', kind: 'boolean', impact: 35, allowWithheld: true,
        prompt: 'Is the work on a federal installation or federal property (for example a military base or a federal campus with controlled access)?',
        why: 'On an installation, work clearances, dig permits and base access (badging) replace local permits and gate mobilization. Federally funded work in public right-of-way or on non-federal land does not need them.',
        fallback: civil
          ? { value: false, explanation: 'Assumed built in public right-of-way, not on a federal installation (no base-access approvals).' }
          : { value: true, explanation: 'Assumed on federal property: installation approvals and base access are planned.' },
      })
    }
  }

  // Data centers are usually precast or insulated-panel boxes; curtain wall only when the design has it.
  if (p.projectType === 'data_center' && p.scope !== 'renovation' && p.scope !== 'renovation_occupied') {
    qs.push({
      id: 'envelope.curtain_wall', section: 'design', kind: 'boolean', impact: 20, allowWithheld: true,
      prompt: 'Does the data center have curtain wall (for example on an office or admin block), beyond entrance storefronts?',
      why: 'Curtain wall adds engineering, a long fabrication lead and a glazing sequence before dry-in. A precast or insulated-panel data center only needs entrance and admin storefront.',
      fallback: { value: false, explanation: 'Assumed a precast / insulated-panel envelope with entrance and admin storefront only.' },
    })
  }

  const drawings = bool(known(answers, 'design.drawings'))
  if (drawings === true) {
    qs.push({
      id: 'design.percent', section: 'design', kind: 'number', unit: '%', impact: 90, allowWithheld: false,
      prompt: 'What percentage complete are the drawings?',
      why: 'Below ~60% the permit set does not exist yet; below ~90% long-lead submittals cannot be finalized.',
      fallback: { value: 30, explanation: 'Assumed schematic-level (30%) drawings.' },
    })
  }
  if (drawings === false || (num(known(answers, 'design.percent')) ?? 100) < 100) {
    qs.push({
      id: 'design.review_weeks', section: 'design', kind: 'number', unit: 'weeks', impact: 35, allowWithheld: true,
      prompt: 'How long does the owner take to review each design submission?',
      why: 'Owner/agency review cycles sit on the critical path between design phases.',
      fallback: { value: p.isFederal ? 4 : 2, explanation: p.isFederal ? 'Assumed 4-week agency reviews (typical USACE/NAVFAC).' : 'Assumed 2-week owner reviews.' },
    })
  }

  if (p.isFederal) {
    qs.push({
      id: 'security.classification', section: 'security', kind: 'choice', impact: 60, allowWithheld: true,
      prompt: 'What is the security level of the project information?',
      why: 'Classified work adds accreditation (e.g. SCIF) steps, cleared-labor and escort constraints, and requires on-prem processing.',
      options: [{ value: 'unclassified', label: 'Unclassified' }, { value: 'cui', label: 'CUI' }, { value: 'classified', label: 'Classified' }],
    })
    if (profileFrom(answers).classification === 'classified') {
      qs.push({
        id: 'security.withheld_count', section: 'security', kind: 'number', unit: 'constraints', impact: 55, allowWithheld: false,
        prompt: 'How many constraints exist that you cannot share (access windows, restricted areas, security sequences)? Share only the count.',
        why: 'We can plan around information we are not allowed to see: each withheld constraint gets a placeholder and a reserved buffer, without its details.',
        fallback: { value: 0, explanation: 'Assumed no withheld constraints.' },
      })
      if ((num(known(answers, 'security.withheld_count')) ?? 0) > 0) {
        qs.push({
          id: 'security.withheld_days', section: 'security', kind: 'number', unit: 'work days', impact: 50, allowWithheld: true,
          prompt: 'Roughly how many work days of impact should we reserve for those constraints in total?',
          why: 'Sizes the placeholder buffer. An order of magnitude is enough; no details are needed.',
          fallback: { value: 20, explanation: 'Reserved 20 work days per withheld constraint (conservative).' },
        })
      }
    }
  }

  // An interiors / TI fit-out has no site work: no disturbed-area or site-condition questions.
  if (!ti) qs.push(
    {
      id: 'site.acres_disturbed', section: 'site', kind: 'number', unit: 'acres', impact: 40, allowWithheld: true,
      prompt: 'How many acres of ground will be disturbed (including laydown and parking)?',
      why: 'One acre or more triggers a stormwater construction permit (NPDES/SWPPP) before any earthwork.',
    },
    {
      id: 'site.conditions', section: 'site', kind: 'choice', impact: 35, allowWithheld: true,
      prompt: 'What are the site conditions?',
      why: 'Brownfield or poor soils add remediation, deep foundations and inspection time.',
      options: [{ value: 'greenfield', label: 'Greenfield' }, { value: 'previously_developed', label: 'Previously developed' }, { value: 'brownfield', label: 'Brownfield / known contamination' }, { value: 'poor_soils', label: 'Poor soils / high groundwater' }],
      fallback: { value: 'previously_developed', explanation: 'Assumed previously developed site with no remediation.' },
    },
  )
  qs.push(
    {
      id: 'calendar.workweek', section: 'calendar', kind: 'choice', impact: 50, allowWithheld: false,
      prompt: 'What is the planned work week for field work?',
      why: 'The calendar converts work days to dates. A 6-day week shortens the schedule roughly 15% but has cost and labor implications.',
      options: [{ value: '5x8', label: '5 days × 8 h (Mon–Fri)' }, { value: '5x10', label: '5 days × 10 h' }, { value: '4x10', label: '4 days × 10 h (Mon–Thu)' }, { value: '6x10', label: '6 days × 10 h (Mon–Sat)' }, { value: '7x12', label: '7 days (24/7 critical work)' }],
      fallback: { value: '5x8', explanation: 'Assumed a standard 5-day, 8-hour work week.' },
    },
  )
  // US federal holidays only for US projects (outside the US, local holidays are added to the calendar).
  if (!intl) qs.push({
    id: 'calendar.holidays', section: 'calendar', kind: 'boolean', impact: 20, allowWithheld: false,
    prompt: 'Observe US federal holidays as non-work days?',
    why: 'About 11 non-work days per year that most schedules forget.',
    fallback: { value: true, explanation: 'Federal holidays are non-work days.' },
  })
  // Interior fit-outs have no exterior exposure to carry weather days for.
  if (!ti) qs.push({
    id: 'calendar.weather', section: 'calendar', kind: 'boolean', impact: 30, allowWithheld: false,
    prompt: 'Include regional weather days for exterior work?',
    why: 'We add a weather allowance based on the region\'s adverse months that overlap earthwork through dry-in.',
    fallback: { value: true, explanation: 'Regional weather allowance included.' },
  })

  if (p.projectType) {
    for (const m of milestoneTargetsFor(p)) {
      qs.push({
        id: `milestone.${m.key}.target`, section: 'milestones', kind: 'date', impact: m.impact, allowWithheld: true,
        prompt: `Is there a target or contractual date for “${m.label}”?`,
        why: `${m.why} We hold the date as a finish-no-later-than target, check it against your other dates, and show how late the plan is against it.`,
        fallback: { value: '', explanation: 'No target; the date is whatever the logic produces.' },
      })
    }
  }

  // Cost basis: only matters once there is a date to protect. Never changes the schedule; it prices
  // the recovery options (overtime, added crews) against delay costs. Commercial data, so withholdable.
  if (known(answers, 'project.required_finish')) {
    qs.push(
      {
        id: 'cost.labor_per_day', section: 'cost', kind: 'number', unit: 'USD per work day', impact: 10, allowWithheld: true,
        prompt: 'Roughly what does field labor cost per work day on this project (all trades on site)?',
        why: 'Prices the recovery options: overtime and added crews are a premium on this figure.',
      },
      {
        id: 'cost.delay_per_day', section: 'cost', kind: 'number', unit: 'USD per calendar day', impact: 10, allowWithheld: true,
        prompt: 'What does each day of late completion cost (liquidated damages plus extended general conditions)?',
        why: 'Shows whether accelerating pays for itself: days saved × this figure versus the cost of the recovery option.',
      },
    )
  }

  if (ctx.history && ctx.history.projectCount > 0) {
    qs.push({
      id: 'history.use', section: 'history', kind: 'boolean', impact: 40, allowWithheld: false,
      prompt: `We found ${ctx.history.projectCount} of your firm's past schedules (${ctx.history.similarCount} similar). Use how those projects actually performed to set durations?`,
      why: 'Your firm\'s real outcomes (actual vs planned) beat generic productivity rates. This data stays private to your firm.',
      groundedBy: [src('firm_history', 'Your firm\'s uploaded schedules', `${ctx.history.projectCount} schedules, ${ctx.history.similarCount} of the same type`)],
      fallback: { value: true, explanation: 'Firm history used where available.' },
    })
  }
  return qs
}

function permitQuestions(permits: PermitSpec[], answers: Record<string, Answer>): Question[] {
  const qs: Question[] = []
  for (const pm of permits) {
    const rw = pm.reviewWeeks
    const grounded = [src('catalog', pm.name, `${pm.authority} — ${pm.source}`)]
    qs.push({
      id: `permit.${pm.id}.status`, section: 'permits', kind: 'choice', impact: 70, allowWithheld: true,
      prompt: `Do you have the ${pm.name} (${pm.authority})?`,
      why: `Typical review ${rw.low}–${rw.high} weeks (usually ~${rw.typical}). It can't be submitted until ${midSentence(categoryLabel(pm.submitAfter))} and it gates ${midSentence(categoryLabel(pm.gates))}.${pm.notes ? ' ' + pm.notes : ''}`,
      options: [{ value: 'issued', label: 'Issued' }, { value: 'submitted', label: 'Submitted, in review' }, { value: 'not_submitted', label: 'Not submitted yet' }, { value: 'not_required', label: 'Not required for this project' }],
      groundedBy: grounded,
      fallback: { value: 'not_submitted', explanation: `Assumed not yet submitted; typical ${rw.typical}-week review with a buffer toward the ${rw.high}-week high end.` },
    })
    if (known(answers, `permit.${pm.id}.status`) === 'submitted') {
      qs.push({
        id: `permit.${pm.id}.expected`, section: 'permits', kind: 'date', impact: 45, allowWithheld: true,
        prompt: `When do you expect the ${pm.name} to be issued?`,
        why: 'An expected issuance date replaces the typical review time and tightens the gate on construction.',
        groundedBy: grounded,
      })
    }
  }
  return qs
}

function procurementQuestions(items: LongLeadSpec[], answers: Record<string, Answer>): Question[] {
  const qs: Question[] = []
  for (const it of items) {
    const lw = it.leadWeeks
    const grounded = [src('catalog', it.name, it.source)]
    qs.push({
      id: `procure.${it.id}.status`, section: 'procurement', kind: 'choice', impact: 60, allowWithheld: true,
      prompt: `Is ${midSentence(it.name)} in scope, and has it been ordered?`,
      why: `Current lead times run ${lw.low}–${lw.high} weeks after an approved submittal (~${it.submittalWeeks} weeks to prepare and approve). It gates ${midSentence(categoryLabel(it.gates))}.${it.notes ? ' ' + it.notes : ''}`,
      options: [{ value: 'not_released', label: 'In scope, not ordered' }, { value: 'released', label: 'Ordered (PO released)' }, { value: 'owner_furnished', label: 'Owner-furnished' }, { value: 'not_in_scope', label: 'Not in scope' }],
      groundedBy: grounded,
      fallback: { value: 'not_released', explanation: `Assumed in scope and not yet ordered; typical ${lw.typical}-week lead time.` },
    })
    const st = known(answers, `procure.${it.id}.status`)
    if (st === 'released' || st === 'owner_furnished') {
      qs.push({
        id: `procure.${it.id}.delivery`, section: 'procurement', kind: 'date', impact: 45, allowWithheld: true,
        prompt: `What is the committed delivery date for ${midSentence(it.name)}?`,
        why: 'A committed delivery date becomes a start-no-earlier-than constraint on installation.',
        groundedBy: grounded,
      })
    }
  }
  return qs
}

function regulationQuestions(regs: RegulationSpec[], p: ProjectProfile): Question[] {
  // Only ask when the catalog cannot decide on its own (tri-state 'unknown').
  return regs.filter(r => appliesTri(r.appliesWhen, p) === 'unknown').map(r => ({
    id: `reg.${r.id}.applies`, section: 'regulatory' as const, kind: 'boolean' as const, impact: 30, allowWithheld: true,
    prompt: `Does ${r.name} apply to this project?`,
    why: r.scheduleImpact,
    groundedBy: [src('catalog', r.name, r.source)],
    fallback: { value: true, explanation: `Assumed ${r.name} applies (conservative).` },
  }))
}

/* ─── Milestone targets & date logic ─────────────────── */

export const MILESTONE_TARGETS: { key: string; label: string; category: CanonicalCategory; rank: number; impact: number; why: string }[] = [
  { key: 'foundations', label: 'Foundations complete', category: 'foundations', rank: 1, impact: 22, why: 'Foundations gate the structure.' },
  { key: 'structure', label: 'Structure complete (topped out)', category: 'structure_steel', rank: 2, impact: 22, why: 'Topping out gates the envelope and roof.' },
  { key: 'dry_in', label: 'Building dried-in', category: 'dry_in', rank: 3, impact: 24, why: 'Interior finishes and sensitive equipment wait for a watertight building.' },
  { key: 'electrical_service', label: 'Permanent power available', category: 'electrical_service', rank: 3, impact: 24, why: 'Commissioning cannot start without permanent power.' },
  { key: 'commissioning', label: 'Commissioning complete', category: 'commissioning', rank: 4, impact: 20, why: 'Commissioning is the last major step before turnover.' },
  { key: 'substantial_completion', label: 'Substantial completion', category: 'substantial_completion', rank: 5, impact: 30, why: 'The owner can occupy at substantial completion; it is usually the contractual date.' },
]

type MilestoneTarget = (typeof MILESTONE_TARGETS)[number]
const SC_TARGET = MILESTONE_TARGETS[MILESTONE_TARGETS.length - 1]
const CIVIL_MILESTONES: Partial<Record<ProjectType, MilestoneTarget[]>> = {
  highway_bridge: [
    { key: 'substructure', label: 'Substructure complete', category: 'substructure', rank: 1, impact: 22, why: 'Abutments and piers gate girder erection.' },
    { key: 'deck', label: 'Deck complete', category: 'deck', rank: 2, impact: 24, why: 'The deck gates approach work and the traffic switch.' },
    { key: 'traffic_switch', label: 'Final traffic switch', category: 'cutover', rank: 4, impact: 26, why: 'Traffic switches are often contractual (lane-rental or incentive/disincentive dates).' },
    SC_TARGET,
  ],
  transit_rail: [
    { key: 'track', label: 'Track complete', category: 'track_systems', rank: 2, impact: 24, why: 'Track gates systems installation and testing.' },
    { key: 'systems_testing', label: 'Systems integration testing complete', category: 'startup_testing', rank: 4, impact: 26, why: 'Revenue service waits on integrated testing and safety certification.' },
    SC_TARGET,
  ],
  water_wastewater: [
    { key: 'process_structures', label: 'Process structures complete', category: 'process_structures', rank: 2, impact: 22, why: 'Structures (and leak tests) gate equipment installation.' },
    { key: 'startup', label: 'Startup & performance testing complete', category: 'startup_testing', rank: 4, impact: 26, why: 'Regulatory permits and consent decrees often set the date the plant must be operating.' },
    SC_TARGET,
  ],
  utility_power: [
    { key: 'energization', label: 'Energization', category: 'cutover', rank: 4, impact: 28, why: 'Energization dates are set with the utility / ISO and are hard to move.' },
    SC_TARGET,
  ],
  industrial_process: [
    { key: 'mechanical_completion', label: 'Mechanical completion', category: 'pipeline', rank: 3, impact: 24, why: 'Mechanical completion hands the plant to commissioning.' },
    { key: 'startup', label: 'Startup complete', category: 'startup_testing', rank: 4, impact: 26, why: 'First production is usually the owner\'s business date.' },
    SC_TARGET,
  ],
}
/** Milestone targets the interview asks about for this project type. */
export function milestoneTargetsFor(p: ProjectProfile): MilestoneTarget[] {
  // Interiors / TI: no foundations, structure or dry-in to target.
  if (p.projectType === 'interiors_ti') return MILESTONE_TARGETS.filter(m => m.key === 'commissioning' || m.key === 'substantial_completion')
  return (p.projectType && CIVIL_MILESTONES[p.projectType]) || MILESTONE_TARGETS
}
/** Every milestone target key across project types (for date checks on stored answers). */
const ALL_MILESTONE_TARGETS: MilestoneTarget[] = [...MILESTONE_TARGETS, ...Object.values(CIVIL_MILESTONES).flat()].filter((m, i, arr) => arr.findIndex(x => x.key === m.key) === i)

/** Which milestone a gated category must precede, for delivery/permit vs target checks. */
const GATE_TO_MILESTONE: Partial<Record<CanonicalCategory, string>> = {
  earthwork: 'foundations', deep_foundations: 'foundations', foundations: 'foundations',
  structure_steel: 'structure', structure_concrete: 'structure', structure_wood: 'structure',
  roofing: 'dry_in', exterior_skin: 'dry_in', windows_curtainwall: 'dry_in',
  electrical_service: 'electrical_service', mechanical_equipment: 'commissioning', fire_protection: 'commissioning',
  elevators: 'substantial_completion', finishes: 'substantial_completion', specialties: 'substantial_completion', low_voltage: 'commissioning',
  substructure: 'substructure', superstructure: 'deck', deck: 'deck', track_systems: 'track', process_structures: 'process_structures',
  process_equipment: 'startup', power_equipment: 'energization', conductors: 'energization', controls_scada: 'startup', pipeline: 'mechanical_completion',
  substantial_completion: 'substantial_completion',
}

export interface DateIssue { questionIds: string[]; text: string; severity: 'error' | 'warning' }

/** Pure date checks on the answers themselves — run as soon as dates are entered. */
export function checkAnswerDates(answers: Record<string, Answer>, permits: PermitSpec[], longLead: LongLeadSpec[]): DateIssue[] {
  const out: DateIssue[] = []
  const d = (id: string) => { const v = known(answers, id); return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined }
  const f = (x: string) => `${x.slice(5, 7)}/${x.slice(8, 10)}/${x.slice(0, 4)}`
  const start = d('project.target_start')
  const finish = d('project.required_finish')
  type Pt = { id: string; label: string; date: string; rank: number }
  const pts: Pt[] = []
  if (start) pts.push({ id: 'project.target_start', label: 'Notice to Proceed', date: start, rank: 0 })
  for (const m of ALL_MILESTONE_TARGETS) { const x = d(`milestone.${m.key}.target`); if (x) pts.push({ id: `milestone.${m.key}.target`, label: m.label, date: x, rank: m.rank }) }
  if (finish) pts.push({ id: 'project.required_finish', label: 'Required completion', date: finish, rank: 6 })
  for (const a of pts) for (const b of pts) {
    // The required completion is usually the Substantial Completion date itself (and may equal the
    // other completion-stage milestones), so only a required completion BEFORE them is a conflict.
    const sameDayOk = b.id === 'project.required_finish' && a.rank >= 4
    if (a.rank < b.rank && (sameDayOk ? b.date < a.date : b.date <= a.date)) {
      out.push({ questionIds: [a.id, b.id], severity: 'error', text: `“${b.label}” (${f(b.date)}) is on or before “${a.label}” (${f(a.date)}). ${b.label} can't happen until ${a.label.toLowerCase()} — one of these dates needs to change.` })
    }
  }
  const targetOf = (key: string) => pts.find(p => p.id === `milestone.${key}.target`)
  for (const it of longLead) {
    const del = d(`procure.${it.id}.delivery`)
    if (!del) continue
    const mk = GATE_TO_MILESTONE[it.gates]
    const t = mk ? targetOf(mk) : undefined
    if (t && del >= t.date) out.push({ questionIds: [`procure.${it.id}.delivery`, t.id], severity: 'error', text: `${it.name} arrives ${f(del)}, but “${t.label}” is targeted for ${f(t.date)}. It has to be delivered and installed before that milestone.` })
    if (finish && del >= finish) out.push({ questionIds: [`procure.${it.id}.delivery`, 'project.required_finish'], severity: 'error', text: `${it.name} arrives ${f(del)}, after the required completion (${f(finish)}).` })
    if (start && del < start) out.push({ questionIds: [`procure.${it.id}.delivery`], severity: 'warning', text: `${it.name} arrives ${f(del)}, before Notice to Proceed (${f(start)}). Plan protected storage, or confirm the date.` })
  }
  for (const pm of permits) {
    const exp = d(`permit.${pm.id}.expected`)
    if (!exp) continue
    const mk = GATE_TO_MILESTONE[pm.gates]
    const t = mk ? targetOf(mk) : undefined
    if (t && exp >= t.date) out.push({ questionIds: [`permit.${pm.id}.expected`, t.id], severity: 'error', text: `The ${pm.name} is expected ${f(exp)}, but it gates work needed for “${t.label}” (${f(t.date)}). The target can't be met unless the permit comes first.` })
    if (start && exp < start) out.push({ questionIds: [`permit.${pm.id}.expected`], severity: 'warning', text: `The ${pm.name} is expected ${f(exp)}, before Notice to Proceed (${f(start)}). If it's already issued, mark it “Issued”.` })
  }
  return out
}

/* ─── Main entry ─────────────────────────────────────── */

export function questionBank(state: InterviewState, ctx: ElicitationContext = {}): { all: Question[]; permits: PermitSpec[]; longLead: LongLeadSpec[]; regulations: RegulationSpec[]; profile: ProjectProfile } {
  const answers = state.answers
  const profile = profileFrom(answers)
  const regional = resolveRegional(profile)
  const permits = regional.permits
  const longLead = listLongLeadItems(profile)
  const regulations = regional.regulations
  const all = [
    ...baseQuestions(profile, answers, ctx),
    ...permitQuestions(permits, answers),
    ...procurementQuestions(longLead, answers),
    ...regulationQuestions(regulations, profile),
    ...(ctx.extraQuestions || []),
  ].map(q => (q.kind === 'choice' || q.kind === 'multi') && q.allowOther === undefined
    ? (STRICT_CHOICE(q.id) ? { ...q, allowOther: false } : { ...q, allowOther: true, otherPrompt: q.otherPrompt || 'Not listed? Type your answer' })
    : q)
  return { all, permits, longLead, regulations, profile }
}

/**
 * Choices the plan's logic branches on (facility type, scope, delivery, permit and procurement status):
 * only a listed option is a valid answer. A typed value there used to be kept as a "custom" answer and
 * silently planned as the default (e.g. procure.escalators.status = "not_required" stayed in scope).
 */
const STRICT_CHOICE = (id: string) =>
  ['project.type', 'project.scope', 'project.delivery', 'security.classification', 'project.area_unit'].includes(id) || /^(permit|procure)\.[^.]+\.status$/.test(id)

/** history.use when the firm has no completed projects yet: accepted as a preference (no effect until history exists). */
export const HISTORY_USE_QUESTION: Question = {
  id: 'history.use', section: 'history', kind: 'boolean', impact: 0, allowWithheld: false,
  prompt: "Use how your firm's past projects actually performed to set durations?",
  why: 'Recorded as a preference. It takes effect once your firm has uploaded completed schedules.',
}

/**
 * The question an incoming answer belongs to. Answers saved together can make each other irrelevant
 * (answering "federal: no" removes "does Davis-Bacon apply?"), so a question offered with the answers
 * the user was looking at (`offered`) is still accepted.
 */
export function answerableQuestion(id: string, answers: Record<string, Answer>, ctx: ElicitationContext = {}, offered?: Record<string, Answer>): Question | null {
  const now = questionBank({ answers }, ctx).all.find(q => q.id === id)
  if (now) return now
  const before = offered ? questionBank({ answers: offered }, ctx).all.find(q => q.id === id) : undefined
  if (before) return before
  return id === 'history.use' ? HISTORY_USE_QUESTION : null
}

const WEIGHT: Record<Answer['status'], number> = { known: 1, withheld: 0.6, unknown: 0.3 }

export function elicit(state: InterviewState, ctx: ElicitationContext = {}): ElicitationResult {
  const { all, permits, longLead, profile } = questionBank(state, ctx)
  const answers = state.answers
  const dateIssues = checkAnswerDates(answers, permits, longLead)
  let total = 0, got = 0
  const open: Question[] = []
  const assumptions: Assumption[] = []

  for (const q of all) {
    total += q.impact
    const a = answers[q.id]
    if (!a) { open.push(q); continue }
    got += q.impact * WEIGHT[a.status]
    if (a.status !== 'known') assumptions.push(assumptionFor(q, a, permits, longLead, answers))
    else if (a.custom) assumptions.push(customAssumption(q, a))
  }

  // Ask the highest-impact gaps first; keep sections together for ties so the interview reads naturally.
  const order: Question['section'][] = ['project', 'design', 'security', 'permits', 'procurement', 'site', 'regulatory', 'calendar', 'milestones', 'cost', 'history']
  open.sort((a, b) => b.impact - a.impact || order.indexOf(a.section) - order.indexOf(b.section))

  return {
    questions: open,
    readiness: total ? Math.round((got / total) * 100) : 0,
    assumptions,
    profile,
    conflicts: [...findConflicts(answers, profile, permits, ctx), ...dateIssues.map(i => i.text)],
    dateIssues,
  }
}

function assumptionFor(q: Question, a: Answer, permits: PermitSpec[], longLead: LongLeadSpec[], answers: Record<string, Answer>): Assumption {
  const kind = a.status === 'withheld' ? 'withheld' : 'unknown'
  let bufferDays = 0
  const m = q.id.match(/^(permit|procure)\.([^.]+)\.(status|expected|delivery)$/)
  if (m && m[1] === 'permit') {
    const pm = permits.find(p => p.id === m[2])
    if (pm) bufferDays = Math.round((pm.reviewWeeks.high - pm.reviewWeeks.typical) * 5 * 0.5)
  } else if (m && m[1] === 'procure') {
    const it = longLead.find(l => l.id === m[2])
    if (it) bufferDays = Math.round((it.leadWeeks.high - it.leadWeeks.typical) * 5 * 0.5)
  } else if (q.id === 'project.gross_sqft' || q.id === 'design.percent') {
    bufferDays = 20
  } else if (q.id === 'security.withheld_days') {
    bufferDays = 0 // reserved via placeholders, not general contingency
  } else if (q.impact >= 60) {
    bufferDays = 10
  } else if (q.impact >= 40) {
    bufferDays = 5
  }
  const base = q.fallback?.explanation || 'No answer; conservative defaults used.'
  const text = kind === 'withheld'
    ? `${q.prompt} — withheld by the user. ${base} Planned around it without the underlying detail.`
    : `${q.prompt} — unknown. ${base}`
  void answers
  return { questionId: q.id, text, bufferDays, kind }
}

/** An open question at generation time: planned with its default, buffered like "don't know". */
export function unansweredAssumption(q: Question, permits: PermitSpec[], longLead: LongLeadSpec[]): Assumption {
  const a = assumptionFor(q, { status: 'unknown', answeredAt: '' }, permits, longLead, {})
  return { ...a, text: `Not answered yet: ${q.prompt} ${q.fallback?.explanation || 'Planora uses its default for this item.'}` }
}

/** A typed answer outside the catalog: recorded verbatim, planned with the default, flagged for review. */
function customAssumption(q: Question, a: Answer): Assumption {
  const fallback = q.id === 'project.state'
    ? (isOutsideUS({ [q.id]: a })
      ? 'Treated as outside the US: no US permits, federal questions or US holidays; a generic local building approval and utility connection are planned — add the local approvals and holidays.'
      : 'Generic US permitting and climate are used — add local permits as activities if needed.')
    : q.id === 'project.type'
      ? 'A generic building template is used; review the activity list for this facility type.'
      : q.fallback?.explanation || 'Planora plans with its default for this item.'
  return { questionId: q.id, text: `${q.prompt} — you entered “${String(a.value)}”, which is not in Planora's catalog. ${fallback}`, bufferDays: q.impact >= 60 ? 10 : q.impact >= 40 ? 5 : 0, kind: 'custom' }
}

function findConflicts(answers: Record<string, Answer>, p: ProjectProfile, permits: PermitSpec[], ctx: ElicitationContext): string[] {
  const out: string[] = []
  const drawings = bool(known(answers, 'design.drawings'))
  const pct = num(known(answers, 'design.percent'))
  if (drawings === false && pct !== undefined && pct > 0) out.push(`Drawings marked as not available, but design completion is ${pct}%.`)
  if (pct !== undefined && (pct < 0 || pct > 100)) out.push(`Design completion ${pct}% is outside 0–100%.`)
  if (p.stories && p.grossSqft && p.grossSqft / p.stories < 1500) out.push(`${p.grossSqft.toLocaleString()} sf over ${p.stories} stories is under 1,500 sf per floor — please confirm area and story count.`)
  if ((p.scope === 'renovation' || p.scope === 'renovation_occupied') && (p.siteAcresDisturbed ?? 0) >= 5) out.push('Renovation scope but 5+ acres of site disturbance — is there significant sitework in scope?')
  if (p.projectType === 'multifamily' && (p.stories ?? 0) > 12 && p.scope === 'new_construction') out.push('High-rise multifamily: confirm structural system; the template assumes concrete above 5 stories.')
  if (known(answers, 'project.federal') === false && p.projectType === 'federal_defense') out.push('Project type is federal/defense but marked as not federal.')
  if (p.classification === 'classified' && ctx.aiMode === 'cloud') out.push('Classified project while AI runs in cloud mode. Switch this deployment to air-gapped mode (PLANORA_AIRGAPPED=true with an on-prem model) before entering any controlled information.')

  const start = str(known(answers, 'project.target_start'))
  const finish = str(known(answers, 'project.required_finish'))
  if (start && finish && finish <= start) out.push(`Required finish ${finish} is on or before the target start ${start}.`)
  if (start && pct !== undefined && pct < 90) {
    const bp = permits.find(pm => pm.gates === 'foundations' && known(answers, `permit.${pm.id}.status`) === 'not_submitted')
    if (bp) out.push(`The ${bp.name} is not submitted and drawings are ${pct}% complete; construction cannot start at ${start} — the schedule will show NTP for design/preconstruction, with field work gated by the permit.`)
  }
  return out
}

/* ─── Answer validation ──────────────────────────────── */

export function validateAnswer(q: Question, a: Answer): string | null {
  if (a.status !== 'known') return q.allowWithheld || a.status === 'unknown' ? null : 'This question cannot be withheld.'
  const v = a.value
  switch (q.kind) {
    case 'number': {
      const n = num(v)
      if (n === undefined) return 'Enter a number.'
      if (n < 0) return 'Must be zero or more.'
      if (q.unit === '%' && n > 100) return 'Must be between 0 and 100.'
      return null
    }
    case 'date': return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? null : 'Enter a date (yyyy-mm-dd).'
    case 'boolean': return bool(v) === undefined ? 'Answer yes or no.' : null
    case 'choice':
      if (q.options?.some(o => o.value === v)) return null
      if (q.allowOther && typeof v === 'string' && v.trim().length >= 2) return v.length > 200 ? 'Keep it under 200 characters.' : null
      return q.allowOther ? 'Pick an option or type your own answer.' : `${v === undefined || v === '' ? 'No answer given' : `“${String(v)}” is not a valid answer`}. Valid options: ${(q.options || []).map(o => o.value).join(', ')}.`
    case 'multi': return Array.isArray(v) ? null : 'Pick one or more options.'
    default: return typeof v === 'string' && v.trim() ? null : 'Enter an answer.'
  }
}

export interface AppliedAnswers {
  answers: Record<string, Answer>
  /** Questions that don't exist or no longer apply (skipped, not fatal) */
  errors: Record<string, string>
  /** Invalid values: the caller rejects the whole request */
  invalid: Record<string, string>
  applied: { id: string; detail: string }[]
}

/**
 * Apply a batch of interview answers. Order doesn't matter: dependent questions (design % after
 * "drawings: yes", an elevator's status after the story count) are retried once the answers they depend
 * on are in, and a question the user was offered that another answer in the same batch made irrelevant
 * (e.g. "Does Davis-Bacon apply?" saved together with "federal: no") is still accepted.
 */
export function applyAnswers(current: Record<string, Answer>, incoming: Record<string, Partial<Answer> | null>, ctx: ElicitationContext = {}, now = new Date().toISOString()): AppliedAnswers {
  let answers = { ...current }
  const errors: Record<string, string> = {}
  const invalid: Record<string, string> = {}
  const applied: AppliedAnswers['applied'] = []
  const apply = (qid: string, raw: Partial<Answer>, q: Question) => {
    const status = raw.status === 'withheld' || raw.status === 'unknown' ? raw.status : 'known'
    // A note qualifies the answer in the team's own words; never kept on withheld answers.
    const note = status !== 'withheld' && typeof raw.note === 'string' && raw.note.trim() ? raw.note.trim().slice(0, 1000) : undefined
    const a = coerceAnswer(q, { status, value: raw.value, note, answeredAt: now, source: 'user' })
    const err = validateAnswer(q, a)
    if (err) { invalid[qid] = err; return }
    answers = { ...answers, [qid]: a }
    applied.push({ id: qid, detail: `${qid} = ${status === 'known' ? JSON.stringify(a.value) : status}` })
  }
  let queue = Object.entries(incoming)
  while (queue.length) {
    const retry: typeof queue = []
    for (const [qid, raw] of queue) {
      if (raw === null || typeof raw !== 'object') { delete answers[qid]; continue }
      const q = questionBank({ answers }, ctx).all.find(x => x.id === qid)
      if (q) apply(qid, raw, q)
      else retry.push([qid, raw])
    }
    if (retry.length === queue.length) {
      for (const [qid, raw] of retry) {
        const q = answerableQuestion(qid, answers, ctx, current)
        if (q) apply(qid, raw as Partial<Answer>, q)
        else errors[qid] = 'Unknown or no longer relevant question.'
      }
      break
    }
    queue = retry
  }
  return { answers, errors, invalid, applied }
}

/** Normalize raw answer values from the browser (numbers/booleans arrive as strings). */
export function coerceAnswer(q: Question, a: Answer): Answer {
  if (a.status !== 'known') return { ...a, value: undefined }
  if (q.kind === 'number') return { ...a, value: num(a.value) ?? a.value }
  if (q.kind === 'boolean') return { ...a, value: bool(a.value) ?? a.value }
  if (q.kind === 'choice' && typeof a.value === 'string' && !q.options?.some(o => o.value === a.value)) {
    // Match a typed answer to a listed option when it clearly is one (e.g. "virginia" → VA).
    const t = a.value.trim().toLowerCase()
    const hit = q.options?.find(o => o.value.toLowerCase() === t || o.label.toLowerCase() === t || o.label.toLowerCase().replace(/ \(.*\)$/, '') === t)
    return hit ? { ...a, value: hit.value, custom: undefined } : { ...a, value: a.value.trim(), custom: true }
  }
  return a
}
