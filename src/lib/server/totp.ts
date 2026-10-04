// Time-based one-time passwords (RFC 6238 / RFC 4226): HMAC-SHA1, 30-second steps, 6 digits.
// Works with any authenticator app (Microsoft/Google Authenticator, 1Password, Authy, ...).

import { createHmac, randomBytes } from 'crypto'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = ''
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0, value = 0
  const out: number[] = []
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch); bits += 5
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(out)
}

export const newTotpSecret = () => base32Encode(randomBytes(20))

export function hotp(secret: string, counter: number): string {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counter))
  const h = createHmac('sha1', base32Decode(secret)).update(buf).digest()
  const o = h[h.length - 1] & 0xf
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]
  return String(code % 1_000_000).padStart(6, '0')
}

export const totpStep = (now = Date.now()) => Math.floor(now / 30_000)

/**
 * Checks a code against the current step ±1 (clock drift). Returns the matched step so callers can
 * reject replays (a step may only be used once), or null.
 */
export function verifyTotp(secret: string, code: string, opts: { now?: number; lastStep?: number | null } = {}): number | null {
  const c = String(code || '').replace(/\s/g, '')
  if (!/^\d{6}$/.test(c)) return null
  const step = totpStep(opts.now)
  for (const s of [step, step - 1, step + 1]) {
    if (opts.lastStep != null && s <= opts.lastStep) continue
    if (hotp(secret, s) === c) return s
  }
  return null
}

export function otpauthUri(secret: string, account: string, issuer = 'Planora') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
}

/** Ten single-use recovery codes, formatted xxxxx-xxxxx. */
export function newRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const s = base32Encode(randomBytes(7)).toLowerCase().slice(0, 10)
    return `${s.slice(0, 5)}-${s.slice(5)}`
  })
}
