// Field-level encryption (AES-256-GCM) for secrets stored in the database, e.g. MFA seeds.
// Key: PLANORA_ENCRYPTION_KEY if set (recommended; 32+ random characters), else derived from JWT_SECRET.

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'crypto'

function key(): Buffer {
  const material = process.env.PLANORA_ENCRYPTION_KEY || process.env.JWT_SECRET
  if (!material) {
    if (process.env.NODE_ENV === 'production') throw new Error('PLANORA_ENCRYPTION_KEY or JWT_SECRET must be set in production')
    return createHash('sha256').update('planora-dev-encryption-key').digest()
  }
  return createHash('sha256').update(`planora-field-encryption:${material}`).digest()
}

const TAG_BYTES = 16

export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(), iv, { authTagLength: TAG_BYTES })
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.')
}

export function decrypt(sealed: string): string {
  const [v, iv, tag, data] = sealed.split('.')
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Unsupported ciphertext')
  const authTag = Buffer.from(tag, 'base64url')
  // A shortened tag would weaken GCM's integrity check, so only full 16-byte tags are accepted.
  if (authTag.length !== TAG_BYTES) throw new Error('Invalid authentication tag')
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'), { authTagLength: TAG_BYTES })
  d.setAuthTag(authTag)
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8')
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
