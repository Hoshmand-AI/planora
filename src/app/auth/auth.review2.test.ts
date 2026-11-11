import { describe, expect, it } from 'vitest'
import { ssoErrorMessage } from './sso-error'

const FALLBACK = 'Single sign-on failed. Try again or contact your admin.'

describe('ssoErrorMessage (review M9)', () => {
  it('never shows free text from the address', () => {
    expect(ssoErrorMessage('Your account is locked, call 555-0100')).toBe(FALLBACK)
    expect(ssoErrorMessage('<b>hi</b>')).toBe(FALLBACK)
    expect(ssoErrorMessage('')).toBe(FALLBACK)
  })
  it('maps known codes to fixed messages', () => {
    expect(ssoErrorMessage('expired')).toBe('Your sign-in expired or was started in another browser. Start again.')
    expect(ssoErrorMessage('removed')).toBe('Your access to this organization was removed. Ask an admin.')
  })
  it('does not treat object property names as codes', () => {
    expect(ssoErrorMessage('constructor')).toBe(FALLBACK)
    expect(ssoErrorMessage('toString')).toBe(FALLBACK)
    expect(ssoErrorMessage('__proto__')).toBe(FALLBACK)
  })
  it('keeps the fixed sentences the sign-in callbacks send today', () => {
    const sent = 'Your sign-in expired or was started in another browser. Start again.'
    expect(ssoErrorMessage(sent)).toBe(sent)
    expect(ssoErrorMessage('This email already belongs to another RunF9 organization.')).toBe('This email already belongs to another RunF9 organization.')
  })
  it('replaces messages that carry variable text with a fixed one', () => {
    expect(ssoErrorMessage('acme.com is not an allowed domain for this organization.')).toBe('Your email domain is not allowed for this organization.')
    expect(ssoErrorMessage('Call 555-0100 now is not an allowed domain for this organization.')).toBe(FALLBACK)
    expect(ssoErrorMessage('The identity provider declined the sign-in (access_denied).')).toBe('The identity provider declined the sign-in.')
    expect(ssoErrorMessage('The SAML response was rejected (signature).')).toBe(FALLBACK)
  })
})
