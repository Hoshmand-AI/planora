#!/usr/bin/env node
// Proof that an air-gapped RunF9 sends nothing outside the customer's network.
//   npm run build && DATABASE_URL=postgres://… node scripts/e2e-no-egress.mjs
//
// 1. Starts a stand-in for the customer's own model server on 127.0.0.1 (OpenAI-compatible chat and
//    embeddings), counting calls.
// 2. Starts RunF9 (next start) in air-gapped mode with that model and in-network embeddings, with
//    scripts/egress-guard.cjs preloaded: every outbound connection to a non-private address is
//    refused and written to a log.
// 3. Proves the guard works (a deliberate request to a public host must be blocked and logged).
// 4. Uses every feature that can involve AI or the network: sign-up and email, schedule upload and
//    analysis, the interview, AI suggestions, schedule generation, exports, project documents (upload,
//    keyword, vocabulary and meaning-based search), Ask AI with and without documents, and reports.
// 5. Fails if the guard recorded ANY outbound connection, or if the AI features never reached the
//    in-network model (so the run really exercised them).

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..')
const GUARD = path.join(ROOT, 'scripts', 'egress-guard.cjs')
const FIX = path.join(ROOT, 'src', 'lib', 'parsers', '__fixtures__')
const PORT = Number(process.env.NO_EGRESS_PORT || 3002)
const MODEL_PORT = Number(process.env.NO_EGRESS_MODEL_PORT || 4030)
const BASE = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'runf9-no-egress-'))
const EGRESS_LOG = path.join(TMP, 'egress.log')
if (!process.env.DATABASE_URL) { console.error('✗ Set DATABASE_URL (a local Postgres).'); process.exit(1) }

let passed = 0
let server
function ok(cond, msg, extra) {
  if (!cond) { console.error(`✗ ${msg}`, extra ?? ''); finish(1) }
  passed++
  console.log(`✓ ${msg}`)
}
function finish(code) {
  try { server?.kill('SIGTERM') } catch { /* already gone */ }
  if (code) { try { console.error('--- app log (tail) ---\n' + fs.readFileSync(path.join(TMP, 'app.log'), 'utf8').split('\n').slice(-60).join('\n')) } catch { /* none */ } }
  process.exit(code)
}

// ── 1. The customer's in-network model (stand-in) ──
const calls = { chat: 0, embeddings: 0 }
const DIMS = 64
function bagOfWords(text) {
  // Deterministic "embedding": hashed word counts, so passages sharing words with the question are close.
  const v = new Array(DIMS).fill(0)
  for (const w of String(text).toLowerCase().match(/[a-z0-9]+/g) || []) {
    let h = 0
    for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0
    v[h % DIMS] += 1
  }
  return v
}
const model = http.createServer((req, res) => {
  let raw = ''
  req.on('data', d => { raw += d })
  req.on('end', () => {
    const body = JSON.parse(raw || '{}')
    res.setHeader('Content-Type', 'application/json')
    if (req.url.endsWith('/embeddings')) {
      calls.embeddings++
      const input = Array.isArray(body.input) ? body.input : [body.input]
      return res.end(JSON.stringify({ object: 'list', model: body.model, data: input.map((t, index) => ({ object: 'embedding', index, embedding: bagOfWords(t) })) }))
    }
    if (req.url.endsWith('/chat/completions')) {
      calls.chat++
      const wantsJson = JSON.stringify(body.messages || []).includes('JSON')
      const content = wantsJson ? '{"questions": [], "suggestions": []}' : 'Answer from the in-network model. [Spec 01 32 16 §1.5 p.1]'
      return res.end(JSON.stringify({ id: 'local', object: 'chat.completion', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }))
    }
    res.statusCode = 404; res.end('{}')
  })
})
await new Promise(r => model.listen(MODEL_PORT, '127.0.0.1', r))
console.log(`· in-network model stand-in on 127.0.0.1:${MODEL_PORT}`)

// ── 3a. The guard itself must block a public host (positive control) ──
{
  const probeLog = path.join(TMP, 'probe.log')
  const r = spawnSync(process.execPath, ['--require', GUARD, '-e', "fetch('https://example.com/').then(() => process.exit(0), () => process.exit(3))"], { env: { ...process.env, EGRESS_LOG: probeLog }, encoding: 'utf8', timeout: 30000 })
  const logged = (fs.existsSync(probeLog) ? fs.readFileSync(probeLog, 'utf8') : '').split('\n').filter(Boolean).map(l => JSON.parse(l))
  ok(r.status === 3 && logged.length === 1 && logged[0].host === 'example.com' && logged[0].port === 443, 'The egress guard blocks and records a request to a public host (control)', { status: r.status, logged, stderr: r.stderr })
}

// ── 2. RunF9, air-gapped, with the guard preloaded ──
const env = {
  ...process.env,
  NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require ${GUARD}`.trim(),
  EGRESS_LOG,
  NEXT_TELEMETRY_DISABLED: '1',
  PORT: String(PORT),
  RUNF9_AIRGAPPED: 'true',
  RUNF9_AI_MODE: 'local',
  LLM_BASE_URL: `http://127.0.0.1:${MODEL_PORT}/v1`,
  LLM_MODEL: 'onprem-test-model',
  RUNF9_APPROVED_MODELS: 'onprem-test-model',
  RUNF9_EMBEDDINGS_MODEL: 'onprem-test-embed',
  RUNF9_EMBEDDINGS_MIN_SIMILARITY: '0.2',
  RUNF9_SIGNUP: 'open',
  RUNF9_DEFAULT_PLAN: 'enterprise',
  RUNF9_EMAIL_OUTBOX: path.join(TMP, 'outbox'),
  // Control only: one public host the test allow-lists on purpose, to prove the guard is active inside RunF9 (step 5).
  RUNF9_ALLOWED_HOSTS: 'egress-control.example.com',
  JWT_SECRET: process.env.JWT_SECRET || 'no-egress-check-secret',
  // No cloud keys or email provider in an air-gapped install.
  ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', RESEND_API_KEY: '', POSTMARK_API_TOKEN: '',
}
// An air-gapped network has no route to the internet, so no proxy: remove every proxy setting, or
// traffic would go to the (local) proxy first and slip past the guard.
for (const k of Object.keys(env)) if (/(^|_)(https?|all|no)_proxy$|^GLOBAL_AGENT_|^NODE_USE_ENV_PROXY$/i.test(k)) delete env[k]
const appLog = fs.openSync(path.join(TMP, 'app.log'), 'a')
server = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(PORT), '-H', '127.0.0.1'], { cwd: ROOT, env, stdio: ['ignore', appLog, appLog] })
let up = false
for (let i = 0; i < 60 && !up; i++) {
  await new Promise(r => setTimeout(r, 1000))
  up = await fetch(`${BASE}/api/health`).then(r => r.ok).catch(() => false)
}
ok(up, `RunF9 started in air-gapped mode on ${BASE}`)
const health = await fetch(`${BASE}/api/health`).then(r => r.json())
ok(health.checks?.ai?.airgapped === true && health.checks?.ai?.mode === 'local', 'Health reports air-gapped mode with the in-network model', health.checks?.ai)

// ── 4. Use the product ──
class Client {
  constructor() { this.cookie = '' }
  async req(method, url, body) {
    const headers = { cookie: this.cookie }
    let payload = body
    if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }
    const res = await fetch(BASE + url, { method, headers, body: payload })
    const set = res.headers.get('set-cookie')
    if (set) this.cookie = set.split(';')[0]
    const type = res.headers.get('content-type') || ''
    return { status: res.status, data: type.includes('json') ? await res.json().catch(() => ({})) : await res.arrayBuffer() }
  }
  get(u) { return this.req('GET', u) }
  post(u, b) { return this.req('POST', u, b ?? {}) }
  patch(u, b) { return this.req('PATCH', u, b) }
}
const form = (name, content, fields = {}) => {
  const fd = new FormData()
  fd.append('file', new Blob([content]), name)
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return fd
}
const SPEC = `SECTION 01 32 16
CONSTRUCTION PROGRESS SCHEDULE

1.3 SCHEDULE REQUIREMENTS
A. No activity shall have an original duration that exceeds 20 working days, except procurement.
B. The Contractor shall update the progress schedule monthly.

1.5 CONTRACT TIME
Substantial Completion shall be achieved within 540 calendar days after the Notice to Proceed.
Liquidated damages shall be assessed at $5,000 per calendar day.

1.7 WEATHER
Rain days beyond the monthly average are excusable and extend the Contract Time.
`

const A = new Client()
let r = await A.post('/api/auth', { action: 'signup', email: `airgap${Date.now()}@example.com`, password: 'correct horse battery staple', name: 'Ada Airgap', company: 'Enclave Builders' })
ok(r.status === 200, 'Sign up (the confirmation email goes to the local outbox, not a provider)')
{
  const dir = env.RUNF9_EMAIL_OUTBOX
  const mail = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).find(m => /verify\?token=/.test(m.text))
  // Only the token is taken from the message; the request always goes to the local test server.
  const token = /\/api\/auth\/verify\?token=([A-Za-z0-9_-]{20,200})(?![A-Za-z0-9_-])/.exec(mail?.text || '')?.[1]
  ok(!!token, 'The confirmation email is in the local outbox')
  await fetch(`${BASE}/api/auth/verify?token=${encodeURIComponent(token)}`, { headers: { cookie: A.cookie }, redirect: 'manual' })
  ok((await A.get('/api/auth')).data.security?.emailVerified === true, 'Email confirmed from the outbox link')
}

r = await A.req('POST', '/api/schedules', form('sample.xer', fs.readFileSync(path.join(FIX, 'sample.xer'))))
ok(r.status === 200, 'Upload and analyze a P6 schedule', r.data)
const sid = r.data.schedule.id

// AI is off by default for a new organization: nothing may reach even the in-network model.
const docs = `/api/schedules/${sid}/documents`
r = await A.req('POST', docs, form('spec-013216.txt', SPEC, { docType: 'scheduling_spec', title: 'Spec 01 32 16' }))
ok(r.status === 200, 'Upload a scheduling specification (AI still off)', r.data)
const docId = r.data.document.id
r = await A.req('PATCH', `${docs}/${docId}`, { trust: 'approved' })
ok(r.status === 200, 'Approve the document', r.data)
r = await A.post(`${docs}/search`, { query: 'What are the LDs?' })
ok(r.status === 200 && r.data.results.some(x => /Liquidated damages/.test(x.text)), 'Vocabulary search: "LDs" finds the liquidated damages clause, with no model at all', r.data)
ok(r.data.backend === 'postgres-fts' && calls.chat === 0 && calls.embeddings === 0, 'With AI off, nothing was sent to any model, even the in-network one', { backend: r.data.backend, calls })

r = await A.post('/api/org', { action: 'update_settings', settings: { aiEnabled: true } })
ok(r.status === 200 && r.data.settings.aiEnabled === true, 'The admin turns AI on for the organization')

r = await A.post('/api/plans', { sample: true })
ok(r.status === 200, 'Open the sample project (interview)', r.data)
const planId = r.data.plan?.id ?? r.data.id
r = await A.post(`/api/plans/${planId}/suggest`)
ok(r.status === 200, 'AI interview suggestions from the in-network model', r.data)
r = await A.post(`/api/plans/${planId}/generate`)
ok(r.status === 200, 'Generate the CPM schedule', r.status)
for (const format of ['xer', 'xml', 'pdf']) {
  r = await A.get(`/api/plans/${planId}/export?format=${format}`)
  ok(r.status === 200, `Export the plan as ${format.toUpperCase()}`, r.status)
}

r = await A.post(`${docs}/search`, { query: 'rain delays' })
ok(r.status === 200 && r.data.backend === 'postgres-fts+local-embeddings', 'Search now adds in-network meaning-based search', r.data.backend)
ok(r.data.results.some(x => /Rain days/.test(x.text)), 'Meaning-based search finds the weather clause for "rain delays"', r.data)
ok(calls.embeddings >= 2, `Passages and the question were embedded by the in-network model (${calls.embeddings} calls)`)

const chatBefore = calls.chat
r = await A.post('/api/ask', { question: 'How much are liquidated damages and when is substantial completion due?', scheduleId: sid, useDocuments: true })
ok(r.status === 200 && r.data.answer, 'Ask AI with project documents', r.data)
r = await A.post('/api/ask', { question: 'Which activities are on the critical path?', scheduleId: sid })
ok(r.status === 200 && r.data.answer, 'Ask AI about the schedule', r.data)
r = await A.post('/api/reports', { reportType: 'qa_qc', scheduleId: sid, useDocuments: true })
ok(r.status === 200, 'Generate a QA/QC report with documents', r.status)
ok(calls.chat > chatBefore, `AI features used the in-network model (${calls.chat} chat calls, ${calls.embeddings} embedding calls)`)

r = await A.get(`/api/schedules/${sid}/export?format=xer`)
ok(r.status === 200, 'Export the uploaded schedule')

// Connections an admin could point outside the network are refused before connecting.
r = await A.post('/api/org/integrations', { action: 'create_webhook', url: 'https://hooks.example.com/runf9', events: ['plan.created'] })
ok(r.status === 400 && /air-gapped/.test(r.data.error || ''), 'A webhook to a public address is refused in air-gapped mode', r.data)
r = await A.post('/api/org', { action: 'update_sso', sso: { enabled: true, issuer: 'https://login.microsoftonline.com/tenant/v2.0', clientId: 'x', clientSecret: 'y', domains: ['enclave-builders.test'] } })
ok(r.status === 400 && /air-gapped/.test(r.data.error || ''), 'Single sign-on with an internet identity provider is refused in air-gapped mode', r.data)

// ── 5. Nothing left the network ──
await new Promise(res => setTimeout(res, 1500)) // let any background work settle
const egress = fs.existsSync(EGRESS_LOG) ? fs.readFileSync(EGRESS_LOG, 'utf8').trim() : ''
ok(egress === '', 'No outbound connection to any address outside the private network was attempted', egress)

// Control: the guard is active inside the RunF9 server. The one host allow-listed above is public, so
// a webhook test to it must be attempted by RunF9 and stopped (and recorded) by the guard.
r = await A.post('/api/org/integrations', { action: 'create_webhook', url: 'https://egress-control.example.com/hook', events: ['plan.created'] })
ok(r.status === 200, 'Control: a webhook to the allow-listed host is accepted', r.data)
await A.post('/api/org/integrations', { action: 'test_webhook', id: r.data.webhook.id })
await new Promise(res => setTimeout(res, 1500))
const control = (fs.existsSync(EGRESS_LOG) ? fs.readFileSync(EGRESS_LOG, 'utf8').trim() : '').split('\n').filter(Boolean).map(l => JSON.parse(l))
ok(control.length > 0 && control.every(e => e.host === 'egress-control.example.com'), 'Control: the guard inside RunF9 caught that attempt, and only that one', control)

console.log(`\n${passed} checks passed. Logs: ${TMP}`)
model.close()
finish(0)
