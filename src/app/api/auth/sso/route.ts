import { publicApi, json, body, ApiError } from '@/lib/server/api'
import { orgForEmail, startSso } from '@/lib/server/sso'
import { hit } from '@/lib/server/rate-limit'
import { currentRequest } from '@/lib/server/context'
import { getOrganization } from '@/lib/db'
import { entitlementsFor } from '@/lib/server/entitlements'

const SSO_COOKIE = 'planora-sso'

/** Start single sign-on: { email } → { url } to send the browser to the organization's identity provider. */
export const POST = publicApi(async req => {
  const b = await body<{ email?: string }>(req)
  const email = String(b.email || '').trim().toLowerCase()
  const rl = await hit(`sso:ip:${currentRequest()?.ip || 'unknown'}`, 30, 15 * 60)
  if (!rl.ok) throw new ApiError(429, 'Too many attempts. Wait a few minutes.', 'rate_limited', { retryAfterSec: rl.retryAfterSec })
  const found = email ? await orgForEmail(email) : null
  if (!found) throw new ApiError(404, "Single sign-on isn't set up for that email domain. Sign in with your password, or ask your admin.", 'sso_not_configured')
  const org = await getOrganization(found.orgId)
  if (!entitlementsFor(org?.plan).sso) throw new ApiError(402, "Your organization's plan doesn't include single sign-on.", 'plan_limit')
  const callback = `${new URL(req.url).origin}/api/auth/sso/callback`
  const { url, stateCookie } = await startSso(found.orgId, found.config, email, callback)
  const res = json({ url })
  res.cookies.set(SSO_COOKIE, stateCookie, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/auth/sso', maxAge: 600 })
  return res
}, { optionalAuth: false })
