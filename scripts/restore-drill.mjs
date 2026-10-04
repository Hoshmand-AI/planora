#!/usr/bin/env node
// Restore drill: proves a backup can actually be restored, and measures how long it takes.
//   ADMIN_DATABASE_URL=postgres://…/postgres node scripts/restore-drill.mjs backups/planora-….dump
// Creates a scratch database, restores the dump into it, then checks: the file's SHA-256 matches
// its manifest, every table's row count matches, the schema is at the backed-up migration, and
// every organization's audit hash chain still verifies end to end. Drops the scratch database
// afterwards (KEEP_RESTORE=1 keeps it). Exits non-zero if any check fails.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import pg from 'pg'

const dump = process.argv[2]
const admin = process.env.ADMIN_DATABASE_URL
if (!dump || !admin) { console.error('usage: ADMIN_DATABASE_URL=… node scripts/restore-drill.mjs <dump>'); process.exit(2) }
const manifest = JSON.parse(fs.readFileSync(`${dump}.manifest.json`, 'utf8'))
let failures = 0
const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) failures++ }

check(createHash('sha256').update(fs.readFileSync(dump)).digest('hex') === manifest.sha256, 'Backup file matches its SHA-256')

const scratch = `planora_restore_drill_${Date.now()}`
const adminDb = new pg.Client({ connectionString: admin })
await adminDb.connect()
await adminDb.query(`CREATE DATABASE ${scratch}`)
const target = new URL(admin); target.pathname = `/${scratch}`

const started = Date.now()
try {
  execFileSync('pg_restore', ['--no-owner', '--no-privileges', '--exit-on-error', `--dbname=${target}`, dump], { stdio: 'inherit' })
  const seconds = (Date.now() - started) / 1000
  const db = new pg.Client({ connectionString: target.toString() })
  await db.connect()
  for (const [t, n] of Object.entries(manifest.counts)) {
    const got = Number((await db.query(`SELECT COUNT(*)::bigint AS n FROM "${t}"`)).rows[0].n)
    check(got === n, `${t}: ${got} rows (expected ${n})`)
  }
  if (manifest.migration != null) {
    const m = Number((await db.query('SELECT MAX(id) AS m FROM schema_migrations')).rows[0].m)
    check(m === manifest.migration, `Schema at migration ${m}`)
  }
  if (manifest.counts.audit_events) {
    // Same canonical form and chaining as src/lib/server/audit.ts
    const canonical = v => v === null || typeof v !== 'object' ? JSON.stringify(v ?? null)
      : Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
      : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
    const orgs = (await db.query('SELECT DISTINCT org_id FROM audit_events')).rows.map(r => r.org_id)
    let intact = 0
    for (const org of orgs) {
      const rows = (await db.query('SELECT * FROM audit_events WHERE org_id=$1 ORDER BY seq', [org])).rows
      let prev = '0'.repeat(64), ok = true
      for (const r of rows) {
        const body = canonical({ id: r.id, orgId: r.org_id, at: new Date(r.at).toISOString(), actorId: r.actor_id, actorEmail: r.actor_email, action: r.action, targetType: r.target_type, targetId: r.target_id, detail: r.detail, ip: r.ip, userAgent: r.user_agent, requestId: r.request_id })
        if (r.prev_hash !== prev || createHash('sha256').update(prev + body).digest('hex') !== r.hash) { ok = false; break }
        prev = r.hash
      }
      if (ok && manifest.auditHeads?.[org] && manifest.auditHeads[org] !== prev) ok = false
      if (ok) intact++
      else console.log(`  audit chain broken or truncated for ${org}`)
    }
    // Chains that were already broken before the backup (e.g. by a tamper test) are reported, not hidden.
    check(intact === orgs.length || process.env.ALLOW_BROKEN_CHAINS === '1', `Audit chains verified for ${intact} of ${orgs.length} organizations`)
  }
  await db.end()
  console.log(`\nRestore time: ${seconds.toFixed(1)} s for ${(manifest.bytes / 1024).toFixed(0)} KB (backup taken ${manifest.createdAt}).`)
} finally {
  if (!process.env.KEEP_RESTORE) await adminDb.query(`DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`)
  await adminDb.end()
}
if (failures) { console.error(`\nRestore drill FAILED (${failures} checks).`); process.exit(1) }
console.log('\nRestore drill passed.')
