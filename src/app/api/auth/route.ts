import { randomUUID as uuid } from 'crypto'
import { getUserByEmail, getUserById, createUser, query } from '@/lib/db'
import {
  hashPassword, verifyPassword, dummyPasswordCheck, createSession, setSessionCookie, clearSessionCookie, revokeSession,
  createMfaChallenge, verifyMfaChallenge, getAuthContext,
} from '@/lib/auth'
import { publicApi, json, body, ApiError } from '@/lib/server/api'
import { hit, reset, LIMITS } from '@/lib/server/rate-limit'
import { passwordProblem } from '@/lib/server/password'
import { audit, auditQuietly } from '@/lib/server/audit'
import { findInvitation, markInvitationAccepted } from '@/lib/server/org'
import { currentRequest } from '@/lib/server/context'
import { permissionsOf, isRole } from '@/lib/server/permissions'
import { consumeSecondFactor } from '@/lib/server/mfa'
import { ssoConfigFor } from '@/lib/server/sso'

const GENERIC_SIGNIN_ERROR = 'Incorrect email or password.'

async function limitOrThrow(key: string, l: { limit: number; windowSec: number }, message: string) {
  const r = await hit(key, l.limit, l.windowSec)
  if (!r.ok) throw new ApiError(429, message, 'rate_limited', { retryAfterSec: r.retryAfterSec })
}

async function startSession(user: { id: string; email: string; name: string; plan: string; role: string; orgId: string }, method: string) {
  const { token, expiresAt, sessionId } = await createSession(user.id, method)
  Object.assign(currentRequest() || {}, { userId: user.id, email: user.email, orgId: user.orgId })
  await audit({ orgId: user.orgId, action: 'auth.signin', targetType: 'user', targetId: user.id, detail: { method, sessionId } })
  const res = json({ success: true, user: { id: user.id, email: user.email, name: user.name, plan: user.plan, role: user.role } })
  setSessionCookie(res, token, expiresAt)
  return res
}

export const POST = publicApi(async req => {
  const b = await body<{ action?: string; email?: string; password?: string; name?: string; company?: string; invite?: string; challenge?: string; code?: string }>(req)
  const ip = currentRequest()?.ip || 'unknown'

  if (b.action === 'signout') {
    const ctx = await getAuthContext()
    if (ctx) {
      await revokeSession(ctx.sessionId)
      await auditQuietly({ orgId: ctx.orgId, action: 'auth.signout', targetType: 'user', targetId: ctx.userId })
    }
    const res = json({ success: true })
    clearSessionCookie(res)
    return res
  }

  if (b.action === 'mfa') {
    const userId = verifyMfaChallenge(String(b.challenge || ''))
    if (!userId) throw new ApiError(401, 'Your sign-in expired. Enter your password again.', 'mfa_expired')
    await limitOrThrow(`mfa:user:${userId}`, LIMITS.mfaPerUser, 'Too many attempts. Wait a few minutes and try again.')
    const user = await getUserById(userId)
    if (!user || user.disabledAt) throw new ApiError(401, GENERIC_SIGNIN_ERROR)
    const used = await consumeSecondFactor(user, String(b.code || ''))
    if (!used) {
      await auditQuietly({ orgId: user.orgId, action: 'auth.mfa_failed', targetType: 'user', targetId: user.id, actor: { id: user.id, email: user.email } })
      throw new ApiError(401, "That code didn't work. Check your authenticator app and try again.", 'mfa_invalid')
    }
    await reset(`mfa:user:${userId}`)
    return startSession(user, used === 'recovery' ? 'password+recovery_code' : 'password+totp')
  }

  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : ''
  const password = typeof b.password === 'string' ? b.password : ''
  if (!email || !password) throw new ApiError(400, 'Email and password required')
  if (email.length > 254) throw new ApiError(400, 'Email is too long.')

  if (b.action === 'signup') {
    await limitOrThrow(`signup:ip:${ip}`, LIMITS.signupPerIp, 'Too many sign-ups from this network. Try again later.')
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError(400, 'Enter a valid email address.')
    const problem = passwordProblem(password, { email, name: b.name })
    if (problem) throw new ApiError(400, problem, 'weak_password')
    const invite = b.invite ? await findInvitation(String(b.invite)) : null
    if (b.invite && !invite) throw new ApiError(400, 'This invitation link is no longer valid. Ask your admin for a new one.', 'invite_invalid')
    if (invite && invite.email !== email) throw new ApiError(400, `This invitation is for ${invite.email}. Sign up with that email address.`, 'invite_email')
    if (await getUserByEmail(email)) throw new ApiError(409, 'An account with this email already exists. Please sign in.')
    const user = await createUser({
      id: uuid(), email, name: (typeof b.name === 'string' && b.name.trim().slice(0, 120)) || email.split('@')[0],
      passwordHash: await hashPassword(password), plan: 'free', createdAt: new Date().toISOString(),
      ...(invite ? { orgId: invite.orgId, role: invite.role } : { orgName: typeof b.company === 'string' && b.company.trim() ? b.company.trim().slice(0, 160) : undefined }),
    })
    if (invite) await markInvitationAccepted(invite.id)
    Object.assign(currentRequest() || {}, { userId: user.id, email: user.email, orgId: user.orgId })
    await audit({ orgId: user.orgId, action: invite ? 'member.joined' : 'org.created', targetType: 'user', targetId: user.id, detail: { role: user.role, ...(invite ? { invitationId: invite.id, invitedBy: invite.invitedBy } : {}) } })
    return startSession(user, 'password')
  }

  if (b.action === 'signin') {
    await limitOrThrow(`signin:ip:${ip}`, LIMITS.signinPerIp, 'Too many sign-in attempts from this network. Wait a few minutes and try again.')
    await limitOrThrow(`signin:email:${email}`, LIMITS.signinPerEmail, 'Too many sign-in attempts for this account. Wait a few minutes and try again.')
    const user = await getUserByEmail(email)
    if (!user || user.disabledAt) {
      await dummyPasswordCheck(password)
      throw new ApiError(401, GENERIC_SIGNIN_ERROR, 'bad_credentials')
    }
    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      throw new ApiError(423, 'This account is temporarily locked after repeated failed sign-ins. Try again in a few minutes.', 'locked')
    }
    if (!(await verifyPassword(password, user.passwordHash))) {
      const res = await query(`UPDATE users SET failed_logins = failed_logins + 1,
          locked_until = CASE WHEN failed_logins + 1 >= $2 THEN NOW() + make_interval(mins => $3) ELSE locked_until END
        WHERE id=$1 RETURNING failed_logins, locked_until`, [user.id, LIMITS.lockoutAfter, LIMITS.lockoutMinutes])
      const locked = Number(res.rows[0]?.failed_logins) >= LIMITS.lockoutAfter
      await auditQuietly({ orgId: user.orgId, action: locked ? 'auth.locked' : 'auth.signin_failed', targetType: 'user', targetId: user.id, actor: { id: null, email } })
      if (locked) await query('UPDATE users SET failed_logins=0 WHERE id=$1', [user.id])
      throw new ApiError(401, GENERIC_SIGNIN_ERROR, 'bad_credentials')
    }
    await query('UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=$1', [user.id])
    if (user.role !== 'owner') {
      // Organizations that enforce single sign-on: members sign in through their identity provider
      // (owners keep password sign-in as a break-glass account).
      const sso = await ssoConfigFor(user.orgId)
      if (sso.enabled && sso.enforce) throw new ApiError(403, 'Your organization requires single sign-on. Use “Sign in with SSO”.', 'sso_required')
    }
    if (user.mfaEnabledAt) return json({ mfaRequired: true, challenge: createMfaChallenge(user.id) })
    return startSession(user, 'password')
  }

  throw new ApiError(400, 'Invalid action')
})

export const GET = publicApi(async req => {
  const ctx = await getAuthContext()
  const invite = new URL(req.url).searchParams.get('invite')
  const invitation = invite ? await findInvitation(invite) : null
  const inviteInfo = invitation ? { email: invitation.email, role: invitation.role, orgName: invitation.orgName } : invite ? { invalid: true } : undefined
  if (!ctx) return json({ user: null, ...(inviteInfo ? { invitation: inviteInfo } : {}) })
  const user = await getUserById(ctx.userId)
  return json({
    user: { id: ctx.userId, email: ctx.email, name: ctx.name, plan: user?.plan ?? 'free', role: ctx.role },
    org: { id: ctx.orgId, name: ctx.orgName },
    permissions: isRole(ctx.role) ? permissionsOf(ctx.role) : [],
    security: { mfaEnabled: ctx.mfaEnabled, mfaSetupRequired: ctx.mfaSetupRequired },
    ...(inviteInfo ? { invitation: inviteInfo } : {}),
  })
})
