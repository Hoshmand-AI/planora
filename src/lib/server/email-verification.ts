// Email verification for self sign-up: a single-use, hashed token valid for 48 hours, sent as a
// link. Members who joined through an invitation (the link went to that address) or single sign-on
// (the identity provider vouches for it) are verified on creation.

import { initSchema, query } from '@/lib/db'
import { randomToken, sha256 } from './crypto'
import { emailConfigured, sendEmail } from './email'
import { ApiError } from './api'
import type { AuthContext } from '@/lib/auth'

const PURPOSE = 'verify_email'
const VALID_HOURS = 48

export async function markEmailVerified(userId: string): Promise<void> {
  await initSchema()
  await query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id=$1', [userId])
}

export async function sendVerificationEmail(user: { id: string; email: string; name: string }, origin: string): Promise<boolean> {
  if (!emailConfigured()) return false
  await initSchema()
  const token = randomToken(32)
  await query('DELETE FROM email_tokens WHERE user_id=$1 AND purpose=$2', [user.id, PURPOSE])
  await query(`INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at) VALUES ($1,$2,$3, NOW() + make_interval(hours => $4))`, [sha256(token), user.id, PURPOSE, VALID_HOURS])
  const link = `${origin}/api/auth/verify?token=${encodeURIComponent(token)}`
  const r = await sendEmail({
    to: user.email, subject: 'Confirm your email for Planora',
    text: `Hi ${user.name},\n\nConfirm that this is your email address for Planora:\n\n${link}\n\nThe link works once and expires in ${VALID_HOURS} hours. If you didn't create a Planora account, ignore this message.\n\n— Planora by Hoshmand AI`,
  })
  return r.sent
}

/** Consumes a verification token. Returns the user id it verified, or null if invalid/expired/used. */
export async function consumeVerificationToken(token: string): Promise<string | null> {
  if (!token || token.length > 100) return null
  await initSchema()
  const res = await query(`UPDATE email_tokens SET used_at=NOW() WHERE token_hash=$1 AND purpose=$2 AND used_at IS NULL AND expires_at > NOW() RETURNING user_id`, [sha256(token), PURPOSE])
  const userId = res.rows[0]?.user_id as string | undefined
  if (!userId) return null
  await markEmailVerified(userId)
  return userId
}

/** Actions that reach outside the account (inviting people, API keys, webhooks, bulk export) need a verified address. */
export function requireVerifiedEmail(auth: AuthContext): void {
  if (auth.emailVerified === false && emailConfigured()) {
    throw new ApiError(403, 'Confirm your email address first: use the link we sent you, or resend it from Account → Profile.', 'email_unverified')
  }
}
