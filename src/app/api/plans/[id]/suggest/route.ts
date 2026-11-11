import { NextResponse } from 'next/server'
import { api } from '@/lib/server/api'
import { savePlan } from '@/lib/db'
import { questionBank } from '@/lib/planning/elicitation'
import { suggestQuestions } from '@/lib/planning/ai-questions'
import { llmStatus, AiQuotaError, RestrictedDataError } from '@/lib/llm/provider'
import { AiProviderError, AiRefusalError } from '@/lib/llm/gateway'
import { log } from '@/lib/server/log'
import { elicitationContext, loadPlanContext, planView } from '../context'

/** Ask the configured model (cloud or on-prem) for project-specific follow-up questions. */
export const POST = api<{ id: string }>({ permission: 'plan.write' }, async (req, { params, auth }) => {
  const r = await loadPlanContext(req, params.id, auth)
  const { plan, ctx } = r
  const status = llmStatus()
  if (status.mode === 'offline') return NextResponse.json({ error: status.error || 'No AI model is configured; the rule-based interview still covers the core questions.' }, { status: 400 })
  const { ectx } = await elicitationContext(plan, ctx.orgId)
  const bank = questionBank({ answers: plan.answers }, ectx).all
  let added
  try {
    added = await suggestQuestions(plan.answers, bank)
  } catch (err) {
    if (err instanceof AiQuotaError) return NextResponse.json({ error: err.message, code: 'ai_quota' }, { status: 429 })
    // Only messages written for users are returned; anything else is logged and answered in general terms.
    if (err instanceof AiProviderError || err instanceof AiRefusalError || err instanceof RestrictedDataError) return NextResponse.json({ error: `Model request failed: ${err.message}` }, { status: 502 })
    log('warn', 'model call failed', { purpose: 'plan.suggest_questions', error: (err as Error).message })
    return NextResponse.json({ error: 'The AI model could not suggest questions this time. Try again; the rule-based interview still covers the core questions.' }, { status: 502 })
  }
  plan.extraQuestions = [...plan.extraQuestions, ...added.filter(q => !plan.extraQuestions.some(e => e.id === q.id))]
  plan.audit.push({ at: new Date().toISOString(), by: ctx.name, action: 'ai_suggest', detail: `${added.length} questions from ${status.model}` })
  const saved = await savePlan(plan)
  return NextResponse.json({ ...(await planView(saved, ctx.orgId)), added: added.length })
})
