// Publishing a plan whose forecast misses its required date (or that has no matching template) needs
// an explicit confirmation; the confirmation is recorded in the plan's audit trail.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { Answer, AnswerValue, GeneratedSchedule } from '@/lib/planning/types'
import { generateSchedule } from '@/lib/planning/generator'

const AT = '2026-01-01T00:00:00.000Z'
const k = (value: AnswerValue): Answer => ({ status: 'known', value, answeredAt: AT })
const answers = (extra: Record<string, Answer> = {}): Record<string, Answer> => ({
  'project.type': k('commercial_office'), 'project.state': k('TX'), 'project.scope': k('new_construction'), 'project.gross_sqft': k(120000), 'project.stories': k(4),
  'project.target_start': k('2026-03-02'), 'project.federal': k(false), 'design.drawings': k(true), 'design.percent': k(100), ...extra,
})

type PlanStub = { id: string; orgId: string; name: string; version: number; answers: Record<string, Answer>; generated: GeneratedSchedule; audit: { at: string; by: string; action: string; detail?: string }[]; reviews: unknown[]; scheduleId?: string | null; workspaceId?: string | null }
let plan: PlanStub
const created: unknown[] = []

vi.mock('pg', () => ({ Pool: class { query = async () => ({ rows: [], rowCount: 0 }); connect = async () => ({ query: async () => ({ rows: [] }), release: () => {} }); end = async () => {} } }))
vi.mock('@/lib/auth', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getAuthContext: async () => ({
    userId: 'u1', email: 'u1@firm.test', name: 'Ana', orgId: 'org_1', orgName: 'Firm', role: 'scheduler', sessionId: 's1',
    settings: (await import('./settings')).normalizeSettings({}), plan: 'enterprise', sessionMethod: 'password', mfaEnabled: true, mfaSetupRequired: false, emailVerified: true,
  }),
}))
vi.mock('./rate-limit', async importOriginal => ({ ...(await importOriginal<typeof import('./rate-limit')>()), hit: async () => ({ ok: true, remaining: 100, retryAfterSec: 0 }) }))
vi.mock('./maintenance', () => ({ maybeRunMaintenance: async () => {} }))
vi.mock('./audit', async importOriginal => ({ ...(await importOriginal<typeof import('./audit')>()), audit: async () => {}, appendAudit: async () => {}, auditQuietly: async () => {} }))
vi.mock('@/lib/db', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/db')>()),
  getSchedules: async () => [],
  createSchedule: async (s: Record<string, unknown>) => { created.push(s); return s },
  createActivities: async () => {},
  createRelationships: async () => {},
  savePlan: async (p: PlanStub) => p,
}))
vi.mock('@/app/api/plans/[id]/context', () => ({
  loadPlanContext: async (_req: Request, _id: string, ctx: unknown) => ({ ctx, plan }),
  planView: async (p: PlanStub) => ({ plan: p }),
}))

async function publish(body?: unknown) {
  const { POST } = await import('@/app/api/plans/[id]/publish/route')
  const req = new NextRequest('http://localhost/api/plans/p1/publish', { method: 'POST', ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) })
  const res = await POST(req, { params: Promise.resolve({ id: 'p1' }) })
  return { status: res.status, data: await res.json() }
}
const stub = (a: Record<string, Answer>): PlanStub => ({ id: 'p1', orgId: 'org_1', name: 'Pilot', version: 1, answers: a, generated: generateSchedule({ answers: a, today: '2026-01-15' }), audit: [], reviews: [], scheduleId: null, workspaceId: null })

describe('publish confirmation for late plans', () => {
  beforeEach(() => { created.length = 0 })
  it('an on-time plan publishes without confirmation', async () => {
    plan = stub(answers())
    const r = await publish()
    expect(r.status).toBe(200)
    expect(created).toHaveLength(1)
  })
  it('a plan more than the threshold late is refused until confirmed, and the confirmation is audited', async () => {
    plan = stub(answers({ 'project.required_finish': k('2026-09-01') }))
    const refused = await publish({})
    expect(refused.status).toBe(409)
    expect(refused.data.code).toBe('publish_confirmation_required')
    expect(refused.data.warnings[0]).toMatchObject({ code: 'late' })
    expect(created).toHaveLength(0)
    // A truthy value other than `true` is not a confirmation.
    expect((await publish({ confirm: 'yes' })).status).toBe(409)
    const ok = await publish({ confirm: true })
    expect(ok.status).toBe(200)
    expect(created).toHaveLength(1)
    expect(plan.audit.slice(-1)[0]).toMatchObject({ action: 'publish', by: 'Ana' })
    expect(plan.audit.slice(-1)[0].detail).toMatch(/Published with confirmation despite: forecast \d+ days late/)
  })
  it('a custom project type without a template needs confirmation too', async () => {
    plan = stub(answers({ 'project.type': { ...k('Cannabis grow facility'), custom: true } }))
    const refused = await publish()
    expect(refused.status).toBe(409)
    expect(refused.data.warnings.map((w: { code: string }) => w.code)).toEqual(['no_template'])
    expect((await publish({ confirm: true })).status).toBe(200)
  })
})
