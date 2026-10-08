import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { parseFilter, paging, desiredFromPatch } from './scim'

// SCIM 2.0 endpoints, run through the real route handlers and scimApi() against an in-memory
// stand-in for the handful of SQL statements src/lib/server/scim.ts issues. Covers token auth,
// filtering and paging, create, PATCH active=false (sessions revoked), PUT, DELETE, cross-org
// isolation, plan gating and RFC 7644 error shapes.

type Row = Record<string, unknown>
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const TOKEN_A = 'scim_' + 'a'.repeat(43)
const TOKEN_B = 'scim_' + 'b'.repeat(43)
const TOKEN_PRO = 'scim_' + 'p'.repeat(43)
const TOKEN_REVOKED = 'scim_' + 'r'.repeat(43)

let db: { organizations: Row[]; users: Row[]; sessions: Row[]; scim_tokens: Row[]; sso_domains: Row[]; saml_domains: Row[] }
const audits: { action: string; orgId?: string; targetId?: string; detail?: Record<string, unknown> }[] = []

function reset() {
  const now = '2026-01-01T00:00:00Z'
  const user = (id: string, org: string, email: string, role = 'scheduler', extra: Row = {}): Row => ({
    id, org_id: org, email, name: email.split('@')[0], role, created_at: now, disabled_at: null, scim_deleted_at: null, scim_external_id: null, scim_modified_at: null, ...extra,
  })
  db = {
    organizations: [
      { id: 'orgA', plan: 'enterprise', sso: { defaultRole: 'reviewer' }, saml: {} },
      { id: 'orgB', plan: 'enterprise', sso: {}, saml: { enabled: true, defaultRole: 'scheduler' } },
      { id: 'orgPro', plan: 'pro', sso: {}, saml: {} },
    ],
    users: [
      user('uOwner', 'orgA', 'owner@a.test', 'owner'),
      user('uJane', 'orgA', 'jane@a.test'),
      user('uJoe', 'orgA', 'joe@a.test', 'viewer', { scim_external_id: 'ext-joe' }),
      user('uBob', 'orgB', 'bob@b.test'),
      // Signed up with a b.test address before orgB claimed the domain: belongs to orgA.
      user('uStray', 'orgA', 'stray@b.test'),
    ],
    sessions: [
      { id: 's1', user_id: 'uJane', revoked_at: null }, { id: 's2', user_id: 'uJane', revoked_at: null }, { id: 's3', user_id: 'uJoe', revoked_at: null },
      { id: 's4', user_id: 'uBob', revoked_at: null },
    ],
    scim_tokens: [
      { id: 'tA', org_id: 'orgA', name: 'Entra', token_hash: sha(TOKEN_A), revoked_at: null, last_used_at: null },
      { id: 'tB', org_id: 'orgB', name: 'Okta', token_hash: sha(TOKEN_B), revoked_at: null, last_used_at: null },
      { id: 'tP', org_id: 'orgPro', name: 'Okta', token_hash: sha(TOKEN_PRO), revoked_at: null, last_used_at: null },
      { id: 'tR', org_id: 'orgA', name: 'Old', token_hash: sha(TOKEN_REVOKED), revoked_at: now, last_used_at: null },
    ],
    sso_domains: [{ domain: 'a.test', org_id: 'orgA' }],
    saml_domains: [{ domain: 'b.test', org_id: 'orgB' }],
  }
  audits.length = 0
}

const ok = (rows: Row[]) => Promise.resolve({ rows, rowCount: rows.length })
const live = (org: unknown) => db.users.filter(u => u.org_id === org && !u.scim_deleted_at)

function fakeQuery(sql: string, p: unknown[] = []): Promise<{ rows: Row[]; rowCount: number }> {
  const s = sql.replace(/\s+/g, ' ').trim()
  if (s.includes('FROM scim_tokens t JOIN organizations o')) {
    const t = db.scim_tokens.find(x => x.token_hash === p[0] && !x.revoked_at)
    return ok(t ? [{ ...t, plan: db.organizations.find(o => o.id === t.org_id)!.plan }] : [])
  }
  if (s.startsWith('UPDATE scim_tokens SET last_used_at')) return ok([])
  if (s.startsWith('SELECT COUNT(*)::int AS n FROM users WHERE org_id=$1 AND scim_deleted_at IS NULL')) return ok([{ n: filterUsers(s, p).length }])
  if (s.startsWith('SELECT * FROM users WHERE org_id=$1 AND scim_deleted_at IS NULL')) {
    let rows = filterUsers(s, p)
    if (/LIMIT \$(\d+) OFFSET \$(\d+)/.test(s)) {
      const [, l, o] = /LIMIT \$(\d+) OFFSET \$(\d+)/.exec(s)!
      rows = rows.slice(Number(p[Number(o) - 1]), Number(p[Number(o) - 1]) + Number(p[Number(l) - 1]))
    }
    return ok(rows)
  }
  if (s.startsWith('SELECT domain FROM sso_domains WHERE org_id=$1 UNION')) return ok([...db.sso_domains, ...db.saml_domains].filter(d => d.org_id === p[0]))
  if (s.startsWith('SELECT * FROM users WHERE LOWER(email)=LOWER($1)')) return ok(db.users.filter(u => String(u.email).toLowerCase() === String(p[0]).toLowerCase()))
  if (s.startsWith('SELECT id FROM users WHERE LOWER(email)=LOWER($1) AND id<>$2')) return ok(db.users.filter(u => String(u.email).toLowerCase() === String(p[0]).toLowerCase() && u.id !== p[1]))
  if (s.startsWith('SELECT sso, saml FROM organizations')) return ok(db.organizations.filter(o => o.id === p[0]))
  if (s.startsWith('INSERT INTO users')) {
    const row: Row = { id: p[0], email: p[1], name: p[2], org_id: p[4], role: p[5], scim_external_id: p[6], created_at: new Date().toISOString(), scim_modified_at: new Date().toISOString(), disabled_at: /NOW\(\)\) RETURNING/.test(s) ? new Date().toISOString() : null, scim_deleted_at: null }
    db.users.push(row)
    return ok([row])
  }
  const userIn = (id: unknown, org: unknown) => db.users.find(u => u.id === id && u.org_id === org)
  if (s.startsWith('UPDATE users SET name=$3, role=$4, scim_external_id=$5')) {
    const u = userIn(p[0], p[1]); if (!u) return ok([])
    Object.assign(u, { name: p[2], role: p[3], scim_external_id: p[4], disabled_at: s.includes('disabled_at=NOW()') ? new Date().toISOString() : null, scim_deleted_at: null })
    return ok([u])
  }
  if (s.startsWith('UPDATE users SET email=$3, name=$4, role=$5, scim_external_id=$6')) {
    const u = userIn(p[0], p[1]); if (!u) return ok([])
    Object.assign(u, { email: p[2], name: p[3], role: p[4], scim_external_id: p[5] })
    return ok([u])
  }
  if (s.startsWith('UPDATE users SET disabled_at=COALESCE(disabled_at, NOW())')) {
    const u = userIn(p[0], p[1]); if (!u) return ok([])
    u.disabled_at ??= new Date().toISOString()
    if (s.includes('scim_deleted_at=NOW()')) u.scim_deleted_at = new Date().toISOString()
    return ok([u])
  }
  if (s.startsWith('UPDATE users SET disabled_at=NULL')) { const u = userIn(p[0], p[1]); if (u) u.disabled_at = null; return ok(u ? [u] : []) }
  if (s.startsWith('UPDATE sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL')) {
    const hit = db.sessions.filter(x => x.user_id === p[0] && !x.revoked_at)
    for (const x of hit) x.revoked_at = new Date().toISOString()
    return ok(hit)
  }
  return ok([])
}

function filterUsers(s: string, p: unknown[]): Row[] {
  let rows = live(p[0])
  if (s.includes('AND LOWER(email)=$2')) rows = rows.filter(u => String(u.email).toLowerCase() === p[1])
  if (s.includes('AND scim_external_id=$2')) rows = rows.filter(u => u.scim_external_id === p[1])
  if (s.includes('AND id=$2')) rows = rows.filter(u => u.id === p[1])
  return rows
}

vi.mock('pg', () => ({
  Pool: class {
    query = (sql: string, params?: unknown[]) => fakeQuery(sql, params)
    connect = async () => ({ query: (sql: string, params?: unknown[]) => fakeQuery(sql, params), release: () => {} })
    end = async () => {}
  },
}))
vi.mock('./rate-limit', async importOriginal => ({ ...(await importOriginal<typeof import('./rate-limit')>()), hit: async () => ({ ok: true, remaining: 100, retryAfterSec: 0 }) }))
vi.mock('./maintenance', () => ({ maybeRunMaintenance: async () => {} }))
vi.mock('./audit', async importOriginal => ({
  ...(await importOriginal<typeof import('./audit')>()),
  audit: async (e: (typeof audits)[number]) => { audits.push(e) },
  appendAudit: async () => {}, auditQuietly: async () => {},
}))
// Fast hashing for the random, unusable passwords of provisioned members.
vi.mock('bcryptjs', () => ({ default: { hash: async () => 'x', compare: async () => false } }))
// A signed-in admin of orgA, to prove SCIM endpoints ignore session cookies.
vi.mock('@/lib/auth', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getAuthContext: async () => ({ userId: 'uOwner', email: 'owner@a.test', name: 'Owner', orgId: 'orgA', orgName: 'A', role: 'owner', sessionId: 's0', settings: {}, plan: 'enterprise', sessionMethod: 'password', mfaEnabled: true, mfaSetupRequired: false, emailVerified: true }),
}))

type Handler = (req: NextRequest, ctx?: { params?: Promise<Record<string, string>> }) => Promise<Response>
async function call(handler: Handler, url: string, opts: { method?: string; body?: unknown; token?: string | null; params?: Record<string, string>; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers || {}) }
  if (opts.token !== null) headers.authorization = `Bearer ${opts.token ?? TOKEN_A}`
  if (opts.body !== undefined) headers['content-type'] = 'application/scim+json'
  const req = new NextRequest(`http://localhost${url}`, { method: opts.method || 'GET', headers, ...(opts.body !== undefined ? { body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body) } : {}) })
  const res = await handler(req, { params: Promise.resolve(opts.params || {}) })
  const text = await res.text()
  return { status: res.status, type: res.headers.get('content-type'), headers: res.headers, data: text ? JSON.parse(text) : null }
}

const USER = 'urn:ietf:params:scim:schemas:core:2.0:User'
const PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp'
const ERROR = 'urn:ietf:params:scim:api:messages:2.0:Error'
const expectScimError = (r: { status: number; type: string | null; data: Row }, status: number, scimType?: string) => {
  expect(r.status, JSON.stringify(r.data)).toBe(status)
  expect(r.type).toContain('application/scim+json')
  expect(r.data.schemas).toEqual([ERROR])
  expect(r.data.status).toBe(String(status))
  expect(typeof r.data.detail).toBe('string')
  if (scimType) expect(r.data.scimType).toBe(scimType)
}

const users = () => import('@/app/api/scim/v2/Users/route')
const user = () => import('@/app/api/scim/v2/Users/[id]/route')

describe('SCIM 2.0 endpoints', () => {
  beforeEach(reset)

  it('requires a valid, unrevoked SCIM token; session cookies and API keys are not accepted', async () => {
    const { GET } = await users()
    const none = await call(GET, '/api/scim/v2/Users', { token: null, headers: { cookie: 'planora-token=whatever' } })
    expectScimError(none, 401)
    expect(none.headers.get('www-authenticate')).toMatch(/Bearer/)
    expectScimError(await call(GET, '/api/scim/v2/Users', { token: 'scim_' + 'z'.repeat(43) }), 401)
    expectScimError(await call(GET, '/api/scim/v2/Users', { token: TOKEN_REVOKED }), 401)
    expectScimError(await call(GET, '/api/scim/v2/Users', { token: 'pk_live_' + 'a'.repeat(43) }), 401)
  })

  it('is an Enterprise feature', async () => {
    const { GET } = await users()
    expectScimError(await call(GET, '/api/scim/v2/Users', { token: TOKEN_PRO }), 403)
  })

  it('lists only the token\'s organization, as a ListResponse with paging', async () => {
    const { GET } = await users()
    const r = await call(GET, '/api/scim/v2/Users')
    expect(r.status).toBe(200)
    expect(r.type).toContain('application/scim+json')
    expect(r.data).toMatchObject({ schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'], totalResults: 4, startIndex: 1, itemsPerPage: 4 })
    expect(r.data.Resources.map((u: Row) => u.userName)).not.toContain('bob@b.test')
    const u0 = r.data.Resources[0]
    expect(u0).toMatchObject({ schemas: [USER], id: 'uOwner', userName: 'owner@a.test', active: true, emails: [{ value: 'owner@a.test', primary: true }] })
    expect(u0.meta).toMatchObject({ resourceType: 'User', location: 'http://localhost/api/scim/v2/Users/uOwner' })
    const page = await call(GET, '/api/scim/v2/Users?startIndex=2&count=2')
    expect(page.data).toMatchObject({ totalResults: 4, startIndex: 2, itemsPerPage: 2 })
    expect(page.data.Resources.map((u: Row) => u.id)).toEqual(['uJane', 'uJoe'])
    const zero = await call(GET, '/api/scim/v2/Users?count=0')
    expect(zero.data).toMatchObject({ totalResults: 4, itemsPerPage: 0, Resources: [] })
  })

  it('filters by userName eq (case-insensitive) and externalId; rejects unsupported filters', async () => {
    const { GET } = await users()
    const r = await call(GET, `/api/scim/v2/Users?filter=${encodeURIComponent('userName eq "JANE@a.test"')}`)
    expect(r.data.totalResults).toBe(1)
    expect(r.data.Resources[0].id).toBe('uJane')
    const ext = await call(GET, `/api/scim/v2/Users?filter=${encodeURIComponent('externalId eq "ext-joe"')}`)
    expect(ext.data.Resources.map((u: Row) => u.id)).toEqual(['uJoe'])
    // Another organization's member is not found through this token.
    const other = await call(GET, `/api/scim/v2/Users?filter=${encodeURIComponent('userName eq "bob@b.test"')}`)
    expect(other.data).toMatchObject({ totalResults: 0, Resources: [] })
    expectScimError(await call(GET, `/api/scim/v2/Users?filter=${encodeURIComponent('title co "x"')}`), 400, 'invalidFilter')
    expectScimError(await call(GET, `/api/scim/v2/Users?filter=${encodeURIComponent('userName eq "a" or userName eq "b"')}`), 400, 'invalidFilter')
  })

  it('creates a user in a verified domain with the role from roles (or the default), audited', async () => {
    const { POST } = await users()
    const r = await call(POST, '/api/scim/v2/Users', { method: 'POST', body: { schemas: [USER], userName: 'New.Person@a.test', externalId: 'ext-1', name: { givenName: 'New', familyName: 'Person' }, active: true, roles: [{ value: 'scheduler', primary: true }] } })
    expect(r.status).toBe(201)
    expect(r.headers.get('location')).toBe(`http://localhost/api/scim/v2/Users/${r.data.id}`)
    expect(r.data).toMatchObject({ userName: 'new.person@a.test', externalId: 'ext-1', displayName: 'New Person', active: true, roles: [{ value: 'scheduler' }] })
    expect(db.users.find(u => u.id === r.data.id)).toMatchObject({ org_id: 'orgA', role: 'scheduler' })
    expect(audits.at(-1)).toMatchObject({ action: 'scim.user_created', orgId: 'orgA' })
    const d = await call(POST, '/api/scim/v2/Users', { method: 'POST', body: { schemas: [USER], userName: 'plain@a.test' } })
    expect(d.data.roles[0].value).toBe('reviewer') // orgA's SSO default role
  })

  it('rejects duplicates, other domains, owner role and malformed bodies with SCIM errors', async () => {
    const { POST } = await users()
    expectScimError(await call(POST, '/api/scim/v2/Users', { method: 'POST', body: { schemas: [USER], userName: 'jane@a.test' } }), 409, 'uniqueness')
    expectScimError(await call(POST, '/api/scim/v2/Users', { method: 'POST', body: { schemas: [USER], userName: 'someone@gmail.com' } }), 400, 'invalidValue')
    expectScimError(await call(POST, '/api/scim/v2/Users', { method: 'POST', body: { schemas: [USER], userName: 'x@a.test', roles: [{ value: 'owner' }] } }), 400, 'invalidValue')
    expectScimError(await call(POST, '/api/scim/v2/Users', { method: 'POST', body: { schemas: [USER] } }), 400, 'invalidValue')
    expectScimError(await call(POST, '/api/scim/v2/Users', { method: 'POST', body: { userName: 'x@a.test' } }), 400, 'invalidSyntax')
    expectScimError(await call(POST, '/api/scim/v2/Users', { method: 'POST', body: '{not json' }), 400, 'invalidSyntax')
  })

  it('cross-organization: a token cannot read, change or delete another organization\'s users, or claim their email', async () => {
    const one = await user()
    const { POST } = await users()
    // orgB's token against orgA's member
    expectScimError(await call(one.GET, '/api/scim/v2/Users/uJane', { token: TOKEN_B, params: { id: 'uJane' } }), 404)
    expectScimError(await call(one.PATCH, '/api/scim/v2/Users/uJane', { token: TOKEN_B, method: 'PATCH', params: { id: 'uJane' }, body: { schemas: [PATCH], Operations: [{ op: 'replace', path: 'active', value: false }] } }), 404)
    expectScimError(await call(one.PUT, '/api/scim/v2/Users/uJane', { token: TOKEN_B, method: 'PUT', params: { id: 'uJane' }, body: { schemas: [USER], userName: 'jane@a.test', active: false } }), 404)
    expectScimError(await call(one.DELETE, '/api/scim/v2/Users/uJane', { token: TOKEN_B, method: 'DELETE', params: { id: 'uJane' } }), 404)
    expect(db.users.find(u => u.id === 'uJane')!.disabled_at).toBeNull()
    expect(db.sessions.filter(s => s.user_id === 'uJane' && s.revoked_at)).toHaveLength(0)
    // An account in orgA with a b.test address can't be taken over by orgB's provisioning.
    expectScimError(await call(POST, '/api/scim/v2/Users', { token: TOKEN_B, method: 'POST', body: { schemas: [USER], userName: 'stray@b.test' } }), 409, 'uniqueness')
    expect(db.users.find(u => u.id === 'uStray')).toMatchObject({ org_id: 'orgA', disabled_at: null })
    // And orgA's token can't create users in orgB's domain.
    expectScimError(await call(POST, '/api/scim/v2/Users', { method: 'POST', body: { schemas: [USER], userName: 'new@b.test' } }), 400, 'invalidValue')
  })

  it('PATCH active=false deprovisions: account disabled and every session revoked immediately, audited', async () => {
    const { PATCH: patch, GET } = await user()
    const r = await call(patch, '/api/scim/v2/Users/uJane', { method: 'PATCH', params: { id: 'uJane' }, body: { schemas: [PATCH], Operations: [{ op: 'Replace', path: 'active', value: 'False' }] } })
    expect(r.status).toBe(200)
    expect(r.data.active).toBe(false)
    expect(db.users.find(u => u.id === 'uJane')!.disabled_at).toBeTruthy()
    expect(db.sessions.filter(s => s.user_id === 'uJane').every(s => s.revoked_at)).toBe(true)
    expect(db.sessions.find(s => s.id === 's3')!.revoked_at).toBeNull() // other members untouched
    expect(audits.find(a => a.action === 'scim.user_deprovisioned')).toMatchObject({ orgId: 'orgA', targetId: 'uJane', detail: { sessionsRevoked: 2 } })
    // Still visible to SCIM as inactive; reactivation works (Okta style: no path, object value).
    expect((await call(GET, '/api/scim/v2/Users/uJane', { params: { id: 'uJane' } })).data.active).toBe(false)
    const back = await call(patch, '/api/scim/v2/Users/uJane', { method: 'PATCH', params: { id: 'uJane' }, body: { schemas: [PATCH], Operations: [{ op: 'replace', value: { active: true } }] } })
    expect(back.data.active).toBe(true)
    expect(audits.at(-1)!.action).toBe('scim.user_reactivated')
  })

  it('PATCH changes name, email and role; owners are protected', async () => {
    const { PATCH: patch } = await user()
    const r = await call(patch, '/api/scim/v2/Users/uJoe', { method: 'PATCH', params: { id: 'uJoe' }, body: { schemas: [PATCH], Operations: [
      { op: 'replace', path: 'name.givenName', value: 'Joseph' }, { op: 'replace', path: 'name.familyName', value: 'Bloggs' },
      { op: 'replace', path: 'emails[type eq "work"].value', value: 'joseph@a.test' }, { op: 'add', path: 'roles', value: [{ value: 'admin', primary: true }] },
      { op: 'replace', path: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department', value: 'Ops' },
    ] } })
    expect(r.status, JSON.stringify(r.data)).toBe(200)
    expect(r.data).toMatchObject({ userName: 'joseph@a.test', displayName: 'Joseph Bloggs', roles: [{ value: 'admin' }] })
    expect(audits.at(-1)).toMatchObject({ action: 'scim.user_updated', detail: { changes: { role: { before: 'viewer', after: 'admin' } } } })
    expectScimError(await call(patch, '/api/scim/v2/Users/uJoe', { method: 'PATCH', params: { id: 'uJoe' }, body: { schemas: [PATCH], Operations: [{ op: 'replace', path: 'userName', value: 'jane@a.test' }] } }), 409, 'uniqueness')
    expectScimError(await call(patch, '/api/scim/v2/Users/uOwner', { method: 'PATCH', params: { id: 'uOwner' }, body: { schemas: [PATCH], Operations: [{ op: 'replace', path: 'active', value: false }] } }), 400, 'mutability')
    expect(db.users.find(u => u.id === 'uOwner')!.disabled_at).toBeNull()
    expectScimError(await call(patch, '/api/scim/v2/Users/uJoe', { method: 'PATCH', params: { id: 'uJoe' }, body: { Operations: [] } }), 400, 'invalidSyntax')
    expectScimError(await call(patch, '/api/scim/v2/Users/uJoe', { method: 'PATCH', params: { id: 'uJoe' }, body: { schemas: [PATCH], Operations: [{ op: 'move', path: 'active' }] } }), 400, 'invalidSyntax')
  })

  it('PUT replaces; active=false in PUT deprovisions', async () => {
    const { PUT } = await user()
    const r = await call(PUT, '/api/scim/v2/Users/uJane', { method: 'PUT', params: { id: 'uJane' }, body: { schemas: [USER], userName: 'jane@a.test', name: { formatted: 'Jane Q. Doe' }, active: false } })
    expect(r.status).toBe(200)
    expect(r.data).toMatchObject({ displayName: 'Jane Q. Doe', active: false })
    expect(db.sessions.filter(s => s.user_id === 'uJane').every(s => s.revoked_at)).toBe(true)
  })

  it('DELETE deprovisions and hides the user (later GET is 404); re-provisioning restores the same account', async () => {
    const one = await user()
    const { POST } = await users()
    const del = await call(one.DELETE, '/api/scim/v2/Users/uJoe', { method: 'DELETE', params: { id: 'uJoe' } })
    expect(del.status).toBe(204)
    expect(db.users.find(u => u.id === 'uJoe')!.disabled_at).toBeTruthy()
    expect(db.sessions.find(s => s.id === 's3')!.revoked_at).toBeTruthy()
    expect(audits.at(-1)).toMatchObject({ action: 'scim.user_deleted', detail: { sessionsRevoked: 1 } })
    expectScimError(await call(one.GET, '/api/scim/v2/Users/uJoe', { params: { id: 'uJoe' } }), 404)
    expectScimError(await call(one.DELETE, '/api/scim/v2/Users/uOwner', { method: 'DELETE', params: { id: 'uOwner' } }), 400, 'mutability')
    const again = await call(POST, '/api/scim/v2/Users', { method: 'POST', body: { schemas: [USER], userName: 'joe@a.test' } })
    expect(again.status).toBe(201)
    expect(again.data).toMatchObject({ id: 'uJoe', active: true })
  })

  it('serves discovery documents', async () => {
    const spc = await (await import('@/app/api/scim/v2/ServiceProviderConfig/route')).GET
    const rt = await (await import('@/app/api/scim/v2/ResourceTypes/route')).GET
    const sc = await (await import('@/app/api/scim/v2/Schemas/route')).GET
    const a = await call(spc, '/api/scim/v2/ServiceProviderConfig')
    expect(a.data).toMatchObject({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'], patch: { supported: true }, filter: { supported: true }, bulk: { supported: false } })
    expect((await call(rt, '/api/scim/v2/ResourceTypes')).data.Resources[0]).toMatchObject({ id: 'User', endpoint: '/Users', schema: USER })
    expect((await call(sc, '/api/scim/v2/Schemas')).data.Resources[0].id).toBe(USER)
    expectScimError(await call(spc, '/api/scim/v2/ServiceProviderConfig', { token: null }), 401)
  })
})

describe('SCIM parsing helpers', () => {
  it('parses filters and paging', () => {
    expect(parseFilter(null)).toBeNull()
    expect(parseFilter('userName eq "A@B.test"')).toEqual({ column: 'LOWER(email)', value: 'a@b.test' })
    expect(parseFilter('urn:ietf:params:scim:schemas:core:2.0:User:userName eq "x@y.test"')!.column).toBe('LOWER(email)')
    expect(parseFilter('emails[type eq "work"].value eq "x@y.test"')!.column).toBe('LOWER(email)')
    expect(() => parseFilter('userName sw "a"')).toThrow()
    expect(paging(new URLSearchParams('startIndex=0&count=1000'))).toEqual({ startIndex: 1, count: 200 })
    expect(paging(new URLSearchParams('count=-5'))).toEqual({ startIndex: 1, count: 0 })
  })
  it('reads Entra- and Okta-style PATCH operations', () => {
    expect(desiredFromPatch({ schemas: [PATCH], Operations: [{ op: 'Replace', path: 'active', value: 'False' }] })).toEqual({ active: false })
    expect(desiredFromPatch({ schemas: [PATCH], Operations: [{ op: 'replace', value: { active: false, 'name.givenName': 'A' } }] })).toEqual({ active: false, givenName: 'A' })
    expect(desiredFromPatch({ schemas: [PATCH], Operations: [{ op: 'remove', path: 'externalId' }] })).toEqual({ externalId: null })
  })
})
