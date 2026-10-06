// Matter / engagement workspaces (ethical walls) inside an organization.
//
// A workspace groups schedules and plans for one client matter or engagement. Two controls:
//   • a workspace can be WALLED: only its members (and owners/admins) see its schedules and plans;
//   • a member can be RESTRICTED: they see only the schedules and plans of their own workspaces.
// The rules are in workspace-scope.ts; api() resolves each caller's access once per request and the
// scoped reads in src/lib/db.ts apply it to every schedule and plan query.

import { randomUUID } from 'crypto'
import { initSchema, query, withTransaction } from '@/lib/db'
import type { AuthContext } from '@/lib/auth'
import type { WorkspaceAccess } from './context'
import { canSeeWorkspace, FULL_ACCESS, SEES_ALL_ROLES } from './workspace-scope'
import { ApiError } from './api'

export interface Workspace {
  id: string; orgId: string; name: string; walled: boolean; createdBy: string | null; createdAt: string
  memberIds: string[]; scheduleCount: number; planCount: number
}

/** Loads a caller's workspace access (one query). Owners and admins see everything. */
export async function resolveWorkspaceAccess(auth: Pick<AuthContext, 'userId' | 'orgId' | 'role'>): Promise<WorkspaceAccess> {
  if (SEES_ALL_ROLES.has(auth.role)) return FULL_ACCESS
  await initSchema()
  const res = await query(`SELECT
      COALESCE((SELECT workspace_restricted FROM users WHERE id=$1 AND org_id=$2), FALSE) AS restricted,
      ARRAY(SELECT workspace_id FROM workspace_members WHERE user_id=$1 AND org_id=$2) AS member_of,
      ARRAY(SELECT id FROM workspaces WHERE org_id=$2 AND walled) AS walled`, [auth.userId, auth.orgId])
  const r = res.rows[0] || {}
  return { all: false, restricted: r.restricted === true, memberOf: (r.member_of as string[]) || [], walled: (r.walled as string[]) || [] }
}

const rowToWorkspace = (r: Record<string, unknown>): Workspace => ({
  id: String(r.id), orgId: String(r.org_id), name: String(r.name), walled: r.walled === true,
  createdBy: (r.created_by as string) ?? null, createdAt: new Date(r.created_at as string).toISOString(),
  memberIds: (r.member_ids as string[]) || [], scheduleCount: Number(r.schedule_count ?? 0), planCount: Number(r.plan_count ?? 0),
})

/** Every workspace in the organization (admin view), with members and item counts. */
export async function listWorkspaces(orgId: string): Promise<Workspace[]> {
  await initSchema()
  const res = await query(`SELECT w.*,
      ARRAY(SELECT user_id FROM workspace_members m WHERE m.workspace_id=w.id) AS member_ids,
      (SELECT COUNT(*)::int FROM schedules s WHERE s.org_id=w.org_id AND s.workspace_id=w.id) AS schedule_count,
      (SELECT COUNT(*)::int FROM plans p WHERE p.org_id=w.org_id AND p.workspace_id=w.id) AS plan_count
    FROM workspaces w WHERE w.org_id=$1 ORDER BY LOWER(w.name)`, [orgId])
  return res.rows.map(rowToWorkspace)
}

/** The workspaces this caller can see (for pickers); members' ids and counts are left out. */
export async function visibleWorkspaces(orgId: string, access: WorkspaceAccess): Promise<Pick<Workspace, 'id' | 'name' | 'walled'>[]> {
  const all = await listWorkspaces(orgId)
  return all.filter(w => canSeeWorkspace(access, w.id)).map(w => ({ id: w.id, name: w.name, walled: w.walled }))
}

export async function getWorkspace(orgId: string, id: string): Promise<Workspace | undefined> {
  return (await listWorkspaces(orgId)).find(w => w.id === id)
}

export function cleanWorkspaceName(name: unknown): string {
  const n = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, 120) : ''
  if (!n) throw new ApiError(400, 'Give the workspace a name.')
  return n
}

export async function createWorkspace(orgId: string, input: { name: string; walled: boolean; createdBy: string }): Promise<Workspace> {
  await initSchema()
  const name = cleanWorkspaceName(input.name)
  const dup = await query('SELECT 1 FROM workspaces WHERE org_id=$1 AND LOWER(name)=LOWER($2)', [orgId, name])
  if (dup.rows[0]) throw new ApiError(409, 'A workspace with that name already exists.')
  const id = `ws_${randomUUID()}`
  await query('INSERT INTO workspaces (id, org_id, name, walled, created_by) VALUES ($1,$2,$3,$4,$5)', [id, orgId, name, input.walled, input.createdBy])
  return (await getWorkspace(orgId, id))!
}

export async function updateWorkspace(orgId: string, id: string, patch: { name?: string; walled?: boolean }): Promise<{ before: Workspace; after: Workspace }> {
  const before = await getWorkspace(orgId, id)
  if (!before) throw new ApiError(404, 'Workspace not found.')
  const name = patch.name !== undefined ? cleanWorkspaceName(patch.name) : before.name
  if (name.toLowerCase() !== before.name.toLowerCase()) {
    const dup = await query('SELECT 1 FROM workspaces WHERE org_id=$1 AND LOWER(name)=LOWER($2) AND id<>$3', [orgId, name, id])
    if (dup.rows[0]) throw new ApiError(409, 'A workspace with that name already exists.')
  }
  await query('UPDATE workspaces SET name=$3, walled=$4 WHERE id=$1 AND org_id=$2', [id, orgId, name, patch.walled ?? before.walled])
  return { before, after: (await getWorkspace(orgId, id))! }
}

/**
 * Deletes an empty workspace. A workspace that still holds schedules or plans can't be deleted: its
 * items would silently become organization-wide and the wall would disappear. Move them first.
 */
export async function deleteWorkspace(orgId: string, id: string): Promise<Workspace> {
  const ws = await getWorkspace(orgId, id)
  if (!ws) throw new ApiError(404, 'Workspace not found.')
  if (ws.scheduleCount || ws.planCount) throw new ApiError(409, `This workspace still holds ${ws.scheduleCount} schedule(s) and ${ws.planCount} plan(s). Move them to another workspace first.`, 'workspace_not_empty')
  await query('DELETE FROM workspaces WHERE id=$1 AND org_id=$2', [id, orgId])
  return ws
}

async function memberOfOrg(orgId: string, userId: string): Promise<{ id: string; email: string; role: string }> {
  const res = await query('SELECT id, email, role FROM users WHERE id=$1 AND org_id=$2 AND disabled_at IS NULL', [userId, orgId])
  if (!res.rows[0]) throw new ApiError(404, 'Member not found.')
  return { id: String(res.rows[0].id), email: String(res.rows[0].email), role: String(res.rows[0].role) }
}

export async function addWorkspaceMember(orgId: string, workspaceId: string, userId: string, addedBy: string) {
  const ws = await getWorkspace(orgId, workspaceId)
  if (!ws) throw new ApiError(404, 'Workspace not found.')
  const user = await memberOfOrg(orgId, userId)
  await query('INSERT INTO workspace_members (workspace_id, user_id, org_id, added_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [workspaceId, user.id, orgId, addedBy])
  return { workspace: ws, user }
}

export async function removeWorkspaceMember(orgId: string, workspaceId: string, userId: string) {
  const ws = await getWorkspace(orgId, workspaceId)
  if (!ws) throw new ApiError(404, 'Workspace not found.')
  const res = await query('DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 AND org_id=$3 RETURNING user_id', [workspaceId, userId, orgId])
  if (!res.rows[0]) throw new ApiError(404, 'That person is not a member of this workspace.')
  const user = await query('SELECT email FROM users WHERE id=$1', [userId])
  return { workspace: ws, email: (user.rows[0]?.email as string) ?? null }
}

export async function setMemberRestricted(orgId: string, userId: string, restricted: boolean) {
  const user = await memberOfOrg(orgId, userId)
  // Owners and admins see every workspace regardless; refuse rather than imply a wall that isn't there.
  if (restricted && SEES_ALL_ROLES.has(user.role)) throw new ApiError(400, 'Owners and admins always see every workspace. Change their role first to restrict them.')
  const before = await query('SELECT workspace_restricted FROM users WHERE id=$1', [user.id])
  await query('UPDATE users SET workspace_restricted=$2 WHERE id=$1 AND org_id=$3', [user.id, restricted, orgId])
  return { user, before: before.rows[0]?.workspace_restricted === true, after: restricted }
}

export async function restrictedMemberIds(orgId: string): Promise<string[]> {
  await initSchema()
  const res = await query('SELECT id FROM users WHERE org_id=$1 AND workspace_restricted', [orgId])
  return res.rows.map(r => String(r.id))
}

/**
 * Moves a schedule (with every upload in its update series, so comparisons never straddle a wall)
 * or a plan (with the schedules published from it) into a workspace, or back to organization-wide
 * with null. Returns what moved.
 */
export async function assignToWorkspace(orgId: string, item: { type: 'schedule' | 'plan'; id: string }, workspaceId: string | null): Promise<{ name: string; before: string | null; schedules: number; plans: number }> {
  if (workspaceId && !(await getWorkspace(orgId, workspaceId))) throw new ApiError(404, 'Workspace not found.')
  return withTransaction(async q => {
    if (item.type === 'schedule') {
      const cur = await q('SELECT id, name, project_key, workspace_id FROM schedules WHERE id=$1 AND org_id=$2 FOR UPDATE', [item.id, orgId])
      const s = cur.rows[0]
      if (!s) throw new ApiError(404, 'Schedule not found.')
      const moved = s.project_key
        ? await q(`UPDATE schedules SET workspace_id=$3 WHERE org_id=$1 AND (id=$2 OR (project_key=$4 AND source_type <> 'generated'))`, [orgId, s.id, workspaceId, s.project_key])
        : await q('UPDATE schedules SET workspace_id=$3 WHERE org_id=$1 AND id=$2', [orgId, s.id, workspaceId])
      return { name: String(s.name), before: (s.workspace_id as string) ?? null, schedules: moved.rowCount ?? 0, plans: 0 }
    }
    const cur = await q('SELECT id, name, workspace_id FROM plans WHERE id=$1 AND org_id=$2 FOR UPDATE', [item.id, orgId])
    const p = cur.rows[0]
    if (!p) throw new ApiError(404, 'Plan not found.')
    await q('UPDATE plans SET workspace_id=$3 WHERE org_id=$1 AND id=$2', [orgId, p.id, workspaceId])
    const moved = await q('UPDATE schedules SET workspace_id=$3 WHERE org_id=$1 AND plan_id=$2', [orgId, p.id, workspaceId])
    return { name: String(p.name), before: (p.workspace_id as string) ?? null, schedules: moved.rowCount ?? 0, plans: 1 }
  })
}

/**
 * The workspace a new schedule or plan goes into. An explicit choice must be a workspace the caller
 * can see. Without one, a restricted member's item goes into their only workspace (they must pick
 * when they have several), so nobody creates something they then can't see; everyone else creates
 * organization-wide items.
 */
export async function workspaceForNewItem(orgId: string, access: WorkspaceAccess, requested: unknown): Promise<string | null> {
  const id = typeof requested === 'string' && requested.trim() ? requested.trim() : null
  if (id) {
    const ws = await getWorkspace(orgId, id)
    if (!ws || !canSeeWorkspace(access, ws.id)) throw new ApiError(404, 'Workspace not found.', 'workspace_not_found')
    return ws.id
  }
  if (!access.all && access.restricted) {
    if (access.memberOf.length === 1) return access.memberOf[0]
    throw new ApiError(400, access.memberOf.length
      ? 'Pick the workspace this belongs to (workspaceId).'
      : 'You are limited to specific workspaces but are not a member of any yet. Ask an admin to add you to one.', 'workspace_required')
  }
  return null
}
