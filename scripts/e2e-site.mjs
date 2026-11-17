#!/usr/bin/env node
// End-to-end checks for site captures (a photo, a voice note and a few words taken on site) against a running server.
//   BASE_URL=http://localhost:3300 node scripts/e2e-site.mjs
// Over HTTP: a capture is stored with its place, position and activities; its photo and voice note come back as
// the bytes sent, typed by what they are and never by what the sender claimed; a page or a script is refused;
// an empty capture, a wrong status and a phone clock set ahead are refused; another firm gets 404 everywhere; the
// Daily Brief compares the capture with the schedule; deleting erases the files; the audit log names the
// capture and never its words.
// In a phone-sized browser: the capture screen takes a photo from the camera input, records a voice note, stamps
// the position, picks an activity and saves; with no connection the capture waits on the phone and is sent when
// the connection returns; the screens pass the accessibility and type-scale checks.
// Exits non-zero on the first failure.

import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { typeProblems } from './type-audit.mjs'

const BASE = process.env.BASE_URL || 'http://localhost:3000'
// This suite creates its own organizations, so the server must allow self sign-up (RUNF9_SIGNUP=open, as in ci.yml).
if ((await fetch(`${BASE}/api/auth`).then(r => r.json()).catch(() => null))?.signup?.mode === 'invite_only') {
  console.error('✗ Start the server with RUNF9_SIGNUP=open for this suite (invite-only mode is checked by scripts/e2e-beta.mjs).')
  process.exit(1)
}
const FIX = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src', 'lib', 'parsers', '__fixtures__')
let passed = 0
function ok(cond, msg, extra) {
  if (!cond) { console.error(`✗ ${msg}`, extra ?? ''); process.exit(1) }
  passed++
  console.log(`✓ ${msg}`)
}

// Inviting a member needs a confirmed email address: follow the link RunF9 wrote to the test outbox (as in ci.yml).
const OUTBOX = process.env.RUNF9_EMAIL_OUTBOX
async function confirmEmail(client, address) {
  if (!OUTBOX) { console.error('✗ Set RUNF9_EMAIL_OUTBOX to the server\'s outbox folder for this suite (see ci.yml).'); process.exit(1) }
  for (let i = 0; i < 50; i++) {
    for (const f of fs.readdirSync(OUTBOX).filter(x => x.endsWith('.json')).sort().reverse()) {
      const m = JSON.parse(fs.readFileSync(path.join(OUTBOX, f), 'utf8'))
      // Only the token is taken from the message, and only if it looks like one: the request always goes to the
      // server under test, at the one path that confirms an address.
      const token = m.to === address && /\/api\/auth\/verify\?token=([A-Za-z0-9._~-]{16,200})(?![A-Za-z0-9._~-])/.exec(m.text)?.[1]
      if (token) { await client.raw('GET', `/api/auth/verify?token=${encodeURIComponent(token)}`); return }
    }
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error(`no confirmation email to ${address}`)
}

class Client {
  constructor() { this.cookie = '' }
  async raw(method, url, body, headers = {}) {
    const h = { cookie: this.cookie, origin: new URL(BASE).origin, ...headers }
    let payload = body
    if (body && !(body instanceof FormData)) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }
    const res = await fetch(BASE + url, { method, headers: h, body: payload })
    const set = res.headers.get('set-cookie')
    if (set) this.cookie = set.split(';')[0]
    return res
  }
  async req(method, url, body) { const res = await this.raw(method, url, body); return { status: res.status, data: await res.json().catch(() => ({})) } }
  get(u) { return this.req('GET', u) }
  post(u, b) { return this.req('POST', u, b ?? {}) }
  del(u) { return this.req('DELETE', u) }
}

// An 8 × 6 JPEG, and the first bytes of a WebM file (the server reads the type from the bytes; it does not decode audio).
const JPEG = Buffer.from('/9j/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAGAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAA//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKgHA//Z', 'base64')
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01]), Buffer.alloc(600, 7)])
const SECRET = 'HERON-OTTER-4419' // appears only in a capture's note; must never show up in the audit log

const capture = (fields, files = {}) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, typeof v === 'string' ? v : JSON.stringify(v))
  for (const p of files.photos ?? []) fd.append('photo', new Blob([p.bytes], { type: p.type ?? 'image/jpeg' }), p.name ?? 'photo.jpg')
  if (files.audio) fd.append('audio', new Blob([files.audio], { type: 'audio/webm' }), 'voice-note.webm')
  return fd
}

/* ─── Over HTTP ─────────────────────────────────────────────────────────────────────────────── */
const a = new Client(), b = new Client()
const stamp = Date.now()
ok((await a.post('/api/auth', { action: 'signup', email: `site-a-${stamp}@example.com`, password: 'correct horse battery staple', name: 'Fay Field', company: 'Site Builders A' })).status === 200, 'firm A signs up')
ok((await b.post('/api/auth', { action: 'signup', email: `site-b-${stamp}@example.com`, password: 'correct horse battery staple', name: 'Bo Other', company: 'Site Builders B' })).status === 200, 'firm B signs up')

const upload = new FormData()
upload.append('file', new Blob([fs.readFileSync(path.join(FIX, 'sample.xer'))]), 'sample.xer')
const up = await a.post('/api/schedules', upload)
ok(up.status === 200 && up.data.schedule?.id, 'firm A uploads a schedule', up.data)
const sid = up.data.schedule.id
const base = `/api/schedules/${sid}/captures`

const first = await a.get(`${base}?activities=1`)
ok(first.status === 200 && first.data.captures.length === 0 && first.data.canCapture === true && first.data.enabled === true, 'a project starts with no captures, and its owner may capture')
ok(Array.isArray(first.data.activities) && first.data.activities.length > 5 && first.data.activities.every(x => x.code && x.name && x.state), 'the capture screen gets the schedule\'s activities to pick from')
const order = first.data.activities.map(x => x.state)
ok(order.lastIndexOf('in_progress') < (order.indexOf('not_started') === -1 ? Infinity : order.indexOf('not_started')) || !order.includes('in_progress'), 'work under way is offered first')
const notStarted = first.data.activities.find(x => x.state === 'not_started')
ok(!!notStarted, 'the sample has an activity that has not started', order.slice(0, 5))

const made = await a.post(base, capture({
  status: 'progress', note: `Containment going in along the north wall.\nMarker ${SECRET}.`, activityCodes: [notStarted.code], level: 'Level 2', room: 'Data Hall 1',
  lat: '35.6123456789', lng: '-81.2212', accuracyM: '8.4', takenAt: new Date(Date.now() - 60_000).toISOString(), audioSeconds: '12.4',
}, { photos: [{ bytes: JPEG }], audio: WEBM }))
ok(made.status === 200 && made.data.capture?.id, 'a capture with a photo, a voice note and a note is stored', made.data)
const cap = made.data.capture
ok(cap.status === 'progress' && cap.level === 'Level 2' && cap.room === 'Data Hall 1' && cap.placeSource === 'picked', 'it keeps its status and its place')
ok(cap.position && cap.position.lat === 35.6123457 && cap.position.accuracyM === 8.4, 'it keeps the position with the accuracy the phone stated', cap.position)
ok(cap.createdByName === 'Fay Field' && cap.activityCodes[0] === notStarted.code, 'it records who made it and which activity it is about')
const photo = cap.media.find(m => m.kind === 'photo'), audio = cap.media.find(m => m.kind === 'audio')
ok(photo?.contentType === 'image/jpeg' && photo.width === 8 && photo.height === 6 && audio?.contentType === 'audio/webm' && audio.seconds === 12.4, 'the photo and the voice note are typed from their bytes, with the photo\'s size', cap.media)

const img = await a.raw('GET', `${base}/${cap.id}/media/${photo.id}`)
const imgBytes = Buffer.from(await img.arrayBuffer())
ok(img.status === 200 && img.headers.get('content-type') === 'image/jpeg' && imgBytes.equals(JPEG), 'the photo comes back byte for byte')
ok(img.headers.get('x-content-type-options') === 'nosniff' && /sandbox/.test(img.headers.get('content-security-policy') || '') && /private/.test(img.headers.get('cache-control') || ''), 'it is served as a file only: nosniff, sandboxed, private to the browser')
const part = await a.raw('GET', `${base}/${cap.id}/media/${audio.id}`, undefined, { range: 'bytes=0-99' })
ok(part.status === 206 && part.headers.get('content-range') === `bytes 0-99/${WEBM.length}` && (await part.arrayBuffer()).byteLength === 100, 'a voice note answers a byte range (phone browsers play audio that way)')
ok((await a.raw('GET', `${base}/${cap.id}/media/${audio.id}`, undefined, { range: `bytes=${WEBM.length + 5}-` })).status === 416, 'a range past the end is refused')

// The browser keeps the bytes and asks before showing them again; a second send of the same capture is not a second capture.
const etag = img.headers.get('etag')
ok(/no-cache/.test(img.headers.get('cache-control') || '') && (await a.raw('GET', `${base}/${cap.id}/media/${photo.id}`, undefined, { 'if-none-match': etag })).status === 304, 'the browser asks RunF9 before it shows its own copy of a photo again')
const clientId = `e2e-${stamp}-retry`
const once = await a.post(base, capture({ status: 'progress', note: 'Sent, and the answer was lost on the way.', clientId }, { photos: [{ bytes: JPEG }] }))
const twice = await a.post(base, capture({ status: 'progress', note: 'Sent, and the answer was lost on the way.', clientId }, { photos: [{ bytes: JPEG }] }))
ok(once.status === 200 && twice.status === 200 && twice.data.capture.id === once.data.capture.id && twice.data.alreadySent === true, 'a capture the phone sends twice is stored once', twice.data)
ok((await a.get(base)).data.captures.filter(c => /answer was lost/.test(c.note)).length === 1, 'and listed once')
ok((await a.del(`${base}/${once.data.capture.id}`)).status === 200 && (await a.post(base, capture({ status: 'progress', note: 'Sent, and the answer was lost on the way.', clientId }))).status === 410, 'sending it again after it was deleted does not bring it back')

// Refusals: each with a message a person can act on.
const page = await a.post(base, capture({ status: 'progress' }, { photos: [{ bytes: Buffer.from('<!doctype html><html><script>alert(1)</script></html>'), type: 'image/jpeg', name: 'photo.jpg' }] }))
ok(page.status === 400 && page.data.code === 'unsupported_media', 'a web page sent as a photo is refused, whatever it is called', page.data)
ok((await a.post(base, capture({ status: 'progress', note: 'ok' }))).data.code === 'empty_capture', 'a capture with nothing in it is refused')
ok((await a.post(base, capture({ status: 'finished', note: 'A real note' }))).data.code === 'invalid_capture', 'an unknown status is refused')
const ahead = await a.post(base, capture({ status: 'progress', note: 'A real note', takenAt: new Date(Date.now() + 3 * 86_400_000).toISOString() }))
ok(ahead.status === 400 && /clock/.test(ahead.data.error || ''), 'a phone clock set days ahead is refused, with the reason')
ok((await a.post(base, capture({ status: 'progress', note: 'A real note', lat: '95', lng: '10' }))).status === 400, 'a position that is not on the globe is refused')
const five = await a.post(base, capture({ status: 'progress' }, { photos: Array.from({ length: 5 }, () => ({ bytes: JPEG })) }))
ok(five.status === 400 && five.data.code === 'too_many_photos', 'a fifth photo in one capture is refused', five.data)
const words = await a.post(base, capture({ status: 'issue', note: 'Damaged section of tray at gridline C4.', room: 'Data Hall 1', placeSource: 'code' }))
ok(words.status === 200 && words.data.capture.media.length === 0 && words.data.capture.placeSource === 'code', 'a few words are enough for a capture, and a place read from a room code is recorded as such')

// The list, and what the capture screen is offered next time.
const list = await a.get(base)
ok(list.data.captures.length === 2 && list.data.overview.count === 2 && list.data.overview.levels.includes('Level 2') && list.data.overview.rooms.some(r => r.room === 'Data Hall 1'), 'the project lists its captures and remembers the places used')
ok(JSON.stringify(list.data.captures).includes(SECRET) && !('content' in (list.data.captures.find(c => c.id === cap.id).media[0])), 'the list carries the note and never the file bytes')
ok((await a.get(`${base}/${cap.id}`)).data.capture?.id === cap.id, 'one capture can be read by its id')

// Another firm sees nothing and can do nothing.
for (const [what, res] of [
  ['list', await b.get(base)], ['read', await b.get(`${base}/${cap.id}`)], ['add to', await b.post(base, capture({ status: 'progress', note: 'From another firm' }))],
  ['delete from', await b.del(`${base}/${cap.id}`)],
]) ok(res.status === 404, `another firm cannot ${what} this project's captures (404)`, res.status)
ok((await b.raw('GET', `${base}/${cap.id}/media/${photo.id}`)).status === 404, 'another firm cannot fetch the photo (404)')
ok((await fetch(`${BASE}${base}/${cap.id}/media/${photo.id}`)).status === 401, 'nobody fetches a photo without signing in (401)')
// A capture id is only good inside its own project.
const up2 = new FormData()
up2.append('file', new Blob([fs.readFileSync(path.join(FIX, 'sample-msp.xml'))]), 'other-project.xml')
const other = await a.post('/api/schedules', up2)
if (other.status === 200 && other.data.schedule?.id && other.data.schedule.id !== sid) {
  const cross = await a.raw('GET', `/api/schedules/${other.data.schedule.id}/captures/${cap.id}/media/${photo.id}`)
  ok(cross.status === 404, 'a capture is not reachable through another project of the same firm')
}

// The Daily Brief reads the capture against the schedule.
const brief = await a.get(`/api/schedules/${sid}/brief`)
ok(brief.status === 200 && brief.data.brief?.site?.count === 2 && brief.data.brief.site.problems === 1, 'the Daily Brief counts what was recorded on site, and the problems among it', brief.data.brief?.site)
const mismatch = (brief.data.watch?.field ?? []).find(f => f.activity.code === notStarted.code)
ok(mismatch && mismatch.reported === 'working' && mismatch.schedule === 'not started' && mismatch.documentId === cap.id, 'work seen under way on an activity the schedule shows not started is raised as a mismatch', brief.data.watch?.field)
ok((brief.data.alerts ?? []).some(x => x.section === 'site' && x.level === 'act' && /Damaged section/.test(x.text)), 'a problem recorded on site is on the list of things to act on')

// The audit log names the capture, never its words.
const log = await a.get('/api/audit?limit=200')
const events = log.data.events ?? log.data.items ?? []
const created = events.find(e => e.action === 'site.capture_created' && e.detail?.captureId === cap.id)
ok(created && created.detail.photos === 1 && created.detail.voiceNote === true && created.detail.noteChars > 10 && created.detail.level === 'Level 2', 'the audit log records the capture, its sizes and its place', created?.detail)
ok(!JSON.stringify(events).includes(SECRET), 'the audit log never holds a capture\'s words')

// Deleting erases the files and the words.
const gone = await a.del(`${base}/${cap.id}`)
ok(gone.status === 200 && gone.data.mediaDeleted === 2, 'the person who made a capture can delete it; its photo and voice note go with it', gone.data)
ok((await a.raw('GET', `${base}/${cap.id}/media/${photo.id}`)).status === 404 && (await a.get(`${base}/${cap.id}`)).status === 404, 'a deleted capture and its photo are gone')
ok((await a.get(base)).data.captures.length === 1, 'the list no longer shows it')
const log2 = await a.get('/api/audit?limit=200')
ok((log2.data.events ?? log2.data.items ?? []).some(e => e.action === 'site.capture_deleted' && e.detail?.captureId === cap.id && e.detail.ownCapture === true), 'the deletion is in the audit log')

/* ─── In a phone-sized browser ──────────────────────────────────────────────────────────────── */
const executablePath = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined
// A camera and a microphone that produce a test pattern and a tone, allowed without a prompt.
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, geolocation: { latitude: 35.6123, longitude: -81.2212, accuracy: 6 }, permissions: ['geolocation', 'microphone'] })
const [name, value] = a.cookie.split('=')
await context.addCookies([{ name, value: a.cookie.slice(name.length + 1) || value, url: BASE }])
const pg = await context.newPage()
const pageErrors = []
pg.on('pageerror', e => pageErrors.push(String(e)))
await pg.goto(`${BASE}/dashboard/site?schedule=${sid}`, { waitUntil: 'networkidle' })
await pg.getByRole('heading', { name: /Site captures/ }).waitFor()
ok(await pg.getByText('Damaged section of tray at gridline C4.').isVisible(), 'the Site page lists the project\'s captures')
ok((await typeProblems(pg)).length === 0, 'the Site page is on the type scale', await typeProblems(pg))

await pg.getByRole('button', { name: 'New capture' }).first().click()
const sheet = pg.getByRole('dialog', { name: 'New capture' })
await sheet.waitFor()
// The photo input is what the "Take a photo" button opens; on a phone it opens the camera.
ok(await sheet.locator('input[type=file]').getAttribute('capture') === 'environment', 'the photo button opens the rear camera on a phone')
const png = await pg.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 2400; c.height = 1800
  const x = c.getContext('2d'); x.fillStyle = '#4B5056'; x.fillRect(0, 0, 2400, 1800); x.fillStyle = '#FFFFFF'; x.fillRect(300, 300, 900, 600)
  const blob = await new Promise(r => c.toBlob(r, 'image/png'))
  return [...new Uint8Array(await blob.arrayBuffer())]
})
await sheet.locator('input[type=file]').setInputFiles({ name: 'IMG_0001.png', mimeType: 'image/png', buffer: Buffer.from(png) })
await sheet.getByRole('img', { name: 'Photo 1' }).waitFor()
ok(true, 'a photo taken on the phone appears in the capture')
await sheet.getByRole('button', { name: 'Done', exact: true }).click()
await sheet.getByRole('button', { name: 'Record a voice note' }).click()
await sheet.getByRole('button', { name: /^Stop/ }).waitFor()
await pg.waitForTimeout(1600)
await sheet.getByRole('button', { name: /^Stop/ }).click()
await sheet.locator('audio').waitFor()
ok(true, 'a voice note is recorded and can be played back before saving')
await sheet.getByRole('textbox', { name: 'Note' }).fill('Level 2 slab poured and finished.')
await sheet.getByLabel('Level', { exact: true }).fill('Level 2')
await sheet.getByLabel('Room or area').fill('East bay')
await sheet.getByLabel(/Add my position/).check()
await sheet.getByText(/within \d+ m/).waitFor()
ok(true, 'the position is stamped with the accuracy the phone states')
await sheet.getByLabel('Activity').fill(notStarted.code)
await sheet.getByRole('button', { name: new RegExp(notStarted.code) }).first().click()
ok(await sheet.getByRole('list', { name: 'Activities in this capture' }).getByText(notStarted.code).isVisible(), 'an activity is picked by its ID')
ok((await typeProblems(pg)).length === 0, 'the capture screen is on the type scale', await typeProblems(pg))
if (process.env.SCREENSHOTS) { fs.mkdirSync(process.env.SCREENSHOTS, { recursive: true }); await pg.screenshot({ path: path.join(process.env.SCREENSHOTS, 'capture-sheet.png'), fullPage: true }) }
const axeSource = fs.readFileSync(path.join(process.cwd(), 'node_modules/axe-core/axe.min.js'), 'utf8')
const axe = async () => { await pg.addScriptTag({ content: axeSource }); return pg.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] })).violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)) }
ok((await axe()).length === 0, 'the capture screen has no serious accessibility issue', await axe())
await sheet.getByRole('button', { name: 'Save capture' }).click()
await pg.getByText('Capture saved.').waitFor()
const saved = (await a.get(base)).data.captures.find(c => c.note === 'Level 2 slab poured and finished.')
ok(saved && saved.status === 'complete' && saved.room === 'East bay' && saved.activityCodes[0] === notStarted.code, 'the capture made on the phone is stored with its status, place and activity', saved)
const sp = saved.media.find(m => m.kind === 'photo'), sa = saved.media.find(m => m.kind === 'audio')
ok(sp && sp.contentType === 'image/jpeg' && Math.max(sp.width, sp.height) === 1600 && sp.sizeBytes < 400_000, 'the photo was reduced on the phone to 1600 px and sent as a JPEG', sp)
ok(sa && sa.sizeBytes > 200 && sa.seconds >= 1, 'the voice note was sent with its length', sa)
ok(saved.position && Math.abs(saved.position.lat - 35.6123) < 0.001 && saved.position.accuracyM === 6, 'the phone\'s position and accuracy were stored', saved.position)
await pg.locator('li span', { hasText: 'Level 2 · East bay' }).first().waitFor()
ok(await pg.locator('audio').first().isVisible(), 'the new capture is in the list with its place and its voice note')
ok((await axe()).length === 0, 'the Site page has no serious accessibility issue', await axe())

if (process.env.SCREENSHOTS) await pg.screenshot({ path: path.join(process.env.SCREENSHOTS, 'site-page.png'), fullPage: true })
// The photo opens at full size.
await pg.getByRole('button', { name: /Open the photo/ }).first().click()
await pg.getByRole('dialog', { name: /Photo 1 of 1/ }).waitFor()
await pg.keyboard.press('Escape')

// No signal: the capture waits on the phone and goes when the connection is back.
await pg.getByRole('button', { name: 'New capture' }).first().click()
await sheet.waitFor()
await sheet.getByRole('button', { name: 'Not started', exact: true }).click()
await sheet.getByRole('textbox', { name: 'Note' }).fill('Roof membrane not started, deck still wet.')
await context.setOffline(true)
await sheet.getByRole('button', { name: 'Save capture' }).click()
await pg.getByText(/saved on this phone and will be sent/).waitFor()
await pg.getByText(/1 capture is saved on this phone and not sent yet/).waitFor()
ok(!(await a.get(base)).data.captures.some(c => /Roof membrane/.test(c.note)), 'with no connection the capture is kept on the phone, not lost and not sent')
await context.setOffline(false)
await pg.evaluate(() => window.dispatchEvent(new Event('online')))
await pg.getByText(/waiting on this phone has been sent/).waitFor({ timeout: 20_000 })
ok((await a.get(base)).data.captures.some(c => /Roof membrane/.test(c.note)), 'when the connection returns the waiting capture is sent')
// The camera button in the project header works while the Site page is already open, more than once.
for (const n of [1, 2]) {
  await pg.getByRole('button', { name: 'New site capture' }).click()
  await sheet.waitFor()
  await sheet.getByRole('button', { name: 'Close' }).click()
  await sheet.waitFor({ state: 'detached' })
  ok(true, `the header's camera button opens a capture from the Site page (press ${n})`)
}
// Saving while the microphone is still recording keeps what was said.
await pg.getByRole('button', { name: 'New capture' }).first().click()
await sheet.waitFor()
await sheet.getByRole('button', { name: 'In progress', exact: true }).click()
await sheet.getByRole('button', { name: 'Record a voice note' }).click()
await sheet.getByRole('button', { name: /^Stop/ }).waitFor()
await pg.waitForTimeout(1500)
await sheet.getByRole('button', { name: 'Save capture' }).click()
await pg.getByText('Capture saved.').waitFor()
const spoken = (await a.get(base)).data.captures[0]
ok(spoken.note === '' && spoken.media.length === 1 && spoken.media[0].kind === 'audio', 'saving while still recording keeps the voice note', spoken)
// Typing in the note is not interrupted when the page behind the sheet redraws.
await pg.getByRole('button', { name: 'New capture' }).first().click()
await sheet.waitFor()
await sheet.getByRole('textbox', { name: 'Note' }).focus()
await pg.evaluate(() => window.dispatchEvent(new Event('online')))
await pg.waitForTimeout(500)
ok(await sheet.getByRole('textbox', { name: 'Note' }).evaluate(el => el === document.activeElement), 'focus stays in the note while the page behind redraws')
await sheet.getByRole('button', { name: 'Close' }).click()
// A capture kept on the phone belongs to the person who took it: another member on the same phone neither sees nor sends it.
await pg.getByRole('button', { name: 'New capture' }).first().click()
await sheet.waitFor()
await sheet.getByRole('button', { name: 'Problem', exact: true }).click()
await sheet.getByRole('textbox', { name: 'Note' }).fill('Kept on the phone for its author only.')
await context.setOffline(true)
await sheet.getByRole('button', { name: 'Save capture' }).click()
await pg.getByText(/1 capture is saved on this phone and not sent yet/).waitFor()
await confirmEmail(a, `site-a-${stamp}@example.com`)
const invite = await a.post('/api/org', { action: 'invite', email: `site-second-${stamp}@example.com`, role: 'scheduler' })
const second = new Client()
ok((await second.post('/api/auth', { action: 'signup', email: `site-second-${stamp}@example.com`, password: 'correct horse battery staple', name: 'Sam Second', invite: new URL(invite.data.link).searchParams.get('invite') })).status === 200, 'a second member joins firm A')
const cookieName = a.cookie.split('=')[0]
await context.clearCookies()
await context.addCookies([{ name: cookieName, value: second.cookie.slice(cookieName.length + 1), url: BASE }])
await context.setOffline(false)
await pg.goto(`${BASE}/dashboard/site?schedule=${sid}`, { waitUntil: 'networkidle' })
await pg.getByRole('heading', { name: /Site captures/ }).waitFor()
await pg.waitForTimeout(1500)
ok(await pg.getByText(/saved on this phone and not sent yet/).count() === 0 && !(await a.get(base)).data.captures.some(c => /for its author only/.test(c.note)), 'another member on the same phone is not shown the waiting capture and does not send it')
await context.clearCookies()
await context.addCookies([{ name: cookieName, value: a.cookie.slice(cookieName.length + 1), url: BASE }])
await pg.goto(`${BASE}/dashboard/site?schedule=${sid}`, { waitUntil: 'networkidle' })
await pg.getByText(/waiting on this phone has been sent/).waitFor({ timeout: 20_000 })
const kept = (await a.get(base)).data.captures.find(c => /for its author only/.test(c.note))
ok(kept && kept.createdByName === 'Fay Field', 'it is sent when its author is back, under the author\'s name', kept)
ok(pageErrors.length === 0, 'no script error on the Site page', pageErrors)

// A room code is a link: it opens the capture screen with the place already set.
await pg.goto(`${BASE}/dashboard/site?schedule=${sid}&level=${encodeURIComponent('Level 3')}&room=${encodeURIComponent('Room 304')}`, { waitUntil: 'networkidle' })
await sheet.waitFor()
ok(!/level=|room=|new=/.test(pg.url()), 'the room code is used once and taken out of the address')
ok(await sheet.getByLabel('Level', { exact: true }).inputValue() === 'Level 3' && await sheet.getByLabel('Room or area').inputValue() === 'Room 304', 'a room code\'s link opens the capture screen with the level and room set')
await browser.close()

console.log(`\nAll ${passed} site capture checks passed.`)
