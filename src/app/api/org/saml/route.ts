import { api, json, body, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { entitlementsFor, requireFeature } from '@/lib/server/entitlements'
import { appOrigin } from '@/lib/server/email'
import { auditableSaml, parseIdpMetadata, publicSaml, samlConfigFor, saveSamlConfig, NAMEID_FORMATS, type SamlInput } from '@/lib/server/saml'

/** SAML 2.0 single sign-on settings (admins). Signing certificates are public material; nothing secret is stored. */
export const GET = api({ permission: 'org.manage' }, async (req, { auth }) => {
  return json({
    available: entitlementsFor(auth.plan).sso,
    saml: publicSaml(await samlConfigFor(auth.orgId), appOrigin(req)),
    nameIdFormats: NAMEID_FORMATS,
  })
})

type Body = { action?: string; xml?: string; saml?: Record<string, unknown> }

export const POST = api({ permission: 'org.manage' }, async (req, { auth }) => {
  const b = await body<Body>(req)
  requireFeature(auth.plan, entitlementsFor(auth.plan).sso, 'Single sign-on')
  switch (b.action) {
    case 'parse_metadata': {
      // Reads the IdP metadata the admin pasted; nothing is saved until they press Save.
      return json({ parsed: parseIdpMetadata(String(b.xml || '')) })
    }
    case 'save': {
      const input = b.saml
      if (!input || typeof input !== 'object') throw new ApiError(400, 'saml settings required')
      const s = (k: string) => (typeof input[k] === 'string' ? String(input[k]) : undefined)
      const before = await samlConfigFor(auth.orgId)
      const attributes = input.attributes && typeof input.attributes === 'object' ? input.attributes as Record<string, unknown> : undefined
      const saved = await saveSamlConfig(auth.orgId, {
        enabled: input.enabled === true, enforce: input.enforce === true,
        idpEntityId: s('idpEntityId'), ssoUrl: s('ssoUrl'), nameIdFormat: s('nameIdFormat'), defaultRole: s('defaultRole'),
        certs: Array.isArray(input.certs) ? input.certs.map(String) : s('certs'),
        attributes: attributes ? { email: String(attributes.email ?? ''), name: String(attributes.name ?? ''), groups: String(attributes.groups ?? '') } : undefined,
        groupRoles: input.groupRoles,
        domains: Array.isArray(input.domains) ? input.domains.map(String) : undefined,
      } satisfies SamlInput)
      await audit({ action: 'org.saml_changed', targetType: 'organization', targetId: auth.orgId, detail: { before: auditableSaml(before), after: auditableSaml(saved) } })
      return json({ success: true, saml: publicSaml(saved, appOrigin(req)) })
    }
    default:
      throw new ApiError(400, 'Unknown action')
  }
})
