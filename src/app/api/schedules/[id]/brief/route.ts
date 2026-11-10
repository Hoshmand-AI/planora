import { NextResponse } from 'next/server'
import { api, ApiError, body as readBody } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { appOrigin, emailConfigured, sendEmail } from '@/lib/server/email'
import { hit } from '@/lib/server/rate-limit'
import { isRestrictedClassification, scheduleClassification } from '@/lib/server/classification'
import { getScheduleById } from '@/lib/db'
import { registerKey } from '@/lib/server/register'
import { BRIEF_AUDIENCES, briefEmailSubject, briefEmailText, getSubscription, subscribe, unsubscribe } from '@/lib/server/brief-digest'
import { loadDailyBrief } from '@/lib/server/brief-service'

/**
 * The Daily Brief for one project: what finished and started since the last working day, what starts
 * and finishes today, what is overdue, what drives the finish, the deadline position, risks, issues,
 * open change items, recent changes with their effect, missing scope and logic findings, the day's
 * what-if runs and signals from correspondence, plus a version for the PM, the field and the client.
 * Calculated (no AI call) on the living schedule: the upload with the edits made in RunF9.
 *   GET ?asOf=YYYY-MM-DD (default today) &whatIfActivity=<activity ID>&whatIfDays=<work days>
 */
export const GET = api<{ id: string }>({ permission: 'read', apiKey: true }, async (req, { params, auth }) => {
  const sp = req.nextUrl.searchParams
  const act = (sp.get('whatIfActivity') || '').slice(0, 80), days = Number(sp.get('whatIfDays'))
  const out = await loadDailyBrief(params.id, auth.orgId, { asOf: sp.get('asOf'), whatIf: act && Number.isFinite(days) && days > 0 ? { activity: act, days } : null })
  if (!out) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const sub = auth.userId ? await getSubscription(auth.orgId, auth.userId, registerKey((await getScheduleById(params.id, auth.orgId))!)) : null
  return NextResponse.json({ ...out, email: { available: emailConfigured(), everyMorning: sub?.audience ?? null } })
})


/**
 * POST { audience: 'pm' | 'field' | 'client', asOf? }: emails that version of the brief to the signed-in
 * member's own address. Never for a CUI or classified schedule (its content does not leave by email).
 */
export const POST = api<{ id: string }>({ permission: 'read' }, async (req, { params, auth }) => {
  const b = await readBody(req)
  const audience = BRIEF_AUDIENCES.find(a => a === b.audience) ?? 'pm'
  if (!emailConfigured()) return NextResponse.json({ error: 'Email is not set up on this installation, so the brief cannot be sent. Use "Copy to send" instead.', code: 'email_unavailable' }, { status: 400 })
  if (isRestrictedClassification(await scheduleClassification(params.id, auth.orgId))) return NextResponse.json({ error: 'This project is marked CUI or classified, so its brief is not sent by email. Read it here.', code: 'restricted' }, { status: 409 })
  const rl = await hit(`brief-email:${auth.userId}`, 12, 60 * 60)
  if (!rl.ok) throw new ApiError(429, 'Too many briefs emailed this hour. Try again later.', 'rate_limited', { retryAfterSec: rl.retryAfterSec })
  const out = await loadDailyBrief(params.id, auth.orgId, { asOf: typeof b.asOf === 'string' ? b.asOf : null })
  if (!out) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const r = await sendEmail({ to: auth.email, subject: briefEmailSubject(out), text: briefEmailText(out, audience, appOrigin(req)) })
  if (!r.sent) return NextResponse.json({ error: 'The email could not be sent. Try again, or use "Copy to send".', code: 'email_failed' }, { status: 502 })
  await audit({ action: 'brief.emailed', targetType: 'schedule', targetId: out.schedule.id, detail: { schedule: out.schedule.name, audience, asOf: out.brief.asOf } })
  return NextResponse.json({ sent: true })
})

/**
 * PUT { audience } turns on the brief by email every working morning for the signed-in member and this
 * project; DELETE turns it off. Not offered for a CUI or classified project.
 */
export const PUT = api<{ id: string }>({ permission: 'read' }, async (req, { params, auth }) => {
  const schedule = await getScheduleById(params.id, auth.orgId)
  if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const b = await readBody(req)
  const audience = BRIEF_AUDIENCES.find(a => a === b.audience) ?? 'pm'
  if (!emailConfigured()) return NextResponse.json({ error: 'Email is not set up on this installation.', code: 'email_unavailable' }, { status: 400 })
  if (isRestrictedClassification(await scheduleClassification(schedule.id, auth.orgId))) return NextResponse.json({ error: 'This project is marked CUI or classified, so its brief is not sent by email.', code: 'restricted' }, { status: 409 })
  await subscribe(auth.orgId, auth.userId, registerKey(schedule), schedule.id, audience)
  await audit({ action: 'brief.subscribed', targetType: 'schedule', targetId: schedule.id, detail: { schedule: schedule.name, audience } })
  return NextResponse.json({ everyMorning: audience })
})

export const DELETE = api<{ id: string }>({ permission: 'read' }, async (_req, { params, auth }) => {
  const schedule = await getScheduleById(params.id, auth.orgId)
  if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (await unsubscribe(auth.orgId, auth.userId, registerKey(schedule))) await audit({ action: 'brief.unsubscribed', targetType: 'schedule', targetId: schedule.id, detail: { schedule: schedule.name } })
  return NextResponse.json({ everyMorning: null })
})
