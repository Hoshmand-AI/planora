#!/usr/bin/env node
// End-to-end checks of the private beta gate against a running Planora server in its DEFAULT
// sign-up mode (invite-only: PLANORA_SIGNUP unset) with a platform operator configured.
//   BASE_URL=http://localhost:3001 BETA_ADMIN_EMAIL=ops@beta.test [DATABASE_URL=…] [PLANORA_EMAIL_OUTBOX=dir] node scripts/e2e-beta.mjs
// The server must run with PLANORA_PLATFORM_ADMINS containing BETA_ADMIN_EMAIL.
// Covers: self sign-up refused (no account created), landing page and /auth copy, platform operator
// invites a firm (link hashed at rest, single use, expiring, revocable), invitee gets a new
// organization as owner and invites a member, the member joins, non-operators get 404 on the
// operator endpoints, a person without beta access can't sign in, revoking access ends their
// sessions and restoring it lets them back, platform operators always pass, and the audit trail.
// Exits non-zero on failure.

const BASE = process.env.BASE_URL || 'http://localhost:3001'
const ORIGIN = new URL(BASE).origin
const ADMIN = (process.env.BETA_ADMIN_EMAIL || 'ops@beta.test').toLowerCase()
const OUTBOX = process.env.PLANORA_EMAIL_OUTBOX
const PW = 'correct horse battery staple'
const BETA_MESSAGE = 'Planora is in private beta. You need an invitation to sign in — ask your organization admin or request access.'
let passed = 0

function ok(cond, msg, extra) {
  if (!cond) { console.error(`✗ ${msg}`, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ''); process.exit(1) }
  passed++
  console.log(`✓ ${msg}`)
}

class Client {
  constructor() { this.cookie = ''; this.ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }
  async req(method, url, body, extraHeaders = {}) {
    const headers = { cookie: this.cookie, origin: ORIGIN, 'x-forwarded-for': this.ip, ...extraHeaders }
    let payload
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }
    const res = await fetch(BASE + url, { method, headers, body: payload, redirect: 'manual' })
    const set = res.headers.get('set-cookie')
    if (set && set.startsWith('planora-token=')) this.cookie = set.split(';')[0]
    const text = await res.text()
    let data = {}
    try { data = JSON.parse(text) } catch { data = { raw: text } }
    return { status: res.status, data, headers: res.headers, text }
  }
  get(u, h) { return this.req('GET', u, undefined, h) }
  post(u, b, h) { return this.req('POST', u, b ?? {}, h) }
}

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
  return null
}

async function main() {
  const stamp = Date.now()
  const email = who => `${who}${stamp}@beta-e2e.test`
  let db = null
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import('pg')
    db = new pg.Client({ connectionString: process.env.DATABASE_URL })
    await db.connect()
    await db.query('DELETE FROM rate_limits')
  }

  /* ── Mode and public copy ── */
  let r = await new Client().get('/api/auth')
  ok(r.status === 200 && r.data.signup?.mode === 'invite_only', 'The default sign-up mode is invite-only (private beta)')
  r = await new Client().get('/')
  ok(r.status === 200 && r.text.includes('Request access') && r.text.includes('Private beta') && !r.text.includes('Start Free') && !r.text.includes('No credit card'),
    'Landing page: "Request access" / "Sign in" and "Private beta · by invitation" instead of "Start Free" and "$0, no credit card"')

  /* ── Self sign-up is refused ── */
  const stranger = new Client()
  r = await stranger.post('/api/auth', { action: 'signup', email: email('stranger'), password: PW, name: 'Sam Stranger', company: 'Uninvited LLC' })
  ok(r.status === 403 && r.data.code === 'invite_only' && /private beta/.test(r.data.error), 'Sign-up without an invitation is refused (403, invite-only message)')
  r = await stranger.post('/api/auth', { action: 'signin', email: email('stranger'), password: PW })
  ok(r.status === 401, '…and no account was created')
  r = await stranger.post('/api/auth', { action: 'signup', email: email('bogus'), password: PW, name: 'Bo Gus', betaInvite: 'not-a-real-token' })
  ok(r.status === 400 && r.data.code === 'beta_invite_invalid', 'A made-up beta invitation is refused')
  r = await stranger.get('/api/platform/beta')
  ok(r.status === 401, 'Operator endpoint needs a session')

  /* ── Platform operator ── */
  const ops = new Client()
  r = await ops.post('/api/auth', { action: 'signup', email: ADMIN, password: PW, name: 'Olga Operator', company: 'Planora Operations' })
  if (r.status === 409) r = await ops.post('/api/auth', { action: 'signin', email: ADMIN, password: PW })
  ok(r.status === 200, 'A platform operator (PLANORA_PLATFORM_ADMINS) can create an account and sign in without an invitation', r.data)
  r = await ops.get('/api/auth')
  ok(r.data.platformAdmin === true, '/api/auth tells the operator they are one')
  if (r.data.security?.emailDelivery && !r.data.security?.emailVerified) {
    const v = new Client()
    r = await ops.get('/api/platform/beta')
    ok(r.status === 403 && r.data.code === 'email_unverified', 'Operator tools wait for a confirmed email')
    const link = OUTBOX && await mailLink(ADMIN, /https?:\/\/\S+\/api\/auth\/verify\?token=\S+/)
    ok(!!link, 'Operator confirmation email arrived')
    r = await v.get(new URL(link).pathname + new URL(link).search)
    ok(r.status === 303 && r.headers.get('location').includes('verified=1'), 'Operator confirms their email')
  }
  r = await ops.get('/api/platform/beta')
  ok(r.status === 200 && Array.isArray(r.data.invites) && Array.isArray(r.data.users) && r.data.signup.mode === 'invite_only', 'Operator sees beta invitations and accounts')
  r = await ops.get('/dashboard/platform')
  // Next.js streams pages, so a page's notFound() is shown as the 404 page (and marked as such in the payload).
  const notFoundPage = res => res.text.includes('NEXT_HTTP_ERROR_FALLBACK;404') || res.status === 404
  ok(r.status === 200 && !notFoundPage(r), 'Operator can open the Beta access page')

  /* ── Invite a firm ── */
  r = await ops.post('/api/platform/beta', { action: 'invite', email: email('Founder'), company: `Beta Builders ${stamp}` })
  ok(r.status === 200 && /\/auth\?beta=[\w-]{20,}$/.test(r.data.link) && r.data.expiresInDays === 14, 'Operator invites a new firm (single-use link, 14 days)', r.data)
  const founderLink = r.data.link
  const founderToken = new URL(founderLink).searchParams.get('beta')
  if (OUTBOX) ok(r.data.emailed === true && (await mailLink(email('founder'), /https?:\/\/\S+\/auth\?beta=\S+/)) === founderLink, 'The beta invitation is emailed to the invitee')
  if (db) {
    const row = (await db.query('SELECT token_hash FROM beta_invites WHERE email=$1', [email('founder')])).rows[0]
    const { createHash } = await import('node:crypto')
    ok(row.token_hash === createHash('sha256').update(founderToken).digest('hex') && !JSON.stringify(row).includes(founderToken), 'Only the SHA-256 of the token is stored')
    const leaks = (await db.query("SELECT COUNT(*)::int AS n FROM audit_events WHERE detail::text LIKE '%' || $1 || '%'", [founderToken])).rows[0].n
    ok(leaks === 0, 'The token never appears in the audit log')
  }
  r = await new Client().get(`/api/auth?beta=${encodeURIComponent(founderToken)}`)
  ok(r.data.betaInvitation?.email === email('founder') && r.data.betaInvitation?.company === `Beta Builders ${stamp}`, 'The sign-up page can show who the invitation is for')

  const founder = new Client()
  r = await founder.post('/api/auth', { action: 'signup', email: email('someoneelse'), password: PW, name: 'Wrong Person', betaInvite: founderToken })
  ok(r.status === 400 && r.data.code === 'invite_email', 'A beta invitation works only for its own address')
  r = await founder.post('/api/auth', { action: 'signup', email: email('founder'), password: PW, name: 'Fran Founder', betaInvite: founderToken })
  ok(r.status === 200 && r.data.user.role === 'owner', 'Invitee signs up with the beta invitation and owns the new firm', r.data)
  r = await founder.get('/api/auth')
  ok(r.data.org?.name === `Beta Builders ${stamp}` && r.data.security?.emailVerified === true && r.data.platformAdmin === false, 'A new organization was created with the invited company name; email counts as confirmed')
  const founderOrg = r.data.org.id
  r = await new Client().post('/api/auth', { action: 'signup', email: email('founder2'), password: PW, name: 'Again', betaInvite: founderToken })
  ok(r.status === 400 && r.data.code === 'beta_invite_invalid', 'A used beta invitation is refused')

  /* ── Non-operators get 404 ── */
  r = await founder.get('/api/platform/beta')
  ok(r.status === 404, 'A non-operator gets 404 from the operator endpoint')
  for (const action of ['invite', 'revoke_invite', 'revoke_access', 'restore_access']) {
    r = await founder.post('/api/platform/beta', { action, email: email('sneaky'), userId: 'x', id: 'x' })
    ok(r.status === 404, `…including POST ${action}`)
  }
  r = await founder.get('/dashboard/platform')
  ok(notFoundPage(r), 'A non-operator gets the 404 page for the Beta access page')
  ok(notFoundPage(await new Client().get('/dashboard/platform')), '…and so does a visitor who is not signed in')

  /* ── The new firm invites a member (organization invitations still work) ── */
  r = await founder.post('/api/org', { action: 'invite', email: email('member'), role: 'scheduler' })
  ok(r.status === 200 && r.data.link.includes('/auth?invite='), 'The new owner invites a colleague', r.data)
  const member = new Client()
  r = await member.post('/api/auth', { action: 'signup', email: email('member'), password: PW, name: 'Max Member', invite: new URL(r.data.link).searchParams.get('invite') })
  ok(r.status === 200 && r.data.user.role === 'scheduler', 'The colleague signs up with the organization invitation')
  r = await member.get('/api/auth')
  ok(r.data.org?.id === founderOrg, '…and joins the same organization')

  /* ── Expired and revoked beta invitations ── */
  r = await ops.post('/api/platform/beta', { action: 'invite', email: email('revoked'), company: 'Revoked Co' })
  const revokedToken = new URL(r.data.link).searchParams.get('beta')
  r = await ops.post('/api/platform/beta', { action: 'revoke_invite', id: r.data.invite.id })
  ok(r.status === 200, 'Operator revokes a pending invitation')
  r = await new Client().post('/api/auth', { action: 'signup', email: email('revoked'), password: PW, name: 'Rae Revoked', betaInvite: revokedToken })
  ok(r.status === 400 && r.data.code === 'beta_invite_invalid', 'A revoked beta invitation is refused')
  if (db) {
    r = await ops.post('/api/platform/beta', { action: 'invite', email: email('late'), company: 'Late Co' })
    const lateToken = new URL(r.data.link).searchParams.get('beta')
    await db.query("UPDATE beta_invites SET expires_at = NOW() - INTERVAL '1 minute' WHERE id=$1", [r.data.invite.id])
    r = await new Client().post('/api/auth', { action: 'signup', email: email('late'), password: PW, name: 'Lee Late', betaInvite: lateToken })
    ok(r.status === 400 && r.data.code === 'beta_invite_invalid', 'An expired beta invitation is refused')
  }
  r = await ops.get('/api/platform/beta')
  const status = e => r.data.invites.find(i => i.email === email(e))?.status
  ok(status('founder') === 'accepted' && status('revoked') === 'revoked' && (!db || status('late') === 'expired'), 'Invitation list shows accepted / revoked / expired')
  ok(r.data.invites.find(i => i.email === email('founder'))?.acceptedOrgName === `Beta Builders ${stamp}`, '…and which firm an invitation created')
  const memberRow = r.data.users.find(u => u.email === email('member'))
  ok(memberRow?.hasAccess === true && memberRow.betaAccessVia === 'org_invite', 'Accounts list shows beta access and how it was granted')

  /* ── Revoking beta access ── */
  r = await ops.post('/api/platform/beta', { action: 'revoke_access', userId: memberRow.id })
  ok(r.status === 200 && r.data.sessionsRevoked >= 1, 'Operator revokes a person’s beta access (their sessions end)')
  r = await member.get('/api/auth')
  ok(r.data.user === null, 'The revoked person is signed out at once')
  r = await new Client().post('/api/auth', { action: 'signin', email: email('member'), password: PW })
  ok(r.status === 403 && r.data.code === 'beta_access_required' && r.data.error === BETA_MESSAGE, 'Sign-in is refused with the private-beta message')
  r = await new Client().post('/api/auth', { action: 'signin', email: email('member'), password: 'wrong password entirely' })
  ok(r.status === 401, 'A wrong password still gets the generic error (beta status is not revealed)')
  r = await ops.post('/api/platform/beta', { action: 'restore_access', userId: memberRow.id })
  ok(r.status === 200, 'Operator restores access')
  r = await member.post('/api/auth', { action: 'signin', email: email('member'), password: PW })
  ok(r.status === 200, 'The person can sign in again')
  const opsId = (await ops.get('/api/auth')).data.user.id
  r = await ops.post('/api/platform/beta', { action: 'revoke_access', userId: opsId })
  ok(r.status === 400, 'Platform operators can’t be revoked (they always pass)')

  /* ── Accounts without beta access (no invitation, not grandfathered) ── */
  if (db) {
    r = await founder.post('/api/org', { action: 'invite', email: email('ghost'), role: 'viewer' })
    const ghost = new Client()
    r = await ghost.post('/api/auth', { action: 'signup', email: email('ghost'), password: PW, name: 'Gus Ghost', invite: new URL(r.data.link).searchParams.get('invite') })
    ok(r.status === 200, 'Set-up: an account exists')
    await db.query('UPDATE users SET beta_access_at=NULL, beta_access_via=NULL WHERE LOWER(email)=$1', [email('ghost')])
    r = await ghost.get('/api/auth')
    ok(r.data.user === null, 'An account without beta access has no valid session')
    r = await new Client().post('/api/auth', { action: 'signin', email: email('ghost'), password: PW })
    ok(r.status === 403 && r.data.code === 'beta_access_required', 'An account without beta access cannot sign in')

    await db.query('UPDATE users SET beta_revoked_at=NOW() WHERE LOWER(email)=$1', [ADMIN])
    r = await new Client().post('/api/auth', { action: 'signin', email: ADMIN, password: PW })
    ok(r.status === 200, 'Platform operators always pass the gate')
    await db.query('UPDATE users SET beta_revoked_at=NULL WHERE LOWER(email)=$1', [ADMIN])
  }

  /* ── Audit trail ── */
  r = await founder.get('/api/audit?limit=200')
  const actions = new Set((r.data.events || []).map(e => e.action))
  ok(actions.has('beta.invite_accepted') && actions.has('beta.access_revoked') && actions.has('auth.login_refused_beta') && actions.has('org.created'),
    'The firm’s audit log records the accepted invitation, the revoked access and the refused sign-in', [...actions])
  ok(!JSON.stringify(r.data.events).includes(founderToken), 'No invitation token in the audit log')
  if (db) {
    const sys = (await db.query("SELECT action FROM audit_events WHERE org_id='__system__' AND action LIKE 'beta.%' AND at > NOW() - INTERVAL '1 hour'")).rows.map(x => x.action)
    ok(['beta.invite_created', 'beta.invite_revoked', 'beta.invite_accepted', 'beta.access_revoked', 'beta.access_restored'].every(a => sys.includes(a)), 'The operators’ (system) audit log records invitations and access changes')
    await db.end()
  }

  console.log(`\n${passed} private beta checks passed.`)
}

main().catch(err => { console.error(err); process.exit(1) })
