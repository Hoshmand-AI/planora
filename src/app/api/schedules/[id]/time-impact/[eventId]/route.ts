import { NextResponse } from 'next/server'
import { api, body as readBody } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { getScheduleById } from '@/lib/db'
import { deleteDelayEvent, getDelayEvent, listTiaRuns, updateDelayEvent } from '@/lib/tia-db'
import { DELAY_EVENT_STATUSES, parseDelayEventFields, TIA_DISCLAIMER, type DelayEventStatus } from '@/lib/analysis/tia'

/**
 * One delay event of an update.
 *   GET    → { event, runs (newest first), disclaimer }
 *   PATCH  { title?, description?, responsibility?, eventStart?, eventEnd?, notifiedOn?, evidence?, fragnet?, status?, statusNote? }
 *          Editing the event or its fragnet after it was analysed returns it to draft (earlier runs stay
 *          as they were). status accepted / rejected needs at least one run; accepting records that the
 *          analysis was accepted, not an entitlement. Needs schedule.write; audited.
 *   DELETE → removes a delay event that was never run (an analysed event is a record: reject it instead).
 */
export const GET = api<{ id: string; eventId: string }>({ permission: 'read', apiKey: true }, async (_req, { params, auth }) => {
  const event = await getDelayEvent(params.eventId, params.id, auth.orgId)
  if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const runs = await listTiaRuns(event.id, auth.orgId)
  return NextResponse.json({ event, runs, disclaimer: TIA_DISCLAIMER })
})

export const PATCH = api<{ id: string; eventId: string }>({ permission: 'schedule.write' }, async (req, { params, auth }) => {
  const [schedule, event] = await Promise.all([getScheduleById(params.id, auth.orgId), getDelayEvent(params.eventId, params.id, auth.orgId)])
  if (!schedule || !event) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const b = await readBody<Record<string, unknown>>(req)
  const parsed = parseDelayEventFields(b, true)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error, code: 'invalid_delay_event' }, { status: 400 })
  const fields: Parameters<typeof updateDelayEvent>[4] = { ...parsed.fields }
  const edited = Object.keys(parsed.fields).length > 0
  let status: DelayEventStatus | null = null
  if ('status' in b) {
    if (!(DELAY_EVENT_STATUSES as readonly string[]).includes(String(b.status))) return NextResponse.json({ error: `Status must be one of ${DELAY_EVENT_STATUSES.join(', ')}.` }, { status: 400 })
    status = b.status as DelayEventStatus
    if (status === 'analyzed') return NextResponse.json({ error: 'An event becomes analysed when a TIA is run on it.' }, { status: 400 })
    if ((status === 'accepted' || status === 'rejected')) {
      if (edited) return NextResponse.json({ error: 'Change the status separately from editing the event.' }, { status: 400 })
      const runs = await listTiaRuns(event.id, auth.orgId)
      if (!runs.length) return NextResponse.json({ error: 'Run the time impact analysis before accepting or rejecting it.', code: 'not_analyzed' }, { status: 409 })
    }
    fields.status = status
    fields.statusNote = typeof b.statusNote === 'string' ? b.statusNote.trim().slice(0, 2000) || null : null
  } else if (edited && event.status !== 'draft') {
    // A changed event is a new question: back to draft; the runs already made stay as they were.
    fields.status = 'draft'
    fields.statusNote = null
  }
  const updated = await updateDelayEvent(event.id, params.id, auth.orgId, auth.userId, fields)
  const action = status === 'accepted' ? 'tia.accept' : status === 'rejected' ? 'tia.reject' : 'tia.event_update'
  await audit({ action, targetType: 'schedule', targetId: schedule.id, detail: {
    schedule: schedule.name, version: schedule.version, delayEventId: event.id, title: updated?.title ?? event.title,
    changed: Object.keys(parsed.fields), statusBefore: event.status, statusAfter: updated?.status ?? event.status,
    ...(status ? { statusNote: fields.statusNote ?? null } : {}),
  } })
  return NextResponse.json({ success: true, event: updated })
})

export const DELETE = api<{ id: string; eventId: string }>({ permission: 'schedule.write' }, async (_req, { params, auth }) => {
  const event = await getDelayEvent(params.eventId, params.id, auth.orgId)
  if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!(await deleteDelayEvent(event.id, params.id, auth.orgId))) {
    return NextResponse.json({ error: 'This delay event has been analysed, so it is kept as a record. Reject it instead.', code: 'has_runs' }, { status: 409 })
  }
  await audit({ action: 'tia.event_delete', targetType: 'schedule', targetId: params.id, detail: { delayEventId: event.id, title: event.title } })
  return NextResponse.json({ success: true })
})
