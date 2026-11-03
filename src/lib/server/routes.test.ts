import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Continuous access-control check: every API handler must be built with api() (authenticated, with
// an explicit RBAC permission), publicApi() (only the endpoints listed here) or, for the SCIM 2.0
// provisioning endpoints only, scimApi() (organization SCIM bearer token). A new route that skips
// the wrapper, a new public endpoint, or scimApi() used outside /api/scim fails the build.
const PUBLIC = new Set([
  'auth/route.ts', 'health/route.ts', 'auth/sso/route.ts', 'auth/sso/callback/route.ts', 'auth/verify/route.ts',
  // SAML 2.0: SP metadata (fetched by IdPs), SP-initiated login, and the assertion consumer service.
  'auth/saml/[connection]/metadata/route.ts', 'auth/saml/[connection]/login/route.ts', 'auth/saml/[connection]/acs/route.ts',
])
/** Routes that may turn off the cross-site write check (the SAML ACS receives a cross-site HTTP-POST from the IdP). */
const CSRF_EXEMPT = new Set([
  'auth/saml/[connection]/acs/route.ts',
  'auth/verify/route.ts', // GET-only email verification link
])
const SCIM_DIR = `scim${path.sep}v2${path.sep}`
const API_DIR = path.join(process.cwd(), 'src/app/api')

function routes(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? routes(p) : e.name === 'route.ts' ? [p] : []
  })
}

describe('API route guard', () => {
  const files = routes(API_DIR)
  it('finds the routes', () => expect(files.length).toBeGreaterThan(15))
  it('finds the SCIM routes', () => expect(files.filter(f => path.relative(API_DIR, f).startsWith(SCIM_DIR)).length).toBeGreaterThanOrEqual(5))
  for (const file of files) {
    const rel = path.relative(API_DIR, file)
    const posix = rel.split(path.sep).join('/')
    const scim = rel.startsWith(SCIM_DIR)
    it(`${posix} wraps every handler`, () => {
      const src = fs.readFileSync(file, 'utf8')
      expect(src, 'handlers must not be plain functions').not.toMatch(/export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/)
      const handlers = [...src.matchAll(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*=\s*(\w+)/g)]
      expect(handlers.length).toBeGreaterThan(0)
      for (const [, method, wrapper] of handlers) {
        if (scim) expect(wrapper, `${method} in ${posix} must use scimApi()`).toBe('scimApi')
        else if (PUBLIC.has(posix)) expect(['api', 'publicApi'], `${method} in ${posix}`).toContain(wrapper)
        else expect(wrapper, `${method} in ${posix} must use api() with a permission`).toBe('api')
      }
      if (scim) {
        expect(src).toMatch(/import\s*\{[^}]*\bscimApi\b[^}]*\}\s*from\s*'@\/lib\/server\/api'/)
        expect(src, 'SCIM routes are token-authenticated only').not.toMatch(/\b(publicApi|getAuthContext|cookies)\b/)
      } else {
        expect(src, 'scimApi() is only for /api/scim/v2').not.toMatch(/\bscimApi\b/)
      }
      if (!PUBLIC.has(posix) && !scim) expect(src).toMatch(/permission:\s*'[a-z.]+'/)
      if (!CSRF_EXEMPT.has(posix)) expect(src, 'only the listed routes may disable the cross-site write check').not.toMatch(/csrf:\s*false/)
    })
  }
})
