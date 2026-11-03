// Resolves the retrieval scope for a request: the caller's organization, the project (a schedule the
// caller can see, which brings its update series) and the caller's workspace access.

import { getScheduleById, type Schedule } from '@/lib/db'
import { ApiError } from '@/lib/server/api'
import { classifiedCloudRefusal, CLASSIFIED_CLOUD_CODE, scheduleClassification } from '@/lib/server/classification'
import { deploymentKind } from '@/lib/llm/provider'
import { currentWorkspaceAccess } from '@/lib/server/workspace-scope'
import type { RetrievalScope } from './types'

/**
 * `metadataOnly`: listing and deleting documents stay possible for a schedule marked classified on
 * the commercial cloud (as deleting the schedule does); reading passages, uploading and AI don't.
 */
export async function projectScope(orgId: string, scheduleId: string, opts: { metadataOnly?: boolean } = {}): Promise<{ scope: RetrievalScope; schedule: Schedule }> {
  if (!scheduleId || typeof scheduleId !== 'string') throw new ApiError(400, 'scheduleId required')
  // Organization- and workspace-scoped: another firm's (or another walled matter's) schedule is "not found".
  const schedule = await getScheduleById(scheduleId, orgId)
  if (!schedule) throw new ApiError(404, 'Schedule not found')
  if (!opts.metadataOnly && schedule.classification === 'classified') {
    const refusal = classifiedCloudRefusal('classified', deploymentKind())
    if (refusal) throw new ApiError(409, refusal, CLASSIFIED_CLOUD_CODE)
  }
  return { scope: { orgId, scheduleId: schedule.id, access: await currentWorkspaceAccess() }, schedule }
}

/** The project's live classification; a failed lookup counts as classified (fail closed). */
export async function projectClassification(scheduleId: string, orgId: string): Promise<string | null> {
  try { return await scheduleClassification(scheduleId, orgId) } catch { return 'classified' }
}

/**
 * Audit target for a document event: a project document's events are filed under its schedule, so
 * the audit log's workspace filter hides them from members who can't see that schedule; an
 * organization standard's under the document.
 */
export const auditTarget = (d: { id: string; scope: string; scheduleId: string | null }) =>
  d.scope === 'project' && d.scheduleId ? { targetType: 'schedule', targetId: d.scheduleId } : { targetType: 'document', targetId: d.id }
