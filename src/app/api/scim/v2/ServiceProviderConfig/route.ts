import { scimApi, scimJson } from '@/lib/server/api'
import { appOrigin } from '@/lib/server/email'
import { serviceProviderConfig } from '@/lib/server/scim'

/** SCIM 2.0 discovery: supported features (PATCH, filter; no bulk, sort, etag or password change). */
export const GET = scimApi(async req => scimJson(serviceProviderConfig(appOrigin(req))))
