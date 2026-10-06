import { Pool } from 'pg'
import { MIGRATIONS, LATEST_MIGRATION, checksum } from './migrations'
import type { Answer, GeneratedSchedule, Question, WorkCalendar } from '@/lib/planning/types'
import type { ScheduleAnalysis } from '@/lib/analysis/schedule-analysis'

// Tenancy: every firm is an organization. All schedule, plan, and history data is keyed by org_id,
// and every read of firm data filters on org_id — there is no query path that reads across orgs.

/**
 * TLS for remote databases always verifies the server certificate and host name (verify-full).
 * sslmode in the URL is stripped so it can't silently weaken this; the CA can be supplied with
 * PGSSLROOTCERT for on-prem databases with a private CA. PGSSLMODE=disable turns TLS off
 * (local / enclave databases on a trusted network only).
 */
export function databaseTlsConfig(env: Record<string, string | undefined> = process.env): { connectionString?: string; ssl: false | { rejectUnauthorized: true; ca?: string } } {
  const raw = env.DATABASE_URL
  const local = !!raw && /@(localhost|127\.0\.0\.1|\[::1\]|[^/]*\.local)(:\d+)?\//.test(raw)
  let connectionString = raw
  if (raw) {
    try {
      const u = new URL(raw)
      for (const k of ['sslmode', 'uselibpqcompat', 'sslrootcert', 'sslcert', 'sslkey']) u.searchParams.delete(k)
      connectionString = u.toString()
    } catch { /* leave as-is */ }
  }
  if (local || env.PGSSLMODE === 'disable') return { connectionString, ssl: false }
  let ca: string | undefined
  if (env.PGSSLROOTCERT) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ca = require('fs').readFileSync(env.PGSSLROOTCERT, 'utf8') as string
  }
  return { connectionString, ssl: ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true } }
}

const tls = databaseTlsConfig()
const pool = new Pool({
  connectionString: tls.connectionString,
  ssl: tls.ssl,
  max: Number(process.env.PG_POOL_MAX) || 10,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
})
export const query = (text: string, params?: unknown[]) => pool.query(text, params)

let schemaReady: Promise<void> | null = null

export function initSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = createSchema().catch(err => { schemaReady = null; throw err })
  }
  return schemaReady
}

const MIGRATION_LOCK = 727_001

/** Applies pending migrations in order, each in its own transaction, under a cluster-wide advisory lock. */
async function createSchema() {
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK])
    try {
      await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
      const done = new Map<number, string>((await client.query('SELECT id, checksum FROM schema_migrations')).rows.map(r => [Number(r.id), String(r.checksum)]))
      for (const m of MIGRATIONS) {
        const sum = checksum(m)
        if (done.has(m.id)) {
          if (done.get(m.id) !== sum) console.warn(JSON.stringify({ level: 'warn', msg: 'migration checksum drift', migration: m.id, name: m.name }))
          continue
        }
        await client.query('BEGIN')
        try {
          await client.query(m.sql)
          await client.query('INSERT INTO schema_migrations (id, name, checksum) VALUES ($1,$2,$3)', [m.id, m.name, sum])
          await client.query('COMMIT')
          console.log(JSON.stringify({ level: 'info', msg: 'migration applied', migration: m.id, name: m.name }))
        } catch (err) {
          await client.query('ROLLBACK')
          throw new Error(`Migration ${m.id} (${m.name}) failed: ${(err as Error).message}`)
        }
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK])
    }
  } finally {
    client.release()
  }
}

export async function schemaStatus(): Promise<{ latest: number; applied: number[] }> {
  await initSchema()
  const res = await query('SELECT id FROM schema_migrations ORDER BY id')
  return { latest: LATEST_MIGRATION, applied: res.rows.map(r => Number(r.id)) }
}

/** Runs fn inside a transaction on a dedicated client. */
export async function withTransaction<T>(fn: (q: (text: string, params?: unknown[]) => Promise<import('pg').QueryResult>) => Promise<T>): Promise<T> {
  await initSchema()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn((text, params) => client.query(text, params as unknown[]))
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export async function closePool() { await pool.end() }

/* ─── Organizations & users ─────────────────────────── */

export interface User {
  id: string
  email: string
  name: string
  passwordHash: string
  plan: 'free' | 'pro' | 'enterprise'
  createdAt: string
  orgId: string
  role: string
  disabledAt: string | null
  failedLogins: number
  lockedUntil: string | null
  mfaSecret: string | null
  mfaEnabledAt: string | null
  mfaLastStep: number | null
  mfaRecovery: string[]
  emailVerifiedAt: string | null
}

function rowToUser(row: Record<string, unknown>): User {
  const ts = (v: unknown) => v ? new Date(v as string).toISOString() : null
  return {
    id: row.id as string, email: row.email as string, name: row.name as string, passwordHash: row.password_hash as string,
    plan: row.plan as User['plan'], createdAt: new Date(row.created_at as string).toISOString(), orgId: row.org_id as string,
    role: (row.role as string) || 'viewer', disabledAt: ts(row.disabled_at), failedLogins: Number(row.failed_logins || 0), lockedUntil: ts(row.locked_until),
    mfaSecret: (row.mfa_secret as string) || null, mfaEnabledAt: ts(row.mfa_enabled_at),
    mfaLastStep: row.mfa_last_step != null ? Number(row.mfa_last_step) : null, mfaRecovery: (row.mfa_recovery as string[]) || [],
    emailVerifiedAt: ts(row.email_verified_at),
  }
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  await initSchema()
  const res = await query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email])
  return res.rows[0] ? rowToUser(res.rows[0]) : undefined
}

export async function getUserById(id: string): Promise<User | undefined> {
  await initSchema()
  const res = await query('SELECT * FROM users WHERE id = $1', [id])
  return res.rows[0] ? rowToUser(res.rows[0]) : undefined
}

/** Creates the user and, unless joining an existing org (invitation), a new private organization for their firm. */
export async function createUser(user: Pick<User, 'id' | 'email' | 'name' | 'passwordHash' | 'plan' | 'createdAt'> & { orgId?: string; orgName?: string; role?: string }): Promise<User> {
  await initSchema()
  const orgId = user.orgId || `org_${user.id}`
  const role = user.orgId ? (user.role || 'viewer') : 'owner'
  return withTransaction(async q => {
    if (!user.orgId) {
      const { defaultPlan } = await import('@/lib/server/entitlements')
      await q('INSERT INTO organizations (id, name, plan) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING', [orgId, user.orgName || user.name, defaultPlan()])
    }
    const res = await q('INSERT INTO users (id, email, name, password_hash, plan, created_at, org_id, role, password_changed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING *',
      [user.id, user.email, user.name, user.passwordHash, user.plan, user.createdAt, orgId, role])
    return rowToUser(res.rows[0])
  })
}

export async function getOrganization(id: string): Promise<{ id: string; name: string; settings: Record<string, unknown>; createdAt: string; plan: string; sso: Record<string, unknown> } | undefined> {
  await initSchema()
  const res = await query('SELECT id, name, settings, created_at, plan, sso FROM organizations WHERE id=$1', [id])
  const r = res.rows[0]
  return r ? { id: r.id, name: r.name, settings: r.settings || {}, createdAt: new Date(r.created_at).toISOString(), plan: r.plan || 'free', sso: r.sso || {} } : undefined
}

export async function listMembers(orgId: string): Promise<User[]> {
  await initSchema()
  const res = await query('SELECT * FROM users WHERE org_id=$1 ORDER BY created_at', [orgId])
  return res.rows.map(rowToUser)
}

export async function updateUser(id: string, updates: Partial<User>): Promise<User | undefined> {
  await initSchema()
  const sets: string[] = []
  const vals: unknown[] = []
  let i = 1
  if (updates.name) { sets.push(`name=$${i++}`); vals.push(updates.name) }
  if (updates.plan) { sets.push(`plan=$${i++}`); vals.push(updates.plan) }
  if (!sets.length) return getUserById(id)
  vals.push(id)
  await query(`UPDATE users SET ${sets.join(',')} WHERE id=$${i}`, vals)
  return getUserById(id)
}

/* ─── Schedules ─────────────────────────────────────── */

export type SourceType = 'p6_xer' | 'ms_xml' | 'pdf' | 'excel' | 'csv' | 'generated'

export interface Schedule {
  id: string; userId: string; orgId: string; name: string; version: string
  sourceType: SourceType; fileName: string; uploadedAt: string
  activityCount: number; relationshipCount: number; projectStart: string | null
  projectFinish: string | null; dataDate: string | null; varianceDays: number | null
  criticalCount: number; percentComplete: number
  calendars: WorkCalendar[]; defaultCalendarId: string | null; warnings: string[]
  planId: string | null; projectType: string | null; region: string | null; grossSqft: number | null
  /** Planora's analysis of the schedule (src/lib/analysis/schedule-analysis.ts); null for older uploads until re-read */
  analysis?: ScheduleAnalysis | null
  /** Groups uploads of the same project into an update series */
  projectKey?: string | null
  /** Whether this schedule's actuals calibrate firm history */
  inHistory?: boolean
  /** Contract/finish milestone the scheduler designated (activity id or activity code); null = automatic */
  finishMilestoneId?: string | null
}

function rowToSchedule(row: Record<string, unknown>): Schedule {
  return {
    id: row.id as string, userId: row.user_id as string, orgId: row.org_id as string, name: row.name as string, version: row.version as string,
    sourceType: row.source_type as SourceType, fileName: row.file_name as string, uploadedAt: row.uploaded_at as string,
    activityCount: Number(row.activity_count), relationshipCount: Number(row.relationship_count),
    projectStart: row.project_start as string | null, projectFinish: row.project_finish as string | null, dataDate: row.data_date as string | null,
    varianceDays: row.variance_days != null ? Number(row.variance_days) : null, criticalCount: Number(row.critical_count), percentComplete: Number(row.percent_complete),
    calendars: (row.calendars as WorkCalendar[]) || [], defaultCalendarId: (row.default_calendar_id as string) || null, warnings: (row.warnings as string[]) || [],
    planId: (row.plan_id as string) || null, projectType: (row.project_type as string) || null, region: (row.region as string) || null,
    grossSqft: row.gross_sqft != null ? Number(row.gross_sqft) : null,
    analysis: (row.analysis as ScheduleAnalysis) ?? null, projectKey: (row.project_key as string) ?? null,
    inHistory: row.in_history == null ? true : Boolean(row.in_history),
    finishMilestoneId: (row.finish_milestone_id as string) ?? null,
  }
}

export async function getSchedules(orgId: string): Promise<Schedule[]> {
  await initSchema()
  const res = await query('SELECT * FROM schedules WHERE org_id=$1 ORDER BY uploaded_at DESC', [orgId])
  return res.rows.map(rowToSchedule)
}

/** Always scoped to the caller's organization — a schedule id alone never grants access. */
export async function getScheduleById(id: string, orgId: string): Promise<Schedule | undefined> {
  await initSchema()
  const res = await query('SELECT * FROM schedules WHERE id=$1 AND org_id=$2', [id, orgId])
  return res.rows[0] ? rowToSchedule(res.rows[0]) : undefined
}

export async function createSchedule(s: Schedule): Promise<Schedule> {
  await initSchema()
  await query(`INSERT INTO schedules (id,user_id,org_id,name,version,source_type,file_name,uploaded_at,activity_count,relationship_count,project_start,project_finish,data_date,variance_days,critical_count,percent_complete,calendars,default_calendar_id,warnings,plan_id,project_type,region,gross_sqft,analysis,project_key,in_history)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
    [s.id, s.userId, s.orgId, s.name, s.version, s.sourceType, s.fileName, s.uploadedAt, s.activityCount, s.relationshipCount, s.projectStart, s.projectFinish, s.dataDate, s.varianceDays, s.criticalCount, s.percentComplete,
      JSON.stringify(s.calendars), s.defaultCalendarId, JSON.stringify(s.warnings), s.planId, s.projectType, s.region, s.grossSqft,
      s.analysis ? JSON.stringify(s.analysis) : null, s.projectKey ?? null, s.inHistory ?? true])
  return s
}

/** Store Planora's analysis (and the numbers lists show) after a recalculation. */
export async function updateScheduleAnalysis(id: string, orgId: string, a: { analysis: ScheduleAnalysis; projectFinish: string | null; varianceDays: number | null; criticalCount: number }): Promise<void> {
  await initSchema()
  await query('UPDATE schedules SET analysis=$3, project_finish=$4, variance_days=$5, critical_count=$6 WHERE id=$1 AND org_id=$2',
    [id, orgId, JSON.stringify(a.analysis), a.projectFinish, a.varianceDays, a.criticalCount])
}

/** Designate (or clear, with null) the schedule's contract/finish milestone. */
export async function setScheduleFinishMilestone(id: string, orgId: string, finishMilestoneId: string | null): Promise<void> {
  await initSchema()
  await query('UPDATE schedules SET finish_milestone_id=$3 WHERE id=$1 AND org_id=$2', [id, orgId, finishMilestoneId])
}

export async function setScheduleInHistory(id: string, orgId: string, inHistory: boolean): Promise<void> {
  await initSchema()
  await query('UPDATE schedules SET in_history=$3 WHERE id=$1 AND org_id=$2', [id, orgId, inHistory])
}

/** Every upload in the same update series, oldest data date first. */
export async function getScheduleSeries(orgId: string, projectKey: string): Promise<Schedule[]> {
  await initSchema()
  const res = await query(`SELECT * FROM schedules WHERE org_id=$1 AND project_key=$2 AND source_type <> 'generated'
    ORDER BY data_date NULLS FIRST, uploaded_at`, [orgId, projectKey])
  return res.rows.map(rowToSchedule)
}

export async function saveScheduleFile(f: { scheduleId: string; orgId: string; fileName: string; sha256: string; content: Buffer }): Promise<void> {
  await initSchema()
  await query(`INSERT INTO schedule_files (schedule_id, org_id, file_name, sha256, size_bytes, content) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (schedule_id) DO NOTHING`, [f.scheduleId, f.orgId, f.fileName, f.sha256, f.content.length, f.content])
}

/** Uploads among `scheduleIds` whose stored original file has this SHA-256 (identical bytes). */
export async function findScheduleFilesBySha(orgId: string, sha256: string, scheduleIds: string[]): Promise<string[]> {
  if (!scheduleIds.length) return []
  await initSchema()
  const res = await query('SELECT schedule_id FROM schedule_files WHERE org_id=$1 AND sha256=$2 AND schedule_id = ANY($3::text[])', [orgId, sha256, scheduleIds])
  return res.rows.map(r => String(r.schedule_id))
}

export async function getScheduleFile(scheduleId: string, orgId: string): Promise<{ fileName: string; sha256: string; content: Buffer; createdAt: string } | undefined> {
  await initSchema()
  const res = await query('SELECT file_name, sha256, content, created_at FROM schedule_files WHERE schedule_id=$1 AND org_id=$2', [scheduleId, orgId])
  const r = res.rows[0]
  return r ? { fileName: r.file_name, sha256: r.sha256, content: r.content as Buffer, createdAt: String(r.created_at) } : undefined
}

export async function updateScheduleProfile(id: string, orgId: string, p: { projectType?: string | null; region?: string | null; grossSqft?: number | null }): Promise<void> {
  await initSchema()
  await query('UPDATE schedules SET project_type=COALESCE($3,project_type), region=COALESCE($4,region), gross_sqft=COALESCE($5,gross_sqft) WHERE id=$1 AND org_id=$2', [id, orgId, p.projectType ?? null, p.region ?? null, p.grossSqft ?? null])
}

export async function deleteSchedule(id: string, orgId: string): Promise<boolean> {
  await initSchema()
  const res = await query('DELETE FROM schedules WHERE id=$1 AND org_id=$2', [id, orgId])
  return (res.rowCount ?? 0) > 0
}

/* ─── Activities & relationships ────────────────────── */

export interface Activity {
  id: string; scheduleId: string; activityId: string; name: string; wbs: string
  duration: number; remainingDuration: number; percentComplete: number
  earlyStart: string | null; earlyFinish: string | null; lateStart: string | null; lateFinish: string | null
  actualStart: string | null; actualFinish: string | null; baselineStart: string | null; baselineFinish: string | null
  totalFloat: number; freeFloat: number; isCritical: boolean
  status: 'not_started' | 'in_progress' | 'complete'; activityType: 'task' | 'milestone' | 'loe' | 'summary'
  /** Milestones: P6 start (TT_Mile) or finish (TT_FinMile) milestone; null when the source does not say */
  milestoneKind?: 'start' | 'finish' | null
  /** Source calendar id (as referenced in the schedule's calendars list) */
  calendarId?: string | null
  constraintType?: string | null; constraintDate?: string | null
  /** Canonical category from semantic normalization (src/lib/semantic/taxonomy.ts) */
  category?: string | null
  /** Source-system id (P6 task_id, MSP UID) used to resolve relationships */
  sourceId?: string | null
}

function rowToActivity(row: Record<string, unknown>): Activity {
  return {
    id: row.id as string, scheduleId: row.schedule_id as string, activityId: row.activity_id as string, name: row.name as string, wbs: row.wbs as string,
    duration: Number(row.duration), remainingDuration: Number(row.remaining_duration), percentComplete: Number(row.percent_complete),
    earlyStart: row.early_start as string | null, earlyFinish: row.early_finish as string | null, lateStart: row.late_start as string | null, lateFinish: row.late_finish as string | null,
    actualStart: row.actual_start as string | null, actualFinish: row.actual_finish as string | null, baselineStart: row.baseline_start as string | null, baselineFinish: row.baseline_finish as string | null,
    totalFloat: Number(row.total_float), freeFloat: Number(row.free_float), isCritical: Boolean(row.is_critical),
    status: row.status as Activity['status'], activityType: row.activity_type as Activity['activityType'],
    milestoneKind: row.milestone_kind === 'start' || row.milestone_kind === 'finish' ? row.milestone_kind : null,
    calendarId: (row.calendar_id as string) ?? null, constraintType: (row.constraint_type as string) ?? null, constraintDate: (row.constraint_date as string) ?? null,
    category: (row.category as string) ?? null, sourceId: (row.source_id as string) ?? null,
  }
}

export async function getActivities(scheduleId: string): Promise<Activity[]> {
  await initSchema()
  const res = await query('SELECT * FROM activities WHERE schedule_id=$1 ORDER BY early_start NULLS LAST, activity_id', [scheduleId])
  return res.rows.map(rowToActivity)
}

async function bulkInsert(table: string, columns: string[], rows: unknown[][]) {
  // Postgres caps bind params at 65535; stay well under.
  const chunk = Math.max(1, Math.floor(5000 / columns.length))
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk)
    const params: unknown[] = []
    const values = slice.map(r => `(${r.map(v => { params.push(v); return `$${params.length}` }).join(',')})`)
    await query(`INSERT INTO ${table} (${columns.join(',')}) VALUES ${values.join(',')} ON CONFLICT (id) DO NOTHING`, params)
  }
}

/**
 * Correct the category of one activity on an uploaded schedule (firm-scoped through the schedule).
 * Returns the activity's name and previous category, or undefined when it is not in this firm's schedule.
 */
export async function setActivityCategory(orgId: string, scheduleId: string, activityId: string, category: string): Promise<{ name: string; previous: string | null } | undefined> {
  await initSchema()
  const cur = await query('SELECT a.name, a.category FROM activities a JOIN schedules s ON s.id = a.schedule_id WHERE s.org_id=$1 AND a.schedule_id=$2 AND a.id=$3', [orgId, scheduleId, activityId])
  const r = cur.rows[0]
  if (!r) return undefined
  await query('UPDATE activities a SET category=$4 FROM schedules s WHERE s.id = a.schedule_id AND s.org_id=$1 AND a.schedule_id=$2 AND a.id=$3', [orgId, scheduleId, activityId, category])
  return { name: String(r.name ?? ''), previous: (r.category as string) ?? null }
}

export async function createActivities(activities: Activity[]): Promise<void> {
  await initSchema()
  await bulkInsert('activities',
    ['id', 'schedule_id', 'activity_id', 'name', 'wbs', 'duration', 'remaining_duration', 'percent_complete', 'early_start', 'early_finish', 'late_start', 'late_finish', 'actual_start', 'actual_finish', 'baseline_start', 'baseline_finish', 'total_float', 'free_float', 'is_critical', 'status', 'activity_type', 'calendar_id', 'constraint_type', 'constraint_date', 'category', 'source_id', 'milestone_kind'],
    activities.map(a => [a.id, a.scheduleId, a.activityId, a.name, a.wbs, a.duration, a.remainingDuration, a.percentComplete, a.earlyStart, a.earlyFinish, a.lateStart, a.lateFinish, a.actualStart, a.actualFinish, a.baselineStart, a.baselineFinish, a.totalFloat, a.freeFloat, a.isCritical, a.status, a.activityType, a.calendarId ?? null, a.constraintType ?? null, a.constraintDate ?? null, a.category ?? null, a.sourceId ?? null, a.milestoneKind ?? null]))
}

export interface Relationship {
  id: string; scheduleId: string; predecessorId: string; successorId: string; type: 'FS' | 'SS' | 'FF' | 'SF'; lag: number
}

export async function getRelationships(scheduleId: string): Promise<Relationship[]> {
  await initSchema()
  const res = await query('SELECT * FROM relationships WHERE schedule_id=$1', [scheduleId])
  return res.rows.map(row => ({ id: row.id, scheduleId: row.schedule_id, predecessorId: row.predecessor_id, successorId: row.successor_id, type: row.type, lag: Number(row.lag) }))
}

export async function createRelationships(rels: Relationship[]): Promise<void> {
  await initSchema()
  await bulkInsert('relationships', ['id', 'schedule_id', 'predecessor_id', 'successor_id', 'type', 'lag'],
    rels.map(r => [r.id, r.scheduleId, r.predecessorId, r.successorId, r.type, r.lag]))
}

/* ─── Firm history (private to one org) ─────────────── */

export interface HistoryRow {
  scheduleId: string
  projectType: string | null
  region: string | null
  grossSqft: number | null
  category: string
  name: string
  calendarId: string | null
  duration: number
  baselineStart: string | null
  baselineFinish: string | null
  actualStart: string | null
  actualFinish: string | null
}

/**
 * Activities from the firm's OWN past schedules, used to ground durations.
 * The org_id filter is the privacy boundary: competitors' data is never read.
 */
export async function getOrgHistory(orgId: string, excludeScheduleId?: string): Promise<{ rows: HistoryRow[]; calendars: Record<string, WorkCalendar[]> }> {
  await initSchema()
  const res = await query(`
    SELECT a.schedule_id, s.project_type, s.region, s.gross_sqft, a.category, a.name, a.calendar_id, a.duration,
           a.baseline_start, a.baseline_finish, a.actual_start, a.actual_finish
    FROM activities a JOIN schedules s ON s.id = a.schedule_id
    WHERE s.org_id = $1 AND ($2::text IS NULL OR s.id <> $2) AND s.source_type <> 'generated' AND s.in_history
      AND a.category IS NOT NULL AND a.category <> 'other' AND a.activity_type = 'task'`, [orgId, excludeScheduleId ?? null])
  const cal = await query(`SELECT id, calendars FROM schedules WHERE org_id=$1 AND source_type <> 'generated' AND in_history`, [orgId])
  return {
    rows: res.rows.map(r => ({
      scheduleId: r.schedule_id, projectType: r.project_type, region: r.region, grossSqft: r.gross_sqft != null ? Number(r.gross_sqft) : null,
      category: r.category, name: r.name, calendarId: r.calendar_id, duration: Number(r.duration),
      baselineStart: r.baseline_start, baselineFinish: r.baseline_finish, actualStart: r.actual_start, actualFinish: r.actual_finish,
    })),
    calendars: Object.fromEntries(cal.rows.map(r => [r.id, r.calendars as WorkCalendar[]])),
  }
}

/* ─── Chat ──────────────────────────────────────────── */

export interface ChatMessage {
  id: string; scheduleId: string; userId: string; role: 'user' | 'assistant'; content: string; createdAt: string
}

export async function getChatMessages(scheduleId: string, userId: string): Promise<ChatMessage[]> {
  await initSchema()
  const res = await query('SELECT * FROM chat_messages WHERE schedule_id=$1 AND user_id=$2 ORDER BY created_at ASC', [scheduleId, userId])
  return res.rows.map(row => ({ id: row.id, scheduleId: row.schedule_id, userId: row.user_id, role: row.role, content: row.content, createdAt: row.created_at }))
}

export async function createChatMessage(msg: ChatMessage): Promise<void> {
  await initSchema()
  await query('INSERT INTO chat_messages (id,schedule_id,user_id,role,content,created_at) VALUES ($1,$2,$3,$4,$5,$6)', [msg.id, msg.scheduleId, msg.userId, msg.role, msg.content, msg.createdAt])
}

/* ─── Plans (interview → generated schedule) ────────── */

export interface ExpertReview {
  id: string
  reviewer: string
  verdict: 'approve' | 'approve_with_comments' | 'reject'
  comment: string
  /** Optional per-activity notes: activity id -> note */
  activityNotes?: Record<string, string>
  at: string
  /** Account that recorded the review (for separation-of-duties checks) */
  reviewerUserId?: string
  /** Schedule generation the review applies to (an approval goes stale when the schedule is regenerated) */
  generatedAt?: string
}

export interface PlanDecision { decision: 'accept' | 'fix'; note: string; by: string; at: string }

export interface AuditEntry { at: string; by: string; action: string; detail?: string }

export interface Plan {
  id: string; orgId: string; userId: string; name: string
  answers: Record<string, Answer>
  /** Follow-up questions proposed by the model (validated), asked alongside the rule-based ones */
  extraQuestions: Question[]
  generated: GeneratedSchedule | null
  reviews: ExpertReview[]
  audit: AuditEntry[]
  /** Scheduler decisions on quality findings, e.g. { "dcma:6": { decision: 'accept', note, by, at } } */
  decisions: Record<string, PlanDecision>
  scheduleId: string | null
  createdAt: string; updatedAt: string
  /** Optimistic-locking version; incremented on every save. */
  version: number
}

/** Audit entries already persisted when the plan was loaded (new ones are appended to the audit log on save). */
const loadedAuditLength = new WeakMap<Plan, number>()

const isoTs = (v: unknown) => { const d = v instanceof Date ? v : new Date(String(v)); return isNaN(d.getTime()) ? String(v) : d.toISOString() }

function rowToPlan(r: Record<string, unknown>): Plan {
  return {
    id: r.id as string, orgId: r.org_id as string, userId: r.user_id as string, name: r.name as string,
    answers: (r.answers as Record<string, Answer>) || {}, extraQuestions: (r.extra_questions as Question[]) || [], generated: (r.generated as GeneratedSchedule) || null,
    reviews: (r.reviews as ExpertReview[]) || [], decisions: (r.decisions as Record<string, PlanDecision>) || {}, audit: (r.audit as AuditEntry[]) || [], scheduleId: (r.schedule_id as string) || null,
    createdAt: isoTs(r.created_at), updatedAt: isoTs(r.updated_at), version: Number(r.version ?? 1),
  }
}

function trackPlan(p: Plan): Plan {
  loadedAuditLength.set(p, p.audit.length)
  return p
}

export async function listPlans(orgId: string): Promise<Plan[]> {
  await initSchema()
  const res = await query('SELECT * FROM plans WHERE org_id=$1 ORDER BY updated_at DESC', [orgId])
  return res.rows.map(r => trackPlan(rowToPlan(r)))
}

export async function getPlan(id: string, orgId: string): Promise<Plan | undefined> {
  await initSchema()
  const res = await query('SELECT * FROM plans WHERE id=$1 AND org_id=$2', [id, orgId])
  return res.rows[0] ? trackPlan(rowToPlan(res.rows[0])) : undefined
}

export async function createPlan(p: Pick<Plan, 'id' | 'orgId' | 'userId' | 'name'>): Promise<Plan> {
  await initSchema()
  const res = await query('INSERT INTO plans (id, org_id, user_id, name) VALUES ($1,$2,$3,$4) RETURNING *', [p.id, p.orgId, p.userId, p.name])
  return trackPlan(rowToPlan(res.rows[0]))
}

export class StalePlanError extends Error {
  constructor() { super('Plan was modified concurrently') }
}

/**
 * Saves a plan with optimistic locking (the row must still be at the version that was loaded) and
 * appends any new plan audit entries to the tamper-evident audit log in the same request. The
 * plan's own audit list is a display copy; audit_events is the complete record.
 */
export async function savePlan(p: Plan): Promise<Plan> {
  await initSchema()
  const res = await query(`UPDATE plans SET name=$3, answers=$4, generated=$5, reviews=$6, audit=$7, schedule_id=$8, extra_questions=$9, decisions=$10, updated_at=NOW(), version=version+1
    WHERE id=$1 AND org_id=$2 AND version=$11 RETURNING *`,
    [p.id, p.orgId, p.name, JSON.stringify(p.answers), p.generated ? JSON.stringify(p.generated) : null, JSON.stringify(p.reviews), JSON.stringify(p.audit.slice(-500)), p.scheduleId, JSON.stringify(p.extraQuestions), JSON.stringify(p.decisions || {}), p.version])
  if (!res.rows[0]) {
    const exists = await query('SELECT 1 FROM plans WHERE id=$1 AND org_id=$2', [p.id, p.orgId])
    if (exists.rows[0]) throw new StalePlanError()
    throw new Error('Plan not found')
  }
  const from = loadedAuditLength.get(p) ?? p.audit.length
  const fresh = p.audit.slice(from)
  if (fresh.length) {
    const { appendAudit } = await import('@/lib/server/audit')
    await appendAudit(fresh.map(e => ({
      orgId: p.orgId, action: `plan.${e.action}`, targetType: 'plan', targetId: p.id,
      detail: { plan: p.name, by: e.by, ...(e.detail ? { detail: e.detail } : {}), version: Number(res.rows[0].version) },
    })))
  }
  return trackPlan(rowToPlan(res.rows[0]))
}

export async function deletePlan(id: string, orgId: string): Promise<boolean> {
  await initSchema()
  const res = await query('DELETE FROM plans WHERE id=$1 AND org_id=$2', [id, orgId])
  return (res.rowCount ?? 0) > 0
}

/* ─── Responses to the tool's questions about uploaded data ── */

export interface DataQuestionResponse { questionId: string; response: 'intentional' | 'will_fix' | 'not_an_issue'; note: string | null; userId: string; createdAt: string }

export async function getDataQuestionResponses(scheduleId: string): Promise<DataQuestionResponse[]> {
  await initSchema()
  const res = await query('SELECT * FROM data_question_responses WHERE schedule_id=$1', [scheduleId])
  return res.rows.map(r => ({ questionId: r.question_id, response: r.response, note: r.note, userId: r.user_id, createdAt: String(r.created_at) }))
}

export async function saveDataQuestionResponse(scheduleId: string, r: Omit<DataQuestionResponse, 'createdAt'>): Promise<void> {
  await initSchema()
  await query(`INSERT INTO data_question_responses (schedule_id, question_id, response, note, user_id) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (schedule_id, question_id) DO UPDATE SET response=EXCLUDED.response, note=EXCLUDED.note, user_id=EXCLUDED.user_id, created_at=NOW()`,
    [scheduleId, r.questionId, r.response, r.note, r.userId])
}

/* ─── Privacy: export and deletion ──────────────────── */

export async function getChatMessagesForUser(userId: string): Promise<ChatMessage[]> {
  await initSchema()
  const res = await query('SELECT * FROM chat_messages WHERE user_id=$1 ORDER BY created_at', [userId])
  return res.rows.map(row => ({ id: row.id, scheduleId: row.schedule_id, userId: row.user_id, role: row.role, content: row.content, createdAt: row.created_at }))
}

/** Everything the organization has stored in Planora, as one JSON document (data portability). */
export async function exportOrganization(orgId: string) {
  await initSchema()
  const org = await getOrganization(orgId)
  const members = (await listMembers(orgId)).map(u => ({ id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.createdAt, disabledAt: u.disabledAt, twoStepVerification: !!u.mfaEnabledAt }))
  const plans = await listPlans(orgId)
  const schedules = await getSchedules(orgId)
  const scheduleData = []
  for (const s of schedules) {
    const [activities, relationships, responses, chats] = await Promise.all([
      getActivities(s.id), getRelationships(s.id), getDataQuestionResponses(s.id),
      query('SELECT * FROM chat_messages WHERE schedule_id=$1 ORDER BY created_at', [s.id]).then(r => r.rows.map(m => ({ id: m.id, userId: m.user_id, role: m.role, content: m.content, createdAt: m.created_at }))),
    ])
    scheduleData.push({ ...s, activities, relationships, dataQuestionResponses: responses, askAiMessages: chats })
  }
  const audit = (await query('SELECT * FROM audit_events WHERE org_id=$1 ORDER BY seq', [orgId])).rows
  return { format: 'planora-org-export', formatVersion: 1, exportedAt: new Date().toISOString(), organization: org, members, plans, schedules: scheduleData, auditEvents: audit }
}

/**
 * Deletes an organization and all of its data, including its audit log (the customer's data). A
 * tombstone with the purged chain's final hash is appended to the system audit chain as evidence.
 */
export async function deleteOrganization(orgId: string, actor: { id: string; email: string }): Promise<{ auditEventsPurged: number }> {
  await initSchema()
  const summary = await withTransaction(async q => {
    const counts = (await q(`SELECT (SELECT COUNT(*) FROM plans WHERE org_id=$1)::int AS plans, (SELECT COUNT(*) FROM schedules WHERE org_id=$1)::int AS schedules,
      (SELECT COUNT(*) FROM users WHERE org_id=$1)::int AS members, (SELECT COUNT(*) FROM audit_events WHERE org_id=$1)::int AS audit,
      (SELECT hash FROM audit_events WHERE org_id=$1 ORDER BY seq DESC LIMIT 1) AS last_hash`, [orgId])).rows[0]
    await q(`SELECT set_config('planora.audit_purge', 'on', true)`)
    await q('DELETE FROM audit_events WHERE org_id=$1', [orgId])
    await q('DELETE FROM schedules WHERE org_id=$1', [orgId])
    await q('DELETE FROM plans WHERE org_id=$1', [orgId])
    await q('DELETE FROM invitations WHERE org_id=$1', [orgId])
    await q(`DELETE FROM rate_limits WHERE key LIKE $1`, [`%:org:${orgId}%`])
    await q('DELETE FROM users WHERE org_id=$1', [orgId])
    await q('DELETE FROM organizations WHERE id=$1', [orgId])
    return counts
  })
  const { audit, SYSTEM_ORG } = await import('@/lib/server/audit')
  await audit({ orgId: SYSTEM_ORG, action: 'privacy.organization_deleted', targetType: 'organization', targetId: orgId, actor,
    detail: { plans: summary.plans, schedules: summary.schedules, members: summary.members, auditEventsPurged: summary.audit, purgedChainLastHash: summary.last_hash } })
  return { auditEventsPurged: Number(summary.audit) }
}

/**
 * Erases one person's account. If they are the last member, the whole organization is deleted.
 * Otherwise their projects are reassigned to an owner (the firm keeps its work) and their
 * personal data (account, sessions, Ask AI history) is deleted.
 */
export async function deleteAccountData(userId: string, orgId: string): Promise<{ orgDeleted: boolean; reassignedTo?: string }> {
  await initSchema()
  const members = await listMembers(orgId)
  const me = members.find(m => m.id === userId)
  if (!me) throw new Error('Account not found')
  const others = members.filter(m => m.id !== userId && !m.disabledAt)
  if (!others.length) {
    await deleteOrganization(orgId, { id: userId, email: me.email })
    return { orgDeleted: true }
  }
  const owners = others.filter(m => m.role === 'owner')
  if (me.role === 'owner' && !owners.length) {
    const { ApiError } = await import('@/lib/server/api')
    throw new ApiError(400, 'You are the only owner. Transfer ownership to another member first (Organization → Members).')
  }
  const heir = (owners[0] || others.find(m => m.role === 'admin') || others[0]).id
  await withTransaction(async q => {
    await q('UPDATE plans SET user_id=$2 WHERE user_id=$1', [userId, heir])
    await q('UPDATE schedules SET user_id=$2 WHERE user_id=$1', [userId, heir])
    await q('UPDATE data_question_responses SET user_id=$2 WHERE user_id=$1', [userId, heir])
    await q('DELETE FROM chat_messages WHERE user_id=$1', [userId])
    await q('DELETE FROM users WHERE id=$1', [userId])
  })
  return { orgDeleted: false, reassignedTo: heir }
}
