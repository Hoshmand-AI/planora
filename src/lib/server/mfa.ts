// Two-step verification: TOTP authenticator apps plus single-use recovery codes.

import QRCode from 'qrcode'
import { query, type User } from '@/lib/db'
import { decrypt, encrypt, sha256 } from './crypto'
import { newRecoveryCodes, newTotpSecret, otpauthUri, verifyTotp } from './totp'

const normCode = (c: string) => c.trim().toLowerCase().replace(/\s/g, '')

/** Verifies and consumes a TOTP code (replay-protected) or a recovery code. */
export async function consumeSecondFactor(user: User, code: string): Promise<'totp' | 'recovery' | null> {
  if (!user.mfaSecret || !user.mfaEnabledAt) return null
  const c = normCode(code)
  if (/^\d{6}$/.test(c)) {
    const step = verifyTotp(decrypt(user.mfaSecret), c, { lastStep: user.mfaLastStep })
    if (step == null) return null
    // Conditional update: a second request with the same code loses the race.
    const res = await query('UPDATE users SET mfa_last_step=$2 WHERE id=$1 AND (mfa_last_step IS NULL OR mfa_last_step < $2)', [user.id, step])
    return (res.rowCount ?? 0) > 0 ? 'totp' : null
  }
  const h = sha256(c)
  if (!user.mfaRecovery.includes(h)) return null
  const res = await query(`UPDATE users SET mfa_recovery = mfa_recovery - $2 WHERE id=$1 AND mfa_recovery ? $2`, [user.id, h])
  return (res.rowCount ?? 0) > 0 ? 'recovery' : null
}

/** Starts enrollment: stores a new (not yet active) secret and returns what the app needs. */
export async function beginEnrollment(user: User): Promise<{ secret: string; uri: string; qrSvg: string }> {
  const secret = newTotpSecret()
  await query('UPDATE users SET mfa_secret=$2, mfa_enabled_at=NULL, mfa_last_step=NULL WHERE id=$1', [user.id, encrypt(secret)])
  const uri = otpauthUri(secret, user.email)
  // QR code rendered on the server as SVG: the secret never goes to a third-party QR service.
  const qrSvg = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
  return { secret, uri, qrSvg }
}

/**
 * Confirms enrollment with a code from the app; returns the recovery codes (shown once).
 * Only a pending enrollment can be confirmed (an active one would otherwise let a single code rotate
 * the recovery codes without re-authentication), and the code's time step must not have been used
 * before. The update is conditional, so two concurrent requests with the same code can't both win.
 */
export async function confirmEnrollment(user: User, code: string): Promise<string[] | null> {
  if (!user.mfaSecret || user.mfaEnabledAt) return null
  const step = verifyTotp(decrypt(user.mfaSecret), normCode(code), { lastStep: user.mfaLastStep })
  if (step == null) return null
  const codes = newRecoveryCodes()
  const res = await query(
    `UPDATE users SET mfa_enabled_at=NOW(), mfa_last_step=$2, mfa_recovery=$3
      WHERE id=$1 AND mfa_secret=$4 AND mfa_enabled_at IS NULL AND (mfa_last_step IS NULL OR mfa_last_step < $2)`,
    [user.id, step, JSON.stringify(codes.map(c => sha256(normCode(c)))), user.mfaSecret])
  return (res.rowCount ?? 0) > 0 ? codes : null
}

/** Replaces the recovery codes. Callers must re-authenticate first (password + current second factor). */
export async function regenerateRecoveryCodes(user: User): Promise<string[] | null> {
  const codes = newRecoveryCodes()
  const res = await query('UPDATE users SET mfa_recovery=$2 WHERE id=$1 AND mfa_enabled_at IS NOT NULL', [user.id, JSON.stringify(codes.map(c => sha256(normCode(c))))])
  return (res.rowCount ?? 0) > 0 ? codes : null
}

export async function disableMfa(userId: string) {
  await query(`UPDATE users SET mfa_secret=NULL, mfa_enabled_at=NULL, mfa_last_step=NULL, mfa_recovery='[]' WHERE id=$1`, [userId])
}
