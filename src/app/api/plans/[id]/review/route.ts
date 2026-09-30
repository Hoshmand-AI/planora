import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuid } from 'uuid'
import { savePlan, type ExpertReview } from '@/lib/db'
import { loadPlanContext, planView } from '../context'

const VERDICTS: ExpertReview['verdict'][] = ['approve', 'approve_with_comments', 'reject']

/** Record an expert (senior scheduler) review of the current version. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadPlanContext(params.id)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })
  const { plan, ctx } = r
  if (!plan.generated) return NextResponse.json({ error: 'Generate the schedule first.' }, { status: 400 })
  const body = await req.json().catch(() => ({}))
  if (!VERDICTS.includes(body.verdict)) return NextResponse.json({ error: 'verdict must be approve, approve_with_comments or reject' }, { status: 400 })
  const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 4000) : ''
  if (body.verdict !== 'approve' && !comment) return NextResponse.json({ error: 'Add a comment explaining what should change.' }, { status: 400 })
  const review: ExpertReview = {
    id: uuid(), reviewer: typeof body.reviewer === 'string' && body.reviewer.trim() ? `${body.reviewer.trim().slice(0, 120)} (entered by ${ctx.name})` : ctx.name,
    verdict: body.verdict, comment, at: new Date().toISOString(),
    activityNotes: body.activityNotes && typeof body.activityNotes === 'object' ? body.activityNotes : undefined,
  }
  plan.reviews = [...plan.reviews, review]
  plan.audit.push({ at: review.at, by: ctx.name, action: 'review', detail: `${review.verdict}: ${comment.slice(0, 200)}` })
  const saved = await savePlan(plan)
  return NextResponse.json(await planView(saved, ctx.orgId))
}
