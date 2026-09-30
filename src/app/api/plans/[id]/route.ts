import { NextRequest, NextResponse } from 'next/server'
import { deletePlan, savePlan } from '@/lib/db'
import { coerceAnswer, questionBank, validateAnswer } from '@/lib/planning/elicitation'
import type { Answer } from '@/lib/planning/types'
import { elicitationContext, loadPlanContext, planView } from './context'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadPlanContext(params.id)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json(await planView(r.plan, r.ctx.orgId))
}

/** Record interview answers: { answers: { [questionId]: { status, value?, note? } }, name? } */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadPlanContext(params.id)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })
  const { plan, ctx } = r
  const body = await req.json().catch(() => ({}))
  const incoming = (body.answers || {}) as Record<string, Partial<Answer> | null>
  const errors: Record<string, string> = {}
  const now = new Date().toISOString()

  // Apply answers one at a time so dependent questions (e.g. design % after "drawings: yes") validate.
  let answers = { ...plan.answers }
  let { ectx } = await elicitationContext(plan, ctx.orgId)
  for (const [qid, raw] of Object.entries(incoming)) {
    if (raw === null) { delete answers[qid]; continue }
    // Facility type changes which firm history is "similar", so refresh the context when it moves.
    if (qid === 'history.use' && answers['project.type']?.value !== plan.answers['project.type']?.value) ectx = (await elicitationContext({ ...plan, answers }, ctx.orgId)).ectx
    const bank = questionBank({ answers }, ectx).all
    const q = bank.find(x => x.id === qid)
    if (!q) { errors[qid] = 'Unknown or no longer relevant question.'; continue }
    const status = raw.status === 'withheld' || raw.status === 'unknown' ? raw.status : 'known'
    const a = coerceAnswer(q, { status, value: raw.value, note: typeof raw.note === 'string' ? raw.note.slice(0, 1000) : undefined, answeredAt: now, source: 'user' })
    const err = validateAnswer(q, a)
    if (err) { errors[qid] = err; continue }
    answers = { ...answers, [qid]: a }
    plan.audit.push({ at: now, by: ctx.name, action: 'answer', detail: `${qid} = ${status === 'known' ? JSON.stringify(a.value) : status}` })
  }
  plan.answers = answers
  if (typeof body.name === 'string' && body.name.trim()) plan.name = body.name.trim().slice(0, 120)
  const saved = await savePlan(plan)
  return NextResponse.json({ ...(await planView(saved, ctx.orgId)), errors })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadPlanContext(params.id)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })
  await deletePlan(r.plan.id, r.ctx.orgId)
  return NextResponse.json({ success: true })
}
