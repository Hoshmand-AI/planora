import { describe, expect, it } from 'vitest'
import { selfSignupAllowed, signupMode } from './signup-policy'

describe('self sign-up policy (PLANORA_SIGNUP)', () => {
  it('is open unless the instance is invitation-only', () => {
    expect(signupMode({})).toBe('open')
    expect(signupMode({ PLANORA_SIGNUP: 'open' })).toBe('open')
    for (const v of ['invite_only', 'invite-only', 'INVITE_ONLY', ' inviteonly ']) expect(signupMode({ PLANORA_SIGNUP: v })).toBe('invite_only')
  })
  it('the hosted service on Vercel defaults to invitation-only; PLANORA_SIGNUP=open reopens it', () => {
    expect(signupMode({ VERCEL: '1' })).toBe('invite_only')
    expect(signupMode({ VERCEL: '1', PLANORA_SIGNUP: 'open' })).toBe('open')
    expect(signupMode({ VERCEL: '1', PLANORA_SIGNUP: 'invite_only' })).toBe('invite_only')
  })
  it('invitation-only instances accept only the first, bootstrapping account without an invitation', () => {
    expect(selfSignupAllowed('open', 5)).toBe(true)
    expect(selfSignupAllowed('invite_only', 0)).toBe(true)
    expect(selfSignupAllowed('invite_only', 1)).toBe(false)
  })
})
