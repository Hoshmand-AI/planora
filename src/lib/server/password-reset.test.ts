import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID, createHash } from 'crypto'

// The database-backed part below runs against a real Postgres when AUTH_TEST_DATABASE_URL is set
// (CI sets it in the e2e job) and is skipped otherwise:
//   AUTH_TEST_DATABASE_URL=postgres://… npx vitest run src/lib/server/password-reset.test.ts
// The module is imported dynamically, after DATABASE_URL points at that database.
const URL_ = process.env.AUTH_TEST_DATABASE_URL
if (URL_) process.env.DATABASE_URL = URL_
type Reset = typeof import('./password-reset')

describe('password reset tokens (pure)', () => {
  let resetTokenHash: Reset['resetTokenHash'], plausibleResetToken: Reset['plausibleResetToken'], resetLink: Reset['resetLink'], resetEmailText: Reset['resetEmailText'], RESET_VALID_MINUTES: number
  beforeAll(async () => {
    ({ resetTokenHash, plausibleResetToken, resetLink, resetEmailText, RESET_VALID_MINUTES } = await import('./password-reset'))
  })
  it('stores only the SHA-256 of the token', () => {
    const token = 'abcDEF123_-abcDEF123_-abcDEF123_-abcDEF123_'
    expect(resetTokenHash(token)).toBe(createHash('sha256').update(token).digest('hex'))
    expect(resetTokenHash(token)).not.toContain(token)
  })
  it('refuses implausible tokens before any lookup', () => {
    expect(plausibleResetToken('')).toBe(false)
    expect(plausibleResetToken(undefined)).toBe(false)
    expect(plausibleResetToken(42)).toBe(false)
    expect(plausibleResetToken('short')).toBe(false)
    expect(plausibleResetToken('x'.repeat(101))).toBe(false)
    expect(plausibleResetToken("abc' OR 1=1 --abcdefghijkl")).toBe(false)
    expect(plausibleResetToken('a'.repeat(43))).toBe(true)
  })
  it('builds the emailed link and text (30-minute expiry, ignore if not requested)', () => {
    const link = resetLink('https://runf9.example', 'tok_en-1')
    expect(link).toBe('https://runf9.example/auth/reset?token=tok_en-1')
    const text = resetEmailText('Ada', link)
    expect(RESET_VALID_MINUTES).toBe(30)
    expect(text).toContain(link)
    expect(text).toMatch(/expires in 30 minutes/)
    expect(text).toMatch(/If you didn't ask for this, ignore this message/)
  })
})

describe.skipIf(!URL_)('password reset tokens on Postgres', () => {
  type Db = typeof import('@/lib/db')
  let db: Db, pr: Reset
  const run = randomUUID().slice(0, 8)
  const org = `org_reset_${run}`
  const userId = `u_reset_${run}`
  const disabledId = `u_reset_off_${run}`
  const tokenRow = async (token: string) => (await db.query('SELECT * FROM email_tokens WHERE token_hash=$1', [pr.resetTokenHash(token)])).rows[0]

  beforeAll(async () => {
    delete process.env.RESEND_API_KEY; delete process.env.POSTMARK_TOKEN; delete process.env.RUNF9_EMAIL_OUTBOX
    db = await import('@/lib/db')
    pr = await import('./password-reset')
    await db.initSchema()
    await db.query('INSERT INTO organizations (id, name) VALUES ($1,$1)', [org])
    await db.query(`INSERT INTO users (id, email, name, password_hash, org_id, role) VALUES ($1,$2,'Rita Reset','x',$3,'owner')`, [userId, `${userId}@example.com`, org])
    await db.query(`INSERT INTO users (id, email, name, password_hash, org_id, role, disabled_at) VALUES ($1,$2,'Gone','x',$3,'viewer',NOW())`, [disabledId, `${disabledId}@example.com`, org])
  })

  afterAll(async () => {
    if (!db) return
    await db.deleteOrganization(org, { id: 'test', email: 'test@example.com' }).catch(() => {})
    await db.closePool()
  })

  it('stores the hash with a 30-minute expiry, never the token', async () => {
    const token = await pr.issueResetToken(userId)
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect((await db.query('SELECT 1 FROM email_tokens WHERE token_hash=$1', [token])).rowCount).toBe(0)
    const row = await tokenRow(token)
    expect(row.purpose).toBe('reset_password')
    expect(row.user_id).toBe(userId)
    const minutes = (new Date(row.expires_at).getTime() - Date.now()) / 60000
    expect(minutes).toBeGreaterThan(29)
    expect(minutes).toBeLessThanOrEqual(30.1)
  })

  it('works once', async () => {
    const token = await pr.issueResetToken(userId)
    expect(await pr.consumeResetToken(token)).toBe(userId)
    expect(await pr.consumeResetToken(token)).toBeNull()
  })

  it('refuses an expired token', async () => {
    const token = await pr.issueResetToken(userId)
    await db.query(`UPDATE email_tokens SET expires_at = NOW() - INTERVAL '1 second' WHERE token_hash=$1`, [pr.resetTokenHash(token)])
    expect(await pr.consumeResetToken(token)).toBeNull()
  })

  it('a new token supersedes older unused ones', async () => {
    const first = await pr.issueResetToken(userId)
    const second = await pr.issueResetToken(userId)
    expect(await tokenRow(first)).toBeUndefined()
    expect(await pr.consumeResetToken(first)).toBeNull()
    expect(await pr.consumeResetToken(second)).toBe(userId)
  })

  it('does not accept an email-confirmation token as a reset token', async () => {
    const token = 'v'.repeat(43)
    await db.query(`INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at) VALUES ($1,$2,'verify_email', NOW() + INTERVAL '1 hour')`, [pr.resetTokenHash(token), userId])
    expect(await pr.consumeResetToken(token)).toBeNull()
  })

  it('a weak password leaves the link usable; a good one resets, clears lockout and confirms the email', async () => {
    await db.query(`UPDATE users SET failed_logins=5, locked_until=NOW() + INTERVAL '10 minutes', email_verified_at=NULL WHERE id=$1`, [userId])
    const token = await pr.issueResetToken(userId)
    const weak = await pr.resetPasswordWithToken(token, 'short')
    expect(weak).toMatchObject({ ok: false, reason: 'weak_password' })
    const good = await pr.resetPasswordWithToken(token, 'a brand new long passphrase')
    expect(good).toMatchObject({ ok: true, userId })
    const u = (await db.query('SELECT password_hash, failed_logins, locked_until, email_verified_at, password_changed_at FROM users WHERE id=$1', [userId])).rows[0]
    expect(u.password_hash).not.toBe('x')
    expect(u.failed_logins).toBe(0)
    expect(u.locked_until).toBeNull()
    expect(u.email_verified_at).not.toBeNull()
    expect(u.password_changed_at).not.toBeNull()
    expect(await pr.resetPasswordWithToken(token, 'another long passphrase here')).toMatchObject({ ok: false, reason: 'invalid_token' })
  })

  it('issues nothing for unknown or disabled accounts (and email is not configured here)', async () => {
    expect(await pr.requestPasswordReset(`nobody_${run}@example.com`, 'http://x')).toBe('no_account')
    expect(await pr.requestPasswordReset(`${disabledId}@example.com`, 'http://x')).toBe('disabled')
    expect((await db.query(`SELECT 1 FROM email_tokens WHERE user_id=$1 AND purpose='reset_password'`, [disabledId])).rowCount).toBe(0)
  })
})
