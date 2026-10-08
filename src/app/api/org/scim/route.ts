import { api, json, body, ApiError } from '@/lib/server/api'
import { audit, listAudit } from '@/lib/server/audit'
import { entitlementsFor, requireFeature } from '@/lib/server/entitlements'
import { requireVerifiedEmail } from '@/lib/server/email-verification'
import { appOrigin } from '@/lib/server/email'
import { MAX_SCIM_TOKENS, countActiveScimTokens, createScimToken, listScimTokens, revokeScimToken, scimBase } from '@/lib/server/scim'

/** SCIM provisioning (admins): base URL, tokens (secret shown once) and the latest provisioning events. */
export const GET = api({ permission: 'org.manage' }, async (req, { auth }) => {
  const events = await listAudit(auth.orgId, { action: 'scim.', limit: 25 })
  return json({
    available: entitlementsFor(auth.plan).sso,
    baseUrl: scimBase(appOrigin(req)),
    tokens: await listScimTokens(auth.orgId),
    events: events.map(e => ({ seq: e.seq, at: e.at, action: e.action, actorEmail: e.actorEmail, targetId: e.targetId, detail: e.detail })),
  })
})

type Body = { action?: string; name?: string; id?: string }

export const POST = api({ permission: 'org.manage' }, async (req, { auth }) => {
  const b = await body<Body>(req)
  switch (b.action) {
    case 'create_token': {
      requireVerifiedEmail(auth)
      requireFeature(auth.plan, entitlementsFor(auth.plan).sso, 'SCIM provisioning')
      const name = typeof b.name === 'string' ? b.name.trim().slice(0, 80) : ''
      if (!name) throw new ApiError(400, 'Name the token after the identity provider that will use it, e.g. "Entra ID".')
      if (await countActiveScimTokens(auth.orgId) >= MAX_SCIM_TOKENS) throw new ApiError(400, `An organization can have at most ${MAX_SCIM_TOKENS} active SCIM tokens. Revoke one first.`)
      const { token, secret } = await createScimToken(auth.orgId, { name, createdBy: auth.email })
      await audit({ action: 'scim.token_created', targetType: 'scim_token', targetId: token.id, detail: { name, prefix: token.prefix } })
      return json({ token, secret })
    }
    case 'revoke_token': {
      const token = await revokeScimToken(auth.orgId, String(b.id || ''))
      if (!token) throw new ApiError(404, 'Token not found or already revoked.')
      await audit({ action: 'scim.token_revoked', targetType: 'scim_token', targetId: token.id, detail: { name: token.name, prefix: token.prefix } })
      return json({ success: true })
    }
    default:
      throw new ApiError(400, 'Unknown action')
  }
})
