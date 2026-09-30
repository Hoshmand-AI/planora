import { getAuthContext, type AuthContext } from '@/lib/auth'
import { getPlan, type Plan } from '@/lib/db'
import { elicit, questionBank, type ElicitationContext } from '@/lib/planning/elicitation'
import { evaluatePlan } from '@/lib/planning/evaluation'
import { loadFirmHistory } from '@/lib/planning/service'
import { llmStatus } from '@/lib/llm/provider'
import type { ProjectType } from '@/lib/planning/types'

export async function loadPlanContext(id: string): Promise<{ ctx: AuthContext; plan: Plan } | { error: string; status: number }> {
  const ctx = await getAuthContext()
  if (!ctx) return { error: 'Unauthorized', status: 401 }
  // Scoped to the caller's firm: another firm's plan id returns 404, not 403, so ids don't leak.
  const plan = await getPlan(id, ctx.orgId)
  if (!plan) return { error: 'Plan not found', status: 404 }
  return { ctx, plan }
}

/** Everything the interview needs to decide which questions exist for this plan. */
export async function elicitationContext(plan: Plan, orgId: string) {
  const projectType = plan.answers['project.type']?.value as ProjectType | undefined
  const history = await loadFirmHistory(orgId, projectType)
  const llm = llmStatus()
  const ectx: ElicitationContext = {
    history: history ? { projectCount: history.projectCount, similarCount: history.similarCount } : undefined,
    aiMode: llm.mode,
    extraQuestions: plan.extraQuestions,
  }
  return { history, llm, ectx }
}

export async function planView(plan: Plan, orgId: string) {
  const { history, llm, ectx } = await elicitationContext(plan, orgId)
  const elicitation = elicit({ answers: plan.answers }, ectx)
  const bank = new Map(questionBank({ answers: plan.answers }, ectx).all.map(q => [q.id, q]))
  const answered = Object.entries(plan.answers).map(([id, a]) => {
    const q = bank.get(id)
    const label = a.status !== 'known' ? (a.status === 'withheld' ? 'Withheld' : "Don't know")
      : q?.options?.find(o => o.value === a.value)?.label ?? (typeof a.value === 'boolean' ? (a.value ? 'Yes' : 'No') : `${a.value}${q?.unit && q.unit !== 'sf' ? ' ' + q.unit : q?.unit === 'sf' ? ' sf' : ''}`)
    return { id, prompt: q?.prompt ?? id, section: q?.section ?? 'project', label, status: a.status }
  })
  const evaluation = plan.generated ? evaluatePlan(plan.generated, plan.answers, history, plan.reviews) : null
  return {
    plan,
    elicitation,
    evaluation,
    answered,
    llm,
    history: history ? { projectCount: history.projectCount, similarCount: history.similarCount, categories: Object.keys(history.byCategory).length } : null,
  }
}
