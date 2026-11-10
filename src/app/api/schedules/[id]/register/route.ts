import { NextResponse } from 'next/server'
import { api, body as readBody } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { getScheduleById } from '@/lib/db'
import { REGISTER_KINDS, REGISTER_LABELS } from '@/lib/analysis/daily-brief'
import { createRegisterItem, deleteRegisterItem, listRegister, MAX_REGISTER_ITEMS, parseRegisterFields, registerKey, updateRegisterItem } from '@/lib/server/register'

/**
 * The project register: risks, issues, PCOs, change requests, change orders and contract amendments.
 * It belongs to the project (the update series), so it carries across uploads.
 *   GET                      → { items, kinds }
 *   POST   { kind, title, detail?, owner?, dueDate?, impactDays?, activityCodes?, sourceDocumentId?, sourceQuote? }
 *   PATCH  ?itemId=…  { any of the fields, status: 'open' | 'closed' }
 *   DELETE ?itemId=…
 * Writing needs schedule.write; every write is audited (titles only, never document text).
 */
/** An item made from a document carries that document's words as its title: the audit log names the source instead. */
const auditTitle = (i: { title: string; sourceDocumentId?: string | null }) => (i.sourceDocumentId ? '(quoted from a project document)' : i.title)

export const GET = api<{ id: string }>({ permission: 'read', apiKey: true }, async (_req, { params, auth }) => {
  const schedule = await getScheduleById(params.id, auth.orgId)
  if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ items: await listRegister(auth.orgId, registerKey(schedule)), kinds: REGISTER_KINDS.map(k => ({ id: k, label: REGISTER_LABELS[k] })) })
})

export const POST = api<{ id: string }>({ permission: 'schedule.write' }, async (req, { params, auth }) => {
  const schedule = await getScheduleById(params.id, auth.orgId)
  if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = parseRegisterFields(await readBody(req), true)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error, code: 'invalid_item' }, { status: 400 })
  const item = await createRegisterItem(auth.orgId, registerKey(schedule), schedule.id, parsed.fields, { userId: auth.userId, name: auth.name })
  if (!item) return NextResponse.json({ error: `A project register holds up to ${MAX_REGISTER_ITEMS} items. Close or delete some first.`, code: 'register_full' }, { status: 400 })
  await audit({ action: 'register.item_created', targetType: 'schedule', targetId: schedule.id, detail: { schedule: schedule.name, itemId: item.id, kind: item.kind, title: auditTitle(item), impactDays: item.impactDays, activities: item.activityCodes, fromDocument: item.sourceDocumentId ?? null } })
  return NextResponse.json({ item })
})

export const PATCH = api<{ id: string }>({ permission: 'schedule.write' }, async (req, { params, auth }) => {
  const schedule = await getScheduleById(params.id, auth.orgId)
  if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const itemId = req.nextUrl.searchParams.get('itemId') || ''
  const parsed = parseRegisterFields(await readBody(req), false)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error, code: 'invalid_item' }, { status: 400 })
  const r = await updateRegisterItem(auth.orgId, registerKey(schedule), itemId, parsed.fields)
  if (!r) return NextResponse.json({ error: 'No such item in this project.' }, { status: 404 })
  await audit({ action: r.before.status !== r.after.status ? (r.after.status === 'closed' ? 'register.item_closed' : 'register.item_reopened') : 'register.item_updated', targetType: 'schedule', targetId: schedule.id,
    detail: { schedule: schedule.name, itemId, kind: r.after.kind, title: auditTitle(r.after), changed: Object.keys(parsed.fields) } })
  return NextResponse.json({ item: r.after })
})

export const DELETE = api<{ id: string }>({ permission: 'schedule.write' }, async (req, { params, auth }) => {
  const schedule = await getScheduleById(params.id, auth.orgId)
  if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const item = await deleteRegisterItem(auth.orgId, registerKey(schedule), req.nextUrl.searchParams.get('itemId') || '')
  if (!item) return NextResponse.json({ error: 'No such item in this project.' }, { status: 404 })
  await audit({ action: 'register.item_deleted', targetType: 'schedule', targetId: schedule.id, detail: { schedule: schedule.name, itemId: item.id, kind: item.kind, title: auditTitle(item) } })
  return NextResponse.json({ success: true })
})
