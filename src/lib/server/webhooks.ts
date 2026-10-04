// Outbound webhooks: an organization subscribes an HTTPS endpoint to events (a plan generated,
// published or reviewed; a schedule uploaded...). Each delivery is a JSON POST signed with the
// endpoint's secret:  X-Planora-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>.
// Receivers should check the signature and reject timestamps older than 5 minutes.
//
// Endpoints must be public HTTPS URLs; addresses that resolve to private, loopback or link-local
// networks are refused (server-side request forgery). Redirects are not followed. After 20
// consecutive failures the endpoint is disabled and shown as such to admins.
//
// The same delivery path sends security alerts to PLANORA_ALERT_WEBHOOK_URL (operator-level, e.g. a
// Slack or Teams incoming webhook) for events such as account lockouts and audit-chain failures.

import { createHmac, randomUUID } from 'crypto'
import { lookup } from 'dns/promises'
import { isIP } from 'net'
import { after } from 'next/server'
import { initSchema, query } from '@/lib/db'
import { decrypt, encrypt, randomToken } from './crypto'
import { log, errorFields } from './log'

export const WEBHOOK_EVENTS = {
  'plan.created': 'A plan was created',
  'plan.generate': 'A schedule was generated or regenerated',
  'plan.publish': 'A plan was published as a baseline schedule',
  'plan.review': 'An expert review was recorded',
  'plan.recovery': 'A recovery option was applied',
  'plan.deleted': 'A plan was deleted',
  'schedule.upload': 'A schedule file was uploaded',
  'schedule.delete': 'An uploaded schedule was deleted',
  'member.joined': 'A member joined the organization',
  'member.removed': 'A member was removed',
} as const
export type WebhookEvent = keyof typeof WEBHOOK_EVENTS
export const isWebhookEvent = (e: unknown): e is WebhookEvent => typeof e === 'string' && e in WEBHOOK_EVENTS

/** Security events forwarded to the operator's alert channel. */
export const SECURITY_ALERT_EVENTS = new Set(['auth.locked', 'account.mfa_disabled', 'org.ownership_transferred', 'org.sso_changed', 'member.role_changed', 'audit.chain_broken', 'privacy.organization_exported', 'apikey.created'])

export const MAX_WEBHOOKS_PER_ORG = 10
const MAX_FAILURES = 20
const TIMEOUT_MS = 5000

export interface Webhook {
  id: string; url: string; events: WebhookEvent[]; createdBy: string; createdAt: string
  disabledAt: string | null; lastDeliveryAt: string | null; lastStatus: string | null; consecutiveFailures: number
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)
const rowToHook = (r: Record<string, unknown>): Webhook => ({
  id: String(r.id), url: String(r.url), events: (r.events as WebhookEvent[]) || [], createdBy: String(r.created_by), createdAt: iso(r.created_at)!,
  disabledAt: iso(r.disabled_at), lastDeliveryAt: iso(r.last_delivery_at), lastStatus: (r.last_status as string) ?? null, consecutiveFailures: Number(r.consecutive_failures),
})

/* ─── Destination safety ─────────────────────────────── */

/** Test environments only (CI points webhooks at a local receiver); like PLANORA_ALLOW_INSECURE_OIDC. */
const allowInsecure = () => process.env.PLANORA_ALLOW_INSECURE_WEBHOOKS === '1'

/** True for addresses a webhook must never reach: private, loopback, link-local, CGNAT, multicast, metadata. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224
  }
  if (v === 6) {
    const x = ip.toLowerCase()
    if (x.startsWith('::ffff:')) return isPrivateAddress(x.slice(7))
    return x === '::' || x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb') || x.startsWith('ff')
  }
  return true
}

/** Returns a problem with the URL, or null if it is an acceptable webhook destination. */
export async function urlProblem(raw: string): Promise<string | null> {
  let u: URL
  try { u = new URL(raw) } catch { return 'Enter a full URL, e.g. https://hooks.example.com/planora.' }
  if (u.username || u.password) return 'Remove the user name and password from the URL; use the signing secret instead.'
  if (raw.length > 500) return 'The URL is too long.'
  if (allowInsecure()) return u.protocol === 'https:' || u.protocol === 'http:' ? null : 'Use an http(s) URL.'
  if (u.protocol !== 'https:') return 'Webhook URLs must use HTTPS.'
  const host = u.hostname.replace(/^\[|\]$/g, '')
  let addrs: string[]
  try { addrs = isIP(host) ? [host] : (await lookup(host, { all: true })).map(a => a.address) } catch { return 'That host name does not resolve.' }
  if (!addrs.length || addrs.some(isPrivateAddress)) return 'That URL points to a private or internal network address, which is not allowed.'
  return null
}

/* ─── CRUD ───────────────────────────────────────────── */

export async function listWebhooks(orgId: string): Promise<Webhook[]> {
  await initSchema()
  return (await query('SELECT * FROM webhooks WHERE org_id=$1 ORDER BY created_at DESC', [orgId])).rows.map(rowToHook)
}

export async function createWebhook(orgId: string, input: { url: string; events: WebhookEvent[]; createdBy: string }): Promise<{ hook: Webhook; secret: string }> {
  await initSchema()
  const secret = 'whsec_' + randomToken(24)
  const res = await query('INSERT INTO webhooks (id, org_id, url, events, secret_enc, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [randomUUID(), orgId, input.url, JSON.stringify(input.events), encrypt(secret), input.createdBy])
  return { hook: rowToHook(res.rows[0]), secret }
}

export async function deleteWebhook(orgId: string, id: string): Promise<boolean> {
  await initSchema()
  return ((await query('DELETE FROM webhooks WHERE id=$1 AND org_id=$2', [id, orgId])).rowCount ?? 0) > 0
}

export async function enableWebhook(orgId: string, id: string): Promise<boolean> {
  await initSchema()
  return ((await query('UPDATE webhooks SET disabled_at=NULL, consecutive_failures=0 WHERE id=$1 AND org_id=$2', [id, orgId])).rowCount ?? 0) > 0
}

/* ─── Delivery ───────────────────────────────────────── */

export function sign(secret: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`
}

async function post(url: string, body: string, headers: Record<string, string>): Promise<{ ok: boolean; status: string }> {
  const problem = await urlProblem(url)
  if (problem) return { ok: false, status: `blocked: ${problem}` }
  try {
    const res = await fetch(url, { method: 'POST', body, headers: { 'content-type': 'application/json', 'user-agent': 'Planora-Webhooks/1', ...headers }, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) })
    return { ok: res.status >= 200 && res.status < 300, status: String(res.status) }
  } catch (err) {
    return { ok: false, status: (err as Error).name === 'TimeoutError' ? 'timeout' : 'network error' }
  }
}

export interface OutboundEvent { id: string; action: string; at: string; targetType: string | null; targetId: string | null; detail: Record<string, unknown>; actorEmail: string | null }

export async function deliverToWebhook(h: Webhook & { secret: string }, orgId: string, e: OutboundEvent): Promise<{ ok: boolean; status: string }> {
  const body = JSON.stringify({ id: e.id, event: e.action, occurredAt: e.at, organizationId: orgId, data: { targetType: e.targetType, targetId: e.targetId, detail: e.detail, actor: e.actorEmail } })
  const r = await post(h.url, body, { 'x-planora-event': e.action, 'x-planora-delivery': e.id, 'x-planora-signature': sign(h.secret, body) })
  await query(`UPDATE webhooks SET last_delivery_at=NOW(), last_status=$2,
      consecutive_failures = CASE WHEN $3 THEN 0 ELSE consecutive_failures + 1 END,
      disabled_at = CASE WHEN NOT $3 AND consecutive_failures + 1 >= $4 THEN NOW() ELSE disabled_at END
    WHERE id=$1`, [h.id, r.status, r.ok, MAX_FAILURES])
  return r
}

async function dispatchNow(orgId: string, events: OutboundEvent[]) {
  const wanted = events.filter(e => isWebhookEvent(e.action))
  if (wanted.length) {
    const hooks = (await query('SELECT * FROM webhooks WHERE org_id=$1 AND disabled_at IS NULL', [orgId])).rows
    for (const row of hooks) {
      const h = { ...rowToHook(row), secret: decrypt(String(row.secret_enc)) }
      for (const e of wanted) if (h.events.includes(e.action as WebhookEvent)) await deliverToWebhook(h, orgId, e)
    }
  }
  const alertUrl = process.env.PLANORA_ALERT_WEBHOOK_URL
  for (const e of events.filter(x => SECURITY_ALERT_EVENTS.has(x.action))) {
    if (!alertUrl) { log('warn', 'security alert', { action: e.action, orgId, targetType: e.targetType, targetId: e.targetId }); continue }
    // Slack/Teams-compatible "text" plus structured fields; no secrets or content.
    const body = JSON.stringify({ text: `Planora security alert: ${e.action} (org ${orgId}${e.actorEmail ? `, by ${e.actorEmail}` : ''}) at ${e.at}`, event: e.action, organizationId: orgId, targetType: e.targetType, targetId: e.targetId, at: e.at })
    const r = await post(alertUrl, body, {})
    if (!r.ok) log('error', 'security alert delivery failed', { action: e.action, status: r.status })
  }
}

/** Sends audit events to subscribed webhooks and the alert channel after the response, never blocking the user. */
export function dispatchEvents(orgId: string, events: OutboundEvent[]): void {
  const run = () => dispatchNow(orgId, events).catch(err => log('error', 'webhook dispatch failed', errorFields(err)))
  try { after(run) } catch { void run() }
}
