import { NextResponse } from 'next/server'
import { randomUUID as uuid } from 'crypto'
import { api } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { createPlan, listPlans, savePlan } from '@/lib/db'
import { SAMPLE_NAME, sampleProject } from '@/lib/planning/sample'
import { elicit } from '@/lib/planning/elicitation'
import { PROJECT_TYPES, projectTypeError } from '@/lib/planning/types'
import { currentWorkspaceAccess } from '@/lib/server/workspace-scope'
import { workspaceForNewItem } from '@/lib/server/workspaces'

export const GET = api({ permission: 'read', apiKey: true }, async (_req, { auth: ctx }) => {
  const plans = await listPlans(ctx.orgId)
  return NextResponse.json({
    plans: plans.map(p => ({
      id: p.id, name: p.name, updatedAt: p.updatedAt, createdAt: p.createdAt,
      readiness: elicit({ answers: p.answers }).readiness,
      generated: !!p.generated, finish: p.generated?.cpm?.projectFinish ?? null,
      activityCount: p.generated?.activities.length ?? 0, scheduleId: p.scheduleId, workspaceId: p.workspaceId ?? null,
    })),
  })
})

export const POST = api({ permission: 'plan.write' }, async (req, { auth: ctx }) => {
  const { name, sample, projectType, workspaceId: requestedWorkspace } = await req.json().catch(() => ({}))
  // Matter / engagement workspace the plan belongs to (restricted members default to theirs).
  const workspaceId = await workspaceForNewItem(ctx.orgId, await currentWorkspaceAccess(), requestedWorkspace)
  if (sample === true) {
    // Guided first run: a fully answered sample project with a generated schedule.
    const created = await createPlan({ id: uuid(), orgId: ctx.orgId, userId: ctx.userId, name: SAMPLE_NAME, workspaceId })
    const { answers, generated } = sampleProject()
    created.answers = answers
    created.generated = generated
    created.audit.push({ at: generated.generatedAt, by: ctx.name, action: 'generate', detail: `Sample project: ${generated.activities.length} activities, finish ${generated.cpm?.projectFinish}` })
    const plan = await savePlan(created)
    await audit({ action: 'plan.created', targetType: 'plan', targetId: plan.id, detail: { plan: plan.name, sample: true, workspaceId } })
    return NextResponse.json({ plan: { id: plan.id, name: plan.name } })
  }
  const clean = typeof name === 'string' ? name.trim().slice(0, 120) : ''
  if (!clean) return NextResponse.json({ error: 'Give the project a name.' }, { status: 400 })
  // Optional facility type up front. An unknown one is refused rather than planned as a generic building.
  const typeErr = projectTypeError(projectType)
  if (typeErr) return NextResponse.json({ error: typeErr, code: 'invalid_project_type', validTypes: PROJECT_TYPES }, { status: 400 })
  let plan = await createPlan({ id: uuid(), orgId: ctx.orgId, userId: ctx.userId, name: clean, workspaceId })
  if (typeof projectType === 'string' && projectType) {
    const at = new Date().toISOString()
    plan.answers = { ...plan.answers, 'project.type': { status: 'known', value: projectType, answeredAt: at, source: 'user' } }
    plan.audit.push({ at, by: ctx.name, action: 'answer', detail: `project.type = ${JSON.stringify(projectType)}` })
    plan = await savePlan(plan)
  }
  await audit({ action: 'plan.created', targetType: 'plan', targetId: plan.id, detail: { plan: clean, ...(projectType ? { projectType } : {}), workspaceId } })
  return NextResponse.json({ plan })
})
