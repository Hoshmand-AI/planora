import { api, json, body, ApiError } from '@/lib/server/api'
import { getUserById, query, getChatMessagesForUser, deleteAccountData } from '@/lib/db'
import { hashPassword, verifyPassword, listSessions, revokeSession, revokeAllSessions, clearSessionCookie } from '@/lib/auth'
import { passwordProblem } from '@/lib/server/password'
import { audit, listAudit } from '@/lib/server/audit'
import { beginEnrollment, confirmEnrollment, consumeSecondFactor, disableMfa, regenerateRecoveryCodes } from '@/lib/server/mfa'
import { hit, LIMITS } from '@/lib/server/rate-limit'

/** Your account: profile, active sessions and two-step verification status. */
export const GET = api({ permission: 'read', allowMfaSetup: true }, async (_req, { auth }) => {
  const user = await getUserById(auth.userId)
  if (!user) throw new ApiError(404, 'Account not found')
  return json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt },
    org: { id: auth.orgId, name: auth.orgName },
    mfa: { enabled: !!user.mfaEnabledAt, enabledAt: user.mfaEnabledAt, recoveryCodesLeft: user.mfaRecovery.length, required: auth.settings.requireMfa },
    sessions: (await listSessions(user.id)).map(s => ({ ...s, current: s.id === auth.sessionId })),
    sessionIdleHours: auth.settings.sessionIdleHours,
  })
})

type Body = { action?: string; currentPassword?: string; newPassword?: string; code?: string; sessionId?: string; confirm?: string; name?: string }

export const POST = api({ permission: 'read', allowMfaSetup: true }, async (req, { auth }) => {
  const b = await body<Body>(req)
  const user = await getUserById(auth.userId)
  if (!user) throw new ApiError(404, 'Account not found')

  // Sensitive actions re-check the password (and a second factor when enrolled).
  const reauth = async (needCode = !!user.mfaEnabledAt) => {
    const rl = await hit(`reauth:user:${user.id}`, LIMITS.mfaPerUser.limit, LIMITS.mfaPerUser.windowSec)
    if (!rl.ok) throw new ApiError(429, 'Too many attempts. Wait a few minutes.', 'rate_limited', { retryAfterSec: rl.retryAfterSec })
    if (!b.currentPassword || !(await verifyPassword(b.currentPassword, user.passwordHash))) throw new ApiError(401, 'Your current password is incorrect.', 'bad_password')
    if (needCode && !(await consumeSecondFactor(user, String(b.code || '')))) throw new ApiError(401, 'Enter a current code from your authenticator app (or a recovery code).', 'mfa_invalid')
  }

  switch (b.action) {
    case 'update_profile': {
      const name = typeof b.name === 'string' ? b.name.trim().slice(0, 120) : ''
      if (!name) throw new ApiError(400, 'Name required.')
      await query('UPDATE users SET name=$2 WHERE id=$1', [user.id, name])
      await audit({ action: 'account.profile_updated', targetType: 'user', targetId: user.id, detail: { before: { name: user.name }, after: { name } } })
      return json({ success: true })
    }
    case 'change_password': {
      await reauth()
      const problem = passwordProblem(b.newPassword, { email: user.email, name: user.name })
      if (problem) throw new ApiError(400, problem, 'weak_password')
      await query('UPDATE users SET password_hash=$2, password_changed_at=NOW() WHERE id=$1', [user.id, await hashPassword(String(b.newPassword))])
      const signedOut = await revokeAllSessions(user.id, auth.sessionId)
      await audit({ action: 'account.password_changed', targetType: 'user', targetId: user.id, detail: { otherSessionsSignedOut: signedOut } })
      return json({ success: true, otherSessionsSignedOut: signedOut })
    }
    case 'revoke_session': {
      if (!b.sessionId) throw new ApiError(400, 'sessionId required')
      await revokeSession(String(b.sessionId), user.id)
      await audit({ action: 'account.session_revoked', targetType: 'user', targetId: user.id, detail: { sessionId: b.sessionId } })
      return json({ success: true })
    }
    case 'revoke_other_sessions': {
      const n = await revokeAllSessions(user.id, auth.sessionId)
      await audit({ action: 'account.sessions_revoked', targetType: 'user', targetId: user.id, detail: { count: n } })
      return json({ success: true, count: n })
    }
    case 'mfa_begin': {
      if (user.mfaEnabledAt) throw new ApiError(400, 'Two-step verification is already on.')
      return json(await beginEnrollment(user))
    }
    case 'mfa_confirm': {
      const fresh = await getUserById(user.id)
      const codes = fresh ? await confirmEnrollment(fresh, String(b.code || '')) : null
      if (!codes) throw new ApiError(400, "That code didn't match. Make sure your phone's time is set automatically, then try the newest code.", 'mfa_invalid')
      const signedOut = await revokeAllSessions(user.id, auth.sessionId)
      await audit({ action: 'account.mfa_enabled', targetType: 'user', targetId: user.id, detail: { otherSessionsSignedOut: signedOut } })
      return json({ success: true, recoveryCodes: codes })
    }
    case 'mfa_recovery_codes': {
      await reauth(true)
      const codes = await regenerateRecoveryCodes(user)
      await audit({ action: 'account.mfa_recovery_regenerated', targetType: 'user', targetId: user.id })
      return json({ success: true, recoveryCodes: codes })
    }
    case 'mfa_disable': {
      if (auth.settings.requireMfa) throw new ApiError(400, 'Your organization requires two-step verification, so it can’t be turned off.')
      await reauth(true)
      await disableMfa(user.id)
      await audit({ action: 'account.mfa_disabled', targetType: 'user', targetId: user.id })
      return json({ success: true })
    }
    case 'export_my_data': {
      // Data subject access: everything Planora holds about this person as an individual.
      const [sessions, events, chats] = await Promise.all([listSessions(user.id), listAudit(auth.orgId, { actorId: user.id, limit: 5000 }), getChatMessagesForUser(user.id)])
      await audit({ action: 'privacy.personal_data_exported', targetType: 'user', targetId: user.id })
      return json({
        exportedAt: new Date().toISOString(),
        account: { id: user.id, email: user.email, name: user.name, role: user.role, organization: auth.orgName, createdAt: user.createdAt, twoStepVerification: !!user.mfaEnabledAt },
        sessions, askAiMessages: chats,
        activity: events.map(e => ({ at: e.at, action: e.action, targetType: e.targetType, targetId: e.targetId, ip: e.ip, userAgent: e.userAgent })),
        note: 'Project data (plans, schedules) belongs to your organization; an admin can export it under Organization → Data.',
      })
    }
    case 'delete_account': {
      await reauth()
      if (b.confirm !== user.email) throw new ApiError(400, 'Type your email address to confirm.')
      const result = await deleteAccountData(user.id, auth.orgId)
      if (result.orgDeleted) {
        const res = json({ success: true, orgDeleted: true })
        clearSessionCookie(res)
        return res
      }
      await audit({ action: 'privacy.account_deleted', targetType: 'user', targetId: user.id, detail: { projectsReassignedTo: result.reassignedTo } })
      const res = json({ success: true })
      clearSessionCookie(res)
      return res
    }
    default:
      throw new ApiError(400, 'Unknown action')
  }
})
