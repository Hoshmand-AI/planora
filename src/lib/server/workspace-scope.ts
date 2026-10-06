// Workspace (matter / engagement) visibility rules — the pure part, with no database access, so the
// rules can be unit-tested and reused by src/lib/db.ts (which applies them to every schedule and
// plan read) and by src/lib/server/workspaces.ts (which resolves a caller's access).
//
// Rules ("ethical walls"):
//   • Owners and admins see everything in their organization.
//   • A RESTRICTED member sees only items in workspaces they belong to (not organization-wide items,
//     not other workspaces).
//   • Any other member sees organization-wide items (no workspace) and items in open workspaces, but
//     never items in a WALLED workspace they do not belong to.
//   • API keys are not members of any workspace: they never see walled workspaces.

import { currentRequest, type WorkspaceAccess } from './context'

export const FULL_ACCESS: WorkspaceAccess = { all: true }
/** Access that sees nothing workspace-scoped and nothing organization-wide (fail closed). */
export const NO_ACCESS: WorkspaceAccess = { all: false, restricted: true, memberOf: [], walled: [] }

/** Roles that see every workspace in their organization. */
export const SEES_ALL_ROLES = new Set(['owner', 'admin'])

/** Workspaces a non-full caller is kept out of (walled and not a member). */
export function deniedWorkspaces(access: Extract<WorkspaceAccess, { all: false }>): string[] {
  const mine = new Set(access.memberOf)
  return access.walled.filter(w => !mine.has(w))
}

/**
 * SQL condition restricting `column` (a schedules/plans workspace_id column) to what the caller may
 * see, with its bind parameters numbered from `firstParam`. Empty sql = no restriction.
 */
export function workspaceClause(access: WorkspaceAccess, column: string, firstParam: number): { sql: string; params: unknown[] } {
  if (access.all) return { sql: '', params: [] }
  if (access.restricted) return { sql: `${column} = ANY($${firstParam}::text[])`, params: [access.memberOf] }
  const denied = deniedWorkspaces(access)
  if (!denied.length) return { sql: '', params: [] }
  return { sql: `(${column} IS NULL OR NOT (${column} = ANY($${firstParam}::text[])))`, params: [denied] }
}

/** The same rule in code, for one item. */
export function canSeeWorkspace(access: WorkspaceAccess, workspaceId: string | null | undefined): boolean {
  if (access.all) return true
  if (access.restricted) return !!workspaceId && access.memberOf.includes(workspaceId)
  return !workspaceId || !deniedWorkspaces(access).includes(workspaceId)
}

/**
 * The current caller's workspace access. Inside an authenticated API request (api()) it is the
 * caller's resolved access; inside any other request (publicApi routes) it fails closed; outside a
 * request (maintenance jobs, scripts, unit tests of pure code) there is no caller, so no restriction.
 */
export async function currentWorkspaceAccess(): Promise<WorkspaceAccess> {
  const r = currentRequest()
  if (!r) return FULL_ACCESS
  return r.workspaceAccess ? r.workspaceAccess() : NO_ACCESS
}
