#!/usr/bin/env node
// Logical backup of the Planora database with an integrity manifest.
//   DATABASE_URL=postgres://… node scripts/backup.mjs [out-dir]
// Writes planora-<timestamp>.dump (pg_dump custom format, compressed) and a .manifest.json with
// the SHA-256 of the dump, per-table row counts and the latest migration, which the restore drill
// (scripts/restore-drill.mjs) checks against. Requires pg_dump (PostgreSQL client tools).

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const url = process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL is required'); process.exit(2) }
const outDir = process.argv[2] || 'backups'
fs.mkdirSync(outDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const dump = path.join(outDir, `planora-${stamp}.dump`)

const started = Date.now()
execFileSync('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--compress=6', `--file=${dump}`, url], { stdio: 'inherit' })

const db = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1|sslmode=disable/.test(url) ? false : { rejectUnauthorized: true } })
await db.connect()
const tables = (await db.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`)).rows.map(r => r.tablename)
const counts = {}
for (const t of tables) counts[t] = Number((await db.query(`SELECT COUNT(*)::bigint AS n FROM "${t}"`)).rows[0].n)
const migration = tables.includes('schema_migrations') ? Number((await db.query('SELECT MAX(id) AS m FROM schema_migrations')).rows[0].m) : null
const auditHeads = tables.includes('audit_events')
  ? Object.fromEntries((await db.query(`SELECT DISTINCT ON (org_id) org_id, hash FROM audit_events ORDER BY org_id, seq DESC`)).rows.map(r => [r.org_id, r.hash]))
  : {}
await db.end()

const sha256 = createHash('sha256').update(fs.readFileSync(dump)).digest('hex')
const manifest = { file: path.basename(dump), createdAt: new Date().toISOString(), bytes: fs.statSync(dump).size, sha256, migration, counts, auditHeads, seconds: (Date.now() - started) / 1000 }
fs.writeFileSync(`${dump}.manifest.json`, JSON.stringify(manifest, null, 2))
console.log(`Backup written: ${dump} (${(manifest.bytes / 1024).toFixed(0)} KB, ${Object.values(counts).reduce((a, b) => a + b, 0)} rows, ${manifest.seconds}s)`)
console.log(`Manifest: ${dump}.manifest.json`)
