// Meaning-based ("semantic") search for project documents, with a hard rule: passages and questions
// are only ever turned into vectors by an embedding model INSIDE the customer's network. A cloud
// embedding service is not supported at all, and a model on a public address is refused, in every
// deployment, so turning this on can never send document text outside.
//
//   RUNF9_EMBEDDINGS_MODEL  model name on the endpoint (e.g. nomic-embed-text in Ollama). Unset = off.
//   RUNF9_EMBEDDINGS_URL    OpenAI-compatible base URL (…/v1). Defaults to LLM_BASE_URL.
//   RUNF9_ALLOWED_HOSTS     extra on-prem host names that count as inside the network (shared with the AI gateway).
//
// Vectors are stored in chunk_embeddings (REAL[], deleted with their passage) and compared inside
// Postgres, under the same authorization SQL as keyword search (retrieval.ts). Keyword search always
// runs too, so search keeps working if the model is down or a passage has no vector yet.

import { currentRequest } from '@/lib/server/context'
import { isAllowedAirgapHost } from '@/lib/llm/provider'

export interface EmbeddingConfig {
  enabled: boolean
  model: string | null
  baseURL: string | null
  host: string | null
  /** Why it is off, when it is configured but refused */
  error?: string
}

type Env = Record<string, string | undefined>

export function embeddingConfig(env: Env = process.env): EmbeddingConfig {
  const model = (env.RUNF9_EMBEDDINGS_MODEL || '').trim()
  if (!model) return { enabled: false, model: null, baseURL: null, host: null }
  const base = (env.RUNF9_EMBEDDINGS_URL || env.LLM_BASE_URL || '').trim().replace(/\/$/, '')
  if (!base) return { enabled: false, model, baseURL: null, host: null, error: 'RUNF9_EMBEDDINGS_URL (or LLM_BASE_URL) is not set.' }
  let host: string
  try { host = new URL(base).hostname } catch { return { enabled: false, model, baseURL: null, host: null, error: `Invalid embeddings URL: ${base}` } }
  if (!isAllowedAirgapHost(host, (env.RUNF9_ALLOWED_HOSTS || '').split(','))) {
    return { enabled: false, model, baseURL: null, host, error: `Embedding host ${host} is not a private/on-prem address. Document text is only embedded inside your network.` }
  }
  return { enabled: true, model, baseURL: base, host }
}

/** On for this request: configured, inside the network, and the organization has not switched AI off. */
export function embeddingsActive(env: Env = process.env): EmbeddingConfig {
  const cfg = embeddingConfig(env)
  if (cfg.enabled && currentRequest()?.aiEnabled === false) return { ...cfg, enabled: false, error: 'AI is turned off for your organization' }
  return cfg
}

export class EmbeddingError extends Error {}

const unit = (v: number[]): number[] => {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
  return n > 0 ? v.map(x => x / n) : v
}

/**
 * Embeds texts with the configured in-network model (OpenAI-compatible POST /embeddings). Vectors are
 * normalized to unit length, so a dot product is the cosine similarity.
 */
export async function embed(texts: string[], cfg: EmbeddingConfig = embeddingsActive(), fetchImpl: typeof fetch = fetch): Promise<number[][]> {
  if (!cfg.enabled || !cfg.baseURL || !cfg.model) throw new EmbeddingError(cfg.error || 'Embeddings are not configured.')
  if (!texts.length) return []
  const res = await fetchImpl(`${cfg.baseURL}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(process.env.LLM_API_KEY ? { Authorization: `Bearer ${process.env.LLM_API_KEY}` } : {}) },
    body: JSON.stringify({ model: cfg.model, input: texts.map(t => t.slice(0, 8000)) }),
    signal: AbortSignal.timeout(60_000),
    redirect: 'error',
  })
  if (!res.ok) throw new EmbeddingError(`Embedding model returned HTTP ${res.status}.`)
  const body = await res.json().catch(() => null) as { data?: { embedding?: unknown; index?: number }[] } | null
  const data = Array.isArray(body?.data) ? [...body!.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)) : []
  if (data.length !== texts.length) throw new EmbeddingError('Embedding model returned the wrong number of vectors.')
  const vectors = data.map(d => Array.isArray(d.embedding) && d.embedding.every(x => typeof x === 'number' && Number.isFinite(x)) ? unit(d.embedding as number[]) : null)
  if (vectors.some(v => !v || !v.length) || new Set(vectors.map(v => v!.length)).size !== 1) throw new EmbeddingError('Embedding model returned invalid vectors.')
  return vectors as number[][]
}

/** Reciprocal-rank fusion of two ranked id lists (k = 60, the usual constant). Higher is better. */
export function fuse(lists: string[][], k = 60): Map<string, number> {
  const score = new Map<string, number>()
  for (const list of lists) list.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (k + i + 1)))
  return score
}
