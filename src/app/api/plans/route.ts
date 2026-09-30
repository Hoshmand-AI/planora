import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuid } from 'uuid'
import { getAuthContext } from '@/lib/auth'
import { createPlan, listPlans } from '@/lib/db'
import { elicit } from '@/lib/planning/elicitation'

export async function GET() {
  const ctx = await getAuthContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const plans = await listPlans(ctx.orgId)
  return NextResponse.json({
    plans: plans.map(p => ({
      id: p.id, name: p.name, updatedAt: p.updatedAt, createdAt: p.createdAt,
      readiness: elicit({ answers: p.answers }).readiness,
      generated: !!p.generated, finish: p.generated?.cpm?.projectFinish ?? null,
      activityCount: p.generated?.activities.length ?? 0, scheduleId: p.scheduleId,
    })),
  })
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { name } = await req.json().catch(() => ({}))
  const clean = typeof name === 'string' ? name.trim().slice(0, 120) : ''
  if (!clean) return NextResponse.json({ error: 'Give the project a name.' }, { status: 400 })
  const plan = await createPlan({ id: uuid(), orgId: ctx.orgId, userId: ctx.userId, name: clean })
  return NextResponse.json({ plan })
}
