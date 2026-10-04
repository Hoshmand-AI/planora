// Role-based access control. Every API route declares the permission it needs; least privilege by default.

export const ROLES = ['owner', 'admin', 'scheduler', 'reviewer', 'viewer'] as const
export type Role = typeof ROLES[number]

export type Permission =
  | 'read'            // view plans, schedules, quality, reports, exports
  | 'ai.use'          // Ask AI / AI reports / AI follow-up questions (spends model budget)
  | 'plan.write'      // create plans, answer, generate, override, recover, decide on DCMA findings
  | 'schedule.write'  // upload, tag, delete schedules; answer data questions
  | 'plan.review'     // record an expert review (approve / reject)
  | 'plan.publish'    // publish a plan as a baseline schedule
  | 'audit.read'      // read and verify the organization audit log
  | 'org.manage'      // members, invitations, organization settings, data export
  | 'org.own'         // ownership transfer, organization deletion

const MATRIX: Record<Role, Permission[]> = {
  owner: ['read', 'ai.use', 'plan.write', 'schedule.write', 'plan.review', 'plan.publish', 'audit.read', 'org.manage', 'org.own'],
  admin: ['read', 'ai.use', 'plan.write', 'schedule.write', 'plan.review', 'plan.publish', 'audit.read', 'org.manage'],
  scheduler: ['read', 'ai.use', 'plan.write', 'schedule.write', 'plan.publish'],
  reviewer: ['read', 'ai.use', 'plan.review', 'audit.read'],
  viewer: ['read'],
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner', admin: 'Admin', scheduler: 'Scheduler', reviewer: 'Reviewer', viewer: 'Viewer',
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: 'Everything, including transferring ownership and deleting the organization.',
  admin: 'Manage members, settings and the audit log, plus all scheduling work.',
  scheduler: 'Build, change, upload and publish schedules.',
  reviewer: 'Read everything, record expert reviews and read the audit log. Cannot change schedules.',
  viewer: 'Read-only access to plans, schedules and reports.',
}

export const isRole = (r: unknown): r is Role => typeof r === 'string' && (ROLES as readonly string[]).includes(r)
export const can = (role: string | undefined, p: Permission): boolean => isRole(role) && MATRIX[role].includes(p)
export const permissionsOf = (role: Role): Permission[] => MATRIX[role]
/** Who may assign which roles: owners assign any role; admins can't create or change owners/admins. */
export const canAssign = (actor: Role, target: Role) => actor === 'owner' || (actor === 'admin' && target !== 'owner' && target !== 'admin')
