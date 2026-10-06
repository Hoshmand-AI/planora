import { NextResponse } from 'next/server'
import { api } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { getReviewState, getScheduleById, saveReviewDisposition, saveSubmissionReview } from '@/lib/db'
import { parseReviewInput } from '@/lib/analysis/review'

/** The reviewer dispositions recorded on an uploaded submission. */
export const GET = api<{ id: string }>({ permission: 'read', apiKey: true }, async (_req, { params, auth }) => {
  const schedule = await getScheduleById(params.id, auth.orgId)
  if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ review: await getReviewState(schedule.id, auth.orgId) })
})

/**
 * Record a reviewer disposition (reviewer, admin or owner):
 *   { itemId: 'dcma:6' | <data question id>, disposition: accepted | exception | needs_revision, justification? }
 *   { submission: approved | approved_as_noted | revise_and_resubmit, comments? }
 * An exception needs a justification; "approved as noted" and "revise and resubmit" need comments.
 */
export const POST = api<{ id: string }>({ permission: 'plan.review' }, async (req, { params, auth }) => {
  const schedule = await getScheduleById(params.id, auth.orgId)
  if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (schedule.sourceType === 'generated') return NextResponse.json({ error: 'Planora-built schedules are reviewed on the plan (Build → Review), not as a submission.' }, { status: 400 })
  const parsed = parseReviewInput(await req.json().catch(() => ({})))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const v = parsed.value
  // Separation of duties is visible in the record: the audit entry says whether the reviewer uploaded it.
  const ownUpload = schedule.userId === auth.userId
  if (v.kind === 'submission') {
    await saveSubmissionReview(schedule.id, auth.orgId, { disposition: v.disposition, comments: v.comments, userId: auth.userId })
    await audit({ action: 'schedule.submission_review', targetType: 'schedule', targetId: schedule.id, detail: { schedule: schedule.name, version: schedule.version, disposition: v.disposition, comments: v.comments, ownUpload } })
  } else {
    await saveReviewDisposition(schedule.id, auth.orgId, { itemId: v.itemId, disposition: v.disposition, justification: v.justification, userId: auth.userId })
    await audit({ action: 'schedule.review_disposition', targetType: 'schedule', targetId: schedule.id, detail: { schedule: schedule.name, version: schedule.version, itemId: v.itemId, disposition: v.disposition, justification: v.justification, ownUpload } })
  }
  return NextResponse.json({ success: true, review: await getReviewState(schedule.id, auth.orgId) })
})
