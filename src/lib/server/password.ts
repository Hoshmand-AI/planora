// Password policy (NIST SP 800-63B style): length over composition rules, block common and
// context-specific passwords, no forced periodic rotation.

const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', 'password1234', '123456789012', '1234567890ab', 'qwertyuiop12',
  'qwertyuiopas', 'iloveyou1234', 'letmein12345', 'welcome12345', 'admin1234567', 'changeme1234', 'passw0rd1234',
  'construction', 'construction1', 'scheduling12', 'primavera123', 'planora12345', 'p@ssw0rd1234', 'abc123456789',
  '111111111111', '000000000000', 'aaaaaaaaaaaa', 'qwerty123456', '1q2w3e4r5t6y', 'zaq12wsxcde3', 'trustno1trust',
])

export const PASSWORD_MIN = 12
export const PASSWORD_MAX = 128

export function passwordProblem(password: unknown, context: { email?: string; name?: string } = {}): string | null {
  if (typeof password !== 'string') return 'Password required.'
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters. A short phrase of a few words works well.`
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`
  const lower = password.toLowerCase()
  if (COMMON.has(lower) || /^(.)\1+$/.test(password)) return 'That password is too common. Choose something less predictable.'
  if (/^(0123456789|1234567890|abcdefghij|qwertyuiop)/.test(lower) && new Set(lower).size < 8) return 'That password is too predictable.'
  const local = context.email?.split('@')[0]?.toLowerCase()
  if (local && local.length >= 4 && lower.includes(local)) return "Don't include your email address in your password."
  if (lower.includes('planora') && password.length < 16) return "Don't base your password on the product name."
  return null
}
