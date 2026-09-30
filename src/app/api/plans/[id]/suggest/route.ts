import { NextRequest, NextResponse } from 'next/server'
import { savePlan } from '@/lib/db'
import { questionBank } from '@/lib/planning/elicitation'
import { suggestQuestions } from '@/lib/planning/ai-questions'
import { llmStatus } from '@/lib/llm/provider'
import { elicitationContext, loadPlanContext, planView } from '../context'

/** Ask the configured model (cloud or on-prem) for project-specific follow-up questions. */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadPlanContext(params.id)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })
  const { plan, ctx } = r
  const status = llmStatus()
  if (status.mode === 'offline') return NextResponse.json({ error: status.error || 'No AI model is configured; the rule-based interview still covers the core questions.' }, { status: 400 })
  const { ectx } = await elicitationContext(plan, ctx.orgId)
  const bank = questionBank({ answers: plan.answers }, ectx).all
  let added
  try {
    added = await suggestQuestions(plan.answers, bank)
  } catch (err) {
    return NextResponse.json({ error: `Model request failed: ${(err as Error).message}` }, { status: 502 })
  }
  plan.extraQuestions = [...plan.extraQuestions, ...added.filter(q => !plan.extraQuestions.some(e => e.id === q.id))]
  plan.audit.push({ at: new Date().toISOString(), by: ctx.name, action: 'ai_suggest', detail: `${added.length} questions from ${status.model}` })
  const saved = await savePlan(plan)
  return NextResponse.json({ ...(await planView(saved, ctx.orgId)), added: added.length })
}
