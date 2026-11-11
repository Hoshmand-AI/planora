import { beforeEach, describe, expect, it, vi } from 'vitest'

// Review round 2 (slice api-rag): M6 lowering a plan's marking needs an admin; M7 malformed bodies.

const audit = vi.fn(async (_e: Record<string, unknown>) => {})
const savePlan = vi.fn(async (p: unknown) => p)
let plan: { id: string; name: string; version: number; answers: Record<string, unknown>; audit: unknown[]; extraQuestions: unknown[] }

vi.mock('@/lib/server/api', () => ({
  // The wrapper (session, permission, rate limit) is covered elsewhere; here the handler is called directly.
  api: (_o: unknown, h: unknown) => h,
  ApiError: class extends Error {},
}))
vi.mock('@/lib/server/audit', () => ({ audit: (e: Record<string, unknown>) => audit(e) }))
vi.mock('@/lib/db', () => ({ savePlan: (p: unknown) => savePlan(p), deletePlan: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/llm/provider', () => ({ deploymentKind: () => 'on_prem' }))
vi.mock('./plans/[id]/context', () => ({
  loadPlanContext: vi.fn(async (_r: unknown, _id: string, auth: unknown) => ({ plan, ctx: auth })),
  elicitationContext: vi.fn(async () => ({ ectx: {} })),
  planView: vi.fn(async (p: { answers: unknown }) => ({ answers: p.answers, elicitation: { dateIssues: [] } })),
}))

import { PATCH } from './plans/[id]/route'
import { jsonObject } from './json-body'

type Handler = (req: Request, ctx: { params: { id: string }; auth: Record<string, unknown> }) => Promise<Response>
const patch = (role: string, body: unknown) => (PATCH as unknown as Handler)(
  new Request('http://x/api/plans/p1', { method: 'PATCH', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  { params: { id: 'p1' }, auth: { orgId: 'o1', userId: 'u1', name: 'Pat', role } },
)
const marked = (value: string) => ({ status: 'known', value, answeredAt: '2026-01-01T00:00:00Z', source: 'user' })
const answer = (value: string) => ({ answers: { 'security.classification': { status: 'known', value } } })

describe('M6: lowering a plan\'s security marking', () => {
  beforeEach(() => {
    audit.mockClear(); savePlan.mockClear()
    plan = { id: 'p1', name: 'Hangar', version: 1, answers: { 'project.type': marked('federal_defense'), 'security.classification': marked('cui') }, audit: [], extraQuestions: [] }
  })

  it('is refused for a scheduler, audited, and nothing is saved', async () => {
    const res = await patch('scheduler', answer('unclassified'))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('downgrade_needs_admin')
    expect(savePlan).not.toHaveBeenCalled()
    expect(plan.answers['security.classification']).toEqual(marked('cui'))
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'plan.classification_refused', targetId: 'p1', detail: expect.objectContaining({ before: 'cui', requested: 'unclassified', reason: 'downgrade_needs_admin' }) }))
  })

  it('is refused when the answer is cleared instead of changed', async () => {
    const res = await patch('scheduler', { answers: { 'security.classification': null } })
    expect(res.status).toBe(403)
    expect(savePlan).not.toHaveBeenCalled()
  })

  it('is allowed for an admin', async () => {
    const res = await patch('admin', answer('unclassified'))
    expect(res.status).toBe(200)
    expect(savePlan).toHaveBeenCalledTimes(1)
    expect((plan.answers['security.classification'] as { value: string }).value).toBe('unclassified')
  })

  it('still lets a scheduler raise a marking or keep it', async () => {
    plan.answers['security.classification'] = marked('unclassified')
    expect((await patch('scheduler', answer('cui'))).status).toBe(200)
    expect((await patch('scheduler', answer('cui'))).status).toBe(200)
    expect(savePlan).toHaveBeenCalledTimes(2)
  })

  it('still lets a scheduler answer other questions on a CUI plan', async () => {
    const res = await patch('scheduler', { name: 'Hangar 2' })
    expect(res.status).toBe(200)
    expect(savePlan).toHaveBeenCalledTimes(1)
  })

  it('M7: a null or malformed body is not a server error', async () => {
    expect((await patch('scheduler', 'null')).status).toBe(200)
    expect((await patch('scheduler', '{not json')).status).toBe(200)
    expect((await patch('scheduler', { answers: 'x' })).status).toBe(200)
  })
})

describe('M7: jsonObject', () => {
  const req = (body: string) => new Request('http://x/api/ask', { method: 'POST', body })
  it('reads an object', async () => expect(await jsonObject(req('{"a":1}'))).toEqual({ a: 1 }))
  for (const bad of ['null', '5', '"text"', '[1,2]', '{broken', '']) {
    it(`reads ${bad || 'an empty body'} as {}`, async () => expect(await jsonObject(req(bad))).toEqual({}))
  }
})
