import { publicApi, ApiError } from '@/lib/server/api'
import { samlByConnection, spMetadataXml, spUrls } from '@/lib/server/saml'
import { appOrigin } from '@/lib/server/email'

/** SAML service provider metadata for one organization's connection (entity ID, ACS URL, NameID format). Public by design: IdPs fetch it. */
export const GET = publicApi<{ connection: string }>(async (req, { params }) => {
  const found = await samlByConnection(params.connection)
  if (!found) throw new ApiError(404, 'Unknown SAML connection.')
  const xml = spMetadataXml(found.config, spUrls(appOrigin(req), found.config.connectionId))
  const download = new URL(req.url).searchParams.has('download')
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/samlmetadata+xml; charset=utf-8',
      ...(download ? { 'Content-Disposition': 'attachment; filename="planora-sp-metadata.xml"' } : {}),
    },
  })
}, { optionalAuth: false })
