import { NextResponse } from 'next/server'
import { randomUUID as uuid } from 'crypto'
import { api, body as readBody } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { getScheduleById } from '@/lib/db'
import { createDelayEvent, listDelayEvents } from '@/lib/tia-db'
import { parseDelayEventFields, RESPONSIBILITIES, TIA_DISCLAIMER } from '@/lib/analysis/tia'
import { loadTiaContext, pickList } from '@/lib/server/tia-service'

/**
 * Time Impact Analysis on an update (uploaded schedule): its delay events.
 *   GET   → { events (with run counts), activities + calendars (fragnet editor pick list), previous update, acceptanceNote, disclaimer }
 *   POST  { title, description?, responsibility?, eventStart?, eventEnd?, notifiedOn?, evidence?: [{ label, url? }], fragnet? }
 *         → creates a draft delay event. Responsibility is a label only (owner | contractor | third_party
 *         | force_majeure | unassigned). Needs schedule.write; audited.
 */
export const GET = api<{ id: string }>({ permission: 'read', apiKey: true }, async (_req, { params, auth }) => {
  const ctx = await loadTiaContext(params.id, auth.orgId)
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const events = await listDelayEvents(params.id, auth.orgId)
  return NextResponse.json({
    schedule: { id: ctx.data.schedule.id, name: ctx.data.schedule.name, version: ctx.data.schedule.version, dataDate: ctx.data.schedule.dataDate, editsApplied: ctx.data.editsApplied },
    contractMilestone: ctx.data.analysis.finishMilestone ? { code: ctx.data.analysis.finishMilestone.code, name: ctx.data.analysis.finishMilestone.name } : null,
    events, ...pickList(ctx.data),
    previous: ctx.previous ? { scheduleId: ctx.previous.scheduleId, label: ctx.previous.label, dataDate: ctx.previous.dataDate } : null,
    acceptanceNote: ctx.acceptanceNote, responsibilities: RESPONSIBILITIES, disclaimer: TIA_DISCLAIMER,
  })
})

export const POST = api<{ id: string }>({ permission: 'schedule.write' }, async (req, { params, auth }) => {
  const schedule = await getScheduleById(params.id, auth.orgId)
  if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = parseDelayEventFields(await readBody(req), false)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error, code: 'invalid_delay_event' }, { status: 400 })
  const f = parsed.fields
  const event = await createDelayEvent(auth.orgId, {
    id: uuid(), scheduleId: schedule.id, title: f.title!, description: f.description ?? null, responsibility: f.responsibility ?? 'unassigned',
    eventStart: f.eventStart ?? null, eventEnd: f.eventEnd ?? null, notifiedOn: f.notifiedOn ?? null, evidence: f.evidence ?? [],
    fragnet: f.fragnet ?? { activities: [], relationships: [] }, createdBy: auth.userId,
  })
  await audit({ action: 'tia.event_create', targetType: 'schedule', targetId: schedule.id, detail: {
    schedule: schedule.name, version: schedule.version, delayEventId: event.id, title: event.title, responsibilityLabel: event.responsibility,
    fragnetActivities: event.fragnet.activities.length, evidence: event.evidence.length,
  } })
  return NextResponse.json({ success: true, event }, { status: 201 })
})
