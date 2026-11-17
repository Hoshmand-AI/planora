import { api, json, body, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { can } from '@/lib/server/permissions'
import { auditTarget, projectScope } from '@/lib/rag/scope'
import { deleteDocument, getDocument, scopedChunks, setDocumentTrust } from '@/lib/rag/store'
import { logRetrieval } from '@/lib/rag/retrieval'
import { INJECTION_LABELS } from '@/lib/rag/injection'
import { query } from '@/lib/db'

type P = { id: string; docId: string }

/** How many passages the reading pane loads at once: enough for a contract section, bounded so a long document cannot flood the page. */
const READ_LIMIT = 200

/**
 * One document's passages in order, for the reading pane beside the list. The same scope and permission as the
 * search endpoint (which already returns passage text), and the read is recorded in the retrieval log the same way:
 * ids only, never the text. Nothing here calls a model.
 */
export const GET = api<P>({ permission: 'read' }, async (_req, { params, auth }) => {
  const { scope } = await projectScope(auth.orgId, params.id)
  const doc = await getDocument(scope, params.docId)
  if (!doc) throw new ApiError(404, 'Document not found')
  const chunks = (await scopedChunks(scope, { includeUnreviewed: true, documentId: doc.id, limit: READ_LIMIT })).sort((a, b) => a.ordinal - b.ordinal)
  await logRetrieval(query, { orgId: auth.orgId, userId: auth.userId, scheduleId: scope.scheduleId, purpose: 'read_document', backend: 'direct', query: `document:${doc.id}`, includeUnreviewed: true, delivery: 'passages_only', chunks })
  return json({
    document: doc,
    truncated: doc.chunkCount > chunks.length,
    passages: chunks.map(c => ({
      chunkId: c.chunkId, ordinal: c.ordinal, section: c.section, heading: c.heading, page: c.page, pageEnd: c.pageEnd, text: c.text,
      flagged: c.flagged, flagReasons: c.flagReasons.map(id => INJECTION_LABELS[id] || id),
    })),
  })
})

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
