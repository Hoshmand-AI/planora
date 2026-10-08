#!/usr/bin/env node
// Cross-tenant isolation suite against a running Planora server (same env as CI's e2e job).
//   BASE_URL=http://localhost:3200 [DATABASE_URL=postgres://…] [PLANORA_EMAIL_OUTBOX=/tmp/outbox]
//   [WEBHOOK_RECEIVER_PORT=4020] node scripts/e2e-tenant-isolation.mjs
//
// Two organizations, A and B. A creates one of every tenant-owned object (plan, generated + published
// schedule, two uploads in an update series, a scenario edit, risk inputs, a data-question answer, a
// reviewer disposition, a DCMA decision, an expert review, a workspace, an invitation, an API key, a
// webhook, a session). Then B — signed in, with its own API key, and anonymously — tries to read,
// change, delete and act on each of A's objects by URL id, by query parameter (?id=, ?scheduleId=,
// base=), by body reference (B's own objects pointing at A's ids), through compare/windows with mixed
// organizations, exports and report generation.
//
// Every attempt must:
//   • return 404 or 403 (401 when anonymous) — or, for B's own object referencing an A id, the same
//     response as for a random id that does not exist;
//   • return exactly the same status and error as the same request with A's ids replaced by random
//     ones (no existence oracle);
//   • never carry A's data (A-specific marker strings and A's ids) in the body.
// List endpoints for B (plans, schedules, portfolio, history, audit, org, integrations, workspaces,
// exports, webhook deliveries) must never include A's items, and every write attempt must leave A's
// objects unchanged. Prints a table of every check and exits non-zero on any failure.

import fs from 'node:fs'
import { randomUUID } from 'node:crypto'

const BASE = process.env.BASE_URL || 'http://localhost:3000'
const ORIGIN = new URL(BASE).origin
const OUTBOX = process.env.PLANORA_EMAIL_OUTBOX
const HOOK_PORT = process.env.WEBHOOK_RECEIVER_PORT ? Number(process.env.WEBHOOK_RECEIVER_PORT) : null
const PW = 'correct horse battery staple'

const stamp = Date.now()
/** Every string A writes carries AMARK; B's carry BMARK. Bodies are checked case-insensitively. */
const AMARK = `amark${stamp}`
const BMARK = `bmark${stamp}`

/* ─── Results ─────────────────────────────────────────── */

const rows = []
function record(group, name, ok, info = {}) {
  rows.push({ group, name, ok: !!ok, ...info })
  if (!ok) console.error(`✗ [${group}] ${name}${info.note ? ` — ${info.note}` : ''}`)
}

function printTable() {
  const cols = [['#', r => String(r.i)], ['result', r => (r.ok ? 'PASS' : 'FAIL')], ['group', r => r.group], ['who', r => r.who ?? ''], ['request', r => r.req ?? ''], ['status', r => r.status ?? ''], ['random-id status', r => r.fake ?? ''], ['check', r => r.name]]
  rows.forEach((r, i) => { r.i = i + 1 })
  const w = cols.map(([h, f]) => Math.min(70, Math.max(h.length, ...rows.map(r => String(f(r)).length))))
  const line = cells => cells.map((c, i) => String(c).slice(0, w[i]).padEnd(w[i])).join(' | ')
  console.log('\n' + line(cols.map(c => c[0])))
  console.log(w.map(n => '-'.repeat(n)).join('-+-'))
  for (const r of rows) console.log(line(cols.map(([, f]) => f(r))))
  const failed = rows.filter(r => !r.ok)
  console.log(`\n${rows.length - failed.length}/${rows.length} tenant-isolation checks passed.`)
  if (failed.length) {
    console.log('\nFailures:')
    for (const r of failed) console.log(`  #${r.i} [${r.group}] ${r.name} ${r.req ?? ''} → ${r.status ?? ''}${r.note ? ` — ${r.note}` : ''}`)
  }
  return failed.length
}

function fatal(msg, extra) {
  record('setup', msg, false, { note: extra !== undefined ? JSON.stringify(extra).slice(0, 400) : undefined })
  printTable()
  process.exit(1)
}

/* ─── HTTP ────────────────────────────────────────────── */

class Client {
  constructor(label, { bearer } = {}) { this.label = label; this.cookie = ''; this.bearer = bearer }
  async req(method, url, body, extraHeaders = {}) {
    const headers = this.bearer ? { authorization: `Bearer ${this.bearer}`, ...extraHeaders } : { cookie: this.cookie, origin: ORIGIN, ...extraHeaders }
    let payload
    if (body instanceof FormData) payload = body
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }
    const res = await fetch(BASE + url, { method, headers, body: payload, redirect: 'manual' })
    const set = res.headers.get('set-cookie')
    if (!this.bearer && set && set.startsWith('planora-token=')) this.cookie = set.split(';')[0]
    const buf = Buffer.from(await res.arrayBuffer())
    const text = buf.toString('latin1')
    let data = {}
    try { data = JSON.parse(buf.toString('utf8')) } catch { data = { raw: text.slice(0, 2000) } }
    return { status: res.status, data, text, headers: res.headers }
  }
  get(u, h) { return this.req('GET', u, undefined, h) }
  post(u, b, h) { return this.req('POST', u, b ?? {}, h) }
  patch(u, b, h) { return this.req('PATCH', u, b, h) }
  put(u, b, h) { return this.req('PUT', u, b, h) }
  del(u, h) { return this.req('DELETE', u, undefined, h) }
}

async function mailLink(to, re) {
  const path = await import('node:path')
  for (let i = 0; i < 50; i++) {
    const files = (await fs.promises.readdir(OUTBOX).catch(() => [])).sort().reverse()
    for (const f of files) {
      const m = JSON.parse(await fs.promises.readFile(path.join(OUTBOX, f), 'utf8'))
      const hit = m.to === to && re.exec(m.text)
      if (hit) return hit[0]
    }
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error(`no email to ${to}`)
}

/** Signs up a new organization and confirms the owner's email (when the server writes an outbox). */
async function signupOrg(email, name, company) {
  const c = new Client(company)
  const r = await c.post('/api/auth', { action: 'signup', email, password: PW, name, company })
  if (r.status !== 200) fatal(`sign up ${company}`, r.data)
  if (OUTBOX) {
    const link = new URL(await mailLink(email, /https?:\/\/\S+\/api\/auth\/verify\?token=\S+/))
    const v = await c.get(link.pathname + link.search)
    if (v.status !== 303 || !String(v.headers.get('location')).includes('verified=1')) fatal(`confirm email of ${company}`, v.status)
  }
  return { client: c, userId: r.data.user.id }
}

/** A CSV schedule with logic and open work; every activity name carries the organization's marker. */
function scheduleCsv(mark, stretch = 0) {
  const acts = [['1000', 'Notice to proceed', 0], ['1010', 'Mass excavation', 15], ['1020', 'Site utilities', 12], ['1030', 'Spread footings', 10],
    ['1040', 'Slab on grade', 8], ['1050', 'Erect structural steel', 20], ['1060', 'Roofing', 10], ['1070', 'Exterior skin', 18],
    ['1080', 'MEP rough-in', 25], ['1090', 'Drywall', 15], ['1100', 'Finishes', 20], ['1110', 'Substantial completion', 0]]
  const day = d => { const x = new Date(Date.UTC(2027, 0, 4)); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10) }
  const out = ['Activity ID,Activity Name,Original Duration,Start,Finish,Predecessors,Calendar']
  let t = 0, prev = ''
  for (const [id, name, dur0] of acts) {
    const dur = dur0 ? dur0 + stretch : 0
    const cal = Math.round(dur * 7 / 5)
    out.push([`X${id}`, `"${name} ${mark}"`, dur, day(t), day(t + cal), prev, '"Standard 5 Day"'].join(','))
    prev = `X${id}`
    t += cal
  }
  return out.join('\n')
}

async function upload(c, fileName, content, fields = {}) {
  const fd = new FormData()
  fd.append('file', new Blob([content]), fileName)
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return c.req('POST', '/api/schedules', fd)
}

/* ─── Checks ──────────────────────────────────────────── */

/**
 * Status and error of a response without the per-request id, with the ids the request used replaced by
 * their names, for comparing a real-id response with a random-id one.
 */
function shape(r, ids) {
  let error = r.data?.error ?? null
  if (typeof error === 'string') for (const [k, v] of Object.entries(ids)) if (typeof v === 'string' && v) error = error.split(v).join(`<${k}>`)
  return JSON.stringify({ status: r.status, error, code: r.data?.code ?? null })
}

/** A's ids that may appear in a response only if the request itself carried them. */
let A_IDS = []

function leaks(res, requestText) {
  const body = res.text.toLowerCase()
  const found = []
  if (body.includes(AMARK)) found.push(`marker ${AMARK}`)
  for (const id of A_IDS) if (id && !requestText.includes(id) && res.text.includes(id)) found.push(`A id ${id}`)
  return found
}

function fakeIds(ids) {
  const f = {}
  for (const [k, v] of Object.entries(ids)) {
    if (typeof v !== 'string') { f[k] = v; continue }
    const prefix = /^(ws_|pk_live_)/.exec(v)?.[1] ?? ''
    f[k] = prefix + randomUUID()
  }
  return f
}

/**
 * One cross-tenant attempt: `build(ids)` returns [method, url, body?, headers?]. Runs it with A's ids
 * and with random ids; both must be refused identically and never carry A's data.
 *   expect: allowed statuses (default 403/404; 401 for anonymous)
 *   ref:    B's own object referencing an A id — any status is acceptable as long as it is identical to
 *           the random-id response (A's id must behave exactly like an id that does not exist)
 */
async function attempt(group, who, client, name, build, { expect, ref = false } = {}) {
  const [method, url, body, headers] = build(IDS)
  const [fm, furl, fbody, fheaders] = build(FAKE)
  const res = await client.req(method, url, body, headers)
  const fres = await client.req(fm, furl, fbody, fheaders)
  const allowed = expect ?? (who === 'anonymous' ? [401] : [403, 404])
  const requestText = url + (body && !(body instanceof FormData) ? JSON.stringify(body) : '')
  const leaked = leaks(res, requestText)
  const sameAsRandom = shape(res, IDS) === shape(fres, FAKE)
  const statusOk = ref ? res.status < 500 : allowed.includes(res.status)
  const notes = []
  if (!statusOk) notes.push(`expected ${ref ? 'a non-5xx response' : allowed.join('/')}, got ${res.status}: ${String(res.data?.error ?? res.text).slice(0, 160)}`)
  if (!sameAsRandom) notes.push(`differs from random id: ${shape(res, IDS)} vs ${shape(fres, FAKE)}`)
  if (leaked.length) notes.push(`body leaks ${leaked.join(', ')}`)
  record(group, name, statusOk && sameAsRandom && !leaked.length, { who, req: `${method} ${url.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, m => m.slice(0, 8) + '…')}`, status: res.status, fake: fres.status, note: notes.join('; ') || undefined })
}

/** A list/read endpoint the caller may use: 200, and nothing of A's in it. */
async function listCheck(group, who, client, name, method, url, body, { status = 200 } = {}) {
  const res = await client.req(method, url, body)
  const leaked = leaks(res, '')
  const ok = res.status === status && !leaked.length
  record(group, name, ok, { who, req: `${method} ${url}`, status: res.status, note: ok ? undefined : (leaked.length ? `leaks ${leaked.join(', ')}` : String(res.data?.error ?? res.text).slice(0, 200)) })
  return res
}

/** A positive control or integrity check by A (or about A's data). */
async function control(group, name, fn) {
  try {
    const r = await fn()
    const ok = r === true || (r && r.ok)
    record(group, name, ok, { who: 'A', note: ok ? undefined : (r?.note ?? 'unexpected result') })
  } catch (err) {
    record(group, name, false, { who: 'A', note: String(err?.message || err).slice(0, 200) })
  }
}

let IDS = {}
let FAKE = {}

/* ─── Main ────────────────────────────────────────────── */

async function main() {
  if (process.env.DATABASE_URL) {
    // Start from clean rate-limit counters so earlier runs from this machine don't interfere.
    const { default: pg } = await import('pg')
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
    await db.connect(); await db.query('DELETE FROM rate_limits'); await db.end()
  }

  // Webhook receiver: /a-… is A's endpoint, /b-… is B's.
  const deliveries = []
  let srv = null
  if (HOOK_PORT) {
    const { createServer } = await import('node:http')
    srv = createServer((req, res) => { let b = ''; req.on('data', c => { b += c }); req.on('end', () => { deliveries.push({ path: req.url, body: b }); res.end('ok') }) })
    await new Promise(r => srv.listen(HOOK_PORT, r))
  }

  /* ── Organization A creates one of everything ── */
  const aEmail = `${AMARK}-owner@example.com`
  const { client: A, userId: UA } = await signupOrg(aEmail, `Ada ${AMARK}`, `Alpha Builders ${AMARK}`)
  const { client: B, userId: UB } = await signupOrg(`${BMARK}-owner@example.com`, `Bo ${BMARK}`, `Beta Construction ${BMARK}`)

  let r = await A.post('/api/plans', { name: `Alpha plan ${AMARK}`, projectType: 'warehouse_industrial' })
  if (r.status !== 200) fatal('A creates a plan', r.data)
  const PA = r.data.plan.id
  r = await A.patch(`/api/plans/${PA}`, { answers: { 'project.state': { status: 'known', value: 'TX' } }, addNote: `Alpha team note ${AMARK}` })
  if (r.status !== 200) fatal('A answers interview questions', r.data)
  r = await A.post(`/api/plans/${PA}/generate`, {})
  if (r.status !== 200 || !r.data.plan.generated) fatal('A generates the schedule', r.data)
  r = await A.post(`/api/plans/${PA}/decide`, { key: 'dcma:6', decision: 'accept', note: `Accepted by Alpha ${AMARK}` })
  if (r.status !== 200) fatal('A records a DCMA decision on the plan', r.data)
  r = await A.post(`/api/plans/${PA}/review`, { verdict: 'approve_with_comments', comment: `Alpha review ${AMARK}` })
  if (r.status !== 200) fatal('A records an expert review', r.data)
  r = await A.post(`/api/plans/${PA}/publish`, { confirm: true })
  if (r.status !== 200 || !r.data.schedule) fatal('A publishes the plan', r.data)
  const PS = r.data.schedule.id

  const fileA = `alpha-${AMARK}.csv`
  r = await upload(A, fileA, scheduleCsv(AMARK), { version: 'Baseline' })
  if (r.status !== 200) fatal('A uploads a schedule', r.data)
  const SA = r.data.schedule.id
  r = await upload(A, fileA, scheduleCsv(AMARK, 2), { version: 'Update 1' })
  if (r.status !== 200 || r.data.summary.series !== 2) fatal('A uploads the next update of the same project', r.data)
  const SA2 = r.data.schedule.id
  r = await A.get(`/api/schedules?id=${SA2}`)
  if (r.status !== 200) fatal('A reads its upload', r.data)
  const open = r.data.activities.filter(a => a.activityType === 'task' && a.status !== 'complete')
  if (open.length < 2) fatal('A upload has open activities', r.data.activities?.length)
  const ACT = open[1].id
  r = await A.post(`/api/schedules/${SA2}/edits`, { change: { kind: 'duration', activityId: ACT, remaining: open[1].duration + 3 }, reason: `Alpha what-if ${AMARK}` })
  if (r.status !== 200 || !r.data.added?.length) fatal('A makes a scenario edit', r.data)
  const EA = r.data.added[0]
  r = await A.put(`/api/schedules/${SA2}/risk`, { ranges: [{ activityId: ACT, optimistic: 5, mostLikely: 8, pessimistic: 14 }], events: [{ name: `Alpha risk ${AMARK}`, probability: 0.3, impactDays: 10, activityId: ACT }] })
  if (r.status !== 200) fatal('A saves risk inputs', r.data)
  r = await A.get(`/api/schedules/${SA2}/quality`)
  const questionId = r.data.dataQuestions?.[0]?.id ?? `dcma:${r.data.dcma?.checks.find(c => c.result === 'fail' || c.result === 'warn')?.id ?? 5}`
  r = await A.post(`/api/schedules/${SA2}/quality`, { questionId, response: 'intentional', note: `Alpha answer ${AMARK}` })
  if (r.status !== 200) fatal('A answers a data question', r.data)
  r = await A.post(`/api/schedules/${SA2}/review`, { itemId: 'dcma:6', disposition: 'exception', justification: `Alpha justification ${AMARK} with enough words` })
  if (r.status !== 200) fatal('A records a reviewer disposition', r.data)
  r = await A.post(`/api/schedules/${SA2}/review`, { submission: 'approved_as_noted', comments: `Alpha comments ${AMARK}` })
  if (r.status !== 200) fatal('A records a submission review', r.data)
  r = await A.post('/api/workspaces', { action: 'create', name: `Alpha matter ${AMARK}`, walled: true })
  if (r.status !== 200) fatal('A creates a workspace', r.data)
  const WSA = r.data.workspace.id
  r = await A.post('/api/org', { action: 'invite', email: `${AMARK}-invitee@example.com`, role: 'viewer' })
  if (r.status !== 200) fatal('A invites a member', r.data)
  const IA = r.data.invitation.id
  r = await A.post('/api/org/integrations', { action: 'create_key', name: `Alpha key ${AMARK}`, role: 'scheduler' })
  if (r.status !== 200) fatal('A creates an API key', r.data)
  const KEYA = r.data.key.id, keyASecret = r.data.secret
  let HOOKA = `wh-none-${stamp}`
  if (HOOK_PORT) {
    r = await A.post('/api/org/integrations', { action: 'create_webhook', url: `http://localhost:${HOOK_PORT}/a-${AMARK}`, events: ['plan.created', 'schedule.upload', 'plan.generate'] })
    if (r.status !== 200) fatal('A adds a webhook', r.data)
    HOOKA = r.data.webhook.id
  }
  r = await A.get('/api/account')
  const SESSA = r.data.sessions?.find(s => s.current)?.id
  if (!SESSA) fatal('A lists its sessions', r.data)
  const aPlanVersion = (await A.get(`/api/plans/${PA}`)).data.plan.version

  IDS = { PA, PS, SA, SA2, ACT, EA, WSA, IA, KEYA, HOOKA, SESSA, UA }
  FAKE = fakeIds(IDS)
  A_IDS = Object.values(IDS).filter(v => typeof v === 'string' && v.length >= 12)

  /* ── Organization B: its own objects (for references and mixed requests) ── */
  r = await B.post('/api/plans', { name: `Beta plan ${BMARK}` })
  if (r.status !== 200) fatal('B creates a plan', r.data)
  const PB = r.data.plan.id
  r = await upload(B, `beta-${BMARK}.csv`, scheduleCsv(BMARK))
  if (r.status !== 200) fatal('B uploads a schedule', r.data)
  const SB = r.data.schedule.id
  r = await B.post('/api/workspaces', { action: 'create', name: `Beta matter ${BMARK}` })
  if (r.status !== 200) fatal('B creates a workspace', r.data)
  const WSB = r.data.workspace.id
  r = await B.post('/api/org/integrations', { action: 'create_key', name: `Beta key ${BMARK}`, role: 'scheduler' })
  if (r.status !== 200) fatal('B creates an API key', r.data)
  const BK = new Client('B key', { bearer: r.data.secret })
  if (HOOK_PORT) {
    r = await B.post('/api/org/integrations', { action: 'create_webhook', url: `http://localhost:${HOOK_PORT}/b-${BMARK}`, events: ['plan.created', 'schedule.upload', 'plan.generate', 'schedule.delete', 'plan.deleted'] })
    if (r.status !== 200) fatal('B adds a webhook', r.data)
  }
  const anon = new Client('anonymous')

  /* ── Positive controls: A can reach everything the attempts target ── */
  for (const [name, url] of [
    ['plan', `/api/plans/${PA}`], ['plan risk', `/api/plans/${PA}/risk`], ['plan export', `/api/plans/${PA}/export?format=md`],
    ['published schedule', `/api/schedules?id=${PS}`], ['upload', `/api/schedules?id=${SA2}`], ['quality', `/api/schedules/${SA2}/quality`],
    ['edits', `/api/schedules/${SA2}/edits`], ['risk', `/api/schedules/${SA2}/risk`], ['recovery', `/api/schedules/${SA2}/recovery`],
    ['review', `/api/schedules/${SA2}/review`], ['original file', `/api/schedules/${SA2}/export?format=original`], ['compare', `/api/schedules/compare?id=${SA2}&base=${SA}`],
    ['windows', `/api/schedules/windows?id=${SA2}`], ['Ask AI history', `/api/ask?scheduleId=${SA2}`],
  ]) {
    await control('control', `A reads its own ${name}`, async () => { const x = await A.get(url); return { ok: x.status === 200, note: `${x.status} ${String(x.data?.error ?? '').slice(0, 120)}` } })
  }
  await control('control', 'A generates a report on its own upload', async () => { const x = await A.post('/api/reports', { reportType: 'executive_summary', scheduleId: SA2 }); return { ok: x.status === 200, note: `${x.status} ${x.data?.error ?? ''}` } })
  await control('control', "A's API key reads A's plan", async () => { const x = await new Client('A key', { bearer: keyASecret }).get(`/api/plans/${PA}`); return { ok: x.status === 200 && x.text.toLowerCase().includes(AMARK), note: String(x.status) } })

  /* ── B (signed in) against every A object ── */
  const b = (name, build, opts) => attempt('B session', 'B', B, name, build, opts)
  // Plans
  await b('read plan', i => ['GET', `/api/plans/${i.PA}`])
  await b('rename / answer plan', i => ['PATCH', `/api/plans/${i.PA}`, { name: `Hijacked ${BMARK}`, answers: { 'project.state': { status: 'known', value: 'CA' } } }])
  await b('stale-version write to plan', i => ['PATCH', `/api/plans/${i.PA}`, { name: 'x' }, { 'x-plan-version': '1' }])
  await b('delete plan', i => ['DELETE', `/api/plans/${i.PA}`])
  await b('generate plan', i => ['POST', `/api/plans/${i.PA}/generate`, { fresh: true }])
  await b('override activity in plan', i => ['POST', `/api/plans/${i.PA}/edit`, { edit: { kind: 'duration', activityId: 'x', value: 9, reason: 'cross-tenant test' } }])
  await b('DCMA decision on plan', i => ['POST', `/api/plans/${i.PA}/decide`, { key: 'dcma:6', decision: 'accept', note: 'cross-tenant decision' }])
  await b('expert review of plan', i => ['POST', `/api/plans/${i.PA}/review`, { verdict: 'approve' }])
  await b('publish plan', i => ['POST', `/api/plans/${i.PA}/publish`, { confirm: true }])
  await b('apply recovery to plan', i => ['POST', `/api/plans/${i.PA}/recover`, { optionId: 'workweek' }])
  await b('AI follow-up questions on plan', i => ['POST', `/api/plans/${i.PA}/suggest`, {}])
  await b('plan risk analysis', i => ['GET', `/api/plans/${i.PA}/risk`])
  for (const f of ['xer', 'xml', 'pdf', 'csv', 'md', 'xlsx-p6']) await b(`plan export ${f}`, i => ['GET', `/api/plans/${i.PA}/export?format=${f}`])
  // Schedules (uploaded and published)
  for (const k of ['SA', 'SA2', 'PS']) {
    await b(`read schedule ${k} (?id=)`, i => ['GET', `/api/schedules?id=${i[k]}`])
    await b(`read schedule ${k} scenario (?id=&basis=scenario)`, i => ['GET', `/api/schedules?id=${i[k]}&basis=scenario`])
  }
  await b('tag / relabel schedule (PATCH body id)', i => ['PATCH', '/api/schedules', { id: i.SA2, version: `Hijacked ${BMARK}`, projectType: 'healthcare' }])
  await b('reclassify schedule', i => ['PATCH', '/api/schedules', { id: i.SA2, classification: 'cui' }])
  await b('designate finish milestone', i => ['PATCH', '/api/schedules', { id: i.SA2, finishMilestoneId: null }])
  await b('delete schedule (?id=)', i => ['DELETE', `/api/schedules?id=${i.SA}`])
  await b('recategorize activity', i => ['PATCH', `/api/schedules/${i.SA2}/activities/${encodeURIComponent(i.ACT)}`, { category: 'foundations' }])
  await b('quality / DCMA', i => ['GET', `/api/schedules/${i.SA2}/quality`])
  await b('quality scenario', i => ['GET', `/api/schedules/${i.SA2}/quality?basis=scenario`])
  await b('answer data question', i => ['POST', `/api/schedules/${i.SA2}/quality`, { questionId, response: 'will_fix', note: 'cross-tenant' }])
  await b('read scenario edits', i => ['GET', `/api/schedules/${i.SA2}/edits`])
  await b('add scenario edit', i => ['POST', `/api/schedules/${i.SA2}/edits`, { change: { kind: 'duration', activityId: i.ACT, remaining: 1 }, reason: 'cross-tenant edit attempt' }])
  await b('revert scenario edit', i => ['DELETE', `/api/schedules/${i.SA2}/edits?editId=${i.EA}&reason=${encodeURIComponent('cross-tenant revert attempt')}`])
  await b('risk analysis', i => ['GET', `/api/schedules/${i.SA2}/risk`])
  await b('risk analysis scenario', i => ['GET', `/api/schedules/${i.SA2}/risk?basis=scenario`])
  await b('overwrite risk inputs', i => ['PUT', `/api/schedules/${i.SA2}/risk`, { ranges: [], events: [] }])
  await b('recovery options', i => ['GET', `/api/schedules/${i.SA2}/recovery`])
  await b('read reviewer dispositions', i => ['GET', `/api/schedules/${i.SA2}/review`])
  await b('record reviewer disposition', i => ['POST', `/api/schedules/${i.SA2}/review`, { itemId: 'dcma:6', disposition: 'accepted' }])
  await b('record submission review', i => ['POST', `/api/schedules/${i.SA2}/review`, { submission: 'approved' }])
  for (const f of ['original', 'xer', 'xml', 'csv', 'xlsx-p6', 'xlsx-import', 'lookahead-xlsx']) await b(`schedule export ${f}`, i => ['GET', `/api/schedules/${i.SA2}/export?format=${f}`])
  await b('schedule export scenario xer', i => ['GET', `/api/schedules/${i.SA2}/export?format=xer&basis=scenario`])
  // Compare / windows with mixed organizations
  await b('compare A update (no base)', i => ['GET', `/api/schedules/compare?id=${i.SA2}`])
  await b('compare A vs A', i => ['GET', `/api/schedules/compare?id=${i.SA2}&base=${i.SA}`])
  await b('compare A with itself', i => ['GET', `/api/schedules/compare?id=${i.SA2}&base=${i.SA2}`])
  await b('compare B (id) vs A (base)', i => ['GET', `/api/schedules/compare?id=${SB}&base=${i.SA}`])
  await b('compare A (id) vs B (base)', i => ['GET', `/api/schedules/compare?id=${i.SA2}&base=${SB}`])
  await b('compare B vs A as CSV', i => ['GET', `/api/schedules/compare?id=${SB}&base=${i.SA}&format=csv`])
  await b('compare A vs B as XLSX', i => ['GET', `/api/schedules/compare?id=${i.SA2}&base=${SB}&format=xlsx`])
  await b('windows of A series', i => ['GET', `/api/schedules/windows?id=${i.SA2}`])
  await b('windows of A series as CSV', i => ['GET', `/api/schedules/windows?id=${i.SA2}&format=csv`])
  await b('windows of A series as XLSX', i => ['GET', `/api/schedules/windows?id=${i.SA2}&format=xlsx`])
  // AI conversations and reports
  await b('Ask AI history (?scheduleId=)', i => ['GET', `/api/ask?scheduleId=${i.SA2}`])
  await b('Ask AI about A schedule', i => ['POST', '/api/ask', { question: 'What is the critical path?', scheduleId: i.SA2 }])
  for (const t of ['executive_summary', 'critical_path', 'variance', 'qa_qc']) await b(`report ${t} on A schedule`, i => ['POST', '/api/reports', { reportType: t, scheduleId: i.SA2 }])
  await b('report on A published schedule', i => ['POST', '/api/reports', { reportType: 'executive_summary', scheduleId: i.PS, basis: 'scenario' }])
  // B's own objects referencing A's ids (must behave as if the id did not exist)
  await b('B schedule: baseline = A upload', i => ['PATCH', '/api/schedules', { id: SB, baselineScheduleId: i.SA }], { ref: true })
  await b('B schedule: finish milestone = A activity', i => ['PATCH', '/api/schedules', { id: SB, finishMilestoneId: i.ACT }], { ref: true })
  await b('B schedule: edit A activity', i => ['POST', `/api/schedules/${SB}/edits`, { change: { kind: 'duration', activityId: i.ACT, remaining: 1 }, reason: 'reference to another firm' }], { ref: true })
  await b('B schedule: revert A edit', i => ['DELETE', `/api/schedules/${SB}/edits?editId=${i.EA}&reason=${encodeURIComponent('reference to another firm')}`], { ref: true })
  await b('B schedule: recategorize A activity', i => ['PATCH', `/api/schedules/${SB}/activities/${encodeURIComponent(i.ACT)}`, { category: 'foundations' }], { ref: true })
  await b('B schedule: risk range on A activity', i => ['PUT', `/api/schedules/${SB}/risk`, { ranges: [{ activityId: i.ACT, optimistic: 1, mostLikely: 2, pessimistic: 3 }], events: [] }], { ref: true })
  await b('new plan in A workspace', i => ['POST', '/api/plans', { name: `Intruder ${BMARK}`, workspaceId: i.WSA }])
  await b('upload into A workspace', i => { const fd = new FormData(); fd.append('file', new Blob([scheduleCsv(BMARK, 1)]), `beta-ws-${BMARK}.csv`); fd.append('workspaceId', i.WSA); return ['POST', '/api/schedules', fd] })
  await b('audit log filtered to A plan returns nothing', i => ['GET', `/api/audit?targetType=plan&targetId=${i.PA}`], { ref: true })
  // Workspaces
  await b('rename A workspace', i => ['POST', '/api/workspaces', { action: 'update', workspaceId: i.WSA, name: `Hijacked ${BMARK}` }])
  await b('delete A workspace', i => ['POST', '/api/workspaces', { action: 'delete', workspaceId: i.WSA }])
  await b('join A workspace', i => ['POST', '/api/workspaces', { action: 'add_member', workspaceId: i.WSA, userId: UB }])
  await b('remove A member from A workspace', i => ['POST', '/api/workspaces', { action: 'remove_member', workspaceId: i.WSA, userId: i.UA }])
  await b('add A user to B workspace', i => ['POST', '/api/workspaces', { action: 'add_member', workspaceId: WSB, userId: i.UA }])
  await b('restrict A user', i => ['POST', '/api/workspaces', { action: 'set_restricted', userId: i.UA, restricted: true }])
  await b('move A schedule', i => ['POST', '/api/workspaces', { action: 'assign', itemType: 'schedule', itemId: i.SA, workspaceId: WSB }])
  await b('move A plan', i => ['POST', '/api/workspaces', { action: 'assign', itemType: 'plan', itemId: i.PA, workspaceId: null }])
  await b('move B schedule into A workspace', i => ['POST', '/api/workspaces', { action: 'assign', itemType: 'schedule', itemId: SB, workspaceId: i.WSA }])
  // Memberships, invitations, settings
  await b('change A member role', i => ['POST', '/api/org', { action: 'set_role', userId: i.UA, role: 'viewer' }])
  await b('remove A member', i => ['POST', '/api/org', { action: 'remove_member', userId: i.UA }])
  await b('unlock A member', i => ['POST', '/api/org', { action: 'unlock_member', userId: i.UA }])
  await b('transfer B ownership to A member', i => ['POST', '/api/org', { action: 'transfer_ownership', userId: i.UA, password: PW }])
  await b('revoke A invitation', i => ['POST', '/api/org', { action: 'revoke_invite', invitationId: i.IA }])
  // API keys and webhooks
  await b('revoke A API key', i => ['POST', '/api/org/integrations', { action: 'revoke_key', id: i.KEYA }])
  if (HOOK_PORT) {
    await b('delete A webhook', i => ['POST', '/api/org/integrations', { action: 'delete_webhook', id: i.HOOKA }])
    await b('re-enable A webhook', i => ['POST', '/api/org/integrations', { action: 'enable_webhook', id: i.HOOKA }])
    await b('test-deliver A webhook', i => ['POST', '/api/org/integrations', { action: 'test_webhook', id: i.HOOKA }])
  }
  // Sessions
  await b('revoke A session', i => ['POST', '/api/account', { action: 'revoke_session', sessionId: i.SESSA }])

  /* ── B's API key (public API) against A objects ── */
  const k = (name, build, opts) => attempt('B API key', 'B key', BK, name, build, opts)
  await k('read plan', i => ['GET', `/api/plans/${i.PA}`])
  await k('answer plan', i => ['PATCH', `/api/plans/${i.PA}`, { answers: { 'project.state': { status: 'known', value: 'CA' } } }])
  await k('generate plan', i => ['POST', `/api/plans/${i.PA}/generate`, {}])
  await k('plan risk', i => ['GET', `/api/plans/${i.PA}/risk`])
  await k('plan export xer', i => ['GET', `/api/plans/${i.PA}/export?format=xer`])
  await k('read schedule (?id=)', i => ['GET', `/api/schedules?id=${i.SA2}`])
  await k('quality', i => ['GET', `/api/schedules/${i.SA2}/quality`])
  await k('edits', i => ['GET', `/api/schedules/${i.SA2}/edits`])
  await k('risk', i => ['GET', `/api/schedules/${i.SA2}/risk`])
  await k('recovery', i => ['GET', `/api/schedules/${i.SA2}/recovery`])
  await k('review', i => ['GET', `/api/schedules/${i.SA2}/review`])
  await k('export original', i => ['GET', `/api/schedules/${i.SA2}/export?format=original`])
  await k('export xer', i => ['GET', `/api/schedules/${i.SA2}/export?format=xer`])
  await k('compare B vs A', i => ['GET', `/api/schedules/compare?id=${SB}&base=${i.SA}`])
  await k('windows of A series', i => ['GET', `/api/schedules/windows?id=${i.SA2}`])
  await k('add scenario edit (key not allowed on endpoint)', i => ['POST', `/api/schedules/${i.SA2}/edits`, { change: { kind: 'duration', activityId: i.ACT, remaining: 1 }, reason: 'cross-tenant edit attempt' }])
  await k('org integrations (key not allowed on endpoint)', i => ['POST', '/api/org/integrations', { action: 'revoke_key', id: i.KEYA }])

  /* ── Anonymous ── */
  const n = (name, build) => attempt('anonymous', 'anonymous', anon, name, build)
  await n('read plan', i => ['GET', `/api/plans/${i.PA}`])
  await n('delete plan', i => ['DELETE', `/api/plans/${i.PA}`])
  await n('plan export', i => ['GET', `/api/plans/${i.PA}/export?format=xer`])
  await n('read schedule', i => ['GET', `/api/schedules?id=${i.SA2}`])
  await n('delete schedule', i => ['DELETE', `/api/schedules?id=${i.SA}`])
  await n('schedule export original', i => ['GET', `/api/schedules/${i.SA2}/export?format=original`])
  await n('quality', i => ['GET', `/api/schedules/${i.SA2}/quality`])
  await n('edits', i => ['POST', `/api/schedules/${i.SA2}/edits`, { change: { kind: 'duration', activityId: i.ACT, remaining: 1 }, reason: 'anonymous edit attempt' }])
  await n('risk inputs', i => ['PUT', `/api/schedules/${i.SA2}/risk`, { ranges: [], events: [] }])
  await n('compare', i => ['GET', `/api/schedules/compare?id=${i.SA2}&base=${i.SA}`])
  await n('windows', i => ['GET', `/api/schedules/windows?id=${i.SA2}`])
  await n('Ask AI history', i => ['GET', `/api/ask?scheduleId=${i.SA2}`])
  await n('report', i => ['POST', '/api/reports', { reportType: 'executive_summary', scheduleId: i.SA2 }])
  await n('revoke A API key', i => ['POST', '/api/org/integrations', { action: 'revoke_key', id: i.KEYA }])
  await n('workspace assign', i => ['POST', '/api/workspaces', { action: 'assign', itemType: 'plan', itemId: i.PA, workspaceId: null }])
  await n('audit log', i => ['GET', `/api/audit?targetId=${i.PA}`])
  await n('portfolio', () => ['GET', '/api/portfolio'])
  await n('invalid API key', () => ['GET', '/api/portfolio', undefined, { authorization: `Bearer pk_live_${'x'.repeat(43)}` }])

  /* ── Lists, exports and logs for B never include A's items ── */
  const L = (name, method, url, body) => listCheck('B lists', 'B', B, name, method, url, body)
  const plansB = await L('plans', 'GET', '/api/plans')
  record('B lists', 'plans list holds only B plans', plansB.data.plans?.length === 1 && plansB.data.plans[0].id === PB, { who: 'B', req: 'GET /api/plans', status: plansB.status })
  const schedB = await L('schedules', 'GET', '/api/schedules')
  record('B lists', 'schedules list holds only B schedules', (schedB.data.schedules || []).every(s => !A_IDS.includes(s.id)) && schedB.data.schedules?.length === 1 && schedB.data.schedules[0].id === SB, { who: 'B', req: 'GET /api/schedules', status: schedB.status })
  await L('portfolio', 'GET', '/api/portfolio')
  await L('firm history', 'GET', '/api/history')
  await L('audit log', 'GET', '/api/audit?limit=5000')
  await L('audit log CSV', 'GET', '/api/audit?format=csv')
  await L('audit log filtered by A actor', 'GET', `/api/audit?actorId=${UA}`)
  await L('audit chain verification', 'GET', '/api/audit?verify=1')
  await L('organization (members, invitations, settings)', 'GET', '/api/org')
  await L('integrations (keys, webhooks)', 'GET', '/api/org/integrations')
  await L('workspaces', 'GET', '/api/workspaces')
  await L('account (sessions)', 'GET', '/api/account')
  await L('Ask AI history of own schedule', 'GET', `/api/ask?scheduleId=${SB}`)
  await L('compare own schedule (series)', 'GET', `/api/schedules/compare?id=${SB}`)
  await L('windows of own schedule', 'GET', `/api/schedules/windows?id=${SB}`)
  await L('organization data export', 'POST', '/api/org', { action: 'export_data' })
  await L('personal data export', 'POST', '/api/account', { action: 'export_my_data' })
  const KL = (name, url) => listCheck('B lists', 'B key', BK, name, 'GET', url)
  await KL('plans via API key', '/api/plans')
  await KL('schedules via API key', '/api/schedules')
  await KL('portfolio via API key', '/api/portfolio')

  /* ── Every write attempt left A's objects untouched ── */
  const I = (name, fn) => control('A unchanged', name, fn)
  await I('plan: same name and version', async () => { const x = await A.get(`/api/plans/${PA}`); return { ok: x.status === 200 && x.data.plan.name === `Alpha plan ${AMARK}` && x.data.plan.version === aPlanVersion && x.data.plan.answers['project.state']?.value === 'TX', note: `${x.status} v${x.data.plan?.version} (was v${aPlanVersion})` } })
  await I('plan: still in the organization-wide area', async () => { const x = await A.get('/api/plans'); return x.data.plans?.find(p => p.id === PA)?.workspaceId === null })
  await I('uploads still exist with their labels', async () => { const x = await A.get('/api/schedules'); const s = x.data.schedules || []; return s.find(v => v.id === SA)?.version === 'Baseline' && s.find(v => v.id === SA2)?.version === 'Update 1' && s.find(v => v.id === SA2)?.classification !== 'cui' && s.some(v => v.id === PS) })
  await I('scenario edit still active', async () => { const x = await A.get(`/api/schedules/${SA2}/edits`); return x.data.edits?.some(e => e.id === EA) && !(x.data.reverted || []).some(e => e.id === EA) })
  await I('risk inputs unchanged', async () => { const x = await A.get(`/api/schedules/${SA2}/risk`); return { ok: x.status === 200 && x.data.inputs?.events?.length === 1 && x.data.inputs.events[0].impactDays === 10 && x.data.inputs.events[0].probability === 0.3 && x.data.inputs.ranges?.length === 1 && x.data.inputs.ranges[0].pessimistic === 14, note: `${x.status} ${JSON.stringify(x.data.inputs ?? x.data).slice(0, 300)}` } })
  // Read back through the organization export, which carries every stored answer (not only open findings).
  await I('data-question answer unchanged', async () => { const x = await A.post('/api/org', { action: 'export_data' }); const resp = x.data.schedules?.find(v => v.id === SA2)?.dataQuestionResponses?.find(d => d.questionId === questionId); return { ok: resp?.response === 'intentional' && resp.note === `Alpha answer ${AMARK}`, note: `${x.status} ${questionId}: ${JSON.stringify(resp)}` } })
  await I('reviewer dispositions unchanged', async () => { const x = await A.get(`/api/schedules/${SA2}/review`); return x.data.review?.submission?.disposition === 'approved_as_noted' && x.data.review.items.find(it => it.itemId === 'dcma:6')?.disposition === 'exception' })
  await I('activity category unchanged', async () => { const x = await A.get(`/api/schedules?id=${SA2}`); return x.data.activities?.find(a => a.id === ACT)?.category !== 'foundations' })
  await I('workspace unchanged, no foreign members', async () => { const x = await A.get('/api/workspaces'); const w = x.data.workspaces?.find(v => v.id === WSA); return !!w && w.name === `Alpha matter ${AMARK}` && !w.memberIds.includes(UB) })
  await I('owner role and membership unchanged', async () => { const x = await A.get('/api/org'); return x.data.members?.find(m => m.id === UA)?.role === 'owner' && !x.data.members.some(m => m.id === UB) })
  await I('invitation still pending', async () => { const x = await A.get('/api/org'); return x.data.invitations?.some(v => v.id === IA) })
  await I('API key still works', async () => { const x = await new Client('A key', { bearer: keyASecret }).get('/api/portfolio'); return x.status === 200 })
  if (HOOK_PORT) await I('webhook still present and enabled', async () => { const x = await A.get('/api/org/integrations'); const h = x.data.webhooks?.find(v => v.id === HOOKA); return !!h && !h.disabledAt })
  await I('session still valid', async () => { const x = await A.get('/api/account'); return x.status === 200 && x.data.sessions.some(s => s.id === SESSA) })
  await I('B never joined A or saw A in its own workspace list', async () => { const x = await B.get('/api/workspaces'); return !JSON.stringify(x.data).includes(WSA) })
  await I("A's lists never include B's items", async () => {
    const all = await Promise.all(['/api/plans', '/api/schedules', '/api/portfolio', '/api/audit?limit=5000', '/api/org', '/api/org/integrations', '/api/workspaces'].map(u => A.get(u)))
    const bad = all.filter(x => x.text.toLowerCase().includes(BMARK) || x.text.includes(PB) || x.text.includes(SB))
    return { ok: !bad.length, note: `${bad.length} lists leak B` }
  })

  /* ── Update series and duplicate detection never cross organizations ── */
  {
    const { client: C } = await signupOrg(`cmark${stamp}-owner@example.com`, 'Cy Third', `Gamma Third ${stamp}`)
    const x = await upload(C, fileA, scheduleCsv(AMARK)) // byte-identical to A's Baseline, same project key
    record('series', "C uploads A's exact file: not a duplicate of A's upload", x.status === 200 && !x.data.duplicate && x.data.summary?.series === 1 && x.data.schedule?.version === 'Baseline' && !A_IDS.some(id => x.text.includes(id)), { who: 'C', req: 'POST /api/schedules', status: x.status, note: x.status === 200 ? `duplicate=${x.data.duplicate} series=${x.data.summary?.series} version=${x.data.schedule?.version}` : x.data?.error })
    const SC = x.data.schedule?.id
    const cmp = await C.get(`/api/schedules/compare?id=${SC}`)
    record('series', "C's update series holds only C's upload", cmp.status === 200 && cmp.data.series?.length === 1 && !A_IDS.some(id => cmp.text.includes(id)), { who: 'C', req: 'GET /api/schedules/compare', status: cmp.status })
    const win = await C.get(`/api/schedules/windows?id=${SC}`)
    record('series', "C's windows analysis never pulls in A's updates", win.status === 200 && !A_IDS.some(id => win.text.includes(id)), { who: 'C', req: 'GET /api/schedules/windows', status: win.status })
    const hist = await C.get('/api/history')
    record('series', "C's firm history never uses A's projects", hist.status === 200 && !A_IDS.some(id => hist.text.includes(id)) && (hist.data.schedules || []).every(s => s.id === SC), { who: 'C', req: 'GET /api/history', status: hist.status })
  }

  /* ── Webhook deliveries stay inside their organization ── */
  if (HOOK_PORT) {
    await A.post('/api/plans', { name: `Alpha webhook plan ${AMARK}` })
    await B.post('/api/plans', { name: `Beta webhook plan ${BMARK}` })
    for (let i = 0; i < 60 && !(deliveries.some(d => d.path.startsWith('/a-') && d.body.includes('Alpha webhook plan')) && deliveries.some(d => d.path.startsWith('/b-') && d.body.includes('Beta webhook plan'))); i++) await new Promise(r2 => setTimeout(r2, 100))
    const toA = deliveries.filter(d => d.path.startsWith('/a-')), toB = deliveries.filter(d => d.path.startsWith('/b-'))
    record('webhooks', "A's endpoint receives A's events (control)", toA.some(d => d.body.includes(`Alpha webhook plan ${AMARK}`)), { who: 'A', req: 'webhook /a-…', status: toA.length })
    record('webhooks', "B's endpoint receives B's events (control)", toB.some(d => d.body.includes(`Beta webhook plan ${BMARK}`)), { who: 'B', req: 'webhook /b-…', status: toB.length })
    record('webhooks', "B's endpoint never receives A's events", !toB.some(d => d.body.toLowerCase().includes(AMARK) || A_IDS.some(id => d.body.includes(id))), { who: 'B', req: 'webhook /b-…', status: toB.length })
    record('webhooks', "A's endpoint never receives B's events", !toA.some(d => d.body.toLowerCase().includes(BMARK) || d.body.includes(PB) || d.body.includes(SB)), { who: 'A', req: 'webhook /a-…', status: toA.length })
    const integ = await B.get('/api/org/integrations')
    record('webhooks', "B's delivery status list shows only B's endpoint", integ.status === 200 && integ.data.webhooks?.length === 1 && !integ.text.includes(HOOKA) && !integ.text.toLowerCase().includes(AMARK), { who: 'B', req: 'GET /api/org/integrations', status: integ.status })
    srv.close()
  }

  const failed = printTable()
  process.exit(failed ? 1 : 0)
}

main().catch(err => { console.error(err); printTable(); process.exit(1) })
