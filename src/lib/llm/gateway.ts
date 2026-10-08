// Provider-agnostic AI gateway contract. provider.ts decides *where* a call may go (mode, CUI guard,
// quotas, approved models, audit); an adapter only knows *how* to talk to one provider's API.
// Adding a provider means adding an adapter + registry entries — callers never change.

/** Which adapter served a call. 'local' is any OpenAI-compatible endpoint (Ollama, vLLM, …). */
export type ProviderName = 'anthropic' | 'openai' | 'local'

/** Cloud providers selectable with PLANORA_AI_PROVIDER. */
export type CloudProvider = Extract<ProviderName, 'anthropic' | 'openai'>

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export interface LlmRequest {
  model: string
  messages: ChatMessage[]
  /** Upper bound on visible output; adapters may raise it where the model also spends tokens thinking */
  maxTokens: number
  /** Honored only by providers/models that accept sampling parameters */
  temperature?: number
}

export interface LlmUsage { inputTokens: number; outputTokens: number }

export interface LlmResult {
  text: string | null
  usage: LlmUsage
  /** Model id as reported by the provider (the served version) */
  model: string
  provider: ProviderName
  /** Output stopped at the token limit — the text may be incomplete */
  truncated: boolean
  /** A provider-side fallback model served this turn (Anthropic server-side refusal fallback) */
  fallbackUsed?: boolean
}

export interface LlmAdapter {
  readonly provider: ProviderName
  /** SDK + version used to make the call, for the audit trail */
  readonly sdk: string
  complete(req: LlmRequest): Promise<LlmResult>
}

/** User-facing text when a provider declines to answer. */
export const AI_REFUSAL_MESSAGE = 'The AI model declined to answer this request. Planora\'s schedule facts and rule-based results are still available; rephrase the question or continue without AI.'

/** The provider declined the request (e.g. a safety refusal). Never treat the content as an answer. */
export class AiRefusalError extends Error {
  constructor(readonly provider: ProviderName, readonly category: string | null = null) { super(AI_REFUSAL_MESSAGE) }
}

export type AiProviderErrorKind = 'rate_limit' | 'auth' | 'bad_request' | 'connection' | 'upstream'

/** A provider call failed. `message` is safe to show to users and to log (no prompt content, no keys). */
export class AiProviderError extends Error {
  constructor(readonly provider: ProviderName, readonly kind: AiProviderErrorKind, readonly status: number | null, message: string) { super(message) }
}

export interface ModelEntry {
  id: string
  provider: ProviderName
  /**
   * Certified models were evaluated with the golden prompts in docs/ai/AI-GOVERNANCE.md. Others are
   * approved alternates: allowed, but Planora does not promise equivalent quality on them.
   */
  certified: boolean
  /** USD per 1M tokens, for spend estimates in the audit trail */
  pricing?: { input: number; output: number }
}

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5'
/** Pinned to a dated snapshot so behavior doesn't change underneath a release. */
export const DEFAULT_OPENAI_MODEL = 'gpt-4o-2024-11-20'
export const DEFAULT_LOCAL_MODEL = 'llama3.1:8b'

export const MODEL_REGISTRY: readonly ModelEntry[] = [
  { id: 'claude-opus-5-5', provider: 'anthropic', certified: true, pricing: { input: 4, output: 20 } },
  { id: 'claude-sonnet-5-5', provider: 'anthropic', certified: true, pricing: { input: 2, output: 10 } },
  { id: 'claude-haiku-5-5', provider: 'anthropic', certified: true, pricing: { input: 0.1, output: 0.5 } },
  { id: DEFAULT_OPENAI_MODEL, provider: 'openai', certified: true },
  { id: 'gpt-4o-2024-08-06', provider: 'openai', certified: false },
  { id: 'gpt-4o', provider: 'openai', certified: false },
  { id: DEFAULT_LOCAL_MODEL, provider: 'local', certified: true },
  { id: 'llama3.1:70b', provider: 'local', certified: false },
  { id: 'qwen2.5:14b', provider: 'local', certified: false },
  { id: 'qwen2.5:32b', provider: 'local', certified: false },
  { id: 'mistral-small', provider: 'local', certified: false },
]

export function registryEntry(model: string): ModelEntry | undefined {
  return MODEL_REGISTRY.find(m => m.id === model)
}

/** Estimated USD cost of one call, or null when the model has no published price in the registry. */
export function estimateCostUsd(model: string, usage: LlmUsage): number | null {
  const p = registryEntry(model)?.pricing
  if (!p) return null
  return Math.round(((usage.inputTokens * p.input + usage.outputTokens * p.output) / 1_000_000) * 1e6) / 1e6
}

/** Provider-side refusal fallback (Anthropic) is on unless PLANORA_AI_FALLBACK=off (also false / 0 / no / disabled). */
export function aiFallbackEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return !/^(off|false|0|no|disabled?)$/i.test((env.PLANORA_AI_FALLBACK || '').trim())
}

/** Display names for the UI and docs. */
export const PROVIDER_LABEL: Record<ProviderName, string> = { anthropic: 'Anthropic (Claude)', openai: 'OpenAI', local: 'On-prem endpoint' }
