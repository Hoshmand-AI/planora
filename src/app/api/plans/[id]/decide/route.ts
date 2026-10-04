import { NextResponse } from 'next/server'
import { api } from '@/lib/server/api'
import { savePlan } from '@/lib/db'
import { loadPlanContext, planView } from '../context'

/** Record the scheduler's decision on a quality finding: { key: "dcma:6", decision: "accept" | "fix" | null, note } */
export const POST = api<{ id: string }>({ permission: 'plan.write' }, async (req, { params, auth }) => {
  const r = await loadPlanContext(req, params.id, auth)
  const { plan, ctx } = r
  const body = await req.json().catch(() => ({}))
  if (typeof body.key !== 'string' || !/^dcma:\d{1,2}$/.test(body.key)) return NextResponse.json({ error: 'key must look like dcma:6' }, { status: 400 })
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : ''
  if (body.decision === null) {
    delete plan.decisions[body.key]
  } else if (body.decision === 'accept' || body.decision === 'fix') {
    if (body.decision === 'accept' && note.length < 10) return NextResponse.json({ error: 'Write a short justification (it goes into the Basis of Schedule).' }, { status: 400 })
    plan.decisions = { ...plan.decisions, [body.key]: { decision: body.decision, note, by: ctx.name, at: new Date().toISOString() } }
  } else {
    return NextResponse.json({ error: 'decision must be accept, fix or null' }, { status: 400 })
  }
  plan.audit.push({ at: new Date().toISOString(), by: ctx.name, action: 'decision', detail: `${body.key}: ${body.decision ?? 'cleared'}${note ? ' — ' + note : ''}` })
  const saved = await savePlan(plan)
  return NextResponse.json(await planView(saved, ctx.orgId))
})
