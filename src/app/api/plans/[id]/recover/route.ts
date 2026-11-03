import { NextResponse } from 'next/server'
import { api } from '@/lib/server/api'
import { savePlan } from '@/lib/db'
import { recoveryPlan } from '@/lib/planning/recovery'
import { applyEdit, EditError } from '@/lib/planning/overrides'
import { generateSchedule } from '@/lib/planning/generator'
import { loadFirmHistory } from '@/lib/planning/service'
import { historyForPlan } from '@/lib/planning/history'
import type { ProjectType } from '@/lib/planning/types'
import { loadPlanContext, planView } from '../context'

/** Apply one modeled recovery option: { optionId } */
export const POST = api<{ id: string }>({ permission: 'plan.write' }, async (req, { params, auth }) => {
  const r = await loadPlanContext(req, params.id, auth)
  const { plan, ctx } = r
  if (!plan.generated) return NextResponse.json({ error: 'Generate the schedule first.' }, { status: 400 })
  const { optionId } = await req.json().catch(() => ({}))
  // history.use = No: firm history shapes neither the recovery options nor the regenerated schedule.
  const history = historyForPlan(await loadFirmHistory(ctx.orgId, plan.answers['project.type']?.value as ProjectType), plan.answers)
  const rec = recoveryPlan(plan.generated, plan.answers, history)
  const opt = rec?.options.find(o => o.id === optionId)
  if (!opt) return NextResponse.json({ error: 'That option is no longer available — the schedule may already meet the date.' }, { status: 400 })
  const now = new Date().toISOString()
  if (opt.apply.type === 'answers') {
    for (const [k, v] of Object.entries(opt.apply.answers)) plan.answers[k] = { status: 'known', value: v.value, answeredAt: now, source: 'user' }
    plan.generated = generateSchedule({ answers: plan.answers, history, previous: plan.generated })
  } else if (opt.apply.type === 'edits') {
    let s = plan.generated
    for (const e of opt.apply.edits) {
      try { s = applyEdit(s, e, ctx.name).schedule } catch (err) { if (!(err instanceof EditError)) throw err }
    }
    plan.generated = s
  } else {
    return NextResponse.json({ error: 'This option is applied by answering the open questions.' }, { status: 400 })
  }
  plan.audit.push({ at: now, by: ctx.name, action: 'recovery', detail: `${opt.title} → finish ${plan.generated.cpm?.projectFinish}` })
  const saved = await savePlan(plan)
  return NextResponse.json({ ...(await planView(saved, ctx.orgId)), applied: opt.title })
})
