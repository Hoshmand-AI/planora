import { describe, expect, it } from 'vitest'
import { approvalOfCurrentVersion, scheduleFingerprint, type FingerprintedReview } from './approval'
import { generateSchedule } from '@/lib/planning/generator'
import { applyEdit } from '@/lib/planning/overrides'
import type { Answer, AnswerValue } from '@/lib/planning/types'
import type { Plan } from '@/lib/db'

const k = (value: AnswerValue): Answer => ({ status: 'known', value, answeredAt: '2026-01-01T00:00:00Z' })
const answers: Record<string, Answer> = {
  'project.type': k('office'), 'project.state': k('VA'), 'project.scope': k('new_construction'), 'project.gross_sqft': k(40000),
  'project.target_start': k('2026-11-02'), 'design.drawings': k(true), 'design.percent': k(100),
}
const AUTHOR = 'u-author', REVIEWER = 'u-reviewer'

function plan(): Pick<Plan, 'generated' | 'reviews' | 'userId'> {
  return { userId: AUTHOR, generated: generateSchedule({ answers, today: '2026-09-30' }), reviews: [] }
}
function review(p: Pick<Plan, 'generated'>, verdict: FingerprintedReview['verdict'], by = REVIEWER): FingerprintedReview {
  return { id: `r-${Math.random()}`, reviewer: by, verdict, comment: verdict === 'approve' ? '' : 'x', at: new Date().toISOString(), reviewerUserId: by, generatedAt: p.generated!.generatedAt, scheduleFingerprint: scheduleFingerprint(p.generated)! }
}

describe('publish approval is bound to the reviewed content (separation of duties)', () => {
  it('fingerprint is stable across a JSONB-style round trip with reordered keys', () => {
    const p = plan()
    const reverseKeys = (v: unknown): unknown => Array.isArray(v) ? v.map(reverseKeys)
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([key, x]) => [key, reverseKeys(x)])) : v
    const reordered = reverseKeys(JSON.parse(JSON.stringify(p.generated))) as Plan['generated']
    expect(scheduleFingerprint(JSON.parse(JSON.stringify(p.generated)))).toBe(scheduleFingerprint(p.generated))
    expect(scheduleFingerprint(reordered)).toBe(scheduleFingerprint(p.generated))
  })

  it('an independent approval of the current content allows publishing', () => {
    const p = plan()
    p.reviews = [review(p, 'approve')]
    expect(approvalOfCurrentVersion(p).approved).toBe(true)
  })

  it('an edit after approval invalidates it, even though generatedAt is unchanged', () => {
    const p = plan()
    p.reviews = [review(p, 'approve')]
    const act = p.generated!.activities.find(a => a.duration > 1)!
    const before = p.generated!.generatedAt
    p.generated = applyEdit(p.generated!, { kind: 'duration', activityId: act.id, value: act.duration + 5, reason: 'Sub says longer' }, 'Author').schedule
    expect(p.generated.generatedAt).toBe(before)
    const state = approvalOfCurrentVersion(p)
    expect(state.approved).toBe(false)
    expect(state.staleApprovals).toBe(1)
    // A fresh independent review of the edited content restores it.
    p.reviews = [...p.reviews, review(p, 'approve_with_comments')]
    expect(approvalOfCurrentVersion(p).approved).toBe(true)
  })

  it('a rename alone also invalidates the approval', () => {
    const p = plan()
    p.reviews = [review(p, 'approve')]
    const act = p.generated!.activities[0]
    p.generated = applyEdit(p.generated!, { kind: 'rename', activityId: act.id, value: `${act.name} (revised)`, reason: 'Clarify' }, 'Author').schedule
    expect(approvalOfCurrentVersion(p).approved).toBe(false)
  })

  it('self-approval, legacy reviews without a fingerprint, and a later rejection do not count', () => {
    const p = plan()
    p.reviews = [review(p, 'approve', AUTHOR)]
    expect(approvalOfCurrentVersion(p).approved).toBe(false)
    const { scheduleFingerprint: _fp, ...legacy } = review(p, 'approve')
    p.reviews = [legacy]
    expect(approvalOfCurrentVersion(p).approved).toBe(false)
    p.reviews = [review(p, 'approve'), review(p, 'reject', 'u-other')]
    expect(approvalOfCurrentVersion(p)).toMatchObject({ approved: false, rejected: true })
  })
})
