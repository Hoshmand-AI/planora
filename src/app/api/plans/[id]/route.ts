import { NextResponse } from 'next/server'
import { api } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { deletePlan, savePlan } from '@/lib/db'
import { applyAnswers, elicit } from '@/lib/planning/elicitation'
import type { Answer } from '@/lib/planning/types'
import { classifiedCloudRefusal, CLASSIFIED_CLOUD_CODE, planMarkedClassified } from '@/lib/server/classification'
import { deploymentKind } from '@/lib/llm/provider'
import { elicitationContext, loadPlanContext, planView } from './context'

export const GET = api<{ id: string }>({ permission: 'read', apiKey: true }, async (req, { params, auth }) => {
  const r = await loadPlanContext(req, params.id, auth)
  return NextResponse.json(await planView(r.plan, r.ctx.orgId))
})

/**
 * Record interview answers: { answers: { [questionId]: { status, value?, note? } }, name? }
 * An invalid value (an option that isn't listed, a non-number, a withheld answer that can't be) rejects
 * the whole request with 400 and `errors` per question, so nothing is half-saved. Questions that don't
 * exist (or no longer apply) are reported in `errors` and skipped.
 */
export const PATCH = api<{ id: string }>({ permission: 'plan.write', apiKey: true }, async (req, { params, auth }) => {
  const r = await loadPlanContext(req, params.id, auth)
  const { plan, ctx } = r
  const body = await req.json().catch(() => ({}))
  const incoming = (body.answers || {}) as Record<string, Partial<Answer> | null>
  const now = new Date().toISOString()
  // The commercial cloud does not take a plan marked classified: refused before anything is saved.
  const refusal = planMarkedClassified({ 'security.classification': { status: incoming['security.classification']?.status ?? 'known', value: incoming['security.classification']?.value } })
    ? classifiedCloudRefusal('classified', deploymentKind()) : null
  if (refusal) {
    await audit({ action: 'plan.classification_refused', targetType: 'plan', targetId: plan.id, detail: { plan: plan.name, requested: 'classified', reason: CLASSIFIED_CLOUD_CODE, deployment: deploymentKind() } })
    return NextResponse.json({ error: refusal, code: CLASSIFIED_CLOUD_CODE }, { status: 409 })
  }

  const originalAnswers = plan.answers
  const { ectx } = await elicitationContext(plan, ctx.orgId)
  const result = applyAnswers(plan.answers, incoming, ectx, now)
  if (Object.keys(result.invalid).length) {
    const [qid, msg] = Object.entries(result.invalid)[0]
    return NextResponse.json({ error: `${qid}: ${msg}`, code: 'invalid_answer', errors: { ...result.errors, ...result.invalid } }, { status: 400 })
  }
  const errors = result.errors
  let answers = result.answers
  for (const x of result.applied) plan.audit.push({ at: now, by: ctx.name, action: 'answer', detail: x.detail })
  // Free-form information the interview didn't ask about ("add something").
  if (typeof body.addNote === 'string' && body.addNote.trim()) {
    const text = body.addNote.trim().slice(0, 2000)
    const id = `note.${Date.now().toString(36)}`
    plan.extraQuestions = [...plan.extraQuestions, {
      id, section: 'project', kind: 'text', impact: 20, allowWithheld: true,
      prompt: 'Additional information from the project team',
      why: 'Added by the team; recorded in the Basis of Schedule and considered by the scheduler.',
      groundedBy: [{ kind: 'user', label: `Added by ${ctx.name}` }],
    }]
    answers = { ...answers, [id]: { status: 'known', value: text, answeredAt: now, source: 'user' } }
    plan.audit.push({ at: now, by: ctx.name, action: 'note', detail: text.slice(0, 200) })
  }
  plan.answers = answers
  if (typeof body.name === 'string' && body.name.trim()) plan.name = body.name.trim().slice(0, 120)
  const before = new Set(elicit({ answers: originalAnswers }, ectx).dateIssues?.map(i => i.text) || [])
  const saved = await savePlan(plan)
  const view = await planView(saved, ctx.orgId)
  // Date problems introduced by this change, so the UI can flag them right away.
  const newDateIssues = (view.elicitation.dateIssues || []).filter(i => !before.has(i.text))
  return NextResponse.json({ ...view, errors, newDateIssues })
})

export const DELETE = api<{ id: string }>({ permission: 'plan.write' }, async (req, { params, auth }) => {
  const r = await loadPlanContext(req, params.id, auth)
  await deletePlan(r.plan.id, r.ctx.orgId)
  await audit({ action: 'plan.deleted', targetType: 'plan', targetId: r.plan.id, detail: { plan: r.plan.name, version: r.plan.version, activities: r.plan.generated?.activities.length ?? 0 } })
  return NextResponse.json({ success: true })
})
