// The sign-in page shows single sign-on failures passed in the address (?sso_error=). Anyone can craft
// such a link, so only fixed messages are ever displayed.

/** Single sign-on failures by code, plus the fixed sentences the sign-in callback sends today. */
const SSO_ERRORS: Record<string, string> = {
  expired: 'Your sign-in expired or was started in another browser. Start again.',
  declined: 'The identity provider declined the sign-in.',
  not_configured: 'Single sign-on is not set up for this organization.',
  domain: 'Your email domain is not allowed for this organization.',
  unverified_email: 'Your email address is not verified with the identity provider.',
  other_org: 'This email already belongs to another RunF9 organization.',
  removed: 'Your access to this organization was removed. Ask an admin.',
  beta: 'RunF9 is in private beta. You need an invitation to sign in — ask your organization admin or request access.',
}
const SSO_ERROR_FALLBACK = 'Single sign-on failed. Try again or contact your admin.'
const SSO_ERROR_SENTENCES = new Set([...Object.values(SSO_ERRORS), SSO_ERROR_FALLBACK, 'Sign-in state mismatch. Start again.', 'The identity provider did not return an email address.', 'The identity provider did not send an email address.', 'SAML single sign-on is not set up for this organization.'])
/** The message to show for ?sso_error=<value>: always one of our own fixed sentences, never the value itself. */
export const ssoErrorMessage = (v: string): string => Object.prototype.hasOwnProperty.call(SSO_ERRORS, v) ? SSO_ERRORS[v]
  : (SSO_ERROR_SENTENCES.has(v) ? v
    : /^[a-z0-9.-]{1,253} is not an allowed domain for this organization\.$/.test(v) ? SSO_ERRORS.domain
    : v.startsWith('The identity provider declined the sign-in') ? SSO_ERRORS.declined
    : SSO_ERROR_FALLBACK)
