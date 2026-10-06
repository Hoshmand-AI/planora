import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { WorkspaceAccess } from './context'
import { canSeeWorkspace, workspaceClause } from './workspace-scope'

// Ethical walls between matter / engagement workspaces. The first block tests the rules; the second
// runs the real route handlers against an in-memory stand-in for Postgres and proves that a
// restricted member can't read another workspace's schedule or plan through any endpoint family
// (lists, reads, exports, quality, risk, compare, reports, Ask AI, portfolio, history, plans).

describe('workspace visibility rules', () => {
  const restricted: WorkspaceAccess = { all: false, restricted: true, memberOf: ['wsA'], walled: ['wsB'] }
  const open: WorkspaceAccess = { all: false, restricted: false, memberOf: [], walled: ['wsB'] }
  const openMember: WorkspaceAccess = { all: false, restricted: false, memberOf: ['wsB'], walled: ['wsB'] }

  it('owners and admins see everything', () => {
    expect(workspaceClause({ all: true }, 'workspace_id', 2)).toEqual({ sql: '', params: [] })
    expect(canSeeWorkspace({ all: true }, 'wsB')).toBe(true)
  })
  it('a restricted member sees only their workspaces (not organization-wide items)', () => {
    expect(workspaceClause(restricted, 'workspace_id', 3)).toEqual({ sql: 'workspace_id = ANY($3::text[])', params: [['wsA']] })
    expect(canSeeWorkspace(restricted, 'wsA')).toBe(true)
    expect(canSeeWorkspace(restricted, 'wsB')).toBe(false)
    expect(canSeeWorkspace(restricted, 'wsC')).toBe(false)
    expect(canSeeWorkspace(restricted, null)).toBe(false)
  })
  it('a restricted member with no workspaces sees nothing', () => {
    const none: WorkspaceAccess = { all: false, restricted: true, memberOf: [], walled: [] }
    expect(workspaceClause(none, 's.workspace_id', 2)).toEqual({ sql: 's.workspace_id = ANY($2::text[])', params: [[]] })
    expect(canSeeWorkspace(none, null)).toBe(false)
  })
  it('other members see everything except walled workspaces they are not in', () => {
    expect(workspaceClause(open, 'workspace_id', 2)).toEqual({ sql: '(workspace_id IS NULL OR NOT (workspace_id = ANY($2::text[])))', params: [['wsB']] })
    expect(canSeeWorkspace(open, null)).toBe(true)
    expect(canSeeWorkspace(open, 'wsA')).toBe(true)
    expect(canSeeWorkspace(open, 'wsB')).toBe(false)
    expect(workspaceClause(openMember, 'workspace_id', 2)).toEqual({ sql: '', params: [] })
    expect(canSeeWorkspace(openMember, 'wsB')).toBe(true)
  })
})

/* ─── In-memory stand-in for Postgres ───────────────────────────────── */

type Row = Record<string, unknown>
const ORG = 'org_1'
const sched = (id: string, workspace_id: string | null, project_key: string): Row => ({
  id, org_id: ORG, user_id: 'u-admin', name: `Project ${id}`, version: 'Baseline', source_type: 'p6_xer', file_name: `${id}.xer`,
  uploaded_at: '2026-01-01T00:00:00Z', activity_count: 0, relationship_count: 0, project_start: null, project_finish: null, data_date: null,
  variance_days: null, critical_count: 0, percent_complete: 0, calendars: [], default_calendar_id: null, warnings: [], plan_id: null,
  project_type: null, region: null, gross_sqft: null, analysis: null, project_key, in_history: true, finish_milestone_id: null, workspace_id,
})
const plan = (id: string, workspace_id: string | null): Row => ({
  id, org_id: ORG, user_id: 'u-admin', name: `Plan ${id}`, answers: {}, extra_questions: [], generated: null, reviews: [], decisions: {}, audit: [],
  schedule_id: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', version: 1, workspace_id,
})

const db = {
  schedules: [sched('sA', 'wsA', 'pa'), sched('sB', 'wsB', 'pb'), sched('sB2', 'wsB', 'pb'), sched('sOrg', null, 'po')],
  plans: [plan('pA', 'wsA'), plan('pB', 'wsB')],
  workspaces: [
    { id: 'wsA', org_id: ORG, name: 'Matter A', walled: false, created_by: 'u-admin', created_at: '2026-01-01T00:00:00Z', member_ids: ['u-res'], schedule_count: 1, plan_count: 1 },
    { id: 'wsB', org_id: ORG, name: 'Matter B', walled: true, created_by: 'u-admin', created_at: '2026-01-01T00:00:00Z', member_ids: [], schedule_count: 2, plan_count: 1 },
  ],
  users: {
    'u-res': { restricted: true, member_of: ['wsA'] },
    'u-open': { restricted: false, member_of: [] },
  } as Record<string, { restricted: boolean; member_of: string[] }>,
}
const log: { sql: string; params: unknown[] }[] = []

function param(sql: string, re: RegExp, params: unknown[]): unknown {
  const m = re.exec(sql)
  return m ? params[Number(m[1]) - 1] : undefined
}

/** Applies the conditions the scoped reads in db.ts generate (org, id, series, workspace clause). */
function select(rows: Row[], sql: string, params: unknown[]): Row[] {
  const org = param(sql, /org_id\s*=\s*\$(\d+)/, params)
  const id = param(sql, /(?:^|[\s(.])(?:id|schedule_id)\s*=\s*\$(\d+)/, params)
  const key = param(sql, /project_key\s*=\s*\$(\d+)/, params)
  const only = /workspace_id = ANY\(\$(\d+)::text\[\]\)\)?/.exec(sql)
  const ws = only ? (params[Number(only[1]) - 1] as string[]) : null
  const exclude = /IS NULL OR NOT/.test(sql)
  return rows.filter(r => (org === undefined || r.org_id === org) && (id === undefined || r.id === id) && (key === undefined || r.project_key === key)
    && (!ws || (exclude ? (r.workspace_id == null || !ws.includes(r.workspace_id as string)) : ws.includes(r.workspace_id as string))))
}

function fakeQuery(sql: string, params: unknown[] = []) {
  log.push({ sql, params })
  const ok = (rows: Row[]) => Promise.resolve({ rows, rowCount: rows.length })
  if (/AS member_of/.test(sql)) {
    const u = db.users[params[0] as string] ?? { restricted: false, member_of: [] }
    return ok([{ restricted: u.restricted, member_of: u.member_of, walled: db.workspaces.filter(w => w.walled).map(w => w.id) }])
  }
  if (/FROM workspaces w/.test(sql)) return ok(db.workspaces as Row[])
  if (/FROM audit_events/.test(sql)) {
    const ev = (seq: number, action: string, target_type: string, target_id: string, name: string): Row => ({
      seq, id: `e${seq}`, org_id: ORG, at: '2026-01-01T00:00:00Z', actor_id: 'u-admin', actor_email: 'a@firm.test', action, target_type, target_id,
      detail: { name }, ip: null, user_agent: null, request_id: null, prev_hash: '0', hash: '1',
    })
    return ok([ev(5, 'schedule.export', 'schedule', 'sB', 'Project sB'), ev(4, 'plan.answer', 'plan', 'pB', 'Plan pB'), ev(3, 'workspace.created', 'workspace', 'wsB', 'Matter B'),
      ev(2, 'schedule.upload', 'schedule', 'sA', 'Project sA'), ev(1, 'auth.signin', 'user', 'u-res', '')])
  }
  if (/FROM organizations/.test(sql)) return ok([{ id: ORG, name: 'Firm', settings: {}, created_at: '2026-01-01T00:00:00Z', plan: 'enterprise', sso: {} }])
  if (/^\s*SELECT/.test(sql) && /FROM schedule_files/.test(sql)) return ok([]) // no original files kept in this fixture
  if (/^\s*SELECT/.test(sql) && /FROM schedules\b/.test(sql) && !/COUNT/.test(sql)) return ok(select(db.schedules, sql, params))
  if (/^\s*SELECT/.test(sql) && /FROM plans\b/.test(sql) && !/security\.classification/.test(sql)) return ok(select(db.plans, sql, params))
  if (/COUNT\(\*\)/.test(sql)) return ok([{ n: 0 }])
  return ok([])
}

vi.mock('pg', () => ({
  Pool: class {
    query = (sql: string, params?: unknown[]) => fakeQuery(sql, params)
    connect = async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release: () => {} })
    end = async () => {}
  },
}))

let currentUser: { userId: string; role: string } = { userId: 'u-res', role: 'scheduler' }
vi.mock('@/lib/auth', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getAuthContext: async () => ({
    userId: currentUser.userId, email: `${currentUser.userId}@firm.test`, name: currentUser.userId, orgId: ORG, orgName: 'Firm', role: currentUser.role,
    sessionId: 's1', settings: (await import('./settings')).normalizeSettings({}), plan: 'enterprise', sessionMethod: 'password',
    mfaEnabled: true, mfaSetupRequired: false, emailVerified: true,
  }),
}))
vi.mock('./rate-limit', async importOriginal => ({ ...(await importOriginal<typeof import('./rate-limit')>()), hit: async () => ({ ok: true, remaining: 100, retryAfterSec: 0 }) }))
vi.mock('./maintenance', () => ({ maybeRunMaintenance: async () => {} }))
vi.mock('./audit', async importOriginal => ({ ...(await importOriginal<typeof import('./audit')>()), audit: async () => {}, appendAudit: async () => {}, auditQuietly: async () => {} }))
vi.mock('@/lib/openai', () => ({ generateReport: async () => 'LEAK', askScheduleQuestion: async () => 'LEAK' }))

type Handler = (req: NextRequest, ctx?: { params?: Promise<Record<string, string>> }) => Promise<Response>
async function call(handler: Handler, url: string, opts: { method?: string; body?: unknown; params?: Record<string, string> } = {}) {
  const req = new NextRequest(`http://localhost${url}`, {
    method: opts.method || 'GET',
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body), headers: { 'content-type': 'application/json' } } : {}),
  })
  const res = await handler(req, { params: Promise.resolve(opts.params || {}) })
  const text = await res.text()
  return { status: res.status, text }
}

const WALLED_NAMES = ['Project sB', 'Plan pB', '"sB"', '"sB2"', '"pB"', 'Matter B']
function expectNoLeak(r: { status: number; text: string }) {
  expect(r.status, r.text).not.toBe(200)
  expect([403, 404]).toContain(r.status)
  for (const n of WALLED_NAMES) expect(r.text).not.toContain(n)
}

describe('ethical walls on every endpoint family', () => {
  beforeEach(() => { currentUser = { userId: 'u-res', role: 'scheduler' }; log.length = 0 })

  it('schedule list and reads, edits and deletes', async () => {
    const schedules = await import('@/app/api/schedules/route')
    const list = await call(schedules.GET, '/api/schedules')
    expect(list.status).toBe(200)
    const ids = (JSON.parse(list.text).schedules as { id: string }[]).map(s => s.id)
    expect(ids).toEqual(['sA'])
    expectNoLeak(await call(schedules.GET, '/api/schedules?id=sB'))
    expectNoLeak(await call(schedules.GET, '/api/schedules?id=sOrg'))
    expectNoLeak(await call(schedules.PATCH, '/api/schedules', { method: 'PATCH', body: { id: 'sB', inHistory: false } }))
    expectNoLeak(await call(schedules.DELETE, '/api/schedules?id=sB', { method: 'DELETE' }))
  })

  it('schedule exports (including the original file), quality and risk', async () => {
    const exp = await import('@/app/api/schedules/[id]/export/route')
    const quality = await import('@/app/api/schedules/[id]/quality/route')
    const risk = await import('@/app/api/schedules/[id]/risk/route')
    for (const format of ['original', 'xer', 'csv', 'xml']) expectNoLeak(await call(exp.GET, `/api/schedules/sB/export?format=${format}`, { params: { id: 'sB' } }))
    expectNoLeak(await call(quality.GET, '/api/schedules/sB/quality', { params: { id: 'sB' } }))
    expectNoLeak(await call(quality.POST, '/api/schedules/sB/quality', { method: 'POST', params: { id: 'sB' }, body: { questionId: 'q', response: 'intentional' } }))
    expectNoLeak(await call(risk.GET, '/api/schedules/sB/risk', { params: { id: 'sB' } }))
  })

  it('compare: neither side may be in another workspace', async () => {
    const compare = await import('@/app/api/schedules/compare/route')
    expectNoLeak(await call(compare.GET, '/api/schedules/compare?id=sB'))
    expectNoLeak(await call(compare.GET, '/api/schedules/compare?id=sB&format=csv'))
    expectNoLeak(await call(compare.GET, '/api/schedules/compare?id=sA&base=sB'))
  })

  it('reports and Ask AI', async () => {
    const reports = await import('@/app/api/reports/route')
    const ask = await import('@/app/api/ask/route')
    expectNoLeak(await call(reports.POST, '/api/reports', { method: 'POST', body: { reportType: 'executive_summary', scheduleId: 'sB' } }))
    expectNoLeak(await call(ask.POST, '/api/ask', { method: 'POST', body: { question: 'finish?', scheduleId: 'sB' } }))
    expectNoLeak(await call(ask.GET, '/api/ask?scheduleId=sB'))
  })

  it('portfolio and firm history only include visible work', async () => {
    const portfolio = await import('@/app/api/portfolio/route')
    const history = await import('@/app/api/history/route')
    const p = await call(portfolio.GET, '/api/portfolio')
    expect(p.status).toBe(200)
    for (const n of ['Project sB', 'Plan pB', 'Project sOrg']) expect(p.text).not.toContain(n)
    const h = await call(history.GET, '/api/history')
    expect(h.status).toBe(200)
    expect((JSON.parse(h.text).schedules as { id: string }[]).map(s => s.id)).toEqual(['sA'])
  })

  it('plan list, reads, exports and every plan action', async () => {
    const plans = await import('@/app/api/plans/route')
    const list = await call(plans.GET, '/api/plans')
    expect((JSON.parse(list.text).plans as { id: string }[]).map(p => p.id)).toEqual(['pA'])
    const one = await import('@/app/api/plans/[id]/route')
    expectNoLeak(await call(one.GET, '/api/plans/pB', { params: { id: 'pB' } }))
    expectNoLeak(await call(one.PATCH, '/api/plans/pB', { method: 'PATCH', params: { id: 'pB' }, body: { name: 'x' } }))
    expectNoLeak(await call(one.DELETE, '/api/plans/pB', { method: 'DELETE', params: { id: 'pB' } }))
    const sub = {
      export: await import('@/app/api/plans/[id]/export/route'), risk: await import('@/app/api/plans/[id]/risk/route'),
      decide: await import('@/app/api/plans/[id]/decide/route'), edit: await import('@/app/api/plans/[id]/edit/route'),
      generate: await import('@/app/api/plans/[id]/generate/route'), publish: await import('@/app/api/plans/[id]/publish/route'),
      recover: await import('@/app/api/plans/[id]/recover/route'), review: await import('@/app/api/plans/[id]/review/route'),
      suggest: await import('@/app/api/plans/[id]/suggest/route'),
    }
    for (const [name, mod] of Object.entries(sub)) {
      const m = mod as unknown as Record<string, Handler>
      for (const method of ['GET', 'POST'] as const) {
        if (!m[method]) continue
        const r = await call(m[method], `/api/plans/pB/${name}${method === 'GET' ? '?format=csv' : ''}`, { method, params: { id: 'pB' }, ...(method === 'POST' ? { body: {} } : {}) })
        expectNoLeak(r)
      }
    }
  })

  it('every schedule and plan read in a restricted request carries the workspace condition', async () => {
    const portfolio = await import('@/app/api/portfolio/route')
    const compare = await import('@/app/api/schedules/compare/route')
    await call(portfolio.GET, '/api/portfolio')
    await call(compare.GET, '/api/schedules/compare?id=sA')
    const reads = log.filter(q => /^\s*SELECT/.test(q.sql) && /FROM (schedules|plans)\b/.test(q.sql) && !/security\.classification|COUNT/.test(q.sql))
    expect(reads.length).toBeGreaterThan(2)
    for (const q of reads) expect(q.sql).toMatch(/workspace_id = ANY/)
  })

  it('audit log: a restricted reviewer does not see events about walled schedules, plans or workspaces', async () => {
    currentUser = { userId: 'u-res', role: 'reviewer' }
    const auditRoute = await import('@/app/api/audit/route')
    const r = await call(auditRoute.GET, '/api/audit')
    expect(r.status).toBe(200)
    const body = JSON.parse(r.text)
    expect((body.events as { seq: number }[]).map(e => e.seq)).toEqual([2, 1])
    expect(body.nextBefore).toBe(1)
    for (const n of ['Project sB', 'Plan pB', 'Matter B']) expect(r.text).not.toContain(n)
    const csv = await call(auditRoute.GET, '/api/audit?format=csv')
    for (const n of ['Project sB', 'Plan pB', 'Matter B']) expect(csv.text).not.toContain(n)
    currentUser = { userId: 'u-admin', role: 'admin' }
    expect(JSON.parse((await call(auditRoute.GET, '/api/audit')).text).events).toHaveLength(5)
  })

  it('workspace pickers only list what the member can see', async () => {
    const ws = await import('@/app/api/workspaces/route')
    const r = await call(ws.GET, '/api/workspaces')
    expect(r.status).toBe(200)
    expect(r.text).toContain('Matter A')
    expect(r.text).not.toContain('Matter B')
    expect(JSON.parse(r.text).you.restricted).toBe(true)
    expectNoLeak(await call(ws.POST, '/api/workspaces', { method: 'POST', body: { action: 'assign', itemType: 'schedule', itemId: 'sB', workspaceId: 'wsA' } }))
  })

  it('an unrestricted member sees organization-wide and open work but not walled matters', async () => {
    currentUser = { userId: 'u-open', role: 'viewer' }
    const schedules = await import('@/app/api/schedules/route')
    const ids = (JSON.parse((await call(schedules.GET, '/api/schedules')).text).schedules as { id: string }[]).map(s => s.id).sort()
    expect(ids).toEqual(['sA', 'sOrg'])
    expectNoLeak(await call(schedules.GET, '/api/schedules?id=sB'))
  })

  it('owners and admins see every workspace', async () => {
    currentUser = { userId: 'u-admin', role: 'admin' }
    const schedules = await import('@/app/api/schedules/route')
    const plans = await import('@/app/api/plans/route')
    const ids = (JSON.parse((await call(schedules.GET, '/api/schedules')).text).schedules as { id: string }[]).map(s => s.id).sort()
    expect(ids).toEqual(['sA', 'sB', 'sB2', 'sOrg'])
    expect((JSON.parse((await call(plans.GET, '/api/plans')).text).plans as { id: string }[]).map(p => p.id).sort()).toEqual(['pA', 'pB'])
    const ws = await import('@/app/api/workspaces/route')
    expect((await call(ws.GET, '/api/workspaces')).text).toContain('Matter B')
  })
})
