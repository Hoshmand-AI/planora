import { NextResponse } from 'next/server'
import { api } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { deletePlan, savePlan } from '@/lib/db'
import { coerceAnswer, elicit, questionBank, validateAnswer } from '@/lib/planning/elicitation'
import type { Answer } from '@/lib/planning/types'
import { elicitationContext, loadPlanContext, planView } from './context'

export const GET = api<{ id: string }>({ permission: 'read', apiKey: true }, async (req, { params, auth }) => {
  const r = await loadPlanContext(req, params.id, auth)
  return NextResponse.json(await planView(r.plan, r.ctx.orgId))
})

/** Record interview answers: { answers: { [questionId]: { status, value?, note? } }, name? } */
export const PATCH = api<{ id: string }>({ permission: 'plan.write', apiKey: true }, async (req, { params, auth }) => {
  const r = await loadPlanContext(req, params.id, auth)
  const { plan, ctx } = r
  const body = await req.json().catch(() => ({}))
  const incoming = (body.answers || {}) as Record<string, Partial<Answer> | null>
  const errors: Record<string, string> = {}
  const now = new Date().toISOString()

  // Apply answers one at a time so dependent questions (e.g. design % after "drawings: yes") validate.
  const originalAnswers = plan.answers
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
    // A note qualifies the answer in the team's own words; never kept on withheld answers.
    const note = status !== 'withheld' && typeof raw.note === 'string' && raw.note.trim() ? raw.note.trim().slice(0, 1000) : undefined
    const a = coerceAnswer(q, { status, value: raw.value, note, answeredAt: now, source: 'user' })
    const err = validateAnswer(q, a)
    if (err) { errors[qid] = err; continue }
    answers = { ...answers, [qid]: a }
    plan.audit.push({ at: now, by: ctx.name, action: 'answer', detail: `${qid} = ${status === 'known' ? JSON.stringify(a.value) : status}` })
  }
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
