import { api, json, body, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { can } from '@/lib/server/permissions'
import { getSchedules, listPlans } from '@/lib/db'
import { currentWorkspaceAccess } from '@/lib/server/workspace-scope'
import {
  addWorkspaceMember, assignToWorkspace, createWorkspace, deleteWorkspace, listWorkspaces, removeWorkspaceMember,
  restrictedMemberIds, setMemberRestricted, updateWorkspace, visibleWorkspaces,
} from '@/lib/server/workspaces'

/**
 * Matter / engagement workspaces (ethical walls).
 * Every member gets the workspaces they can see (for choosing where a new plan or upload goes).
 * Owners and admins also get each workspace's members, the restricted members and every schedule and
 * plan with its workspace, for the Organization → Workspaces screen.
 */
export const GET = api({ permission: 'read' }, async (_req, { auth }) => {
  const access = await currentWorkspaceAccess()
  if (!can(auth.role, 'org.manage')) {
    return json({
      workspaces: await visibleWorkspaces(auth.orgId, access),
      you: { restricted: !access.all && access.restricted },
    })
  }
  const [workspaces, restricted, schedules, plans] = await Promise.all([
    listWorkspaces(auth.orgId), restrictedMemberIds(auth.orgId), getSchedules(auth.orgId), listPlans(auth.orgId),
  ])
  return json({
    workspaces, restrictedMemberIds: restricted, you: { restricted: false },
    items: {
      // Uploads of one project move together, so list one row per update series.
      schedules: dedupeSeries(schedules.filter(s => s.sourceType !== 'generated')).map(s => ({ id: s.id, name: s.name, version: s.version, workspaceId: s.workspaceId ?? null })),
      plans: plans.map(p => ({ id: p.id, name: p.name, workspaceId: p.workspaceId ?? null })),
    },
  })
})

function dedupeSeries<T extends { projectKey?: string | null; id: string }>(rows: T[]): T[] {
  const seen = new Set<string>()
  return rows.filter(r => { const k = r.projectKey || r.id; if (seen.has(k)) return false; seen.add(k); return true })
}

type Body = {
  action?: string; workspaceId?: string | null; name?: string; walled?: boolean; userId?: string; restricted?: boolean
  itemType?: string; itemId?: string
}

/** Workspace administration (owners and admins). Every change is in the audit log. */
export const POST = api({ permission: 'org.manage' }, async (req, { auth }) => {
  const b = await body<Body>(req)
  const wsId = typeof b.workspaceId === 'string' ? b.workspaceId : ''
  switch (b.action) {
    case 'create': {
      const ws = await createWorkspace(auth.orgId, { name: String(b.name ?? ''), walled: b.walled === true, createdBy: auth.userId })
      await audit({ action: 'workspace.created', targetType: 'workspace', targetId: ws.id, detail: { name: ws.name, walled: ws.walled } })
      return json({ workspace: ws })
    }
    case 'update': {
      const { before, after } = await updateWorkspace(auth.orgId, wsId, { name: b.name, walled: typeof b.walled === 'boolean' ? b.walled : undefined })
      await audit({ action: 'workspace.updated', targetType: 'workspace', targetId: after.id, detail: { before: { name: before.name, walled: before.walled }, after: { name: after.name, walled: after.walled } } })
      return json({ workspace: after })
    }
    case 'delete': {
      const ws = await deleteWorkspace(auth.orgId, wsId)
      await audit({ action: 'workspace.deleted', targetType: 'workspace', targetId: ws.id, detail: { name: ws.name } })
      return json({ success: true })
    }
    case 'add_member': {
      const r = await addWorkspaceMember(auth.orgId, wsId, String(b.userId ?? ''), auth.userId)
      await audit({ action: 'workspace.member_added', targetType: 'workspace', targetId: r.workspace.id, detail: { workspace: r.workspace.name, userId: r.user.id, email: r.user.email } })
      return json({ success: true })
    }
    case 'remove_member': {
      const r = await removeWorkspaceMember(auth.orgId, wsId, String(b.userId ?? ''))
      await audit({ action: 'workspace.member_removed', targetType: 'workspace', targetId: r.workspace.id, detail: { workspace: r.workspace.name, userId: String(b.userId), email: r.email } })
      return json({ success: true })
    }
    case 'set_restricted': {
      if (typeof b.restricted !== 'boolean') throw new ApiError(400, 'restricted (true or false) required.')
      const r = await setMemberRestricted(auth.orgId, String(b.userId ?? ''), b.restricted)
      if (r.before !== r.after) await audit({ action: 'workspace.member_restriction_changed', targetType: 'user', targetId: r.user.id, detail: { email: r.user.email, before: r.before, after: r.after } })
      return json({ success: true })
    }
    case 'assign': {
      if (b.itemType !== 'schedule' && b.itemType !== 'plan') throw new ApiError(400, 'itemType must be schedule or plan.')
      if (!b.itemId) throw new ApiError(400, 'itemId required.')
      const target = wsId || null
      const r = await assignToWorkspace(auth.orgId, { type: b.itemType, id: String(b.itemId) }, target)
      await audit({ action: 'workspace.item_assigned', targetType: b.itemType, targetId: String(b.itemId), detail: { name: r.name, before: r.before, after: target, schedulesMoved: r.schedules, plansMoved: r.plans } })
      return json({ success: true, moved: { schedules: r.schedules, plans: r.plans } })
    }
    default:
      throw new ApiError(400, 'Unknown action')
  }
})
