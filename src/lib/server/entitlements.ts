// Subscription plans and what each includes. Enforced on the server (uploads, AI, reports,
// exports, SSO, integrations); the pricing page and the Organization page read the same table, so what is sold
// and what is enforced cannot drift apart.

import { ApiError } from './api'

export const PLAN_IDS = ['free', 'pro', 'enterprise'] as const
export type PlanId = typeof PLAN_IDS[number]

export interface Entitlements {
  label: string
  /** Uploaded (not generated) schedules the organization can keep; null = unlimited */
  maxUploadedSchedules: number | null
  /** Ceiling on AI requests per organization per day (the admin's own limit can be lower) */
  aiPerDay: number
  reports: string[]
  exports: string[]
  sso: boolean
  /** API keys and outbound webhooks */
  integrations: boolean
  /** Monte Carlo schedule risk analysis */
  sra: boolean
}

const ALL_REPORTS = ['executive_summary', 'critical_path', 'variance', 'qa_qc']
const ALL_EXPORTS = ['xer', 'xml', 'pdf', 'xlsx-p6', 'xlsx-import', 'csv', 'md']

export const PLANS: Record<PlanId, Entitlements> = {
  free: { label: 'Free', maxUploadedSchedules: 3, aiPerDay: 10, reports: ['executive_summary'], exports: ['xer', 'xml', 'csv', 'md'], sso: false, integrations: false, sra: false },
  pro: { label: 'Pro', maxUploadedSchedules: null, aiPerDay: 1000, reports: ALL_REPORTS, exports: ALL_EXPORTS, sso: false, integrations: true, sra: true },
  enterprise: { label: 'Enterprise', maxUploadedSchedules: null, aiPerDay: 10_000, reports: ALL_REPORTS, exports: ALL_EXPORTS, sso: true, integrations: true, sra: true },
}

export const isPlanId = (p: unknown): p is PlanId => typeof p === 'string' && (PLAN_IDS as readonly string[]).includes(p)
export const entitlementsFor = (plan: string | null | undefined): Entitlements => PLANS[isPlanId(plan) ? plan : 'free']

/** Plan for organizations created from now on (existing ones were grandfathered to Pro). */
export const defaultPlan = (): PlanId => isPlanId(process.env.PLANORA_DEFAULT_PLAN) ? process.env.PLANORA_DEFAULT_PLAN as PlanId : 'free'

export function requireFeature(plan: string, ok: boolean, what: string): void {
  if (!ok) throw new ApiError(402, `${what} isn't included in the ${entitlementsFor(plan).label} plan. Upgrade to use it (Organization → Plan).`, 'plan_limit', { plan })
}
