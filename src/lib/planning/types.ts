// Shared contract for Planora's schedule-building pipeline:
//   elicit (interview) -> ground (catalogs + firm history) -> generate -> CPM -> evaluate -> analyze/monitor
// Everything here is plain data so it can be stored as JSON, sent to the browser, and unit tested.

/* ─── Calendars ──────────────────────────────────────── */

/** 0 = Sunday … 6 = Saturday */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface WorkCalendar {
  id: string
  name: string
  workDays: Weekday[]
  hoursPerDay: number
  /** ISO dates (yyyy-mm-dd) that are non-work days even if they fall on a workDay */
  holidays: string[]
  /** ISO dates that are work days even if they fall outside workDays (P6 exceptions) */
  extraWorkDays?: string[]
  /** Canonical label after semantic normalization, e.g. "5-day x 8h" */
  canonical?: string
  /** Original label as written in the source file */
  sourceName?: string
}

/* ─── CPM ────────────────────────────────────────────── */

export type LinkType = 'FS' | 'SS' | 'FF' | 'SF'
/**
 * SNET/SNLT/FNET/FNLT: one-sided date limits. SO/FO: P6 "Start On" / "Finish On" (no earlier AND no
 * later than the date; logic still drives the early dates, so a late predecessor shows negative
 * float). MSO/MFO: mandatory dates that override logic (P6 Mandatory Start/Finish, MS Project
 * Must Start/Finish On); the logic they overrule is reported as a constraint violation.
 */
export type ConstraintType = 'SNET' | 'SNLT' | 'FNET' | 'FNLT' | 'SO' | 'FO' | 'MSO' | 'MFO'
export const CONSTRAINT_TYPES: readonly ConstraintType[] = ['SNET', 'SNLT', 'FNET', 'FNLT', 'SO', 'FO', 'MSO', 'MFO']
/** P6 milestone type: start (TT_Mile) or finish (TT_FinMile). */
export type MilestoneKind = 'start' | 'finish'
/** Out-of-sequence progress: P6 Retained Logic (default) or Progress Override. */
export type ProgressMode = 'retained' | 'override'

export interface CpmActivity {
  id: string
  code: string
  name: string
  /** Original duration in work days on the activity's calendar. 0 for milestones. */
  duration: number
  /** Remaining work days (defaults to duration). Used when the activity is in progress. */
  remaining?: number
  calendarId?: string
  type: 'task' | 'milestone'
  /**
   * Milestones only: P6 start milestone (TT_Mile, at the start of its day) or finish milestone
   * (TT_FinMile, at the end of its day). When absent, a milestone without predecessors is a start
   * milestone and any other a finish milestone.
   */
  milestoneKind?: MilestoneKind
  constraint?: { type: ConstraintType; date: string }
  actualStart?: string | null
  actualFinish?: string | null
}

export interface CpmLink {
  from: string
  to: string
  type: LinkType
  /** Lag in work days on the predecessor's calendar (P6 default; may be negative = lead) */
  lag: number
}

export interface CpmInput {
  projectStart: string
  /** Status/data date; incomplete work cannot be scheduled before it. Defaults to projectStart. */
  dataDate?: string
  activities: CpmActivity[]
  links: CpmLink[]
  calendars: WorkCalendar[]
  defaultCalendarId?: string
  /** Optional imposed finish date used as the backward-pass anchor */
  mustFinishBy?: string
  /** How in-progress work that started out of sequence is scheduled. Defaults to 'retained' (P6 default). */
  progressMode?: ProgressMode
}

export interface CpmTimes {
  earlyStart: string
  earlyFinish: string
  lateStart: string
  lateFinish: string
  /** Work days on the activity's calendar */
  totalFloat: number
  freeFloat: number
  critical: boolean
}

export interface CpmResult {
  times: Record<string, CpmTimes>
  projectFinish: string
  /** Latest finish logic alone produces (equals projectFinish unless a mandatory constraint pins the end earlier) */
  logicFinish: string
  /** Activity ids of the critical path (total float <= 0), in sequence from start to finish */
  criticalPath: string[]
  /** Activity ids of the longest (driving) path to the project finish, regardless of float */
  longestPath: string[]
  /**
   * Set when the longest path starts at an activity whose date a mandatory constraint (MSO/MFO)
   * sets rather than logic: the path stops there, as in P6.
   */
  longestPathConstraint?: { id: string; type: 'MSO' | 'MFO'; date: string }
  /** The path to logicFinish that logic alone would give (through mandatory constraints) */
  logicLongestPath?: string[]
  /** Mandatory constraints (MSO/MFO) that overrule logic: how many work days logic would push them */
  violations: { id: string; type: 'MSO' | 'MFO'; constraintDate: string; logicDate: string; days: number }[]
  progressMode: ProgressMode
  /** Any cycles found (activity ids). If non-empty, times are best-effort. */
  cycles: string[][]
  warnings: string[]
}

/* ─── Provenance: why the tool believes something ────── */

export type SourceKind = 'user' | 'file' | 'catalog' | 'firm_history' | 'template' | 'model' | 'override' | 'assumption'

export interface SourceRef {
  kind: SourceKind
  label: string
  detail?: string
}

export type Confidence = 'high' | 'medium' | 'low'

export interface Rationale {
  summary: string
  sources: SourceRef[]
  confidence: Confidence
  assumptions?: string[]
}

/* ─── Project classification ─────────────────────────── */

export const PROJECT_TYPES = [
  'commercial_office',
  'healthcare',
  'data_center',
  'k12_school',
  'multifamily',
  'warehouse_industrial',
  'retail',
  'lab_research',
  'federal_defense',
  'highway_bridge',
  'transit_rail',
  'water_wastewater',
  'utility_power',
  'industrial_process',
] as const
export type ProjectType = typeof PROJECT_TYPES[number]

/** Horizontal / infrastructure types: their own networks, permits and long-lead items; sized by construction value, not floor area. */
export const CIVIL_PROJECT_TYPES: readonly ProjectType[] = ['highway_bridge', 'transit_rail', 'water_wastewater', 'utility_power', 'industrial_process']
export const isCivilType = (t: string | null | undefined): boolean => !!t && (CIVIL_PROJECT_TYPES as readonly string[]).includes(t)
export const isProjectType = (t: unknown): t is ProjectType => typeof t === 'string' && (PROJECT_TYPES as readonly string[]).includes(t)
/**
 * Validation message for an optional project type from an API body or form (null when absent or valid).
 * An unknown type is refused: planning it as a generic building, or dropping it, gave the wrong network.
 */
export function projectTypeError(t: unknown): string | null {
  if (t === undefined || t === null || t === '') return null
  return isProjectType(t) ? null : `Unknown projectType “${String(t).slice(0, 60)}”. Valid types: ${PROJECT_TYPES.join(', ')}.`
}

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  commercial_office: 'Commercial office',
  healthcare: 'Healthcare / hospital',
  data_center: 'Data center',
  k12_school: 'K-12 school',
  multifamily: 'Multifamily residential',
  warehouse_industrial: 'Warehouse / industrial',
  retail: 'Retail',
  lab_research: 'Laboratory / research',
  federal_defense: 'Federal / defense facility',
  highway_bridge: 'Highway / bridge',
  transit_rail: 'Transit / rail',
  water_wastewater: 'Water / wastewater (plant, pump station, pipeline)',
  utility_power: 'Power / substation / transmission',
  industrial_process: 'Industrial / process plant',
}

export type WorkScope = 'new_construction' | 'renovation' | 'renovation_occupied' | 'addition'
export type DeliveryMethod = 'dbb' | 'db' | 'cmar' | 'ipd'
export type Classification = 'unclassified' | 'cui' | 'classified'

/** Context used by catalogs to decide what applies. Built from interview answers. */
export interface ProjectProfile {
  projectType?: ProjectType
  state?: string          // USPS code, e.g. "CA"
  city?: string
  grossSqft?: number
  stories?: number
  scope?: WorkScope
  siteAcresDisturbed?: number
  isFederal?: boolean
  /**
   * Work is on a federal installation or federal property with controlled access (a base, a federal
   * campus). Federal funding alone does not make it so: a federal-aid highway bridge is not on a base.
   */
  onFederalInstallation?: boolean
  classification?: Classification
  deliveryMethod?: DeliveryMethod
  /** Civil types: construction value in USD millions (their size measure instead of floor area) */
  valueMusd?: number
}

/* ─── Knowledge catalogs (grounding) ─────────────────── */

export interface DurationRange { low: number; typical: number; high: number }

export interface Applicability {
  projectTypes?: ProjectType[] | 'all'
  scopes?: WorkScope[]
  minSqft?: number
  minStories?: number
  minAcresDisturbed?: number
  federalOnly?: boolean
  nonFederalOnly?: boolean
  /** Only on a federal installation / federal property (base access, installation work clearance) */
  federalInstallationOnly?: boolean
  /**
   * Also applies to civil/infrastructure project types. Without it, an item that does not list the
   * civil type explicitly is treated as building-only and does not apply to bridges, plants, etc.
   */
  civil?: boolean
}

export interface PermitSpec {
  id: string
  name: string
  authority: string
  jurisdiction: 'federal' | 'state' | 'local'
  appliesWhen: Applicability
  /** Typical review/approval time in calendar weeks */
  reviewWeeks: DurationRange
  /** Canonical category that cannot start until this permit is issued */
  gates: CanonicalCategory
  /** What must exist before you can submit, e.g. "design_cd" */
  submitAfter: CanonicalCategory
  source: string
  notes?: string
}

export interface RegulationSpec {
  id: string
  name: string
  appliesWhen: Applicability
  scheduleImpact: string
  /** Optional extra activity the generator should add */
  addsActivity?: {
    name: string; category: CanonicalCategory; days: DurationRange; after: CanonicalCategory; before?: CanonicalCategory
    /** Tried in order when `before` is not part of this project's network (e.g. civil types have no steel erection) */
    beforeAlternatives?: CanonicalCategory[]
  }
  source: string
}

export interface RegionSpec {
  code: string            // "CA", "US-DEFAULT"
  name: string
  permits: PermitSpec[]
  regulations: RegulationSpec[]
  climate: {
    /** Months (1-12) where exterior/earthwork productivity drops */
    adverseMonths: number[]
    adverseNote: string
    /** Typical weather days per adverse month */
    weatherDaysPerAdverseMonth: number
  }
}

export interface LongLeadSpec {
  id: string
  name: string
  appliesWhen: Applicability
  /** Fabrication + delivery after approved submittal, calendar weeks */
  leadWeeks: DurationRange
  /** Submittal prep + review, calendar weeks */
  submittalWeeks: number
  /** Installation activity category this item gates */
  gates: CanonicalCategory
  /**
   * More specific installation activities, used when the project's network has one (e.g. a data
   * center's generator set-in instead of generic permanent power). Falls back to `gates`.
   */
  installsIn?: CanonicalCategory[]
  source: string
  notes?: string
}

export interface TemplateActivity {
  category: CanonicalCategory
  name: string
  phase: Phase
  appliesWhen: Applicability
  /** Work days = base + perKsf * (sqft/1000) + perStory * stories, clamped to [min,max] */
  duration: { base: number; perKsf?: number; perStory?: number; min: number; max: number }
  preds: { category: CanonicalCategory; type: LinkType; lag: number }[]
  milestone?: boolean
  note?: string
}

/* ─── Semantic taxonomy ──────────────────────────────── */

export const PHASES = ['preconstruction', 'design', 'permitting', 'procurement', 'sitework', 'structure', 'envelope', 'mep', 'interiors', 'commissioning', 'closeout'] as const
export type Phase = typeof PHASES[number]

export const CANONICAL_CATEGORIES = [
  'ntp', 'design_sd', 'design_dd', 'design_cd', 'design_review',
  'permit_site', 'permit_building', 'permit_other',
  'submittals', 'procurement',
  'mobilization', 'demolition', 'abatement', 'earthwork', 'utilities_site', 'deep_foundations', 'foundations',
  'slab_on_grade', 'structure_steel', 'structure_concrete', 'structure_wood', 'roofing', 'exterior_skin', 'windows_curtainwall', 'dry_in',
  'mep_rough', 'electrical_service', 'mechanical_equipment', 'elevators', 'fire_protection', 'low_voltage',
  'framing_drywall', 'finishes', 'specialties', 'paving_landscape',
  'commissioning', 'inspections', 'punchlist', 'substantial_completion', 'closeout', 'final_completion',
  // Civil / infrastructure work
  'row_utilities', 'traffic_control', 'in_water_work', 'substructure', 'superstructure', 'deck', 'roadway', 'drainage',
  'pipeline', 'process_structures', 'process_equipment', 'power_equipment', 'controls_scada', 'track_systems', 'conductors',
  'startup_testing', 'cutover',
  'contingency', 'other',
] as const
export type CanonicalCategory = typeof CANONICAL_CATEGORIES[number]

export interface Classified {
  category: CanonicalCategory
  phase: Phase
  confidence: number     // 0..1
  matched?: string       // keyword/rule that matched
}

/* ─── Elicitation (interview) ────────────────────────── */

export type AnswerStatus = 'known' | 'unknown' | 'withheld'
export type AnswerValue = string | number | boolean | string[]

export interface Answer {
  status: AnswerStatus
  value?: AnswerValue
  note?: string
  answeredAt: string
  /** Who supplied it: the user directly, or inferred from an uploaded file */
  source?: 'user' | 'file'
  /** The user typed their own answer instead of picking a listed option */
  custom?: boolean
}

export type QuestionKind = 'choice' | 'multi' | 'number' | 'date' | 'text' | 'boolean'
export type QuestionSection = 'project' | 'design' | 'permits' | 'procurement' | 'site' | 'regulatory' | 'calendar' | 'security' | 'history' | 'milestones' | 'cost'

export interface Question {
  id: string
  section: QuestionSection
  prompt: string
  /** Why a senior scheduler asks this — what it changes in the schedule */
  why: string
  kind: QuestionKind
  options?: { value: string; label: string }[]
  unit?: string
  /** 1-100: how much the answer can move the finish date or logic */
  impact: number
  allowWithheld: boolean
  groundedBy?: SourceRef[]
  /** Default used if the user says "I don't know" */
  fallback?: { value: AnswerValue; explanation: string }
  /** Choice questions: the user may type an answer that is not listed */
  allowOther?: boolean
  /** Label for the free-text box, e.g. "Enter your country and state or location" */
  otherPrompt?: string
}

export interface Assumption {
  questionId: string
  text: string
  /** Extra schedule contingency (work days) added because this is unknown/withheld */
  bufferDays: number
  kind: 'unknown' | 'withheld' | 'inferred' | 'custom'
}

export interface InterviewState {
  answers: Record<string, Answer>
}

export interface ElicitationResult {
  /** Open questions, highest impact first */
  questions: Question[]
  /** 0-100: how complete the brief is, weighted by impact */
  readiness: number
  assumptions: Assumption[]
  profile: ProjectProfile
  /** Warnings where answers contradict each other or catalog data */
  conflicts: string[]
  /** Date-sequence problems among the answers, tied to the questions involved */
  dateIssues?: { questionIds: string[]; text: string; severity: 'error' | 'warning' }[]
}

/* ─── Generated schedule ─────────────────────────────── */

export interface Override {
  field: 'duration' | 'remove' | 'lag' | 'type' | 'add_link' | 'remove_link' | 'name'
  from?: unknown
  to?: unknown
  reason: string
  by: string
  at: string
}

export interface PlanActivity extends CpmActivity {
  category: CanonicalCategory
  phase: Phase
  rationale: Rationale
  /** Source WBS path ("1.2.3 Name") for uploaded schedules; exports rebuild this hierarchy */
  wbs?: string
  /** Progress carried from an uploaded update */
  status?: 'not_started' | 'in_progress' | 'complete'
  percentComplete?: number
  baselineStart?: string | null
  baselineFinish?: string | null
  /** Placeholder for a withheld/classified constraint */
  placeholder?: boolean
  overrides?: Override[]
}

export interface PlanLink extends CpmLink {
  id: string
  rationale: Rationale
  overrides?: Override[]
}

export interface GeneratedSchedule {
  generatedAt: string
  projectStart: string
  /** Status date for progressed (uploaded) schedules */
  dataDate?: string
  /** Owner-required completion; the backward pass anchors here so float can go negative */
  mustFinishBy?: string
  calendars: WorkCalendar[]
  defaultCalendarId: string
  activities: PlanActivity[]
  links: PlanLink[]
  assumptions: Assumption[]
  /** Activities/links the scheduler deleted; kept so regeneration doesn't bring them back */
  removed?: { id: string; kind: 'activity' | 'link'; name: string; override: Override }[]
  /** Regional notes the scheduler should see (climate, AHJ verification reminders) */
  notes?: string[]
  /** Answers the team qualified in their own words ("issued, but only for foundations") */
  qualifications?: { questionId: string; prompt: string; answer: string; note: string; activityIds: string[] }[]
  /** Owner/contract milestone targets from the interview, with the plan's forecast against each */
  milestoneTargets?: { key: string; label: string; target: string; activityId: string }[]
  cpm?: CpmResult
}

/* ─── Analysis ───────────────────────────────────────── */

/** Minimal activity shape shared by uploaded (db.Activity) and generated schedules */
export interface AnalyzableActivity {
  id: string
  code: string
  name: string
  type: 'task' | 'milestone' | 'loe' | 'summary'
  duration: number
  remaining?: number
  percentComplete?: number
  status?: 'not_started' | 'in_progress' | 'complete'
  calendarId?: string | null
  earlyStart?: string | null
  earlyFinish?: string | null
  lateStart?: string | null
  lateFinish?: string | null
  actualStart?: string | null
  actualFinish?: string | null
  baselineStart?: string | null
  baselineFinish?: string | null
  totalFloat?: number | null
  constraint?: { type: ConstraintType | string; date?: string | null } | null
  /** Milestones: P6 start (TT_Mile) or finish (TT_FinMile) milestone, when the source says */
  milestoneKind?: MilestoneKind | null
  resourceCount?: number
}

export interface AnalyzableSchedule {
  dataDate?: string | null
  projectStart?: string | null
  projectFinish?: string | null
  activities: AnalyzableActivity[]
  links: CpmLink[]
  calendars: WorkCalendar[]
  defaultCalendarId?: string | null
  /** Required finish (P6 Must Finish By); a target for the finish milestone in CPLI */
  mustFinishBy?: string | null
  /** Contract/finish milestone the scheduler designated (activity id or code) */
  finishMilestoneId?: string | null
}

export type CheckResult = 'pass' | 'fail' | 'warn' | 'n/a'

export interface DcmaCheck {
  id: number          // 1..14
  name: string
  metric: string      // e.g. "3.2%"
  threshold: string   // e.g. "≤ 5%"
  result: CheckResult
  offenders: string[] // activity codes (every offender, de-duplicated)
  explanation: string
}

export interface DcmaReport {
  checks: DcmaCheck[]
  passed: number
  applicable: number
  score: number       // 0-100
}

export type Severity = 'info' | 'warning' | 'error'

/** A question the tool asks about the DATA, not the user */
export interface DataQuestion {
  id: string
  severity: Severity
  rule: string
  activityCodes: string[]
  question: string
  detail: string
}
