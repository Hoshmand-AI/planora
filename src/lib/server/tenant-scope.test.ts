import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { MIGRATIONS } from '@/lib/migrations'

// Static tenant-isolation check (the end-to-end counterpart is scripts/e2e-tenant-isolation.mjs).
// Every SQL string in src/ that touches a table holding firm data must be scoped to one organization:
//   • a table with an org_id column  → the statement mentions org_id;
//   • organizations                  → keyed by its id (the caller's org id) or joined through org_id;
//   • a child table without org_id   → joined to schedules with an org_id predicate in the same statement;
//   • users                          → org_id, or keyed by the user's own id / email (identity lookups).
// A statement that is safe for another reason goes in ALLOWLIST with the reason. Unused allowlist
// entries fail too, so the list stays honest. A new table must be classified below before it is used.

const ROOT = process.cwd()
const SRC = path.join(ROOT, 'src')

/** Child tables of schedules (no org_id column): scoped through their schedule. */
const CHILD_TABLES = new Set(['activities', 'relationships', 'chat_messages', 'data_question_responses'])
/** Not firm data: per-user or operational tables, scoped by user id, token hash or key. */
const NON_TENANT_TABLES = new Set(['sessions', 'rate_limits', 'email_tokens', 'maintenance_runs', 'schema_migrations',
  // Private beta invitations for NEW firms: platform-operator data (no organization exists yet), read
  // and written only through /api/platform/beta (404 unless PLANORA_PLATFORM_ADMINS) and by token hash at sign-up.
  'beta_invites'])
const IDENTITY_TABLES = new Set(['users'])
const ROOT_TABLE = 'organizations'

/** Tables created by the migrations, and those that carry an org_id column. */
function schemaTables(): { all: Set<string>; withOrgId: Set<string> } {
  const all = new Set<string>()
  const withOrgId = new Set<string>()
  for (const m of MIGRATIONS) {
    for (const [, name, body] of m.sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\s*\);/g)) {
      all.add(name)
      if (/^\s*org_id\s/m.test(body)) withOrgId.add(name)
    }
    for (const [, name] of m.sql.matchAll(/ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS org_id\b/g)) withOrgId.add(name)
  }
  return { all, withOrgId }
}

/**
 * Statements that are tenant-safe although the rule above can't see it. `file` is relative to the
 * repository root; `sql` is a substring of the statement (whitespace collapsed).
 */
const ALLOWLIST: { file: string; sql: string; why: string }[] = [
  // Project documents: scope() in retrieval.ts injects d.org_id = $1, the org-scoped project CTE and workspace walls via ${sc.where}.
  { file: 'src/lib/rag/retrieval.ts', sql: 'WITH ${sc.cte}, q AS (SELECT ${tsq} AS tsq)', why: 'retrieval: q is a tsquery CTE, not a table; chunks/documents filtered by ${sc.where} (org_id = $1)' },
  { file: 'src/lib/rag/retrieval.ts', sql: 'SELECT d.* FROM project_documents d ${sc.join} WHERE ${sc.where}', why: 'getScopedDocument: ${sc.where} starts with d.org_id = $1' },
  { file: 'src/lib/server/maintenance.ts', sql: "DELETE FROM retrieval_log WHERE created_at < NOW() - INTERVAL '400 days'", why: 'retention sweep, all orgs' },
  // SAML / SCIM: resolving the org from a public connection id or a hashed token, and global expiry sweeps.
  { file: 'src/lib/server/saml.ts', sql: "SELECT id, plan, saml FROM organizations WHERE saml->>'connectionId'=$1", why: 'SAML ACS/login: resolves the org that owns an unguessable connection id (no session yet)' },
  { file: 'src/lib/server/saml.ts', sql: "DELETE FROM saml_requests WHERE created_at < NOW() - INTERVAL '1 day'", why: 'expiry sweep of one-time request ids, all orgs' },
  { file: 'src/lib/server/saml.ts', sql: 'DELETE FROM saml_assertions WHERE expires_at < NOW()', why: 'expiry sweep of replay-protection ids, all orgs' },
  { file: 'src/lib/server/scim.ts', sql: 'UPDATE scim_tokens SET last_used_at=NOW() WHERE id=$1', why: 'resolveScimToken: the row just found by its token hash' },
  { file: 'src/lib/server/scim.ts', sql: 'FROM users WHERE ${where}', why: 'listScimUsers: ${where} always starts with org_id=$1 (LIVE)' },
  // Child rows of a schedule: every caller first loads the schedule with getScheduleById(id, orgId) or
  // loadScheduleData(id, orgId) (organization + workspace scoped) and passes that schedule's id.
  { file: 'src/lib/db.ts', sql: 'SELECT * FROM activities WHERE schedule_id=$1', why: 'getActivities: schedule id comes from an org-scoped schedule lookup' },
  { file: 'src/lib/db.ts', sql: 'SELECT * FROM relationships WHERE schedule_id=$1', why: 'getRelationships: schedule id comes from an org-scoped schedule lookup' },
  { file: 'src/lib/db.ts', sql: 'SELECT * FROM data_question_responses WHERE schedule_id=$1', why: 'getDataQuestionResponses: schedule id comes from an org-scoped schedule lookup' },
  { file: 'src/lib/db.ts', sql: 'INSERT INTO data_question_responses', why: 'saveDataQuestionResponse: the quality route verifies the schedule with getScheduleById(id, orgId) first' },
  { file: 'src/lib/db.ts', sql: 'SELECT * FROM chat_messages WHERE schedule_id=$1 AND user_id=$2', why: "getChatMessages: the caller's own messages, after an org-scoped schedule check" },
  { file: 'src/lib/db.ts', sql: 'INSERT INTO chat_messages', why: 'createChatMessage: /api/ask loads the schedule with loadScheduleData(id, orgId) first' },
  { file: 'src/lib/db.ts', sql: 'SELECT * FROM chat_messages WHERE user_id=$1', why: "getChatMessagesForUser: the signed-in person's own messages (privacy export)" },
  { file: 'src/lib/db.ts', sql: 'SELECT * FROM chat_messages WHERE schedule_id=$1 ORDER BY created_at', why: 'exportOrganization: iterates getSchedules(orgId)' },
  { file: 'src/lib/db.ts', sql: 'UPDATE data_question_responses SET user_id=$2 WHERE user_id=$1', why: "deleteAccountData: reassigns the leaving member's own rows to an heir in the same org" },
  { file: 'src/lib/db.ts', sql: 'DELETE FROM chat_messages WHERE user_id=$1', why: "deleteAccountData: the leaving member's own messages" },
  // Activities/relationships inserted for a schedule row the same request just created in the caller's org.
  { file: 'src/lib/db.ts', sql: 'INSERT INTO ${table}', why: 'bulkInsert (activities, relationships) for a schedule created in this request' },
  // Plans/schedules keyed by the leaving member's user id: a user belongs to exactly one org.
  { file: 'src/lib/db.ts', sql: 'UPDATE plans SET user_id=$2 WHERE user_id=$1', why: "deleteAccountData: the member's own plans (users belong to one org)" },
  { file: 'src/lib/db.ts', sql: 'UPDATE schedules SET user_id=$2 WHERE user_id=$1', why: "deleteAccountData: the member's own uploads (users belong to one org)" },
  { file: 'src/lib/db.ts', sql: "UPDATE schedule_edits SET user_id=$2, user_name='Former member' WHERE user_id=$1", why: "deleteAccountData: the member's own edits (users belong to one org)" },
  { file: 'src/lib/db.ts', sql: 'UPDATE delay_events SET created_by=$2 WHERE created_by=$1', why: "deleteAccountData: the member's own delay events (users belong to one org)" },
  { file: 'src/lib/db.ts', sql: 'UPDATE delay_events SET updated_by=$2 WHERE updated_by=$1', why: "deleteAccountData: the member's own delay-event edits (users belong to one org)" },
  // The audit filter list starts with org_id=$1 and is built up in code.
  { file: 'src/lib/server/audit.ts', sql: 'SELECT * FROM audit_events WHERE ${where.join(', why: "listAudit: where = ['org_id=$1', ...]" },
  // API key resolution IS the authentication step: the key's org becomes the caller's org.
  { file: 'src/lib/server/api-keys.ts', sql: 'FROM api_keys k JOIN organizations o ON o.id = k.org_id WHERE k.key_hash=$1', why: 'resolveApiKey: looks a key up by its hash to find its organization' },
  { file: 'src/lib/server/api-keys.ts', sql: 'UPDATE api_keys SET last_used_at=NOW() WHERE id=$1', why: 'resolveApiKey: id of the key just resolved by hash' },
  // Webhook bookkeeping on a row loaded with org_id (dispatchNow / test_webhook).
  { file: 'src/lib/server/webhooks.ts', sql: 'UPDATE webhooks SET last_delivery_at=NOW()', why: 'deliverToWebhook: id of a webhook loaded by org_id' },
  // Invitation tokens are looked up by hash before anyone is signed in; the invitation names its org.
  { file: 'src/lib/server/org.ts', sql: 'WHERE i.token_hash=$1', why: 'findInvitation: lookup by single-use token hash (sign-up)' },
  { file: 'src/lib/server/org.ts', sql: 'UPDATE invitations SET accepted_at=NOW() WHERE id=$1', why: 'markInvitationAccepted: id of the invitation found by token' },
  // Housekeeping across all organizations (no caller, no data returned).
  { file: 'src/lib/server/maintenance.ts', sql: 'DELETE FROM invitations WHERE (accepted_at IS NULL)', why: 'retention: purges long-expired invitations of every org' },
  { file: 'src/lib/server/maintenance.ts', sql: 'SELECT id, settings FROM organizations', why: "retention: iterates organizations to apply each org's own policy" },
  // Sign-up of a new firm creates its organization (the id is new; nothing is read).
  { file: 'src/lib/db.ts', sql: 'INSERT INTO organizations (id, name, plan)', why: 'createUser: a new organization for a self sign-up' },
  // Private beta administration: the platform operator's cross-organization view (/api/platform/beta
  // answers 404 to everyone not in PLANORA_PLATFORM_ADMINS).
  { file: 'src/lib/server/beta.ts', sql: 'FROM beta_invites b LEFT JOIN organizations o ON o.id = b.accepted_org_id', why: 'listBetaInvites: platform operators only; names the firm each invitation created' },
  { file: 'src/lib/server/beta.ts', sql: 'FROM users u JOIN organizations o ON o.id = u.org_id ORDER BY u.created_at DESC', why: 'listBetaUsers: platform operators only; beta status of every account' },
  // Invite-only sign-up needs to know whether the instance is empty (a count, no data).
  { file: 'src/app/api/auth/route.ts', sql: 'SELECT COUNT(*)::int AS n FROM organizations', why: 'invite-only bootstrap: count only' },
  // SSO: a verified email domain maps to exactly one organization (unique across orgs by design).
  { file: 'src/lib/server/sso.ts', sql: 'FROM sso_domains d JOIN organizations o ON o.id=d.org_id WHERE d.domain=$1', why: 'SSO start: domain → its one organization' },
  { file: 'src/lib/server/sso.ts', sql: 'SELECT domain FROM sso_domains WHERE domain = ANY($1) AND org_id<>$2', why: "saveSsoConfig: refuses domains another org already claimed (returns the caller's own domains only)" },
]

/** String literals (quotes and templates, template expressions kept verbatim) with their line numbers. */
export function stringLiterals(src: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = []
  let i = 0
  const lineAt = (pos: number) => src.slice(0, pos).split('\n').length
  while (i < src.length) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue }
    if (c === "'" || c === '"') {
      const start = i++
      let t = ''
      while (i < src.length && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\') { t += src[i + 1] ?? ''; i += 2; continue } t += src[i++] }
      i++
      out.push({ text: t, line: lineAt(start) })
      continue
    }
    if (c === '`') {
      const start = i++
      let t = ''
      while (i < src.length && src[i] !== '`') {
        if (src[i] === '\\') { t += src[i + 1] ?? ''; i += 2; continue }
        if (src[i] === '$' && src[i + 1] === '{') {
          let depth = 0
          do {
            if (src[i] === '{') depth++
            else if (src[i] === '}') depth--
            t += src[i++]
          } while (i < src.length && depth > 0)
          continue
        }
        t += src[i++]
      }
      i++
      out.push({ text: t, line: lineAt(start) })
      continue
    }
    i++
  }
  return out
}

// SQL in this codebase is written with upper-case keywords; matching case-sensitively keeps UI prose out.
const SQL_RE = /^\s*(WITH|SELECT|INSERT|UPDATE|DELETE)\b[\s\S]*\b(FROM|INTO|SET)\b/
const TABLE_RE = /\b(?:FROM|JOIN|INTO|UPDATE|USING)\s+(?!SET\b)([a-z_]+)\b/g

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === '__fixtures__' ? [] : sourceFiles(p)
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : []
  })
}

interface Statement { file: string; line: number; sql: string; tables: string[] }

function statements(): Statement[] {
  const out: Statement[] = []
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/')
    if (rel === 'src/lib/migrations.ts') continue // DDL, not queries
    for (const lit of stringLiterals(fs.readFileSync(file, 'utf8'))) {
      const sql = lit.text.replace(/\s+/g, ' ').trim()
      if (!SQL_RE.test(sql)) continue
      const tables = [...new Set([...sql.matchAll(TABLE_RE)].map(m => m[1].toLowerCase()))]
      out.push({ file: rel, line: lit.line, sql, tables })
    }
  }
  return out
}

/** Why a statement is not visibly tenant-scoped, or null when it is. */
function problem(s: Statement, withOrgId: Set<string>): string | null {
  const orgPredicate = /\borg_id\b/i.test(s.sql)
  for (const t of s.tables) {
    if (NON_TENANT_TABLES.has(t)) continue
    if (withOrgId.has(t) && !IDENTITY_TABLES.has(t)) { if (!orgPredicate) return `${t} without an org_id predicate`; continue }
    if (t === ROOT_TABLE) { if (!/\b(WHERE|AND)\s+(o\.)?id\s*=\s*\$\d|\bo\.id\s*=\s*\w+\.org_id\b/i.test(s.sql)) return 'organizations not keyed by the caller\'s org id'; continue }
    if (IDENTITY_TABLES.has(t)) { if (!orgPredicate && !/\b(WHERE|AND)\s+(u\.)?id\s*=\s*\$(\d|\$\{)|LOWER\((u\.)?email\)\s*=/i.test(s.sql)) return 'users neither org-scoped nor keyed by the user\'s own id/email'; continue }
    if (CHILD_TABLES.has(t)) { if (!(s.tables.includes('schedules') && orgPredicate)) return `${t} not joined to schedules with an org_id predicate`; continue }
    return `unclassified table "${t}" (classify it in tenant-scope.test.ts)`
  }
  return null
}

describe('tenant scoping of SQL', () => {
  const { all, withOrgId } = schemaTables()
  const found = statements()

  it('parses the schema and finds the queries', () => {
    expect(withOrgId.has('schedules') && withOrgId.has('plans') && withOrgId.has('audit_events')).toBe(true)
    expect(found.length).toBeGreaterThan(100)
  })

  it('every table in the schema is classified', () => {
    const classified = (t: string) => withOrgId.has(t) || CHILD_TABLES.has(t) || NON_TENANT_TABLES.has(t) || IDENTITY_TABLES.has(t) || t === ROOT_TABLE
    expect([...all].filter(t => !classified(t)), 'new table: add org_id, or classify it here').toEqual([])
  })

  it('child tables really have no org_id (otherwise they must use it)', () => {
    expect([...CHILD_TABLES].filter(t => withOrgId.has(t))).toEqual([])
  })

  it('every statement on a tenant table is scoped to one organization', () => {
    const allowed = (s: Statement) => ALLOWLIST.some(a => a.file === s.file && s.sql.includes(a.sql))
    const bad = found.map(s => ({ s, why: problem(s, withOrgId) })).filter(x => x.why && !allowed(x.s))
    expect(bad.map(x => `${x.s.file}:${x.s.line} ${x.why}: ${x.s.sql.slice(0, 160)}`)).toEqual([])
  })

  it('every allowlist entry still matches a statement (no stale exceptions)', () => {
    const unused = ALLOWLIST.filter(a => !found.some(s => s.file === a.file && s.sql.includes(a.sql)))
    expect(unused.map(a => `${a.file}: ${a.sql}`)).toEqual([])
  })

  it('the tokenizer sees template SQL with interpolations', () => {
    const lits = stringLiterals('const q = `SELECT * FROM plans WHERE org_id=$1${ws.and}` // `SELECT * FROM plans`\n')
    expect(lits.map(l => l.text)).toEqual(['SELECT * FROM plans WHERE org_id=$1${ws.and}'])
  })
})

describe('organization id always comes from the authenticated caller', () => {
  const routes = sourceFiles(path.join(SRC, 'app/api'))
  for (const file of routes) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/')
    it(`${rel} never takes an org id from the request`, () => {
      const src = fs.readFileSync(file, 'utf8')
      // Body fields, query parameters or route params named like an organization id.
      expect(src).not.toMatch(/\b(body|b|params|input)\??\.(orgId|org_id|organizationId)\b/)
      expect(src).not.toMatch(/searchParams\.get\(\s*['"](orgId|org_id|organizationId|org)['"]\s*\)/)
      expect(src).not.toMatch(/formData\.get\(\s*['"](orgId|org_id|organizationId)['"]\s*\)/)
    })
  }

  it('scoped loaders in routes are called with the caller\'s org id', () => {
    const LOADERS = /\b(getScheduleById|getPlan|loadScheduleData|getScheduleSeries|getSchedules|listPlans|getScheduleFile|getScheduleEdits|getScheduleRiskInputs|getReviewState|deletePlan|deleteSchedule)\(([^()]*(?:\([^()]*\))?[^()]*)\)/g
    const bad: string[] = []
    for (const file of [...routes, path.join(SRC, 'lib/planning/service.ts')]) {
      const src = fs.readFileSync(file, 'utf8')
      for (const m of src.matchAll(LOADERS)) {
        if (/^\s*$/.test(m[2])) continue
        if (!/\b(auth|ctx|r\.ctx)\.orgId\b|\borgId\b/.test(m[2])) bad.push(`${path.relative(ROOT, file)}: ${m[0].slice(0, 120)}`)
      }
    }
    expect(bad).toEqual([])
  })
})
