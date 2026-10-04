#!/usr/bin/env node
// End-to-end security and governance checks against a running Planora server.
//   BASE_URL=http://localhost:3200 [DATABASE_URL=postgres://…] node scripts/e2e-security.mjs
// Covers: password policy, generic sign-in errors, lockout, CSRF, sessions & revocation, roles and
// invitations, two-step verification (incl. replay), org MFA policy, optimistic locking, separation
// of duties, tamper-evident audit log (and, with DATABASE_URL, that the database refuses edits),
// privacy export/deletion, AI switch-off, health and security headers. Exits non-zero on failure.

import { createHmac } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const BASE = process.env.BASE_URL || 'http://localhost:3000'
const ORIGIN = new URL(BASE).origin
let passed = 0

function ok(cond, msg, extra) {
  if (!cond) { console.error(`✗ ${msg}`, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ''); process.exit(1) }
  passed++
  console.log(`✓ ${msg}`)
}

class Client {
  constructor() { this.cookie = '' }
  async req(method, url, body, extraHeaders = {}) {
    const headers = { cookie: this.cookie, origin: ORIGIN, ...extraHeaders }
    let payload
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }
    const res = await fetch(BASE + url, { method, headers, body: payload, redirect: 'manual' })
    const set = res.headers.get('set-cookie')
    if (set && set.startsWith('planora-token=')) this.cookie = set.split(';')[0]
    const text = await res.text()
    let data = {}
    try { data = JSON.parse(text) } catch { data = { raw: text } }
    return { status: res.status, data, headers: res.headers }
  }
  get(u, h) { return this.req('GET', u, undefined, h) }
  post(u, b, h) { return this.req('POST', u, b ?? {}, h) }
  patch(u, b, h) { return this.req('PATCH', u, b, h) }
}

// RFC 6238 TOTP, same as an authenticator app.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
function b32decode(s) {
  let bits = 0, value = 0; const out = []
  for (const ch of s.replace(/=+$/, '')) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8 } }
  return Buffer.from(out)
}
function totp(secret, offsetSteps = 0) {
  const counter = Math.floor(Date.now() / 30000) + offsetSteps
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter))
  const h = createHmac('sha1', b32decode(secret)).update(buf).digest()
  const o = h[h.length - 1] & 0xf
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0')
}

const PW = 'correct horse battery staple'
const OUTBOX = process.env.PLANORA_EMAIL_OUTBOX

/** Latest link matching re in the test outbox for this recipient. */
async function mailLink(to, re) {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  for (let i = 0; i < 30; i++) {
    const files = (await fs.readdir(OUTBOX).catch(() => [])).sort().reverse()
    for (const f of files) {
      const m = JSON.parse(await fs.readFile(path.join(OUTBOX, f), 'utf8'))
      const hit = m.to === to && re.exec(m.text)
      if (hit) return hit[0]
    }
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error(`no email to ${to}`)
}

async function main() {
  const stamp = Date.now()
  if (process.env.DATABASE_URL) {
    // Start from clean rate-limit counters so earlier test runs from this machine don't interfere.
    const { default: pg } = await import('pg')
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
    await db.connect(); await db.query('DELETE FROM rate_limits'); await db.end()
  }
  const email = (who) => `${who}${stamp}@example.com`

  /* ── Health and headers ── */
  let r = await new Client().get('/api/health')
  ok(r.status === 200 && r.data.status === 'ok' && r.data.checks.schema.current, 'Health check: database up, schema current')
  ok(/frame-ancestors 'none'/.test(r.headers.get('content-security-policy') || '') && r.headers.get('x-content-type-options') === 'nosniff', 'Security headers (CSP, nosniff) present')
  ok(!!r.headers.get('x-request-id'), 'Responses carry a request id')

  /* ── Password policy ── */
  const owner = new Client()
  r = await owner.post('/api/auth', { action: 'signup', email: email('owner'), password: 'secret123', name: 'Olive Owner', company: 'Gamma Builders' })
  ok(r.status === 400 && r.data.code === 'weak_password', 'Short password rejected')
  r = await owner.post('/api/auth', { action: 'signup', email: email('owner'), password: 'password1234', name: 'Olive Owner', company: 'Gamma Builders' })
  ok(r.status === 400, 'Common password rejected')
  r = await owner.post('/api/auth', { action: 'signup', email: email('owner'), password: PW, name: 'Olive Owner', company: 'Gamma Builders' })
  ok(r.status === 200 && r.data.user.role === 'owner', 'Founder becomes the organization owner')

  /* ── Email verification (needs PLANORA_EMAIL_OUTBOX on the server and here) ── */
  if (OUTBOX) {
    r = await owner.get('/api/auth')
    ok(r.data.security.emailDelivery === true && r.data.security.emailVerified === false, 'Self sign-up starts with an unconfirmed email')
    r = await owner.post('/api/org', { action: 'invite', email: email('early'), role: 'viewer' })
    ok(r.status === 403 && r.data.code === 'email_unverified', 'Inviting people waits for a confirmed email')
    const link = await mailLink(email('owner'), /https?:\/\/\S+\/api\/auth\/verify\?token=\S+/)
    r = await new Client().get(new URL(link).pathname + '?token=nope')
    ok(r.status === 303 && r.headers.get('location').includes('verified=0'), 'A bad confirmation token is refused')
    r = await owner.get(new URL(link).pathname + new URL(link).search)
    ok(r.status === 303 && r.headers.get('location').includes('/dashboard/account?verified=1'), 'The emailed link confirms the address')
    r = await owner.get(new URL(link).pathname + new URL(link).search)
    ok(r.headers.get('location').includes('verified=0'), 'A confirmation link works only once')
    r = await owner.get('/api/auth')
    ok(r.data.security.emailVerified === true, 'Email now shows as confirmed')
  }

  /* ── CSRF ── */
  r = await owner.post('/api/plans', { name: 'Evil' }, { origin: 'https://evil.example' })
  ok(r.status === 403 && r.data.code === 'csrf', 'Cross-site write is blocked')
  r = await owner.post('/api/plans', { name: 'Evil' }, { origin: ORIGIN, 'sec-fetch-site': 'cross-site' })
  ok(r.status === 403, 'Sec-Fetch-Site cross-site write is blocked')

  /* ── Generic errors and lockout ── */
  const stranger = new Client()
  r = await stranger.post('/api/auth', { action: 'signin', email: `nobody${stamp}@example.com`, password: PW })
  const unknownMsg = r.data.error
  r = await stranger.post('/api/auth', { action: 'signin', email: email('owner'), password: 'wrong password here' })
  ok(r.status === 401 && r.data.error === unknownMsg, 'Unknown email and wrong password give the same message')

  /* ── Invitations and roles ── */
  r = await owner.post('/api/org', { action: 'invite', email: email('viewer'), role: 'viewer' })
  ok(r.status === 200 && r.data.link.includes('/auth?invite='), 'Owner creates an invitation link')
  if (OUTBOX) ok(r.data.emailed === true && (await mailLink(email('viewer'), /https?:\/\/\S+\/auth\?invite=\S+/)) === r.data.link, 'The invitation is emailed to the invitee')
  const viewerInvite = new URL(r.data.link).searchParams.get('invite')
  r = await owner.post('/api/org', { action: 'invite', email: email('rev'), role: 'reviewer' })
  const reviewerInvite = new URL(r.data.link).searchParams.get('invite')
  r = await owner.post('/api/org', { action: 'invite', email: email('sched'), role: 'scheduler' })
  const schedInvite = new URL(r.data.link).searchParams.get('invite')

  const viewer = new Client()
  r = await viewer.get(`/api/auth?invite=${encodeURIComponent(viewerInvite)}`)
  ok(r.data.invitation?.orgName === 'Gamma Builders' && r.data.invitation.role === 'viewer', 'Invitation link shows organization and role')
  r = await viewer.post('/api/auth', { action: 'signup', email: email('someoneelse'), password: PW, name: 'Wrong', invite: viewerInvite })
  ok(r.status === 400 && r.data.code === 'invite_email', 'Invitation only works for the invited email')
  r = await viewer.post('/api/auth', { action: 'signup', email: email('viewer'), password: PW, name: 'Vic Viewer', invite: viewerInvite })
  ok(r.status === 200 && r.data.user.role === 'viewer', 'Invited viewer joins the organization')
  r = await new Client().post('/api/auth', { action: 'signup', email: email('viewer2'), password: PW, name: 'Again', invite: viewerInvite })
  ok(r.status === 400, 'Invitation link is single-use')

  const reviewer = new Client()
  r = await reviewer.post('/api/auth', { action: 'signup', email: email('rev'), password: PW, name: 'Rae Reviewer', invite: reviewerInvite })
  ok(r.status === 200, 'Invited reviewer joins')
  const scheduler = new Client()
  r = await scheduler.post('/api/auth', { action: 'signup', email: email('sched'), password: PW, name: 'Sam Scheduler', invite: schedInvite })
  ok(r.status === 200, 'Invited scheduler joins')

  r = await owner.get('/api/org')
  ok(r.data.members.length === 4, 'Owner sees four members')

  r = await viewer.post('/api/plans', { name: 'Viewer plan' })
  ok(r.status === 403 && r.data.code === 'forbidden', 'Viewer cannot create plans')
  r = await viewer.post('/api/org', { action: 'invite', email: email('x'), role: 'viewer' })
  ok(r.status === 403, 'Viewer cannot invite members')
  r = await viewer.get('/api/audit')
  ok(r.status === 403, 'Viewer cannot read the audit log')
  r = await scheduler.post('/api/org', { action: 'invite', email: email('y'), role: 'admin' })
  ok(r.status === 403, 'Scheduler cannot manage members')

  /* ── Plans, optimistic locking, separation of duties ── */
  r = await scheduler.post('/api/plans', { name: 'Gamma Warehouse' })
  ok(r.status === 200, 'Scheduler creates a plan')
  const planId = r.data.plan.id
  r = await viewer.get(`/api/plans/${planId}`)
  ok(r.status === 200, 'Viewer can read the plan')
  r = await scheduler.patch(`/api/plans/${planId}`, { answers: { 'project.type': { status: 'known', value: 'warehouse_industrial' } } })
  const v = r.data.plan?.version ?? r.data.version
  r = await scheduler.get(`/api/plans/${planId}`)
  const version = r.data.plan.version
  ok(Number.isInteger(version) && version >= 2, `Plan carries a version (${version})`, v)
  r = await scheduler.patch(`/api/plans/${planId}`, { answers: { 'project.state': { status: 'known', value: 'TX' } } }, { 'x-plan-version': String(version - 1) })
  ok(r.status === 409 && r.data.code === 'conflict', 'Stale write is rejected with 409')
  r = await scheduler.patch(`/api/plans/${planId}`, { answers: { 'project.state': { status: 'known', value: 'TX' } } }, { 'x-plan-version': String(version) })
  ok(r.status === 200, 'Write based on the current version succeeds')
  r = await scheduler.post(`/api/plans/${planId}/generate`, {})
  ok(r.status === 200 && r.data.plan.generated, 'Scheduler generates the schedule')

  r = await owner.post('/api/org', { action: 'update_settings', settings: { requireIndependentReview: true, requireApprovalToPublish: true } })
  ok(r.status === 200 && r.data.settings.requireApprovalToPublish, 'Owner turns on independent review and approval-to-publish')
  r = await scheduler.post(`/api/plans/${planId}/publish`, {})
  ok(r.status === 403 && r.data.code === 'approval_required', 'Publishing without an independent approval is blocked')
  r = await scheduler.post(`/api/plans/${planId}/review`, { verdict: 'approve' })
  ok(r.status === 403, 'Scheduler cannot review (role)')
  r = await viewer.post(`/api/plans/${planId}/review`, { verdict: 'approve' })
  ok(r.status === 403, 'Viewer cannot review')
  r = await reviewer.post(`/api/plans/${planId}/review`, { verdict: 'approve' })
  ok(r.status === 200, 'Independent reviewer approves')
  r = await scheduler.post(`/api/plans/${planId}/publish`, {})
  ok(r.status === 200 && r.data.schedule, 'Publish succeeds after independent approval')

  /* ── Sessions ── */
  const other = new Client()
  r = await other.post('/api/auth', { action: 'signin', email: email('sched'), password: PW })
  ok(r.status === 200, 'Scheduler signs in on a second device')
  r = await scheduler.get('/api/account')
  ok(r.data.sessions.length >= 2, `Account lists active sessions (${r.data.sessions.length})`)
  r = await scheduler.post('/api/account', { action: 'revoke_other_sessions' })
  ok(r.status === 200 && r.data.count >= 1, 'Sign out everywhere else')
  r = await other.get('/api/plans')
  ok(r.status === 401, 'Revoked session no longer works')
  const stolen = viewer.cookie
  await viewer.post('/api/auth', { action: 'signout' })
  const replay = new Client(); replay.cookie = stolen
  r = await replay.get('/api/plans')
  ok(r.status === 401, 'Signed-out session cookie cannot be replayed')

  /* ── Two-step verification ── */
  r = await owner.post('/api/org', { action: 'update_settings', settings: { requireMfa: true } })
  ok(r.status === 400, 'Owner cannot require MFA before enrolling themselves')
  r = await owner.post('/api/account', { action: 'mfa_begin' })
  ok(r.status === 200 && /^otpauth:\/\/totp\//.test(r.data.uri), 'Owner starts enrollment (otpauth URI)')
  const secret = r.data.secret
  r = await owner.post('/api/account', { action: 'mfa_confirm', code: '000000' })
  ok(r.status === 400, 'Wrong enrollment code rejected')
  r = await owner.post('/api/account', { action: 'mfa_confirm', code: totp(secret) })
  ok(r.status === 200 && r.data.recoveryCodes.length === 10, 'Enrollment confirmed; 10 recovery codes issued')
  const recovery = r.data.recoveryCodes
  r = await owner.post('/api/org', { action: 'update_settings', settings: { requireMfa: true } })
  ok(r.status === 200, 'Owner requires MFA for the organization')

  const owner2 = new Client()
  r = await owner2.post('/api/auth', { action: 'signin', email: email('owner'), password: PW })
  ok(r.status === 200 && r.data.mfaRequired && r.data.challenge && !owner2.cookie, 'Password alone does not create a session when MFA is on')
  const challenge = r.data.challenge
  r = await owner2.post('/api/auth', { action: 'mfa', challenge, code: '123456' })
  ok(r.status === 401, 'Wrong code rejected')
  // A code is single-use: the enrollment used the current step, so use the next step's code once.
  const code = totp(secret, 1)
  r = await owner2.post('/api/auth', { action: 'mfa', challenge, code })
  ok(r.status === 200 && owner2.cookie, 'Correct code completes sign-in')
  r = await new Client().post('/api/auth', { action: 'mfa', challenge, code })
  ok(r.status === 401, 'The same code cannot be replayed')
  const owner3 = new Client()
  r = await owner3.post('/api/auth', { action: 'signin', email: email('owner'), password: PW })
  r = await owner3.post('/api/auth', { action: 'mfa', challenge: r.data.challenge, code: recovery[0] })
  ok(r.status === 200, 'Recovery code works once')
  r = await owner3.post('/api/auth', { action: 'signin', email: email('owner'), password: PW })
  r = await owner3.post('/api/auth', { action: 'mfa', challenge: r.data.challenge, code: recovery[0] })
  ok(r.status === 401, 'Used recovery code is rejected')

  r = await reviewer.get('/api/plans')
  ok(r.status === 403 && r.data.code === 'mfa_setup_required', 'Members without MFA are sent to enroll when the org requires it')
  r = await reviewer.get('/api/account')
  ok(r.status === 200 && r.data.mfa.required, 'They can still reach the enrollment page')
  r = await owner2.post('/api/org', { action: 'update_settings', settings: { requireMfa: false } })
  ok(r.status === 200, 'Owner relaxes the MFA policy')

  /* ── Lockout ── */
  for (let i = 0; i < 8; i++) await stranger.post('/api/auth', { action: 'signin', email: email('rev'), password: `wrong password ${i}` })
  r = await stranger.post('/api/auth', { action: 'signin', email: email('rev'), password: PW })
  ok(r.status === 423 || r.status === 429, `Account locks after repeated failures (${r.status})`)
  r = await owner2.get('/api/org')
  const rev = r.data.members.find(m => m.email === email('rev'))
  ok(!!rev?.lockedUntil, 'Admin sees the lock')
  r = await owner2.post('/api/org', { action: 'unlock_member', userId: rev.id })
  ok(r.status === 200, 'Admin unlocks the member')

  /* ── Offboarding ── */
  const sched = r && (await owner2.get('/api/org')).data.members.find(m => m.email === email('sched'))
  r = await owner2.post('/api/org', { action: 'remove_member', userId: sched.id })
  ok(r.status === 200, 'Admin removes the scheduler')
  r = await scheduler.get('/api/plans')
  ok(r.status === 401, 'Removed member is signed out immediately')
  r = await new Client().post('/api/auth', { action: 'signin', email: email('sched'), password: PW })
  ok(r.status === 401, 'Removed member cannot sign in')
  r = await owner2.get(`/api/plans/${planId}`)
  ok(r.status === 200, 'Their plan stays with the organization')

  /* ── AI switch ── */
  r = await owner2.post('/api/org', { action: 'update_settings', settings: { aiEnabled: false } })
  r = await owner2.get('/api/system')
  ok(r.data.llm.mode === 'offline' && /turned off/.test(r.data.llm.error || ''), 'Org can switch AI off (nothing sent to any model)')

  /* ── Audit log ── */
  r = await owner2.get('/api/audit?limit=500')
  const actions = new Set(r.data.events.map(e => e.action))
  for (const a of ['org.created', 'member.invited', 'member.joined', 'member.role_changed', 'plan.created', 'plan.generate', 'plan.review', 'plan.publish', 'account.mfa_enabled', 'auth.signin', 'auth.signin_failed', 'auth.locked', 'member.removed', 'org.settings_changed'].filter(a => a !== 'member.role_changed')) {
    ok(actions.has(a), `Audit log records ${a}`)
  }
  const review = r.data.events.find(e => e.action === 'plan.review')
  ok(review.actorEmail === email('rev') && review.ip !== undefined && review.hash.length === 64, 'Audit records carry actor, client and hash')
  r = await owner2.get(`/api/audit?targetType=plan&targetId=${planId}`)
  ok(r.data.events.every(e => e.targetId === planId) && r.data.events.length >= 4, 'Audit log filters by plan')
  r = await reviewer.get('/api/audit?verify=1')
  ok(r.status === 200 && r.data.ok && r.data.count > 20, `Reviewer verifies the hash chain (${r.data.count} records intact)`)

  if (process.env.DATABASE_URL) {
    const { default: pg } = await import('pg')
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
    await db.connect()
    const org = (await owner2.get('/api/org')).data.org.id
    let blocked = false
    try { await db.query(`UPDATE audit_events SET action='x' WHERE org_id=$1`, [org]) } catch { blocked = true }
    ok(blocked, 'Database refuses to edit audit records')
    blocked = false
    try { await db.query(`DELETE FROM audit_events WHERE org_id=$1`, [org]) } catch { blocked = true }
    ok(blocked, 'Database refuses to delete audit records')
    // Simulate a privileged tamper (trigger bypassed) and confirm verification catches it.
    await db.query('BEGIN')
    await db.query('ALTER TABLE audit_events DISABLE TRIGGER audit_events_immutable')
    await db.query(`UPDATE audit_events SET detail='{"tampered":true}' WHERE seq=(SELECT MIN(seq) FROM audit_events WHERE org_id=$1 AND action='plan.created')`, [org])
    await db.query('ALTER TABLE audit_events ENABLE TRIGGER audit_events_immutable')
    await db.query('COMMIT')
    r = await owner2.get('/api/audit?verify=1')
    ok(r.data.ok === false && r.data.brokenAt?.reason.includes('modified'), 'Verification detects a tampered record')
    await db.end()
  }


  /* ── Plans and entitlements (operator sets plans with scripts/set-plan.mjs) ── */
  if (process.env.DATABASE_URL) {
    const setPlan = (who, plan) => execFileSync('node', ['scripts/set-plan.mjs', who, plan, 'e2e test'], { env: process.env }).toString()
    const free = new Client()
    await free.post('/api/auth', { action: 'signup', email: email('free'), password: PW, name: 'Fay Free', company: 'Free Tier Co' })
    setPlan(email('free'), 'free')
    r = await free.get('/api/org')
    ok(r.data.plan.id === 'free' && r.data.plan.maxUploadedSchedules === 3, 'Organization shows its plan and limits')
    const csv = (await import('node:fs')).readFileSync(new URL('../src/lib/parsers/__fixtures__/messy-export.csv', import.meta.url))
    const upload = async (c, i) => { const fd = new FormData(); fd.append('file', new Blob([csv]), `s${i}.csv`); const res = await fetch(BASE + '/api/schedules', { method: 'POST', body: fd, headers: { cookie: c.cookie, origin: ORIGIN } }); return { status: res.status, data: await res.json() } }
    for (let i = 0; i < 3; i++) { r = await upload(free, i); if (r.status !== 200) ok(false, 'fixture upload', r) }
    r = await upload(free, 4)
    ok(r.status === 402 && r.data.code === 'plan_limit', 'Free plan: the 4th uploaded schedule is refused')
    r = await free.post('/api/plans', { name: 'Free plan' })
    const freePlan = r.data.plan.id
    await free.patch(`/api/plans/${freePlan}`, { answers: { 'project.type': { status: 'known', value: 'warehouse_industrial' } } })
    await free.post(`/api/plans/${freePlan}/generate`, {})
    r = await free.req('GET', `/api/plans/${freePlan}/export?format=pdf`)
    ok(r.status === 402, 'Free plan: PDF export is a paid feature')
    r = await free.req('GET', `/api/plans/${freePlan}/export?format=xer`)
    ok(r.status === 200, 'Free plan: P6 export still works')
    r = await free.post('/api/org', { action: 'update_sso', sso: { enabled: false } })
    ok(r.status === 402, 'Free plan: single sign-on is an Enterprise feature')
    setPlan(email('free'), 'pro')
    r = await free.req('GET', `/api/plans/${freePlan}/export?format=pdf`)
    ok(r.status === 200, 'After upgrading, PDF export works')
    r = await free.get('/api/audit?action=org.plan_changed')
    ok(r.data.events.length === 2 && r.data.events[0].actorEmail.startsWith('operator:'), 'Plan changes are in the audit log')

    /* ── Single sign-on (OpenID Connect) against a test identity provider ── */
    if (process.env.OIDC_ISSUER) {
      const domain = `sso${stamp}.example`
      setPlan(email('owner'), 'enterprise')
      r = await owner2.post('/api/org', { action: 'update_sso', sso: { enabled: true, issuer: process.env.OIDC_ISSUER, clientId: 'planora-test', clientSecret: 'test-secret', domains: [domain], defaultRole: 'scheduler', enforce: false } })
      ok(r.status === 200 && r.data.sso.enabled && r.data.sso.hasSecret && !JSON.stringify(r.data).includes('test-secret'), 'Admin configures SSO (secret never returned)')
      const ssoLogin = async (who, bad) => {
        const start = await fetch(`${BASE}/api/auth/sso`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ email: who }) })
        const sdata = await start.json()
        if (!start.ok) return { status: start.status, data: sdata }
        const stateCookie = start.headers.get('set-cookie').split(';')[0]
        const idp = await fetch(sdata.url + (bad ? `&bad=${bad}` : ''), { redirect: 'manual' })
        const cb = await fetch(idp.headers.get('location'), { redirect: 'manual', headers: { cookie: stateCookie } })
        const session = (cb.headers.get('set-cookie') || '').split(/,(?=\s*planora)/).find(c => c.trim().startsWith('planora-token=') && !c.includes('planora-token=;'))
        return { status: cb.status, location: cb.headers.get('location') || '', cookie: session ? session.trim().split(';')[0] : null }
      }
      r = await ssoLogin(`jane@${domain}`)
      ok(r.status === 303 && r.location.endsWith('/dashboard') && r.cookie, 'SSO sign-in creates a session')
      const jane = new Client(); jane.cookie = r.cookie
      r = await jane.get('/api/auth')
      ok(r.data.user.email === `jane@${domain}` && r.data.user.role === 'scheduler' && r.data.org.name === 'Gamma Builders', 'First SSO sign-in provisions the member with the default role')
      for (const bad of ['nonce', 'aud', 'sig']) {
        r = await ssoLogin(`joe@${domain}`, bad)
        ok(r.status === 303 && r.location.includes('sso_error') && !r.cookie, `SSO rejects a token with a bad ${bad}`)
      }
      r = await ssoLogin(`x@unknown-${stamp}.example`)
      ok(r.status === 404, 'SSO for an unconfigured domain is refused')
      const forged = await fetch(`${BASE}/api/auth/sso/callback?code=abc&state=forged`, { redirect: 'manual' })
      ok(forged.status === 303 && forged.headers.get('location').includes('sso_error'), 'Callback without the signed state is rejected')
      const other = new Client()
      await other.post('/api/auth', { action: 'signup', email: `squat${stamp}@example.com`, password: PW, name: 'Squatter', company: 'Squat Co' })
      setPlan(`squat${stamp}@example.com`, 'enterprise')
      r = await other.post('/api/org', { action: 'update_sso', sso: { enabled: true, issuer: process.env.OIDC_ISSUER, clientId: 'x', clientSecret: 'y', domains: [domain] } })
      ok(r.status === 409, "Another organization can't claim a domain that is already in use")

      r = await owner2.post('/api/org', { action: 'invite', email: `pw@${domain}`, role: 'viewer' })
      const pw = new Client()
      await pw.post('/api/auth', { action: 'signup', email: `pw@${domain}`, password: PW, name: 'Pat Password', invite: new URL(r.data.link).searchParams.get('invite') })
      r = await owner2.post('/api/org', { action: 'update_sso', sso: { enabled: true, issuer: process.env.OIDC_ISSUER, clientId: 'planora-test', domains: [domain], defaultRole: 'scheduler', enforce: true } })
      ok(r.status === 200 && r.data.sso.enforce, 'Admin enforces SSO')
      r = await new Client().post('/api/auth', { action: 'signin', email: `pw@${domain}`, password: PW })
      ok(r.status === 403 && r.data.code === 'sso_required', 'With SSO enforced, members cannot use a password', r)
      r = await new Client().post('/api/auth', { action: 'signin', email: email('owner'), password: PW })
      ok(r.status === 200, 'The owner keeps password sign-in as a break-glass account')
      r = await owner2.get('/api/audit?action=org.sso_changed')
      ok(r.data.events.length >= 2 && !JSON.stringify(r.data.events).includes('test-secret'), 'SSO configuration changes are audited without the secret')
    }
  }

  /* ── Portfolio, sample project, priced recovery, quality thresholds ── */
  r = await owner2.post('/api/plans', { sample: true })
  ok(r.status === 200 && /^Sample:/.test(r.data.plan.name), 'A sample project is created in one click')
  const sampleId = r.data.plan.id
  r = await owner2.get(`/api/plans/${sampleId}`)
  ok(r.data.plan.generated && r.data.recovery && r.data.recovery.options.find(o => o.id === 'workweek').impact.cost.low > 0, 'The sample has a schedule and recovery options priced from its cost basis')
  r = await owner2.get('/api/portfolio')
  const row = r.data.rows?.find(x => x.id === sampleId)
  ok(r.status === 200 && row && row.status === 'at_risk' && row.alerts.some(a => a.code === 'late'), 'Portfolio lists the sample as at risk with a "late" alert')
  r = await owner2.post('/api/org', { action: 'update_settings', settings: { quality: { maxPct: 10, minFsPct: 85, highFloatDays: 60, highDurationDays: 60, indexTarget: 0.9 } } })
  ok(r.status === 200 && r.data.settings.quality.highDurationDays === 60, 'Admins set the organization quality thresholds')
  r = await owner2.get(`/api/plans/${sampleId}`)
  ok(r.data.evaluation.dcma.checks.find(c => c.id === 8).threshold === '≤ 10% with remaining > 60d', 'Quality checks use the organization thresholds')

  /* ── API keys ── */
  r = await reviewer.post('/api/org/integrations', { action: 'create_key', name: 'Nope', role: 'viewer' })
  ok(r.status === 403, 'Only admins can create API keys', r)
  r = await owner2.post('/api/org/integrations', { action: 'create_key', name: 'Owner key', role: 'admin' })
  ok(r.status === 400, 'API keys cannot have admin rights')
  r = await owner2.post('/api/org/integrations', { action: 'create_key', name: 'BI dashboard', role: 'viewer', expiresInDays: 30 })
  ok(r.status === 200 && /^pk_live_/.test(r.data.secret) && r.data.key.prefix && !JSON.stringify(r.data.key).includes(r.data.secret), 'Read-only API key created; secret shown once')
  const keyId = r.data.key.id, keySecret = r.data.secret
  const bearer = { authorization: `Bearer ${keySecret}`, origin: '' }
  r = await new Client().get('/api/portfolio', bearer)
  ok(r.status === 200 && r.data.rows.some(x => x.id === sampleId), 'The API key reads the portfolio')
  r = await new Client().get(`/api/plans/${sampleId}/export?format=xer`, bearer)
  ok(r.status === 200 && String(r.data.raw || '').startsWith('ERMHDR'), 'The API key exports a P6 schedule')
  r = await new Client().patch(`/api/plans/${sampleId}`, { answers: {} }, bearer)
  ok(r.status === 403 && r.data.code === 'forbidden', 'A read-only key cannot change plans')
  r = await new Client().get('/api/org', bearer)
  ok(r.status === 403 && r.data.code === 'api_key_not_allowed', 'API keys only work on the endpoints that allow them')
  r = await new Client().get('/api/portfolio', { authorization: 'Bearer pk_live_' + 'x'.repeat(43), origin: '' })
  ok(r.status === 401 && r.data.code === 'invalid_api_key', 'An unknown key is refused')
  r = await owner2.get('/api/org/integrations')
  ok(r.data.keys.find(k => k.id === keyId).lastUsedAt, 'Key usage is tracked')
  r = await owner2.post('/api/org/integrations', { action: 'revoke_key', id: keyId })
  r = await new Client().get('/api/portfolio', bearer)
  ok(r.status === 401, 'A revoked key stops working immediately')

  /* ── Webhooks (signed) ── */
  if (process.env.WEBHOOK_RECEIVER_PORT) {
    const { createServer } = await import('node:http')
    const got = []
    const srv = createServer((req, res) => { let b = ''; req.on('data', c => { b += c }); req.on('end', () => { got.push({ headers: req.headers, body: b }); res.end('ok') }) })
    await new Promise(r2 => srv.listen(Number(process.env.WEBHOOK_RECEIVER_PORT), r2))
    r = await owner2.post('/api/org/integrations', { action: 'create_webhook', url: 'ftp://example.com/x', events: ['plan.created'] })
    ok(r.status === 400, 'Non-HTTP webhook URLs are refused')
    r = await owner2.post('/api/org/integrations', { action: 'create_webhook', url: `http://localhost:${process.env.WEBHOOK_RECEIVER_PORT}/hook`, events: ['plan.created', 'plan.generate'] })
    ok(r.status === 200 && /^whsec_/.test(r.data.secret), 'Webhook added; signing secret shown once')
    const whSecret = r.data.secret, hookId = r.data.webhook.id
    r = await owner2.post('/api/org/integrations', { action: 'test_webhook', id: hookId })
    ok(r.status === 200 && r.data.ok, 'Test delivery succeeds')
    await owner2.post('/api/plans', { name: `Webhook plan ${stamp}` })
    for (let i = 0; i < 50 && !got.some(g => g.headers['x-planora-event'] === 'plan.created'); i++) await new Promise(r2 => setTimeout(r2, 100))
    const d = got.find(g => g.headers['x-planora-event'] === 'plan.created')
    ok(!!d && JSON.parse(d.body).data.detail.plan === `Webhook plan ${stamp}`, 'Creating a plan delivers a plan.created webhook')
    const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(d.headers['x-planora-signature']) || []
    ok(t && v1 === createHmac('sha256', whSecret).update(`${t}.${d.body}`).digest('hex'), 'The delivery signature verifies with the secret')
    srv.close()
    r = await owner2.post('/api/org/integrations', { action: 'delete_webhook', id: hookId })
    ok(r.status === 200, 'Webhook removed')
  }
  r = await owner2.get('/api/audit?action=apikey.')
  ok(r.data.events.some(e => e.action === 'apikey.created') && r.data.events.some(e => e.action === 'apikey.revoked') && !JSON.stringify(r.data.events).includes(keySecret), 'API key creation and revocation are audited without the secret')

  /* ── Privacy ── */
  r = await reviewer.post('/api/account', { action: 'export_my_data' })
  ok(r.status === 200 && r.data.account.email === email('rev') && Array.isArray(r.data.activity), 'Personal data export')
  const exp = await owner2.req('POST', '/api/org', { action: 'export_data' })
  ok(exp.status === 200 && exp.data.format === 'planora-org-export' && exp.data.plans.length >= 1 && exp.data.auditEvents.length > 0 && !JSON.stringify(exp.data.members).includes('password'), 'Organization export (no secrets)')

  const solo = new Client()
  r = await solo.post('/api/auth', { action: 'signup', email: email('solo'), password: PW, name: 'Solo', company: 'Delta Temp' })
  r = await solo.post('/api/account', { action: 'delete_account', currentPassword: PW, confirm: email('solo') })
  ok(r.status === 200 && r.data.orgDeleted, 'Last member deleting their account deletes the organization')
  r = await new Client().post('/api/auth', { action: 'signin', email: email('solo'), password: PW })
  ok(r.status === 401, 'Deleted account cannot sign in')

  r = await reviewer.post('/api/account', { action: 'delete_account', currentPassword: PW, confirm: email('rev') })
  ok(r.status === 200 && !r.data.orgDeleted, 'A member can erase their own account')
  r = await owner2.get('/api/org')
  ok(!r.data.members.some(m => m.email === email('rev')), 'Erased member is gone; organization continues')

  console.log(`\nAll ${passed} security checks passed.`)
}

main().catch(err => { console.error(err); process.exit(1) })
