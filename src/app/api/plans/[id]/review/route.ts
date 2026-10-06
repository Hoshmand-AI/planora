import { NextResponse } from 'next/server'
import { api } from '@/lib/server/api'
import { randomUUID as uuid } from 'crypto'
import { savePlan, type ExpertReview } from '@/lib/db'
import { scheduleFingerprint, type FingerprintedReview } from '@/lib/server/approval'
import { loadPlanContext, planView } from '../context'

const VERDICTS: ExpertReview['verdict'][] = ['approve', 'approve_with_comments', 'reject']

/** Record an expert (senior scheduler) review of the current version. */
export const POST = api<{ id: string }>({ permission: 'plan.review' }, async (req, { params, auth }) => {
  const r = await loadPlanContext(req, params.id, auth)
  const { plan, ctx } = r
  if (!plan.generated) return NextResponse.json({ error: 'Generate the schedule first.' }, { status: 400 })
  const body = await req.json().catch(() => ({}))
  if (!VERDICTS.includes(body.verdict)) return NextResponse.json({ error: 'verdict must be approve, approve_with_comments or reject' }, { status: 400 })
  if (body.verdict !== 'reject' && ctx.settings.requireIndependentReview && plan.userId === ctx.userId) {
    return NextResponse.json({ error: 'Your organization requires an independent review: the person who created this plan cannot approve it. Ask a reviewer or admin.', code: 'self_review' }, { status: 403 })
  }
  const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 4000) : ''
  if (body.verdict !== 'approve' && !comment) return NextResponse.json({ error: 'Add a comment explaining what should change.' }, { status: 400 })
  const review: FingerprintedReview = {
    id: uuid(), reviewer: typeof body.reviewer === 'string' && body.reviewer.trim() ? `${body.reviewer.trim().slice(0, 120)} (entered by ${ctx.name})` : ctx.name,
    verdict: body.verdict, comment, at: new Date().toISOString(), reviewerUserId: ctx.userId, generatedAt: plan.generated.generatedAt,
    // Binds the review to the exact schedule content reviewed (see src/lib/server/approval.ts).
    scheduleFingerprint: scheduleFingerprint(plan.generated) ?? undefined,
    activityNotes: body.activityNotes && typeof body.activityNotes === 'object' ? body.activityNotes : undefined,
  }
  plan.reviews = [...plan.reviews, review]
  plan.audit.push({ at: review.at, by: ctx.name, action: 'review', detail: `${review.verdict}: ${comment.slice(0, 200)}` })
  const saved = await savePlan(plan)
  return NextResponse.json(await planView(saved, ctx.orgId))
})
