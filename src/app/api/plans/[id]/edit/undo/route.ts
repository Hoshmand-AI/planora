import { NextResponse } from 'next/server'
import { api } from '@/lib/server/api'
import { savePlan } from '@/lib/db'
import { combinedImpact } from '@/lib/planning/overrides'
import { loadPlanContext, planView } from '../../context'

/**
 * Undo the latest scheduler change to the plan's schedule (one step): the schedule as it was before
 * that change is restored, so an approval of that earlier content applies again. Recorded in the
 * plan's audit trail.
 */
export const POST = api<{ id: string }>({ permission: 'plan.write' }, async (req, { params, auth }) => {
  const { plan, ctx } = await loadPlanContext(req, params.id, auth)
  const undo = plan.generated?.undo
  if (!plan.generated || !undo) return NextResponse.json({ error: 'There is no change to undo.' }, { status: 400 })
  const current = plan.generated
  plan.generated = undo.previous
  const impact = combinedImpact(current, undo.previous)
  plan.audit.push({ at: new Date().toISOString(), by: ctx.name, byId: ctx.userId, action: 'override:undo', detail: `Undid: ${undo.summary} (made by ${undo.by} at ${undo.at})` })
  const saved = await savePlan(plan)
  return NextResponse.json({ ...(await planView(saved, ctx.orgId)), impact, summary: `Undid: ${undo.summary}` })
})
