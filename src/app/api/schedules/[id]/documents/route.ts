import { api, json, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { can } from '@/lib/server/permissions'
import { hit, LIMITS } from '@/lib/server/rate-limit'
import { classifiedCloudRefusal, CLASSIFIED_CLOUD_CODE } from '@/lib/server/classification'
import { deploymentKind, CUI_CLOUD_WARNING } from '@/lib/llm/provider'
import { projectClassification, projectScope } from '@/lib/rag/scope'
import { ingestDocument, listDocuments } from '@/lib/rag/store'
import { DocumentRejected, MAX_DOCUMENT_BYTES } from '@/lib/rag/extract'
import { DOC_TYPES, DOC_TYPE_LABELS, isDocType } from '@/lib/rag/types'
import { auditTarget } from '@/lib/rag/scope'

// Project documents (contracts, scheduling specifications, owner requirements) used to ground Ask AI
// and AI reports. Documents belong to the project: the upload they were added to and every other
// upload of the same series. Only the extracted text is stored, never the original file.

/** Documents visible to the caller for this project, plus organization standards. */
export const GET = api<{ id: string }>({ permission: 'read' }, async (_req, { params, auth }) => {
  const { scope, schedule } = await projectScope(auth.orgId, params.id, { metadataOnly: true })
  const documents = await listDocuments(scope)
  return json({
    project: { scheduleId: schedule.id, name: schedule.name, projectKey: schedule.projectKey ?? null },
    documents,
    docTypes: DOC_TYPES.map(id => ({ id, label: DOC_TYPE_LABELS[id] })),
    limits: { maxBytes: MAX_DOCUMENT_BYTES, formats: ['pdf', 'docx', 'txt', 'md'] },
    classification: await projectClassification(schedule.id, auth.orgId),
    ...(deploymentKind() === 'commercial_cloud' ? { cuiWarning: CUI_CLOUD_WARNING } : {}),
  })
})

/**
 * Upload (multipart): file, title?, docType, scope? ('project' | 'org'). Organization standards need
 * org.manage. New documents start unreviewed; an admin or reviewer approves them.
 */
export const POST = api<{ id: string }>({ permission: 'schedule.write' }, async (req, { params, auth }) => {
  const { schedule } = await projectScope(auth.orgId, params.id)
  const quota = await hit(`docs:org:${auth.orgId}`, LIMITS.uploadsPerOrg.limit, LIMITS.uploadsPerOrg.windowSec)
  if (!quota.ok) throw new ApiError(429, 'Too many document uploads for your organization this hour. Try again later.', 'rate_limited', { retryAfterSec: quota.retryAfterSec })

  let form: FormData
  try { form = await req.formData() } catch { throw new ApiError(400, 'Send the document as multipart form data with a "file" field.') }
  const file = form.get('file')
  if (!file || typeof file === 'string') throw new ApiError(400, 'Choose a file to upload.')
  if (file.size > MAX_DOCUMENT_BYTES) throw new ApiError(413, `The file is larger than ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB. Split it (for example by specification section) and upload the parts.`, 'too_large')
  const docType = form.get('docType')
  if (!isDocType(docType)) throw new ApiError(400, `Pick a document type: ${DOC_TYPES.join(', ')}.`)
  const scope = form.get('scope') === 'org' ? 'org' : 'project'
  if (scope === 'org' && !can(auth.role, 'org.manage')) throw new ApiError(403, 'Only owners and admins can add organization standards.', 'forbidden')
  const title = (String(form.get('title') || '').trim() || file.name.replace(/\.[a-z0-9]+$/i, '')).replace(/\s+/g, ' ').slice(0, 160)
  if (!title) throw new ApiError(400, 'Give the document a title.')

  // Classification: a project document inherits its project's; the commercial cloud refuses classified.
  const classification = scope === 'project' ? await projectClassification(schedule.id, auth.orgId) : null
  const refusal = classifiedCloudRefusal(classification, deploymentKind())
  if (refusal) throw new ApiError(409, refusal, CLASSIFIED_CLOUD_CODE)

  try {
    const r = await ingestDocument({
      orgId: auth.orgId, scope, scheduleId: scope === 'project' ? schedule.id : null, title, fileName: file.name || 'document',
      docType, classification, uploadedBy: auth.userId, content: Buffer.from(await file.arrayBuffer()),
    })
    const d = r.document
    await audit({ action: 'document.uploaded', ...auditTarget(d), detail: {
      documentId: d.id, scope: d.scope, title: d.title, docType: d.docType, format: d.format, sha256: d.sha256, sizeBytes: d.sizeBytes,
      pages: d.pageCount, passages: d.chunkCount, flaggedPassages: d.flaggedCount, classification: d.classification, storesOriginalFile: false,
    } })
    return json({
      document: d, flaggedChunks: r.flaggedChunks,
      ...(r.flaggedChunks.length ? { warning: `${r.flaggedChunks.length} passage${r.flaggedChunks.length === 1 ? '' : 's'} contain${r.flaggedChunks.length === 1 ? 's' : ''} text that reads like instructions to an AI. ${r.flaggedChunks.length === 1 ? 'It is' : 'They are'} never sent to a model and ${r.flaggedChunks.length === 1 ? 'is' : 'are'} shown with a warning in search results.` } : {}),
    })
  } catch (err) {
    if (err instanceof DocumentRejected) throw new ApiError(err.code === 'duplicate' ? 409 : err.code === 'too_large' ? 413 : 400, err.message, err.code)
    throw err
  }
})
