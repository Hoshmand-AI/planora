import { api, json, body, ApiError } from '@/lib/server/api'
import { query } from '@/lib/db'
import { projectScope } from '@/lib/rag/scope'
import { retriever } from '@/lib/rag/store'
import { logRetrieval } from '@/lib/rag/retrieval'
import { TIER_LABELS } from '@/lib/rag/types'
import { INJECTION_LABELS } from '@/lib/rag/injection'

/**
 * Ranked passages for a search over this project's documents (POST, so the query stays out of URLs
 * and access logs). Flagged passages are returned with a warning; nothing here calls a model.
 */
export const POST = api<{ id: string }>({ permission: 'read' }, async (req, { params, auth }) => {
  const { scope } = await projectScope(auth.orgId, params.id)
  const b = await body<{ query?: unknown; includeUnreviewed?: unknown; limit?: unknown }>(req)
  const q = typeof b.query === 'string' ? b.query.trim().slice(0, 500) : ''
  if (!q) throw new ApiError(400, 'Type something to search for.')
  const includeUnreviewed = b.includeUnreviewed === true
  const r = retriever()
  const results = await r.search(scope, q, { match: 'all', includeUnreviewed, limit: Math.min(Number(b.limit) || 15, 30) })
  await logRetrieval(query, { orgId: auth.orgId, userId: auth.userId, scheduleId: scope.scheduleId, purpose: 'search', backend: r.backend, query: q, includeUnreviewed, delivery: 'search', chunks: results })
  return json({
    backend: r.backend,
    results: results.map(c => ({
      chunkId: c.chunkId, documentId: c.documentId, title: c.title, docType: c.docType, trust: c.trust, scope: c.scope,
      section: c.section, heading: c.heading, page: c.page, pageEnd: c.pageEnd, citation: c.citation, text: c.text, rank: c.rank,
      tier: c.tier, tierLabel: TIER_LABELS[c.tier], flagged: c.flagged, flagReasons: c.flagReasons.map(id => INJECTION_LABELS[id] || id),
    })),
  })
})
