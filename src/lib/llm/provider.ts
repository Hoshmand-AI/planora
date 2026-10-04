import OpenAI from 'openai'
import { createHash } from 'crypto'
import { currentRequest } from '@/lib/server/context'

// One place decides where model calls go.
//
//   PLANORA_AI_MODE   cloud | local | offline   (default: cloud if OPENAI_API_KEY is set, else offline)
//   PLANORA_AIRGAPPED true → only loopback/private-network hosts are allowed; cloud mode is refused.
//   LLM_BASE_URL      OpenAI-compatible endpoint for local mode (Ollama: http://localhost:11434/v1, vLLM: http://host:8000/v1)
//   LLM_MODEL         model name (defaults: gpt-4o for cloud, llama3.1:8b for local)
//   LLM_API_KEY       key for the local endpoint if it needs one
//   PLANORA_ALLOWED_HOSTS  comma-separated extra on-prem hostnames allowed in air-gapped mode
//   PLANORA_APPROVED_MODELS comma-separated model registry; any other model is refused (see docs/governance/MODEL-REGISTRY.md)
//
// Governance (enforced in chat(), the single choke point for every model call):
//   - organizations can switch AI off entirely (nothing is sent to any model);
//   - per-organization daily and per-user per-minute quotas cap spend and abuse;
//   - only approved, version-pinned models are used;
//   - every call is recorded in the audit log with model, purpose, sizes, latency and a SHA-256 of
//     the prompt — never the prompt or answer text itself.
//
// Every feature must work in offline mode: the model only improves wording and suggests extra
// questions. Scheduling logic, CPM, DCMA and grounding are deterministic and run without it.

export type AiMode = 'cloud' | 'local' | 'offline'

export interface LlmStatus {
  mode: AiMode
  airgapped: boolean
  model: string | null
  host: string | null
  /** Small self-hosted models get tighter, structured prompts */
  smallModel: boolean
  error?: string
}

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

const PRIVATE_HOST = /^(localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[?::1\]?|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:local|internal|lan|mil\.local))$/i

/** Default models are pinned to dated snapshots so behavior doesn't change underneath a release. */
export const DEFAULT_CLOUD_MODEL = 'gpt-4o-2024-11-20'
export const DEFAULT_LOCAL_MODEL = 'llama3.1:8b'
export const DEFAULT_APPROVED_MODELS = [DEFAULT_CLOUD_MODEL, 'gpt-4o-2024-08-06', 'gpt-4o', DEFAULT_LOCAL_MODEL, 'llama3.1:70b', 'qwen2.5:14b', 'qwen2.5:32b', 'mistral-small']

export function approvedModels(env: Record<string, string | undefined> = process.env): string[] {
  const list = (env.PLANORA_APPROVED_MODELS || '').split(',').map(x => x.trim()).filter(Boolean)
  return list.length ? list : DEFAULT_APPROVED_MODELS
}

export function isAllowedAirgapHost(host: string, extra: string[] = []): boolean {
  const h = host.toLowerCase()
  return PRIVATE_HOST.test(h) || extra.map(x => x.trim().toLowerCase()).filter(Boolean).includes(h)
}

export function resolveLlmConfig(env: Record<string, string | undefined> = process.env): LlmStatus & { baseURL?: string; apiKey?: string } {
  const airgapped = /^(1|true|yes)$/i.test(env.PLANORA_AIRGAPPED || '')
  const requested = (env.PLANORA_AI_MODE || '').toLowerCase() as AiMode | ''
  let mode: AiMode = requested || (airgapped ? (env.LLM_BASE_URL ? 'local' : 'offline') : env.OPENAI_API_KEY ? 'cloud' : env.LLM_BASE_URL ? 'local' : 'offline')

  if (mode === 'cloud' && airgapped) {
    return { mode: 'offline', airgapped, model: null, host: null, smallModel: true, error: 'Cloud AI is disabled in air-gapped mode. Configure LLM_BASE_URL for an on-prem model.' }
  }
  if (mode === 'cloud') {
    if (!env.OPENAI_API_KEY) return { mode: 'offline', airgapped, model: null, host: null, smallModel: true, error: 'OPENAI_API_KEY is not set.' }
    const model = env.LLM_MODEL || DEFAULT_CLOUD_MODEL
    if (!approvedModels(env).includes(model)) return { mode: 'offline', airgapped, model: null, host: null, smallModel: true, error: `Model ${model} is not in the approved model registry (PLANORA_APPROVED_MODELS).` }
    return { mode, airgapped, model, host: 'api.openai.com', smallModel: false, apiKey: env.OPENAI_API_KEY }
  }
  if (mode === 'local') {
    const base = env.LLM_BASE_URL
    if (!base) return { mode: 'offline', airgapped, model: null, host: null, smallModel: true, error: 'LLM_BASE_URL is not set.' }
    let host: string
    try { host = new URL(base).hostname } catch { return { mode: 'offline', airgapped, model: null, host: null, smallModel: true, error: `Invalid LLM_BASE_URL: ${base}` } }
    if (airgapped && !isAllowedAirgapHost(host, (env.PLANORA_ALLOWED_HOSTS || '').split(','))) {
      return { mode: 'offline', airgapped, model: null, host, smallModel: true, error: `Host ${host} is not a private/on-prem address; refused in air-gapped mode.` }
    }
    const model = env.LLM_MODEL || DEFAULT_LOCAL_MODEL
    if (!approvedModels(env).includes(model)) return { mode: 'offline', airgapped, model: null, host, smallModel: true, error: `Model ${model} is not in the approved model registry (PLANORA_APPROVED_MODELS).` }
    const smallModel = !/(70b|72b|405b|gpt-4|claude|large)/i.test(model)
    return { mode, airgapped, model, host, smallModel, baseURL: base, apiKey: env.LLM_API_KEY || 'not-needed' }
  }
  mode = 'offline'
  return { mode, airgapped, model: null, host: null, smallModel: true }
}

/** True when the current request's organization has switched AI off. */
function orgAiOff(): boolean {
  return currentRequest()?.aiEnabled === false
}

export function llmStatus(): LlmStatus {
  const { baseURL: _b, apiKey: _k, ...status } = resolveLlmConfig()
  if (orgAiOff()) return { mode: 'offline', airgapped: status.airgapped, model: null, host: null, smallModel: true, error: 'AI is turned off for your organization' }
  return status
}

let client: { key: string; c: OpenAI } | null = null

function getClient(): { c: OpenAI; model: string; cfg: ReturnType<typeof resolveLlmConfig> } | null {
  if (orgAiOff()) return null
  const cfg = resolveLlmConfig()
  if (cfg.mode === 'offline' || !cfg.model) return null
  const key = `${cfg.mode}|${cfg.baseURL}|${cfg.model}`
  if (!client || client.key !== key) {
    client = { key, c: new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL, timeout: cfg.mode === 'local' ? 120_000 : 60_000, maxRetries: 1 }) }
  }
  return { c: client.c, model: cfg.model, cfg }
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

async function recordCall(e: { purpose: string; model: string; mode: string; host: string | null; promptChars: number; promptSha256: string; responseChars: number; ms: number; ok: boolean; error?: string }) {
  if (!currentRequest()?.orgId) return
  const { auditQuietly } = await import('@/lib/server/audit')
  await auditQuietly({ action: 'ai.request', targetType: 'model', targetId: e.model, detail: e })
}

export async function chat(messages: ChatMessage[], opts: { temperature?: number; maxTokens?: number; purpose?: string } = {}): Promise<string | null> {
  const cl = getClient()
  if (!cl) return null
  await enforceQuota()
  const prompt = messages.map(m => `${m.role}:${m.content}`).join('\n')
  const started = Date.now()
  const base = { purpose: opts.purpose || 'chat', model: cl.model, mode: cl.cfg.mode, host: cl.cfg.host, promptChars: prompt.length, promptSha256: createHash('sha256').update(prompt).digest('hex') }
  try {
    const res = await cl.c.chat.completions.create({
      model: cl.model,
      messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 1500,
    })
    const text = res.choices[0]?.message?.content ?? null
    await recordCall({ ...base, responseChars: text?.length ?? 0, ms: Date.now() - started, ok: true })
    return text
  } catch (err) {
    await recordCall({ ...base, responseChars: 0, ms: Date.now() - started, ok: false, error: (err as Error).message.slice(0, 200) })
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
  const cl = getClient()
  if (!cl) return null
  const convo: ChatMessage[] = [...messages]
  for (let attempt = 0; attempt < 2; attempt++) {
    let reply: string | null = null
    try {
      reply = await chat(convo, { temperature: 0, maxTokens: opts.maxTokens ?? 1200, purpose: opts.purpose || 'structured' })
      if (!reply) return null
      return validate(extractJson(reply))
    } catch (err) {
      if (err instanceof AiQuotaError) throw err
      if (!reply) return null
      convo.push({ role: 'assistant', content: reply })
      convo.push({ role: 'user', content: `That was not valid: ${(err as Error).message}. Reply with ONLY the corrected JSON.` })
    }
  }
  return null
}
