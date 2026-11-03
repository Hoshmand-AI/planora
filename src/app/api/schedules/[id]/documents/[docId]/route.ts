import { api, json, body, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { can } from '@/lib/server/permissions'
import { auditTarget, projectScope } from '@/lib/rag/scope'
import { deleteDocument, getDocument, setDocumentTrust } from '@/lib/rag/store'

type P = { id: string; docId: string }

/** Approve a document for AI grounding, or return it to unreviewed (owners, admins, reviewers). */
export const PATCH = api<P>({ permission: 'plan.review' }, async (req, { params, auth }) => {
  const { scope } = await projectScope(auth.orgId, params.id)
  const doc = await getDocument(scope, params.docId)
  if (!doc) throw new ApiError(404, 'Document not found')
  const b = await body<{ trust?: unknown }>(req)
  if (b.trust !== 'approved' && b.trust !== 'unreviewed') throw new ApiError(400, 'trust must be "approved" or "unreviewed".')
  if (doc.scope === 'org' && !can(auth.role, 'org.manage')) throw new ApiError(403, 'Only owners and admins can approve organization standards.', 'forbidden')
  if (b.trust !== doc.trust) {
    await setDocumentTrust(auth.orgId, doc.id, b.trust, auth.userId)
    await audit({ action: 'document.trust_changed', ...auditTarget(doc), detail: { documentId: doc.id, title: doc.title, before: doc.trust, after: b.trust, ownUpload: doc.uploadedBy === auth.userId } })
  }
  return json({ success: true, document: await getDocument(scope, doc.id) })
})

/** Delete a document: its passages, index entries and requirement reviews are removed immediately. */
export const DELETE = api<P>({ permission: 'schedule.write' }, async (_req, { params, auth }) => {
  const { scope } = await projectScope(auth.orgId, params.id, { metadataOnly: true })
  const doc = await getDocument(scope, params.docId)
  if (!doc) throw new ApiError(404, 'Document not found')
  if (doc.scope === 'org' && !can(auth.role, 'org.manage')) throw new ApiError(403, 'Only owners and admins can delete organization standards.', 'forbidden')
  const r = await deleteDocument(auth.orgId, doc.id)
  if (!r) throw new ApiError(404, 'Document not found')
  await audit({ action: 'document.deleted', ...auditTarget(doc), detail: { documentId: doc.id, title: doc.title, docType: doc.docType, sha256: doc.sha256, passagesDeleted: r.chunksDeleted } })
  return json({ success: true, passagesDeleted: r.chunksDeleted })
})
