import { scimApi, scimJson } from '@/lib/server/api'
import { appOrigin } from '@/lib/server/email'
import { listResponse, userResourceType } from '@/lib/server/scim'

/** SCIM 2.0 discovery: resource types (User only). */
export const GET = scimApi(async req => scimJson(listResponse([userResourceType(appOrigin(req))], 1, 1)))
