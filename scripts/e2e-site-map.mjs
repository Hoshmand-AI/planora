#!/usr/bin/env node
// End-to-end checks for site plans (a drawing per level, its rooms, its place on the ground, room codes and the
// aerial picture) against a running server.
//   BASE_URL=http://localhost:3000 node scripts/e2e-site-map.mjs
// The server must be started with RUNF9_SITE_IMAGERY=http://127.0.0.1:4599/{z}/{x}/{y}.png (as in ci.yml): this
// script starts the stand-in aerial picture source on that port itself, so no real map service is ever called.
// Over HTTP: a drawing is stored and typed from its bytes; rooms and matched points are validated; only people
// who can change the schedule can set drawings up; another firm gets 404 everywhere; a capture keeps a pin on a
// drawing and loses it when the drawing goes; room codes come as a PDF; an aerial square is passed on only when
// it is a picture, and the source is told nothing about the member.
// In a phone-sized browser: the map shows captures on the drawing and where the phone is; the capture screen
// suggests the room from the phone's position and never chooses the level; the set-up screen marks a room.
// Exits non-zero on the first failure.

import fs from 'node:fs'
import os from 'node:os'
import { spawn } from 'node:child_process'
import path from 'node:path'
import postgres from 'pg'
import { chromium } from 'playwright'
import QRCode from 'qrcode'
import { typeProblems } from './type-audit.mjs'
import { png, TILE } from './mock-tiles.mjs'

const BASE = process.env.BASE_URL || 'http://localhost:3000'
const TILE_PORT = Number(process.env.TILE_PORT || 4599)
if ((await fetch(`${BASE}/api/auth`).then(r => r.json()).catch(() => null))?.signup?.mode === 'invite_only') {
  console.error('✗ Start the server with RUNF9_SIGNUP=open for this suite.')
  process.exit(1)
}
const FIX = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src', 'lib', 'parsers', '__fixtures__')
if (!process.env.DATABASE_URL) { console.error('✗ Set DATABASE_URL to the test database for this suite (see ci.yml).'); process.exit(1) }
let passed = 0
function ok(cond, msg, extra) {
  if (!cond) { console.error(`✗ ${msg}`, extra ?? ''); process.exit(1) }
  passed++
  console.log(`✓ ${msg}`)
}

const SHEET = png(1000, 500, [245, 245, 240])
const JPEG = Buffer.from('/9j/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAGAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAA//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKgHA//Z', 'base64')

// The stand-in aerial picture source runs as its own process and writes what it was asked to a file.
// In a folder of its own that only this user can read (never a guessable name in the shared temp folder).
const TILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'runf9-tiles-'))
const TILE_LOG = path.join(TILE_DIR, 'asked.jsonl')
fs.writeFileSync(TILE_LOG, '', { mode: 0o600 })
const tiles = spawn(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), 'mock-tiles.mjs')], { env: { ...process.env, PORT: String(TILE_PORT), LOG: TILE_LOG }, stdio: 'inherit' })
process.on('exit', () => { tiles.kill(); try { fs.rmSync(TILE_DIR, { recursive: true, force: true }) } catch { /* already gone */ } })
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(1)) // so the line above runs
let tilesDown = false
tiles.once('error', () => { tilesDown = true })
tiles.once('exit', () => { tilesDown = true })
const tileLog = () => fs.readFileSync(TILE_LOG, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
// Ready only when the stand-in says it is listening (a port already in use ends it instead).
for (let i = 0; i < 100 && !tilesDown && !tileLog().some(l => l.ready); i++) await new Promise(r => setTimeout(r, 100))
if (tilesDown || !tileLog().some(l => l.ready)) { console.error(`✗ The stand-in aerial picture source did not start on port ${TILE_PORT} (is the port in use?).`); process.exit(1) }
const asked = () => tileLog().filter(l => !l.ready)

// Inviting a member needs a confirmed email address. The confirmation link itself is covered by
// scripts/e2e-security.mjs; here the address is marked confirmed in the test database directly.
async function confirmEmail(address) {
  const db = new postgres.Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  let updated = 0
  try { updated = (await db.query('UPDATE users SET email_verified_at = NOW() WHERE LOWER(email) = LOWER($1)', [address])).rowCount ?? 0 } finally { await db.end() }
  if (updated !== 1) { console.error('✗ DATABASE_URL is not the database the server under test uses: the account just created is not in it.'); process.exit(1) }
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
  patch(u, b) { return this.req('PATCH', u, b) }
  del(u) { return this.req('DELETE', u) }
}
const drawing = (level, bytes = SHEET, type = 'image/png') => { const fd = new FormData(); if (level !== null) fd.set('level', level); fd.append('image', new Blob([bytes], { type }), 'sheet.png'); return fd }

/* ─── Over HTTP ─────────────────────────────────────────────────────────────────────────────── */
const a = new Client(), b = new Client()
const stamp = Date.now(), PW = 'correct horse battery staple'
ok((await a.post('/api/auth', { action: 'signup', email: `map-a-${stamp}@example.com`, password: PW, name: 'Pat Planner', company: 'Map Builders A' })).status === 200, 'firm A signs up')
ok((await b.post('/api/auth', { action: 'signup', email: `map-b-${stamp}@example.com`, password: PW, name: 'Bo Other', company: 'Map Builders B' })).status === 200, 'firm B signs up')
const upload = new FormData()
upload.append('file', new Blob([fs.readFileSync(path.join(FIX, 'sample.xer'))]), 'sample.xer')
const up = await a.post('/api/schedules', upload)
ok(up.status === 200 && up.data.schedule?.id, 'firm A uploads a schedule', up.data)
const sid = up.data.schedule.id, base = `/api/schedules/${sid}/site-plans`, caps = `/api/schedules/${sid}/captures`

const empty = await a.get(base)
ok(empty.status === 200 && empty.data.plans.length === 0 && empty.data.canEdit === true, 'a project starts with no drawings, and its owner may add them')
ok(empty.data.imagery && typeof empty.data.imagery.maxZoom === 'number', 'the page is told the aerial picture is available', empty.data.imagery)

const made = await a.post(base, drawing('Level 2'))
ok(made.status === 200 && made.data.plan?.id && made.data.plan.width === 1000 && made.data.plan.height === 500 && made.data.plan.level === 'Level 2', 'a drawing is stored with its size read from the picture', made.data)
const plan = made.data.plan
ok((await a.post(base, drawing(''))).status === 400, 'a drawing with no level name is refused')
const page = await a.post(base, drawing('Level 9', Buffer.from('<!doctype html><html><script>alert(1)</script></html>')))
ok(page.status === 400 && page.data.code === 'unsupported_media', 'a web page sent as a drawing is refused', page.data)

const img = await a.raw('GET', `${base}/${plan.id}/image`)
ok(img.status === 200 && img.headers.get('content-type') === 'image/png' && Buffer.from(await img.arrayBuffer()).equals(SHEET), 'the drawing comes back byte for byte')
ok(img.headers.get('x-content-type-options') === 'nosniff' && /sandbox/.test(img.headers.get('content-security-policy') || '') && /private, no-cache/.test(img.headers.get('cache-control') || ''), 'it is served as a file only: nosniff, sandboxed, and the browser asks before showing its copy again')
ok((await a.raw('GET', `${base}/${plan.id}/image`, undefined, { 'if-none-match': img.headers.get('etag') })).status === 304, 'an unchanged drawing is not sent twice')
ok((await a.post(base, drawing('Too big', png(6400, 60, [255, 255, 255])))).status === 413, 'a drawing larger than a phone can comfortably draw is refused')

// Rooms
const rooms = await a.patch(`${base}/${plan.id}`, { rooms: [{ name: 'Unit 201 kitchen', x: 0.2, y: 0.3 }, { name: 'Unit 202 kitchen', x: 0.8, y: 0.3 }, { name: 'Corridor', x: 0.5, y: 0.7 }] })
ok(rooms.status === 200 && rooms.data.plan.rooms.length === 3 && rooms.data.plan.rooms.every(r => r.id), 'rooms are marked on the drawing', rooms.data)
ok((await a.patch(`${base}/${plan.id}`, { rooms: [{ name: 'A', x: 0.1, y: 0.1 }, { name: 'a', x: 0.2, y: 0.2 }] })).status === 400, 'two rooms with one name on a drawing are refused (a room code must mean one place)')
ok((await a.patch(`${base}/${plan.id}`, { rooms: [{ name: 'A', x: 1.4, y: 0.1 }] })).status === 400, 'a room outside the sheet is refused')
ok((await a.get(base)).data.plans[0].rooms.length === 3, 'a refused change leaves the rooms as they were')

// Placing the drawing on the ground: a building 100 m wide, north up, in Hickory, NC.
const LAT0 = 35.6123, LNG0 = -81.2212, M = 1 / 111_194.9, east = m => m * M / Math.cos(LAT0 * Math.PI / 180)
const ground = (x, y) => ({ lat: LAT0 - y * 50 * M, lng: LNG0 + east(x * 100) })
const control = (x, y) => ({ x, y, ...ground(x, y) })
ok((await a.patch(`${base}/${plan.id}`, { controls: [control(0.1, 0.1)] })).status === 400, 'one matched point cannot place a drawing')
ok((await a.patch(`${base}/${plan.id}`, { controls: [control(0.1, 0.1), control(0.5, 0.5), control(0.9, 0.9)] })).status === 400, 'three points in one line cannot place a drawing')
const mirrored = [control(0.1, 0.1), { x: 0.9, y: 0.1, ...ground(0.1, 0.9) }, { x: 0.1, y: 0.9, ...ground(0.9, 0.1) }]
const mir = await a.patch(`${base}/${plan.id}`, { controls: mirrored })
ok(mir.status === 400 && /mirrored/.test(mir.data.error || ''), 'a mirrored match is refused, with the reason', mir.data)
const placed = await a.patch(`${base}/${plan.id}`, { controls: [control(0.05, 0.1), control(0.95, 0.9)] })
ok(placed.status === 200 && placed.data.placed === true && placed.data.plan.controls.length === 2, 'two points far apart place the drawing', placed.data)

// Who may set drawings up
const fieldEmail = `map-field-${stamp}@example.com`
await confirmEmail(`map-a-${stamp}@example.com`)
const inv = await a.post('/api/org', { action: 'invite', email: fieldEmail, role: 'field' })
ok(inv.status === 200 && inv.data.link?.includes('/auth?invite='), 'the owner invites a field member', inv.data)
const fieldC = new Client()
ok((await fieldC.post('/api/auth', { action: 'signup', email: fieldEmail, password: PW, name: 'Finn Field', invite: new URL(inv.data.link).searchParams.get('invite') })).status === 200, 'the field member joins')
ok((await fieldC.get(base)).data.canEdit === false, 'a field member sees the drawings and is not offered the set-up')
ok((await fieldC.post(base, drawing('Roof'))).status === 403, 'a field member cannot add a drawing')
ok((await fieldC.patch(`${base}/${plan.id}`, { rooms: [] })).status === 403, 'a field member cannot change a drawing')
ok((await fieldC.del(`${base}/${plan.id}`)).status === 403, 'a field member cannot delete a drawing')
ok((await fieldC.raw('GET', `${base}/${plan.id}/image`)).status === 200, 'a field member can look at the drawing')

// Another firm
ok((await b.get(base)).status === 404, 'another firm cannot list the drawings')
ok((await b.raw('GET', `${base}/${plan.id}/image`)).status === 404, 'another firm cannot fetch the drawing')
ok((await b.patch(`${base}/${plan.id}`, { level: 'Stolen' })).status === 404, 'another firm cannot change the drawing')
ok((await b.del(`${base}/${plan.id}`)).status === 404, 'another firm cannot delete the drawing')
ok((await b.raw('GET', `${base}/${plan.id}/codes`)).status === 404, 'another firm cannot print its room codes')
const bUp = new FormData(); bUp.append('file', new Blob([fs.readFileSync(path.join(FIX, 'sample.xer'))]), 'sample.xer')
const bSid = (await b.post('/api/schedules', bUp)).data.schedule.id
ok((await b.raw('GET', `/api/schedules/${bSid}/site-plans/${plan.id}/image`)).status === 404, 'another firm cannot reach the drawing through its own project')
ok((await a.get(base)).data.plans[0].level === 'Level 2', 'the drawing is untouched')

// A capture pinned on the drawing
const cap = fields => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.set(k, String(v)); fd.append('photo', new Blob([JPEG], { type: 'image/jpeg' }), 'p.jpg'); return fd }
const pinned = await a.post(caps, cap({ status: 'issue', note: 'Leak under the sink.', level: 'Level 2', room: 'Unit 201 kitchen', planId: plan.id, planX: 0.21, planY: 0.31 }))
ok(pinned.status === 200 && pinned.data.capture.pin?.planId === plan.id && pinned.data.capture.pin.x === 0.21, 'a capture keeps the pin on the drawing', pinned.data)
const stray = await a.post(caps, cap({ status: 'progress', note: 'Pinned on a drawing that is not ours.', level: 'Level 2', planId: '00000000-0000-4000-8000-000000000000', planX: 0.5, planY: 0.5 }))
ok(stray.status === 200 && stray.data.capture.pin === null, 'a pin on a drawing that is not in this project is dropped, and the capture is still saved')
const here = ground(0.8, 0.3)
ok((await a.post(caps, cap({ status: 'complete', note: 'Cabinets in.', level: 'Level 2', lat: here.lat, lng: here.lng, accuracyM: 5 }))).status === 200, 'a capture with a position is saved')

// Room codes
const codes = await a.raw('GET', `${base}/${plan.id}/codes`)
const pdf = Buffer.from(await codes.arrayBuffer())
ok(codes.status === 200 && codes.headers.get('content-type') === 'application/pdf' && pdf.subarray(0, 5).toString() === '%PDF-' && pdf.length > 2000, 'the room codes come as a PDF to print', codes.status)
ok(/attachment/.test(codes.headers.get('content-disposition') || ''), 'the PDF is downloaded, never opened inside RunF9')

// The aerial picture
const before = asked().length
const tile = await a.raw('GET', '/api/site/tiles/16/18000/26000')
ok(tile.status === 200 && tile.headers.get('content-type') === 'image/png' && Buffer.from(await tile.arrayBuffer()).equals(TILE), 'an aerial square is fetched by the server and passed on')
const sent = asked().slice(before)
ok(sent.length === 1 && sent[0].square === '16/18000/26000', 'the source is asked for that square and nothing else')
ok(sent[0].extra === 0 && sent[0].fixed === true, 'the source is told nothing about the member: only what any plain request carries, with a fixed sender name')
ok(/sandbox/.test(tile.headers.get('content-security-policy') || '') && tile.headers.get('x-content-type-options') === 'nosniff', 'the square is served as a file only')
ok((await a.raw('GET', '/api/site/tiles/5/3/7')).status === 502, 'a web page sent by the source in place of a picture is not passed on')
ok((await a.raw('GET', '/api/site/tiles/6/3/7')).status === 404, 'a square the source does not have is a plain 404')
ok((await a.raw('GET', '/api/site/tiles/3/99/1')).status === 404 && (await a.raw('GET', '/api/site/tiles/x/1/1')).status === 404, 'a square that does not exist is refused without asking the source')
ok((await new Client().raw('GET', '/api/site/tiles/16/18000/26000')).status === 401, 'the aerial picture needs a sign-in')

// Audit
const log = await a.get('/api/audit?limit=200')
const events = log.data.events ?? log.data.items ?? []
ok(['site.plan_added', 'site.plan_updated', 'site.room_codes_printed'].every(x => events.some(e => e.action === x && e.detail?.planId === plan.id)), 'adding, changing and printing are in the audit log', events.map(e => e.action).slice(0, 12))

/* ─── In a phone-sized browser ──────────────────────────────────────────────────────────────── */
const executablePath = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}) })
const at = ground(0.205, 0.31) // two steps from the mark of Unit 201 kitchen
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, geolocation: { latitude: at.lat, longitude: at.lng, accuracy: 6 }, permissions: ['geolocation'] })
const [name] = a.cookie.split('=')
await context.addCookies([{ name, value: a.cookie.slice(name.length + 1), url: BASE }])
const pg = await context.newPage()
const pageErrors = []
pg.on('pageerror', e => pageErrors.push(String(e)))
const axeSource = fs.readFileSync(path.join(process.cwd(), 'node_modules/axe-core/axe.min.js'), 'utf8')
const axe = async () => { await pg.addScriptTag({ content: axeSource }); return pg.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] })).violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)) }
const shot = async file => { if (process.env.SCREENSHOTS) { fs.mkdirSync(process.env.SCREENSHOTS, { recursive: true }); await pg.screenshot({ path: path.join(process.env.SCREENSHOTS, file), fullPage: true }) } }

await pg.goto(`${BASE}/dashboard/site?schedule=${sid}`, { waitUntil: 'networkidle' })
await pg.getByRole('heading', { name: /Site captures/ }).waitFor()
await pg.getByRole('button', { name: 'Map', exact: true }).click()
await pg.getByRole('img', { name: 'Drawing of Level 2' }).waitFor()
ok(await pg.locator('[data-mark=issue]').count() === 1 && await pg.locator('[data-mark=complete]').count() === 1, 'the map shows the pinned capture and the one placed by its position')
ok(await pg.locator('[data-mark=progress]').count() === 0, 'a capture with a level and no room, pin or position is not drawn')
const pinBox = await pg.locator('[data-mark=issue]').boundingBox(), sheetBox = await pg.locator('[data-plan-sheet]').boundingBox()
const fx = (pinBox.x + pinBox.width / 2 - sheetBox.x) / sheetBox.width, fy = (pinBox.y + pinBox.height / 2 - sheetBox.y) / sheetBox.height
ok(Math.abs(fx - 0.21) < 0.01 && Math.abs(fy - 0.31) < 0.02, 'the pin is drawn where it was put', { fx, fy })
const doneBox = await pg.locator('[data-mark=complete]').boundingBox()
ok(Math.abs((doneBox.x + doneBox.width / 2 - sheetBox.x) / sheetBox.width - 0.8) < 0.01, 'a position is drawn where it falls on the drawing')
await pg.locator('[data-mark=issue]').click()
await pg.getByText('Leak under the sink.').waitFor()
ok(true, 'tapping a mark shows the capture')

await pg.getByRole('button', { name: 'Where I am' }).click()
await pg.locator('[data-here]').waitFor()
const status = await pg.getByText(/Your position falls on this drawing/).textContent()
ok(/Nearest room on Level 2: Unit 201 kitchen/.test(status) && /cannot tell floors apart/.test(status), 'with the position on, the map says which room is nearest and that the level is the person\'s own choice', status)
ok((await typeProblems(pg)).length === 0, 'the map is on the type scale', await typeProblems(pg))
ok((await axe()).length === 0, 'the map has no serious accessibility issue', await axe())
await shot('site-map.png')

await pg.getByRole('button', { name: 'Aerial picture' }).click()
await pg.locator('[data-aerial-map] img[src*="/api/site/tiles/"]').first().waitFor()
await pg.locator('[data-plan-overlay]').waitFor()
const ov = await pg.locator('[data-plan-overlay]').boundingBox(), mapBox = await pg.locator('[data-aerial-map]').boundingBox()
ok(ov.width > 20 && Math.abs(ov.width / ov.height - 2) < 0.2 && Math.abs(ov.x + ov.width / 2 - (mapBox.x + mapBox.width / 2)) < 4, 'the drawing is laid over the aerial picture, in proportion and centred on the site', ov)
const reqs = []
pg.on('request', r => reqs.push(r.url()))
await pg.getByRole('button', { name: 'Zoom in' }).click()
await pg.waitForTimeout(600)
ok(reqs.every(u => u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')), 'the browser asks only RunF9 for the aerial picture', reqs.filter(u => !u.startsWith(BASE)).slice(0, 3))
ok((await axe()).length === 0, 'the aerial picture has no serious accessibility issue', await axe())
await shot('site-aerial.png')

// The capture screen suggests the room from the position, and asks for the level instead of guessing it.
await a.post(base, drawing('Level 3'))
const l3 = (await a.get(base)).data.plans.find(p => p.level === 'Level 3')
await a.patch(`${base}/${l3.id}`, { rooms: [{ name: 'Unit 301 kitchen', x: 0.2, y: 0.3 }, { name: 'Unit 302 kitchen', x: 0.8, y: 0.3 }], controls: [control(0.05, 0.1), control(0.95, 0.9)] })
await pg.evaluate(() => { try { localStorage.clear() } catch { /* nothing kept */ } })
await pg.goto(`${BASE}/dashboard/site?schedule=${sid}&new=1`, { waitUntil: 'networkidle' })
const sheet = pg.getByRole('dialog', { name: 'New capture' })
await sheet.waitFor()
await sheet.getByLabel(/Add my position/).check()
await sheet.getByRole('group', { name: 'Which level are you on?' }).waitFor()
ok(await sheet.getByLabel('Room or area').inputValue() === '' && await sheet.getByLabel('Level', { exact: true }).inputValue() === '', 'with the same rooms on two levels, the capture screen asks which level and fills in nothing')
await sheet.getByRole('group', { name: 'Which level are you on?' }).getByRole('button', { name: 'Level 3' }).click()
await sheet.getByText(/Room suggested from your position/).waitFor()
ok(await sheet.getByLabel('Room or area').inputValue() === 'Unit 301 kitchen', 'once the level is chosen, the room is filled in from the position')
await sheet.getByRole('button', { name: 'Pin it on the drawing' }).click()
await sheet.getByRole('img', { name: 'Drawing of Level 3' }).waitFor()
ok(await sheet.locator('[data-here]').count() === 1, 'the capture screen shows where the phone is on the drawing')
// A tap on the drawing (the locator scrolls it into view first; a bare mouse click below the fold would miss).
const tapSheet = async (scope, fx, fy) => { const el = scope.locator('[data-plan-sheet]'); const box = await el.boundingBox(); await el.click({ position: { x: box.width * fx, y: box.height * fy } }) }
await tapSheet(sheet, 0.79, 0.31)
await sheet.getByRole('button', { name: 'Pinned on the drawing' }).waitFor()
ok(await sheet.getByLabel('Room or area').inputValue() === 'Unit 302 kitchen', 'pinning the drawing next to a room\'s mark sets that room (the person\'s tap wins over the position)')
ok((await typeProblems(pg)).length === 0, 'the capture screen with a drawing is on the type scale', await typeProblems(pg))
ok((await axe()).length === 0, 'the capture screen with a drawing has no serious accessibility issue', await axe())
await shot('capture-with-drawing.png')
await sheet.getByRole('button', { name: 'Not started', exact: true }).click()
await sheet.getByRole('textbox', { name: 'Note' }).fill('Counter not delivered yet.')
await sheet.getByRole('button', { name: 'Save capture' }).click()
await pg.getByText('Capture saved.').waitFor()
const saved = (await a.get(caps)).data.captures.find(c => c.note === 'Counter not delivered yet.')
ok(saved && saved.level === 'Level 3' && saved.room === 'Unit 302 kitchen' && saved.pin?.planId === l3.id && Math.abs(saved.pin.x - 0.79) < 0.02 && saved.position, 'the capture is stored with its level, room, pin and position', saved)

// A room code in the frame of the photo sets the place: the picture itself says where it was taken.
const codePhoto = text => QRCode.toBuffer(text, { width: 420, margin: 6 })
await pg.evaluate(() => { try { localStorage.clear() } catch { /* nothing kept */ } })
await pg.goto(`${BASE}/dashboard/site?schedule=${sid}&new=1`, { waitUntil: 'networkidle' })
await sheet.waitFor()
await sheet.locator('input[type=file]').setInputFiles({ name: 'IMG_0002.png', mimeType: 'image/png', buffer: await codePhoto(`https://elsewhere.example/dashboard/site?schedule=not-ours&level=${encodeURIComponent('Level 9')}&room=${encodeURIComponent('Vault')}&new=1`) })
await sheet.getByRole('img', { name: 'Photo 1' }).waitFor()
await pg.waitForTimeout(400)
ok(await sheet.getByLabel('Room or area').inputValue() === '' && await sheet.getByText('Place read from the room code in your photo.').count() === 0, 'a code from another project in the photo is ignored')
await sheet.locator('input[type=file]').setInputFiles({ name: 'IMG_0003.png', mimeType: 'image/png', buffer: await codePhoto(`${BASE}/dashboard/site?schedule=an-older-upload&level=${encodeURIComponent('Level 3')}&room=${encodeURIComponent('Unit 301 kitchen')}&new=1`) })
await sheet.getByText('Place read from the room code in your photo.').waitFor()
ok(await sheet.getByLabel('Level', { exact: true }).inputValue() === 'Level 3' && await sheet.getByLabel('Room or area').inputValue() === 'Unit 301 kitchen', 'a room code in the photo fills in the level and the room, even one printed before a schedule update')
// Taking the coded photo out puts the place back; a place the person typed is never overwritten by a code.
await sheet.getByRole('button', { name: 'Remove photo 2' }).click()
await sheet.getByText('Place read from the room code in your photo.').waitFor({ state: 'detached' })
ok(await sheet.getByLabel('Room or area').inputValue() === '' && await sheet.getByLabel('Level', { exact: true }).inputValue() === '', 'removing the photo that carried the code puts the place back as it was')
await sheet.getByLabel('Room or area').fill('Typed by hand')
await sheet.locator('input[type=file]').setInputFiles({ name: 'IMG_0004.png', mimeType: 'image/png', buffer: await codePhoto(`${BASE}/dashboard/site?schedule=an-older-upload&level=${encodeURIComponent('Level 3')}&room=${encodeURIComponent('Unit 301 kitchen')}&new=1`) })
await sheet.getByRole('img', { name: 'Photo 2' }).waitFor()
await pg.waitForTimeout(500)
ok(await sheet.getByLabel('Room or area').inputValue() === 'Typed by hand', 'a place the person typed is not overwritten by a code in a later photo')
await sheet.getByRole('button', { name: 'Remove photo 2' }).click()
await sheet.getByLabel('Room or area').fill('')
await sheet.getByRole('button', { name: 'Close' }).click()
await pg.goto(`${BASE}/dashboard/site?schedule=${sid}&new=1`, { waitUntil: 'networkidle' })
await sheet.waitFor()
await sheet.locator('input[type=file]').setInputFiles({ name: 'IMG_0005.png', mimeType: 'image/png', buffer: await codePhoto(`${BASE}/dashboard/site?schedule=an-older-upload&level=${encodeURIComponent('level 3')}&room=${encodeURIComponent('UNIT 301 KITCHEN')}&new=1`) })
await sheet.getByText('Place read from the room code in your photo.').waitFor()
ok(await sheet.getByLabel('Room or area').inputValue() === 'Unit 301 kitchen', 'the place is filled in the drawing\'s own spelling')
await sheet.getByRole('button', { name: 'Done', exact: true }).click()
await sheet.getByRole('button', { name: 'Save capture' }).click()
await pg.getByText('Capture saved.').waitFor()
const coded = (await a.get(caps)).data.captures[0]
ok(coded.placeSource === 'code' && coded.level === 'Level 3' && coded.room === 'Unit 301 kitchen' && coded.media.length === 1, 'the capture records that its place came from a room code', coded)

// Setting up: mark a room by tapping the drawing.
await pg.getByRole('button', { name: 'Map', exact: true }).click()
await pg.getByRole('button', { name: 'Drawings', exact: true }).click()
const setup = pg.getByRole('dialog', { name: 'Drawings' })
await setup.waitFor()
await setup.getByRole('img', { name: /Drawing of Level/ }).waitFor()
await tapSheet(setup, 0.5, 0.2)
await setup.getByLabel('Room name').fill('Stair 1')
await setup.getByRole('button', { name: 'Add room' }).click()
await setup.getByRole('list', { name: 'Rooms on this drawing' }).getByText('Stair 1').waitFor()
const withStair = (await a.get(base)).data.plans.find(p => p.rooms.some(r => r.name === 'Stair 1'))
ok(withStair && Math.abs(withStair.rooms.find(r => r.name === 'Stair 1').x - 0.5) < 0.02, 'a room is marked by tapping the drawing and naming it')
ok((await typeProblems(pg)).length === 0, 'the set-up screen is on the type scale', await typeProblems(pg))
ok((await axe()).length === 0, 'the set-up screen has no serious accessibility issue', await axe())
await shot('site-setup.png')
await setup.getByRole('button', { name: 'Place on the ground' }).click()
await setup.locator('[data-aerial-map]').waitFor()
ok(await setup.locator('[data-mark=control]').count() >= 2, 'the matched points are shown on the drawing and on the aerial picture')
await setup.getByRole('button', { name: 'Room codes' }).click()
ok(/\/site-plans\/.+\/codes$/.test(await setup.getByRole('link', { name: /Download the room codes/ }).getAttribute('href')), 'the room codes are one tap away')
ok(pageErrors.length === 0, 'no script error on any of these screens', pageErrors)
await browser.close()

// Deleting a drawing: the capture keeps its place and loses the pin.
ok((await a.del(`${base}/${plan.id}`)).status === 200, 'a drawing is deleted')
const after = (await a.get(caps)).data.captures.find(c => c.note === 'Leak under the sink.')
ok(after && after.pin === null && after.level === 'Level 2' && after.room === 'Unit 201 kitchen', 'a capture pinned on it keeps its level and room and loses the pin', after)
ok((await a.raw('GET', `${base}/${plan.id}/image`)).status === 404, 'the deleted drawing is gone')
ok(((await a.get('/api/audit?limit=200')).data.events ?? []).some(e => e.action === 'site.plan_deleted' && e.detail?.planId === plan.id), 'the deletion is audited')

tiles.kill()
console.log(`\n${passed} site map checks passed`)
