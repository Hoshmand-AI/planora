// Reviewer workflow for uploaded submissions (owner-side / forensic review of a contractor's
// schedule): a disposition per DCMA finding and per data question, and an overall disposition of the
// submission. Stored in review_dispositions / submission_reviews (migration 8), recorded with
// plan.review permission (reviewer, admin, owner), audited, shown on the Quality page and printed in
// the QA/QC report. Pure validation and text, so it is unit tested.

import { fmtDate, fmtDates } from '@/lib/format'

export const FINDING_DISPOSITIONS = ['accepted', 'exception', 'needs_revision'] as const
export type FindingDisposition = typeof FINDING_DISPOSITIONS[number]
export const SUBMISSION_DISPOSITIONS = ['approved', 'approved_as_noted', 'revise_and_resubmit'] as const
export type SubmissionDisposition = typeof SUBMISSION_DISPOSITIONS[number]

export const FINDING_LABELS: Record<FindingDisposition, string> = { accepted: 'Accepted', exception: 'Exception (justified)', needs_revision: 'Needs revision' }
export const SUBMISSION_LABELS: Record<SubmissionDisposition, string> = { approved: 'Approved', approved_as_noted: 'Approved as noted', revise_and_resubmit: 'Revise and resubmit' }

export interface ItemDisposition { itemId: string; disposition: FindingDisposition; justification: string | null; userId: string | null; reviewer: string | null; createdAt: string }
export interface SubmissionReview { disposition: SubmissionDisposition; comments: string | null; userId: string | null; reviewer: string | null; createdAt: string }
export interface ReviewState { items: ItemDisposition[]; submission: SubmissionReview | null }

const MAX_TEXT = 2000
const MIN_JUSTIFICATION = 10

export type ReviewInput =
  | { kind: 'item'; itemId: string; disposition: FindingDisposition; justification: string | null }
  | { kind: 'submission'; disposition: SubmissionDisposition; comments: string | null }

/**
 * Validates a POST body. Item ids are 'dcma:<1-14>' or a data question id. An exception needs a
 * justification; "approved as noted" and "revise and resubmit" need comments.
 */
export function parseReviewInput(body: unknown): { ok: true; value: ReviewInput } | { ok: false; error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, MAX_TEXT) : null)
  if (b.submission !== undefined) {
    const d = b.submission
    if (!SUBMISSION_DISPOSITIONS.includes(d as SubmissionDisposition)) return { ok: false, error: `submission must be one of ${SUBMISSION_DISPOSITIONS.join(', ')}.` }
    const comments = text(b.comments)
    if (d !== 'approved' && !comments) return { ok: false, error: `"${SUBMISSION_LABELS[d as SubmissionDisposition]}" needs comments that say what to note or revise.` }
    return { ok: true, value: { kind: 'submission', disposition: d as SubmissionDisposition, comments } }
  }
  const itemId = typeof b.itemId === 'string' ? b.itemId.trim() : ''
  if (!itemId || itemId.length > 200) return { ok: false, error: 'itemId (a DCMA finding such as "dcma:6" or a data question id) is required.' }
  const m = /^dcma:(\d+)$/.exec(itemId)
  if (itemId.startsWith('dcma:') && (!m || Number(m[1]) < 1 || Number(m[1]) > 14)) return { ok: false, error: 'DCMA findings are dcma:1 to dcma:14.' }
  if (!FINDING_DISPOSITIONS.includes(b.disposition as FindingDisposition)) return { ok: false, error: `disposition must be one of ${FINDING_DISPOSITIONS.join(', ')}.` }
  const justification = text(b.justification)
  if (b.disposition === 'exception' && (!justification || justification.length < MIN_JUSTIFICATION)) return { ok: false, error: `An exception needs a justification (at least ${MIN_JUSTIFICATION} characters).` }
  return { ok: true, value: { kind: 'item', itemId, disposition: b.disposition as FindingDisposition, justification } }
}

/** QA/QC report section: the overall disposition and every recorded finding / question disposition. */
export function reviewMarkdown(
  review: ReviewState | null | undefined,
  labels: { dcma: { id: number; name: string; result: string }[]; questions: { id: string; question: string }[] },
): string[] {
  const cell = (v: unknown) => String(v ?? '—').replace(/\|/g, '/').replace(/\s+/g, ' ')
  if (!review || (!review.submission && !review.items.length)) return ['_No reviewer disposition recorded yet._']
  const out: string[] = []
  const s = review.submission
  out.push(s
    ? `**Submission disposition: ${SUBMISSION_LABELS[s.disposition]}** — ${s.reviewer ?? 'reviewer'}, ${fmtDate(s.createdAt)}.${s.comments ? ` Comments: ${fmtDates(s.comments)}` : ''}`
    : '_No overall submission disposition recorded yet._')
  out.push('')
  const what = (id: string) => {
    const m = /^dcma:(\d+)$/.exec(id)
    if (m) { const c = labels.dcma.find(x => x.id === Number(m[1])); return c ? `DCMA #${c.id} ${c.name} (${c.result.toUpperCase()})` : `DCMA #${m[1]}` }
    const q = labels.questions.find(x => x.id === id)
    return q ? `Data question: ${fmtDates(q.question)}` : `Data question ${id} (no longer raised)`
  }
  const rows = [...review.items].sort((a, b) => (a.itemId.startsWith('dcma:') ? 0 : 1) - (b.itemId.startsWith('dcma:') ? 0 : 1) || a.itemId.localeCompare(b.itemId, undefined, { numeric: true }))
  if (rows.length) {
    out.push('| Finding / question | Disposition | Justification | Reviewer | Date |', '|---|---|---|---|---|')
    for (const r of rows) out.push(`| ${[what(r.itemId), FINDING_LABELS[r.disposition], r.justification ? fmtDates(r.justification) : '—', r.reviewer ?? '—', fmtDate(r.createdAt)].map(cell).join(' | ')} |`)
  }
  const openFail = labels.dcma.filter(c => c.result === 'fail' && !review.items.some(r => r.itemId === `dcma:${c.id}`))
  if (openFail.length) out.push('', `Failing checks without a disposition: ${openFail.map(c => `#${c.id}`).join(', ')}.`)
  return out
}
