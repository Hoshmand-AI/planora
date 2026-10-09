import { api, json, body, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { projectScope } from '@/lib/rag/scope'
import { requirementReviews, saveRequirementReview, scopedChunks } from '@/lib/rag/store'
import { extractRequirements } from '@/lib/rag/requirements'
import type { RetrievalScope } from '@/lib/rag/types'

// Candidate scheduling requirements found by deterministic rules in the project's documents. They
// are suggestions with citations: a person confirms or dismisses each one, and nothing is applied
// to a schedule or to the quality rules automatically.

async function candidates(scope: RetrievalScope) {
  const chunks = await scopedChunks(scope, { includeUnreviewed: true })
  const trustOf = new Map(chunks.map(c => [c.documentId, c.trust]))
  const found = extractRequirements(chunks.map(c => ({ chunkId: c.chunkId, documentId: c.documentId, title: c.title, section: c.section, page: c.page, pageEnd: c.pageEnd, ordinal: c.ordinal, text: c.text, flagged: c.flagged })))
  const reviews = await requirementReviews(scope.orgId, [...new Set(found.map(f => f.documentId))])
  return found.map(f => ({ ...f, documentTrust: trustOf.get(f.documentId) ?? 'unreviewed', review: reviews.get(`${f.documentId}:${f.key}`) ?? null }))
}

export const GET = api<{ id: string }>({ permission: 'read' }, async (_req, { params, auth }) => {
  const { scope } = await projectScope(auth.orgId, params.id)
  return json({ requirements: await candidates(scope), note: 'Candidates found by rules in the documents. Confirm the ones that apply; nothing is applied automatically.' })
})

/** Record a decision on a candidate: { documentId, key, status: 'confirmed' | 'dismissed' }. */
export const POST = api<{ id: string }>({ permission: 'schedule.write' }, async (req, { params, auth }) => {
  const { scope } = await projectScope(auth.orgId, params.id)
  const b = await body<{ documentId?: unknown; key?: unknown; status?: unknown }>(req)
  if (b.status !== 'confirmed' && b.status !== 'dismissed') throw new ApiError(400, 'status must be "confirmed" or "dismissed".')
  // The candidate must exist now, in a document this caller can see for this project.
  const c = (await candidates(scope)).find(x => x.documentId === b.documentId && x.key === b.key)
  if (!c) throw new ApiError(404, 'That candidate requirement was not found (the document may have been deleted).')
  await saveRequirementReview(auth.orgId, { documentId: c.documentId, key: c.key, kind: c.kind, status: b.status, userId: auth.userId })
  // Audit the decision without document text: requirement kind and ids only.
  await audit({ action: `document.requirement_${b.status}`, targetType: 'schedule', targetId: scope.scheduleId, detail: { documentId: c.documentId, key: c.key, kind: c.kind, chunkId: c.chunkId } })
  return json({ success: true, requirements: await candidates(scope) })
})
