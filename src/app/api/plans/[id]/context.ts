import type { AuthContext } from '@/lib/auth'
import { ApiError, ConflictError } from '@/lib/server/api'
import { getOrganization, getPlan, type Plan } from '@/lib/db'
import { normalizeSettings } from '@/lib/server/settings'
import { elicit, questionBank, type ElicitationContext } from '@/lib/planning/elicitation'
import { evaluatePlan } from '@/lib/planning/evaluation'
import { recoveryPlan } from '@/lib/planning/recovery'
import { guidanceFor } from '@/lib/analysis/dcma-guidance'
import { loadFirmHistory } from '@/lib/planning/service'
import { llmStatus } from '@/lib/llm/provider'
import type { ProjectType } from '@/lib/planning/types'

/**
 * Loads a plan in the caller's organization. Another firm's plan id returns 404, not 403, so ids
 * don't leak. Writes may send the version they were based on (x-plan-version); a stale write is
 * rejected with 409 instead of silently overwriting someone else's change.
 */
export async function loadPlanContext(req: Request, id: string, ctx: AuthContext): Promise<{ ctx: AuthContext; plan: Plan }> {
  const plan = await getPlan(id, ctx.orgId)
  if (!plan) throw new ApiError(404, 'Plan not found')
  const expected = req.headers.get('x-plan-version')
  if (req.method !== 'GET' && expected && Number(expected) !== plan.version) throw new ConflictError()
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
    return { id, prompt: q?.prompt ?? id, section: q?.section ?? 'project', label, status: a.status, value: a.value ?? null, note: a.note ?? null, custom: !!a.custom }
  })
  const rules = normalizeSettings((await getOrganization(orgId))?.settings).quality
  const evaluation = plan.generated ? evaluatePlan(plan.generated, plan.answers, history, plan.reviews, rules) : null
  const recovery = plan.generated ? recoveryPlan(plan.generated, plan.answers, history) : null
  const offCal = new Set((plan.generated?.activities || []).filter(a => a.calendarId === 'cal-7d' || a.phase === 'design').map(a => a.code))
  const guidance = evaluation ? evaluation.dcma.checks.filter(c => c.result === 'fail' || c.result === 'warn').map(c => ({
    ...guidanceFor(c, {
      generated: true, hasRecovery: !!recovery, hasOpenQuestions: elicitation.questions.length > 0, hasTargets: !!plan.generated?.milestoneTargets?.length,
      offCalendarShare: c.offenders.length ? c.offenders.filter(o => offCal.has(o)).length / c.offenders.length : 0,
    }),
    decision: plan.decisions?.[`dcma:${c.id}`] ?? null,
  })) : []
  return {
    plan,
    elicitation,
    evaluation,
    recovery,
    guidance,
    answered,
    llm,
    history: history ? { projectCount: history.projectCount, similarCount: history.similarCount, categories: Object.keys(history.byCategory).length } : null,
  }
}
