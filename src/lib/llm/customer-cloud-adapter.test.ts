import http from 'node:http'
import { createVerify, generateKeyPairSync } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createCustomerCloudAdapter, customerCloudConfig, resetCustomerCloudCredentials, type CustomerCloudConfig } from './customer-cloud-adapter'
import { resolveLlmConfig } from './provider'

// A stand-in for Azure OpenAI, Bedrock, Vertex AI, the ECS credentials endpoint and Google's token endpoint.
const seen: { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }[] = []
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwtClaims: { iss?: string; scope?: string; aud?: string }[] = []
let base = ''
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', c => { body += c })
  req.on('end', () => {
    seen.push({ method: req.method!, url: req.url!, headers: req.headers, body })
    const send = (s: number, d: unknown) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(d)) }
    if (req.url!.startsWith('/openai/deployments/')) {
      if (req.headers['api-key'] !== 'az-key') return send(401, {})
      return send(200, { model: 'gpt-4o-2024-11-20', choices: [{ message: { content: 'azure says hi' }, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 3 } })
    }
    if (req.url === '/ecs-creds') return send(200, { AccessKeyId: 'ASIATASKROLE', SecretAccessKey: 'secret', Token: 'task-session', Expiration: new Date(Date.now() + 3600e3).toISOString() })
    if (req.url!.startsWith('/model/')) return send(200, { output: { message: { content: [{ text: 'bedrock ' }, { text: 'says hi' }] } }, stopReason: 'end_turn', usage: { inputTokens: 20, outputTokens: 4 } })
    if (req.url === '/token') {
      const assertion = new URLSearchParams(body).get('assertion') || ''
      const [h, p, s] = assertion.split('.')
      // Only the signature decides here; the test checks the claims it recorded.
      const valid = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(s, 'base64url'))
      if (!valid) return send(400, { error: 'invalid_grant' })
      jwtClaims.push(JSON.parse(Buffer.from(p, 'base64url').toString()))
      return send(200, { access_token: 'vertex-token', expires_in: 3600 })
    }
    if (req.url!.includes(':rawPredict')) {
      if (req.headers.authorization !== 'Bearer vertex-token') return send(401, {})
      const b = JSON.parse(body)
      if (b.messages.some((m: { content: string }) => m.content.includes('refuse'))) return send(200, { content: [], stop_reason: 'refusal' })
      return send(200, { model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'claude on vertex' }], stop_reason: 'max_tokens', usage: { input_tokens: 9, output_tokens: 2 } })
    }
    if (req.url!.includes(':generateContent')) return send(200, { candidates: [{ content: { parts: [{ text: 'gemini says hi' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 } })
    send(404, {})
  })
})
beforeAll(async () => { await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}` })
afterAll(() => { server.close() })
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
