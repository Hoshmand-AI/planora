import { NextResponse } from 'next/server'
import { api } from '@/lib/server/api'
import { savePlan } from '@/lib/db'
import { generateSchedule } from '@/lib/planning/generator'
import { loadFirmHistory } from '@/lib/planning/service'
import type { ProjectType } from '@/lib/planning/types'
import { loadPlanContext, planView } from '../context'

/** Build (or rebuild) the schedule from the interview. Scheduler overrides are carried forward. */
export const POST = api<{ id: string }>({ permission: 'plan.write', apiKey: true }, async (req, { params, auth }) => {
  const r = await loadPlanContext(req, params.id, auth)
  const { plan, ctx } = r
  const body = await req.json().catch(() => ({}))
  if (!plan.answers['project.type'] || plan.answers['project.type'].status !== 'known') {
    return NextResponse.json({ error: 'Answer at least the facility type before generating.' }, { status: 400 })
  }
  const history = await loadFirmHistory(ctx.orgId, plan.answers['project.type'].value as ProjectType)
  const generated = generateSchedule({ answers: plan.answers, history, previous: body.fresh ? null : plan.generated })
  plan.generated = generated
  plan.audit.push({ at: generated.generatedAt, by: ctx.name, action: body.fresh ? 'generate_fresh' : 'generate', detail: `${generated.activities.length} activities, finish ${generated.cpm?.projectFinish}` })
  const saved = await savePlan(plan)
  return NextResponse.json(await planView(saved, ctx.orgId))
})
