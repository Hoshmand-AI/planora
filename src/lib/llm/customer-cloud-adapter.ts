// AI in the customer's own cloud account, for private deployments (docs/operations/CLOUD-DEPLOY.md):
//   azure_openai  Azure OpenAI Service      AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT,
//                                            AZURE_OPENAI_API_VERSION (default 2024-10-21)
//   bedrock       Amazon Bedrock (Converse) AWS_REGION, BEDROCK_MODEL_ID; credentials from the task / instance role
//                                            (ECS, App Runner, EC2) or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN
//   vertex        Google Vertex AI          VERTEX_PROJECT, VERTEX_LOCATION (default us-east5), VERTEX_MODEL (Claude or
//                                            Gemini); credentials from the Cloud Run / GCE service account (metadata
//                                            server) or VERTEX_SERVICE_ACCOUNT_JSON
// Selected with RUNF9_AI_PROVIDER. Plain HTTPS (no cloud SDKs); requests carry no RunF9 telemetry.
// Test-only endpoint overrides: BEDROCK_ENDPOINT, VERTEX_ENDPOINT, VERTEX_TOKEN_URL, AWS_CONTAINER_CREDENTIALS_FULL_URI.

import { createSign } from 'crypto'
import { signV4 } from '@/lib/storage/sigv4'
import { AiProviderError, AiRefusalError, type LlmAdapter, type LlmRequest, type LlmResult, type ProviderName } from './gateway'

type Env = Record<string, string | undefined>
export type CustomerCloudProvider = Extract<ProviderName, 'azure_openai' | 'bedrock' | 'vertex'>
export const CUSTOMER_CLOUD_PROVIDERS: readonly CustomerCloudProvider[] = ['azure_openai', 'bedrock', 'vertex']

export interface CustomerCloudConfig {
  provider: CustomerCloudProvider
  model: string
  endpoint: string
  host: string
  azure?: { apiKey: string; deployment: string; apiVersion: string }
  bedrock?: { region: string }
  vertex?: { project: string; location: string }
}

/** Reads the provider's settings; returns an error message instead when something required is missing. */
export function customerCloudConfig(provider: CustomerCloudProvider, env: Env = process.env): CustomerCloudConfig | { error: string } {
  const host = (u: string) => { try { return new URL(u).hostname } catch { return '' } }
  if (provider === 'azure_openai') {
    const endpoint = (env.AZURE_OPENAI_ENDPOINT || '').trim().replace(/\/+$/, '')
    const apiKey = (env.AZURE_OPENAI_API_KEY || '').trim(), deployment = (env.AZURE_OPENAI_DEPLOYMENT || '').trim()
    if (!endpoint || !host(endpoint)) return { error: 'AZURE_OPENAI_ENDPOINT is not set (https://<resource>.openai.azure.com).' }
    if (!apiKey) return { error: 'AZURE_OPENAI_API_KEY is not set.' }
    if (!/^[\w.-]{1,64}$/.test(deployment)) return { error: 'AZURE_OPENAI_DEPLOYMENT is not set (the model deployment name).' }
    return { provider, model: (env.LLM_MODEL || deployment).trim(), endpoint, host: host(endpoint), azure: { apiKey, deployment, apiVersion: (env.AZURE_OPENAI_API_VERSION || '2024-10-21').trim() } }
  }
  if (provider === 'bedrock') {
    const region = (env.BEDROCK_REGION || env.AWS_REGION || env.AWS_DEFAULT_REGION || '').trim()
    const model = (env.BEDROCK_MODEL_ID || env.LLM_MODEL || '').trim()
    if (!/^[a-z]{2}(-gov)?-[a-z]+-\d$/.test(region)) return { error: 'AWS_REGION is not set (for example us-east-1).' }
    if (!/^[\w.:/-]{3,200}$/.test(model)) return { error: 'BEDROCK_MODEL_ID is not set (a Bedrock model or inference profile id).' }
    const endpoint = (env.BEDROCK_ENDPOINT || `https://bedrock-runtime.${region}.amazonaws.com`).replace(/\/+$/, '')
    return { provider, model, endpoint, host: host(endpoint), bedrock: { region } }
  }
  const project = (env.VERTEX_PROJECT || env.GOOGLE_CLOUD_PROJECT || '').trim()
  const location = (env.VERTEX_LOCATION || 'us-east5').trim()
  const model = (env.VERTEX_MODEL || env.LLM_MODEL || '').trim()
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project)) return { error: 'VERTEX_PROJECT is not set (your Google Cloud project id).' }
  if (!/^[a-z]+-[a-z]+\d$|^global$/.test(location)) return { error: 'VERTEX_LOCATION is not valid (for example us-east5).' }
  if (!/^[\w.@-]{3,120}$/.test(model)) return { error: 'VERTEX_MODEL is not set (for example a Claude or Gemini model id).' }
  const endpoint = (env.VERTEX_ENDPOINT || (location === 'global' ? 'https://aiplatform.googleapis.com' : `https://${location}-aiplatform.googleapis.com`)).replace(/\/+$/, '')
  return { provider: 'vertex', model, endpoint, host: host(endpoint), vertex: { project, location } }
}

const LABEL: Record<CustomerCloudProvider, string> = { azure_openai: 'Azure OpenAI', bedrock: 'Amazon Bedrock', vertex: 'Google Vertex AI' }

async function call(provider: CustomerCloudProvider, url: string, init: RequestInit): Promise<Record<string, unknown>> {
  let res: Response
  try { res = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(90_000), cache: 'no-store' }) } catch {
    throw new AiProviderError(provider, 'connection', null, `Could not reach ${LABEL[provider]}.`)
  }
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (res.ok) return data
  const who = LABEL[provider]
  if (res.status === 429) throw new AiProviderError(provider, 'rate_limit', 429, `${who} is rate-limiting requests. Try again in a moment.`)
  if (res.status === 401 || res.status === 403) throw new AiProviderError(provider, 'auth', res.status, `${who} rejected RunF9's credentials (check the key or the role's model access).`)
  if (res.status === 400 || res.status === 404) throw new AiProviderError(provider, 'bad_request', res.status, `${who} rejected the request (check the model or deployment name).`)
  throw new AiProviderError(provider, 'upstream', res.status, `${who} returned an error (HTTP ${res.status}).`)
}

/* ─── Credentials ─────────────────────────────────────── */

type AwsCreds = { accessKeyId: string; secretAccessKey: string; sessionToken?: string; until: number }
let awsCreds: AwsCreds | null = null

/** Environment keys, else the ECS / App Runner task role (container credentials endpoint). */
async function awsCredentials(env: Env): Promise<AwsCreds> {
  if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) return { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY, sessionToken: env.AWS_SESSION_TOKEN, until: Infinity }
  if (awsCreds && awsCreds.until > Date.now() + 120_000) return awsCreds
  const full = env.AWS_CONTAINER_CREDENTIALS_FULL_URI || (env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ? `http://169.254.170.2${env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI}` : '')
  if (!full) throw new AiProviderError('bedrock', 'auth', null, 'No AWS credentials: run RunF9 with a task role that may call Bedrock, or set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.')
  const token = env.AWS_CONTAINER_AUTHORIZATION_TOKEN
  const res = await fetch(full, { headers: token ? { Authorization: token } : {}, signal: AbortSignal.timeout(5000) }).catch(() => null)
  const d = res?.ok ? await res.json() as Record<string, string> : null
  if (!d?.AccessKeyId) throw new AiProviderError('bedrock', 'auth', null, 'Could not get credentials from the task role.')
  awsCreds = { accessKeyId: d.AccessKeyId, secretAccessKey: d.SecretAccessKey, sessionToken: d.Token, until: Date.parse(d.Expiration) || Date.now() + 900_000 }
  return awsCreds
}

let gcpToken: { token: string; until: number } | null = null

/** The service account's access token: VERTEX_SERVICE_ACCOUNT_JSON (signed JWT), else the metadata server. */
async function googleToken(env: Env): Promise<string> {
  if (gcpToken && gcpToken.until > Date.now() + 120_000) return gcpToken.token
  const scope = 'https://www.googleapis.com/auth/cloud-platform'
  let d: Record<string, unknown> | null = null
  if (env.VERTEX_SERVICE_ACCOUNT_JSON) {
    let sa: { client_email: string; private_key: string; token_uri?: string }
    try { sa = JSON.parse(env.VERTEX_SERVICE_ACCOUNT_JSON) } catch { throw new AiProviderError('vertex', 'auth', null, 'VERTEX_SERVICE_ACCOUNT_JSON is not valid JSON.') }
    const tokenUrl = env.VERTEX_TOKEN_URL || sa.token_uri || 'https://oauth2.googleapis.com/token'
    const now = Math.floor(Date.now() / 1000)
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope, aud: tokenUrl, iat: now, exp: now + 3600 })}`
    const assertion = `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url')}`
    d = await call('vertex', tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) })
  } else {
    const meta = env.VERTEX_METADATA_URL || 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token'
    const res = await fetch(`${meta}?scopes=${encodeURIComponent(scope)}`, { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5000) }).catch(() => null)
    d = res?.ok ? await res.json() as Record<string, unknown> : null
    if (!d) throw new AiProviderError('vertex', 'auth', null, 'No Google credentials: run RunF9 on Cloud Run / GCE with a service account that may use Vertex AI, or set VERTEX_SERVICE_ACCOUNT_JSON.')
  }
  if (typeof d.access_token !== 'string') throw new AiProviderError('vertex', 'auth', null, 'Google did not return an access token.')
  gcpToken = { token: d.access_token, until: Date.now() + (Number(d.expires_in) || 3600) * 1000 }
  return gcpToken.token
}

/* ─── Adapters ────────────────────────────────────────── */

const split = (req: LlmRequest) => ({
  system: req.messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n'),
  turns: req.messages.filter(m => m.role !== 'system') as { role: 'user' | 'assistant'; content: string }[],
})

export function createCustomerCloudAdapter(cfg: CustomerCloudConfig, env: Env = process.env): LlmAdapter {
  const provider = cfg.provider
  return {
    provider,
    sdk: 'runf9-http@1',
    async complete(req: LlmRequest): Promise<LlmResult> {
      if (provider === 'azure_openai') {
        const a = cfg.azure!
        const d = await call(provider, `${cfg.endpoint}/openai/deployments/${encodeURIComponent(a.deployment)}/chat/completions?api-version=${encodeURIComponent(a.apiVersion)}`, {
          method: 'POST', headers: { 'content-type': 'application/json', 'api-key': a.apiKey },
          body: JSON.stringify({ messages: req.messages, max_tokens: req.maxTokens, temperature: req.temperature ?? 0.3 }),
        })
        const choice = (d.choices as { message?: { content?: string }; finish_reason?: string }[] | undefined)?.[0]
        if (choice?.finish_reason === 'content_filter') throw new AiRefusalError(provider, 'content_filter')
        const usage = d.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
        return { text: choice?.message?.content ?? null, usage: { inputTokens: usage?.prompt_tokens ?? 0, outputTokens: usage?.completion_tokens ?? 0 }, model: String(d.model || cfg.model), provider, truncated: choice?.finish_reason === 'length' }
      }
      const { system, turns } = split(req)
      if (provider === 'bedrock') {
        const creds = await awsCredentials(env)
        const url = new URL(`${cfg.endpoint}/model/${encodeURIComponent(cfg.model)}/converse`)
        const body = Buffer.from(JSON.stringify({
          messages: turns.map(t => ({ role: t.role, content: [{ text: t.content }] })),
          ...(system ? { system: [{ text: system }] } : {}),
          inferenceConfig: { maxTokens: req.maxTokens, temperature: req.temperature ?? 0.3 },
        }))
        const headers = signV4({ method: 'POST', url, region: cfg.bedrock!.region, service: 'bedrock', accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey, body, doubleEncodePath: true,
          headers: { 'content-type': 'application/json', ...(creds.sessionToken ? { 'x-amz-security-token': creds.sessionToken } : {}) } })
        const d = await call(provider, url.toString(), { method: 'POST', headers, body: new Uint8Array(body) })
        const content = ((d.output as { message?: { content?: { text?: string }[] } } | undefined)?.message?.content ?? []).map(c => c.text ?? '').join('')
        if (d.stopReason === 'guardrail_intervened' || d.stopReason === 'content_filtered') throw new AiRefusalError(provider, String(d.stopReason))
        const usage = d.usage as { inputTokens?: number; outputTokens?: number } | undefined
        return { text: content || null, usage: { inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0 }, model: cfg.model, provider, truncated: d.stopReason === 'max_tokens' }
      }
      // Vertex AI: Claude through the Anthropic publisher (rawPredict), anything else as Gemini (generateContent).
      const v = cfg.vertex!
      const token = await googleToken(env)
      const base = `${cfg.endpoint}/v1/projects/${v.project}/locations/${v.location}/publishers`
      const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` }
      if (/^claude/i.test(cfg.model)) {
        const d = await call(provider, `${base}/anthropic/models/${encodeURIComponent(cfg.model)}:rawPredict`, { method: 'POST', headers, body: JSON.stringify({
          anthropic_version: 'vertex-2023-10-16', max_tokens: req.maxTokens, ...(system ? { system } : {}), ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          messages: turns.map(t => ({ role: t.role, content: t.content })),
        }) })
        if (d.stop_reason === 'refusal') throw new AiRefusalError(provider, 'refusal')
        const text = ((d.content as { type: string; text?: string }[] | undefined) ?? []).filter(c => c.type === 'text').map(c => c.text).join('')
        const usage = d.usage as { input_tokens?: number; output_tokens?: number } | undefined
        return { text: text || null, usage: { inputTokens: usage?.input_tokens ?? 0, outputTokens: usage?.output_tokens ?? 0 }, model: String(d.model || cfg.model), provider, truncated: d.stop_reason === 'max_tokens' }
      }
      const d = await call(provider, `${base}/google/models/${encodeURIComponent(cfg.model)}:generateContent`, { method: 'POST', headers, body: JSON.stringify({
        contents: turns.map(t => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.content }] })),
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        generationConfig: { maxOutputTokens: req.maxTokens, temperature: req.temperature ?? 0.3 },
      }) })
      const cand = (d.candidates as { content?: { parts?: { text?: string }[] }; finishReason?: string }[] | undefined)?.[0]
      if (cand?.finishReason === 'SAFETY' || cand?.finishReason === 'PROHIBITED_CONTENT') throw new AiRefusalError(provider, cand.finishReason)
      const usage = d.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number } | undefined
      return { text: (cand?.content?.parts ?? []).map(p => p.text ?? '').join('') || null, usage: { inputTokens: usage?.promptTokenCount ?? 0, outputTokens: usage?.candidatesTokenCount ?? 0 }, model: String(d.modelVersion || cfg.model), provider, truncated: cand?.finishReason === 'MAX_TOKENS' }
    },
  }
}

/** For tests: forget cached cloud credentials. */
export function resetCustomerCloudCredentials() { awsCreds = null; gcpToken = null }
