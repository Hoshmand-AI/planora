import { NextResponse, type NextRequest } from 'next/server'
import { randomUUID } from 'crypto'
import { publicApi, ApiError } from '@/lib/server/api'
import {
  dbSamlStore, readSamlState, samlByConnection, samlTestResultPath, spUrls, validateSamlResponse, SAML_COOKIE, SAML_COOKIE_PATH,
} from '@/lib/server/saml'
import { createSession, setSessionCookie, hashPassword } from '@/lib/auth'
import { createUser, getUserByEmail } from '@/lib/db'
import { markEmailVerified } from '@/lib/server/email-verification'
import { changeRole } from '@/lib/server/org'
import { entitlementsFor } from '@/lib/server/entitlements'
import { audit, auditQuietly } from '@/lib/server/audit'
import { currentRequest } from '@/lib/server/context'
import { randomToken } from '@/lib/server/crypto'
import { appOrigin } from '@/lib/server/email'
import { log } from '@/lib/server/log'
import { assertBetaAccess } from '@/lib/server/beta'

const MAX_FORM_BYTES = 768 * 1024

async function readForm(req: NextRequest): Promise<{ SAMLResponse: string; RelayState: string }> {
  const len = Number(req.headers.get('content-length') || 0)
  if (len > MAX_FORM_BYTES) throw new ApiError(413, 'The SAML response is too large.')
  try {
    const f = await req.formData()
    return { SAMLResponse: String(f.get('SAMLResponse') || ''), RelayState: String(f.get('RelayState') || '') }
  } catch {
    throw new ApiError(400, 'Expected an HTTP-POST SAML response.')
  }
}

/**
 * Assertion consumer service (HTTP-POST binding). The identity provider's page posts the SAML
 * Response here from its own origin, so the cross-site write check is off for this route only;
 * the request is instead bound to the browser by the signed state cookie and RelayState, and
 * the response must answer the one-time AuthnRequest issued for that browser.
 */
export const POST = publicApi<{ connection: string }>(async (req, { params }) => {
  const origin = appOrigin(req)
  const clearState = (res: NextResponse) => { res.cookies.set(SAML_COOKIE, '', { path: SAML_COOKIE_PATH, maxAge: 0 }); return res }
  let test = false
  let orgId: string | undefined
  try {
    const st = readSamlState(req.cookies.get(SAML_COOKIE)?.value)
    test = st.test
    const form = await readForm(req)
    if (st.cid !== params.connection) throw new ApiError(401, 'This sign-in was started for a different connection. Start again.')
    if (!form.RelayState || form.RelayState !== st.relay) throw new ApiError(401, 'Sign-in state mismatch. Start again.')
    const found = await samlByConnection(params.connection)
    if (!found || found.orgId !== st.orgId) throw new ApiError(401, 'Unknown SAML connection.')
    orgId = found.orgId
    if (!test && !found.config.enabled) throw new ApiError(403, 'SAML single sign-on is not turned on for this organization.')
    if (!entitlementsFor(found.plan).sso) throw new ApiError(402, "Your organization's plan doesn't include single sign-on.")

    const id = await validateSamlResponse({
      orgId: found.orgId, config: found.config, urls: spUrls(origin, found.config.connectionId),
      samlResponse: form.SAMLResponse, requestId: st.rid, store: dbSamlStore(found.orgId),
    })
    let user = await getUserByEmail(id.email)
    // Never link to (or reveal details of) an account that belongs to another organization.
    if (user && user.orgId !== id.orgId) throw new ApiError(403, 'This email already belongs to another Planora organization.')
    if (user?.disabledAt) throw new ApiError(403, 'Your access to this organization was removed. Ask an admin.')

    if (test) {
      const role = user ? (user.role === 'owner' ? 'owner' : id.groupRole || user.role) : id.groupRole || found.config.defaultRole
      await audit({ orgId: found.orgId, action: 'org.saml_tested', targetType: 'organization', targetId: found.orgId, detail: { ok: true, email: id.email, groups: id.groups.length, role, existingMember: !!user } })
      return clearState(NextResponse.redirect(new URL(samlTestResultPath(true, `Signed by your identity provider and accepted for ${id.email} (${user ? 'existing member' : 'would be added'} as ${role}).`), origin), 303))
    }

    const r = currentRequest()
    if (!user) {
      // Just-in-time provisioning into this organization only, with the mapped or default role. The
      // password is random and unusable: these members sign in through the identity provider.
      const role = id.groupRole || found.config.defaultRole
      user = await createUser({ id: randomUUID(), email: id.email, name: id.name, passwordHash: await hashPassword(randomToken(32)), plan: 'free', createdAt: new Date().toISOString(), betaAccess: 'saml', orgId: id.orgId, role })
      await markEmailVerified(user.id)
      if (r) Object.assign(r, { userId: user.id, email: user.email, orgId: user.orgId })
      await audit({ orgId: id.orgId, action: 'member.joined', targetType: 'user', targetId: user.id, detail: { via: 'saml', role: user.role, idp: found.config.idpEntityId } })
    } else if (id.groupRole && user.role !== 'owner' && user.role !== id.groupRole) {
      // The identity provider's groups are authoritative for roles (owners are managed in Planora).
      if (r) Object.assign(r, { userId: user.id, email: user.email, orgId: user.orgId })
      const change = await changeRole(id.orgId, user.id, id.groupRole)
      await audit({ orgId: id.orgId, action: 'member.role_changed', targetType: 'user', targetId: user.id, detail: { email: user.email, before: change.from, after: change.to, via: 'saml_groups' } })
      user = { ...user, role: change.to }
    }
    if (r) Object.assign(r, { userId: user.id, email: user.email, orgId: user.orgId })
    // Private beta: members provisioned through the organization's identity provider count as
    // invited (their admin configured it); an existing account still needs beta access.
    await assertBetaAccess(user, 'saml')
    const { token, expiresAt, sessionId } = await createSession(user.id, 'saml')
    await audit({ orgId: id.orgId, action: 'auth.signin', targetType: 'user', targetId: user.id, detail: { method: 'saml', idp: found.config.idpEntityId, assertionId: id.assertionId, sessionId } })
    const res = NextResponse.redirect(new URL('/dashboard', origin), 303)
    setSessionCookie(res, token, expiresAt)
    return clearState(res)
  } catch (err) {
    const message = err instanceof ApiError ? err.message : 'Single sign-on failed. Try again or contact your admin.'
    if (!(err instanceof ApiError)) log('error', 'saml acs failed', { error: (err as Error).message })
    await auditQuietly({ ...(orgId ? { orgId } : {}), action: test ? 'org.saml_tested' : 'auth.sso_failed', detail: { method: 'saml', ok: false, reason: message } })
    const target = test ? samlTestResultPath(false, message) : `/auth?sso_error=${encodeURIComponent(message)}`
    return clearState(NextResponse.redirect(new URL(target, origin), 303))
  }
}, { csrf: false, optionalAuth: false })
