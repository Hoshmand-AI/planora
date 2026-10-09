// Storage for project documents: ingest (extract → chunk → screen → store in one transaction), list,
// trust changes, deletion (chunks and derived rows hard-deleted at once), export, and requirement
// reviews. Every read goes through the scoped SQL in retrieval.ts.

import { createHash, randomUUID } from 'crypto'
import { initSchema, query, withTransaction } from '@/lib/db'
import { chunkDocument } from './chunk'
import { detectInjection } from './injection'
import { extractDocument, DocumentRejected } from './extract'
import { buildChunksSql, buildGetDocumentSql, buildListDocumentsSql, rowToRetrieved, PostgresFtsRetriever } from './retrieval'
import type { DocScope, DocType, RetrievalScope, RetrievedChunk, StoredDocument, Trust } from './types'

export const MAX_CHUNKS_PER_DOCUMENT = 4000
export const MAX_DOCUMENTS_PER_PROJECT = 200

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)

export function rowToDocument(r: Record<string, unknown>): StoredDocument & { anchorName?: string | null; anchorVersion?: string | null } {
  return {
    id: String(r.id), orgId: String(r.org_id), scope: r.scope as DocScope, scheduleId: (r.schedule_id as string) ?? null,
    title: String(r.title), fileName: String(r.file_name), format: String(r.format), docType: r.doc_type as DocType,
    trust: r.trust as Trust, classification: (r.classification as string) ?? null, sha256: String(r.sha256), sizeBytes: Number(r.size_bytes),
    pageCount: r.page_count == null ? null : Number(r.page_count), chunkCount: Number(r.chunk_count), flaggedCount: Number(r.flagged_count),
    uploadedBy: (r.uploaded_by as string) ?? null, uploadedByName: (r.uploaded_by_name as string) ?? null,
    reviewedBy: (r.reviewed_by as string) ?? null, reviewedAt: iso(r.reviewed_at), createdAt: iso(r.created_at)!,
    ...(r.anchor_name !== undefined ? { anchorName: (r.anchor_name as string) ?? null, anchorVersion: (r.anchor_version as string) ?? null } : {}),
  }
}

export const retriever = () => new PostgresFtsRetriever(query)

export async function listDocuments(s: RetrievalScope) {
  await initSchema()
  const b = buildListDocumentsSql(s)
  return (await query(b.text, b.values)).rows.map(rowToDocument)
}

export async function getDocument(s: RetrievalScope, documentId: string): Promise<StoredDocument | undefined> {
  await initSchema()
  const b = buildGetDocumentSql(s, documentId)
  const row = (await query(b.text, b.values)).rows[0]
  return row ? rowToDocument(row) : undefined
}

export async function scopedChunks(s: RetrievalScope, o: { includeUnreviewed: boolean; limit?: number }): Promise<RetrievedChunk[]> {
  await initSchema()
  const b = buildChunksSql(s, { includeUnreviewed: o.includeUnreviewed, limit: o.limit ?? 5000 })
  return (await query(b.text, b.values)).rows.map(rowToRetrieved)
}

export interface IngestInput {
  orgId: string
  scope: DocScope
  scheduleId: string | null
  title: string
  fileName: string
  docType: DocType
  classification: string | null
  uploadedBy: string
  content: Buffer
}

export interface IngestResult { document: StoredDocument; flaggedChunks: { ordinal: number; section: string | null; page: number | null; reasons: string[] }[] }

/** Extracts, chunks, screens and stores a document. Throws DocumentRejected with a user-facing message. */
export async function ingestDocument(i: IngestInput): Promise<IngestResult> {
  await initSchema()
  const { format, pages, pageCount } = await extractDocument(i.content, i.fileName)
  const drafts = chunkDocument(pages)
  if (!drafts.length) throw new DocumentRejected('No usable text was found in this document.', 'empty')
  if (drafts.length > MAX_CHUNKS_PER_DOCUMENT) throw new DocumentRejected('This document is too long to index in one piece. Split it and upload the parts.', 'too_long')
  const sha256 = createHash('sha256').update(i.content).digest('hex')
  const screened = drafts.map(d => ({ ...d, findings: detectInjection(`${d.heading ?? ''}\n${d.text}`) }))
  const flagged = screened.filter(c => c.findings.length)
  const id = randomUUID()
  await withTransaction(async q => {
    if (i.scheduleId) {
      const n = await q(`SELECT COUNT(*)::int AS n FROM project_documents WHERE org_id=$1 AND schedule_id=$2 AND deleted_at IS NULL`, [i.orgId, i.scheduleId])
      if (Number(n.rows[0].n) >= MAX_DOCUMENTS_PER_PROJECT) throw new DocumentRejected(`This project already has ${MAX_DOCUMENTS_PER_PROJECT} documents. Delete ones you no longer need first.`, 'too_many_documents')
    }
    const dup = await q(`SELECT id FROM project_documents WHERE org_id=$1 AND COALESCE(schedule_id,'')=COALESCE($2,'') AND sha256=$3 AND deleted_at IS NULL`, [i.orgId, i.scheduleId, sha256])
    if (dup.rows[0]) throw new DocumentRejected('This exact file is already attached here.', 'duplicate')
    await q(`INSERT INTO project_documents (id, org_id, scope, schedule_id, title, file_name, format, doc_type, trust, classification, sha256, size_bytes, page_count, chunk_count, flagged_count, uploaded_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'unreviewed',$9,$10,$11,$12,$13,$14,$15)`,
    [id, i.orgId, i.scope, i.scheduleId, i.title, i.fileName.slice(0, 255), format, i.docType, i.classification, sha256, i.content.length, pageCount, screened.length, flagged.length, i.uploadedBy])
    // Batched inserts (one statement per 200 passages).
    for (let k = 0; k < screened.length; k += 200) {
      const batch = screened.slice(k, k + 200)
      const values: unknown[] = []
      const rows = batch.map(c => {
        values.push(randomUUID(), i.orgId, id, c.ordinal, c.page, c.pageEnd, c.section, c.heading, c.text, c.findings.length > 0, JSON.stringify(c.findings.map(f => f.id)))
        const b = values.length - 11
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11})`
      })
      await q(`INSERT INTO document_chunks (id, org_id, document_id, ordinal, page, page_end, section, heading, text, flagged, flag_reasons) VALUES ${rows.join(',')}`, values)
    }
  })
  const row = (await query('SELECT * FROM project_documents WHERE id=$1 AND org_id=$2', [id, i.orgId])).rows[0]
  return {
    document: rowToDocument(row),
    flaggedChunks: flagged.map(c => ({ ordinal: c.ordinal, section: c.section, page: c.page, reasons: c.findings.map(f => f.id) })),
  }
}

/** Approves or un-approves a document (the caller has already been checked for visibility and role). */
export async function setDocumentTrust(orgId: string, documentId: string, trust: Trust, by: string): Promise<boolean> {
  await initSchema()
  const res = await query(`UPDATE project_documents SET trust=$3, reviewed_by=$4, reviewed_at=NOW() WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL`, [documentId, orgId, trust, by])
  return (res.rowCount ?? 0) > 0
}

/**
 * Deletes a document: its passages (and with them every index entry) and requirement reviews are
 * hard-deleted in the same transaction. The document row is kept as a tombstone holding only the id,
 * SHA-256, size and dates, so the audit trail still resolves; its title and file name are blanked.
 * Nothing else caches document text (retrieval runs live against the passages table).
 */
export async function deleteDocument(orgId: string, documentId: string): Promise<{ chunksDeleted: number } | null> {
  // (Ask AI answers that quoted the document are redacted in the same transaction.)
  await initSchema()
  return withTransaction(async q => {
    const doc = await q(`SELECT id FROM project_documents WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL FOR UPDATE`, [documentId, orgId])
    if (!doc.rows[0]) return null
    const chunks = await q(`DELETE FROM document_chunks WHERE document_id=$1 AND org_id=$2`, [documentId, orgId])
    await q(`DELETE FROM document_requirement_reviews WHERE document_id=$1 AND org_id=$2`, [documentId, orgId])
    // Derived copies: Ask AI answers that quoted this document are redacted.
    await q(`UPDATE chat_messages SET content=$3, document_ids=NULL WHERE $1 = ANY(document_ids) AND schedule_id IN (SELECT id FROM schedules WHERE org_id=$2)`,
      [documentId, orgId, '(This answer quoted a project document that has since been deleted, so it was removed.)'])
    await q(`UPDATE project_documents SET deleted_at=NOW(), title='(deleted document)', file_name='', chunk_count=0, flagged_count=0 WHERE id=$1 AND org_id=$2`, [documentId, orgId])
    return { chunksDeleted: chunks.rowCount ?? 0 }
  })
}

export async function requirementReviews(orgId: string, documentIds: string[]): Promise<Map<string, { status: string; userId: string | null; createdAt: string }>> {
  if (!documentIds.length) return new Map()
  await initSchema()
  const res = await query(`SELECT document_id, requirement_key, status, user_id, created_at FROM document_requirement_reviews WHERE org_id=$1 AND document_id = ANY($2::text[])`, [orgId, documentIds])
  return new Map(res.rows.map(r => [`${r.document_id}:${r.requirement_key}`, { status: String(r.status), userId: (r.user_id as string) ?? null, createdAt: iso(r.created_at)! }]))
}

export async function saveRequirementReview(orgId: string, r: { documentId: string; key: string; kind: string; status: 'confirmed' | 'dismissed'; userId: string }) {
  await initSchema()
  await query(`INSERT INTO document_requirement_reviews (org_id, document_id, requirement_key, kind, status, user_id) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (document_id, requirement_key) DO UPDATE SET status=EXCLUDED.status, user_id=EXCLUDED.user_id, created_at=NOW()`,
  [orgId, r.documentId, r.key, r.kind, r.status, r.userId])
}

/** Every live document of the organization with its passages, for the organization data export. */
export async function exportDocuments(orgId: string) {
  await initSchema()
  const docs = (await query(`SELECT * FROM project_documents WHERE org_id=$1 AND deleted_at IS NULL ORDER BY created_at`, [orgId])).rows.map(rowToDocument)
  const chunks = (await query(`SELECT document_id, ordinal, page, page_end, section, heading, text, flagged, flag_reasons FROM document_chunks WHERE org_id=$1 ORDER BY document_id, ordinal`, [orgId])).rows
  const reviews = (await query(`SELECT document_id, requirement_key, kind, status, user_id, created_at FROM document_requirement_reviews WHERE org_id=$1`, [orgId])).rows
  return docs.map(d => ({
    ...d,
    passages: chunks.filter(c => c.document_id === d.id).map(c => ({ ordinal: c.ordinal, page: c.page, pageEnd: c.page_end, section: c.section, heading: c.heading, text: c.text, flagged: c.flagged, flagReasons: c.flag_reasons })),
    requirementReviews: reviews.filter(r => r.document_id === d.id).map(r => ({ key: r.requirement_key, kind: r.kind, status: r.status, userId: r.user_id, at: iso(r.created_at) })),
  }))
}
