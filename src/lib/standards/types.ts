// Standards rules engine: shared types.
//
// A Rule is a deterministic check with provenance metadata (which framework and edition it comes
// from, what kind of source that is, where in that source it is discussed). Rules never contain
// text copied from a published standard: `sourceReference` is a citation only, and titles, messages
// and recommendations are Planora's own short paraphrases.
//
// Kind taxonomy (what the source IS, not how strict Planora is about it):
//   standard_guidance     published guidance on what a good schedule looks like (e.g. the GAO guide)
//   assessment_metric     a published numeric test used to assess schedules (e.g. the DCMA 14-point)
//   recommended_practice  a practice Planora recommends that no cited source prescribes numerically
//   contract_requirement  a requirement from the customer's contract or specification
// Professional credentials (PSP, PMI-SP and the like) are certifications of people, never standards,
// and are never used as a rule's framework or kind.

import type { AnalyzableSchedule, CpmResult } from '@/lib/planning/types'

export const FRAMEWORKS = ['PLANORA_COMPOSITE', 'GAO_SCHEDULE_GUIDE', 'DCMA_14', 'CUSTOMER'] as const
export type Framework = typeof FRAMEWORKS[number]
/** Frameworks a user can run today (CUSTOMER packs are reserved for contract-specific rules). */
export const RUNNABLE_FRAMEWORKS: readonly Framework[] = ['PLANORA_COMPOSITE', 'GAO_SCHEDULE_GUIDE', 'DCMA_14']
export const isFramework = (v: unknown): v is Framework => typeof v === 'string' && (FRAMEWORKS as readonly string[]).includes(v)
export const isRunnableFramework = (v: unknown): v is Framework => typeof v === 'string' && (RUNNABLE_FRAMEWORKS as readonly string[]).includes(v)

export const FRAMEWORK_LABELS: Record<Framework, string> = {
  PLANORA_COMPOSITE: 'Planora Composite',
  GAO_SCHEDULE_GUIDE: 'GAO Schedule Assessment Guide',
  DCMA_14: 'DCMA 14-point assessment',
  CUSTOMER: 'Customer contract requirements',
}

export type RuleKind = 'standard_guidance' | 'assessment_metric' | 'recommended_practice' | 'contract_requirement'
export const RULE_KIND_LABELS: Record<RuleKind, string> = {
  standard_guidance: 'Standard guidance',
  assessment_metric: 'Assessment metric',
  recommended_practice: 'Recommended practice',
  contract_requirement: 'Contract requirement',
}

/** The four characteristics the GAO guide groups its ten best practices under. */
export const CHARACTERISTICS = ['comprehensive', 'well_constructed', 'credible', 'controlled'] as const
export type Characteristic = typeof CHARACTERISTICS[number]
export const CHARACTERISTIC_LABELS: Record<Characteristic, string> = {
  comprehensive: 'Comprehensive',
  well_constructed: 'Well-constructed',
  credible: 'Credible',
  controlled: 'Controlled',
}

export type RuleSeverity = 'high' | 'medium' | 'low'
export type RuleResultStatus = 'pass' | 'fail' | 'warning' | 'not_assessable'

/** Where a threshold value came from. */
export type ThresholdSource = 'published' | 'planora_default' | 'org_configured'

/**
 * A threshold on a named metric. `metricKey` is shared across packs when two packs measure the same
 * thing (e.g. 'float.high_share_pct'), which is how the composite profile detects conflicts.
 */
export interface ThresholdSpec {
  metricKey: string
  value: number
  unit: '%' | 'days' | 'count' | 'index'
  /** 'max' = the metric must not exceed value; 'min' = must be at least value */
  direction: 'max' | 'min'
  source: ThresholdSource
  /** Human-readable form, e.g. "≤ 5%" */
  display: string
}

export interface RuleApplicability {
  /** Subjects this rule can be run on */
  subjects: ('schedule' | 'plan')[]
  /** Data the rule needs; when missing the result is not_assessable with a reason */
  requires?: ('logic' | 'float' | 'resources' | 'data_date' | 'progress' | 'baseline' | 'risk_analysis' | 'wbs')[]
}

/** Rule metadata. Immutable per (ruleId, version): changing logic or defaults means a new version. */
export interface RuleMeta {
  ruleId: string
  version: number
  framework: Framework
  frameworkVersion: string
  kind: RuleKind
  category: string
  /** GAO characteristic (for DCMA rules: the characteristic the composite profile files them under) */
  characteristic?: Characteristic
  /** GAO best practice number 1–10 */
  bestPractice?: number
  severity: RuleSeverity
  applicability: RuleApplicability
  /** Name of the deterministic calculation that produces the result */
  calculation: string
  /** Short, Planora-written title */
  title: string
  /** Short, Planora-written statement of what the rule looks for */
  message: string
  /** Citation only (document, edition, section) — never quoted standard text */
  sourceReference: string
}

export interface RuleOutcome {
  result: RuleResultStatus
  /** The measured value in words, e.g. "3 of 120 (2.5%)" */
  metric: string
  /** Activity codes (or relationship descriptions) behind the result */
  evidence: string[]
  recommendation: string
  /** Why the rule is not assessable, or a note on how the result was reached */
  reason?: string
}

export interface RuleResult extends RuleMeta, Omit<RuleOutcome, 'evidence'> {
  threshold: ThresholdSpec | null
  /** Secondary thresholds the rule depends on (e.g. the day count that defines "high float") */
  parameters: ThresholdSpec[]
  /** First EVIDENCE_LIMIT items (the stored run stays bounded) */
  evidence: string[]
  evidenceTotal: number
}

export const EVIDENCE_LIMIT = 200

/** Everything a rule may read. Built from an uploaded schedule or a generated plan. */
export interface StandardsInput {
  subject: { kind: 'schedule' | 'plan'; id: string; name: string; version?: string | null }
  schedule: AnalyzableSchedule
  /** WBS path (or, for a generated plan, its phase) per activity id */
  wbs?: Record<string, string>
  /** CPM of the network when the caller already has it; otherwise the engine computes one */
  cpm?: CpmResult | null
  /** The baseline the schedule is measured against */
  baseline?: { source: 'baseline_upload' | 'p6_embedded' | 'file' | 'published_plan' | 'none'; label?: string | null } | null
  /** Recorded schedule risk analysis (risk inputs / a run the team recorded); null = none on record */
  riskAnalysis?: { recordedAt: string | null; ranges: number; events: number; commitments?: number; source: string } | null
}

export interface GroupResult {
  key: string
  label: string
  /** 0–100: (pass + ½ warning) / assessed; null when nothing in the group could be assessed */
  score: number | null
  counts: Record<RuleResultStatus, number>
  rules: RuleResult[]
}

export interface ThresholdConflict {
  metricKey: string
  description: string
  sides: { ruleId: string; framework: Framework; threshold: ThresholdSpec; result: RuleResultStatus }[]
  /** How the composite treats it: both findings are reported, each under its own source */
  resolution: string
}

export interface FrameworkResult {
  framework: Framework
  frameworkVersion: string
  label: string
  groupBy: 'characteristic' | 'category'
  groups: GroupResult[]
  counts: Record<RuleResultStatus, number>
  score: number | null
  conflicts: ThresholdConflict[]
  disclaimer: string
}

export interface StandardsRunOutput {
  engineVersion: string
  /** Hash of every rule's metadata and the thresholds in force: equal hashes = same rules */
  rulesVersion: string
  subject: StandardsInput['subject'] & { dataDate: string | null }
  frameworks: FrameworkResult[]
  disclaimer: string
}
