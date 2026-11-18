#!/usr/bin/env node
// End-to-end checks, over HTTP against a running server, for the program master schedule:
//   1. A program groups projects; each standard milestone is pointed at an activity of the contractor's schedule,
//      and the master shows that activity's date exactly as the newest upload holds it.
//   2. A new contractor upload moves the master with nobody touching the program; the previous date, the baseline
//      and the days moved are reported; an activity that left the schedule is flagged, not silently kept.
//   3. The owner's forecast sits beside the contractor's date and never replaces it; a contractor date cannot be typed.
//   4. Other parties' items, the sector roll-up, the look-ahead and the CSV printouts.
//   5. Another firm can neither read nor change any of it; it needs a sign-in.
//   BASE_URL=http://localhost:3000 node scripts/e2e-programs.mjs
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
    const text = await res.text()
    let data = {}
    try { data = JSON.parse(text) } catch { /* a CSV download */ }
    return { status: res.status, data, text, headers: res.headers }
  }
  get(u) { return this.req('GET', u) }
  post(u, b) { return this.req('POST', u, b ?? {}) }
  patch(u, b) { return this.req('PATCH', u, b) }
  put(u, b) { return this.req('PUT', u, b) }
  del(u) { return this.req('DELETE', u) }
}

const HEAD = ['Activity ID', 'Activity Name', 'Duration', 'Start', 'Finish', 'Predecessors']
const us = iso => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`
/** Working days of interiors that end on each substantial completion date used below (a five-day week from 07/05/2027). */
const INTERIORS = { '2027-10-22': 80, '2027-11-05': 90, '2027-11-19': 100, '2027-12-17': 120 }
/** A small building schedule; `finish` is the substantial completion date, `drop` leaves the enclosure milestone out. */
const school = ({ finish, drop = false }) => [
  ['M100', 'Notice to Proceed', '0', '01/04/2027', '01/04/2027', ''],
  ['A200', 'Foundations', '40', '01/04/2027', '02/26/2027', 'M100'],
  ['A300', 'Structure and envelope', '90', '03/01/2027', '07/02/2027', 'A200'],
  ...(drop ? [] : [['M400', 'Building Enclosed', '0', '07/02/2027', '07/02/2027', 'A300']]),
  ['A500', 'Interiors', String(INTERIORS[finish]), '07/05/2027', us(finish), drop ? 'A300' : 'M400'],
  ['M900', 'Substantial Completion', '0', us(finish), us(finish), 'A500'],
]
const csv = rows => Buffer.from([HEAD, ...rows].map(r => r.join(',')).join('\n'))
const upload = (c, name, bytes, extra = {}) => { const fd = new FormData(); fd.append('file', new Blob([bytes]), name); for (const [k, v] of Object.entries(extra)) fd.set(k, v); return c.post('/api/schedules', fd) }

const a = new Client(), b = new Client()
const stamp = Date.now(), PW = 'correct horse battery staple'
ok((await a.post('/api/auth', { action: 'signup', email: `prog-a-${stamp}@example.com`, password: PW, name: 'Pat Program', company: 'Program Office A' })).status === 200, 'firm A signs up')
ok((await b.post('/api/auth', { action: 'signup', email: `prog-b-${stamp}@example.com`, password: PW, name: 'Bo Other', company: 'Program Office B' })).status === 200, 'firm B signs up')

/* ─── Two contractors' schedules ─── */
const sA0 = await upload(a, 'North School.csv', csv(school({ finish: '2027-10-22' })))
const sA1 = await upload(a, 'North School.csv', csv(school({ finish: '2027-11-05' })), { version: 'Update 1' })
const sB0 = await upload(a, 'East Clinic.csv', csv(school({ finish: '2027-12-17' })))
ok(sA0.status === 200 && sA1.status === 200 && sB0.status === 200, 'two projects are uploaded, one with an update', [sA0.data.error, sA1.data.error, sB0.data.error])
const [a0, a1, b0] = [sA0, sA1, sB0].map(x => x.data.schedule.id)

/* ─── A program ─── */
ok((await a.get('/api/programs')).data.programs?.length === 0, 'there is no program to begin with')
ok((await a.post('/api/programs', { name: ' ' })).status === 400, 'a program needs a name')
const made = await a.post('/api/programs', { name: 'Island Rebuild' })
ok(made.status === 200 && made.data.program?.dictionary?.length >= 5, 'a program is created with a standard milestone list to edit', made.data)
const pid = made.data.program.id, url = `/api/programs/${pid}`
const setDict = await a.patch(url, { milestones: [{ name: 'Notice to proceed', phase: 'Construction' }, { name: 'Building enclosed', phase: 'Construction' }, { name: 'Substantial completion', phase: 'Construction' }, { name: 'Occupancy', phase: 'Closeout' }] })
ok(setDict.status === 200 && setDict.data.program.dictionary.length === 4 && setDict.data.program.dictionary.every(m => m.key), 'the program sets its own standard milestones; each gets a stable key', setDict.data)
const [kNtp, kEnc, kSc, kOcc] = setDict.data.program.dictionary.map(m => m.key)
ok((await a.patch(url, { milestones: [{ name: 'Same', phase: 'X' }, { name: 'same', phase: 'X' }] })).status === 400, 'a milestone name cannot be listed twice')

const empty = await a.get(url)
ok(empty.status === 200 && empty.data.master.rows.length === 0 && empty.data.available.length === 2 && empty.data.canEdit === true, 'the empty program offers the two projects (not three uploads)', empty.data.available)
const addA = await a.post(`${url}/projects`, { scheduleId: a0, sector: 'Education', contractor: 'North Builders' })
const addB = await a.post(`${url}/projects`, { scheduleId: b0, sector: 'Public health', contractor: 'East Contracting', location: 'St. Croix' })
ok(addA.status === 200 && addB.status === 200, 'both projects are added, each with its sector and contractor', [addA.data, addB.data])
ok((await a.post(`${url}/projects`, { scheduleId: a1, sector: 'Education' })).status === 409, 'a project is in a program once, whichever of its uploads is named')
ok((await a.post(`${url}/projects`, { scheduleId: 'nope' })).status === 400, 'an unknown schedule is refused')
const projA = addA.data.project.id, projB = addB.data.project.id

/* ─── Mapping: a milestone reads an activity; the date is never typed ─── */
const sug = await a.get(`${url}/projects/${projA}`)
ok(sug.status === 200 && sug.data.suggestions[kSc]?.code === 'M900' && sug.data.suggestions[kNtp]?.code === 'M100' && sug.data.suggestions[kEnc]?.code === 'M400' && !sug.data.suggestions[kOcc], 'milestone activities with matching names are suggested, and nothing is invented for Occupancy', sug.data.suggestions)
ok((await a.get(url)).data.master.rows.every(r => r.mappedCount === 0), 'a suggestion maps nothing until it is accepted')
const pick = await a.get(`${url}/projects/${projA}/activities?q=substantial`)
ok(pick.status === 200 && pick.data.activities.length === 1 && pick.data.activities[0].code === 'M900' && pick.data.upload.version === 'Update 1', 'the activity picker searches the newest upload', pick.data)
const mapAll = p => a.patch(`${url}/projects/${p}`, { mapping: { [kNtp]: { code: 'M100', use: 'start' }, [kEnc]: { code: 'M400', use: 'finish' }, [kSc]: { code: 'M900', use: 'finish' } } })
ok((await mapAll(projA)).status === 200 && (await mapAll(projB)).status === 200, 'the three milestones are mapped in both projects')
ok((await a.patch(`${url}/projects/${projA}`, { mapping: { unknown_key: { code: 'M900' } } })).status === 400, 'a milestone that is not in the program cannot be mapped')

const cellOf = (m, projectId, key) => { const r = m.rows.find(x => x.id === projectId); return r.cells[m.dictionary.findIndex(d => d.key === key)] }
let view = (await a.get(url)).data
ok(cellOf(view.master, projA, kSc).date === '2027-11-05' && cellOf(view.master, projB, kSc).date === '2027-12-17', "each master date equals the contractor's date in the newest upload", [cellOf(view.master, projA, kSc), cellOf(view.master, projB, kSc)])
ok(cellOf(view.master, projA, kSc).previous === '2027-10-22' && cellOf(view.master, projA, kSc).movedDays === 14, 'the previous upload and the 14 days moved since are shown')
ok(cellOf(view.master, projA, kNtp).date === '2027-01-04' && cellOf(view.master, projA, kOcc).mapped === null, 'a milestone with no mapping is left empty')
const typed = await a.patch(`${url}/projects/${projA}`, { mapping: { [kSc]: { code: 'M900', use: 'finish', date: '2026-01-01' } } })
ok(typed.status === 200 && cellOf((await a.get(url)).data.master, projA, kSc).date === '2027-11-05', 'a date sent with a mapping is ignored: a contractor date cannot be typed')
const rowA = view.master.rows.find(r => r.id === projA)
ok(rowA.status === 'current' && rowA.latest.version === 'Update 1' && rowA.sector === 'Education', 'the row names its source upload and says its data is current', rowA.latest)

/* ─── A new contractor upload moves the master with nobody touching the program ─── */
const sA2 = await upload(a, 'North School.csv', csv(school({ finish: '2027-11-19', drop: true })), { version: 'Update 2' })
ok(sA2.status === 200, 'the contractor sends Update 2: two weeks later, and the enclosure milestone is gone')
view = (await a.get(url)).data
ok(cellOf(view.master, projA, kSc).date === '2027-11-19' && cellOf(view.master, projA, kSc).previous === '2027-11-05', 'the master reads the new date and keeps the last one as "previous"')
ok(cellOf(view.master, projA, kEnc).missing === true && cellOf(view.master, projA, kEnc).date === null && view.master.rows.find(r => r.id === projA).missingCount === 1, 'an activity that left the schedule is flagged, and its old date is not kept')

/* ─── A stored baseline gives the variance ─── */
ok((await a.put(`/api/schedules/${sA2.data.schedule.id}/roles`, { baselineScheduleId: a0 })).status === 200, 'the first upload is stored as the project baseline')
view = (await a.get(url)).data
ok(cellOf(view.master, projA, kSc).baseline === '2027-10-22' && cellOf(view.master, projA, kSc).varianceDays === 28, 'the master measures against the stored baseline: 28 calendar days later', cellOf(view.master, projA, kSc))
const rA = view.master.rows.find(r => r.id === projA)
ok(rA.finish === '2027-11-19' && rA.finishVarianceDays === 28 && rA.baseline?.id === a0, 'the project finish and its variance come from the last dated milestone')

/* ─── The owner's forecast sits beside the contractor's date ─── */
ok((await a.patch(`${url}/projects/${projA}`, { ownerForecasts: { [kSc]: { date: '2027-13-40' } } })).status === 400, 'an owner forecast needs a real date')
ok((await a.patch(`${url}/projects/${projA}`, { ownerForecasts: { [kSc]: { date: '2027-12-10', note: 'progress meeting' }, [kOcc]: { date: '2028-01-15' } } })).status === 200, 'the owner records its own forecast for two milestones')
view = (await a.get(url)).data
const scA = cellOf(view.master, projA, kSc)
ok(scA.date === '2027-11-19' && scA.ownerForecast?.date === '2027-12-10' && scA.ownerGapDays === 21, "the contractor's date is unchanged; the owner's is 21 days later, beside it", scA)
ok(cellOf(view.master, projA, kOcc).date === null && cellOf(view.master, projA, kOcc).ownerForecast?.date === '2028-01-15', 'an owner forecast can stand where the contractor has no activity')
ok((await a.patch(`${url}/projects/${projA}`, { ownerForecasts: { [kOcc]: null } })).status === 200 && cellOf((await a.get(url)).data.master, projA, kOcc).ownerForecast === null, 'and it can be removed')

/* ─── Other parties ─── */
ok((await a.post(`${url}/items`, { title: 'Permanent power' })).status === 400, 'an item needs to say who owes it')
const item = await a.post(`${url}/items`, { party: 'Utility', title: 'Permanent power energized', projectId: projA, milestoneKey: kSc, needDate: '2027-09-01', forecastDate: '2027-09-20' })
const fund = await a.post(`${url}/items`, { party: 'Funding agency', title: 'Funds obligated for the clinic', needDate: '2026-06-01', actualDate: '2026-05-20' })
ok(item.status === 200 && fund.status === 200, 'a utility item under one project and a funding item for the whole program are added', [item.data, fund.data])
ok((await a.post(`${url}/items`, { party: 'Utility', title: 'Wrong project', projectId: 'nope' })).status === 400, 'an item cannot be filed under a project that is not in the program')
view = (await a.get(url)).data
const power = view.master.parties.find(p => p.id === item.data.item.id)
ok(power.status === 'late' && power.lateDays === 19 && power.neededFor?.name === 'Substantial completion' && power.neededFor.date === '2027-11-19' && power.project === 'North School', 'the utility item is 19 days late and names the contractor milestone it is needed for', power)
ok(view.master.parties.find(p => p.id === fund.data.item.id).status === 'done' && view.master.parties[view.master.parties.length - 1].id === fund.data.item.id, 'a delivered item is done and listed last')
ok((await a.patch(`${url}/items?itemId=${item.data.item.id}`, { forecastDate: '2027-08-25' })).status === 200 && (await a.get(url)).data.master.parties.find(p => p.id === item.data.item.id).status === 'open', 'moving its forecast inside the need date clears the late flag')

/* ─── Sectors and printouts ─── */
ok(view.master.sectors.map(s => s.sector).join('|') === 'Education|Public health' && view.master.sectors[0].late === 1 && view.master.sectors[1].late === 0, 'the sector roll-up counts one late project in Education')
ok(view.master.totals.projects === 2 && view.master.totals.byStatus.current === 2 && view.master.totals.finish === '2027-12-17', 'the program totals count both projects as current')
const far = await a.get(`${url}?asOf=2028-06-01`)
ok(far.status === 200 && far.data.master.rows.every(r => r.status === 'expired'), 'read six months later with no new update, every project is expired')
ok((await a.get(`${url}?asOf=tomorrow`)).status === 400, 'asOf must be a date')
const file = await a.get(`${url}/export?report=milestones`)
ok(file.status === 200 && /text\/csv/.test(file.headers.get('content-type')) && /island-rebuild-milestones-/.test(file.headers.get('content-disposition')), 'the milestone printout downloads as a CSV file')
ok(/Island Rebuild: Milestones\. Read \d\d\/\d\d\/\d{4}\. Contractor data current for 2 of 2 projects\./.test(file.text.split('\r\n')[0]), 'its first line says what was read, when, and how current the data was', file.text.split('\r\n')[0])
ok(file.text.includes('11/19/2027') && file.text.includes('M900 Substantial Completion') && file.text.includes('+28') && file.text.includes('12/10/2027'), 'it carries the contractor date, the activity it was read from, the variance and the owner forecast')
for (const r of ['phases', 'sectors', 'lookahead', 'parties', 'updates']) ok((await a.get(`${url}/export?report=${r}`)).status === 200, `the ${r} printout downloads`)
ok((await a.get(`${url}/export?report=everything`)).status === 400, 'an unknown printout is refused')

/* ─── Another firm, and no sign-in ─── */
ok((await b.get('/api/programs')).data.programs.length === 0, "firm B does not see firm A's program")
for (const [what, res] of [
  ['read the master', await b.get(url)], ['rename it', await b.patch(url, { name: 'Mine' })], ['add a project', await b.post(`${url}/projects`, { scheduleId: a0 })],
  ['change a mapping', await b.patch(`${url}/projects/${projA}`, { mapping: { [kSc]: null } })], ['search its activities', await b.get(`${url}/projects/${projA}/activities`)],
  ['add an item', await b.post(`${url}/items`, { party: 'X', title: 'Intrusion' })], ['download a printout', await b.get(`${url}/export`)], ['delete it', await b.del(url)],
]) ok(res.status === 404, `firm B cannot ${what}`, res.status)
const bOwn = await b.post('/api/programs', { name: 'B program' })
ok(bOwn.status === 200 && (await b.post(`/api/programs/${bOwn.data.program.id}/projects`, { scheduleId: a0 })).status === 400, "firm B cannot add firm A's project to its own program")
ok((await new Client().get(url)).status === 401 && (await new Client().post('/api/programs', { name: 'x' })).status === 401, 'it needs a sign-in')

/* ─── Taking things out ─── */
ok((await a.del(`${url}/projects/${projA}`)).status === 200, 'North School is taken out of the program')
view = (await a.get(url)).data
ok(view.master.rows.length === 1 && view.master.parties.every(p => p.id !== item.data.item.id) && view.available.some(x => x.name === 'North School'), 'its items go with it, and the project can be added again')
ok((await a.get(`/api/schedules/${a0}/roles`)).status === 200, 'its schedules are untouched')
const audit = await a.get('/api/audit?limit=200')
const actions = new Set((audit.data.events ?? []).map(e => e.action))
ok(['program.created', 'program.updated', 'program.project_added', 'program.project_updated', 'program.item_created', 'program.exported', 'program.project_removed'].every(x => actions.has(x)), 'every change and download is in the audit log', [...actions].filter(x => x.startsWith('program')))
ok((await a.del(url)).status === 200 && (await a.get(url)).status === 404 && (await a.get('/api/programs')).data.programs.length === 0, 'the program is deleted')
ok((await a.get(`/api/schedules/${b0}/roles`)).status === 200, 'and the other project is still there')

console.log(`\n${passed} checks passed.`)
