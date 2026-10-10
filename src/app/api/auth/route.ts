import { randomUUID as uuid } from 'crypto'
import { getUserByEmail, getUserById, getOrganization, createUser, query } from '@/lib/db'
import {
  hashPassword, verifyPassword, dummyPasswordCheck, createSession, setSessionCookie, clearSessionCookie, revokeSession,
  createMfaChallenge, verifyMfaChallenge, getAuthContext,
} from '@/lib/auth'
import { publicApi, json, body, ApiError } from '@/lib/server/api'
import { hit, peek, reset, LIMITS } from '@/lib/server/rate-limit'
import { passwordProblem } from '@/lib/server/password'
import { appendAudit, audit, auditQuietly, SYSTEM_ORG } from '@/lib/server/audit'
import { applyNewOrganizationDefaults, findInvitation, markInvitationAccepted } from '@/lib/server/org'
import { currentRequest } from '@/lib/server/context'
import { permissionsOf, isRole } from '@/lib/server/permissions'
import { consumeSecondFactor } from '@/lib/server/mfa'
import { ssoEnforced } from '@/lib/server/saml'
import { markEmailVerified, sendVerificationEmail } from '@/lib/server/email-verification'
import { emailConfigured, appOrigin } from '@/lib/server/email'
import { CUI_CLOUD_WARNING, deploymentKind } from '@/lib/llm/provider'
import { INVITE_ONLY_MESSAGE, accessRequestEmail, isPlatformAdmin, signupAccess, signupMode } from '@/lib/server/signup-policy'
import { assertBetaAccess, findBetaInvite, markBetaInviteAccepted } from '@/lib/server/beta'

const GENERIC_SIGNIN_ERROR = 'Incorrect email or password.'

async function limitOrThrow(key: string, l: { limit: number; windowSec: number }, message: string) {
  const r = await hit(key, l.limit, l.windowSec)
  if (!r.ok) throw new ApiError(429, message, 'rate_limited', { retryAfterSec: r.retryAfterSec })
}

async function startSession(user: { id: string; email: string; name: string; role: string; orgId: string }, method: string) {
  const { token, expiresAt, sessionId } = await createSession(user.id, method)
  // The subscription belongs to the organization (users.plan is a legacy column that stays 'free').
  const plan = (await getOrganization(user.orgId))?.plan ?? 'free'
  Object.assign(currentRequest() || {}, { userId: user.id, email: user.email, orgId: user.orgId })
  await audit({ orgId: user.orgId, action: 'auth.signin', targetType: 'user', targetId: user.id, detail: { method, sessionId } })
  const res = json({ success: true, user: { id: user.id, email: user.email, name: user.name, plan, role: user.role } })
  setSessionCookie(res, token, expiresAt)
  return res
}

export const POST = publicApi(async req => {
  const b = await body<{ action?: string; email?: string; password?: string; name?: string; company?: string; invite?: string; betaInvite?: string; challenge?: string; code?: string }>(req)
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
    await assertBetaAccess(user, 'password')
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
    // Beta invitation for a new firm (created by a platform operator): single use, for one address.
    const beta = !invite && b.betaInvite ? await findBetaInvite(String(b.betaInvite)) : null
    if (!invite && b.betaInvite && !beta) throw new ApiError(400, 'This beta invitation link is no longer valid. Ask for a new one.', 'beta_invite_invalid')
    if (beta && beta.email !== email) throw new ApiError(400, `This invitation is for ${beta.email}. Sign up with that email address.`, 'invite_email')
    // Private beta (PLANORA_SIGNUP, invite-only by default): without an invitation only a platform
    // operator or the first account on an empty instance (the bootstrapping owner) may sign up.
    // Checked before the "already exists" answer, so refused sign-ups learn nothing about accounts.
    const mode = signupMode()
    const platformAdmin = isPlatformAdmin(email)
    const orgs = !invite && !beta && mode === 'invite_only' && !platformAdmin
      ? Number((await query('SELECT COUNT(*)::int AS n FROM organizations')).rows[0]?.n ?? 0) : 1
    const via = signupAccess({ mode, orgInvite: !!invite, betaInvite: !!beta, platformAdmin, existingOrganizations: orgs })
    if (!via) throw new ApiError(403, INVITE_ONLY_MESSAGE, 'invite_only', { accessRequestEmail: accessRequestEmail() })
    if (await getUserByEmail(email)) throw new ApiError(409, 'An account with this email already exists. Please sign in.')
    // The invitee may correct the firm name the operator typed.
    const company = (typeof b.company === 'string' && b.company.trim() ? b.company.trim().slice(0, 160) : undefined) || beta?.company || undefined
    const user = await createUser({
      id: uuid(), email, name: (typeof b.name === 'string' && b.name.trim().slice(0, 120)) || email.split('@')[0],
      passwordHash: await hashPassword(password), plan: 'free', createdAt: new Date().toISOString(), betaAccess: via,
      ...(invite ? { orgId: invite.orgId, role: invite.role } : { orgName: company }),
    })
    if (invite) {
      await markInvitationAccepted(invite.id)
      // The invitation link was delivered to this address.
      await markEmailVerified(user.id)
    } else {
      // New organization: cloud AI is opt-in (an admin turns it on under Organization → Policies).
      await applyNewOrganizationDefaults(user.orgId)
      if (beta) {
        await markBetaInviteAccepted(beta.id, user.id, user.orgId)
        await markEmailVerified(user.id) // the beta invitation link was delivered to this address
      } else {
        await sendVerificationEmail(user, appOrigin(req))
      }
    }
    Object.assign(currentRequest() || {}, { userId: user.id, email: user.email, orgId: user.orgId })
    await audit({ orgId: user.orgId, action: invite ? 'member.joined' : 'org.created', targetType: 'user', targetId: user.id, detail: { role: user.role, betaAccess: via, ...(invite ? { invitationId: invite.id, invitedBy: invite.invitedBy } : {}) } })
    if (beta) {
      // In the new firm's log and the operators' (system) log; never the token.
      await appendAudit([
        { orgId: user.orgId, action: 'beta.invite_accepted', targetType: 'beta_invite', targetId: beta.id, detail: { email, company: company ?? null, invitedBy: beta.createdByEmail } },
        { orgId: SYSTEM_ORG, action: 'beta.invite_accepted', targetType: 'beta_invite', targetId: beta.id, detail: { email, orgId: user.orgId, company: company ?? null } },
      ])
    }
    return startSession(user, 'password')
  }

  if (b.action === 'signin') {
    // Per network: only failed attempts count, so a busy office behind one IP isn't locked out by
    // its own successful sign-ins. Per account: every attempt counts, plus lockout after repeated failures.
    const ipKey = `signin:fail:ip:${ip}`
    if (await peek(ipKey, LIMITS.signinFailuresPerIp.windowSec) >= LIMITS.signinFailuresPerIp.limit) {
      throw new ApiError(429, 'Too many failed sign-in attempts from this network. Wait a few minutes and try again.', 'rate_limited', { retryAfterSec: LIMITS.signinFailuresPerIp.windowSec })
    }
    await limitOrThrow(`signin:email:${email}`, LIMITS.signinPerEmail, 'Too many sign-in attempts for this account. Wait a few minutes and try again.')
    const failed = () => hit(ipKey, LIMITS.signinFailuresPerIp.limit, LIMITS.signinFailuresPerIp.windowSec)
    const user = await getUserByEmail(email)
    if (!user || user.disabledAt) {
      await dummyPasswordCheck(password)
      await failed()
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
      await failed()
      throw new ApiError(401, GENERIC_SIGNIN_ERROR, 'bad_credentials')
    }
    await query('UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=$1', [user.id])
    if (user.role !== 'owner') {
      // Organizations that enforce single sign-on: members sign in through their identity provider
      // (owners keep password sign-in as a break-glass account).
      if (await ssoEnforced(user.orgId)) throw new ApiError(403, 'Your organization requires single sign-on. Use “Sign in with SSO”.', 'sso_required')
    }
    // Private beta: only after the password checked out, so the refusal reveals nothing to a guesser.
    await assertBetaAccess(user, 'password')
    if (user.mfaEnabledAt) return json({ mfaRequired: true, challenge: createMfaChallenge(user.id) })
    return startSession(user, 'password')
  }

  throw new ApiError(400, 'Invalid action')
})

export const GET = publicApi(async req => {
  const ctx = await getAuthContext()
  const params = new URL(req.url).searchParams
  const invite = params.get('invite')
  const invitation = invite ? await findInvitation(invite) : null
  const inviteInfo = invitation ? { email: invitation.email, role: invitation.role, orgName: invitation.orgName } : invite ? { invalid: true } : undefined
  const betaToken = params.get('beta')
  const betaInvite = betaToken ? await findBetaInvite(betaToken) : null
  const betaInfo = betaInvite ? { email: betaInvite.email, company: betaInvite.company } : betaToken ? { invalid: true } : undefined
  // Where this instance runs, so sign-up can warn that CUI doesn't belong on the commercial cloud.
  const deployment = deploymentKind()
  const service = { deployment, signup: signupMode(), ...(deployment === 'commercial_cloud' ? { cuiWarning: CUI_CLOUD_WARNING } : {}) }
  const signup = { mode: signupMode(), accessRequestEmail: accessRequestEmail() }
  const links = { ...(inviteInfo ? { invitation: inviteInfo } : {}), ...(betaInfo ? { betaInvitation: betaInfo } : {}) }
  if (!ctx) return json({ user: null, service, signup, ...links })
  return json({
    // Organization's subscription plan (from the session's organization row), not the legacy users.plan.
    user: { id: ctx.userId, email: ctx.email, name: ctx.name, plan: ctx.plan, role: ctx.role },
    org: { id: ctx.orgId, name: ctx.orgName },
    permissions: isRole(ctx.role) ? permissionsOf(ctx.role) : [],
    security: { mfaEnabled: ctx.mfaEnabled, mfaSetupRequired: ctx.mfaSetupRequired, emailVerified: !!ctx.emailVerified, emailDelivery: emailConfigured() },
    service,
    signup,
    platformAdmin: isPlatformAdmin(ctx.email),
    ...links,
  })
})
