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
export type ConstraintType = 'SNET' | 'SNLT' | 'FNET' | 'FNLT' | 'MSO' | 'MFO'

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
  constraint?: { type: ConstraintType; date: string }
  actualStart?: string | null
  actualFinish?: string | null
}

export interface CpmLink {
  from: string
  to: string
  type: LinkType
  /** Lag in work days on the successor's calendar (may be negative = lead) */
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
  /** Activity ids of the longest path, in sequence from start to finish */
  criticalPath: string[]
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
] as const
export type ProjectType = typeof PROJECT_TYPES[number]

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
  classification?: Classification
  deliveryMethod?: DeliveryMethod
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
  addsActivity?: { name: string; category: CanonicalCategory; days: DurationRange; after: CanonicalCategory; before?: CanonicalCategory }
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
}

export type QuestionKind = 'choice' | 'multi' | 'number' | 'date' | 'text' | 'boolean'
export type QuestionSection = 'project' | 'design' | 'permits' | 'procurement' | 'site' | 'regulatory' | 'calendar' | 'security' | 'history'

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
}

export interface Assumption {
  questionId: string
  text: string
  /** Extra schedule contingency (work days) added because this is unknown/withheld */
  bufferDays: number
  kind: 'unknown' | 'withheld' | 'inferred'
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
}

export type CheckResult = 'pass' | 'fail' | 'warn' | 'n/a'

export interface DcmaCheck {
  id: number          // 1..14
  name: string
  metric: string      // e.g. "3.2%"
  threshold: string   // e.g. "≤ 5%"
  result: CheckResult
  offenders: string[] // activity codes (capped)
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
