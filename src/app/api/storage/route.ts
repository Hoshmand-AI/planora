import { api, json, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { can } from '@/lib/server/permissions'
import { hit } from '@/lib/server/rate-limit'
import { customEndpointsAllowed, PROVIDERS, PROVIDER_LABEL, StorageError, storageClient, testStorage, validateConnection } from '@/lib/storage/providers'
import { createStorageConnection, listStorageConnections, openStorageConnection, removeStorageConnection, updateStorageStatus } from '@/lib/storage/store'
import { awsExternalId, awsLaunchUrl, credentialSource, forgetCredentials, ROLE_ARN, signInOptions, startOAuth, STORAGE_OAUTH_COOKIE } from '@/lib/storage/cloud-auth'
import { validateSignInLocation } from '@/lib/storage/providers'
import { encrypt } from '@/lib/server/crypto'
import { appOrigin } from '@/lib/server/email'
import { randomUUID } from 'crypto'

/** Where a published copy of public/cloud/aws-storage-role.yaml lives (CloudFormation quick-create needs an S3 URL). */
const awsTemplateUrl = () => (process.env.RUNF9_AWS_TEMPLATE_URL || '').trim()

// Cloud storage connections (Organization > Cloud storage): Amazon S3, Azure Blob Storage, Google
// Cloud Storage, or S3-compatible storage. Everyone who can read sees which storages exist (to pick
// one when uploading); only owners and admins connect, test or remove them. Secrets never come back.

export const GET = api({ permission: 'read' }, async (_req, { auth }) => {
  const connections = await listStorageConnections(auth.orgId)
  const manage = can(auth.role, 'org.manage')
  return json({
    connections: connections.map(c => manage ? c : { id: c.id, provider: c.provider, providerLabel: c.providerLabel, name: c.name, location: c.location, canRead: c.canRead, canWrite: c.canWrite }),
    providers: PROVIDERS.filter(p => p !== 's3' || customEndpointsAllowed()).map(id => ({ id, label: PROVIDER_LABEL[id] })),
    // Sign-in instead of keys, where this RunF9 has the identity it needs at each cloud.
    signIn: signInOptions(),
    ...(manage && signInOptions().aws ? { aws: { externalId: awsExternalId(auth.orgId), oneClick: !!awsTemplateUrl(), templatePath: '/cloud/aws-storage-role.yaml', accountId: process.env.RUNF9_AWS_ACCOUNT_ID } } : {}),
  })
})

type Body = { action?: string; id?: string; provider?: string; name?: string; config?: Record<string, unknown>; secret?: Record<string, unknown> }

export const POST = api({ permission: 'org.manage' }, async (req, { auth }) => {
  const body = (await req.json().catch(() => ({}))) as Body
  const rl = await hit(`storage:org:${auth.orgId}`, 30, 3600)
  if (!rl.ok) throw new ApiError(429, 'Too many storage changes this hour. Try again later.', 'rate_limited', { retryAfterSec: rl.retryAfterSec })

  if (body.action === 'connect') {
    const name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 80)
    if (!name) throw new ApiError(400, 'Give the connection a name, for example "Harbor client Azure".')
    let v
    try { v = validateConnection(String(body.provider), body.config ?? {}, body.secret ?? {}) } catch (e) {
      if (e instanceof StorageError) throw new ApiError(400, e.message)
      throw e
    }
    // Connect only what works: RunF9 lists and writes a check file before saving anything.
    const status = await testStorage(storageClient(v.provider, v.config, v.secret), v.config.prefix)
    if (!status.read && !status.write) {
      await audit({ action: 'storage.connect_failed', targetType: 'organization', targetId: auth.orgId, detail: { provider: v.provider, name } })
      throw new ApiError(400, `RunF9 could not use this storage: ${status.detail}`, 'storage_unreachable')
    }
    const connection = await createStorageConnection({ orgId: auth.orgId, provider: v.provider, name, config: v.config, secret: v.secret, canRead: status.read, canWrite: status.write, statusDetail: status.detail, createdBy: auth.userId })
    await audit({ action: 'storage.connected', targetType: 'storage_connection', targetId: connection.id, detail: { provider: v.provider, name, location: connection.location, canRead: status.read, canWrite: status.write } })
    return json({ connection })
  }

  const name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 80)
  const location = () => {
    try { return validateSignInLocation(String(body.provider), body.config ?? {}) } catch (e) {
      if (e instanceof StorageError) throw new ApiError(400, e.message)
      throw e
    }
  }

  // Microsoft or Google sign-in: returns the provider's sign-in page; it comes back to /api/storage/oauth/callback.
  if (body.action === 'oauth_start') {
    if (!name) throw new ApiError(400, 'Give the connection a name, for example "Harbor client Azure".')
    const loc = location()
    if (loc.provider === 'aws') throw new ApiError(400, 'AWS connects with a role, not a sign-in.')
    const redirectUri = `${appOrigin(req)}/api/storage/oauth/callback`
    let start
    try { start = startOAuth(loc.provider, redirectUri, process.env, auth.email) } catch (e) {
      if (e instanceof StorageError) throw new ApiError(400, e.message)
      throw e
    }
    const res = json({ url: start.url })
    res.cookies.set(STORAGE_OAUTH_COOKIE, encrypt(JSON.stringify({ orgId: auth.orgId, userId: auth.userId, provider: loc.provider, name, config: loc.config, verifier: start.verifier, state: start.state, redirectUri, exp: Date.now() + 10 * 60_000 })),
      { httpOnly: true, secure: redirectUri.startsWith('https:'), sameSite: 'lax', path: '/api/storage/oauth', maxAge: 600 })
    return res
  }

  // AWS: the one-click link that creates the role in the customer's account.
  if (body.action === 'aws_launch') {
    const loc = location()
    if (loc.provider !== 'aws') throw new ApiError(400, 'provider must be aws.')
    if (!signInOptions().aws) throw new ApiError(400, 'Sign-in with AWS is not set up on this RunF9.')
    const tpl = awsTemplateUrl()
    return json({
      externalId: awsExternalId(auth.orgId),
      launchUrl: tpl ? awsLaunchUrl({ orgId: auth.orgId, bucket: loc.config.bucket!, region: loc.config.region!, prefix: loc.config.prefix, templateUrl: tpl }) : null,
      templatePath: '/cloud/aws-storage-role.yaml',
      consoleUrl: `https://console.aws.amazon.com/cloudformation/home?region=${encodeURIComponent(loc.config.region!)}#/stacks/create`,
    })
  }

  // AWS: connect with the role the stack created (its ARN is the stack's RoleArn output).
  if (body.action === 'connect_role') {
    if (!name) throw new ApiError(400, 'Give the connection a name, for example "Harbor client AWS".')
    const loc = location()
    if (loc.provider !== 'aws') throw new ApiError(400, 'provider must be aws.')
    const roleArn = String(body.config?.roleArn || '').trim()
    if (!ROLE_ARN.test(roleArn)) throw new ApiError(400, 'Paste the role ARN from the stack outputs (arn:aws:iam::123456789012:role/…).')
    const config = { ...loc.config, roleArn, externalId: awsExternalId(auth.orgId) }
    const id = randomUUID()
    const status = await testStorage(storageClient('aws', config, {}, process.env, credentialSource(id, 'aws', config, {}, async () => {})), config.prefix)
    if (!status.read && !status.write) {
      forgetCredentials(id)
      await audit({ action: 'storage.connect_failed', targetType: 'organization', targetId: auth.orgId, detail: { provider: 'aws', auth: 'role', name } })
      throw new ApiError(400, `RunF9 could not use this bucket: ${status.detail}`, 'storage_unreachable')
    }
    const connection = await createStorageConnection({ id, orgId: auth.orgId, provider: 'aws', name, config, secret: {}, canRead: status.read, canWrite: status.write, statusDetail: status.detail, createdBy: auth.userId })
    await audit({ action: 'storage.connected', targetType: 'storage_connection', targetId: id, detail: { provider: 'aws', auth: 'role', name, location: connection.location, roleArn, canRead: status.read, canWrite: status.write } })
    return json({ connection })
  }

  const id = String(body.id || '')
  if (body.action === 'test') {
    const open = await openStorageConnection(auth.orgId, id)
    if (!open) throw new ApiError(404, 'Connection not found.', 'not_found')
    const status = await testStorage(open.client, open.connection.config.prefix)
    await updateStorageStatus(auth.orgId, id, { canRead: status.read, canWrite: status.write, statusDetail: status.detail })
    await audit({ action: 'storage.tested', targetType: 'storage_connection', targetId: id, detail: { canRead: status.read, canWrite: status.write } })
    return json({ status })
  }
  if (body.action === 'remove') {
    if (!(await removeStorageConnection(auth.orgId, id))) throw new ApiError(404, 'Connection not found.', 'not_found')
    await audit({ action: 'storage.removed', targetType: 'storage_connection', targetId: id })
    return json({ ok: true })
  }
  throw new ApiError(400, 'action must be connect, oauth_start, aws_launch, connect_role, test or remove.')
})
