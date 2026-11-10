// The Daily Brief by email, every working morning, to the members who asked for it.
// A subscription belongs to one member and one project (the update series), so it follows the project
// across uploads. Each send runs as that member: their workspace access decides whether they still see
// the project, and a CUI or classified project is never emailed.

import { randomUUID } from 'crypto'
import { getScheduleSeries, initSchema, query } from '@/lib/db'
import { orderSeries } from '@/lib/analysis/compare'
import { fmtDate, fmtDates } from '@/lib/format'
import { audit } from './audit'
import { parseRegisterKey } from './register'
import { isRestrictedClassification, scheduleClassification } from './classification'
import { runWithRequest } from './context'
import { emailConfigured, sendEmail } from './email'
import { log, errorFields } from './log'
import { resolveWorkspaceAccess } from './workspaces'
import { loadDailyBrief } from './brief-service'

export type BriefAudience = 'pm' | 'field' | 'client'
export const BRIEF_AUDIENCES: readonly BriefAudience[] = ['pm', 'field', 'client']
export const AUDIENCE_LABEL: Record<BriefAudience, string> = { pm: 'Project manager', field: 'Field', client: 'Client' }
/** The hour (UTC) from which the day's briefs go out: 11:00 UTC is early morning across the Americas. */
export const DIGEST_HOUR_UTC = 11
/** RUNF9_BRIEF_HOUR_UTC moves it (0 to 23), for teams in other time zones. */
export const digestHour = (v: string | undefined = process.env.RUNF9_BRIEF_HOUR_UTC): number => { const n = Number(v); return v !== undefined && v !== '' && Number.isInteger(n) && n >= 0 && n <= 23 ? n : DIGEST_HOUR_UTC }
const MAX_PER_RUN = 300

type Loaded = NonNullable<Awaited<ReturnType<typeof loadDailyBrief>>>

/** The email body: the chosen version, what needs action today, and a link to the full brief. */
export function briefEmailText(out: Loaded, audience: BriefAudience, origin: string): string {
  const act = out.alerts.filter(a => a.level === 'act').slice(0, 8)
  return [
    `${out.schedule.name}: daily brief for ${fmtDate(out.brief.asOf)} (${AUDIENCE_LABEL[audience]})`, '',
    ...out.brief.audiences[audience].map(l => `- ${fmtDates(l)}`),
    ...(audience === 'client' || !act.length ? [] : ['', 'Needs attention today:', ...act.map(a => `- ${fmtDates(a.text)}`)]),
    ...(origin ? ['', `Open the full brief: ${origin}/dashboard/today?schedule=${encodeURIComponent(out.schedule.id)}`] : ['', 'Open RunF9 and choose the Today tab for the full brief.']),
  ].join('\n')
}
export const briefEmailSubject = (out: Loaded) => `Daily brief: ${out.schedule.name}, ${fmtDate(out.brief.asOf)}`

export async function getSubscription(orgId: string, userId: string, projectKey: string): Promise<{ audience: BriefAudience } | null> {
  await initSchema()
  const r = (await query('SELECT audience FROM brief_subscriptions WHERE org_id=$1 AND user_id=$2 AND project_key=$3', [orgId, userId, projectKey])).rows[0]
  return r ? { audience: r.audience as BriefAudience } : null
}
export async function subscribe(orgId: string, userId: string, projectKey: string, scheduleId: string, audience: BriefAudience): Promise<void> {
  await initSchema()
  await query(`INSERT INTO brief_subscriptions (id, org_id, user_id, project_key, schedule_id, audience) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (org_id, user_id, project_key) DO UPDATE SET audience=EXCLUDED.audience, schedule_id=EXCLUDED.schedule_id`, [randomUUID(), orgId, userId, projectKey, scheduleId, audience])
}
export async function unsubscribe(orgId: string, userId: string, projectKey: string): Promise<boolean> {
  await initSchema()
  return ((await query('DELETE FROM brief_subscriptions WHERE org_id=$1 AND user_id=$2 AND project_key=$3', [orgId, userId, projectKey])).rowCount ?? 0) > 0
}

/**
 * Sends today's brief to every subscriber who has not had it yet. Safe to call any number of times:
 * each subscription is claimed for the day before its email is built. Working days only. Never throws.
 */
export async function sendDueBriefs(now = new Date(), origin = (process.env.APP_URL || '').replace(/\/+$/, '')): Promise<{ sent: number; skipped: number }> {
  const out = { sent: 0, skipped: 0 }
  const dow = now.getUTCDay()
  if (!emailConfigured() || dow === 0 || dow === 6 || now.getUTCHours() < digestHour()) return out
  const day = now.toISOString().slice(0, 10)
  try {
    await initSchema()
    const orgs = (await query('SELECT id FROM organizations')).rows.map(r => String(r.id))
    for (const orgId of orgs) {
      const subs = (await query(`SELECT b.id, b.user_id, b.project_key, b.schedule_id, b.audience, u.email, u.name, u.role
        FROM brief_subscriptions b JOIN users u ON u.id = b.user_id AND u.org_id = b.org_id
        WHERE b.org_id=$1 AND u.disabled_at IS NULL AND (b.last_sent_on IS NULL OR b.last_sent_on < $2::date) LIMIT ${MAX_PER_RUN}`, [orgId, day])).rows
      for (const s of subs) {
        if (out.sent >= MAX_PER_RUN) return out
        const claim = await query('UPDATE brief_subscriptions SET last_sent_on=$3::date WHERE id=$1 AND org_id=$2 AND (last_sent_on IS NULL OR last_sent_on < $3::date) RETURNING id', [s.id, orgId, day])
        if (!claim.rowCount) continue
        try {
          const access = await resolveWorkspaceAccess({ userId: s.user_id, orgId, role: s.role })
          // Run as the subscriber, so every read below applies their workspace access.
          const sent = await runWithRequest({ requestId: randomUUID(), method: 'JOB', path: '/jobs/daily-brief', ip: null, userAgent: null, userId: s.user_id, email: s.email, name: s.name, orgId, role: s.role, workspaceAccess: async () => access }, async () => {
            const at = parseRegisterKey(String(s.project_key))
            const series = at.projectKey ? orderSeries(await getScheduleSeries(orgId, at.projectKey, at.workspaceId)) : []
            const latest = series[series.length - 1]
            const scheduleId = latest?.id ?? s.schedule_id
            if (isRestrictedClassification(await scheduleClassification(scheduleId, orgId))) return false
            const brief = await loadDailyBrief(scheduleId, orgId, { asOf: day })
            if (!brief) return false
            const audience = (BRIEF_AUDIENCES as readonly string[]).includes(s.audience) ? (s.audience as BriefAudience) : 'pm'
            const r = await sendEmail({ to: s.email, subject: briefEmailSubject(brief), text: `${briefEmailText(brief, audience, origin)}\n\nYou get this every working morning because you turned it on for this project. Turn it off on the Today tab.` })
            if (r.sent) await audit({ orgId, action: 'brief.digest_sent', actor: { id: null, email: 'system' }, targetType: 'schedule', targetId: brief.schedule.id, detail: { schedule: brief.schedule.name, audience, to: s.user_id, asOf: day } })
            return r.sent
          })
          if (sent) out.sent++; else out.skipped++
        } catch (err) { out.skipped++; log('error', 'daily brief not sent', { subscription: s.id, ...errorFields(err) }) }
      }
    }
  } catch (err) { log('error', 'daily brief run failed', errorFields(err)) }
  if (out.sent || out.skipped) log('info', 'daily brief run', out)
  return out
}
