// Separation of duties for publishing: an approval counts only for the exact schedule content that
// was reviewed. Any later change (scheduler override, regeneration, recovery, decision that alters
// the generated schedule) produces a different fingerprint, so the approval goes stale and a fresh
// independent review is required before the version can be published.

import { createHash } from 'crypto'
import type { ExpertReview, Plan } from '@/lib/db'

/** Review as stored on the plan, plus the fingerprint of the schedule it approved. */
export type FingerprintedReview = ExpertReview & { scheduleFingerprint?: string }

/** Deterministic JSON (object keys sorted) so a round trip through Postgres JSONB hashes the same. */
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(x => (x === undefined || typeof x === 'function' ? 'null' : canonical(x))).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).filter(k => o[k] !== undefined && typeof o[k] !== 'function').sort().map(k => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`
}

/** SHA-256 over the generated schedule's full content (activities, logic, overrides, CPM, calendars). */
export function scheduleFingerprint(generated: Plan['generated']): string | null {
  if (!generated) return null
  return createHash('sha256').update(canonical(JSON.parse(JSON.stringify(generated)))).digest('hex')
}

export interface ApprovalState {
  approved: boolean
  /** Latest review of the current content is a rejection */
  rejected: boolean
  /** Reviews that approve some earlier content of this plan but not the current one */
  staleApprovals: number
}

/**
 * Whether the plan's current generated schedule carries an approving review by someone other than
 * its author, and the latest review of that exact content is not a rejection. Reviews recorded
 * before fingerprints existed (no scheduleFingerprint) never count: they cannot prove which content
 * was reviewed.
 */
export function approvalOfCurrentVersion(plan: Pick<Plan, 'generated' | 'reviews' | 'userId'>): ApprovalState {
  const fp = scheduleFingerprint(plan.generated)
  const reviews = plan.reviews as FingerprintedReview[]
  if (!fp) return { approved: false, rejected: false, staleApprovals: 0 }
  const current = reviews.filter(rv => rv.scheduleFingerprint === fp)
  const latest = current[current.length - 1]
  const independent = (rv: FingerprintedReview) => rv.verdict !== 'reject' && !!rv.reviewerUserId && rv.reviewerUserId !== plan.userId
  const approved = current.some(independent)
  const rejected = latest?.verdict === 'reject'
  const staleApprovals = reviews.filter(rv => rv.scheduleFingerprint !== fp && independent(rv)).length
  return { approved: approved && !rejected, rejected, staleApprovals }
}
