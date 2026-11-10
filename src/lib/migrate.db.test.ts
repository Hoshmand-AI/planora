import { afterAll, describe, expect, it, vi } from 'vitest'
import pg from 'pg'
import { MIGRATIONS } from './migrations'

// Runs against a real Postgres when AUTH_TEST_DATABASE_URL is set (CI sets it in the e2e job):
//   AUTH_TEST_DATABASE_URL=postgres://… npx vitest run src/lib/migrate.db.test.ts
// It creates its own empty database beside that one, so nothing in the shared test database is touched.
const BASE = process.env.AUTH_TEST_DATABASE_URL
const name = `runf9_migrate_${Date.now()}`
const fresh = BASE ? (() => { const u = new URL(BASE); u.pathname = `/${name}`; return u.toString() })() : ''

describe.skipIf(!BASE)('schema migrations on a fresh database', () => {
  const admin = async <T>(fn: (c: pg.Client) => Promise<T>) => { const c = new pg.Client({ connectionString: BASE }); await c.connect(); try { return await fn(c) } finally { await c.end() } }
  afterAll(async () => { if (BASE) await admin(c => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)).catch(() => {}) })

  it('three instances starting at once apply every migration exactly once, and a later start takes no lock', async () => {
    await admin(c => c.query(`CREATE DATABASE ${name}`))
    process.env.DATABASE_URL = fresh
    // Three separate copies of the module, as three server instances would be.
    const instances = []
    for (let i = 0; i < 3; i++) { vi.resetModules(); instances.push(await import('./db')) }
    await Promise.all(instances.map(m => m.initSchema()))
    const check = new pg.Client({ connectionString: fresh }); await check.connect()
    try {
      const rows = (await check.query('SELECT id FROM schema_migrations ORDER BY id')).rows.map(r => Number(r.id))
      expect(rows).toEqual(MIGRATIONS.map(m => m.id))
      // Someone else holds the migration lock (a stuck instance): a start with nothing to apply must not wait for it.
      await check.query('SELECT pg_advisory_lock(727002)')
      vi.resetModules()
      const late = await import('./db')
      const started = Date.now()
      await late.initSchema()
      expect(Date.now() - started).toBeLessThan(5000)
      expect((await late.schemaStatus()).applied.length).toBe(MIGRATIONS.length)
    } finally { await check.end() }
  }, 120_000)
})
