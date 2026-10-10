import { describe, expect, it } from 'vitest'
import {
  accessRequestEmail, hasBetaAccess, isPlatformAdmin, mayUsePlanora, platformAdmins, selfSignupAllowed, signupAccess, signupMode,
  type SignupRequest,
} from './signup-policy'

describe('sign-up mode (PLANORA_SIGNUP)', () => {
  it('is invite-only (private beta) by default', () => {
    expect(signupMode({})).toBe('invite_only')
    expect(signupMode({ PLANORA_SIGNUP: '' })).toBe('invite_only')
    for (const v of ['invite_only', 'invite-only', 'INVITE_ONLY', ' inviteonly ']) expect(signupMode({ PLANORA_SIGNUP: v })).toBe('invite_only')
  })
  it('the hosted service on Vercel defaults to invitation-only; PLANORA_SIGNUP=open reopens it', () => {
    expect(signupMode({ VERCEL: '1' })).toBe('invite_only')
    expect(signupMode({ VERCEL: '1', PLANORA_SIGNUP: 'open' })).toBe('open')
    expect(signupMode({ VERCEL: '1', PLANORA_SIGNUP: 'invite_only' })).toBe('invite_only')
  })
  it('PLANORA_SIGNUP=open re-opens self sign-up', () => {
    expect(signupMode({ PLANORA_SIGNUP: 'open' })).toBe('open')
    expect(signupMode({ PLANORA_SIGNUP: ' OPEN ' })).toBe('open')
  })
  it('fails closed on anything that is not exactly "open"', () => {
    for (const v of ['opne', 'yes', 'true', 'open-ish', '1']) expect(signupMode({ PLANORA_SIGNUP: v })).toBe('invite_only')
  })
  it('invitation-only instances accept only the first, bootstrapping account without an invitation', () => {
    expect(selfSignupAllowed('open', 5)).toBe(true)
    expect(selfSignupAllowed('invite_only', 0)).toBe(true)
    expect(selfSignupAllowed('invite_only', 1)).toBe(false)
  })
})

describe('platform operators (PLANORA_PLATFORM_ADMINS)', () => {
  it('parses a comma-separated, case-insensitive list and drops malformed entries', () => {
    const env = { PLANORA_PLATFORM_ADMINS: ' Ops@Example.com, second@example.org ,, not-an-email ; third@example.net' }
    expect([...platformAdmins(env)].sort()).toEqual(['ops@example.com', 'second@example.org', 'third@example.net'])
    expect(isPlatformAdmin('OPS@example.COM', env)).toBe(true)
    expect(isPlatformAdmin(' second@example.org ', env)).toBe(true)
    expect(isPlatformAdmin('someone@example.com', env)).toBe(false)
    expect(isPlatformAdmin('not-an-email', env)).toBe(false)
  })
  it('nobody is a platform operator when unset', () => {
    expect(platformAdmins({}).size).toBe(0)
    expect(isPlatformAdmin('ops@example.com', {})).toBe(false)
    expect(isPlatformAdmin('', { PLANORA_PLATFORM_ADMINS: 'ops@example.com' })).toBe(false)
  })
  it('the access-request address is shown only when valid', () => {
    expect(accessRequestEmail({})).toBeNull()
    expect(accessRequestEmail({ PLANORA_ACCESS_REQUEST_EMAIL: 'nope' })).toBeNull()
    expect(accessRequestEmail({ PLANORA_ACCESS_REQUEST_EMAIL: ' beta@example.com ' })).toBe('beta@example.com')
  })
})

describe('sign-in gate', () => {
  const env = { PLANORA_PLATFORM_ADMINS: 'ops@example.com' }
  const user = (betaAccessAt: string | null, betaRevokedAt: string | null = null, email = 'a@firm.com') => ({ email, betaAccessAt, betaRevokedAt })
  it('needs beta access that was not revoked', () => {
    expect(hasBetaAccess(user('2026-10-01T00:00:00Z'))).toBe(true)
    expect(hasBetaAccess(user(null))).toBe(false)
    expect(hasBetaAccess(user('2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z'))).toBe(false)
    expect(mayUsePlanora(user('2026-10-01T00:00:00Z'), env)).toBe(true)
    expect(mayUsePlanora(user(null), env)).toBe(false)
    expect(mayUsePlanora(user('2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z'), env)).toBe(false)
  })
  it('platform operators always pass', () => {
    expect(mayUsePlanora(user(null, null, 'OPS@example.com'), env)).toBe(true)
    expect(mayUsePlanora(user('2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z', 'ops@example.com'), env)).toBe(true)
  })
  it('is off when sign-up is open', () => {
    expect(mayUsePlanora(user(null), { PLANORA_SIGNUP: 'open' })).toBe(true)
  })
})

describe('password sign-up decision', () => {
  const base: SignupRequest = { mode: 'invite_only', orgInvite: false, betaInvite: false, platformAdmin: false, existingOrganizations: 3 }
  it('refuses a sign-up without an invitation', () => {
    expect(signupAccess(base)).toBeNull()
  })
  it('accepts organization and beta invitations', () => {
    expect(signupAccess({ ...base, orgInvite: true })).toBe('org_invite')
    expect(signupAccess({ ...base, betaInvite: true })).toBe('beta_invite')
  })
  it('accepts the bootstrapping first account and platform operators', () => {
    expect(signupAccess({ ...base, existingOrganizations: 0 })).toBe('bootstrap')
    expect(signupAccess({ ...base, platformAdmin: true })).toBe('platform_admin')
  })
  it('accepts everyone when open', () => {
    expect(signupAccess({ ...base, mode: 'open' })).toBe('open_signup')
  })
})
