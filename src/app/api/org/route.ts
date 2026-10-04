import { api, json, body, ApiError } from '@/lib/server/api'
import { getOrganization, listMembers, query, exportOrganization, deleteOrganization, getUserById, getSchedules } from '@/lib/db'
import { verifyPassword, clearSessionCookie } from '@/lib/auth'
import { audit } from '@/lib/server/audit'
import { can, canAssign, isRole, ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, permissionsOf, type Role } from '@/lib/server/permissions'
import { changeRole, createInvitation, listInvitations, removeMember, revokeInvitation, transferOwnership, INVITE_DAYS } from '@/lib/server/org'
import { normalizeSettings, DEFAULT_SETTINGS, type OrgSettings } from '@/lib/server/settings'
import { aiQuotaKey, peek } from '@/lib/server/rate-limit'
import { consumeSecondFactor } from '@/lib/server/mfa'
import { normalizeSso, publicSso, saveSsoConfig, ssoConfigFor } from '@/lib/server/sso'
import { entitlementsFor, requireFeature } from '@/lib/server/entitlements'
import { requireVerifiedEmail } from '@/lib/server/email-verification'
import { appOrigin, sendEmail } from '@/lib/server/email'

/** Organization overview: members are visible to every member; invitations and settings to admins. */
export const GET = api({ permission: 'read' }, async (_req, { auth }) => {
  const org = await getOrganization(auth.orgId)
  if (!org) throw new ApiError(404, 'Organization not found')
  const manage = can(auth.role, 'org.manage')
  const members = (await listMembers(auth.orgId)).filter(m => !m.disabledAt).map(m => ({
    id: m.id, name: m.name, email: m.email, role: m.role, createdAt: m.createdAt,
    ...(manage ? { mfaEnabled: !!m.mfaEnabledAt, lockedUntil: m.lockedUntil } : {}),
  }))
  return json({
    org: { id: org.id, name: org.name, createdAt: org.createdAt },
    you: { id: auth.userId, role: auth.role, permissions: isRole(auth.role) ? permissionsOf(auth.role) : [] },
    roles: ROLES.map(r => ({ id: r, label: ROLE_LABELS[r], description: ROLE_DESCRIPTIONS[r] })),
    members,
    ...(manage ? {
      invitations: await listInvitations(auth.orgId),
      settings: normalizeSettings(org.settings),
      defaults: DEFAULT_SETTINGS,
      aiUsageToday: await peek(aiQuotaKey(auth.orgId), 86_400),
      sso: publicSso(normalizeSso(org.sso)),
    } : {}),
    plan: { id: org.plan, ...entitlementsFor(org.plan), uploadedSchedules: (await getSchedules(auth.orgId)).filter(s => s.sourceType !== 'generated').length },
  })
})

type Body = {
  action?: string; email?: string; role?: string; userId?: string; invitationId?: string; name?: string
  settings?: Partial<OrgSettings>; password?: string; code?: string; confirm?: string
}

export const POST = api({ permission: 'org.manage' }, async (req, { auth }) => {
  const b = await body<Body>(req)
  const actorRole = auth.role as Role

  switch (b.action) {
    case 'invite': {
      if (!isRole(b.role)) throw new ApiError(400, 'Pick a role.')
      if (!canAssign(actorRole, b.role)) throw new ApiError(403, 'Only an owner can invite owners or admins.')
      requireVerifiedEmail(auth)
      const { invitation, token } = await createInvitation(auth.orgId, String(b.email || ''), b.role, auth.userId)
      const link = `${appOrigin(req)}/auth?invite=${encodeURIComponent(token)}`
      // Emailed when a provider is configured; the link is always shown to the admin as well.
      const emailed = (await sendEmail({
        to: invitation.email, subject: `${auth.name} invited you to ${auth.orgName} on Planora`,
        text: `${auth.name} (${auth.email}) invited you to join ${auth.orgName} on Planora as ${ROLE_LABELS[b.role]}.\n\nAccept the invitation:\n\n${link}\n\nThe link works once, only for this email address, and expires in ${INVITE_DAYS} days.\n\n— Planora by Hoshmand AI`,
      })).sent
      await audit({ action: 'member.invited', targetType: 'invitation', targetId: invitation.id, detail: { email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt, emailed } })
      return json({ invitation, link, emailed, expiresInDays: INVITE_DAYS })
    }
    case 'revoke_invite': {
      if (!b.invitationId || !(await revokeInvitation(auth.orgId, String(b.invitationId)))) throw new ApiError(404, 'Invitation not found.')
      await audit({ action: 'member.invite_revoked', targetType: 'invitation', targetId: String(b.invitationId) })
      return json({ success: true })
    }
    case 'set_role': {
      if (!b.userId || !isRole(b.role)) throw new ApiError(400, 'userId and role required.')
      const target = await getUserById(String(b.userId))
      if (!target || target.orgId !== auth.orgId) throw new ApiError(404, 'Member not found.')
      if (!canAssign(actorRole, b.role) || (!canAssign(actorRole, target.role as Role) && actorRole !== 'owner')) throw new ApiError(403, 'Only an owner can change owners or admins.')
      if (target.id === auth.userId && actorRole !== 'owner') throw new ApiError(403, "You can't change your own role.")
      const change = await changeRole(auth.orgId, target.id, b.role)
      await audit({ action: 'member.role_changed', targetType: 'user', targetId: target.id, detail: { email: target.email, before: change.from, after: change.to } })
      return json({ success: true })
    }
    case 'remove_member': {
      const target = b.userId ? await getUserById(String(b.userId)) : undefined
      if (!target || target.orgId !== auth.orgId) throw new ApiError(404, 'Member not found.')
      if (target.id === auth.userId) throw new ApiError(400, 'To leave, delete your account under Account instead.')
      if (!canAssign(actorRole, target.role as Role) && actorRole !== 'owner') throw new ApiError(403, 'Only an owner can remove owners or admins.')
      const removed = await removeMember(auth.orgId, target.id)
      await audit({ action: 'member.removed', targetType: 'user', targetId: target.id, detail: { ...removed, effect: 'Account disabled and signed out; project data stays with the organization.' } })
      return json({ success: true })
    }
    case 'unlock_member': {
      const target = b.userId ? await getUserById(String(b.userId)) : undefined
      if (!target || target.orgId !== auth.orgId) throw new ApiError(404, 'Member not found.')
      await query('UPDATE users SET locked_until=NULL, failed_logins=0 WHERE id=$1', [target.id])
      await audit({ action: 'member.unlocked', targetType: 'user', targetId: target.id, detail: { email: target.email } })
      return json({ success: true })
    }
    case 'transfer_ownership': {
      if (actorRole !== 'owner') throw new ApiError(403, 'Only the owner can transfer ownership.')
      await reauth(auth.userId, b)
      const target = b.userId ? await getUserById(String(b.userId)) : undefined
      if (!target || target.orgId !== auth.orgId) throw new ApiError(404, 'Member not found.')
      await transferOwnership(auth.orgId, auth.userId, target.id)
      await audit({ action: 'org.ownership_transferred', targetType: 'user', targetId: target.id, detail: { from: auth.email, to: target.email } })
      return json({ success: true })
    }
    case 'rename': {
      const name = typeof b.name === 'string' ? b.name.trim().slice(0, 160) : ''
      if (!name) throw new ApiError(400, 'Name required.')
      const before = await getOrganization(auth.orgId)
      await query('UPDATE organizations SET name=$2 WHERE id=$1', [auth.orgId, name])
      await audit({ action: 'org.renamed', targetType: 'organization', targetId: auth.orgId, detail: { before: before?.name, after: name } })
      return json({ success: true })
    }
    case 'update_settings': {
      const org = await getOrganization(auth.orgId)
      const before = normalizeSettings(org?.settings)
      const after = normalizeSettings({ ...before, ...(b.settings || {}) })
      const turningOnMfa = after.requireMfa && !before.requireMfa
      if (turningOnMfa && !auth.mfaEnabled) throw new ApiError(400, 'Turn on two-step verification for your own account first (Account → Security), so you are not locked out.')
      await query('UPDATE organizations SET settings=$2 WHERE id=$1', [auth.orgId, JSON.stringify(after)])
      const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
      const changed = Object.fromEntries(Object.keys(after).filter(k => !same(after[k as keyof OrgSettings], before[k as keyof OrgSettings])).map(k => [k, { before: before[k as keyof OrgSettings], after: after[k as keyof OrgSettings] }]))
      if (Object.keys(changed).length) await audit({ action: 'org.settings_changed', targetType: 'organization', targetId: auth.orgId, detail: changed })
      return json({ success: true, settings: after })
    }
    case 'update_sso': {
      requireFeature(auth.plan, entitlementsFor(auth.plan).sso, 'Single sign-on')
      const input = (b as Record<string, unknown>).sso as Record<string, unknown> | undefined
      if (!input || typeof input !== 'object') throw new ApiError(400, 'sso settings required')
      const before = publicSso(await ssoConfigFor(auth.orgId))
      const saved = await saveSsoConfig(auth.orgId, {
        enabled: input.enabled === true, issuer: typeof input.issuer === 'string' ? input.issuer : undefined, clientId: typeof input.clientId === 'string' ? input.clientId : undefined,
        clientSecret: typeof input.clientSecret === 'string' && input.clientSecret ? input.clientSecret : undefined,
        domains: Array.isArray(input.domains) ? input.domains.map(String) : undefined, defaultRole: typeof input.defaultRole === 'string' ? input.defaultRole : undefined, enforce: input.enforce === true,
      })
      const after = publicSso(saved)
      await audit({ action: 'org.sso_changed', targetType: 'organization', targetId: auth.orgId, detail: { before: { ...before, verification: undefined }, after: { ...after, verification: undefined }, secretChanged: typeof input.clientSecret === 'string' && !!input.clientSecret } })
      return json({ success: true, sso: after })
    }
    case 'export_data': {
      requireVerifiedEmail(auth)
      const data = await exportOrganization(auth.orgId)
      await audit({ action: 'privacy.organization_exported', targetType: 'organization', targetId: auth.orgId, detail: { plans: data.plans.length, schedules: data.schedules.length, auditEvents: data.auditEvents.length } })
      return new Response(JSON.stringify(data, null, 2), { headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="planora-organization-export-${new Date().toISOString().slice(0, 10)}.json"` } })
    }
    case 'delete_org': {
      if (actorRole !== 'owner') throw new ApiError(403, 'Only an owner can delete the organization.')
      await reauth(auth.userId, b)
      const org = await getOrganization(auth.orgId)
      if (!org || b.confirm !== org.name) throw new ApiError(400, 'Type the organization name exactly to confirm.')
      const r = await deleteOrganization(auth.orgId, { id: auth.userId, email: auth.email })
      const res = json({ success: true, ...r })
      clearSessionCookie(res)
      return res
    }
    default:
      throw new ApiError(400, 'Unknown action')
  }
})

async function reauth(userId: string, b: Body) {
  const user = await getUserById(userId)
  if (!user || !b.password || !(await verifyPassword(b.password, user.passwordHash))) throw new ApiError(401, 'Your password is incorrect.', 'bad_password')
  if (user.mfaEnabledAt && !(await consumeSecondFactor(user, String(b.code || '')))) throw new ApiError(401, 'Enter a current code from your authenticator app.', 'mfa_invalid')
}
