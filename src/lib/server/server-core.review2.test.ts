// Review round 2, slice server-core: M3 (Ask AI activity match), M4 (fmtDates and codes shaped like
// dates), M6 (digest and revoked access), M7 (client address behind an appending proxy), M8 (identity
// provider endpoints, webhook delivery lookup).
import { createServer } from 'http'
import { lookup as dnsLookup } from 'dns'
import type { AddressInfo, LookupFunction } from 'net'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { buildAskPrompt, namedActivity } from '@/lib/openai'
import { fmtDates } from '@/lib/format'
import { mayReceiveBrief } from './brief-digest'
import { clientIp } from './context'
import { endpointProblem } from './sso'
import { postWithLookup, publicOnlyLookup } from './webhooks'

afterEach(() => vi.unstubAllEnvs())

const act = (id: string) => ({ id: `row-${id}`, scheduleId: 's', activityId: id, name: `Work ${id}`, wbs: 'Site', activityType: 'task', status: 'not_started', duration: 5, remainingDuration: 5, totalFloat: 0, percentComplete: 0, isCritical: false, earlyStart: '2026-01-05', earlyFinish: '2026-01-09' })
const ctx = (ids: string[]) => ({ schedule: { id: 's', name: 'Tower', version: 'v1', dataDate: '2026-01-05', projectStart: '2026-01-05', projectFinish: '2026-03-01' }, activities: ids.map(act), relationships: [] }) as unknown as Parameters<typeof buildAskPrompt>[1]

describe('M3: Ask AI gives detail only for the activity the question names', () => {
  const acts = ['PHASE2-100', 'A1000', 'A10000', 'HAS'].map(act)
  it('an ordinary word after "activity" is not an activity ID', () => {
    expect(namedActivity('Which activity has the most float?', acts)).toBeUndefined()
    expect(namedActivity('Which task is driving the finish?', acts)).toBeUndefined()
    const { system, offline } = buildAskPrompt('Which activity has the most float?', ctx(['PHASE2-100', 'A1000']))
    expect(system).not.toContain('SPECIFIC ACTIVITY DETAIL')
    expect(offline()).not.toContain('SPECIFIC ACTIVITY DETAIL')
  })
  it('part of an ID does not match another activity', () => {
    expect(namedActivity('float of activity 100', acts)).toBeUndefined()
    expect(namedActivity('float of activity A100', acts)).toBeUndefined()
    expect(namedActivity('float of activity A10000', acts)?.activityId).toBe('A10000')
  })
  it('the exact ID matches, in any letter case, with "ID", "#" or a full stop around it', () => {
    expect(namedActivity('What is the float of activity a1000?', acts)?.activityId).toBe('A1000')
    expect(namedActivity('Tell me about task PHASE2-100.', acts)?.activityId).toBe('PHASE2-100')
    expect(namedActivity('Tell me about activity ID A1000', acts)?.activityId).toBe('A1000')
    expect(namedActivity('Which activity precedes activity #A1000?', acts)?.activityId).toBe('A1000')
    expect(buildAskPrompt('Float of activity A1000?', ctx(['PHASE2-100', 'A1000'])).system).toContain('SPECIFIC ACTIVITY DETAIL:\nActivity ID: A1000')
  })
  it('an ID made only of letters matches only when written exactly as the ID', () => {
    expect(namedActivity('Which activity has float?', acts)).toBeUndefined()
    expect(namedActivity('Show activity HAS', acts)?.activityId).toBe('HAS')
  })
})

describe('M4: fmtDates leaves codes that look like dates alone', () => {
  it('activity and WBS codes are not rewritten', () => {
    const t = 'Activity 1010-20-30 follows WBS 0330-10-20, A-2026-10-31 and 2026-10-31-05.'
    expect(fmtDates(t)).toBe(t)
    expect(fmtDates('code 2026-13-01, 2026-00-10, 2026-02-30, 2026-04-31, 3026-01-01')).toBe('code 2026-13-01, 2026-00-10, 2026-02-30, 2026-04-31, 3026-01-01')
    expect(fmtDates('ID12026-10-31 and 2026-10-311')).toBe('ID12026-10-31 and 2026-10-311')
  })
  it('real dates are still rewritten, wherever they stand in the text', () => {
    expect(fmtDates('2026-10-31')).toBe('10/31/2026')
    expect(fmtDates('due 2026-10-31 and 2027-01-05', 'DMY')).toBe('due 31/10/2026 and 05/01/2027')
    expect(fmtDates('Review ends 2027-06-01; start 2026-10-30T00:00:00Z.')).toBe('Review ends 06/01/2027; start 10/30/2026.')
    expect(fmtDates('(2026-10-31) 2026-11-01,2026-11-02: start=2028-02-29')).toBe('(10/31/2026) 11/01/2026,11/02/2026: start=02/29/2028')
    expect(fmtDates('Activity 1010-20-30 slips to 2026-10-31.')).toBe('Activity 1010-20-30 slips to 10/31/2026.')
    expect(fmtDates('at 2026-10-30T08:15:00.000Z and 2026-10-30T08:15:00-05:00 and 1999-12-31')).toBe('at 10/30/2026 and 10/30/2026 and 12/31/1999')
    expect(fmtDates(null)).toBe('')
  })
})

describe('M6: the emailed brief follows the sign-in rule for revoked access', () => {
  const inviteOnly = { RUNF9_PLATFORM_ADMINS: 'ops@example.com' }
  it('skips a member whose access was revoked or never given', () => {
    expect(mayReceiveBrief({ email: 'a@firm.com', beta_access_at: new Date('2026-01-01'), beta_revoked_at: new Date('2026-06-01') }, inviteOnly)).toBe(false)
    expect(mayReceiveBrief({ email: 'a@firm.com', beta_access_at: null, beta_revoked_at: null }, inviteOnly)).toBe(false)
  })
  it('keeps sending to members with access, operators, and everyone on an open instance', () => {
    expect(mayReceiveBrief({ email: 'a@firm.com', beta_access_at: new Date('2026-01-01'), beta_revoked_at: null }, inviteOnly)).toBe(true)
    expect(mayReceiveBrief({ email: 'ops@example.com', beta_access_at: null, beta_revoked_at: null }, inviteOnly)).toBe(true)
    expect(mayReceiveBrief({ email: 'a@firm.com', beta_access_at: null, beta_revoked_at: new Date() }, { RUNF9_SIGNUP: 'open' })).toBe(true)
  })
})

describe('M7: client address', () => {
  const h = (v: string) => new Headers({ 'x-forwarded-for': v })
  it('is the first forwarded entry by default (the proxy sets the header: Vercel, nginx as documented)', () => {
    expect(clientIp(h('203.0.113.7'), undefined)).toBe('203.0.113.7')
    expect(clientIp(h('203.0.113.7, 10.0.0.1'), undefined)).toBe('203.0.113.7')
    expect(clientIp(h('203.0.113.7, 10.0.0.1'), '')).toBe('203.0.113.7')
    expect(clientIp(h('203.0.113.7, 10.0.0.1'), 'abc')).toBe('203.0.113.7')
    expect(clientIp(new Headers({ 'x-real-ip': '198.51.100.2' }), undefined)).toBe('198.51.100.2')
    expect(clientIp(new Headers(), '1')).toBeNull()
  })
  it('with RUNF9_TRUSTED_PROXY_HOPS, is the entry the trusted proxy added, not what the client sent', () => {
    expect(clientIp(h('1.2.3.4, 203.0.113.7'), '1')).toBe('203.0.113.7') // client sent "1.2.3.4", the load balancer appended the real one
    expect(clientIp(h('203.0.113.7'), '1')).toBe('203.0.113.7')
    expect(clientIp(h('1.2.3.4, 203.0.113.7, 10.0.0.1'), '2')).toBe('203.0.113.7')
    expect(clientIp(h('203.0.113.7'), '3')).toBe('203.0.113.7')
  })
})

describe('M8: addresses from an identity provider\'s discovery document', () => {
  const issuer = 'https://8.8.8.8/realms/firm'
  it('must use https', async () => {
    expect(await endpointProblem('http://8.8.4.4/token', issuer)).toMatch(/https/)
    expect(await endpointProblem('file:///etc/passwd', issuer)).toMatch(/https/)
    expect(await endpointProblem('javascript:alert(1)', issuer, { fetched: false })).toMatch(/https/)
    expect(await endpointProblem(undefined, issuer)).toMatch(/not a URL/)
  })
  it('a public issuer may not point the server at a private or internal address', async () => {
    expect(await endpointProblem('https://169.254.169.254/latest/meta-data', issuer)).toMatch(/private or internal/)
    expect(await endpointProblem('https://10.0.0.5/jwks', issuer)).toMatch(/private or internal/)
    expect(await endpointProblem('https://[::1]/jwks', issuer)).toMatch(/private or internal/)
  })
  it('public endpoints, the issuer\'s own host, and an identity provider inside the network still work', async () => {
    expect(await endpointProblem('https://8.8.4.4/token', issuer)).toBeNull()
    expect(await endpointProblem('https://8.8.8.8/realms/firm/certs', issuer)).toBeNull()
    expect(await endpointProblem('https://10.0.0.6/token', 'https://10.0.0.5/realms/firm')).toBeNull()
    expect(await endpointProblem('https://10.0.0.5/authorize', issuer, { fetched: false })).toBeNull() // only the browser goes there
  })
  it('air-gapped: the inside-the-network rule applies to each address', async () => {
    vi.stubEnv('RUNF9_AIRGAPPED', 'true')
    expect(await endpointProblem('https://8.8.4.4/token', 'https://10.0.0.5')).toMatch(/air-gapped/)
    expect(await endpointProblem('https://10.0.0.6/token', 'https://10.0.0.5')).toBeNull()
  })
})

describe('M8: webhook delivery re-checks the address it connects to', () => {
  it('the delivery lookup refuses a host name that resolves to a private address', async () => {
    const err = await new Promise<NodeJS.ErrnoException | null>(resolve => publicOnlyLookup('localhost', { all: true }, e => resolve(e)))
    expect(err?.code).toBe('EPRIVATE')
    const single = await new Promise<NodeJS.ErrnoException | null>(resolve => publicOnlyLookup('localhost', {}, e => resolve(e)))
    expect(single?.code).toBe('EPRIVATE')
  })
  it('a delivery whose lookup is refused never connects; an allowed one is posted once with its body and headers', async () => {
    const seen: { method?: string; body: string; sig?: string | string[]; type?: string | string[] }[] = []
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', () => { seen.push({ method: req.method, body, sig: req.headers['x-runf9-signature'], type: req.headers['content-type'] }); res.statusCode = req.url === '/moved' ? 302 : 204; if (req.url === '/moved') res.setHeader('location', '/x'); res.end() })
    })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    try {
      const url = `http://hooks.test:${(server.address() as AddressInfo).port}`
      const headers = { 'content-type': 'application/json', 'x-runf9-signature': 't=1,v1=ab' }
      // A stand-in for a DNS answer inside the network: the public-only lookup would refuse it.
      const toLoopback: LookupFunction = (_h, options, cb) => dnsLookup('127.0.0.1', options, cb as never)
      expect(await postWithLookup(`${url}/x`, '{"a":"é"}', headers, publicOnlyLookup)).toEqual({ ok: false, status: 'network error' })
      expect(seen).toHaveLength(0)
      expect(await postWithLookup(`${url}/x`, '{"a":"é"}', headers, toLoopback)).toEqual({ ok: true, status: '204' })
      expect(seen).toEqual([{ method: 'POST', body: '{"a":"é"}', sig: 't=1,v1=ab', type: 'application/json' }])
      expect(await postWithLookup(`${url}/moved`, '{}', headers, toLoopback)).toEqual({ ok: false, status: '302' }) // redirects are not followed
      expect(seen).toHaveLength(2)
    } finally { await new Promise(r => server.close(r)) }
  })
})
