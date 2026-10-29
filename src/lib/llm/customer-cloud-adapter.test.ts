import { createVerify, generateKeyPairSync } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createCustomerCloudAdapter, customerCloudConfig, resetCustomerCloudCredentials, type CustomerCloudConfig } from './customer-cloud-adapter'
import { resolveLlmConfig } from './provider'

// A stand-in for Azure OpenAI, Bedrock, Vertex AI, the ECS credentials endpoint and Google's token
// endpoint: fetch is replaced for these tests, and every request is recorded.
const seen: { method: string; url: string; headers: Record<string, string>; body: string }[] = []
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwtClaims: { iss?: string; scope?: string; aud?: string }[] = []
const base = 'https://cloud.test'
const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

function fakeCloud(path: string, headers: Record<string, string>, body: string): Response {
  if (path.startsWith('/openai/deployments/')) {
    return headers['api-key'] === 'az-key' ? reply(200, { model: 'gpt-4o-2024-11-20', choices: [{ message: { content: 'azure says hi' }, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 3 } }) : reply(401, {})
  }
  if (path === '/ecs-creds') return reply(200, { AccessKeyId: 'ASIATASKROLE', SecretAccessKey: 'secret', Token: 'task-session', Expiration: new Date(Date.now() + 3600e3).toISOString() })
  if (path.startsWith('/model/')) return reply(200, { output: { message: { content: [{ text: 'bedrock ' }, { text: 'says hi' }] } }, stopReason: 'end_turn', usage: { inputTokens: 20, outputTokens: 4 } })
  if (path === '/token') {
    // Only the signature decides here; the tests check the claims recorded.
    const [h, p, sig] = (new URLSearchParams(body).get('assertion') || '').split('.')
    const valid = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(sig || '', 'base64url'))
    if (!valid) return reply(400, { error: 'invalid_grant' })
    jwtClaims.push(JSON.parse(Buffer.from(p, 'base64url').toString()))
    return reply(200, { access_token: 'vertex-token', expires_in: 3600 })
  }
  if (path.includes(':rawPredict')) {
    if (headers.authorization !== 'Bearer vertex-token') return reply(401, {})
    const b = JSON.parse(body)
    if (b.messages.some((m: { content: string }) => m.content.includes('refuse'))) return reply(200, { content: [], stop_reason: 'refusal' })
    return reply(200, { model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'claude on vertex' }], stop_reason: 'max_tokens', usage: { input_tokens: 9, output_tokens: 2 } })
  }
  if (path.includes(':generateContent')) return reply(200, { candidates: [{ content: { parts: [{ text: 'gemini says hi' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 } })
  return reply(404, {})
}

const realFetch = globalThis.fetch
beforeAll(() => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), String(v)]))
    const body = init?.body instanceof Uint8Array ? Buffer.from(init.body).toString() : init?.body ? String(init.body) : ''
    seen.push({ method: init?.method ?? 'GET', url: url.pathname + url.search, headers, body })
    return fakeCloud(url.pathname, headers, body)
  }) as typeof fetch
})
afterAll(() => { globalThis.fetch = realFetch })
beforeEach(() => { seen.length = 0; resetCustomerCloudCredentials() })

const msgs = [{ role: 'system' as const, content: 'You are RunF9.' }, { role: 'user' as const, content: 'Summarize the schedule.' }]
const cfgOf = (provider: 'azure_openai' | 'bedrock' | 'vertex', env: Record<string, string>) => {
  const c = customerCloudConfig(provider, env)
  if ('error' in c) throw new Error(c.error)
  return c as CustomerCloudConfig
}

describe('Azure OpenAI', () => {
  it('calls the deployment with the API key and reports usage', async () => {
    const env = { AZURE_OPENAI_ENDPOINT: base, AZURE_OPENAI_API_KEY: 'az-key', AZURE_OPENAI_DEPLOYMENT: 'runf9-gpt4o' }
    const r = await createCustomerCloudAdapter(cfgOf('azure_openai', env), env).complete({ model: 'runf9-gpt4o', messages: msgs, maxTokens: 100 })
    expect(r).toMatchObject({ text: 'azure says hi', provider: 'azure_openai', usage: { inputTokens: 11, outputTokens: 3 }, truncated: false })
    expect(seen[0].url).toBe('/openai/deployments/runf9-gpt4o/chat/completions?api-version=2024-10-21')
    expect(JSON.parse(seen[0].body).messages[0]).toEqual({ role: 'system', content: 'You are RunF9.' })
  })
})

describe('Amazon Bedrock', () => {
  it('signs a Converse call with the task role credentials (double-encoded model id)', async () => {
    const env = { AWS_REGION: 'us-east-1', BEDROCK_MODEL_ID: 'anthropic.claude-sonnet-5-5-v1:0', BEDROCK_ENDPOINT: base, AWS_CONTAINER_CREDENTIALS_FULL_URI: `${base}/ecs-creds` }
    const r = await createCustomerCloudAdapter(cfgOf('bedrock', env), env).complete({ model: env.BEDROCK_MODEL_ID, messages: msgs, maxTokens: 100 })
    expect(r).toMatchObject({ text: 'bedrock says hi', usage: { inputTokens: 20, outputTokens: 4 } })
    const call = seen.find(s => s.url.startsWith('/model/'))!
    expect(call.url).toBe('/model/anthropic.claude-sonnet-5-5-v1%3A0/converse')
    expect(call.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=ASIATASKROLE\/\d{8}\/us-east-1\/bedrock\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token,/)
    expect(call.headers['x-amz-security-token']).toBe('task-session')
    const body = JSON.parse(call.body)
    expect(body.system).toEqual([{ text: 'You are RunF9.' }])
    expect(body.messages).toEqual([{ role: 'user', content: [{ text: 'Summarize the schedule.' }] }])
  })

  it('explains missing credentials', async () => {
    const env = { AWS_REGION: 'us-east-1', BEDROCK_MODEL_ID: 'm.x-v1:0', BEDROCK_ENDPOINT: base }
    await expect(createCustomerCloudAdapter(cfgOf('bedrock', env), env).complete({ model: 'm', messages: msgs, maxTokens: 10 })).rejects.toThrow(/task role/)
  })
})

describe('Google Vertex AI', () => {
  const sa = JSON.stringify({ client_email: 'runf9@proj.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) })
  const env = () => ({ VERTEX_PROJECT: 'runf9-proj', VERTEX_LOCATION: 'us-east5', VERTEX_ENDPOINT: base, VERTEX_TOKEN_URL: `${base}/token`, VERTEX_SERVICE_ACCOUNT_JSON: sa })

  it('gets a token with a signed service-account JWT and calls Claude on Vertex', async () => {
    const e = { ...env(), VERTEX_MODEL: 'claude-sonnet-5-5' }
    const r = await createCustomerCloudAdapter(cfgOf('vertex', e), e).complete({ model: e.VERTEX_MODEL, messages: msgs, maxTokens: 50, temperature: 0 })
    expect(r).toMatchObject({ text: 'claude on vertex', truncated: true, usage: { inputTokens: 9, outputTokens: 2 } })
    expect(jwtClaims.at(-1)).toMatchObject({ iss: 'runf9@proj.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/cloud-platform', aud: `${base}/token` })
    const call = seen.find(s => s.url.includes(':rawPredict'))!
    expect(call.url).toBe('/v1/projects/runf9-proj/locations/us-east5/publishers/anthropic/models/claude-sonnet-5-5:rawPredict')
    expect(JSON.parse(call.body)).toMatchObject({ anthropic_version: 'vertex-2023-10-16', system: 'You are RunF9.', max_tokens: 50, temperature: 0 })
  })

  it('treats a refusal as a refusal', async () => {
    const e = { ...env(), VERTEX_MODEL: 'claude-sonnet-5-5' }
    await expect(createCustomerCloudAdapter(cfgOf('vertex', e), e).complete({ model: 'x', messages: [{ role: 'user', content: 'please refuse' }], maxTokens: 10 })).rejects.toThrow(/declined/)
  })

  it('calls Gemini for non-Claude models', async () => {
    const e = { ...env(), VERTEX_MODEL: 'gemini-2.5-pro' }
    const r = await createCustomerCloudAdapter(cfgOf('vertex', e), e).complete({ model: e.VERTEX_MODEL, messages: msgs, maxTokens: 50 })
    expect(r.text).toBe('gemini says hi')
    expect(JSON.parse(seen.find(s => s.url.includes(':generateContent'))!.body).systemInstruction).toEqual({ parts: [{ text: 'You are RunF9.' }] })
  })
})

describe('provider selection', () => {
  it('routes RUNF9_AI_PROVIDER to the customer cloud and explains what is missing', () => {
    expect(resolveLlmConfig({ RUNF9_AI_PROVIDER: 'bedrock', AWS_REGION: 'us-east-1' })).toMatchObject({ mode: 'offline', error: expect.stringMatching(/BEDROCK_MODEL_ID/) })
    const ok = resolveLlmConfig({ RUNF9_AI_PROVIDER: 'azure_openai', AZURE_OPENAI_ENDPOINT: 'https://acme.openai.azure.com', AZURE_OPENAI_API_KEY: 'k', AZURE_OPENAI_DEPLOYMENT: 'gpt4o' })
    expect(ok).toMatchObject({ mode: 'cloud', provider: 'azure_openai', model: 'gpt4o', host: 'acme.openai.azure.com' })
    expect(resolveLlmConfig({ RUNF9_AI_PROVIDER: 'vertex', VERTEX_PROJECT: 'runf9-proj', VERTEX_MODEL: 'gemini-2.5-pro', RUNF9_APPROVED_MODELS: 'claude-sonnet-5-5' })).toMatchObject({ mode: 'offline', error: expect.stringMatching(/approved/) })
    expect(resolveLlmConfig({ RUNF9_AI_PROVIDER: 'vertex', RUNF9_AIRGAPPED: 'true', VERTEX_PROJECT: 'runf9-proj', VERTEX_MODEL: 'gemini-2.5-pro' }).mode).toBe('offline')
  })
})
