#!/usr/bin/env node
// Operator tool: change an organization's subscription plan (free | pro | enterprise).
//   DATABASE_URL=postgres://… node scripts/set-plan.mjs <org id | member email> <plan> [reason]
// There is deliberately no web endpoint for this: changing plans requires database access.
// The change is appended to the organization's tamper-evident audit log.

import { createHash, randomUUID } from 'node:crypto'
import os from 'node:os'
import pg from 'pg'

const [who, plan, ...reasonParts] = process.argv.slice(2)
const PLANS = ['free', 'pro', 'enterprise']
if (!who || !PLANS.includes(plan) || !process.env.DATABASE_URL) {
  console.error('usage: DATABASE_URL=… node scripts/set-plan.mjs <org id | member email> <free|pro|enterprise> [reason]')
  process.exit(2)
}
const url = process.env.DATABASE_URL
const db = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1|sslmode=disable/.test(url) ? false : { rejectUnauthorized: true } })
await db.connect()
const org = who.includes('@')
  ? (await db.query('SELECT o.id, o.name, o.plan FROM organizations o JOIN users u ON u.org_id=o.id WHERE LOWER(u.email)=LOWER($1)', [who])).rows[0]
  : (await db.query('SELECT id, name, plan FROM organizations WHERE id=$1', [who])).rows[0]
if (!org) { console.error('Organization not found'); process.exit(1) }

// Same canonical form and chaining as src/lib/server/audit.ts
const canonical = v => v === null || typeof v !== 'object' ? JSON.stringify(v ?? null)
  : Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`

await db.query('BEGIN')
await db.query('UPDATE organizations SET plan=$2 WHERE id=$1', [org.id, plan])
await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`audit:${org.id}`])
const prev = (await db.query('SELECT hash FROM audit_events WHERE org_id=$1 ORDER BY seq DESC LIMIT 1', [org.id])).rows[0]?.hash || '0'.repeat(64)
const e = {
  id: randomUUID(), orgId: org.id, at: new Date().toISOString(), actorId: null, actorEmail: `operator:${os.userInfo().username}`,
  action: 'org.plan_changed', targetType: 'organization', targetId: org.id,
  detail: { before: org.plan, after: plan, ...(reasonParts.length ? { reason: reasonParts.join(' ') } : {}) }, ip: null, userAgent: 'scripts/set-plan.mjs', requestId: null,
}
const hash = createHash('sha256').update(prev + canonical(e)).digest('hex')
await db.query(`INSERT INTO audit_events (id, org_id, at, actor_id, actor_email, action, target_type, target_id, detail, ip, user_agent, request_id, prev_hash, hash)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
  [e.id, e.orgId, e.at, e.actorId, e.actorEmail, e.action, e.targetType, e.targetId, JSON.stringify(e.detail), e.ip, e.userAgent, e.requestId, prev, hash])
await db.query('COMMIT')
await db.end()
console.log(`${org.name} (${org.id}): ${org.plan} → ${plan}`)
