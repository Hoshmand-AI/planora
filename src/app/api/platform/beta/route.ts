// Private beta administration for platform operators (RUNF9_PLATFORM_ADMINS): invite a new firm,
// list and revoke beta invitations, revoke or restore a person's beta access, and set an
// organization's plan. Everyone else gets
// 404. Invitation tokens are returned once, to the operator, and are never logged or audited.

import { api, json, body, ApiError } from '@/lib/server/api'
import { appendAudit, SYSTEM_ORG } from '@/lib/server/audit'
import { appOrigin, emailConfigured, sendEmail } from '@/lib/server/email'
import { betaInviteEmail } from '@/lib/server/emails'
import {
  BETA_INVITE_DAYS, createBetaInvite, listBetaInvites, listBetaUsers, requirePlatformAdmin, restoreBetaAccess, revokeBetaAccess, revokeBetaInvite, setPlanForUsersOrg,
} from '@/lib/server/beta'
import { isPlanId, entitlementsFor } from '@/lib/server/entitlements'
import { accessRequestEmail, signupMode } from '@/lib/server/signup-policy'

export const GET = api({ permission: 'read' }, async (_req, { auth }) => {
  requirePlatformAdmin(auth)
  return json({
    signup: { mode: signupMode(), accessRequestEmail: accessRequestEmail() },
    emailDelivery: emailConfigured(),
    inviteDays: BETA_INVITE_DAYS,
    invites: await listBetaInvites(),
    users: await listBetaUsers(),
  })
})

type Body = { action?: string; email?: string; company?: string; id?: string; userId?: string; plan?: string }

export const POST = api({ permission: 'read' }, async (req, { auth }) => {
  requirePlatformAdmin(auth)
  const b = await body<Body>(req)
  switch (b.action) {
    case 'invite': {
      const company = typeof b.company === 'string' ? b.company : null
      const { invite, token } = await createBetaInvite(String(b.email || ''), company, { id: auth.userId, email: auth.email })
      const link = `${appOrigin(req)}/auth?beta=${encodeURIComponent(token)}`
      // Emailed when a provider is configured; the link is always shown to the operator as well.
      const emailed = (await sendEmail({
        to: invite.email,
        ...betaInviteEmail({ inviter: auth.name, company: invite.company, email: invite.email, link, days: BETA_INVITE_DAYS }, appOrigin(req)),
      })).sent
      await appendAudit([{ orgId: SYSTEM_ORG, action: 'beta.invite_created', targetType: 'beta_invite', targetId: invite.id, detail: { email: invite.email, company: invite.company, expiresAt: invite.expiresAt, emailed } }])
      return json({ invite, link, emailed, expiresInDays: BETA_INVITE_DAYS })
    }
    case 'revoke_invite': {
      const email = b.id ? await revokeBetaInvite(String(b.id)) : null
      if (!email) throw new ApiError(404, 'No pending invitation with that id.')
      await appendAudit([{ orgId: SYSTEM_ORG, action: 'beta.invite_revoked', targetType: 'beta_invite', targetId: String(b.id), detail: { email } }])
      return json({ success: true })
    }
    case 'revoke_access': {
      if (!b.userId) throw new ApiError(400, 'userId required.')
      const r = await revokeBetaAccess(String(b.userId))
      // In the operators' log and in the person's organization log, so their admins can see why.
      const detail = { email: r.email, sessionsRevoked: r.sessionsRevoked }
      await appendAudit([
        { orgId: SYSTEM_ORG, action: 'beta.access_revoked', targetType: 'user', targetId: String(b.userId), detail: { ...detail, organization: r.orgId } },
        { orgId: r.orgId, action: 'beta.access_revoked', targetType: 'user', targetId: String(b.userId), detail },
      ])
      return json({ success: true, sessionsRevoked: r.sessionsRevoked })
    }
    case 'restore_access': {
      if (!b.userId) throw new ApiError(400, 'userId required.')
      const r = await restoreBetaAccess(String(b.userId))
      await appendAudit([
        { orgId: SYSTEM_ORG, action: 'beta.access_restored', targetType: 'user', targetId: String(b.userId), detail: { email: r.email, organization: r.orgId } },
        { orgId: r.orgId, action: 'beta.access_restored', targetType: 'user', targetId: String(b.userId), detail: { email: r.email } },
      ])
      return json({ success: true })
    }
    case 'set_plan': {
      if (!b.userId || !isPlanId(b.plan)) throw new ApiError(400, 'userId and a plan (free, pro or enterprise) are required.')
      const r = await setPlanForUsersOrg(String(b.userId), b.plan)
      // In the operators' log and in the organization's own log, so its admins can see the change.
      const detail = { from: r.from, to: b.plan }
      await appendAudit([
        { orgId: SYSTEM_ORG, action: 'beta.plan_changed', targetType: 'organization', targetId: r.orgId, detail: { ...detail, organization: r.name } },
        { orgId: r.orgId, action: 'beta.plan_changed', targetType: 'organization', targetId: r.orgId, detail },
      ])
      return json({ success: true, plan: b.plan, label: entitlementsFor(b.plan).label })
    }
    default:
      throw new ApiError(400, 'Invalid action')
  }
})
