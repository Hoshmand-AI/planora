// The two uploads a project keeps for comparison: its baseline (what every update is measured against) and its
// comparison schedule (for example last month's update). They are kept for the project, not for one upload, so
// the next upload is measured against the same baseline without anyone setting it again.

import { initSchema, query } from '@/lib/db'

export interface ScheduleRoles { baselineScheduleId: string | null; comparisonScheduleId: string | null }

/** The project's stored baseline and comparison uploads (both null when none was chosen). */
export async function getScheduleRoles(orgId: string, key: string): Promise<ScheduleRoles> {
  await initSchema()
  const res = await query('SELECT baseline_schedule_id, comparison_schedule_id FROM project_schedule_roles WHERE org_id=$1 AND project_key=$2', [orgId, key])
  const r = res.rows[0]
  return { baselineScheduleId: (r?.baseline_schedule_id as string) ?? null, comparisonScheduleId: (r?.comparison_schedule_id as string) ?? null }
}

/** Stores the project's baseline and comparison uploads (null clears one). */
export async function setScheduleRoles(orgId: string, key: string, roles: ScheduleRoles, userId: string | null): Promise<void> {
  await initSchema()
  await query(
    `INSERT INTO project_schedule_roles (org_id, project_key, baseline_schedule_id, comparison_schedule_id, updated_by, updated_at) VALUES ($1,$2,$3,$4,$5,NOW())
     ON CONFLICT (org_id, project_key) DO UPDATE SET baseline_schedule_id=$3, comparison_schedule_id=$4, updated_by=$5, updated_at=NOW()`,
    [orgId, key, roles.baselineScheduleId, roles.comparisonScheduleId, userId])
}

/** An upload that is deleted is no longer anyone's baseline or comparison schedule. */
export async function forgetScheduleRole(orgId: string, scheduleId: string): Promise<void> {
  await query('UPDATE project_schedule_roles SET baseline_schedule_id=NULL WHERE org_id=$1 AND baseline_schedule_id=$2', [orgId, scheduleId])
  await query('UPDATE project_schedule_roles SET comparison_schedule_id=NULL WHERE org_id=$1 AND comparison_schedule_id=$2', [orgId, scheduleId])
}
