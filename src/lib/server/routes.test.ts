import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Continuous access-control check: every API handler must be built with api() (authenticated, with
// an explicit RBAC permission) or publicApi() (only the endpoints listed here). A new route that
// skips the wrapper, or a new public endpoint, fails the build.
const PUBLIC = new Set(['auth/route.ts', 'health/route.ts', 'auth/sso/route.ts', 'auth/sso/callback/route.ts', 'auth/verify/route.ts'])
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
  for (const file of files) {
    const rel = path.relative(API_DIR, file)
    it(`${rel} wraps every handler`, () => {
      const src = fs.readFileSync(file, 'utf8')
      expect(src, 'handlers must not be plain functions').not.toMatch(/export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/)
      const handlers = [...src.matchAll(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*=\s*(\w+)/g)]
      expect(handlers.length).toBeGreaterThan(0)
      for (const [, method, wrapper] of handlers) {
        if (PUBLIC.has(rel)) expect(['api', 'publicApi'], `${method} in ${rel}`).toContain(wrapper)
        else expect(wrapper, `${method} in ${rel} must use api() with a permission`).toBe('api')
      }
      if (!PUBLIC.has(rel)) expect(src).toMatch(/permission:\s*'[a-z.]+'/)
    })
  }
})
