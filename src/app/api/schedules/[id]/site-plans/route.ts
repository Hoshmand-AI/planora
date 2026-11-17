import { api, json, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { can } from '@/lib/server/permissions'
import { hit } from '@/lib/server/rate-limit'
import { CLASSIFIED_CLOUD_CODE, classifiedCloudRefusal } from '@/lib/server/classification'
import { deploymentKind } from '@/lib/llm/provider'
import { projectClassification, projectScope } from '@/lib/rag/scope'
import { registerKey } from '@/lib/server/register'
import { effectiveUploadLimit, formatMb } from '@/lib/upload-limit'
import { PlanRejected, createPlan, listPlans } from '@/lib/server/site-plans'
import { siteCaptureEnabled } from '@/lib/site/capture'
import { imagery } from '@/lib/site/imagery'
import { MAX_PLANS_PER_PROJECT, MAX_PLAN_BYTES, MAX_ROOMS_PER_PLAN, parseLevel } from '@/lib/site/plan'

/**
 * Site plans: a drawing of each level of the project, the rooms marked on it, and the points that place it on
 * the ground. They belong to the project (the update series), like its captures.
 *   GET   → { plans, canEdit, imagery, limits }   (never the picture bytes: see …/site-plans/{planId}/image;
 *           imagery is null when the aerial picture is off, or the project is marked controlled or classified)
 *   POST  multipart: level, image (one JPEG, PNG or WebP)   → { plan }
 * Reading needs read; adding or changing a drawing needs schedule.write.
 */
export const GET = api<{ id: string }>({ permission: 'read' }, async (_req, { params, auth }) => {
  const { schedule } = await projectScope(auth.orgId, params.id, { metadataOnly: true })
  // A project marked as controlled or classified gets no aerial picture: asking a map service for the squares
  // around a site tells that service roughly where the site is.
  const marking = await projectClassification(schedule.id, auth.orgId)
  const im = marking === 'cui' || marking === 'classified' ? null : imagery()
  return json({
    project: { scheduleId: schedule.id, name: schedule.name },
    plans: await listPlans(auth.orgId, registerKey(schedule)),
    canEdit: siteCaptureEnabled() && can(auth.role, 'schedule.write'),
    imagery: im ? { attribution: im.attribution, maxZoom: im.maxZoom } : null,
    limits: { maxBytes: effectiveUploadLimit(MAX_PLAN_BYTES), maxPlans: MAX_PLANS_PER_PROJECT, maxRooms: MAX_ROOMS_PER_PLAN },
  })
})

export const POST = api<{ id: string }>({ permission: 'schedule.write' }, async (req, { params, auth }) => {
  if (!siteCaptureEnabled()) throw new ApiError(404, 'Site captures are turned off on this deployment.', 'site_capture_off')
  // Refused before the body is read: the limit is checked again on the file once it is parsed.
  const maxBytes = effectiveUploadLimit(MAX_PLAN_BYTES)
  if (Number(req.headers.get('content-length') || 0) > maxBytes + 64 * 1024) throw new ApiError(413, `This drawing is too large to send (the limit is ${formatMb(maxBytes)}). Export it at a lower resolution.`, 'too_large')
  const { schedule } = await projectScope(auth.orgId, params.id)
  // The project's own marking, with its plan's (the stricter of the two), as for captures and documents.
  const classification = await projectClassification(schedule.id, auth.orgId)
  const refusal = classifiedCloudRefusal(classification, deploymentKind())
  if (refusal) throw new ApiError(409, refusal, CLASSIFIED_CLOUD_CODE)
  const own = await hit(`site-plans:user:${auth.userId}`, 60, 3600)
  if (!own.ok) throw new ApiError(429, 'Too many drawings added this hour. Try again later.', 'rate_limited', { retryAfterSec: own.retryAfterSec })
  const quota = await hit(`site-plans:org:${auth.orgId}`, 120, 3600)
  if (!quota.ok) throw new ApiError(429, 'Too many drawings added for your organization this hour. Try again later.', 'rate_limited', { retryAfterSec: quota.retryAfterSec })
  let form: FormData
  try { form = await req.formData() } catch { throw new ApiError(400, 'Send the drawing as multipart form data.') }
  const level = parseLevel(form.get('level'))
  if ('error' in level) throw new ApiError(400, level.error, 'invalid_plan')
  const file = form.get('image')
  if (!file || typeof file === 'string') throw new ApiError(400, 'Choose a picture of the drawing.', 'invalid_plan')
  if (file.size > maxBytes) throw new ApiError(413, `This drawing is too large to send (the limit is ${formatMb(maxBytes)}). Export it at a lower resolution.`, 'too_large')
  let plan
  try {
    plan = await createPlan(auth.orgId, registerKey(schedule), level.level, Buffer.from(await file.arrayBuffer()), { userId: auth.userId, name: auth.name }, classification)
  } catch (err) {
    if (err instanceof PlanRejected) throw new ApiError(err.code === 'too_large' ? 413 : 400, err.message, err.code)
    throw err
  }
  await audit({ action: 'site.plan_added', targetType: 'schedule', targetId: schedule.id, detail: {
    schedule: schedule.name, planId: plan.id, level: plan.level, width: plan.width, height: plan.height, bytes: file.size, classification,
  } })
  return json({ plan })
})
