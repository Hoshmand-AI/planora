import { api, json, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { can } from '@/lib/server/permissions'
import { hit } from '@/lib/server/rate-limit'
import { getActivities } from '@/lib/db'
import { projectClassification, projectScope } from '@/lib/rag/scope'
import { CLASSIFIED_CLOUD_CODE, classifiedCloudRefusal } from '@/lib/server/classification'
import { deploymentKind } from '@/lib/llm/provider'
import { registerKey } from '@/lib/server/register'
import { effectiveUploadLimit, formatMb } from '@/lib/upload-limit'
import { CaptureRejected, captureOverview, checkMedia, createCapture, listCaptures, type IncomingMedia } from '@/lib/server/site-captures'
import {
  CAPTURE_STATUSES, CAPTURE_STATUS_LABELS, MAX_AUDIO_SECONDS, MAX_CAPTURE_BYTES, MAX_CAPTURES_PER_PROJECT, MAX_NOTE_CHARS, MAX_PHOTOS_PER_CAPTURE,
  captureIsEmpty, orderForCapture, parseCaptureFields, siteCaptureEnabled, type CaptureActivity,
} from '@/lib/site/capture'

/**
 * Site captures: what someone saw on site. A photo, a voice note and a few words, stamped with who, when and
 * where, tied to schedule activities. They belong to the project (the update series), so they carry across uploads.
 *   GET   ?before=<ISO time>&limit=<n>&activities=1   → { captures, overview, statuses, limits, canCapture, activities? }
 *   POST  multipart: status, note?, activityCodes? (JSON list), level?, room?, placeSource?, lat?, lng?, accuracyM?,
 *         altitudeM?, headingDeg?, takenAt?, photo (up to 4 files), audio (one file), audioSeconds?
 * Recording needs site.capture (every role but viewer). A capture is never edited; it can be deleted.
 * The audit log records that a capture was made, its sizes and its place: never the note's words.
 */
const CAPTURES_PER_ORG_PER_HOUR = 600
const CAPTURES_PER_MEMBER_PER_HOUR = 240

export const GET = api<{ id: string }>({ permission: 'read' }, async (req, { params, auth }) => {
  const { schedule } = await projectScope(auth.orgId, params.id, { metadataOnly: true })
  const key = registerKey(schedule)
  const q = req.nextUrl.searchParams
  const before = q.get('before')
  if (before && Number.isNaN(Date.parse(before))) throw new ApiError(400, '"before" must be a time (ISO 8601).')
  const limit = Number(q.get('limit')) || 60
  const [captures, overview] = await Promise.all([listCaptures(auth.orgId, key, { before, limit }), captureOverview(auth.orgId, key)])
  // The pick list for the capture screen, asked for once when it opens: this upload's tasks and milestones.
  let activities: CaptureActivity[] | undefined
  if (q.get('activities') === '1') {
    activities = orderForCapture((await getActivities(schedule.id)).filter(a => a.activityType === 'task' || a.activityType === 'milestone').map(a => ({
      code: a.activityId, name: a.name,
      state: a.status === 'complete' || a.actualFinish ? 'complete' as const : a.actualStart || a.status === 'in_progress' ? 'in_progress' as const : 'not_started' as const,
      start: (a.actualStart || a.earlyStart)?.slice(0, 10) ?? null, finish: (a.actualFinish || a.earlyFinish)?.slice(0, 10) ?? null,
    }))).slice(0, 5000)
  }
  return json({
    project: { scheduleId: schedule.id, name: schedule.name },
    captures, overview,
    statuses: CAPTURE_STATUSES.map(id => ({ id, label: CAPTURE_STATUS_LABELS[id] })),
    limits: { maxBytes: effectiveUploadLimit(MAX_CAPTURE_BYTES), maxPhotos: MAX_PHOTOS_PER_CAPTURE, maxAudioSeconds: MAX_AUDIO_SECONDS, maxNoteChars: MAX_NOTE_CHARS, maxCaptures: MAX_CAPTURES_PER_PROJECT },
    classification: await projectClassification(schedule.id, auth.orgId),
    canCapture: siteCaptureEnabled() && can(auth.role, 'site.capture'),
    enabled: siteCaptureEnabled(),
    ...(activities ? { activities } : {}),
  })
})

export const POST = api<{ id: string }>({ permission: 'site.capture' }, async (req, { params, auth }) => {
  if (!siteCaptureEnabled()) throw new ApiError(404, 'Site captures are turned off on this deployment.', 'site_capture_off')
  // Refused before the body is read: the limit is checked again on the files once they are parsed.
  const maxBytes = effectiveUploadLimit(MAX_CAPTURE_BYTES)
  if (Number(req.headers.get('content-length') || 0) > maxBytes + 64 * 1024) throw new ApiError(413, `This capture is too large to send (the limit is ${formatMb(maxBytes)}). Send fewer photos in one capture.`, 'too_large')
  const { schedule } = await projectScope(auth.orgId, params.id)
  // The project's own marking, with its plan's (the stricter of the two), as for project documents.
  const classification = await projectClassification(schedule.id, auth.orgId)
  const refusal = classifiedCloudRefusal(classification, deploymentKind())
  if (refusal) throw new ApiError(409, refusal, CLASSIFIED_CLOUD_CODE)
  // One member cannot use up the organization's hour.
  const own = await hit(`captures:user:${auth.userId}`, CAPTURES_PER_MEMBER_PER_HOUR, 3600)
  if (!own.ok) throw new ApiError(429, 'Too many site captures this hour. Try again later.', 'rate_limited', { retryAfterSec: own.retryAfterSec })
  const quota = await hit(`captures:org:${auth.orgId}`, CAPTURES_PER_ORG_PER_HOUR, 3600)
  if (!quota.ok) throw new ApiError(429, 'Too many site captures for your organization this hour. Try again later.', 'rate_limited', { retryAfterSec: quota.retryAfterSec })

  let form: FormData
  try { form = await req.formData() } catch { throw new ApiError(400, 'Send the capture as multipart form data.') }
  const parsed = parseCaptureFields(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string')))
  if ('error' in parsed) throw new ApiError(400, parsed.error, 'invalid_capture')

  const files = [...form.getAll('photo'), ...form.getAll('audio')].filter((v): v is File => typeof v !== 'string')
  if (files.reduce((n, f) => n + f.size, 0) > maxBytes) throw new ApiError(413, `This capture is too large to send (the limit is ${formatMb(maxBytes)}). Send fewer photos in one capture.`, 'too_large')
  const seconds = Number(form.get('audioSeconds'))
  const incoming: IncomingMedia[] = []
  for (const f of files) incoming.push({ bytes: Buffer.from(await f.arrayBuffer()), seconds: Number.isFinite(seconds) ? seconds : null })

  let media
  try { media = checkMedia(incoming) } catch (err) {
    if (err instanceof CaptureRejected) throw new ApiError(err.code === 'too_large' ? 413 : 400, err.message, err.code)
    throw err
  }
  if (captureIsEmpty(parsed.fields, media.length)) throw new ApiError(400, 'Add a photo, a voice note or a few words.', 'empty_capture')

  const stored = await createCapture(auth.orgId, registerKey(schedule), schedule.id, parsed.fields, media, { userId: auth.userId, name: auth.name }, classification)
  if (stored === 'full') throw new ApiError(400, `A project holds up to ${MAX_CAPTURES_PER_PROJECT.toLocaleString('en-US')} site captures. Delete some first.`, 'captures_full')
  if (stored === 'deleted') throw new ApiError(410, 'This capture was already sent, and has since been deleted.', 'capture_deleted')
  const { capture } = stored
  // The phone sent this one before (its answer was lost on the way): it is already stored and already audited.
  if (stored.duplicate) return json({ capture, alreadySent: true })
  const f = parsed.fields
  await audit({ action: 'site.capture_created', targetType: 'schedule', targetId: schedule.id, detail: {
    schedule: schedule.name, captureId: capture.id, status: f.status, noteChars: f.note.length, activities: f.activityCodes,
    photos: media.filter(m => m.kind === 'photo').length, voiceNote: media.some(m => m.kind === 'audio'), mediaBytes: media.reduce((n, m) => n + m.bytes.length, 0), sha256: media.map(m => m.sha256),
    level: f.level, room: f.room, placeSource: f.placeSource, hasPosition: !!f.position, accuracyM: f.position?.accuracyM ?? null, takenAt: f.takenAt, classification,
  } })
  return json({ capture })
})
