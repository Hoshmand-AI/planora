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
import { mayUseRunF9 } from './signup-policy'
import { loadDailyBrief } from './brief-service'
import { briefFigures } from '@/lib/analysis/brief-figures'
import { DISPLAY, SANS, T, esc } from './email-template'

export type BriefAudience = 'pm' | 'field' | 'client'
export const BRIEF_AUDIENCES: readonly BriefAudience[] = ['pm', 'field', 'client']
export const AUDIENCE_LABEL: Record<BriefAudience, string> = { pm: 'Project manager', field: 'Field', client: 'Client' }
/** The hour (UTC) from which the day's briefs go out: 11:00 UTC is early morning across the Americas. */
export const DIGEST_HOUR_UTC = 11
/** RUNF9_BRIEF_HOUR_UTC moves it (0 to 23), for teams in other time zones. */
export const digestHour = (v: string | undefined = process.env.RUNF9_BRIEF_HOUR_UTC): number => { const n = Number(v); return v !== undefined && v !== '' && Number.isInteger(n) && n >= 0 && n <= 23 ? n : DIGEST_HOUR_UTC }
const MAX_PER_RUN = 300

type Loaded = NonNullable<Awaited<ReturnType<typeof loadDailyBrief>>>

/** One part of the email under its heading. A line may carry a lead (where it comes from) above its text. */
interface EmailSection { heading: string; lines: { lead?: string; text: string }[] }
const EMAIL_LIST_LIMIT = 5

/**
 * The parts of the email, in the order of the tabs of the brief in the app (Project manager, Field, Client,
 * Email and meetings, What-ifs). An email is written for one reader, so it holds that reader's version only.
 * What needs action today goes to the project manager and the field, never in the client version; what the
 * correspondence says and the day's what-if runs go with the project manager's version.
 */
function emailSections(out: Loaded, audience: BriefAudience): EmailSection[] {
  const b = out.brief
  const act = out.alerts.filter(a => a.level === 'act').slice(0, 8)
  const parts: EmailSection[] = [{ heading: AUDIENCE_LABEL[audience], lines: b.audiences[audience].map(l => ({ text: fmtDates(l) })) }]
  if (audience !== 'client' && act.length) parts.push({ heading: 'Needs attention today', lines: act.map(a => ({ text: fmtDates(a.text) })) })
  if (audience === 'pm') {
    const signals = (b.signals ?? []).slice(0, EMAIL_LIST_LIMIT)
    if (signals.length) parts.push({ heading: 'Email and meetings', lines: signals.map(s => ({
      lead: [s.citation.includes(s.title) ? s.citation : `${s.title} ${s.citation}`.trim(), s.activity ? `about ${s.activity.code} ${s.activity.name}` : '', s.days ? `${s.days} work day${s.days === 1 ? '' : 's'}` : ''].filter(Boolean).join(', '),
      text: `"${s.quote}"`,
    })) })
    const whatIfs = (b.whatIfs ?? []).slice(0, EMAIL_LIST_LIMIT)
    if (whatIfs.length) parts.push({ heading: 'What-ifs', lines: whatIfs.map(w => ({ lead: w.title, text: fmtDates(w.text) })) })
  }
  return parts
}
const briefLink = (out: Loaded, origin: string) => (origin ? `${origin}/dashboard/project?schedule=${encodeURIComponent(out.schedule.id)}` : '')

/**
 * The plain-text part: the title line, the four figures, then each part under its heading, and a link to the
 * full brief. `note` is a closing line (why the reader gets it).
 */
export function briefEmailText(out: Loaded, audience: BriefAudience, origin: string, note = ''): string {
  const link = briefLink(out, origin)
  return [
    `${out.schedule.name}: daily brief for ${fmtDate(out.brief.asOf)} (${AUDIENCE_LABEL[audience]})`,
    ...(out.brief.dataDate ? [`Data date ${fmtDate(out.brief.dataDate)}`] : []), '',
    ...briefFigures(out.brief, out.alerts).map(f => `${f.label}: ${f.value}${f.note ? ` (${f.note})` : ''}`),
    ...emailSections(out, audience).flatMap(p => ['', `${p.heading}:`, ...p.lines.map(l => (l.lead ? `- ${l.lead}\n  ${l.text}` : `- ${l.text}`))]),
    '', link ? `Open the full brief: ${link}` : 'Open RunF9 and open the project Overview for the full brief.',
    ...(note ? ['', note] : []),
  ].join('\n')
}

/**
 * The HTML part, with the same words as the text part: a header with the RunF9 wordmark, "Daily Brief" and
 * the date; the project; the four figures as a table; each part under its heading; a link to the full brief.
 * Tables and inline styles only, so it holds up in plain mail clients. The wordmark is text, not a picture:
 * nothing in the message is loaded from a server, so there is nothing to block and nothing that tracks opening.
 */
export function briefEmailHtml(out: Loaded, audience: BriefAudience, origin: string, note = ''): string {
  const b = out.brief
  const link = briefLink(out, origin)
  const figures = briefFigures(b, out.alerts)
  const cell = (f: (typeof figures)[number]) => `<td width="50%" valign="top" style="padding:12px 14px;border:1px solid ${T.line};font-family:${SANS};">
            <div style="font-size:18px;line-height:1.3;font-weight:600;color:${f.missing ? T.muted : T.heading};">${esc(f.value)}</div>
            <div style="font-size:13px;line-height:1.45;color:${T.muted};">${esc(f.label)}${f.note ? `<br>${esc(f.note)}` : ''}</div>
          </td>`
  const p = (text: string, color: string = T.muted) => `<p style="margin:0 0 6px 0;font-family:${SANS};font-size:13px;line-height:1.55;color:${color};">${text}</p>`
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${esc(briefEmailSubject(out))}</title>
</head>
<body style="margin:0;padding:0;background:${T.page};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(fmtDates(b.audiences[audience][0] ?? ''))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${T.page};">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:${T.card};border:1px solid ${T.line};">
      <tr><td style="background:${T.band};padding:16px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="left" valign="middle" style="font-family:${DISPLAY};font-size:24px;line-height:1;font-weight:800;font-style:italic;letter-spacing:-0.02em;color:#FFFFFF;">RunF9</td>
          <td align="right" valign="middle" style="font-family:${SANS};font-size:14px;line-height:1.35;color:${T.onBand};"><span style="font-weight:600;color:#FFFFFF;">Daily Brief</span><br>${esc(fmtDate(b.asOf))}</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:24px 24px 8px 24px;">
        <h1 style="margin:0 0 4px 0;font-family:${DISPLAY};font-size:20px;line-height:1.3;font-weight:600;color:${T.heading};">${esc(out.schedule.name)}</h1>
        ${p(`${esc(AUDIENCE_LABEL[audience])} version${b.dataDate ? ` · Data date ${esc(fmtDate(b.dataDate))}` : ''}`)}
      </td></tr>
      <tr><td style="padding:8px 24px 8px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
          <tr>${figures.slice(0, 2).map(f => cell(f)).join('')}</tr>
          <tr>${figures.slice(2).map(f => cell(f)).join('')}</tr>
        </table>
      </td></tr>
      <tr><td style="padding:8px 24px 8px 24px;">
        ${emailSections(out, audience).map(s => `<h2 style="margin:16px 0 8px 0;font-family:${SANS};font-size:16px;line-height:1.3;font-weight:600;color:${T.heading};">${esc(s.heading)}</h2>
        <ul style="margin:0;padding:0 0 0 20px;">
          ${s.lines.map(l => `<li style="margin:0 0 8px 0;font-family:${SANS};font-size:15px;line-height:1.55;color:${T.text};">${l.lead ? `<span style="font-size:13px;font-weight:600;color:${T.heading};">${esc(l.lead)}</span><br>` : ''}${esc(l.text)}</li>`).join('\n          ')}
        </ul>`).join('\n        ')}
      </td></tr>
      <tr><td style="padding:16px 24px 24px 24px;">
        ${link ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px 0;"><tr><td align="center" style="border-radius:8px;background:${T.accent};">
          <a href="${esc(link)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:${T.accent};font-family:${SANS};font-size:15px;font-weight:600;line-height:1;color:#FFFFFF;text-decoration:none;">Open the full brief</a>
        </td></tr></table>
        ${p(`Or paste this link into your browser: <a href="${esc(link)}" style="color:${T.accent};word-break:break-all;">${esc(link)}</a>`)}` : p('Open RunF9 and open the project Overview for the full brief.', T.text)}
        ${note ? p(esc(note)) : ''}
        ${p('RunF9 by Hoshmand AI')}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`
}

/** Both parts of the message, built from the same brief so they say the same thing. */
export const briefEmail = (out: Loaded, audience: BriefAudience, origin: string, note = ''): { text: string; html: string } =>
  ({ text: briefEmailText(out, audience, origin, note), html: briefEmailHtml(out, audience, origin, note) })
/** The closing line of the morning email: why the reader gets it and where to stop it. */
export const DIGEST_NOTE = 'You get this every working morning because you turned it on for this project. To turn it off, open the Daily Brief on the project Overview and clear "Email me this brief every working morning".'
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

/** A member whose access was revoked gets no brief: the same rule as signing in (see auth.ts). */
export const mayReceiveBrief = (u: { email: unknown; beta_access_at: unknown; beta_revoked_at: unknown }, env: Record<string, string | undefined> = process.env): boolean =>
  mayUseRunF9({ email: String(u.email), betaAccessAt: u.beta_access_at ? String(u.beta_access_at) : null, betaRevokedAt: u.beta_revoked_at ? String(u.beta_revoked_at) : null }, env)

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
      const subs = (await query(`SELECT b.id, b.user_id, b.project_key, b.schedule_id, b.audience, u.email, u.name, u.role, u.beta_access_at, u.beta_revoked_at
        FROM brief_subscriptions b JOIN users u ON u.id = b.user_id AND u.org_id = b.org_id
        WHERE b.org_id=$1 AND u.disabled_at IS NULL AND (b.last_sent_on IS NULL OR b.last_sent_on < $2::date) LIMIT ${MAX_PER_RUN}`, [orgId, day])).rows
      for (const s of subs) {
        if (out.sent >= MAX_PER_RUN) return out
        if (!mayReceiveBrief(s)) continue
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
            const r = await sendEmail({ to: s.email, subject: briefEmailSubject(brief), ...briefEmail(brief, audience, origin, DIGEST_NOTE) })
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
