import { NextResponse } from 'next/server'
import { api } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { getScheduleById, setActivityCategory } from '@/lib/db'
import { CANONICAL_CATEGORIES } from '@/lib/planning/types'
import { categoryLabel } from '@/lib/semantic/taxonomy'

/**
 * Correct the category Planora assigned to an activity of an uploaded schedule: { category }.
 * Categories drive phase names, the brief and firm-history durations, so a scheduler can fix a
 * misread name (e.g. "Seeding" read as commissioning on a highway job). Audited.
 */
export const PATCH = api<{ id: string; activityId: string }>({ permission: 'schedule.write' }, async (req, { params, auth: ctx }) => {
  const schedule = await getScheduleById(params.id, ctx.orgId)
  if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = await req.json().catch(() => ({}))
  const category = typeof body?.category === 'string' ? body.category : ''
  if (!(CANONICAL_CATEGORIES as readonly string[]).includes(category)) {
    return NextResponse.json({ error: `category must be one of: ${CANONICAL_CATEGORIES.join(', ')}`, code: 'invalid_category' }, { status: 400 })
  }
  const r = await setActivityCategory(ctx.orgId, schedule.id, params.activityId, category)
  if (!r) return NextResponse.json({ error: 'Activity not found' }, { status: 404 })
  await audit({
    action: 'schedule.activity_category', targetType: 'schedule', targetId: schedule.id,
    detail: { schedule: schedule.name, activityId: params.activityId, activity: r.name.slice(0, 200), from: r.previous, to: category },
  })
  return NextResponse.json({ success: true, activityId: params.activityId, category, label: categoryLabel(category as (typeof CANONICAL_CATEGORIES)[number]), previous: r.previous })
})
