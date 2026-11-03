import { scimApi, scimJson, scimBody } from '@/lib/server/api'
import { appOrigin } from '@/lib/server/email'
import { createScimUser, listResponse, listScimUsers, paging, parseFilter, toScimUser } from '@/lib/server/scim'

/** SCIM 2.0: list the organization's users (filter userName eq "…", startIndex/count paging). */
export const GET = scimApi(async (req, { scim }) => {
  const params = new URL(req.url).searchParams
  const filter = parseFilter(params.get('filter'))
  const { startIndex, count } = paging(params)
  const { rows, total } = await listScimUsers(scim.orgId, filter, startIndex, count)
  const origin = appOrigin(req)
  return scimJson(listResponse(rows.map(r => toScimUser(r, origin)), total, startIndex))
})

/** SCIM 2.0: create (provision) a user in the token's organization. */
export const POST = scimApi(async (req, { scim }) => {
  const { row } = await createScimUser(scim.orgId, await scimBody(req))
  const user = toScimUser(row, appOrigin(req))
  return scimJson(user, 201, { Location: user.meta.location })
})
