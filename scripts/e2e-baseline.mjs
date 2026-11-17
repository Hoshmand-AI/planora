#!/usr/bin/env node
// End-to-end checks, over HTTP against a running server, for two things:
//   1. A schedule kept in a Word document or a PowerPoint deck is uploaded and analysed like any other.
//   2. A project keeps one upload as its baseline and one as its comparison schedule: every upload is measured
//      against the baseline, a new upload picks it up, "what changed" compares with the stored comparison
//      schedule by default and with the baseline on request, another firm cannot see or change either, and
//      deleting an upload forgets its role.
//   BASE_URL=http://localhost:3000 node scripts/e2e-baseline.mjs
// Exits non-zero on the first failure.

const BASE = process.env.BASE_URL || 'http://localhost:3000'
if ((await fetch(`${BASE}/api/auth`).then(r => r.json()).catch(() => null))?.signup?.mode === 'invite_only') {
  console.error('✗ Start the server with RUNF9_SIGNUP=open for this suite.')
  process.exit(1)
}
let passed = 0
function ok(cond, msg, extra) {
  if (!cond) { console.error(`✗ ${msg}`, extra ?? ''); process.exit(1) }
  passed++
  console.log(`✓ ${msg}`)
}
class Client {
  constructor() { this.cookie = '' }
  async req(method, url, body) {
    const h = { cookie: this.cookie, origin: new URL(BASE).origin }
    let payload = body
    if (body && !(body instanceof FormData)) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }
    const res = await fetch(BASE + url, { method, headers: h, body: payload })
    const set = res.headers.get('set-cookie')
    if (set) this.cookie = set.split(';')[0]
    return { status: res.status, data: await res.json().catch(() => ({})) }
  }
  get(u) { return this.req('GET', u) }
  post(u, b) { return this.req('POST', u, b ?? {}) }
  put(u, b) { return this.req('PUT', u, b) }
  del(u) { return this.req('DELETE', u) }
}

/** A ZIP with stored entries: enough for a .docx or .pptx. */
function zip(files) {
  const local = [], central = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8'), n = Buffer.from(name, 'utf8')
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(n.length, 26)
    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(data.length, 24); dir.writeUInt16LE(n.length, 28); dir.writeUInt32LE(offset, 42)
    local.push(head, n, data); central.push(dir, n)
    offset += 30 + n.length + data.length
  }
  const dirBytes = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(dirBytes.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, dirBytes, end])
}
const HEAD = ['Activity ID', 'Activity Name', 'Duration', 'Start', 'Finish', 'Predecessors']
// The same four activities; each update pushes the last two a week further out.
const rows = slip => {
  const d = (m, day) => `${String(m).padStart(2, '0')}/${String(day).padStart(2, '0')}/2027`
  return [
    ['A100', 'Mobilize', '5', d(1, 4), d(1, 8), ''],
    ['A110', 'Excavate footings', '10', d(1, 11), d(1, 22), 'A100'],
    ['A120', 'Pour footings', '5', d(2, 1 + slip), d(2, 5 + slip), 'A110'],
    ['A130', 'Backfill', '5', d(2, 8 + slip), d(2, 12 + slip), 'A120'],
  ]
}
const wTable = table => `<w:tbl>${table.map(r => `<w:tr>${r.map(c => `<w:tc><w:p><w:r><w:t>${c}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`
const aTable = table => `<a:tbl>${table.map(r => `<a:tr>${r.map(c => `<a:tc><a:txBody><a:p><a:r><a:t>${c}</a:t></a:r></a:p></a:txBody></a:tc>`).join('')}</a:tr>`).join('')}</a:tbl>`
const docx = slip => zip({ 'word/document.xml': `<w:document><w:body><w:p><w:r><w:t>Footings schedule</w:t></w:r></w:p>${wTable([HEAD, ...rows(slip)])}</w:body></w:document>` })
const csv = slip => Buffer.from([HEAD, ...rows(slip)].map(r => r.join(',')).join('\n'))
const upload = (c, name, bytes, extra = {}) => { const fd = new FormData(); fd.append('file', new Blob([bytes]), name); for (const [k, v] of Object.entries(extra)) fd.set(k, v); return c.post('/api/schedules', fd) }

const a = new Client(), b = new Client()
const stamp = Date.now(), PW = 'correct horse battery staple'
ok((await a.post('/api/auth', { action: 'signup', email: `base-a-${stamp}@example.com`, password: PW, name: 'Bea Base', company: 'Baseline Builders A' })).status === 200, 'firm A signs up')
ok((await b.post('/api/auth', { action: 'signup', email: `base-b-${stamp}@example.com`, password: PW, name: 'Bo Other', company: 'Baseline Builders B' })).status === 200, 'firm B signs up')

/* ─── A schedule in Word and in PowerPoint ─── */
const word = await upload(a, 'Footings.docx', docx(0))
ok(word.status === 200 && word.data.schedule?.sourceType === 'word' && word.data.schedule.activityCount === 4, 'a schedule in a Word document is uploaded and read: four activities', word.data.schedule ?? word.data)
const deck = zip({ 'ppt/slides/slide1.xml': `<p:sld><p:cSld><p:spTree>${aTable([HEAD, ...rows(0).slice(0, 2)])}</p:spTree></p:cSld></p:sld>`, 'ppt/slides/slide2.xml': `<p:sld><p:cSld><p:spTree>${aTable([HEAD, ...rows(0).slice(2)])}</p:spTree></p:cSld></p:sld>` })
const ppt = await upload(a, 'Lookahead deck.pptx', deck)
ok(ppt.status === 200 && ppt.data.schedule?.sourceType === 'powerpoint' && ppt.data.schedule.activityCount === 4, 'a schedule table spread over two PowerPoint slides is read as one schedule', ppt.data.schedule ?? ppt.data)
const quality = await a.get(`/api/schedules/${word.data.schedule.id}/quality`)
ok(quality.status === 200, 'the Word schedule is analysed like any other (its quality checks run)', quality.status)
const notes = await upload(a, 'Minutes.docx', zip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Minutes of the weekly meeting. Nothing to schedule.</w:t></w:r></w:p></w:body></w:document>' }))
ok(notes.status >= 400 && /No schedule was found in this Word document/.test(notes.data.error || ''), 'a Word document with no schedule in it is refused with the reason', notes.data)

/* ─── A stored baseline and a stored comparison schedule ─── */
const u0 = await upload(a, 'Tower.csv', csv(0))
const u1 = await upload(a, 'Tower.csv', csv(7), { version: 'Update 1' })
const u2 = await upload(a, 'Tower.csv', csv(14), { version: 'Update 2' })
ok(u0.status === 200 && u1.status === 200 && u2.status === 200, 'three updates of one project are uploaded', [u0.data.error, u1.data.error, u2.data.error])
const [s0, s1, s2] = [u0, u1, u2].map(x => x.data.schedule.id)
const rolesUrl = `/api/schedules/${s2}/roles`
const first = await a.get(rolesUrl)
ok(first.status === 200 && first.data.series.length === 3 && first.data.canEdit === true, 'the project lists its three uploads', first.data)
ok(first.data.baseline === null && first.data.comparison === null, 'nothing is stored to begin with')

const setBase = await a.put(rolesUrl, { baselineScheduleId: s1 })
ok(setBase.status === 200 && setBase.data.baseline?.id === s1, 'Update 1 is stored as the baseline', setBase.data)
const after = (await a.get('/api/schedules')).data.schedules ?? []
ok(after.find(s => s.id === s2)?.baselineScheduleId === s1, 'the latest update is now measured against it')
ok((after.find(s => s.id === s1)?.baselineScheduleId ?? null) === null, 'the baseline is not measured against itself')
const setCmp = await a.put(rolesUrl, { comparisonScheduleId: s0 })
ok(setCmp.status === 200 && setCmp.data.comparison?.id === s0 && setCmp.data.baseline?.id === s1, 'the first upload is stored as the comparison schedule, and the baseline stays')

const def = await a.get(`/api/schedules/compare?id=${s2}`)
ok(def.status === 200 && def.data.comparison?.before?.id === s0 && def.data.kept?.comparisonId === s0 && def.data.kept?.baselineId === s1, '"what changed" compares with the stored comparison schedule by default', def.data.comparison?.before ?? def.data)
const vsBase = await a.get(`/api/schedules/compare?id=${s2}&base=baseline`)
ok(vsBase.status === 200 && vsBase.data.comparison?.before?.id === s1, 'and with the stored baseline on request', vsBase.data.comparison?.before ?? vsBase.data)
const vsPick = await a.get(`/api/schedules/compare?id=${s2}&base=${s1}`)
ok(vsPick.status === 200 && vsPick.data.comparison?.before?.id === s1, 'any other upload can still be picked')

// An upload dated before the stored comparison schedule keeps the previous update; the roles are reported as stored.
const cmpLater = await a.put(rolesUrl, { comparisonScheduleId: s1 })
ok(cmpLater.status === 200, 'Update 1 can be stored as the comparison schedule')
const early = await a.get(`/api/schedules/compare?id=${s0}`)
ok(early.status === 200 && early.data.comparison?.before?.id !== s1 && early.data.kept?.comparisonId === s1 && early.data.kept?.comparisonApplies === false, 'an earlier upload is never compared backwards with a later stored one', early.data.comparison?.before ?? early.data.kept)
const own = await a.get(`/api/schedules/compare?id=${s1}`)
ok(own.status === 200 && own.data.kept?.comparisonId === s1 && own.data.kept?.baselineId === s1, 'opening the stored upload itself still reports it as stored', own.data.kept)
ok((await a.put(rolesUrl, { comparisonScheduleId: s0 })).status === 200, 'the comparison schedule is put back')

const u3 = await upload(a, 'Tower.csv', csv(21), { version: 'Update 3' })
ok(u3.status === 200 && u3.data.schedule?.baselineScheduleId === s1, 'a new upload of the project is measured against the stored baseline without anyone setting it', u3.data.schedule ?? u3.data)

ok((await a.put(rolesUrl, { baselineScheduleId: word.data.schedule.id })).status === 400, 'an upload of another project cannot be this project\'s baseline')
ok((await a.put(rolesUrl, {})).status === 400, 'an empty change is refused')
ok((await b.get(rolesUrl)).status === 404 && (await b.put(rolesUrl, { baselineScheduleId: s1 })).status === 404, 'another firm can neither see nor change what the project keeps')
ok((await new Client().get(rolesUrl)).status === 401, 'it needs a sign-in')

const log = (await a.get('/api/audit?limit=200')).data.events ?? []
ok(log.some(e => e.action === 'schedule.project_baseline' && e.detail?.after === s1) && log.some(e => e.action === 'schedule.project_comparison' && e.detail?.after === s0), 'both choices are in the audit log', log.map(e => e.action).slice(0, 10))

ok((await a.del(`/api/schedules?id=${s0}`)).status === 200, 'the comparison upload is deleted')
const afterDelete = await a.get(rolesUrl)
ok(afterDelete.data.comparison === null && afterDelete.data.baseline?.id === s1, 'a deleted upload is no longer the comparison schedule; the baseline stays', afterDelete.data)
const cleared = await a.put(rolesUrl, { baselineScheduleId: null })
ok(cleared.status === 200 && cleared.data.baseline === null, 'the stored baseline can be cleared')
ok((((await a.get('/api/schedules')).data.schedules ?? []).find(s => s.id === s2)?.baselineScheduleId ?? null) === null, 'and the uploads return to how they were measured before')

console.log(`\n${passed} baseline and document-schedule checks passed`)
