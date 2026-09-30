import OpenAI from 'openai'

// One place decides where model calls go.
//
//   PLANORA_AI_MODE   cloud | local | offline   (default: cloud if OPENAI_API_KEY is set, else offline)
//   PLANORA_AIRGAPPED true → only loopback/private-network hosts are allowed; cloud mode is refused.
//   LLM_BASE_URL      OpenAI-compatible endpoint for local mode (Ollama: http://localhost:11434/v1, vLLM: http://host:8000/v1)
//   LLM_MODEL         model name (defaults: gpt-4o for cloud, llama3.1:8b for local)
//   LLM_API_KEY       key for the local endpoint if it needs one
//   PLANORA_ALLOWED_HOSTS  comma-separated extra on-prem hostnames allowed in air-gapped mode
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
    const model = env.LLM_MODEL || 'gpt-4o'
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
    const model = env.LLM_MODEL || 'llama3.1:8b'
    const smallModel = !/(70b|72b|405b|gpt-4|claude|large)/i.test(model)
    return { mode, airgapped, model, host, smallModel, baseURL: base, apiKey: env.LLM_API_KEY || 'not-needed' }
  }
  mode = 'offline'
  return { mode, airgapped, model: null, host: null, smallModel: true }
}

export function llmStatus(): LlmStatus {
  const { baseURL: _b, apiKey: _k, ...status } = resolveLlmConfig()
  return status
}

let client: { key: string; c: OpenAI } | null = null

function getClient(): { c: OpenAI; model: string; cfg: ReturnType<typeof resolveLlmConfig> } | null {
  const cfg = resolveLlmConfig()
  if (cfg.mode === 'offline' || !cfg.model) return null
  const key = `${cfg.mode}|${cfg.baseURL}|${cfg.model}`
  if (!client || client.key !== key) {
    client = { key, c: new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL, timeout: cfg.mode === 'local' ? 120_000 : 60_000, maxRetries: 1 }) }
  }
  return { c: client.c, model: cfg.model, cfg }
}

/** Free-text completion. Returns null when no model is available (callers must degrade gracefully). */
export async function chat(messages: ChatMessage[], opts: { temperature?: number; maxTokens?: number } = {}): Promise<string | null> {
  const cl = getClient()
  if (!cl) return null
  const res = await cl.c.chat.completions.create({
    model: cl.model,
    messages,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 1500,
  })
  return res.choices[0]?.message?.content ?? null
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
export async function chatJson<T>(messages: ChatMessage[], validate: (v: unknown) => T, opts: { maxTokens?: number } = {}): Promise<T | null> {
  const cl = getClient()
  if (!cl) return null
  const convo: ChatMessage[] = [...messages]
  for (let attempt = 0; attempt < 2; attempt++) {
    let reply: string | null = null
    try {
      reply = await chat(convo, { temperature: 0, maxTokens: opts.maxTokens ?? 1200 })
      if (!reply) return null
      return validate(extractJson(reply))
    } catch (err) {
      if (!reply) return null
      convo.push({ role: 'assistant', content: reply })
      convo.push({ role: 'user', content: `That was not valid: ${(err as Error).message}. Reply with ONLY the corrected JSON.` })
    }
  }
  return null
}
