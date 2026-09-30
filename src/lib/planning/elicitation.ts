// Elicitation: figure out what we don't know and ask — the way a senior scheduler would —
// instead of guessing. Pure and deterministic; the model can only ADD questions (see suggestQuestions).

import type {
  Answer, AnswerValue, Assumption, ElicitationResult, InterviewState, ProjectProfile, ProjectType,
  Question, SourceRef, WorkScope, DeliveryMethod, Classification, PermitSpec, LongLeadSpec, RegulationSpec,
} from './types'
import { PROJECT_TYPES, PROJECT_TYPE_LABELS } from './types'
import { resolveRegional, listRegions } from '@/lib/knowledge/regions'
import { listLongLeadItems } from '@/lib/knowledge/long-lead'
import { appliesTri } from '@/lib/knowledge/applicability'
import { categoryLabel } from '@/lib/semantic/taxonomy'

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
const bool = (v: AnswerValue | undefined) => (typeof v === 'boolean' ? v : v === 'true' || v === 'yes' ? true : v === 'false' || v === 'no' ? false : undefined)

export function profileFrom(answers: Record<string, Answer>): ProjectProfile {
  const type = str(known(answers, 'project.type')) as ProjectType | undefined
  const federal = bool(known(answers, 'project.federal'))
  const sqft = num(known(answers, 'project.gross_sqft'))
  const stories = num(known(answers, 'project.stories'))
  const acres = num(known(answers, 'site.acres_disturbed'))
  const classification = str(known(answers, 'security.classification')) as Classification | undefined
  return {
    projectType: type && (PROJECT_TYPES as readonly string[]).includes(type) ? type : undefined,
    state: str(known(answers, 'project.state'))?.toUpperCase(),
    city: str(known(answers, 'project.city')),
    grossSqft: sqft,
    stories,
    scope: str(known(answers, 'project.scope')) as WorkScope | undefined,
    // Unknown disturbed area: estimate footprint ×2 for laydown/parking so NPDES-type rules can still fire.
    siteAcresDisturbed: acres ?? (sqft && stories ? Math.round((sqft / stories / 43560) * 2 * 10) / 10 : undefined),
    isFederal: type === 'federal_defense' ? true : federal,
    classification: classification ?? (answers['security.classification']?.status === 'withheld' ? 'classified' : undefined),
    deliveryMethod: str(known(answers, 'project.delivery')) as DeliveryMethod | undefined,
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
  const qs: Question[] = [
    {
      id: 'project.type', section: 'project', kind: 'choice', impact: 100, allowWithheld: false,
      prompt: 'What type of facility is this?',
      why: 'Facility type drives the activity network, commissioning rigor, required permits (e.g. healthcare/school state reviews) and long-lead equipment.',
      options: PROJECT_TYPES.map(t => ({ value: t, label: PROJECT_TYPE_LABELS[t] })),
    },
    {
      id: 'project.state', section: 'project', kind: 'choice', impact: 90, allowWithheld: true,
      prompt: 'Which state is the project in?',
      why: 'Permits, review times, and regional regulations are jurisdiction-specific. We pull the permit list for this project type in this region.',
      options: [...listRegions().filter(r => /^[A-Z]{2}$/.test(r.code)).map(r => ({ value: r.code, label: r.name })), { value: 'OTHER', label: 'Other / not listed' }],
      fallback: { value: 'OTHER', explanation: 'Generic US local permitting durations are used.' },
    },
    {
      id: 'project.city', section: 'project', kind: 'text', impact: 25, allowWithheld: true,
      prompt: 'Which city or county is the Authority Having Jurisdiction?',
      why: 'Local review cycles vary widely within a state (e.g. NYC DOB vs upstate). Used to flag city-specific requirements.',
    },
    {
      id: 'project.scope', section: 'project', kind: 'choice', impact: 80, allowWithheld: false,
      prompt: 'Is this new construction, an addition, or a renovation?',
      why: 'Renovations add demolition/abatement and, if occupied, phasing constraints; new construction adds full site and foundation work.',
      options: [
        { value: 'new_construction', label: 'New construction' }, { value: 'addition', label: 'Addition' },
        { value: 'renovation', label: 'Renovation (vacant)' }, { value: 'renovation_occupied', label: 'Renovation (occupied / phased)' },
      ],
    },
    {
      id: 'project.gross_sqft', section: 'project', kind: 'number', unit: 'sf', impact: 85, allowWithheld: true,
      prompt: 'What is the gross building area?',
      why: 'Work-package durations scale with area. Without it every duration is a guess.',
    },
    {
      id: 'project.stories', section: 'project', kind: 'number', unit: 'stories', impact: 60, allowWithheld: true,
      prompt: 'How many stories above grade?',
      why: 'Stories drive the structure cycle, elevator scope, and deep-foundation likelihood.',
      fallback: { value: 1, explanation: 'Assumed single story.' },
    },
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

  if (p.projectType !== 'federal_defense') {
    qs.push({
      id: 'project.federal', section: 'regulatory', kind: 'boolean', impact: 55, allowWithheld: false,
      prompt: 'Is this federally funded or on federal property?',
      why: 'Federal projects add NEPA/Section 106 reviews, Davis-Bacon administration and agency design reviews.',
      fallback: { value: false, explanation: 'Assumed not federal.' },
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

  qs.push(
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
    {
      id: 'calendar.workweek', section: 'calendar', kind: 'choice', impact: 50, allowWithheld: false,
      prompt: 'What is the planned work week for field work?',
      why: 'The calendar converts work days to dates. A 6-day week shortens the schedule roughly 15% but has cost and labor implications.',
      options: [{ value: '5x8', label: '5 days × 8 h (Mon–Fri)' }, { value: '5x10', label: '5 days × 10 h' }, { value: '4x10', label: '4 days × 10 h (Mon–Thu)' }, { value: '6x10', label: '6 days × 10 h (Mon–Sat)' }, { value: '7x12', label: '7 days (24/7 critical work)' }],
      fallback: { value: '5x8', explanation: 'Assumed a standard 5-day, 8-hour work week.' },
    },
    {
      id: 'calendar.holidays', section: 'calendar', kind: 'boolean', impact: 20, allowWithheld: false,
      prompt: 'Observe US federal holidays as non-work days?',
      why: 'About 11 non-work days per year that most schedules forget.',
      fallback: { value: true, explanation: 'Federal holidays are non-work days.' },
    },
    {
      id: 'calendar.weather', section: 'calendar', kind: 'boolean', impact: 30, allowWithheld: false,
      prompt: 'Include regional weather days for exterior work?',
      why: 'We add a weather allowance based on the region\'s adverse months that overlap earthwork through dry-in.',
      fallback: { value: true, explanation: 'Regional weather allowance included.' },
    },
  )

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
      why: `Typical review ${rw.low}–${rw.high} weeks (usually ~${rw.typical}). It can't be submitted until ${categoryLabel(pm.submitAfter).toLowerCase()} and it gates ${categoryLabel(pm.gates).toLowerCase()}.${pm.notes ? ' ' + pm.notes : ''}`,
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
      prompt: `Is ${it.name.toLowerCase()} in scope, and has it been ordered?`,
      why: `Current lead times run ${lw.low}–${lw.high} weeks after an approved submittal (~${it.submittalWeeks} weeks to prepare and approve). It gates ${categoryLabel(it.gates).toLowerCase()}.${it.notes ? ' ' + it.notes : ''}`,
      options: [{ value: 'not_released', label: 'In scope, not ordered' }, { value: 'released', label: 'Ordered (PO released)' }, { value: 'owner_furnished', label: 'Owner-furnished' }, { value: 'not_in_scope', label: 'Not in scope' }],
      groundedBy: grounded,
      fallback: { value: 'not_released', explanation: `Assumed in scope and not yet ordered; typical ${lw.typical}-week lead time.` },
    })
    const st = known(answers, `procure.${it.id}.status`)
    if (st === 'released' || st === 'owner_furnished') {
      qs.push({
        id: `procure.${it.id}.delivery`, section: 'procurement', kind: 'date', impact: 45, allowWithheld: true,
        prompt: `What is the committed delivery date for ${it.name.toLowerCase()}?`,
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
  ]
  return { all, permits, longLead, regulations, profile }
}

const WEIGHT: Record<Answer['status'], number> = { known: 1, withheld: 0.6, unknown: 0.3 }

export function elicit(state: InterviewState, ctx: ElicitationContext = {}): ElicitationResult {
  const { all, permits, longLead, profile } = questionBank(state, ctx)
  const answers = state.answers
  let total = 0, got = 0
  const open: Question[] = []
  const assumptions: Assumption[] = []

  for (const q of all) {
    total += q.impact
    const a = answers[q.id]
    if (!a) { open.push(q); continue }
    got += q.impact * WEIGHT[a.status]
    if (a.status !== 'known') assumptions.push(assumptionFor(q, a, permits, longLead, answers))
  }

  // Ask the highest-impact gaps first; keep sections together for ties so the interview reads naturally.
  const order: Question['section'][] = ['project', 'design', 'security', 'permits', 'procurement', 'site', 'regulatory', 'calendar', 'history']
  open.sort((a, b) => b.impact - a.impact || order.indexOf(a.section) - order.indexOf(b.section))

  return {
    questions: open,
    readiness: total ? Math.round((got / total) * 100) : 0,
    assumptions,
    profile,
    conflicts: findConflicts(answers, profile, permits, ctx),
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
    case 'choice': return q.options?.some(o => o.value === v) ? null : 'Pick one of the options.'
    case 'multi': return Array.isArray(v) ? null : 'Pick one or more options.'
    default: return typeof v === 'string' && v.trim() ? null : 'Enter an answer.'
  }
}

/** Normalize raw answer values from the browser (numbers/booleans arrive as strings). */
export function coerceAnswer(q: Question, a: Answer): Answer {
  if (a.status !== 'known') return { ...a, value: undefined }
  if (q.kind === 'number') return { ...a, value: num(a.value) ?? a.value }
  if (q.kind === 'boolean') return { ...a, value: bool(a.value) ?? a.value }
  return a
}
