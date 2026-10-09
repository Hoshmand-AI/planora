// Retrieval over project documents with Postgres full-text search (websearch_to_tsquery +
// ts_rank_cd over a generated tsvector with a GIN index; no extensions needed).
//
// Authorization happens INSIDE the SQL, before ranking: every statement built here filters
//   • org_id = the caller's organization, on the chunk AND on its document (and a composite foreign
//     key makes a chunk's org always equal its document's org);
//   • the project: the schedule named in the request must exist in the caller's organization and be
//     visible to the caller (workspace / ethical-wall rules from workspace-scope.ts), and a project
//     document is visible only through a schedule of the same series that the caller can also see;
//   • organization standards (scope 'org') follow the rule for organization-wide items (restricted
//     members don't see them);
//   • unreviewed documents only when the caller opted in.
// Nothing is filtered after the query, so a passage the caller may not see never leaves Postgres.

import { createHash, randomUUID } from 'crypto'
import type { WorkspaceAccess } from '@/lib/server/context'
import { workspaceClause } from '@/lib/server/workspace-scope'
import { citationFor } from './citations'
import type { DocType, RetrievalOptions, RetrievalScope, RetrievedChunk, Retriever, Tier, Trust, DocScope } from './types'

type Q = (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>

/** Bind-parameter collector: p(v) appends v and returns its "$n" placeholder. */
class Params {
  values: unknown[] = []
  p(v: unknown): string { this.values.push(v); return `$${this.values.length}` }
}

/**
 * The project visibility predicate shared by every documents query. Expects aliases d
 * (project_documents) and a (schedules, LEFT JOINed on d.schedule_id) and the CTE `proj`.
 * $1 must be the organization id and $2 the schedule id.
 */
function scope(access: WorkspaceAccess, ps: Params): { cte: string; join: string; where: string } {
  if (ps.values.length !== 2) throw new Error('scope() expects $1 = org id and $2 = schedule id')
  // One shared parameter for the workspace list, used for every workspace_id column below.
  const probe = workspaceClause(access, 'x', 3)
  const wsParam = probe.params.length ? ps.p(probe.params[0]) : null
  const ws = (column: string) => {
    if (!wsParam) return ''
    const c = workspaceClause(access, column, Number(wsParam.slice(1)))
    return c.sql ? ` AND ${c.sql}` : ''
  }
  return {
    cte: `proj AS (SELECT s.id, s.project_key FROM schedules s WHERE s.id = $2 AND s.org_id = $1${ws('s.workspace_id')})`,
    join: `LEFT JOIN schedules a ON a.id = d.schedule_id AND a.org_id = $1`,
    where: `d.org_id = $1 AND d.deleted_at IS NULL AND EXISTS (SELECT 1 FROM proj) AND (
      (d.scope = 'project' AND a.id IS NOT NULL${ws('a.workspace_id')}
        AND (a.id = (SELECT id FROM proj) OR (a.project_key IS NOT NULL AND a.project_key = (SELECT project_key FROM proj))))
      OR (d.scope = 'org' AND d.schedule_id IS NULL${ws('NULL::text')})
    )`,
  }
}

export const TIER_SQL = `CASE WHEN d.trust = 'approved' AND d.scope = 'project' THEN 1 WHEN d.trust = 'approved' THEN 2 WHEN d.doc_type IN ('contract', 'owner_requirement') THEN 3 ELSE 4 END`

/** Lexemes for an OR ("any term") query, built from plain words only (no tsquery syntax from users). */
export function anyTermsQuery(query: string): string {
  const words = [...new Set((query.toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu) || []).filter(w => w.length > 1 || /\d/.test(w)))].slice(0, 32)
  return words.join(' | ')
}

export interface Built { text: string; values: unknown[] }

/** The ranked full-text search statement. Pure, so the scoping can be unit-tested. */
export function buildSearchSql(s: RetrievalScope, query: string, o: RetrievalOptions): Built {
  const ps = new Params()
  ps.p(s.orgId); ps.p(s.scheduleId)
  const sc = scope(s.access, ps)
  const tsq = o.match === 'all' ? `websearch_to_tsquery('english', ${ps.p(query)})` : `to_tsquery('english', ${ps.p(anyTermsQuery(query))})`
  const unreviewed = ps.p(o.includeUnreviewed)
  const limit = ps.p(Math.min(Math.max(Math.floor(o.limit) || 8, 1), 50))
  const text = `WITH ${sc.cte}, q AS (SELECT ${tsq} AS tsq)
    SELECT c.id AS chunk_id, c.document_id, c.ordinal, c.page, c.page_end, c.section, c.heading, c.text, c.flagged, c.flag_reasons,
      d.title, d.doc_type, d.trust, d.scope, d.classification,
      ts_rank_cd(c.tsv, q.tsq, 32) AS rank, ${TIER_SQL} AS tier
    FROM document_chunks c
    JOIN project_documents d ON d.id = c.document_id AND d.org_id = c.org_id
    ${sc.join}
    CROSS JOIN q
    WHERE c.org_id = $1 AND ${sc.where}
      AND (${unreviewed}::boolean OR d.trust = 'approved')
      AND c.tsv @@ q.tsq
    ORDER BY tier ASC, rank DESC, d.created_at ASC, c.ordinal ASC
    LIMIT ${limit}`
  return { text, values: ps.values }
}

/** Documents visible to the caller for this project (newest first). */
export function buildListDocumentsSql(s: RetrievalScope): Built {
  const ps = new Params()
  ps.p(s.orgId); ps.p(s.scheduleId)
  const sc = scope(s.access, ps)
  return {
    text: `WITH ${sc.cte}
      SELECT d.*, u.name AS uploaded_by_name, a.name AS anchor_name, a.version AS anchor_version FROM project_documents d ${sc.join}
      LEFT JOIN users u ON u.id = d.uploaded_by AND u.org_id = d.org_id
      WHERE ${sc.where} ORDER BY d.scope ASC, d.created_at DESC`,
    values: ps.values,
  }
}

/** One document, only if visible to the caller through this project. */
export function buildGetDocumentSql(s: RetrievalScope, documentId: string): Built {
  const ps = new Params()
  ps.p(s.orgId); ps.p(s.scheduleId)
  const sc = scope(s.access, ps)
  return { text: `WITH ${sc.cte} SELECT d.* FROM project_documents d ${sc.join} WHERE ${sc.where} AND d.id = ${ps.p(documentId)}`, values: ps.values }
}

/** Every passage of the visible documents (for requirement extraction), in reading order. */
export function buildChunksSql(s: RetrievalScope, o: { includeUnreviewed: boolean; limit: number }): Built {
  const ps = new Params()
  ps.p(s.orgId); ps.p(s.scheduleId)
  const sc = scope(s.access, ps)
  const unreviewed = ps.p(o.includeUnreviewed)
  const limit = ps.p(o.limit)
  return {
    text: `WITH ${sc.cte}
      SELECT c.id AS chunk_id, c.document_id, c.ordinal, c.page, c.page_end, c.section, c.heading, c.text, c.flagged, c.flag_reasons,
        d.title, d.doc_type, d.trust, d.scope, d.classification, 0::real AS rank, ${TIER_SQL} AS tier
      FROM document_chunks c
      JOIN project_documents d ON d.id = c.document_id AND d.org_id = c.org_id
      ${sc.join}
      WHERE c.org_id = $1 AND ${sc.where} AND (${unreviewed}::boolean OR d.trust = 'approved')
      ORDER BY tier ASC, d.created_at ASC, c.ordinal ASC
      LIMIT ${limit}`,
    values: ps.values,
  }
}

export function rowToRetrieved(r: Record<string, unknown>): RetrievedChunk {
  const base = {
    chunkId: String(r.chunk_id), documentId: String(r.document_id), ordinal: Number(r.ordinal),
    page: r.page == null ? null : Number(r.page), pageEnd: r.page_end == null ? null : Number(r.page_end),
    section: (r.section as string) ?? null, heading: (r.heading as string) ?? null, text: String(r.text),
    flagged: r.flagged === true, flagReasons: Array.isArray(r.flag_reasons) ? (r.flag_reasons as string[]) : [],
    title: String(r.title), docType: r.doc_type as DocType, trust: r.trust as Trust, scope: r.scope as DocScope,
    classification: (r.classification as string) ?? null, rank: Number(r.rank) || 0, tier: Number(r.tier) as Tier,
  }
  return { ...base, citation: citationFor(base) }
}

/** Postgres full-text retriever. A vector backend would implement Retriever with the same scope rules. */
export class PostgresFtsRetriever implements Retriever {
  readonly backend = 'postgres-fts'
  constructor(private q: Q) {}
  async search(s: RetrievalScope, query: string, o: RetrievalOptions): Promise<RetrievedChunk[]> {
    if (!query.trim()) return []
    if (o.match === 'any' && !anyTermsQuery(query)) return []
    const b = buildSearchSql(s, query.slice(0, 500), o)
    const res = await this.q(b.text, b.values)
    const rows = res.rows.map(rowToRetrieved)
    // A search-box query with every term required can come back empty; fall back to ranked "any".
    if (!rows.length && o.match === 'all' && anyTermsQuery(query)) return this.search(s, query, { ...o, match: 'any' })
    return rows
  }
}

/** Hash of a query for the retrieval log (the query text itself is never stored). */
export const queryHash = (orgId: string, query: string) => createHash('sha256').update(`${orgId}\u0000${query.trim().toLowerCase()}`).digest('hex')

export type Delivery = 'search' | 'model' | 'passages_only' | 'withheld_restricted' | 'none'

export interface RetrievalLogEntry {
  orgId: string; userId: string | null; scheduleId: string | null; purpose: string; backend: string; query: string
  includeUnreviewed: boolean; delivery: Delivery; chunks: Pick<RetrievedChunk, 'chunkId' | 'documentId' | 'flagged'>[]; invalidCitations?: number
}

/** Records what a retrieval returned: ids and a query hash only (no query or passage text). */
export async function logRetrieval(q: Q, e: RetrievalLogEntry): Promise<string> {
  const id = randomUUID()
  await q(`INSERT INTO retrieval_log (id, org_id, user_id, schedule_id, purpose, backend, query_sha256, include_unreviewed, delivery, document_ids, chunk_ids, flagged_chunk_ids, invalid_citations)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [
    id, e.orgId, e.userId, e.scheduleId, e.purpose.slice(0, 60), e.backend, queryHash(e.orgId, e.query), e.includeUnreviewed, e.delivery,
    [...new Set(e.chunks.map(c => c.documentId))], e.chunks.filter(c => !c.flagged).map(c => c.chunkId), e.chunks.filter(c => c.flagged).map(c => c.chunkId), e.invalidCitations ?? 0,
  ])
  return id
}
