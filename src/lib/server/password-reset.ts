// Password reset by email ("Forgot password?"). The token is a random 32-byte value sent only in the
// emailed link; the database keeps its SHA-256 (in email_tokens, purpose 'reset_password'). It is
// valid for 30 minutes and works once; issuing a new one deletes the user's older unused reset tokens.
// The request step never reveals whether an account exists: the route answers the same way for every
// address and does the lookup and sending after the response (see /api/auth, action request_password_reset).

import { getUserByEmail, initSchema, query } from '@/lib/db'
import { hashPassword, revokeAllSessions } from '@/lib/auth'
import { randomToken, sha256 } from './crypto'
import { sendEmail } from './email'
import { audit, auditQuietly } from './audit'
import { ssoEnforced } from './saml'
import { passwordProblem } from './password'
import { markEmailVerified } from './email-verification'
import { reset as resetRateLimit } from './rate-limit'

export const RESET_PURPOSE = 'reset_password'
export const RESET_VALID_MINUTES = 30
export const RESET_INVALID_MESSAGE = 'This reset link is invalid or has expired. Request a new one.'

/** What the database stores for a token (the token itself is never stored or logged). */
export const resetTokenHash = (token: string) => sha256(token)

/** Tokens are 43 base64url characters; anything else is refused before touching the database. */
export const plausibleResetToken = (token: unknown): token is string =>
  typeof token === 'string' && /^[A-Za-z0-9_-]{20,100}$/.test(token)

export function resetLink(origin: string, token: string): string {
  return `${origin}/auth/reset?token=${encodeURIComponent(token)}`
}

export function resetEmailText(name: string, link: string): string {
  return `Hi ${name},\n\nSomeone (hopefully you) asked to reset the password for your Hoshmand Schedule account. Choose a new password here:\n\n${link}\n\nThe link works once and expires in ${RESET_VALID_MINUTES} minutes. If you didn't ask for this, ignore this message: your password stays the same.\n\n— Hoshmand Schedule by Hoshmand AI`
}

/** Issues a fresh reset token for a user (older unused reset tokens stop working). Returns the token. */
export async function issueResetToken(userId: string): Promise<string> {
  await initSchema()
  const token = randomToken(32)
  await query('DELETE FROM email_tokens WHERE user_id=$1 AND purpose=$2 AND used_at IS NULL', [userId, RESET_PURPOSE])
  await query(`INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at) VALUES ($1,$2,$3, NOW() + make_interval(mins => $4))`,
    [resetTokenHash(token), userId, RESET_PURPOSE, RESET_VALID_MINUTES])
  return token
}

/** Atomically uses a reset token. Returns its user id, or null if it is invalid, expired or already used. */
export async function consumeResetToken(token: unknown): Promise<string | null> {
  if (!plausibleResetToken(token)) return null
  await initSchema()
  const res = await query(`UPDATE email_tokens SET used_at=NOW() WHERE token_hash=$1 AND purpose=$2 AND used_at IS NULL AND expires_at > NOW() RETURNING user_id`,
    [resetTokenHash(token), RESET_PURPOSE])
  return (res.rows[0]?.user_id as string | undefined) ?? null
}

/** Whether a reset token would currently be accepted (does not use it). */
async function resetTokenUsable(token: string): Promise<{ userId: string } | null> {
  const res = await query('SELECT user_id FROM email_tokens WHERE token_hash=$1 AND purpose=$2 AND used_at IS NULL AND expires_at > NOW()', [resetTokenHash(token), RESET_PURPOSE])
  return res.rows[0] ? { userId: res.rows[0].user_id as string } : null
}

export type ResetRequestOutcome = 'sent' | 'no_account' | 'disabled' | 'sso_required' | 'send_failed'

/**
 * Sends a reset link if the address belongs to an active account that may use a password.
 * The outcome is for logs and tests only; callers must not show it to the requester.
 * Members of an organization that enforces single sign-on get no link (they sign in through their
 * identity provider); owners keep password sign-in as a break-glass account, as at sign-in.
 */
export async function requestPasswordReset(email: string, origin: string): Promise<ResetRequestOutcome> {
  const user = await getUserByEmail(email)
  if (!user) return 'no_account'
  if (user.disabledAt) return 'disabled'
  if (user.role !== 'owner' && await ssoEnforced(user.orgId)) return 'sso_required'
  const token = await issueResetToken(user.id)
  const r = await sendEmail({ to: user.email, subject: 'Reset your Hoshmand Schedule password', text: resetEmailText(user.name, resetLink(origin, token)) })
  // Never the token or the link.
  await auditQuietly({ orgId: user.orgId, action: 'auth.password_reset_requested', targetType: 'user', targetId: user.id, actor: { id: null, email: user.email }, detail: { emailed: r.sent } })
  return r.sent ? 'sent' : 'send_failed'
}

export type ResetResult = { ok: true; userId: string; sessionsRevoked: number } | { ok: false; reason: 'invalid_token' } | { ok: false; reason: 'weak_password'; message: string }

/**
 * Sets a new password with a reset token: checks the password against the policy (with the
 * account's email and name), uses the token once, signs the account out everywhere, clears a
 * sign-in lockout and marks the email confirmed (the link proved control of the inbox).
 */
export async function resetPasswordWithToken(token: unknown, password: unknown): Promise<ResetResult> {
  if (!plausibleResetToken(token)) return { ok: false, reason: 'invalid_token' }
  await initSchema()
  // Look first so a weak password doesn't burn the link; the consume below is the atomic check.
  const pending = await resetTokenUsable(token)
  if (!pending) return { ok: false, reason: 'invalid_token' }
  const owner = await query('SELECT email, name, org_id, disabled_at FROM users WHERE id=$1', [pending.userId])
  const u = owner.rows[0]
  if (!u || u.disabled_at) return { ok: false, reason: 'invalid_token' }
  const problem = passwordProblem(password, { email: u.email, name: u.name })
  if (problem) return { ok: false, reason: 'weak_password', message: problem }
  const userId = await consumeResetToken(token)
  if (!userId || userId !== pending.userId) return { ok: false, reason: 'invalid_token' }
  await query('UPDATE users SET password_hash=$2, password_changed_at=NOW(), failed_logins=0, locked_until=NULL WHERE id=$1', [userId, await hashPassword(String(password))])
  const sessionsRevoked = await revokeAllSessions(userId)
  await resetRateLimit(`signin:email:${String(u.email).toLowerCase()}`)
  await markEmailVerified(userId)
  await audit({ orgId: u.org_id, action: 'auth.password_reset', targetType: 'user', targetId: userId, actor: { id: userId, email: u.email }, detail: { sessionsRevoked } })
  return { ok: true, userId, sessionsRevoked }
}
