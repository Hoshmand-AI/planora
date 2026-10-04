import { NextResponse } from 'next/server'
import { api } from '@/lib/server/api'
import { savePlan } from '@/lib/db'
import { applyEdit, EditError, type Edit } from '@/lib/planning/overrides'
import { loadPlanContext, planView } from '../context'

/** Scheduler override: { edit: Edit }. Reason is mandatory; impact on finish and critical path is returned. */
export const POST = api<{ id: string }>({ permission: 'plan.write' }, async (req, { params, auth }) => {
  const r = await loadPlanContext(req, params.id, auth)
  const { plan, ctx } = r
  if (!plan.generated) return NextResponse.json({ error: 'Generate the schedule first.' }, { status: 400 })
  const { edit } = await req.json().catch(() => ({})) as { edit?: Edit }
  if (!edit) return NextResponse.json({ error: 'edit required' }, { status: 400 })
  try {
    const { schedule, impact, summary } = applyEdit(plan.generated, edit, ctx.name)
    plan.generated = schedule
    plan.audit.push({ at: new Date().toISOString(), by: ctx.name, action: `override:${edit.kind}`, detail: `${summary}. Reason: ${edit.reason}` })
    const saved = await savePlan(plan)
    return NextResponse.json({ ...(await planView(saved, ctx.orgId)), impact, summary })
  } catch (err) {
    if (err instanceof EditError) return NextResponse.json({ error: err.message }, { status: 400 })
    throw err
  }
})
