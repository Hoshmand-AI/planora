import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { publicApi, ApiError } from '@/lib/server/api'
import { finishSso } from '@/lib/server/sso'
import { createSession, setSessionCookie, hashPassword } from '@/lib/auth'
import { createUser, getUserByEmail } from '@/lib/db'
import { markEmailVerified } from '@/lib/server/email-verification'
import { audit, auditQuietly } from '@/lib/server/audit'
import { currentRequest } from '@/lib/server/context'
import { randomToken } from '@/lib/server/crypto'
import { log } from '@/lib/server/log'
import { assertBetaAccess } from '@/lib/server/beta'

const SSO_COOKIE = 'planora-sso'

/** The identity provider redirects here with ?code&state. Signs the member in (creating them on first sign-in). */
export const GET = publicApi(async req => {
  const url = new URL(req.url)
  const fail = (message: string) => {
    const res = NextResponse.redirect(new URL(`/auth?sso_error=${encodeURIComponent(message)}`, url.origin), 303)
    res.cookies.set(SSO_COOKIE, '', { path: '/api/auth/sso', maxAge: 0 })
    return res
  }
  try {
    const id = await finishSso(url.searchParams, req.cookies.get(SSO_COOKIE)?.value)
    let user = await getUserByEmail(id.email)
    if (user && user.orgId !== id.orgId) throw new ApiError(403, 'This email already belongs to another Planora organization.')
    if (user?.disabledAt) throw new ApiError(403, 'Your access to this organization was removed. Ask an admin.')
    const r = currentRequest()
    if (!user) {
      // Just-in-time provisioning with the organization's default role. The password is random and
      // unusable: these members sign in through the identity provider.
      user = await createUser({ id: randomUUID(), email: id.email, name: id.name, passwordHash: await hashPassword(randomToken(32)), plan: 'free', createdAt: new Date().toISOString(), betaAccess: 'sso', orgId: id.orgId, role: id.config.defaultRole })
      await markEmailVerified(user.id)
      if (r) Object.assign(r, { userId: user.id, email: user.email, orgId: user.orgId })
      await audit({ orgId: id.orgId, action: 'member.joined', targetType: 'user', targetId: user.id, detail: { via: 'sso', role: user.role, issuer: id.config.issuer } })
    }
    if (r) Object.assign(r, { userId: user.id, email: user.email, orgId: user.orgId })
    // Private beta: members provisioned through the organization's identity provider count as
    // invited (their admin configured it); an existing account still needs beta access.
    await assertBetaAccess(user, 'sso')
    const { token, expiresAt, sessionId } = await createSession(user.id, 'sso')
    await audit({ orgId: id.orgId, action: 'auth.signin', targetType: 'user', targetId: user.id, detail: { method: 'sso', issuer: id.config.issuer, subject: id.subject, sessionId } })
    const res = NextResponse.redirect(new URL('/dashboard', url.origin), 303)
    setSessionCookie(res, token, expiresAt)
    res.cookies.set(SSO_COOKIE, '', { path: '/api/auth/sso', maxAge: 0 })
    return res
  } catch (err) {
    const message = err instanceof ApiError ? err.message : 'Single sign-on failed. Try again or contact your admin.'
    if (!(err instanceof ApiError)) log('error', 'sso callback failed', { error: (err as Error).message })
    await auditQuietly({ action: 'auth.sso_failed', detail: { reason: message } })
    return fail(message)
  }
}, { optionalAuth: false })
