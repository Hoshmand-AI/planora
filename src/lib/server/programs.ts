// Program master schedules: storage and the read that builds the master (src/lib/analysis/master-schedule.ts).
//
// Every query is bounded by the organization. A program's projects are named by their register key (the update
// series inside its workspace), and each project's uploads are found through getSchedules(), which applies the
// reader's workspace walls: a project the reader may not see is left out of the master, with its items.

import { randomUUID } from 'crypto'
import { getSchedules, initSchema, query, type Schedule } from '@/lib/db'
import { orderSeries } from '@/lib/analysis/compare'
import { registerKey } from './register'
import { currentWorkspaceAccess } from './workspace-scope'
import {
  buildMaster, DEFAULT_DICTIONARY, dictionaryFromSchedules, MAX_PARTY_ITEMS, MAX_PROGRAM_PROJECTS, suggestMapping,
  type ActivityDates, type DictMilestone, type MappedRef, type MasterSchedule, type OwnerForecast, type PartyFields, type PartyItem, type ProjectInput, type UploadRef,
} from '@/lib/analysis/master-schedule'

export interface Program { id: string; name: string; dictionary: DictMilestone[]; createdAt: string; updatedAt: string }
export interface ProgramProject {
  id: string; programId: string; projectKey: string; sector: string | null; location: string | null; contractor: string | null
  mapping: Record<string, MappedRef>; ownerForecasts: Record<string, OwnerForecast>; sort: number
}

const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : '')
const obj = <T,>(v: unknown): Record<string, T> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, T>) : {})

function rowToProgram(r: Record<string, unknown>): Program {
  return { id: String(r.id), name: String(r.name), dictionary: Array.isArray(r.milestones) ? (r.milestones as DictMilestone[]) : [], createdAt: iso(r.created_at), updatedAt: iso(r.updated_at) }
}
function rowToProject(r: Record<string, unknown>): ProgramProject {
  return {
    id: String(r.id), programId: String(r.program_id), projectKey: String(r.project_key), sector: (r.sector as string) ?? null, location: (r.location as string) ?? null,
    contractor: (r.contractor as string) ?? null, mapping: obj<MappedRef>(r.mapping), ownerForecasts: obj<OwnerForecast>(r.owner_forecasts), sort: Number(r.sort ?? 0),
  }
}
function rowToItem(r: Record<string, unknown>): PartyItem {
  return {
    id: String(r.id), projectId: (r.program_project_id as string) ?? null, party: String(r.party), title: String(r.title), needDate: (r.need_date as string) ?? null,
    forecastDate: (r.forecast_date as string) ?? null, actualDate: (r.actual_date as string) ?? null, note: (r.note as string) ?? null,
    milestoneKey: (r.milestone_key as string) ?? null, updatedAt: iso(r.updated_at),
  }
}

/* ─── Programs ───────────────── */

export async function listPrograms(orgId: string): Promise<(Program & { projects: number })[]> {
  await initSchema()
  const res = await query(`SELECT p.*, (SELECT COUNT(*)::int FROM program_projects x WHERE x.org_id=p.org_id AND x.program_id=p.id) AS projects
    FROM programs p WHERE p.org_id=$1 ORDER BY p.created_at`, [orgId])
  return res.rows.map(r => ({ ...rowToProgram(r), projects: Number(r.projects) }))
}

export const MAX_PROGRAMS = 50

export async function createProgram(orgId: string, name: string, by: { userId: string; name: string }): Promise<Program | null> {
  await initSchema()
  const n = await query('SELECT COUNT(*)::int AS n FROM programs WHERE org_id=$1', [orgId])
  if (Number(n.rows[0]?.n ?? 0) >= MAX_PROGRAMS) return null
  const res = await query(`INSERT INTO programs (id, org_id, name, milestones, created_by, created_by_name) VALUES ($1,$2,$3,$4::jsonb,$5,$6) RETURNING *`,
    [randomUUID(), orgId, name, JSON.stringify(DEFAULT_DICTIONARY), by.userId, by.name])
  return rowToProgram(res.rows[0])
}

export async function getProgram(orgId: string, id: string): Promise<Program | undefined> {
  await initSchema()
  const res = await query('SELECT * FROM programs WHERE org_id=$1 AND id=$2', [orgId, id])
  return res.rows[0] ? rowToProgram(res.rows[0]) : undefined
}

export async function updateProgram(orgId: string, id: string, patch: { name?: string; dictionary?: DictMilestone[] }): Promise<Program | undefined> {
  const res = await query(`UPDATE programs SET name=COALESCE($3, name), milestones=COALESCE($4::jsonb, milestones), updated_at=NOW() WHERE org_id=$1 AND id=$2 RETURNING *`,
    [orgId, id, patch.name ?? null, patch.dictionary ? JSON.stringify(patch.dictionary) : null])
  return res.rows[0] ? rowToProgram(res.rows[0]) : undefined
}

export async function deleteProgram(orgId: string, id: string): Promise<boolean> {
  // Projects and items go with it (ON DELETE CASCADE); the projects' schedules are untouched.
  const res = await query('DELETE FROM programs WHERE org_id=$1 AND id=$2', [orgId, id])
  return (res.rowCount ?? 0) > 0
}

/* ─── A program's projects ───────────────── */

export async function listProgramProjects(orgId: string, programId: string): Promise<ProgramProject[]> {
  const res = await query('SELECT * FROM program_projects WHERE org_id=$1 AND program_id=$2 ORDER BY sort, created_at', [orgId, programId])
  return res.rows.map(rowToProject)
}

export async function getProgramProject(orgId: string, programId: string, id: string): Promise<ProgramProject | undefined> {
  const res = await query('SELECT * FROM program_projects WHERE org_id=$1 AND program_id=$2 AND id=$3', [orgId, programId, id])
  return res.rows[0] ? rowToProject(res.rows[0]) : undefined
}

/** Adds a project to a program; 'exists' when it is already there, 'full' at the limit. */
export async function addProgramProject(orgId: string, programId: string, p: { projectKey: string; sector: string | null; location: string | null; contractor: string | null }): Promise<ProgramProject | 'exists' | 'full'> {
  const n = await query('SELECT COUNT(*)::int AS n, COALESCE(MAX(sort), 0)::int AS top FROM program_projects WHERE org_id=$1 AND program_id=$2', [orgId, programId])
  if (Number(n.rows[0]?.n ?? 0) >= MAX_PROGRAM_PROJECTS) return 'full'
  const res = await query(`INSERT INTO program_projects (id, org_id, program_id, project_key, sector, location, contractor, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (org_id, program_id, project_key) DO NOTHING RETURNING *`, [randomUUID(), orgId, programId, p.projectKey, p.sector, p.location, p.contractor, Number(n.rows[0]?.top ?? 0) + 1])
  return res.rows[0] ? rowToProject(res.rows[0]) : 'exists'
}

export async function updateProgramProject(orgId: string, programId: string, id: string, patch: {
  sector?: string | null; location?: string | null; contractor?: string | null; mapping?: Record<string, MappedRef>; ownerForecasts?: Record<string, OwnerForecast>
}): Promise<ProgramProject | undefined> {
  const sets: string[] = ['updated_at=NOW()'], params: unknown[] = [orgId, programId, id]
  const set = (col: string, v: unknown, cast = '') => { params.push(v); sets.push(`${col}=$${params.length}${cast}`) }
  if (patch.sector !== undefined) set('sector', patch.sector)
  if (patch.location !== undefined) set('location', patch.location)
  if (patch.contractor !== undefined) set('contractor', patch.contractor)
  if (patch.mapping !== undefined) set('mapping', JSON.stringify(patch.mapping), '::jsonb')
  if (patch.ownerForecasts !== undefined) set('owner_forecasts', JSON.stringify(patch.ownerForecasts), '::jsonb')
  const res = await query(`UPDATE program_projects SET ${sets.join(', ')} WHERE org_id=$1 AND program_id=$2 AND id=$3 RETURNING *`, params)
  return res.rows[0] ? rowToProject(res.rows[0]) : undefined
}

/** Takes a project out of a program, with the other parties' items filed under it. Its schedules are untouched. */
export async function removeProgramProject(orgId: string, programId: string, id: string): Promise<boolean> {
  const res = await query('DELETE FROM program_projects WHERE org_id=$1 AND program_id=$2 AND id=$3', [orgId, programId, id])
  if (!(res.rowCount ?? 0)) return false
  await query('DELETE FROM program_items WHERE org_id=$1 AND program_id=$2 AND program_project_id=$3', [orgId, programId, id])
  return true
}

/* ─── What other parties owe ───────────────── */

export async function listProgramItems(orgId: string, programId: string): Promise<PartyItem[]> {
  const res = await query(`SELECT * FROM program_items WHERE org_id=$1 AND program_id=$2 ORDER BY created_at LIMIT ${MAX_PARTY_ITEMS}`, [orgId, programId])
  return res.rows.map(rowToItem)
}

export async function createProgramItem(orgId: string, programId: string, f: PartyFields, by: { userId: string; name: string }): Promise<PartyItem | null> {
  const n = await query('SELECT COUNT(*)::int AS n FROM program_items WHERE org_id=$1 AND program_id=$2', [orgId, programId])
  if (Number(n.rows[0]?.n ?? 0) >= MAX_PARTY_ITEMS) return null
  const res = await query(`INSERT INTO program_items (id, org_id, program_id, program_project_id, party, title, need_date, forecast_date, actual_date, note, milestone_key, created_by, created_by_name)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
  [randomUUID(), orgId, programId, f.projectId ?? null, f.party, f.title, f.needDate ?? null, f.forecastDate ?? null, f.actualDate ?? null, f.note ?? null, f.milestoneKey ?? null, by.userId, by.name])
  return rowToItem(res.rows[0])
}

export async function updateProgramItem(orgId: string, programId: string, id: string, f: PartyFields): Promise<PartyItem | undefined> {
  const sets: string[] = ['updated_at=NOW()'], params: unknown[] = [orgId, programId, id]
  const cols: [keyof PartyFields, string][] = [['party', 'party'], ['title', 'title'], ['projectId', 'program_project_id'], ['needDate', 'need_date'], ['forecastDate', 'forecast_date'],
    ['actualDate', 'actual_date'], ['note', 'note'], ['milestoneKey', 'milestone_key']]
  for (const [k, col] of cols) if (f[k] !== undefined) { params.push(f[k]); sets.push(`${col}=$${params.length}`) }
  const res = await query(`UPDATE program_items SET ${sets.join(', ')} WHERE org_id=$1 AND program_id=$2 AND id=$3 RETURNING *`, params)
  return res.rows[0] ? rowToItem(res.rows[0]) : undefined
}

export async function deleteProgramItem(orgId: string, programId: string, id: string): Promise<PartyItem | undefined> {
  const res = await query('DELETE FROM program_items WHERE org_id=$1 AND program_id=$2 AND id=$3 RETURNING *', [orgId, programId, id])
  return res.rows[0] ? rowToItem(res.rows[0]) : undefined
}

/* ─── Reading the master ───────────────── */

const ref = (s: Schedule): UploadRef => ({ id: s.id, version: s.version || 'Upload', dataDate: s.dataDate, uploadedAt: iso(s.uploadedAt) })

/** The reader's projects, by register key: each one's uploads, oldest first. */
async function visibleSeries(orgId: string): Promise<Map<string, Schedule[]>> {
  const groups = new Map<string, Schedule[]>()
  for (const s of await getSchedules(orgId)) {
    const k = registerKey(s)
    groups.set(k, [...(groups.get(k) ?? []), s])
  }
  for (const [k, v] of groups) groups.set(k, orderSeries(v))
  return groups
}

export interface AvailableProject { key: string; name: string; version: string; dataDate: string | null; scheduleId: string }

/** Projects the reader can see that are not in the program yet. */
export async function availableProjects(orgId: string, programId: string): Promise<AvailableProject[]> {
  const [series, inProgram] = await Promise.all([visibleSeries(orgId), listProgramProjects(orgId, programId)])
  const taken = new Set(inProgram.map(p => p.projectKey))
  return [...series.entries()].filter(([k]) => !taken.has(k)).map(([key, s]) => {
    const latest = s[s.length - 1]
    return { key, name: latest.name, version: latest.version || 'Upload', dataDate: latest.dataDate, scheduleId: latest.id }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

/** The register key of a schedule the reader can see, for adding its project to a program. */
export async function projectKeyOfSchedule(orgId: string, scheduleId: string): Promise<string | null> {
  const s = (await getSchedules(orgId)).find(x => x.id === scheduleId)
  return s ? registerKey(s) : null
}

function toDates(r: Record<string, unknown>): ActivityDates {
  return {
    code: String(r.activity_id), name: String(r.name ?? ''), type: String(r.activity_type ?? 'task'),
    milestoneKind: r.milestone_kind === 'start' || r.milestone_kind === 'finish' ? r.milestone_kind : null,
    earlyStart: (r.early_start as string) ?? null, earlyFinish: (r.early_finish as string) ?? null, actualStart: (r.actual_start as string) ?? null, actualFinish: (r.actual_finish as string) ?? null,
    baselineStart: (r.baseline_start as string) ?? null, baselineFinish: (r.baseline_finish as string) ?? null,
    totalFloat: r.total_float == null ? null : Number(r.total_float), isCritical: Boolean(r.is_critical),
  }
}

const ACT_COLS = 'a.schedule_id, a.activity_id, a.name, a.activity_type, a.milestone_kind, a.early_start, a.early_finish, a.actual_start, a.actual_finish, a.baseline_start, a.baseline_finish, a.total_float, a.is_critical'

export interface MasterView {
  program: Program
  master: MasterSchedule
  /** Each project's key and newest upload id, for the page's links and pickers */
  projects: { id: string; key: string; scheduleId: string | null }[]
}

/** The whole master for one program as the reader may see it, on `asOf` (YYYY-MM-DD). */
export async function loadMaster(orgId: string, programId: string, asOf: string): Promise<MasterView | undefined> {
  const program = await getProgram(orgId, programId)
  if (!program) return undefined
  const [members, items, series, access] = await Promise.all([listProgramProjects(orgId, programId), listProgramItems(orgId, programId), visibleSeries(orgId), currentWorkspaceAccess()])
  // A project with no upload the reader can see: shown as "No schedule" to someone who sees every workspace (its
  // uploads were deleted), left out for anyone else (it may be behind a wall).
  const shown = members.filter(m => series.has(m.projectKey) || access.all)

  const keys = shown.map(m => m.projectKey)
  const roles = keys.length ? await query('SELECT project_key, baseline_schedule_id FROM project_schedule_roles WHERE org_id=$1 AND project_key = ANY($2::text[])', [orgId, keys]) : { rows: [] }
  const roleOf = new Map(roles.rows.map(r => [String(r.project_key), (r.baseline_schedule_id as string) ?? null]))

  const picks = shown.map(m => {
    const s = series.get(m.projectKey) ?? []
    const latest = s[s.length - 1] ?? null
    const previous = s.length > 1 ? s[s.length - 2] : null
    const baseId = roleOf.get(m.projectKey) ?? latest?.baselineScheduleId ?? null
    const baseline = (baseId ? s.find(x => x.id === baseId) : undefined) ?? s.find(x => /^baseline$/i.test(x.version || '')) ?? null
    return { m, latest, previous, baseline: baseline && baseline.id !== latest?.id ? baseline : null }
  })

  const scheduleIds = [...new Set(picks.flatMap(p => [p.latest?.id, p.previous?.id, p.baseline?.id]).filter((x): x is string => !!x))]
  const codes = [...new Set(shown.flatMap(m => Object.values(m.mapping).map(r => r.code)))]
  const acts = new Map<string, Record<string, ActivityDates>>()
  if (scheduleIds.length && codes.length) {
    const res = await query(`SELECT ${ACT_COLS} FROM activities a JOIN schedules s ON s.id = a.schedule_id
      WHERE s.org_id=$1 AND a.schedule_id = ANY($2::text[]) AND a.activity_id = ANY($3::text[])`, [orgId, scheduleIds, codes])
    for (const r of res.rows) {
      const sid = String(r.schedule_id)
      if (!acts.has(sid)) acts.set(sid, {})
      // The first row for an activity ID wins; a file that repeats an ID is reported by the import, not here.
      const bucket = acts.get(sid)!
      if (!bucket[String(r.activity_id)]) bucket[String(r.activity_id)] = toDates(r)
    }
  }
  const latestIds = picks.map(p => p.latest?.id).filter((x): x is string => !!x)
  const rejected = new Set<string>()
  if (latestIds.length) {
    const res = await query(`SELECT schedule_id FROM submission_reviews WHERE org_id=$1 AND schedule_id = ANY($2::text[]) AND disposition='revise_and_resubmit'`, [orgId, latestIds])
    for (const r of res.rows) rejected.add(String(r.schedule_id))
  }

  const inputs: ProjectInput[] = picks.map(({ m, latest, previous, baseline }) => ({
    id: m.id, name: latest?.name ?? 'Project with no schedule', sector: m.sector, location: m.location, contractor: m.contractor,
    mapping: m.mapping, ownerForecasts: m.ownerForecasts,
    latest: latest ? ref(latest) : null, previous: previous ? ref(previous) : null, baseline: baseline ? ref(baseline) : null,
    latestRejected: !!latest && rejected.has(latest.id),
    latestActs: latest ? acts.get(latest.id) ?? {} : {}, previousActs: previous ? acts.get(previous.id) ?? {} : {}, baselineActs: baseline ? acts.get(baseline.id) ?? {} : {},
  }))
  return {
    program, master: buildMaster({ dictionary: program.dictionary, projects: inputs, parties: items, asOf }),
    projects: picks.map(p => ({ id: p.m.id, key: p.m.projectKey, scheduleId: p.latest?.id ?? null })),
  }
}

/** The newest upload of a program project, as the reader may see it. */
export async function latestUploadOf(orgId: string, project: ProgramProject): Promise<Schedule | null> {
  const s = (await visibleSeries(orgId)).get(project.projectKey) ?? []
  return s[s.length - 1] ?? null
}

/** Activities of one upload to choose from when mapping a milestone: milestones first, then by name match. */
export async function searchActivities(orgId: string, scheduleId: string, q: string, limit = 40): Promise<ActivityDates[]> {
  const like = `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`
  const res = await query(`SELECT ${ACT_COLS} FROM activities a JOIN schedules s ON s.id = a.schedule_id
    WHERE s.org_id=$1 AND a.schedule_id=$2 AND a.activity_id IS NOT NULL AND ($3 = '%%' OR a.name ILIKE $3 OR a.activity_id ILIKE $3)
    ORDER BY (a.activity_type = 'milestone') DESC, a.early_finish NULLS LAST, a.activity_id LIMIT ${Math.max(1, Math.min(200, limit))}`, [orgId, scheduleId, like])
  return res.rows.map(toDates)
}

/** Every milestone activity of one upload (and, failing that, nothing): the pool a mapping is suggested from. */
export async function milestoneActivities(orgId: string, scheduleId: string): Promise<ActivityDates[]> {
  const res = await query(`SELECT ${ACT_COLS} FROM activities a JOIN schedules s ON s.id = a.schedule_id
    WHERE s.org_id=$1 AND a.schedule_id=$2 AND a.activity_id IS NOT NULL AND a.activity_type = 'milestone' ORDER BY a.early_finish NULLS LAST LIMIT 2000`, [orgId, scheduleId])
  return res.rows.map(toDates)
}

/**
 * Adds the project of one schedule to a program and points the program's milestones at the activities of its
 * newest upload whose names match (the same suggestions a person can accept one by one). Returns what happened.
 */
export async function addProjectWithMapping(orgId: string, program: Program, scheduleId: string, meta: { sector: string | null; location: string | null; contractor: string | null }): Promise<{ project: ProgramProject; name: string; mapped: number } | 'exists' | 'full' | 'unknown'> {
  const schedules = await getSchedules(orgId)
  const schedule = schedules.find(x => x.id === scheduleId)
  if (!schedule) return 'unknown'
  const added = await addProgramProject(orgId, program.id, { projectKey: registerKey(schedule), ...meta })
  if (added === 'exists' || added === 'full') return added
  const latest = await latestUploadOf(orgId, added)
  const found = latest ? suggestMapping(program.dictionary, await milestoneActivities(orgId, latest.id)) : {}
  const mapping = Object.fromEntries(Object.entries(found).map(([k, v]) => [k, { code: v.code, use: v.use }]))
  const project = Object.keys(mapping).length ? (await updateProgramProject(orgId, program.id, added.id, { mapping })) ?? added : added
  return { project, name: (latest ?? schedule).name, mapped: Object.keys(mapping).length }
}

/**
 * A master schedule built from a group of schedules the reader picked: its standard milestones come from the
 * schedules themselves (dictionaryFromSchedules), each project is added and every milestone that matches by name
 * is pointed at its activity. Null at the limit of programs; schedules the reader cannot see are skipped, and
 * 'none' when that leaves nothing.
 */
export async function buildProgramFromSchedules(orgId: string, name: string, scheduleIds: string[], by: { userId: string; name: string }): Promise<{ program: Program; projects: { name: string; mapped: number }[] } | 'none' | null> {
  await initSchema()
  const series = await visibleSeries(orgId)
  const all = await getSchedules(orgId)
  // One entry per project, whichever of its uploads was picked.
  const keys = [...new Set(scheduleIds.map(id => all.find(x => x.id === id)).filter((x): x is Schedule => !!x).map(registerKey))]
  const latest = keys.map(k => { const s = series.get(k) ?? []; return s[s.length - 1] }).filter((x): x is Schedule => !!x)
  // Nothing the reader can see was picked: no empty master schedule is left behind.
  if (!latest.length) return 'none'
  const made = await createProgram(orgId, name, by)
  if (!made) return null
  const perProject = await Promise.all(latest.map(s => milestoneActivities(orgId, s.id)))
  const dictionary = dictionaryFromSchedules(perProject, made.dictionary, () => `m_${randomUUID().slice(0, 8)}`)
  const program = (await updateProgram(orgId, made.id, { dictionary })) ?? made
  const projects: { name: string; mapped: number }[] = []
  for (const s of latest) {
    const r = await addProjectWithMapping(orgId, program, s.id, { sector: null, location: null, contractor: null })
    if (typeof r !== 'string') projects.push({ name: r.name, mapped: r.mapped })
  }
  return { program, projects }
}

/** Everything about programs, for the organization's data export. */
export async function exportPrograms(orgId: string) {
  const [programs, projects, items] = await Promise.all([
    query('SELECT * FROM programs WHERE org_id=$1 ORDER BY created_at', [orgId]),
    query('SELECT * FROM program_projects WHERE org_id=$1 ORDER BY created_at', [orgId]),
    query('SELECT * FROM program_items WHERE org_id=$1 ORDER BY created_at', [orgId]),
  ])
  return { programs: programs.rows, projects: projects.rows, items: items.rows }
}
