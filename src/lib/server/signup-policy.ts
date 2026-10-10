// Sign-up and sign-in policy (private beta).
//
// PLANORA_SIGNUP selects the mode:
//   • invite_only (the DEFAULT, also any value other than "open"): new accounts come only from an
//     organization invitation, a beta invitation for a new firm (created by a platform operator),
//     single sign-on / SCIM provisioning that an organization admin configured, a platform operator's
//     own email, or the very first account on an empty instance (it becomes the first owner).
//     Signing in also requires beta access (users.beta_access_at set and not revoked); platform
//     operators always pass.
//   • open: anyone may create an organization, and the beta sign-in gate is off.
//
// PLANORA_PLATFORM_ADMINS lists the platform operators' emails (comma-separated, case-insensitive).
// PLANORA_ACCESS_REQUEST_EMAIL is where "Request access" links point (hidden when unset).
//
// Pure functions only (no database), so the policy is unit-tested in signup-policy.test.ts.

type Env = Record<string, string | undefined>

export type SignupMode = 'open' | 'invite_only'

/** Invite-only unless PLANORA_SIGNUP is exactly "open" (fails closed on typos). */
export function signupMode(env: Env = process.env): SignupMode {
  return /^open$/i.test((env.PLANORA_SIGNUP || '').trim()) ? 'open' : 'invite_only'
}

/** Whether a sign-up WITHOUT an invitation may create a new organization. */
export function selfSignupAllowed(mode: SignupMode, existingOrganizations: number): boolean {
  return mode === 'open' || existingOrganizations === 0
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** Platform operators (PLANORA_PLATFORM_ADMINS): lower-cased, de-duplicated, malformed entries dropped. */
export function platformAdmins(env: Env = process.env): Set<string> {
  return new Set((env.PLANORA_PLATFORM_ADMINS || '').split(/[,;\s]+/).map(e => e.trim().toLowerCase()).filter(e => EMAIL_RE.test(e)))
}

export function isPlatformAdmin(email: string | null | undefined, env: Env = process.env): boolean {
  return !!email && platformAdmins(env).has(email.trim().toLowerCase())
}

/** Address for "Request access" (PLANORA_ACCESS_REQUEST_EMAIL), or null when unset or malformed. */
export function accessRequestEmail(env: Env = process.env): string | null {
  const v = (env.PLANORA_ACCESS_REQUEST_EMAIL || '').trim()
  return EMAIL_RE.test(v) ? v : null
}

/** How an account obtained beta access (stored in users.beta_access_via). */
export type BetaAccessVia =
  | 'grandfathered' | 'bootstrap' | 'org_invite' | 'beta_invite' | 'platform_admin'
  | 'sso' | 'saml' | 'scim' | 'open_signup' | 'restored'

export interface BetaState { email: string; betaAccessAt: string | null; betaRevokedAt: string | null }

export const hasBetaAccess = (u: Pick<BetaState, 'betaAccessAt' | 'betaRevokedAt'>) => !!u.betaAccessAt && !u.betaRevokedAt

/** The sign-in gate: open mode lets everyone in; invite-only needs beta access (platform operators always pass). */
export function mayUsePlanora(u: BetaState, env: Env = process.env): boolean {
  return signupMode(env) === 'open' || isPlatformAdmin(u.email, env) || hasBetaAccess(u)
}

export interface SignupRequest {
  mode: SignupMode
  /** A valid organization invitation for this email */
  orgInvite: boolean
  /** A valid beta invitation (new firm) for this email */
  betaInvite: boolean
  /** The email is a platform operator's */
  platformAdmin: boolean
  /** Organizations already on this instance (0 = bootstrapping) */
  existingOrganizations: number
}

/** Whether a password sign-up may proceed, and how the new account gets beta access. null = refused. */
export function signupAccess(r: SignupRequest): BetaAccessVia | null {
  if (r.orgInvite) return 'org_invite'
  if (r.betaInvite) return 'beta_invite'
  if (r.mode === 'open') return 'open_signup'
  if (r.platformAdmin) return 'platform_admin'
  if (selfSignupAllowed(r.mode, r.existingOrganizations)) return 'bootstrap'
  return null
}

export const INVITE_ONLY_MESSAGE = 'Planora is in private beta. Sign up with your invitation link — ask your organization admin or request access.'
export const BETA_SIGNIN_MESSAGE = 'Planora is in private beta. You need an invitation to sign in — ask your organization admin or request access.'
