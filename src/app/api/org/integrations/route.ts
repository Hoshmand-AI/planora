import { api, json, body, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { entitlementsFor, requireFeature } from '@/lib/server/entitlements'
import { API_KEY_ROLES, MAX_KEYS_PER_ORG, countActiveApiKeys, createApiKey, listApiKeys, revokeApiKey, type ApiKeyRole } from '@/lib/server/api-keys'
import {
  MAX_WEBHOOKS_PER_ORG, WEBHOOK_EVENTS, createWebhook, deleteWebhook, deliverToWebhook, enableWebhook, isWebhookEvent, listWebhooks, urlProblem,
} from '@/lib/server/webhooks'
import { decrypt } from '@/lib/server/crypto'
import { requireVerifiedEmail } from '@/lib/server/email-verification'
import { query } from '@/lib/db'
import { randomUUID } from 'crypto'

/** API keys and webhooks (admins). Secrets are returned once, at creation, and never again. */
export const GET = api({ permission: 'org.manage' }, async (_req, { auth }) => {
  return json({
    available: entitlementsFor(auth.plan).integrations,
    keys: await listApiKeys(auth.orgId),
    webhooks: await listWebhooks(auth.orgId),
    events: Object.entries(WEBHOOK_EVENTS).map(([id, label]) => ({ id, label })),
    roles: API_KEY_ROLES,
  })
})

type Body = { action?: string; name?: string; role?: string; expiresInDays?: number | null; id?: string; url?: string; events?: unknown[] }

export const POST = api({ permission: 'org.manage' }, async (req, { auth }) => {
  const b = await body<Body>(req)
  switch (b.action) {
    case 'create_key': {
      requireVerifiedEmail(auth)
      requireFeature(auth.plan, entitlementsFor(auth.plan).integrations, 'API keys')
      const name = typeof b.name === 'string' ? b.name.trim().slice(0, 80) : ''
      if (!name) throw new ApiError(400, 'Name the key after what will use it, e.g. "Power BI".')
      if (!API_KEY_ROLES.includes(b.role as ApiKeyRole)) throw new ApiError(400, 'A key can be read-only (viewer) or scheduler.')
      const days = b.expiresInDays == null ? null : Number(b.expiresInDays)
      if (days !== null && (!Number.isInteger(days) || days < 1 || days > 730)) throw new ApiError(400, 'Expiry must be 1–730 days, or never.')
      if (await countActiveApiKeys(auth.orgId) >= MAX_KEYS_PER_ORG) throw new ApiError(400, `An organization can have at most ${MAX_KEYS_PER_ORG} active keys. Revoke one first.`)
      const { key, secret } = await createApiKey(auth.orgId, { name, role: b.role as ApiKeyRole, expiresInDays: days, createdBy: auth.email })
      await audit({ action: 'apikey.created', targetType: 'api_key', targetId: key.id, detail: { name, role: key.role, prefix: key.prefix, expiresAt: key.expiresAt } })
      return json({ key, secret })
    }
    case 'revoke_key': {
      const key = await revokeApiKey(auth.orgId, String(b.id || ''))
      if (!key) throw new ApiError(404, 'Key not found or already revoked.')
      await audit({ action: 'apikey.revoked', targetType: 'api_key', targetId: key.id, detail: { name: key.name, prefix: key.prefix } })
      return json({ success: true })
    }
    case 'create_webhook': {
      requireVerifiedEmail(auth)
      requireFeature(auth.plan, entitlementsFor(auth.plan).integrations, 'Webhooks')
      const url = typeof b.url === 'string' ? b.url.trim() : ''
      const problem = await urlProblem(url)
      if (problem) throw new ApiError(400, problem)
      const events = Array.isArray(b.events) ? [...new Set(b.events.filter(isWebhookEvent))] : []
      if (!events.length) throw new ApiError(400, 'Pick at least one event.')
      if ((await listWebhooks(auth.orgId)).length >= MAX_WEBHOOKS_PER_ORG) throw new ApiError(400, `An organization can have at most ${MAX_WEBHOOKS_PER_ORG} webhooks.`)
      const { hook, secret } = await createWebhook(auth.orgId, { url, events, createdBy: auth.email })
      await audit({ action: 'webhook.created', targetType: 'webhook', targetId: hook.id, detail: { host: new URL(url).host, events } })
      return json({ webhook: hook, secret })
    }
    case 'delete_webhook': {
      if (!await deleteWebhook(auth.orgId, String(b.id || ''))) throw new ApiError(404, 'Webhook not found.')
      await audit({ action: 'webhook.deleted', targetType: 'webhook', targetId: String(b.id) })
      return json({ success: true })
    }
    case 'enable_webhook': {
      if (!await enableWebhook(auth.orgId, String(b.id || ''))) throw new ApiError(404, 'Webhook not found.')
      await audit({ action: 'webhook.enabled', targetType: 'webhook', targetId: String(b.id) })
      return json({ success: true })
    }
    case 'test_webhook': {
      const row = (await query('SELECT * FROM webhooks WHERE id=$1 AND org_id=$2', [String(b.id || ''), auth.orgId])).rows[0]
      if (!row) throw new ApiError(404, 'Webhook not found.')
      const hook = (await listWebhooks(auth.orgId)).find(h => h.id === row.id)!
      const result = await deliverToWebhook({ ...hook, secret: decrypt(String(row.secret_enc)) }, auth.orgId, {
        id: randomUUID(), action: 'webhook.test', at: new Date().toISOString(), targetType: 'webhook', targetId: hook.id, detail: { message: 'Test delivery from Planora' }, actorEmail: auth.email,
      })
      await audit({ action: 'webhook.tested', targetType: 'webhook', targetId: hook.id, detail: { status: result.status } })
      return json(result)
    }
    default:
      throw new ApiError(400, 'Unknown action')
  }
})
