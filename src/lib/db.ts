import { Pool } from 'pg'
import type { Answer, GeneratedSchedule, Question, WorkCalendar } from '@/lib/planning/types'

// Tenancy: every firm is an organization. All schedule, plan, and history data is keyed by org_id,
// and every read of firm data filters on org_id — there is no query path that reads across orgs.

const connectionString = process.env.DATABASE_URL
const isLocalDb = !!connectionString && /@(localhost|127\.0\.0\.1|\[::1\]|[^/]*\.local)(:\d+)?\//.test(connectionString)

const pool = new Pool({
  connectionString,
  // Neon requires TLS; local/on-prem Postgres (air-gapped installs) usually doesn't.
  ssl: isLocalDb || process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
  max: 10,
})

export const query = (text: string, params?: unknown[]) => pool.query(text, params)

let schemaReady: Promise<void> | null = null

export function initSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = createSchema().catch(err => { schemaReady = null; throw err })
  }
  return schemaReady
}

async function createSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      version TEXT,
      source_type TEXT,
      file_name TEXT,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      activity_count INTEGER DEFAULT 0,
      relationship_count INTEGER DEFAULT 0,
      project_start TEXT,
      project_finish TEXT,
      data_date TEXT,
      variance_days INTEGER,
      critical_count INTEGER DEFAULT 0,
      percent_complete NUMERIC DEFAULT 0
    );
    ALTER TABLE schedules ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
    ALTER TABLE schedules ADD COLUMN IF NOT EXISTS calendars JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE schedules ADD COLUMN IF NOT EXISTS default_calendar_id TEXT;
    ALTER TABLE schedules ADD COLUMN IF NOT EXISTS warnings JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE schedules ADD COLUMN IF NOT EXISTS plan_id TEXT;
    ALTER TABLE schedules ADD COLUMN IF NOT EXISTS project_type TEXT;
    ALTER TABLE schedules ADD COLUMN IF NOT EXISTS region TEXT;
    ALTER TABLE schedules ADD COLUMN IF NOT EXISTS gross_sqft NUMERIC;
    CREATE INDEX IF NOT EXISTS schedules_org_idx ON schedules(org_id);
    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
      activity_id TEXT,
      name TEXT,
      wbs TEXT,
      duration NUMERIC DEFAULT 0,
      remaining_duration NUMERIC DEFAULT 0,
      percent_complete NUMERIC DEFAULT 0,
      early_start TEXT, early_finish TEXT,
      late_start TEXT, late_finish TEXT,
      actual_start TEXT, actual_finish TEXT,
      baseline_start TEXT, baseline_finish TEXT,
      total_float NUMERIC DEFAULT 0,
      free_float NUMERIC DEFAULT 0,
      is_critical BOOLEAN DEFAULT false,
      status TEXT DEFAULT 'not_started',
      activity_type TEXT DEFAULT 'task'
    );
    ALTER TABLE activities ADD COLUMN IF NOT EXISTS calendar_id TEXT;
    ALTER TABLE activities ADD COLUMN IF NOT EXISTS constraint_type TEXT;
    ALTER TABLE activities ADD COLUMN IF NOT EXISTS constraint_date TEXT;
    ALTER TABLE activities ADD COLUMN IF NOT EXISTS category TEXT;
    ALTER TABLE activities ADD COLUMN IF NOT EXISTS source_id TEXT;
    CREATE INDEX IF NOT EXISTS activities_schedule_idx ON activities(schedule_id);
    CREATE TABLE IF NOT EXISTS relationships (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
      predecessor_id TEXT, successor_id TEXT,
      type TEXT DEFAULT 'FS',
      lag NUMERIC DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS relationships_schedule_idx ON relationships(schedule_id);
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      answers JSONB NOT NULL DEFAULT '{}',
      generated JSONB,
      reviews JSONB NOT NULL DEFAULT '[]',
      audit JSONB NOT NULL DEFAULT '[]',
      schedule_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS extra_questions JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS decisions JSONB NOT NULL DEFAULT '{}';
    CREATE INDEX IF NOT EXISTS plans_org_idx ON plans(org_id);
    CREATE TABLE IF NOT EXISTS data_question_responses (
      schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
      question_id TEXT NOT NULL,
      response TEXT NOT NULL,
      note TEXT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (schedule_id, question_id)
    );
  `)
  // Backfill: legacy users (pre-tenancy) each get their own organization.
  await pool.query(`
    INSERT INTO organizations (id, name)
      SELECT 'org_' || u.id, u.name FROM users u WHERE u.org_id IS NULL
      ON CONFLICT (id) DO NOTHING;
    UPDATE users SET org_id = 'org_' || id WHERE org_id IS NULL;
    UPDATE schedules s SET org_id = u.org_id FROM users u WHERE s.user_id = u.id AND s.org_id IS NULL;
  `)
}

/* ─── Organizations & users ─────────────────────────── */

export interface User {
  id: string
  email: string
  name: string
  passwordHash: string
  plan: 'free' | 'pro' | 'enterprise'
  createdAt: string
  orgId: string
}

function rowToUser(row: Record<string, string>): User {
  return { id: row.id, email: row.email, name: row.name, passwordHash: row.password_hash, plan: row.plan as User['plan'], createdAt: row.created_at, orgId: row.org_id }
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

/** Creates the user and, unless joining an existing org, a new private organization for their firm. */
export async function createUser(user: Omit<User, 'orgId'> & { orgId?: string; orgName?: string }): Promise<User> {
  await initSchema()
  const orgId = user.orgId || `org_${user.id}`
  if (!user.orgId) {
    await query('INSERT INTO organizations (id, name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING', [orgId, user.orgName || user.name])
  }
  await query('INSERT INTO users (id, email, name, password_hash, plan, created_at, org_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', [user.id, user.email, user.name, user.passwordHash, user.plan, user.createdAt, orgId])
  return { ...user, orgId }
}

export async function getOrganization(id: string): Promise<{ id: string; name: string } | undefined> {
  await initSchema()
  const res = await query('SELECT id, name FROM organizations WHERE id=$1', [id])
  return res.rows[0]
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
  await query(`INSERT INTO schedules (id,user_id,org_id,name,version,source_type,file_name,uploaded_at,activity_count,relationship_count,project_start,project_finish,data_date,variance_days,critical_count,percent_complete,calendars,default_calendar_id,warnings,plan_id,project_type,region,gross_sqft)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
    [s.id, s.userId, s.orgId, s.name, s.version, s.sourceType, s.fileName, s.uploadedAt, s.activityCount, s.relationshipCount, s.projectStart, s.projectFinish, s.dataDate, s.varianceDays, s.criticalCount, s.percentComplete,
      JSON.stringify(s.calendars), s.defaultCalendarId, JSON.stringify(s.warnings), s.planId, s.projectType, s.region, s.grossSqft])
  return s
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

export async function createActivities(activities: Activity[]): Promise<void> {
  await initSchema()
  await bulkInsert('activities',
    ['id', 'schedule_id', 'activity_id', 'name', 'wbs', 'duration', 'remaining_duration', 'percent_complete', 'early_start', 'early_finish', 'late_start', 'late_finish', 'actual_start', 'actual_finish', 'baseline_start', 'baseline_finish', 'total_float', 'free_float', 'is_critical', 'status', 'activity_type', 'calendar_id', 'constraint_type', 'constraint_date', 'category', 'source_id'],
    activities.map(a => [a.id, a.scheduleId, a.activityId, a.name, a.wbs, a.duration, a.remainingDuration, a.percentComplete, a.earlyStart, a.earlyFinish, a.lateStart, a.lateFinish, a.actualStart, a.actualFinish, a.baselineStart, a.baselineFinish, a.totalFloat, a.freeFloat, a.isCritical, a.status, a.activityType, a.calendarId ?? null, a.constraintType ?? null, a.constraintDate ?? null, a.category ?? null, a.sourceId ?? null]))
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
    WHERE s.org_id = $1 AND ($2::text IS NULL OR s.id <> $2) AND s.source_type <> 'generated'
      AND a.category IS NOT NULL AND a.category <> 'other' AND a.activity_type = 'task'`, [orgId, excludeScheduleId ?? null])
  const cal = await query(`SELECT id, calendars FROM schedules WHERE org_id=$1 AND source_type <> 'generated'`, [orgId])
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
}

function rowToPlan(r: Record<string, unknown>): Plan {
  return {
    id: r.id as string, orgId: r.org_id as string, userId: r.user_id as string, name: r.name as string,
    answers: (r.answers as Record<string, Answer>) || {}, extraQuestions: (r.extra_questions as Question[]) || [], generated: (r.generated as GeneratedSchedule) || null,
    reviews: (r.reviews as ExpertReview[]) || [], decisions: (r.decisions as Record<string, PlanDecision>) || {}, audit: (r.audit as AuditEntry[]) || [], scheduleId: (r.schedule_id as string) || null,
    createdAt: String(r.created_at), updatedAt: String(r.updated_at),
  }
}

export async function listPlans(orgId: string): Promise<Plan[]> {
  await initSchema()
  const res = await query('SELECT * FROM plans WHERE org_id=$1 ORDER BY updated_at DESC', [orgId])
  return res.rows.map(rowToPlan)
}

export async function getPlan(id: string, orgId: string): Promise<Plan | undefined> {
  await initSchema()
  const res = await query('SELECT * FROM plans WHERE id=$1 AND org_id=$2', [id, orgId])
  return res.rows[0] ? rowToPlan(res.rows[0]) : undefined
}

export async function createPlan(p: Pick<Plan, 'id' | 'orgId' | 'userId' | 'name'>): Promise<Plan> {
  await initSchema()
  const res = await query('INSERT INTO plans (id, org_id, user_id, name) VALUES ($1,$2,$3,$4) RETURNING *', [p.id, p.orgId, p.userId, p.name])
  return rowToPlan(res.rows[0])
}

export async function savePlan(p: Plan): Promise<Plan> {
  await initSchema()
  const res = await query(`UPDATE plans SET name=$3, answers=$4, generated=$5, reviews=$6, audit=$7, schedule_id=$8, extra_questions=$9, decisions=$10, updated_at=NOW()
    WHERE id=$1 AND org_id=$2 RETURNING *`,
    [p.id, p.orgId, p.name, JSON.stringify(p.answers), p.generated ? JSON.stringify(p.generated) : null, JSON.stringify(p.reviews), JSON.stringify(p.audit.slice(-500)), p.scheduleId, JSON.stringify(p.extraQuestions), JSON.stringify(p.decisions || {})])
  if (!res.rows[0]) throw new Error('Plan not found')
  return rowToPlan(res.rows[0])
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
