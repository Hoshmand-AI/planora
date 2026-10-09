import { scimApi, scimJson } from '@/lib/server/api'
import { appOrigin } from '@/lib/server/email'
import { listResponse, userSchema } from '@/lib/server/scim'

/** SCIM 2.0 discovery: the User schema attributes Planora supports. */
export const GET = scimApi(async req => scimJson(listResponse([userSchema(appOrigin(req))], 1, 1)))
