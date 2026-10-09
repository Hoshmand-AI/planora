import { DEFAULT_DCMA_RULES, normalizeDcmaRules, type DcmaRules } from '@/lib/analysis/dcma'
import { DEFAULT_STANDARDS_SETTINGS, normalizeStandardsSettings, type StandardsSettings } from '@/lib/standards/config'

// Organization-level policy, editable by admins. Stored as JSON on the organization; always read
// through normalizeSettings so missing or invalid values fall back to safe defaults.

export interface OrgSettings {
  /** Every member must enroll in two-step verification before using the app. */
  requireMfa: boolean
  /** The person who built a plan cannot record the approving review on it (separation of duties). */
  requireIndependentReview: boolean
  /** Publishing a baseline requires an approving review by someone other than the plan's author. */
  requireApprovalToPublish: boolean
  /** Allow AI features at all for this organization (off = rules-only, nothing sent to any model). */
  aiEnabled: boolean
  /** Maximum AI requests per organization per UTC day. */
  aiDailyLimit: number
  /** Sign members out after this many hours without activity. */
  sessionIdleHours: number
  /** Delete Ask AI conversation history older than this many days (0 = keep until deleted). */
  chatRetentionDays: number
  /** Delete plans and uploaded schedules not changed in this many days (0 = keep until deleted). */
  projectRetentionDays: number
  /** Quality-check thresholds (DCMA 14-point), defaulting to the published values */
  quality: DcmaRules
  /** Never use this organization's uploaded schedules to calibrate firm history */
  historyExcludeUploads: boolean
  /** Standards engine: default framework(s) and GAO screening thresholds (src/lib/standards) */
  standards: StandardsSettings
}

export const DEFAULT_SETTINGS: OrgSettings = {
  requireMfa: false,
  requireIndependentReview: false,
  requireApprovalToPublish: false,
  aiEnabled: true,
  aiDailyLimit: Number(process.env.PLANORA_AI_DAILY_LIMIT) || 300,
  sessionIdleHours: 12,
  chatRetentionDays: 365,
  projectRetentionDays: 0,
  quality: DEFAULT_DCMA_RULES,
  historyExcludeUploads: false,
  standards: DEFAULT_STANDARDS_SETTINGS,
}

/**
 * Written onto every organization created from now on. Cloud AI (OpenAI as a subprocessor) is
 * opt-in: a new organization starts rules-only until an admin turns AI on in Organization settings.
 * Organizations created before this default changed have no stored aiEnabled value and keep
 * DEFAULT_SETTINGS.aiEnabled (on), so their behavior doesn't change underneath them.
 */
export const NEW_ORGANIZATION_SETTINGS: Partial<OrgSettings> = { aiEnabled: false }

const clamp = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d
}

export function normalizeSettings(raw: unknown): OrgSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const b = (k: keyof OrgSettings) => typeof r[k] === 'boolean' ? r[k] as boolean : DEFAULT_SETTINGS[k] as unknown as boolean
  return {
    requireMfa: b('requireMfa'),
    requireIndependentReview: b('requireIndependentReview'),
    requireApprovalToPublish: b('requireApprovalToPublish'),
    aiEnabled: b('aiEnabled'),
    aiDailyLimit: clamp(r.aiDailyLimit, 0, 10_000, DEFAULT_SETTINGS.aiDailyLimit),
    sessionIdleHours: clamp(r.sessionIdleHours, 1, 24, DEFAULT_SETTINGS.sessionIdleHours),
    chatRetentionDays: clamp(r.chatRetentionDays, 0, 3650, DEFAULT_SETTINGS.chatRetentionDays),
    projectRetentionDays: clamp(r.projectRetentionDays, 0, 3650, DEFAULT_SETTINGS.projectRetentionDays),
    quality: normalizeDcmaRules(r.quality),
    historyExcludeUploads: b('historyExcludeUploads'),
    standards: normalizeStandardsSettings(r.standards),
  }
}
