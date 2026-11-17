import { api, json, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { can } from '@/lib/server/permissions'
import { projectScope } from '@/lib/rag/scope'
import { registerKey } from '@/lib/server/register'
import { deleteCapture, getCapture } from '@/lib/server/site-captures'

/**
 * One site capture.
 *   GET     → { capture }
 *   DELETE  → { success, mediaDeleted }: erases its photos, voice note and words, and leaves a dated tombstone.
 * The person who made a capture can delete it; anyone who can change the schedule can delete any capture.
 */
export const GET = api<{ id: string; captureId: string }>({ permission: 'read' }, async (_req, { params, auth }) => {
  const { schedule } = await projectScope(auth.orgId, params.id, { metadataOnly: true })
  const capture = await getCapture(auth.orgId, registerKey(schedule), params.captureId)
  if (!capture) throw new ApiError(404, 'No such capture in this project.')
  return json({ capture })
})

export const DELETE = api<{ id: string; captureId: string }>({ permission: 'site.capture' }, async (_req, { params, auth }) => {
  const { schedule } = await projectScope(auth.orgId, params.id, { metadataOnly: true })
  const key = registerKey(schedule)
  const capture = await getCapture(auth.orgId, key, params.captureId)
  if (!capture) throw new ApiError(404, 'No such capture in this project.')
  const own = capture.createdBy === auth.userId
  if (!own && !can(auth.role, 'schedule.write')) throw new ApiError(403, 'You can delete the captures you made. Ask a scheduler or an admin to delete this one.', 'forbidden')
  const removed = await deleteCapture(auth.orgId, key, capture.id)
  if (!removed) throw new ApiError(404, 'No such capture in this project.')
  await audit({ action: 'site.capture_deleted', targetType: 'schedule', targetId: schedule.id, detail: {
    schedule: schedule.name, captureId: capture.id, status: capture.status, takenAt: capture.takenAt, madeBy: capture.createdBy, ownCapture: own, mediaDeleted: removed.mediaDeleted,
  } })
  return json({ success: true, mediaDeleted: removed.mediaDeleted })
})
