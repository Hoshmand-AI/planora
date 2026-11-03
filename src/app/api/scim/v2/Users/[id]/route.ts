import { scimApi, scimJson, scimBody } from '@/lib/server/api'
import { appOrigin } from '@/lib/server/email'
import { deleteScimUser, desiredFromPatch, desiredFromResource, getScimUser, toScimUser, updateScimUser } from '@/lib/server/scim'

type P = { id: string }

/** SCIM 2.0: one user of the token's organization (404 for any other organization's user). */
export const GET = scimApi<P>(async (req, { scim, params }) => {
  return scimJson(toScimUser(await getScimUser(scim.orgId, params.id), appOrigin(req)))
})

/** SCIM 2.0: replace a user (active=false deprovisions: account disabled, all sessions revoked). */
export const PUT = scimApi<P>(async (req, { scim, params }) => {
  const row = await updateScimUser(scim.orgId, params.id, desiredFromResource(await scimBody(req)))
  return scimJson(toScimUser(row, appOrigin(req)))
})

/** SCIM 2.0: partial update (active, userName/email, name, externalId, roles). */
export const PATCH = scimApi<P>(async (req, { scim, params }) => {
  const row = await updateScimUser(scim.orgId, params.id, desiredFromPatch(await scimBody(req)))
  return scimJson(toScimUser(row, appOrigin(req)))
})

/** SCIM 2.0: delete (deprovision): account disabled, all sessions revoked, hidden from SCIM; project data stays with the firm. */
export const DELETE = scimApi<P>(async (_req, { scim, params }) => {
  await deleteScimUser(scim.orgId, params.id)
  return new Response(null, { status: 204 })
})
