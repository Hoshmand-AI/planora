import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The Anthropic SDK is mocked: no test makes a network call.
const sdk = vi.hoisted(() => {
  class APIError extends Error {
    constructor(readonly status: number | undefined, message = 'api error') { super(message) }
  }
  class BadRequestError extends APIError { constructor() { super(400) } }
  class AuthenticationError extends APIError { constructor() { super(401) } }
  class PermissionDeniedError extends APIError { constructor() { super(403) } }
  class RateLimitError extends APIError { constructor() { super(429) } }
  class InternalServerError extends APIError { constructor() { super(529) } }
  class APIConnectionError extends APIError { constructor() { super(undefined) } }
  const create = vi.fn() // beta endpoint: server-side refusal fallback on (the default)
  const plainCreate = vi.fn() // regular endpoint: PLANORA_AI_FALLBACK=off
  const constructed: unknown[] = []
  class Anthropic {
    static APIError = APIError
    static BadRequestError = BadRequestError
    static AuthenticationError = AuthenticationError
    static PermissionDeniedError = PermissionDeniedError
    static RateLimitError = RateLimitError
    static InternalServerError = InternalServerError
    static APIConnectionError = APIConnectionError
    messages = { create: plainCreate }
    beta = { messages: { create } }
    constructor(opts: unknown) { constructed.push(opts) }
  }
  return { Anthropic, create, plainCreate, constructed, errors: { APIError, BadRequestError, AuthenticationError, PermissionDeniedError, RateLimitError, InternalServerError, APIConnectionError } }
})
vi.mock('@anthropic-ai/sdk', () => ({ default: sdk.Anthropic }))

const audits = vi.hoisted(() => [] as { action: string; targetId?: string; detail?: Record<string, unknown> }[])
vi.mock('@/lib/server/audit', () => ({ auditQuietly: vi.fn(async (e: (typeof audits)[number]) => { audits.push(e) }) }))
vi.mock('@/lib/server/rate-limit', () => ({
  hit: vi.fn(async () => ({ ok: true, count: 1, limit: 300, retryAfterSec: 0 })),
  aiQuotaKey: (o: string) => `ai:org:${o}`,
  LIMITS: { aiPerUser: { limit: 20, windowSec: 60 } },
}))
vi.mock('@/lib/db', () => ({ query: vi.fn(async () => { throw new Error('db down') }) }))

import { createAnthropicAdapter, toAnthropicPayload, ANTHROPIC_MAX_TOKENS } from './anthropic-adapter'
import { AiProviderError, AiRefusalError, AI_REFUSAL_MESSAGE, aiFallbackEnabled, estimateCostUsd, MODEL_REGISTRY } from './gateway'
import { chat, chatJson, llmStatus, resolveLlmConfig, selectCloudProvider, RestrictedDataError, DEFAULT_CLOUD_MODEL, approvedModels } from './provider'
import { runWithRequest, type RequestInfo } from '@/lib/server/context'

const reply = (over: Record<string, unknown> = {}) => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_details: null,
  content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: 'Hello ' }, { type: 'text', text: 'there' }],
  usage: { input_tokens: 1200, output_tokens: 340 },
  ...over,
})

const req = (over: Partial<RequestInfo> = {}): RequestInfo => ({ requestId: 't', method: 'POST', path: '/api/x', ip: null, userAgent: null, orgId: 'o1', userId: 'u1', ...over })

beforeEach(() => { sdk.create.mockReset(); sdk.plainCreate.mockReset(); audits.length = 0 })
afterEach(() => vi.unstubAllEnvs())

describe('Anthropic adapter: request shape', () => {
  it('hoists system messages into the top-level system field and keeps only user/assistant turns', () => {
    const p = toAnthropicPayload([
      { role: 'system', content: 'You are a scheduler.' },
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' },
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Q2' },
    ])
    expect(p.system).toBe('You are a scheduler.\n\nBe brief.')
    expect(p.messages).toEqual([{ role: 'user', content: 'Q1' }, { role: 'assistant', content: 'A1' }, { role: 'user', content: 'Q2' }])
  })

  it('always starts with a user turn and never ends on an assistant turn (no prefill)', () => {
    const p = toAnthropicPayload([{ role: 'system', content: 'S' }, { role: 'assistant', content: 'A' }])
    expect(p.messages[0].role).toBe('user')
    expect(p.messages[p.messages.length - 1].role).toBe('user')
    expect(toAnthropicPayload([{ role: 'user', content: 'only' }]).system).toBeUndefined()
  })

  it('sends model, max_tokens, system, messages, effort and the server-side fallback — and no sampling or thinking parameters', async () => {
    sdk.create.mockResolvedValue(reply())
    await createAnthropicAdapter({ apiKey: 'k' }).complete({ model: 'claude-opus-5-5', maxTokens: 700, temperature: 0, messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }] })
    expect(sdk.plainCreate).not.toHaveBeenCalled()
    const body = sdk.create.mock.calls[0][0]
    expect(body).toEqual({
      model: 'claude-opus-5-5', max_tokens: ANTHROPIC_MAX_TOKENS, system: 'S', messages: [{ role: 'user', content: 'U' }], output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    })
    for (const k of ['temperature', 'top_p', 'top_k', 'thinking', 'budget_tokens']) expect(body).not.toHaveProperty(k)
  })

  it('uses the regular endpoint without fallback parameters when the fallback is switched off', async () => {
    sdk.plainCreate.mockResolvedValue(reply())
    const r = await createAnthropicAdapter({ apiKey: 'k', fallback: false }).complete({ model: 'claude-opus-5-5', maxTokens: 700, messages: [{ role: 'user', content: 'U' }] })
    expect(sdk.create).not.toHaveBeenCalled()
    const body = sdk.plainCreate.mock.calls[0][0]
    expect(body).not.toHaveProperty('betas')
    expect(body).not.toHaveProperty('fallbacks')
    expect(r.fallbackUsed).toBe(false)
  })

  it('PLANORA_AI_FALLBACK=off disables the fallback; anything else leaves it on', () => {
    expect(aiFallbackEnabled({})).toBe(true)
    expect(aiFallbackEnabled({ PLANORA_AI_FALLBACK: 'on' })).toBe(true)
    for (const v of ['off', 'OFF', 'false', '0', 'no', 'disabled']) expect(aiFallbackEnabled({ PLANORA_AI_FALLBACK: v })).toBe(false)
  })
})

describe('Anthropic adapter: response handling', () => {
  it('extracts only text blocks and maps usage, model and provider', async () => {
    sdk.create.mockResolvedValue(reply())
    const r = await createAnthropicAdapter({ apiKey: 'k' }).complete({ model: 'claude-opus-5-5', maxTokens: 100, messages: [{ role: 'user', content: 'hi' }] })
    expect(r).toEqual({ text: 'Hello there', usage: { inputTokens: 1200, outputTokens: 340 }, model: 'claude-opus-5-5', provider: 'anthropic', truncated: false, fallbackUsed: false })
  })

  it('reports when a fallback model served the turn, and which model it was', async () => {
    sdk.create.mockResolvedValue(reply({
      model: 'claude-opus-4-8',
      usage: { input_tokens: 10, output_tokens: 5, iterations: [{ type: 'message', input_tokens: 10, output_tokens: 0 }, { type: 'fallback_message', input_tokens: 10, output_tokens: 5 }] },
    }))
    const r = await createAnthropicAdapter({ apiKey: 'k' }).complete({ model: 'claude-opus-5-5', maxTokens: 100, messages: [{ role: 'user', content: 'hi' }] })
    expect(r).toMatchObject({ fallbackUsed: true, model: 'claude-opus-4-8', text: 'Hello there' })
  })

  it('a final refusal after the fallback chain is still a refusal', async () => {
    sdk.create.mockResolvedValue(reply({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'bio', explanation: null }, usage: { input_tokens: 1, output_tokens: 1, iterations: [{ type: 'fallback_message' }] } }))
    await expect(createAnthropicAdapter({ apiKey: 'k' }).complete({ model: 'claude-opus-5-5', maxTokens: 100, messages: [{ role: 'user', content: 'x' }] })).rejects.toBeInstanceOf(AiRefusalError)
  })

  it('treats stop_reason "refusal" as a refusal, never as an answer', async () => {
    sdk.create.mockResolvedValue(reply({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: null }, content: [{ type: 'text', text: 'partial text that must not be shown' }] }))
    const p = createAnthropicAdapter({ apiKey: 'k' }).complete({ model: 'claude-opus-5-5', maxTokens: 100, messages: [{ role: 'user', content: 'x' }] })
    await expect(p).rejects.toBeInstanceOf(AiRefusalError)
    await expect(p).rejects.toMatchObject({ message: AI_REFUSAL_MESSAGE, provider: 'anthropic', category: 'cyber' })
  })

  it('flags truncation at max_tokens', async () => {
    sdk.create.mockResolvedValue(reply({ stop_reason: 'max_tokens' }))
    const r = await createAnthropicAdapter({ apiKey: 'k' }).complete({ model: 'claude-opus-5-5', maxTokens: 100, messages: [{ role: 'user', content: 'x' }] })
    expect(r.truncated).toBe(true)
  })

  it('maps typed SDK errors to gateway provider errors', async () => {
    const cases: [Error, string, number | null][] = [
      [new sdk.errors.RateLimitError(), 'rate_limit', 429],
      [new sdk.errors.AuthenticationError(), 'auth', 401],
      [new sdk.errors.BadRequestError(), 'bad_request', 400],
      [new sdk.errors.APIConnectionError(), 'connection', null],
      [new sdk.errors.InternalServerError(), 'upstream', 529],
    ]
    const a = createAnthropicAdapter({ apiKey: 'k' })
    for (const [err, kind, status] of cases) {
      sdk.create.mockRejectedValueOnce(err)
      const e = await a.complete({ model: 'claude-opus-5-5', maxTokens: 1, messages: [{ role: 'user', content: 'x' }] }).catch(x => x)
      expect(e).toBeInstanceOf(AiProviderError)
      expect(e).toMatchObject({ provider: 'anthropic', kind, status })
    }
    const other = new TypeError('boom')
    sdk.create.mockRejectedValueOnce(other)
    await expect(a.complete({ model: 'claude-opus-5-5', maxTokens: 1, messages: [{ role: 'user', content: 'x' }] })).rejects.toBe(other)
  })
})

describe('Provider selection from env', () => {
  it('defaults to anthropic with an Anthropic key, falls back to openai, else offline', () => {
    expect(selectCloudProvider({ ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o' }).provider).toBe('anthropic')
    expect(selectCloudProvider({ OPENAI_API_KEY: 'o' }).provider).toBe('openai')
    expect(selectCloudProvider({}).provider).toBeNull()
    const c = resolveLlmConfig({ ANTHROPIC_API_KEY: 'a' })
    expect(c).toMatchObject({ mode: 'cloud', provider: 'anthropic', model: 'claude-opus-5-5', host: 'api.anthropic.com', certified: true })
    expect(DEFAULT_CLOUD_MODEL).toBe('claude-opus-5-5')
    expect(resolveLlmConfig({}).mode).toBe('offline')
  })

  it('PLANORA_AI_PROVIDER picks the provider explicitly', () => {
    expect(resolveLlmConfig({ PLANORA_AI_PROVIDER: 'openai', ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o' })).toMatchObject({ provider: 'openai', model: 'gpt-4o-2024-11-20', host: 'api.openai.com' })
    const missing = resolveLlmConfig({ PLANORA_AI_PROVIDER: 'anthropic', OPENAI_API_KEY: 'o' })
    expect(missing).toMatchObject({ mode: 'offline', provider: null })
    expect(missing.error).toMatch(/ANTHROPIC_API_KEY is not set/)
    expect(resolveLlmConfig({ PLANORA_AI_PROVIDER: 'acme', ANTHROPIC_API_KEY: 'a' }).error).toMatch(/Unknown PLANORA_AI_PROVIDER/)
  })

  it('approves the Claude models with exact ids and refuses a model from another provider', () => {
    for (const id of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']) {
      expect(approvedModels({})).toContain(id)
      expect(resolveLlmConfig({ ANTHROPIC_API_KEY: 'a', LLM_MODEL: id })).toMatchObject({ mode: 'cloud', model: id, certified: true })
    }
    expect(resolveLlmConfig({ ANTHROPIC_API_KEY: 'a', LLM_MODEL: 'gpt-4o' }).error).toMatch(/served by openai/)
    expect(resolveLlmConfig({ ANTHROPIC_API_KEY: 'a', LLM_MODEL: 'claude-opus-5-5-20260101' }).error).toMatch(/approved model registry/)
  })

  it('marks certified models and approved alternates', () => {
    expect(MODEL_REGISTRY.filter(m => m.provider === 'anthropic').every(m => m.certified)).toBe(true)
    expect(resolveLlmConfig({ PLANORA_AI_PROVIDER: 'openai', OPENAI_API_KEY: 'o' }).certified).toBe(true)
    expect(resolveLlmConfig({ PLANORA_AI_PROVIDER: 'openai', OPENAI_API_KEY: 'o', LLM_MODEL: 'gpt-4o' }).certified).toBe(false)
  })

  it('still refuses cloud AI in air-gapped mode for every provider', () => {
    expect(resolveLlmConfig({ PLANORA_AIRGAPPED: 'true', PLANORA_AI_MODE: 'cloud', ANTHROPIC_API_KEY: 'a' })).toMatchObject({ mode: 'offline', provider: null })
    expect(resolveLlmConfig({ PLANORA_AIRGAPPED: 'true', ANTHROPIC_API_KEY: 'a' }).mode).toBe('offline')
  })

  it('estimates spend from the published per-1M-token prices', () => {
    expect(estimateCostUsd('claude-opus-5-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(24)
    expect(estimateCostUsd('claude-sonnet-5-5', { inputTokens: 1_000_000, outputTokens: 0 })).toBe(2)
    expect(estimateCostUsd('claude-haiku-5-5', { inputTokens: 0, outputTokens: 2_000_000 })).toBe(1)
    expect(estimateCostUsd('llama3.1:8b', { inputTokens: 5, outputTokens: 5 })).toBeNull()
  })
})

describe('Gateway with the Anthropic provider', () => {
  it('exposes the provider and certification in the LLM status', () => {
    vi.stubEnv('PLANORA_AI_MODE', '')
    vi.stubEnv('PLANORA_AIRGAPPED', '')
    vi.stubEnv('PLANORA_AI_PROVIDER', 'anthropic')
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test')
    vi.stubEnv('LLM_MODEL', '')
    vi.stubEnv('PLANORA_APPROVED_MODELS', '')
    const s = llmStatus()
    expect(s).toMatchObject({ mode: 'cloud', provider: 'anthropic', model: 'claude-opus-5-5', certified: true })
    expect(s).not.toHaveProperty('apiKey')
  })

  it('audits provider, model, served version and usage — never the prompt or the answer', async () => {
    vi.stubEnv('PLANORA_AI_MODE', 'cloud')
    vi.stubEnv('PLANORA_AIRGAPPED', '')
    vi.stubEnv('PLANORA_AI_PROVIDER', 'anthropic')
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test')
    vi.stubEnv('LLM_MODEL', '')
    vi.stubEnv('PLANORA_APPROVED_MODELS', '')
    vi.stubEnv('PLANORA_AI_FALLBACK', '')
    sdk.create.mockResolvedValue(reply())
    const out = await runWithRequest(req(), () => chat([{ role: 'system', content: 'SECRET-SYSTEM' }, { role: 'user', content: 'SECRET-QUESTION' }], { purpose: 'ask_ai' }))
    expect(out).toBe('Hello there')
    const ev = audits.find(a => a.action === 'ai.request')!
    expect(ev.detail).toMatchObject({ provider: 'anthropic', model: 'claude-opus-5-5', modelVersion: 'claude-opus-5-5', inputTokens: 1200, outputTokens: 340, ok: true, certified: true, truncated: false, fallbackUsed: false })
    expect(ev.detail!.sdk).toMatch(/^@anthropic-ai\/sdk@/)
    expect(ev.detail!.estimatedCostUsd).toBeCloseTo((1200 * 4 + 340 * 20) / 1e6, 9)
    const serialized = JSON.stringify(audits)
    expect(serialized).not.toMatch(/SECRET-SYSTEM|SECRET-QUESTION|Hello there|sk-ant-test/)
  })

  it('audits that a fallback served the turn and the served model', async () => {
    vi.stubEnv('PLANORA_AI_MODE', 'cloud')
    vi.stubEnv('PLANORA_AIRGAPPED', '')
    vi.stubEnv('PLANORA_AI_PROVIDER', 'anthropic')
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test')
    vi.stubEnv('LLM_MODEL', '')
    vi.stubEnv('PLANORA_APPROVED_MODELS', '')
    vi.stubEnv('PLANORA_AI_FALLBACK', '')
    sdk.create.mockResolvedValue(reply({ model: 'claude-opus-4-8', usage: { input_tokens: 10, output_tokens: 5, iterations: [{ type: 'fallback_message' }] } }))
    await runWithRequest(req(), () => chat([{ role: 'user', content: 'x' }]))
    expect(audits.find(a => a.action === 'ai.request')!.detail).toMatchObject({ model: 'claude-opus-5-5', modelVersion: 'claude-opus-4-8', fallbackUsed: true, ok: true })
  })

  it('PLANORA_AI_FALLBACK=off routes Claude calls to the regular endpoint', async () => {
    vi.stubEnv('PLANORA_AI_MODE', 'cloud')
    vi.stubEnv('PLANORA_AIRGAPPED', '')
    vi.stubEnv('PLANORA_AI_PROVIDER', 'anthropic')
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test')
    vi.stubEnv('LLM_MODEL', '')
    vi.stubEnv('PLANORA_APPROVED_MODELS', '')
    vi.stubEnv('PLANORA_AI_FALLBACK', 'off')
    sdk.plainCreate.mockResolvedValue(reply())
    await expect(runWithRequest(req(), () => chat([{ role: 'user', content: 'x' }]))).resolves.toBe('Hello there')
    expect(sdk.create).not.toHaveBeenCalled()
    expect(sdk.plainCreate).toHaveBeenCalledTimes(1)
    expect(audits.find(a => a.action === 'ai.request')!.detail).toMatchObject({ fallbackUsed: false, ok: true })
  })

  it('records a refusal and surfaces it as a typed error; structured calls degrade to null', async () => {
    vi.stubEnv('PLANORA_AI_MODE', 'cloud')
    vi.stubEnv('PLANORA_AIRGAPPED', '')
    vi.stubEnv('PLANORA_AI_PROVIDER', 'anthropic')
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test')
    vi.stubEnv('LLM_MODEL', '')
    vi.stubEnv('PLANORA_APPROVED_MODELS', '')
    vi.stubEnv('PLANORA_AI_FALLBACK', '')
    sdk.create.mockResolvedValue(reply({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: null, explanation: null } }))
    await expect(runWithRequest(req(), () => chat([{ role: 'user', content: 'x' }]))).rejects.toBeInstanceOf(AiRefusalError)
    expect(audits.find(a => a.action === 'ai.request')!.detail).toMatchObject({ provider: 'anthropic', ok: false, refused: true })
    await expect(runWithRequest(req(), () => chatJson([{ role: 'user', content: 'x' }], v => v))).resolves.toBeNull()
  })

  it('CUI guard still blocks a Claude call before anything is sent', async () => {
    vi.stubEnv('PLANORA_AI_MODE', 'cloud')
    vi.stubEnv('PLANORA_AIRGAPPED', '')
    vi.stubEnv('PLANORA_AI_PROVIDER', 'anthropic')
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test')
    vi.stubEnv('LLM_MODEL', '')
    vi.stubEnv('PLANORA_APPROVED_MODELS', '')
    for (const c of ['cui', 'classified']) {
      const r = req({ dataClassification: async () => c })
      await expect(runWithRequest(r, () => chat([{ role: 'user', content: 'secret project details' }]))).rejects.toBeInstanceOf(RestrictedDataError)
      await expect(runWithRequest(r, () => chatJson([{ role: 'user', content: 'x' }], v => v))).rejects.toBeInstanceOf(RestrictedDataError)
    }
    expect(sdk.create).not.toHaveBeenCalled()
    expect(sdk.plainCreate).not.toHaveBeenCalled()
    expect(audits.filter(a => a.action === 'ai.blocked_restricted_data').every(a => a.detail?.provider === 'anthropic')).toBe(true)
  })

  it('sends nothing when the organization has turned AI off', async () => {
    vi.stubEnv('PLANORA_AI_MODE', 'cloud')
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test')
    vi.stubEnv('PLANORA_AI_PROVIDER', 'anthropic')
    await expect(runWithRequest(req({ aiEnabled: false }), () => chat([{ role: 'user', content: 'x' }]))).resolves.toBeNull()
    expect(sdk.create).not.toHaveBeenCalled()
    expect(sdk.plainCreate).not.toHaveBeenCalled()
  })
})
