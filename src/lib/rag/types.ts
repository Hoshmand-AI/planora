// Shared types for retrieval-augmented grounding over customer project documents.

export const DOC_TYPES = ['contract', 'scheduling_spec', 'owner_requirement', 'specification', 'other'] as const
export type DocType = typeof DOC_TYPES[number]
export const DOC_TYPE_LABELS: Record<DocType, string> = {
  contract: 'Contract',
  scheduling_spec: 'Scheduling specification',
  owner_requirement: 'Owner requirements',
  specification: 'Specification',
  other: 'Other',
}
export const isDocType = (v: unknown): v is DocType => typeof v === 'string' && (DOC_TYPES as readonly string[]).includes(v)

export type Trust = 'approved' | 'unreviewed'
export type DocScope = 'project' | 'org'

/** Where a retrieved passage sits in the grounding hierarchy (lower = more authoritative). */
export type Tier = 1 | 2 | 3 | 4
export const TIER_LABELS: Record<Tier, string> = {
  1: 'Approved project document',
  2: 'Organization standard',
  3: 'Contract / owner requirement (unreviewed)',
  4: 'Unreviewed project document',
}

/** A chunk produced by the chunker, before it is stored. */
export interface DraftChunk {
  ordinal: number
  page: number | null
  pageEnd: number | null
  /** Citation anchor, e.g. "1.3.4", "Article 8", "Section 01 32 16 1.3" */
  section: string | null
  /** Nearest heading text */
  heading: string | null
  text: string
}

export interface StoredDocument {
  id: string
  orgId: string
  scope: DocScope
  scheduleId: string | null
  title: string
  fileName: string
  format: string
  docType: DocType
  trust: Trust
  classification: string | null
  sha256: string
  sizeBytes: number
  pageCount: number | null
  chunkCount: number
  flaggedCount: number
  uploadedBy: string | null
  uploadedByName: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  createdAt: string
}

/** A passage returned by retrieval, with its provenance. */
export interface RetrievedChunk {
  chunkId: string
  documentId: string
  ordinal: number
  page: number | null
  pageEnd: number | null
  section: string | null
  heading: string | null
  text: string
  flagged: boolean
  flagReasons: string[]
  title: string
  docType: DocType
  trust: Trust
  scope: DocScope
  classification: string | null
  rank: number
  tier: Tier
  /** The exact citation string the model must use, e.g. "[Spec 01 32 16 §1.3.4 p.3]" */
  citation: string
}

/** Who is asking and for which project: every retrieval is bounded by this, in SQL. */
export interface RetrievalScope {
  orgId: string
  /** The schedule (upload) that identifies the project; its series shares documents */
  scheduleId: string
  access: import('@/lib/server/context').WorkspaceAccess
}

export interface RetrievalOptions {
  /** Include unreviewed documents (the user opted in) */
  includeUnreviewed: boolean
  limit: number
  /** 'all' = every term must match (search box); 'any' = ranked OR match (questions) */
  match: 'all' | 'any'
}

/**
 * Retrieval backend. The Postgres full-text implementation lives in retrieval.ts; a vector backend
 * can implement the same interface later, as long as it applies the same scope in its own query.
 */
export interface Retriever {
  readonly backend: string
  search(scope: RetrievalScope, query: string, opts: RetrievalOptions): Promise<RetrievedChunk[]>
}
