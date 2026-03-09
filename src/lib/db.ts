import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
})

export const query = (text: string, params?: unknown[]) => pool.query(text, params)

export async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
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
    CREATE TABLE IF NOT EXISTS relationships (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
      predecessor_id TEXT, successor_id TEXT,
      type TEXT DEFAULT 'FS',
      lag NUMERIC DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)
}

export interface User {
  id: string
  email: string
  name: string
  passwordHash: string
  plan: 'free' | 'pro' | 'enterprise'
  createdAt: string
}

function rowToUser(row: Record<string, string>): User {
  return { id: row.id, email: row.email, name: row.name, passwordHash: row.password_hash, plan: row.plan as User['plan'], createdAt: row.created_at }
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

export async function createUser(user: User): Promise<User> {
  await initSchema()
  await query('INSERT INTO users (id, email, name, password_hash, plan, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [user.id, user.email, user.name, user.passwordHash, user.plan, user.createdAt])
  return user
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

export interface Schedule {
  id: string; userId: string; name: string; version: string
  sourceType: 'p6_xer' | 'ms_xml' | 'pdf'; fileName: string; uploadedAt: string
  activityCount: number; relationshipCount: number; projectStart: string | null
  projectFinish: string | null; dataDate: string | null; varianceDays: number | null
  criticalCount: number; percentComplete: number
}

function rowToSchedule(row: Record<string, unknown>): Schedule {
  return { id: row.id as string, userId: row.user_id as string, name: row.name as string, version: row.version as string, sourceType: row.source_type as Schedule['sourceType'], fileName: row.file_name as string, uploadedAt: row.uploaded_at as string, activityCount: Number(row.activity_count), relationshipCount: Number(row.relationship_count), projectStart: row.project_start as string | null, projectFinish: row.project_finish as string | null, dataDate: row.data_date as string | null, varianceDays: row.variance_days != null ? Number(row.variance_days) : null, criticalCount: Number(row.critical_count), percentComplete: Number(row.percent_complete) }
}

export async function getSchedules(userId: string): Promise<Schedule[]> {
  await initSchema()
  const res = await query('SELECT * FROM schedules WHERE user_id=$1 ORDER BY uploaded_at DESC', [userId])
  return res.rows.map(rowToSchedule)
}

export async function getScheduleById(id: string): Promise<Schedule | undefined> {
  await initSchema()
  const res = await query('SELECT * FROM schedules WHERE id=$1', [id])
  return res.rows[0] ? rowToSchedule(res.rows[0]) : undefined
}

export async function createSchedule(s: Schedule): Promise<Schedule> {
  await initSchema()
  await query(`INSERT INTO schedules (id,user_id,name,version,source_type,file_name,uploaded_at,activity_count,relationship_count,project_start,project_finish,data_date,variance_days,critical_count,percent_complete) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [s.id, s.userId, s.name, s.version, s.sourceType, s.fileName, s.uploadedAt, s.activityCount, s.relationshipCount, s.projectStart, s.projectFinish, s.dataDate, s.varianceDays, s.criticalCount, s.percentComplete])
  return s
}

export interface Activity {
  id: string; scheduleId: string; activityId: string; name: string; wbs: string
  duration: number; remainingDuration: number; percentComplete: number
  earlyStart: string | null; earlyFinish: string | null; lateStart: string | null; lateFinish: string | null
  actualStart: string | null; actualFinish: string | null; baselineStart: string | null; baselineFinish: string | null
  totalFloat: number; freeFloat: number; isCritical: boolean
  status: 'not_started' | 'in_progress' | 'complete'; activityType: 'task' | 'milestone' | 'loe' | 'summary'
}

function rowToActivity(row: Record<string, unknown>): Activity {
  return { id: row.id as string, scheduleId: row.schedule_id as string, activityId: row.activity_id as string, name: row.name as string, wbs: row.wbs as string, duration: Number(row.duration), remainingDuration: Number(row.remaining_duration), percentComplete: Number(row.percent_complete), earlyStart: row.early_start as string | null, earlyFinish: row.early_finish as string | null, lateStart: row.late_start as string | null, lateFinish: row.late_finish as string | null, actualStart: row.actual_start as string | null, actualFinish: row.actual_finish as string | null, baselineStart: row.baseline_start as string | null, baselineFinish: row.baseline_finish as string | null, totalFloat: Number(row.total_float), freeFloat: Number(row.free_float), isCritical: Boolean(row.is_critical), status: row.status as Activity['status'], activityType: row.activity_type as Activity['activityType'] }
}

export async function getActivities(scheduleId: string): Promise<Activity[]> {
  await initSchema()
  const res = await query('SELECT * FROM activities WHERE schedule_id=$1', [scheduleId])
  return res.rows.map(rowToActivity)
}

export async function createActivities(activities: Activity[]): Promise<void> {
  await initSchema()
  for (const a of activities) {
    await query(`INSERT INTO activities (id,schedule_id,activity_id,name,wbs,duration,remaining_duration,percent_complete,early_start,early_finish,late_start,late_finish,actual_start,actual_finish,baseline_start,baseline_finish,total_float,free_float,is_critical,status,activity_type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) ON CONFLICT (id) DO NOTHING`, [a.id, a.scheduleId, a.activityId, a.name, a.wbs, a.duration, a.remainingDuration, a.percentComplete, a.earlyStart, a.earlyFinish, a.lateStart, a.lateFinish, a.actualStart, a.actualFinish, a.baselineStart, a.baselineFinish, a.totalFloat, a.freeFloat, a.isCritical, a.status, a.activityType])
  }
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
  for (const r of rels) {
    await query(`INSERT INTO relationships (id,schedule_id,predecessor_id,successor_id,type,lag) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`, [r.id, r.scheduleId, r.predecessorId, r.successorId, r.type, r.lag])
  }
}

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
