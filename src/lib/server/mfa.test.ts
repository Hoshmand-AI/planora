import { beforeEach, describe, expect, it, vi } from 'vitest'

// In-memory stand-in for the users row so the conditional UPDATEs can be exercised without Postgres.
const row = { mfa_enabled_at: null as string | null, mfa_last_step: null as number | null, mfa_secret: '' }
const calls: string[] = []
vi.mock('@/lib/db', () => ({
  query: vi.fn(async (sql: string, params: unknown[]) => {
    calls.push(sql)
    if (/SET mfa_enabled_at=NOW\(\)/.test(sql)) {
      const [, step, , secret] = params as [string, number, string, string]
      const ok = row.mfa_secret === secret && row.mfa_enabled_at == null && (row.mfa_last_step == null || row.mfa_last_step < step)
      if (ok) Object.assign(row, { mfa_enabled_at: 'now', mfa_last_step: step })
      return { rowCount: ok ? 1 : 0, rows: [] }
    }
    if (/SET mfa_recovery=\$2/.test(sql)) return { rowCount: row.mfa_enabled_at ? 1 : 0, rows: [] }
    return { rowCount: 1, rows: [] }
  }),
}))

import { confirmEnrollment, regenerateRecoveryCodes } from './mfa'
import { encrypt } from './crypto'
import { base32Encode, hotp, totpStep } from './totp'
import type { User } from '@/lib/db'

const secret = base32Encode(Buffer.from('12345678901234567890'))
const sealed = encrypt(secret)
const user = (over: Partial<User> = {}): User => ({
  id: 'u1', email: 'a@b.co', name: 'A', passwordHash: 'x', plan: 'free', createdAt: '', orgId: 'o1', role: 'owner',
  disabledAt: null, failedLogins: 0, lockedUntil: null, mfaSecret: sealed, mfaEnabledAt: row.mfa_enabled_at, mfaLastStep: row.mfa_last_step,
  mfaRecovery: [], emailVerifiedAt: null, ...over,
} as User)

describe('two-step enrollment', () => {
  beforeEach(() => { Object.assign(row, { mfa_enabled_at: null, mfa_last_step: null, mfa_secret: sealed }); calls.length = 0 })

  it('confirms a pending enrollment once; replaying the same code is rejected', async () => {
    const code = hotp(secret, totpStep())
    expect(await confirmEnrollment(user(), code)).toHaveLength(10)
    // Same code again (fresh row: enrollment now active, step recorded)
    expect(await confirmEnrollment(user(), code)).toBeNull()
    // Even if a stale copy of the user (still pending) is used, the conditional update loses.
    expect(await confirmEnrollment(user({ mfaEnabledAt: null, mfaLastStep: null }), code)).toBeNull()
  })

  it('rejects a code whose time step was already used', async () => {
    const step = totpStep()
    row.mfa_last_step = step
    expect(await confirmEnrollment(user(), hotp(secret, step))).toBeNull()
    expect(await confirmEnrollment(user(), hotp(secret, step - 1))).toBeNull()
  })

  it('cannot rotate recovery codes of an active enrollment through confirmation', async () => {
    row.mfa_enabled_at = 'earlier'
    expect(await confirmEnrollment(user(), hotp(secret, totpStep()))).toBeNull()
    expect(calls.some(s => /mfa_recovery/.test(s))).toBe(false)
  })

  it('regenerating recovery codes requires an active enrollment', async () => {
    expect(await regenerateRecoveryCodes(user())).toBeNull()
    row.mfa_enabled_at = 'earlier'
    expect(await regenerateRecoveryCodes(user())).toHaveLength(10)
  })
})
