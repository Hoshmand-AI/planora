import { createHash } from 'crypto'
import { currentRequest } from '@/lib/server/context'
import { log } from '@/lib/server/log'
import {
  AiRefusalError, aiFallbackEnabled, DEFAULT_ANTHROPIC_MODEL, DEFAULT_LOCAL_MODEL, DEFAULT_OPENAI_MODEL, MODEL_REGISTRY, estimateCostUsd, registryEntry,
  type ChatMessage, type CloudProvider, type LlmAdapter, type ProviderName,
} from './gateway'

export { AiProviderError, AiRefusalError, AI_REFUSAL_MESSAGE, MODEL_REGISTRY, DEFAULT_ANTHROPIC_MODEL, DEFAULT_OPENAI_MODEL, DEFAULT_LOCAL_MODEL, PROVIDER_LABEL } from './gateway'
export type { ChatMessage, ProviderName, CloudProvider, LlmAdapter, LlmResult, LlmUsage } from './gateway'

// One place decides where model calls go (the AI gateway). Adapters in ./anthropic-adapter.ts and
// ./openai-adapter.ts only translate a call to one provider's API; everything here is provider-agnostic.
//
//   PLANORA_AI_MODE   cloud | local | offline   (default: cloud if ANTHROPIC_API_KEY or OPENAI_API_KEY is set, else offline)
//   PLANORA_AI_PROVIDER  anthropic | openai — the cloud provider (default: anthropic when ANTHROPIC_API_KEY is set,
//                     otherwise openai when OPENAI_API_KEY is set). Cloud calls send request content to this provider.
//   ANTHROPIC_API_KEY key for the Anthropic (Claude) API — the default cloud provider
//   OPENAI_API_KEY    key for the OpenAI API — approved alternate cloud provider
//   PLANORA_AI_FALLBACK  off → disable Anthropic's server-side refusal fallback (on by default: a declined request is
//                     re-run on a fallback model inside the same call; the audit records fallbackUsed + served model)
//   PLANORA_AIRGAPPED true → only loopback/private-network hosts are allowed; cloud mode is refused.
//   LLM_BASE_URL      OpenAI-compatible endpoint for local mode (Ollama: http://localhost:11434/v1, vLLM: http://host:8000/v1)
//   LLM_MODEL         model name (defaults: claude-opus-5-5 for anthropic, gpt-4o-2024-11-20 for openai, llama3.1:8b for local)
//   LLM_API_KEY       key for the local endpoint if it needs one
//   PLANORA_ALLOWED_HOSTS  comma-separated extra on-prem hostnames allowed in air-gapped mode
//   PLANORA_APPROVED_MODELS comma-separated model registry; any other model is refused (see docs/ai/MODEL-REGISTRY.md)
//   PLANORA_DEPLOYMENT  commercial (default) | onprem — where this Planora instance itself runs. Air-gapped implies on-prem.
//
// Governance (enforced in chat(), the single choke point for every model call, for every provider):
//   - organizations can switch AI off entirely (nothing is sent to any model);
//   - per-organization daily and per-user per-minute quotas cap spend and abuse;
//   - only approved, version-pinned models are used; each is either certified or an approved
//     alternate (Planora does not promise equivalent quality on models it has not validated);
//   - content of a project marked CUI or classified is never sent to a model outside the customer's
//     network (cloud mode, or a public LLM_BASE_URL) — see docs/security/CUI-HANDLING.md;
//   - every call is recorded in the audit log with provider, model, served model version, SDK
//     version, purpose, sizes, token usage, estimated cost, latency and a SHA-256 of the prompt —
//     never the prompt or answer text itself.
//
// Every feature must work in offline mode: the model only improves wording and suggests extra
// questions. Scheduling logic, CPM, DCMA and grounding are deterministic and run without it.

export type AiMode = 'cloud' | 'local' | 'offline'

/** Where this Planora instance runs. Only an on-prem / air-gapped instance may hold CUI. */
export type Deployment = 'commercial_cloud' | 'on_prem' | 'airgapped'

export function deploymentKind(env: Record<string, string | undefined> = process.env): Deployment {
  if (/^(1|true|yes)$/i.test(env.PLANORA_AIRGAPPED || '')) return 'airgapped'
  return /^(on-?prem(ises)?|on_prem|self-?hosted)$/i.test((env.PLANORA_DEPLOYMENT || '').trim()) ? 'on_prem' : 'commercial_cloud'
}

/** Shown wherever project data is entered on the commercial cloud service. */
export const CUI_CLOUD_WARNING = 'This is the commercial cloud service. Do not enter or store Controlled Unclassified Information (CUI) or classified information here: CUI must not be stored in the commercial cloud. Use an on-premises or air-gapped Planora deployment for CUI and classified projects.'

/** Returned (and audited) when a model call for a CUI/classified project would leave the customer's network. */
export const CUI_AI_REFUSAL = 'This project is marked CUI or classified, so its content is never sent to a cloud AI model. Scheduling, quality checks and reports still work without AI. Use an on-premises / air-gapped deployment with an on-prem model for AI on controlled projects.'

/** A model call was refused because the project's data is CUI or classified and the model is outside the network. */
export class RestrictedDataError extends Error {
  constructor(message = CUI_AI_REFUSAL) { super(message) }
}

const RESTRICTED = new Set(['cui', 'classified'])

export interface LlmStatus {
  mode: AiMode
  airgapped: boolean
  /** Which gateway adapter serves calls (anthropic | openai | local); null when offline */
  provider: ProviderName | null
  model: string | null
  /** True for a certified model; false for an approved alternate (no promise of equivalent quality) */
  certified?: boolean
  host: string | null
  /** Small self-hosted models get tighter, structured prompts */
  smallModel: boolean
  error?: string
  /** Where this instance runs; on 'commercial_cloud' the UI must warn against entering CUI */
  deployment?: Deployment
  /** Present on the commercial cloud: CUI / classified information must not be stored here */
  cuiWarning?: string
}

const PRIVATE_HOST = /^(localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[?::1\]?|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:local|internal|lan|mil\.local))$/i

/** Default cloud model (the default cloud provider is Anthropic). Model ids are exact and version-pinned. */
export const DEFAULT_CLOUD_MODEL = DEFAULT_ANTHROPIC_MODEL
export const DEFAULT_APPROVED_MODELS = MODEL_REGISTRY.map(m => m.id)

/** Default model for each provider. */
export const DEFAULT_MODEL: Record<ProviderName, string> = { anthropic: DEFAULT_ANTHROPIC_MODEL, openai: DEFAULT_OPENAI_MODEL, local: DEFAULT_LOCAL_MODEL }

const CLOUD: Record<CloudProvider, { keyVar: 'ANTHROPIC_API_KEY' | 'OPENAI_API_KEY'; host: string }> = {
  anthropic: { keyVar: 'ANTHROPIC_API_KEY', host: 'api.anthropic.com' },
  openai: { keyVar: 'OPENAI_API_KEY', host: 'api.openai.com' },
}

export function approvedModels(env: Record<string, string | undefined> = process.env): string[] {
  const list = (env.PLANORA_APPROVED_MODELS || '').split(',').map(x => x.trim()).filter(Boolean)
  return list.length ? list : DEFAULT_APPROVED_MODELS
}

/** The cloud provider: PLANORA_AI_PROVIDER if set, else anthropic with an Anthropic key, else openai with an OpenAI key. */
export function selectCloudProvider(env: Record<string, string | undefined> = process.env): { provider: CloudProvider | null; error?: string } {
  const requested = (env.PLANORA_AI_PROVIDER || '').trim().toLowerCase()
  if (requested) {
    if (requested === 'anthropic' || requested === 'openai') return { provider: requested }
    return { provider: null, error: `Unknown PLANORA_AI_PROVIDER "${requested}" (use anthropic or openai).` }
  }
  if (env.ANTHROPIC_API_KEY) return { provider: 'anthropic' }
  if (env.OPENAI_API_KEY) return { provider: 'openai' }
  return { provider: null }
}

/** Certified models are listed as such in the registry; anything else (incl. models approved only via PLANORA_APPROVED_MODELS) is an approved alternate. */
export function isCertifiedModel(model: string): boolean {
  return registryEntry(model)?.certified ?? false
}

export function isAllowedAirgapHost(host: string, extra: string[] = []): boolean {
  const h = host.toLowerCase()
  return PRIVATE_HOST.test(h) || extra.map(x => x.trim().toLowerCase()).filter(Boolean).includes(h)
}

export function resolveLlmConfig(env: Record<string, string | undefined> = process.env): LlmStatus & { baseURL?: string; apiKey?: string } {
  const airgapped = /^(1|true|yes)$/i.test(env.PLANORA_AIRGAPPED || '')
  const requested = (env.PLANORA_AI_MODE || '').toLowerCase() as AiMode | ''
  const hasCloudKey = !!(env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY)
  let mode: AiMode = requested || (airgapped ? (env.LLM_BASE_URL ? 'local' : 'offline') : hasCloudKey ? 'cloud' : env.LLM_BASE_URL ? 'local' : 'offline')
  const off = (error: string, host: string | null = null) => ({ mode: 'offline' as const, airgapped, provider: null, model: null, host, smallModel: true, error })

  if (mode === 'cloud' && airgapped) return off('Cloud AI is disabled in air-gapped mode. Configure LLM_BASE_URL for an on-prem model.')
  if (mode === 'cloud') {
    const sel = selectCloudProvider(env)
    if (sel.error) return off(sel.error)
    if (!sel.provider) return off('No cloud AI key is set (ANTHROPIC_API_KEY or OPENAI_API_KEY).')
    const { keyVar, host } = CLOUD[sel.provider]
    const apiKey = env[keyVar]
    if (!apiKey) return off(`${keyVar} is not set.`)
    const model = env.LLM_MODEL || DEFAULT_MODEL[sel.provider]
    if (!approvedModels(env).includes(model)) return off(`Model ${model} is not in the approved model registry (PLANORA_APPROVED_MODELS).`)
    const known = registryEntry(model)
    if (known && known.provider !== sel.provider) return off(`Model ${model} is served by ${known.provider}, not the selected provider ${sel.provider} (PLANORA_AI_PROVIDER).`)
    return { mode, airgapped, provider: sel.provider, model, certified: isCertifiedModel(model), host, smallModel: false, apiKey }
  }
  if (mode === 'local') {
    const base = env.LLM_BASE_URL
    if (!base) return off('LLM_BASE_URL is not set.')
    let host: string
    try { host = new URL(base).hostname } catch { return off(`Invalid LLM_BASE_URL: ${base}`) }
    if (airgapped && !isAllowedAirgapHost(host, (env.PLANORA_ALLOWED_HOSTS || '').split(','))) {
      return off(`Host ${host} is not a private/on-prem address; refused in air-gapped mode.`, host)
    }
    const model = env.LLM_MODEL || DEFAULT_LOCAL_MODEL
    if (!approvedModels(env).includes(model)) return off(`Model ${model} is not in the approved model registry (PLANORA_APPROVED_MODELS).`, host)
    const smallModel = !/(70b|72b|405b|gpt-4|claude|large)/i.test(model)
    return { mode, airgapped, provider: 'local', model, certified: isCertifiedModel(model), host, smallModel, baseURL: base, apiKey: env.LLM_API_KEY || 'not-needed' }
  }
  mode = 'offline'
  return { mode, airgapped, provider: null, model: null, host: null, smallModel: true }
}

/** True when the current request's organization has switched AI off. */
function orgAiOff(): boolean {
  return currentRequest()?.aiEnabled === false
}

export function llmStatus(): LlmStatus {
  const { baseURL: _b, apiKey: _k, ...status } = resolveLlmConfig()
  const deployment = deploymentKind()
  const where = { deployment, ...(deployment === 'commercial_cloud' ? { cuiWarning: CUI_CLOUD_WARNING } : {}) }
  if (orgAiOff()) return { mode: 'offline', airgapped: status.airgapped, provider: null, model: null, host: null, smallModel: true, error: 'AI is turned off for your organization', ...where }
  return { ...status, ...where }
}

/**
 * True when the model is outside the customer's network: any cloud provider, or an
 * OpenAI-compatible endpoint on a public host. Only private / on-prem hosts count as inside.
 */
export function isExternalModel(cfg: Pick<LlmStatus, 'mode' | 'host'>, env: Record<string, string | undefined> = process.env): boolean {
  if (cfg.mode === 'cloud') return true
  if (cfg.mode === 'local') return !cfg.host || !isAllowedAirgapHost(cfg.host, (env.PLANORA_ALLOWED_HOSTS || '').split(','))
  return false
}

type Route = ReturnType<typeof resolveLlmConfig> & { model: string; provider: ProviderName }

/** Refuses (and audits, without content) a call that would send CUI/classified project data to an external model. */
async function guardRestrictedData(cfg: Route, purpose: string) {
  if (!isExternalModel(cfg)) return
  const r = currentRequest()
  const classification = r?.dataClassification ? await r.dataClassification() : null
  if (!classification || !RESTRICTED.has(classification)) return
  if (r?.orgId) {
    const { auditQuietly } = await import('@/lib/server/audit')
    await auditQuietly({ action: 'ai.blocked_restricted_data', targetType: 'model', targetId: cfg.model, detail: { purpose, classification, mode: cfg.mode, provider: cfg.provider, host: cfg.host } })
  }
  throw new RestrictedDataError()
}

/** The resolved route for a call, or null when no model is available (offline, or AI off for the organization). */
function route(): Route | null {
  if (orgAiOff()) return null
  const cfg = resolveLlmConfig()
  if (cfg.mode === 'offline' || !cfg.model || !cfg.provider) return null
  return cfg as Route
}

let cached: { provider: ProviderName; baseURL: string; apiKey: string; fallback: boolean; adapter: LlmAdapter } | null = null

/** Build (or reuse) the adapter for the route. SDKs are loaded lazily, so an unused provider's SDK is never initialized. */
async function adapterFor(cfg: Route): Promise<LlmAdapter> {
  const fallback = cfg.provider === 'anthropic' && aiFallbackEnabled()
  const baseURL = cfg.baseURL ?? '', apiKey = cfg.apiKey ?? ''
  // Reuse the adapter while the route is unchanged (compared in memory; the key is never hashed or stored elsewhere).
  if (cached && cached.provider === cfg.provider && cached.baseURL === baseURL && cached.apiKey === apiKey && cached.fallback === fallback) return cached.adapter
  let adapter: LlmAdapter
  if (cfg.provider === 'anthropic') {
    const { createAnthropicAdapter } = await import('./anthropic-adapter')
    adapter = createAnthropicAdapter({ apiKey: cfg.apiKey ?? '', fallback })
  } else {
    const { createOpenAiCompatibleAdapter } = await import('./openai-adapter')
    adapter = createOpenAiCompatibleAdapter({ provider: cfg.provider, apiKey: cfg.apiKey, baseURL: cfg.baseURL })
  }
  cached = { provider: cfg.provider, baseURL, apiKey, fallback, adapter }
  return adapter
}

/** Free-text completion. Returns null when no model is available (callers must degrade gracefully). */
export class AiQuotaError extends Error {}

async function enforceQuota() {
  const r = currentRequest()
  if (!r?.orgId) return
  const { hit, aiQuotaKey, LIMITS } = await import('@/lib/server/rate-limit')
  const day = await hit(aiQuotaKey(r.orgId), r.aiDailyLimit ?? 300, 86_400)
  if (!day.ok) throw new AiQuotaError(`Your organization reached its daily AI limit (${day.limit} requests). It resets at midnight UTC; an admin can raise it in Organization settings.`)
  if (r.userId) {
    const minute = await hit(`ai:user:${r.userId}`, LIMITS.aiPerUser.limit, LIMITS.aiPerUser.windowSec)
    if (!minute.ok) throw new AiQuotaError('Too many AI requests in a minute. Wait a moment and try again.')
  }
}

/** Audit metadata for one model call. Never the prompt or the answer text. */
export interface AiCallRecord {
  purpose: string
  provider: ProviderName
  /** Model id requested (from the approved registry) */
  model: string
  /** Model version as reported by the provider; null when the call failed */
  modelVersion: string | null
  /** SDK and version that made the call */
  sdk: string
  certified: boolean
  mode: string
  host: string | null
  promptChars: number
  promptSha256: string
  responseChars: number
  inputTokens: number | null
  outputTokens: number | null
  estimatedCostUsd: number | null
  truncated: boolean
  /** A provider-side refusal fallback model served this turn (modelVersion is then the fallback model) */
  fallbackUsed: boolean
  ms: number
  ok: boolean
  refused?: boolean
  error?: string
}

async function recordCall(e: AiCallRecord) {
  if (!currentRequest()?.orgId) return
  const { auditQuietly } = await import('@/lib/server/audit')
  await auditQuietly({ action: 'ai.request', targetType: 'model', targetId: e.model, detail: { ...e } })
}

/**
 * The single choke point for every model call. Returns null when no model is available.
 * Throws RestrictedDataError (CUI guard), AiQuotaError (spend caps), AiRefusalError (the provider
 * declined) or AiProviderError (provider failure, with a user-safe message).
 */
export async function chat(messages: ChatMessage[], opts: { temperature?: number; maxTokens?: number; purpose?: string } = {}): Promise<string | null> {
  const cfg = route()
  if (!cfg) return null
  await guardRestrictedData(cfg, opts.purpose || 'chat')
  await enforceQuota()
  const adapter = await adapterFor(cfg)
  const prompt = messages.map(m => `${m.role}:${m.content}`).join('\n')
  const started = Date.now()
  const base = {
    purpose: opts.purpose || 'chat', provider: cfg.provider, model: cfg.model, sdk: adapter.sdk, certified: cfg.certified ?? false,
    mode: cfg.mode, host: cfg.host, promptChars: prompt.length, promptSha256: createHash('sha256').update(prompt).digest('hex'),
  }
  try {
    const res = await adapter.complete({ model: cfg.model, messages, maxTokens: opts.maxTokens ?? 1500, temperature: opts.temperature })
    if (res.truncated) log('warn', 'model output truncated at the token limit', { purpose: base.purpose, provider: res.provider, model: res.model })
    await recordCall({
      ...base, modelVersion: res.model, responseChars: res.text?.length ?? 0,
      inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens, estimatedCostUsd: estimateCostUsd(res.fallbackUsed ? res.model : cfg.model, res.usage),
      truncated: res.truncated, fallbackUsed: res.fallbackUsed ?? false, ms: Date.now() - started, ok: true,
    })
    return res.text
  } catch (err) {
    await recordCall({
      ...base, modelVersion: null, responseChars: 0, inputTokens: null, outputTokens: null, estimatedCostUsd: null, truncated: false, fallbackUsed: false,
      ms: Date.now() - started, ok: false, ...(err instanceof AiRefusalError ? { refused: true } : {}), error: (err as Error).message.slice(0, 200),
    })
    throw err
  }
}

/** Pull the first JSON object/array out of a model reply (small models often wrap JSON in prose or fences). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const start = body.search(/[[{]/)
  if (start < 0) throw new Error('No JSON found')
  const open = body[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < body.length; i++) {
    const ch = body[i]
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue }
    if (ch === '"') inStr = true
    else if (ch === open) depth++
    else if (ch === close && --depth === 0) return JSON.parse(body.slice(start, i + 1))
  }
  throw new Error('Unterminated JSON')
}

/**
 * Structured completion for small self-hosted models: ask for JSON only, validate, and retry once
 * with the validation error fed back. Returns null if the model is unavailable or never produces
 * valid output — callers then use their deterministic result.
 */
export async function chatJson<T>(messages: ChatMessage[], validate: (v: unknown) => T, opts: { maxTokens?: number; purpose?: string } = {}): Promise<T | null> {
  if (!route()) return null
  const convo: ChatMessage[] = [...messages]
  for (let attempt = 0; attempt < 2; attempt++) {
    let reply: string | null = null
    try {
      reply = await chat(convo, { temperature: 0, maxTokens: opts.maxTokens ?? 1200, purpose: opts.purpose || 'structured' })
      if (!reply) return null
      return validate(extractJson(reply))
    } catch (err) {
      if (err instanceof AiQuotaError || err instanceof RestrictedDataError) throw err
      if (!reply) return null
      convo.push({ role: 'assistant', content: reply })
      convo.push({ role: 'user', content: `That was not valid: ${(err as Error).message}. Reply with ONLY the corrected JSON.` })
    }
  }
  return null
}
