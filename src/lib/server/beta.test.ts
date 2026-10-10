import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createHash } from 'crypto'
import type { User } from '@/lib/db'

// Private beta, end to end through the real route handlers (sign-up, sign-in, session check and the
// platform operator endpoints) against an in-memory stand-in for the database. The SQL itself is
// exercised against Postgres by scripts/e2e-beta.mjs.

type Row = Record<string, unknown>
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const now = () => new Date().toISOString()

const state = {
  orgs: [] as { id: string; name: string }[],
  users: [] as User[],
  sessions: new Map<string, { userId: string; method: string; revoked: boolean }>(),
  invites: [] as Row[],
  audit: [] as { action: string; orgId?: string; detail?: Record<string, unknown> }[],
  emails: [] as { to: string; text: string }[],
}

function addUser(u: Partial<User> & { email: string; orgId: string }): User {
  const user: User = {
    id: `u_${state.users.length + 1}`, name: u.email.split('@')[0], passwordHash: '', plan: 'free', createdAt: now(), role: 'owner',
    disabledAt: null, failedLogins: 0, lockedUntil: null, mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null, mfaRecovery: [], emailVerifiedAt: null,
    betaAccessAt: null, betaRevokedAt: null, betaAccessVia: null, ...u,
  }
  state.users.push(user)
  return user
}

function fakeQuery(sql: string, params: unknown[] = []): Promise<{ rows: Row[]; rowCount: number }> {
  const ok = (rows: Row[], rowCount = rows.length) => Promise.resolve({ rows, rowCount })
  const p = (i: number) => params[i - 1]
  if (/COUNT\(\*\)::int AS n FROM organizations/.test(sql)) return ok([{ n: state.orgs.length }])
  if (/^INSERT INTO sessions/.test(sql)) { state.sessions.set(String(p(1)), { userId: String(p(2)), method: String(p(6)), revoked: false }); return ok([]) }
  if (/FROM sessions s JOIN users u/.test(sql)) {
    const s = state.sessions.get(String(p(1)))
    const u = s && !s.revoked ? state.users.find(x => x.id === s.userId) : undefined
    if (!s || !u) return ok([])
    return ok([{ sid: p(1), last_seen_at: now(), method: s.method, id: u.id, email: u.email, name: u.name, role: u.role, org_id: u.orgId, mfa_enabled_at: null,
      disabled_at: u.disabledAt, email_verified_at: u.emailVerifiedAt, beta_access_at: u.betaAccessAt, beta_revoked_at: u.betaRevokedAt, org_name: 'Firm', settings: {}, plan: 'pro' }])
  }
  if (/^UPDATE sessions SET revoked_at=NOW\(\) WHERE user_id=\$1/.test(sql)) {
    let n = 0
    for (const s of state.sessions.values()) if (s.userId === p(1) && !s.revoked) { s.revoked = true; n++ }
    return ok([], n)
  }
  if (/^UPDATE users SET failed_logins = failed_logins \+ 1/.test(sql)) return ok([{ failed_logins: 1, locked_until: null }])
  if (/^UPDATE users SET failed_logins=0/.test(sql)) return ok([], 1)
  if (/^SELECT id FROM users WHERE LOWER\(email\)=\$1/.test(sql)) return ok(state.users.filter(u => u.email === p(1)).map(u => ({ id: u.id })))
  if (/^SELECT email, org_id, beta_revoked_at FROM users WHERE id=\$1/.test(sql)) {
    return ok(state.users.filter(u => u.id === p(1)).map(u => ({ email: u.email, org_id: u.orgId, beta_revoked_at: u.betaRevokedAt })))
  }
  if (/^UPDATE users SET beta_revoked_at=NOW\(\) WHERE id=\$1/.test(sql)) { const u = state.users.find(x => x.id === p(1))!; u.betaRevokedAt = now(); return ok([], 1) }
  if (/^UPDATE users SET beta_revoked_at=NULL/.test(sql)) {
    const u = state.users.find(x => x.id === p(1) && (x.betaRevokedAt || !x.betaAccessAt))
    if (!u) return ok([])
    u.betaRevokedAt = null; u.betaAccessAt ??= now(); u.betaAccessVia ??= 'restored'
    return ok([{ email: u.email, org_id: u.orgId }])
  }
  if (/FROM users u JOIN organizations o/.test(sql)) {
    return ok(state.users.map(u => ({ id: u.id, email: u.email, name: u.name, role: u.role, org_id: u.orgId, created_at: u.createdAt, beta_access_at: u.betaAccessAt,
      beta_revoked_at: u.betaRevokedAt, beta_access_via: u.betaAccessVia, disabled_at: u.disabledAt, org_name: state.orgs.find(o => o.id === u.orgId)?.name ?? '' })))
  }
  // beta_invites, with the conditions the real statements use
  const live = (r: Row) => !r.accepted_at && !r.revoked_at
  if (/^UPDATE beta_invites SET revoked_at=NOW\(\) WHERE LOWER\(email\)=\$1/.test(sql)) {
    for (const r of state.invites) if (r.email === p(1) && live(r)) r.revoked_at = now()
    return ok([])
  }
  if (/^INSERT INTO beta_invites/.test(sql)) {
    const r: Row = { id: p(1), email: p(2), company: p(3), token_hash: p(4), created_by: p(5), created_by_email: p(6), created_at: now(),
      expires_at: new Date(Date.now() + Number(p(7)) * 86_400_000).toISOString(), accepted_at: null, revoked_at: null, accepted_org_id: null }
    state.invites.push(r)
    return ok([r])
  }
  if (/FROM beta_invites b LEFT JOIN organizations/.test(sql)) return ok(state.invites.map(r => ({ ...r, org_name: state.orgs.find(o => o.id === r.accepted_org_id)?.name ?? null })))
  if (/^UPDATE beta_invites SET revoked_at=NOW\(\) WHERE id=\$1/.test(sql)) {
    const r = state.invites.find(x => x.id === p(1) && live(x))
    if (!r) return ok([])
    r.revoked_at = now()
    return ok([{ email: r.email }])
  }
  if (/^SELECT \* FROM beta_invites WHERE token_hash=\$1/.test(sql)) {
    return ok(state.invites.filter(r => r.token_hash === p(1) && live(r) && new Date(String(r.expires_at)) > new Date()))
  }
  if (/^UPDATE beta_invites SET accepted_at=NOW\(\)/.test(sql)) {
    const r = state.invites.find(x => x.id === p(1) && live(x))
    if (!r) return ok([], 0)
    Object.assign(r, { accepted_at: now(), accepted_user_id: p(2), accepted_org_id: p(3) })
    return ok([], 1)
  }
  return ok([])
}

vi.mock('@/lib/db', () => ({
  initSchema: async () => {},
  query: (sql: string, params?: unknown[]) => fakeQuery(sql.replace(/\s+/g, ' ').trim(), params),
  withTransaction: async <T>(fn: (q: typeof fakeQuery) => Promise<T>) => fn((sql, params) => fakeQuery(sql.replace(/\s+/g, ' ').trim(), params)),
  StalePlanError: class StalePlanError extends Error {},
  getUserByEmail: async (email: string) => state.users.find(u => u.email === email.toLowerCase()),
  getUserById: async (id: string) => state.users.find(u => u.id === id),
  getOrganization: async (id: string) => { const o = state.orgs.find(x => x.id === id); return o && { ...o, settings: {}, createdAt: now(), plan: 'pro', sso: {} } },
  createUser: async (u: { id: string; email: string; name: string; passwordHash: string; orgId?: string; orgName?: string; role?: string; betaAccess?: string }) => {
    const orgId = u.orgId || `org_${u.id}`
    if (!u.orgId) state.orgs.push({ id: orgId, name: u.orgName || u.name })
    return addUser({ id: u.id, email: u.email, name: u.name, passwordHash: u.passwordHash, orgId, role: u.orgId ? u.role || 'viewer' : 'owner',
      betaAccessAt: u.betaAccess ? now() : null, betaAccessVia: u.betaAccess ?? null })
  },
}))

const ORG_INVITE = { token: 'org-invite-token', id: 'inv1', orgId: 'org_a', email: 'member@firm-a.test', role: 'scheduler', invitedBy: 'u_1' }
vi.mock('./org', () => ({
  findInvitation: async (t: string) => (t === ORG_INVITE.token ? { ...ORG_INVITE, orgName: 'Firm A', createdAt: now(), expiresAt: now(), acceptedAt: null, revokedAt: null } : null),
  markInvitationAccepted: async () => {},
  applyNewOrganizationDefaults: async () => {},
}))
vi.mock('./email-verification', () => ({ markEmailVerified: async () => {}, sendVerificationEmail: async () => false, requireVerifiedEmail: () => {} }))
vi.mock('./email', () => ({
  emailConfigured: () => false,
  appOrigin: () => 'http://planora.test',
  sendEmail: async (m: { to: string; text: string }) => { state.emails.push(m); return { sent: false, provider: null } },
}))
vi.mock('./saml', () => ({ ssoEnforced: async () => false }))
vi.mock('./rate-limit', async importOriginal => ({
  ...(await importOriginal<typeof import('./rate-limit')>()),
  hit: async () => ({ ok: true, count: 1, limit: 100, retryAfterSec: 0 }), peek: async () => 0, reset: async () => {},
}))
vi.mock('./maintenance', () => ({ maybeRunMaintenance: async () => {} }))
vi.mock('./audit', async importOriginal => {
  const rec = async (i: { action: string; orgId?: string; detail?: Record<string, unknown> }) => { state.audit.push(i) }
  return {
    ...(await importOriginal<typeof import('./audit')>()),
    audit: rec, auditQuietly: rec, appendAudit: async (list: { action: string; orgId?: string; detail?: Record<string, unknown> }[]) => { for (const i of list) await rec(i) },
  }
})
let signedInAs: string | null = null
vi.mock('@/lib/auth', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/auth')>()
  return {
    ...real,
    getAuthContext: async () => {
      const u = signedInAs ? state.users.find(x => x.email === signedInAs) : undefined
      return u ? {
        userId: u.id, email: u.email, name: u.name, orgId: u.orgId, orgName: 'Firm', role: u.role, sessionId: 's', settings: (await import('./settings')).normalizeSettings({}),
        plan: 'pro', sessionMethod: 'password', mfaEnabled: false, mfaSetupRequired: false, emailVerified: true,
      } : null
    },
  }
})

type Handler = (req: NextRequest, ctx?: { params?: Promise<Record<string, string>> }) => Promise<Response>
async function call(handler: Handler, url: string, b?: unknown) {
  const req = new NextRequest(`http://planora.test${url}`, {
    method: b === undefined ? 'GET' : 'POST',
    ...(b !== undefined ? { body: JSON.stringify(b), headers: { 'content-type': 'application/json' } } : {}),
  })
  const res = await handler(req, { params: Promise.resolve({}) })
  return { status: res.status, data: await res.json().catch(() => ({})) as Record<string, unknown>, cookie: res.headers.get('set-cookie') || '' }
}

const PW = 'correct horse battery staple'
const ADMIN = 'ops@planora.test'
let authRoute: typeof import('@/app/api/auth/route')
let betaRoute: typeof import('@/app/api/platform/beta/route')
let auth: typeof import('@/lib/auth')
let bcryptHash: string

async function seed() {
  state.orgs = [{ id: 'org_a', name: 'Firm A' }]
  state.users = []
  state.sessions.clear(); state.invites = []; state.audit = []; state.emails = []
  bcryptHash ??= await (await import('@/lib/auth')).hashPassword(PW)
  addUser({ id: 'u_owner', email: 'owner@firm-a.test', orgId: 'org_a', passwordHash: bcryptHash, betaAccessAt: now(), betaAccessVia: 'grandfathered' })
}

const signup = (email: string, extra: Record<string, unknown> = {}) => call(authRoute.POST, '/api/auth', { action: 'signup', email, password: PW, name: 'Test Person', ...extra })
const signin = (email: string, password = PW) => call(authRoute.POST, '/api/auth', { action: 'signin', email, password })

async function betaInvite(email: string, company = 'New Firm LLC'): Promise<string> {
  signedInAs = ADMIN
  const r = await call(betaRoute.POST, '/api/platform/beta', { action: 'invite', email, company })
  signedInAs = null
  expect(r.status, JSON.stringify(r.data)).toBe(200)
  return new URL(String(r.data.link)).searchParams.get('beta')!
}

beforeEach(async () => {

  delete process.env.PLANORA_SIGNUP
  process.env.PLANORA_PLATFORM_ADMINS = `${ADMIN}, Second-Ops@Planora.test`
  authRoute ??= await import('@/app/api/auth/route')
  betaRoute ??= await import('@/app/api/platform/beta/route')
  auth ??= await import('@/lib/auth')
  signedInAs = null
  await seed()
  addUser({ id: 'u_admin', email: ADMIN, orgId: 'org_a', passwordHash: bcryptHash, betaAccessAt: null })
})

describe('private beta sign-up (invite-only by default)', () => {
  it('refuses a sign-up without an invitation, creating nothing and revealing nothing', async () => {
    const r = await signup('stranger@elsewhere.test', { company: 'Stranger Co' })
    expect(r.status).toBe(403)
    expect(r.data.code).toBe('invite_only')
    expect(String(r.data.error)).toMatch(/private beta/)
    expect(state.users.some(u => u.email === 'stranger@elsewhere.test')).toBe(false)
    expect(state.orgs).toHaveLength(1)
    // An existing address gets the same answer as an unknown one (no 409 before the invitation check).
    const existing = await signup('owner@firm-a.test')
    expect(existing.status).toBe(403)
  })

  it('an organization invitation still works and grants beta access', async () => {
    const r = await signup(ORG_INVITE.email, { invite: ORG_INVITE.token })
    expect(r.status, JSON.stringify(r.data)).toBe(200)
    const u = state.users.find(x => x.email === ORG_INVITE.email)!
    expect(u.orgId).toBe('org_a')
    expect(u.betaAccessVia).toBe('org_invite')
    expect(u.betaAccessAt).toBeTruthy()
  })

  it('a beta invitation creates a new organization owned by the invitee, once', async () => {
    const token = await betaInvite('founder@newfirm.test')
    const created = state.audit.find(a => a.action === 'beta.invite_created')!
    expect(created.orgId).toBe('__system__')
    expect(JSON.stringify(state.audit)).not.toContain(token)

    const wrongEmail = await signup('someone@newfirm.test', { betaInvite: token })
    expect(wrongEmail.status).toBe(400)
    const r = await signup('founder@newfirm.test', { betaInvite: token })
    expect(r.status, JSON.stringify(r.data)).toBe(200)
    const u = state.users.find(x => x.email === 'founder@newfirm.test')!
    expect(u.role).toBe('owner')
    expect(u.orgId).not.toBe('org_a')
    expect(state.orgs.find(o => o.id === u.orgId)?.name).toBe('New Firm LLC')
    expect(u.betaAccessVia).toBe('beta_invite')
    expect(state.invites[0].accepted_org_id).toBe(u.orgId)
    expect(state.audit.filter(a => a.action === 'beta.invite_accepted').map(a => a.orgId).sort()).toEqual(['__system__', u.orgId].sort())

    // Single use: the same link can't create a second account.
    state.users = state.users.filter(x => x.id !== u.id)
    const again = await signup('founder@newfirm.test', { betaInvite: token })
    expect(again.status).toBe(400)
    expect(again.data.code).toBe('beta_invite_invalid')
  })

  it('expired and revoked beta invitations are refused', async () => {
    const expired = await betaInvite('late@firm.test')
    state.invites[0].expires_at = new Date(Date.now() - 1000).toISOString()
    expect((await signup('late@firm.test', { betaInvite: expired })).status).toBe(400)

    const revoked = await betaInvite('revoked@firm.test')
    signedInAs = ADMIN
    const id = state.invites.find(r => r.email === 'revoked@firm.test')!.id
    expect((await call(betaRoute.POST, '/api/platform/beta', { action: 'revoke_invite', id })).status).toBe(200)
    signedInAs = null
    const r = await signup('revoked@firm.test', { betaInvite: revoked })
    expect(r.status).toBe(400)
    expect(state.users.some(u => u.email === 'revoked@firm.test')).toBe(false)
    expect(state.audit.some(a => a.action === 'beta.invite_revoked')).toBe(true)

    expect((await signup('nobody@firm.test', { betaInvite: 'made-up-token' })).status).toBe(400)
  })

  it('the first account on an empty instance bootstraps, and platform operators may sign up', async () => {
    state.orgs = []; state.users = []
    const first = await signup('first@onprem.test')
    expect(first.status, JSON.stringify(first.data)).toBe(200)
    expect(state.users[0].betaAccessVia).toBe('bootstrap')
    const second = await signup('second@onprem.test')
    expect(second.status).toBe(403)
    const ops = await signup('second-ops@planora.test')
    expect(ops.status, JSON.stringify(ops.data)).toBe(200)
    expect(state.users.find(u => u.email === 'second-ops@planora.test')?.betaAccessVia).toBe('platform_admin')
  })

  it('PLANORA_SIGNUP=open re-opens self sign-up', async () => {
    process.env.PLANORA_SIGNUP = 'open'
    const r = await signup('anyone@open.test')
    expect(r.status).toBe(200)
    expect(state.users.find(u => u.email === 'anyone@open.test')?.betaAccessVia).toBe('open_signup')
  })

  it('GET /api/auth tells the sign-up page about the mode and a beta invitation', async () => {
    process.env.PLANORA_ACCESS_REQUEST_EMAIL = 'beta@planora.test'
    const token = await betaInvite('visitor@firm.test', 'Visitor Builders')
    const r = await call(authRoute.GET, `/api/auth?beta=${encodeURIComponent(token)}`)
    expect(r.data.signup).toEqual({ mode: 'invite_only', accessRequestEmail: 'beta@planora.test' })
    expect(r.data.betaInvitation).toEqual({ email: 'visitor@firm.test', company: 'Visitor Builders' })
    expect((await call(authRoute.GET, '/api/auth?beta=nope')).data.betaInvitation).toEqual({ invalid: true })
    delete process.env.PLANORA_ACCESS_REQUEST_EMAIL
  })
})

describe('private beta sign-in gate', () => {
  it('refuses sign-in without beta access, after the password checks out', async () => {
    addUser({ id: 'u_nobeta', email: 'nobeta@firm-a.test', orgId: 'org_a', role: 'viewer', passwordHash: bcryptHash, betaAccessAt: null })
    const wrong = await signin('nobeta@firm-a.test', 'not the password at all')
    expect(wrong.status).toBe(401)
    const r = await signin('nobeta@firm-a.test')
    expect(r.status).toBe(403)
    expect(r.data.code).toBe('beta_access_required')
    expect(r.data.error).toBe('Planora is in private beta. You need an invitation to sign in — ask your organization admin or request access.')
    expect(r.cookie).not.toContain('planora-token=')
    const refused = state.audit.find(a => a.action === 'auth.login_refused_beta')!
    expect(refused.orgId).toBe('org_a')
  })

  it('grandfathered accounts sign in; platform operators always pass', async () => {
    expect((await signin('owner@firm-a.test')).status).toBe(200)
    expect(state.users.find(u => u.email === ADMIN)!.betaAccessAt).toBeNull()
    expect((await signin(ADMIN)).status).toBe(200)
  })

  it('the gate is off when sign-up is open', async () => {
    process.env.PLANORA_SIGNUP = 'open'
    addUser({ id: 'u_nobeta2', email: 'nobeta2@firm-a.test', orgId: 'org_a', role: 'viewer', passwordHash: bcryptHash, betaAccessAt: null })
    expect((await signin('nobeta2@firm-a.test')).status).toBe(200)
  })

  it('revoking beta access ends existing sessions and blocks the next sign-in', async () => {
    const owner = state.users.find(u => u.email === 'owner@firm-a.test')!
    const { token } = await auth.createSession(owner.id)
    expect((await auth.resolveSession(token))?.userId).toBe(owner.id)

    signedInAs = ADMIN
    const r = await call(betaRoute.POST, '/api/platform/beta', { action: 'revoke_access', userId: owner.id })
    expect(r.status, JSON.stringify(r.data)).toBe(200)
    expect(r.data.sessionsRevoked).toBe(1)
    expect(await auth.resolveSession(token)).toBeNull()
    expect(state.audit.filter(a => a.action === 'beta.access_revoked').map(a => a.orgId).sort()).toEqual(['__system__', 'org_a'])

    // Even a session that somehow survived is refused by the session check.
    const sid = [...state.sessions.keys()][0]
    state.sessions.get(sid)!.revoked = false
    expect(await auth.resolveSession(token)).toBeNull()

    signedInAs = null
    expect((await signin('owner@firm-a.test')).status).toBe(403)

    signedInAs = ADMIN
    expect((await call(betaRoute.POST, '/api/platform/beta', { action: 'restore_access', userId: owner.id })).status).toBe(200)
    signedInAs = null
    expect((await signin('owner@firm-a.test')).status).toBe(200)
  })

  it("platform operators can't revoke each other (they always pass)", async () => {
    signedInAs = ADMIN
    const admin = state.users.find(u => u.email === ADMIN)!
    expect((await call(betaRoute.POST, '/api/platform/beta', { action: 'revoke_access', userId: admin.id })).status).toBe(400)
  })
})

describe('platform operator endpoints', () => {
  it('answer 404 to everyone who is not a platform operator', async () => {
    signedInAs = 'owner@firm-a.test'
    expect((await call(betaRoute.GET, '/api/platform/beta')).status).toBe(404)
    for (const action of ['invite', 'revoke_invite', 'revoke_access', 'restore_access']) {
      expect((await call(betaRoute.POST, '/api/platform/beta', { action, email: 'x@y.test', userId: 'u_owner', id: 'x' })).status).toBe(404)
    }
    expect(state.invites).toHaveLength(0)
    expect(state.users.find(u => u.email === 'owner@firm-a.test')!.betaRevokedAt).toBeNull()
    signedInAs = null
    expect((await call(betaRoute.GET, '/api/platform/beta')).status).toBe(401)
  })

  it('let an operator invite a firm, list invitations and see beta users', async () => {
    signedInAs = ADMIN
    const r = await call(betaRoute.POST, '/api/platform/beta', { action: 'invite', email: 'Lead@Builder.test', company: 'Builder Co' })
    expect(r.status).toBe(200)
    expect(String(r.data.link)).toMatch(/^http:\/\/planora\.test\/auth\?beta=[A-Za-z0-9_-]{20,}$/)
    expect(r.data.expiresInDays).toBe(14)
    const token = new URL(String(r.data.link)).searchParams.get('beta')!
    expect(state.invites[0].token_hash).toBe(sha(token))
    expect(JSON.stringify(state.invites)).not.toContain(token)
    expect(state.emails[0].to).toBe('lead@builder.test')
    // Someone who already has an account can't be invited as a new firm.
    expect((await call(betaRoute.POST, '/api/platform/beta', { action: 'invite', email: 'owner@firm-a.test' })).status).toBe(409)
    const list = await call(betaRoute.GET, '/api/platform/beta')
    expect(list.status).toBe(200)
    const invites = list.data.invites as { email: string; status: string }[]
    expect(invites.map(i => [i.email, i.status])).toEqual([['lead@builder.test', 'pending']])
    const users = list.data.users as { email: string; hasAccess: boolean; platformAdmin: boolean }[]
    expect(users.find(u => u.email === 'owner@firm-a.test')?.hasAccess).toBe(true)
    expect(users.find(u => u.email === ADMIN)?.platformAdmin).toBe(true)
  })
})
