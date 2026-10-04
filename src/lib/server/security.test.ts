import { describe, expect, it } from 'vitest'
import { hotp, verifyTotp, base32Encode, base32Decode, newRecoveryCodes, otpauthUri } from './totp'
import { passwordProblem } from './password'
import { can, canAssign, ROLES, permissionsOf } from './permissions'
import { normalizeSettings, DEFAULT_SETTINGS } from './settings'
import { crossSiteWrite } from './api'
import { eventHash, GENESIS } from './audit'
import { encrypt, decrypt } from './crypto'
import { neutralizeFormula, exportCsv } from '@/lib/export/csv'
import { databaseTlsConfig } from '@/lib/db'
import { redactedBrief } from '@/lib/planning/ai-questions'
import { coerceAnswer, questionBank } from '@/lib/planning/elicitation'
import { generateSchedule } from '@/lib/planning/generator'
import type { Answer, AnswerValue } from '@/lib/planning/types'

describe('two-step verification codes (RFC 4226 / RFC 6238 test vectors)', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'))
  it('matches the published HOTP values', () => {
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
    expect(['755224', '287082', '359152', '969429'].map((c, i) => hotp(secret, i) === c)).toEqual([true, true, true, true])
  })
  it('matches the published TOTP value at T=59s and allows one step of drift', () => {
    // RFC 6238: T=59 → counter 1 → 94287082 (8 digits) → 287082 (6 digits)
    expect(verifyTotp(secret, '287082', { now: 59_000 })).toBe(1)
    expect(verifyTotp(secret, '287082', { now: 89_000 })).toBe(1)
    expect(verifyTotp(secret, '287082', { now: 200_000 })).toBeNull()
  })
  it('rejects a replayed step and malformed codes', () => {
    expect(verifyTotp(secret, '287082', { now: 59_000, lastStep: 1 })).toBeNull()
    expect(verifyTotp(secret, 'abcdef', { now: 59_000 })).toBeNull()
  })
  it('round-trips base32 and issues distinct recovery codes', () => {
    expect(base32Decode(secret).toString()).toBe('12345678901234567890')
    const codes = newRecoveryCodes()
    expect(new Set(codes).size).toBe(10)
    expect(codes.every(c => /^[a-z2-7]{5}-[a-z2-7]{5}$/.test(c))).toBe(true)
    expect(otpauthUri(secret, 'a@b.co')).toMatch(/^otpauth:\/\/totp\/Planora:a%40b\.co\?secret=GEZ/)
  })
})

describe('password policy', () => {
  it('requires length and blocks common or personal passwords', () => {
    expect(passwordProblem('short')).toMatch(/12 characters/)
    expect(passwordProblem('password1234')).toMatch(/common/)
    expect(passwordProblem('aaaaaaaaaaaaaa')).toMatch(/common/)
    expect(passwordProblem('jsmith-construction-2026', { email: 'jsmith@acme.com' })).toMatch(/email/)
    expect(passwordProblem('correct horse battery staple')).toBeNull()
    expect(passwordProblem('x'.repeat(129))).toMatch(/at most/)
  })
})

describe('role-based access control', () => {
  it('grants least privilege', () => {
    expect(can('viewer', 'read')).toBe(true)
    expect(can('viewer', 'plan.write')).toBe(false)
    expect(can('viewer', 'ai.use')).toBe(false)
    expect(can('reviewer', 'plan.review')).toBe(true)
    expect(can('reviewer', 'plan.write')).toBe(false)
    expect(can('scheduler', 'plan.review')).toBe(false)
    expect(can('scheduler', 'org.manage')).toBe(false)
    expect(can('admin', 'org.own')).toBe(false)
    expect(can('owner', 'org.own')).toBe(true)
    expect(can('superuser', 'read')).toBe(false)
    expect(can(undefined, 'read')).toBe(false)
  })
  it('every role can read and only owners/admins manage the organization', () => {
    for (const r of ROLES) expect(permissionsOf(r)).toContain('read')
    expect(ROLES.filter(r => can(r, 'org.manage'))).toEqual(['owner', 'admin'])
  })
  it('admins cannot create or change owners/admins', () => {
    expect(canAssign('admin', 'scheduler')).toBe(true)
    expect(canAssign('admin', 'admin')).toBe(false)
    expect(canAssign('admin', 'owner')).toBe(false)
    expect(canAssign('owner', 'admin')).toBe(true)
  })
})

describe('organization settings', () => {
  it('falls back to safe defaults and clamps values', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    const s = normalizeSettings({ requireMfa: 'yes', sessionIdleHours: 999, aiDailyLimit: -5, chatRetentionDays: 'x' })
    expect(s.requireMfa).toBe(false)
    expect(s.sessionIdleHours).toBe(24)
    expect(s.aiDailyLimit).toBe(0)
    expect(s.chatRetentionDays).toBe(DEFAULT_SETTINGS.chatRetentionDays)
  })
})

describe('cross-site request forgery defence', () => {
  const req = (method: string, headers: Record<string, string>) => new Request('https://app.planora.test/api/plans', { method, headers })
  it('blocks writes from other sites and allows same-origin and non-browser clients', () => {
    expect(crossSiteWrite(req('POST', { origin: 'https://evil.test', host: 'app.planora.test' }))).toBe(true)
    expect(crossSiteWrite(req('POST', { 'sec-fetch-site': 'cross-site', host: 'app.planora.test' }))).toBe(true)
    expect(crossSiteWrite(req('POST', { origin: 'null', host: 'app.planora.test' }))).toBe(true)
    expect(crossSiteWrite(req('POST', { origin: 'https://app.planora.test', host: 'app.planora.test' }))).toBe(false)
    expect(crossSiteWrite(req('POST', { host: 'app.planora.test' }))).toBe(false)
    expect(crossSiteWrite(req('GET', { origin: 'https://evil.test', host: 'app.planora.test' }))).toBe(false)
  })
})

describe('tamper-evident audit hashing', () => {
  const e = { id: '1', orgId: 'o', at: '2026-10-04T00:00:00.000Z', actorId: 'u', actorEmail: 'a@b.co', action: 'plan.export', targetType: 'plan', targetId: 'p', detail: { b: 1, a: [1, 2] }, ip: '1.2.3.4', userAgent: 'x', requestId: 'r' }
  it('is stable regardless of key order and changes with any field or the chain link', () => {
    const h = eventHash(GENESIS, e)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(eventHash(GENESIS, { ...e, detail: { a: [1, 2], b: 1 } })).toBe(h)
    expect(eventHash(GENESIS, { ...e, action: 'plan.delete' })).not.toBe(h)
    expect(eventHash(GENESIS, { ...e, detail: { b: 2, a: [1, 2] } })).not.toBe(h)
    expect(eventHash(h, e)).not.toBe(h)
  })
})

describe('field encryption', () => {
  it('round-trips and detects tampering', () => {
    const sealed = encrypt('JBSWY3DPEHPK3PXP')
    expect(sealed).not.toContain('JBSWY3DP')
    expect(decrypt(sealed)).toBe('JBSWY3DPEHPK3PXP')
    const parts = sealed.split('.')
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('A') ? 'BB' : 'AA')
    expect(() => decrypt(parts.join('.'))).toThrow()
    const short = sealed.split('.')
    short[2] = Buffer.from(short[2], 'base64url').subarray(0, 4).toString('base64url')
    expect(() => decrypt(short.join('.'))).toThrow(/tag/)
  })
})

describe('spreadsheet formula injection', () => {
  it('neutralizes formula-like text but keeps numbers', () => {
    expect(neutralizeFormula('=HYPERLINK("http://x","click")')).toBe('\'=HYPERLINK("http://x","click")')
    expect(neutralizeFormula('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(neutralizeFormula('-5')).toBe('-5')
    expect(neutralizeFormula('Pour slab')).toBe('Pour slab')
    const csv = exportCsv([{ name: '=cmd|\' /C calc\'!A0', n: -3 }], [{ key: 'name', label: 'Name' }, { key: 'n', label: 'N' }])
    expect(csv.split('\r\n')[1]).toBe("'=cmd|' /C calc'!A0,-3")
  })
})

describe('database TLS', () => {
  it('verifies certificates for remote databases and strips weaker URL modes', () => {
    const c = databaseTlsConfig({ DATABASE_URL: 'postgresql://u:p@ep-x.neon.tech/db?sslmode=require&channel_binding=require' })
    expect(c.ssl).toEqual({ rejectUnauthorized: true })
    expect(c.connectionString).not.toContain('sslmode')
    expect(c.connectionString).toContain('channel_binding=require')
    expect(databaseTlsConfig({ DATABASE_URL: 'postgres://u:p@localhost:5432/db' }).ssl).toBe(false)
    expect(databaseTlsConfig({ DATABASE_URL: 'postgres://u:p@db.enclave/db', PGSSLMODE: 'disable' }).ssl).toBe(false)
  })
})

describe('withheld answers never reach a model', () => {
  const k = (value: AnswerValue): Answer => ({ status: 'known', value, answeredAt: '2026-01-01T00:00:00Z' })
  const SECRET = 'Building 7 SCIF at grid line Q'
  const answers: Record<string, Answer> = {
    'project.type': k('federal_defense'), 'project.state': k('VA'), 'project.scope': k('new_construction'), 'project.gross_sqft': k(80000),
    'project.target_start': k('2026-11-02'), 'design.drawings': k(true), 'design.percent': k(60), 'project.federal': k(true),
  }
  it('drops a value sent with a withheld status', () => {
    const q = questionBank({ answers }).all.find(x => x.allowWithheld)!
    expect(coerceAnswer(q, { status: 'withheld', value: SECRET, answeredAt: 'x' }).value).toBeUndefined()
  })
  it('keeps withheld answers out of the brief, the schedule and its notes', () => {
    const bank = questionBank({ answers }).all
    const withheldIds = bank.filter(q => q.allowWithheld).slice(0, 3).map(q => q.id)
    const all = { ...answers }
    for (const id of withheldIds) all[id] = { status: 'withheld', value: SECRET, answeredAt: 'x', note: SECRET } as Answer
    const brief = redactedBrief(all, bank)
    expect(brief).not.toContain(SECRET)
    expect(brief).toMatch(/withheld for security reasons/)
    const g = generateSchedule({ answers: Object.fromEntries(Object.entries(all).map(([id, a]) => [id, a.status === 'withheld' ? { ...a, value: undefined, note: undefined } : a])), today: '2026-09-30' })
    expect(JSON.stringify(g)).not.toContain(SECRET)
  })
})
