import { describe, expect, it, vi } from 'vitest'
import { embed, embeddingConfig, fuse, EmbeddingError } from './embeddings'
import { anyTermsQuery, buildVectorSearchSql, HybridRetriever } from './retrieval'
import { expansionsFor, tsTerm } from './vocabulary'
import type { RetrievalScope } from './types'

const full = { all: true } as RetrievalScope['access']
const scope: RetrievalScope = { orgId: 'org_1', scheduleId: 'sch_1', access: full }

describe('construction vocabulary', () => {
  it('expands abbreviations and phrases both ways', () => {
    expect(expansionsFor('What are the LDs?')).toEqual(expect.arrayContaining(['liquidated damages', 'delay damages']))
    expect(expansionsFor('days after the notice to proceed')).toContain('ntp')
    expect(expansionsFor('liquidated damages per day')).toContain('lds')
    expect(expansionsFor('the weekly meeting')).toEqual([])
  })
  it('turns phrases into tsquery phrase operands and never passes operators through', () => {
    expect(tsTerm('notice to proceed')).toBe('(notice <-> to <-> proceed)')
    expect(tsTerm("a'b | !c")).toBe('(a <-> b <-> c)')
    expect(anyTermsQuery('LDs?')).toBe('lds | ld | (liquidated <-> damages) | (delay <-> damages)')
  })
})

describe('embedding model must be inside the network', () => {
  it('is off unless a model is named', () => {
    expect(embeddingConfig({}).enabled).toBe(false)
  })
  it('accepts loopback, private and .internal hosts', () => {
    for (const url of ['http://localhost:11434/v1', 'http://10.0.4.2:8000/v1', 'http://gpu01.enclave.internal/v1', 'http://192.168.1.5/v1']) {
      expect(embeddingConfig({ RUNF9_EMBEDDINGS_MODEL: 'nomic-embed-text', RUNF9_EMBEDDINGS_URL: url }).enabled).toBe(true)
    }
  })
  it('refuses any public host, including cloud AI providers, in every deployment', () => {
    for (const url of ['https://api.openai.com/v1', 'https://api.anthropic.com/v1', 'https://my-model.example.com/v1', 'http://8.8.8.8/v1']) {
      const c = embeddingConfig({ RUNF9_EMBEDDINGS_MODEL: 'text-embedding-3-small', RUNF9_EMBEDDINGS_URL: url })
      expect(c.enabled).toBe(false)
      expect(c.error).toMatch(/not a private\/on-prem address/)
    }
  })
  it('allows a named on-prem host listed by the customer', () => {
    expect(embeddingConfig({ RUNF9_EMBEDDINGS_MODEL: 'm', RUNF9_EMBEDDINGS_URL: 'https://models.acme-corp.net/v1', RUNF9_ALLOWED_HOSTS: 'models.acme-corp.net' }).enabled).toBe(true)
  })
  it('falls back to the local LLM endpoint', () => {
    expect(embeddingConfig({ RUNF9_EMBEDDINGS_MODEL: 'm', LLM_BASE_URL: 'http://127.0.0.1:11434/v1/' }).baseURL).toBe('http://127.0.0.1:11434/v1')
  })
})

describe('embed()', () => {
  const cfg = embeddingConfig({ RUNF9_EMBEDDINGS_MODEL: 'm', RUNF9_EMBEDDINGS_URL: 'http://localhost:9/v1' })
  it('normalizes vectors and keeps input order', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ data: [{ index: 1, embedding: [0, 2] }, { index: 0, embedding: [3, 4] }] }))) as unknown as typeof fetch
    const v = await embed(['a', 'b'], cfg, f)
    expect(v[0]).toEqual([0.6, 0.8])
    expect(v[1]).toEqual([0, 1])
  })
  it('refuses to call anything when disabled', async () => {
    const f = vi.fn() as unknown as typeof fetch
    await expect(embed(['a'], embeddingConfig({ RUNF9_EMBEDDINGS_MODEL: 'm', RUNF9_EMBEDDINGS_URL: 'https://api.openai.com/v1' }), f)).rejects.toBeInstanceOf(EmbeddingError)
    expect(f).not.toHaveBeenCalled()
  })
  it('rejects malformed responses', async () => {
    const f = (async () => new Response(JSON.stringify({ data: [{ embedding: ['x'] }] }))) as unknown as typeof fetch
    await expect(embed(['a'], cfg, f)).rejects.toBeInstanceOf(EmbeddingError)
  })
})

describe('meaning-based search', () => {
  it('applies the same organization and project scope as keyword search', () => {
    const b = buildVectorSearchSql(scope, [0.6, 0.8], 'm', { match: 'any', includeUnreviewed: false, limit: 8, minSimilarity: 0.3 })
    expect(b.values.slice(0, 2)).toEqual(['org_1', 'sch_1'])
    expect(b.text).toMatch(/c\.org_id = \$1/)
    expect(b.text).toMatch(/d\.org_id = \$1/)
    expect(b.text).toMatch(/e\.org_id = c\.org_id/)
    expect(b.text).toMatch(/s\.id = \$2 AND s\.org_id = \$1/)
    expect(b.text).toMatch(/OR d\.trust = 'approved'/)
  })
  it('fuses rankings', () => {
    const s = fuse([['a', 'b'], ['b', 'c']])
    expect(s.get('b')!).toBeGreaterThan(s.get('a')!)
    expect(s.get('a')!).toBeGreaterThan(s.get('c')!)
  })
  const row = (id: string, tier: number) => ({ chunk_id: id, document_id: 'd', ordinal: 1, page: 1, page_end: 1, section: '1.5', heading: null, text: 't', flagged: false, flag_reasons: [], title: 'Spec', doc_type: 'contract', trust: 'approved', scope: 'project', classification: null, rank: 1, tier })
  const cfg = embeddingConfig({ RUNF9_EMBEDDINGS_MODEL: 'm', RUNF9_EMBEDDINGS_URL: 'http://localhost:9/v1' })
  it('blends keyword and meaning results and keeps tier order', async () => {
    const q = vi.fn(async (text: string) => ({ rows: /chunk_embeddings/.test(text) ? [row('sem', 1), row('both', 1)] : [row('kw', 2), row('both', 1)] }))
    const r = new HybridRetriever(q, cfg, async () => [[1, 0]])
    const out = await r.search(scope, 'when is the project due', { match: 'any', includeUnreviewed: false, limit: 8 })
    expect(out.map(c => c.chunkId)).toEqual(['both', 'sem', 'kw'])
  })
  it('falls back to keyword results when the model is down', async () => {
    const q = vi.fn(async () => ({ rows: [row('kw', 1)] }))
    const r = new HybridRetriever(q, cfg, async () => { throw new EmbeddingError('down') })
    const out = await r.search(scope, 'float', { match: 'any', includeUnreviewed: false, limit: 8 })
    expect(out.map(c => c.chunkId)).toEqual(['kw'])
    expect(q).toHaveBeenCalledTimes(1)
  })
})
