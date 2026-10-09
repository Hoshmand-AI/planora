import { NextResponse } from 'next/server'
import { publicApi, ApiError } from '@/lib/server/api'
import { samlByConnection, startSaml, samlCookieOptions, SAML_COOKIE } from '@/lib/server/saml'
import { entitlementsFor } from '@/lib/server/entitlements'
import { can } from '@/lib/server/permissions'
import { hit } from '@/lib/server/rate-limit'
import { currentRequest } from '@/lib/server/context'
import { appOrigin } from '@/lib/server/email'

/**
 * SP-initiated SAML sign-in: redirects the browser to the identity provider with an AuthnRequest
 * (HTTP-Redirect binding). ?test=1 is the admin's "Test sign-in": it works before SAML is turned on,
 * checks the whole response, and reports the result without signing anyone in.
 */
export const GET = publicApi<{ connection: string }>(async (req, { params, auth }) => {
  const rl = await hit(`sso:ip:${currentRequest()?.ip || 'unknown'}`, 30, 15 * 60)
  if (!rl.ok) throw new ApiError(429, 'Too many attempts. Wait a few minutes.', 'rate_limited', { retryAfterSec: rl.retryAfterSec })
  const found = await samlByConnection(params.connection)
  if (!found) throw new ApiError(404, 'Unknown SAML connection.')
  const test = new URL(req.url).searchParams.get('test') === '1'
  if (test && !(auth && auth.orgId === found.orgId && can(auth.role, 'org.manage'))) throw new ApiError(403, 'Only an admin of this organization can test its SAML connection.')
  if (!test && !found.config.enabled) throw new ApiError(404, 'SAML single sign-on is not turned on for this organization.', 'sso_not_configured')
  if (!entitlementsFor(found.plan).sso) throw new ApiError(402, "Your organization's plan doesn't include single sign-on.", 'plan_limit')
  const origin = appOrigin(req)
  const { url, stateCookie } = await startSaml(found.orgId, found.config, origin, { test })
  const res = NextResponse.redirect(url, 303)
  res.cookies.set(SAML_COOKIE, stateCookie, samlCookieOptions(origin, 600))
  return res
})
