#!/usr/bin/env node
// End-to-end smoke test against a running RunF9 server.
//   BASE_URL=http://localhost:3200 node scripts/e2e-smoke.mjs
// Exercises: two competing firms (tenant isolation), multi-format upload, data questions,
// firm history + backtest, the interview → generate → override → review → export → publish flow,
// and Phase Two analysis on the published schedule. Exits non-zero on the first failure.

import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.BASE_URL || 'http://localhost:3000'
// This suite creates its own organizations, so the server must allow self sign-up (RUNF9_SIGNUP=open,
// as in ci.yml). The private beta default (invite-only) is covered by scripts/e2e-beta.mjs.
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

class Client {
  constructor(name) { this.name = name; this.cookie = '' }
  async req(method, url, body, raw = false) {
    const headers = { cookie: this.cookie }
    let payload = body
    if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }
    const res = await fetch(BASE + url, { method, headers, body: payload })
    const set = res.headers.get('set-cookie')
    if (set) this.cookie = set.split(';')[0]
    if (raw) return { status: res.status, text: await res.text(), headers: res.headers }
    const data = await res.json().catch(() => ({}))
    return { status: res.status, data }
  }
  get(u) { return this.req('GET', u) }
  post(u, b) { return this.req('POST', u, b ?? {}) }
  patch(u, b) { return this.req('PATCH', u, b) }
}

/** A completed past project exported to CSV with inconsistent, real-world headers. */
function pastProjectCsv(seed, overrun) {
  const acts = [
    ['1000', 'NTP', 0], ['1010', 'Mass ex & grading', 25], ['1020', 'Site utilities', 20], ['1030', 'F/R/P footings', 22],
    ['1040', 'SOG pour', 12], ['1050', 'Erect Stl L1-L2', 30], ['1060', 'Erect Stl L3-L4', 28], ['1070', 'Roof membrane', 15],
    ['1080', 'Curtainwall install', 35], ['1090', 'OH MEP rough L1-2', 40], ['1100', 'OH MEP rough L3-4', 38], ['1110', 'Hang/Tape/Finish GWB', 45],
    ['1120', 'Paint & flooring', 40], ['1130', 'Elevator install', 45], ['1140', 'Cx & TAB', 30], ['1150', 'Punch list', 15], ['1160', 'Sub Comp', 0],
  ]
  const day = (d) => { const x = new Date(Date.UTC(2022, 2, 7)); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10) }
  const rows = ['Act ID,Activity Name,OD,BL Start,BL Finish,Actual Start,Actual Finish,Preds,Calendar']
  let t = seed
  let prev = ''
  for (const [id, name, dur] of acts) {
    const planned = Math.round(dur * 7 / 5)
    const actual = Math.round(planned * overrun)
    // The firm overlaps drywall with the last MEP rough-in (SS +10d): a sequencing habit RunF9 should learn.
    const pred = id === '1110' ? `"${prev} SS 10d"` : prev
    rows.push([`A${id}`, `"${name}"`, dur, day(t), day(t + planned), day(t), day(t + actual), pred, '"Standard 5 Day"'].join(','))
    prev = `A${id}`
    t += Math.round(actual * 0.6)
  }
  return rows.join('\n')
}

const upload = async (c, name, content, fields = {}) => {
  const fd = new FormData()
  fd.append('file', new Blob([content]), name)
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return c.req('POST', '/api/schedules', fd)
}

async function main() {
  const stamp = Date.now()
  const A = new Client('Firm A'), B = new Client('Firm B')

  /* ── Accounts: two competing firms ── */
  let r = await A.post('/api/auth', { action: 'signup', email: `a${stamp}@example.com`, password: 'correct horse battery staple', name: 'Ana Scheduler', company: 'Alpha Builders' })
  ok(r.status === 200, 'Firm A signs up')
  r = await B.post('/api/auth', { action: 'signup', email: `b${stamp}@example.com`, password: 'correct horse battery staple', name: 'Bo Rival', company: 'Beta Construction' })
  ok(r.status === 200, 'Firm B signs up')

  r = await A.get('/api/system')
  ok(r.status === 200, `AI status: ${r.data.llm.mode}${r.data.llm.airgapped ? ' (air-gapped)' : ''}${r.data.llm.host ? ' @ ' + r.data.llm.host : ''}`)

  /* ── Upload in every structured format ── */
  r = await upload(A, 'sample.xer', fs.readFileSync(path.join(FIX, 'sample.xer')), { projectType: 'commercial_office', region: 'CA', grossSqft: '80000' })
  ok(r.status === 200 && r.data.summary.relationshipsImported > 0 && r.data.summary.calendarsImported > 0, `P6 XER imported (${r.data.summary?.activitiesImported} acts, ${r.data.summary?.relationshipsImported} links, ${r.data.summary?.calendarsImported} calendars)`, r.data)
  const xerId = r.data.schedule.id
  r = await upload(A, 'sample-msp.xml', fs.readFileSync(path.join(FIX, 'sample-msp.xml')))
  ok(r.status === 200 && r.data.summary.activitiesImported > 0, `MS Project XML imported (${r.data.summary?.activitiesImported} acts)`, r.data)
  r = await upload(A, 'messy-export.csv', fs.readFileSync(path.join(FIX, 'messy-export.csv')))
  ok(r.status === 200 && r.data.summary.activitiesImported > 0, `Messy CSV export imported (${r.data.summary?.activitiesImported} acts, ${r.data.summary?.warnings.length} warnings)`, r.data)
  r = await upload(A, 'plan.mpp', 'binary')
  ok(r.status === 400 && /XML/.test(r.data.error), `Native .mpp rejected with guidance: "${r.data.error}"`)

  /* ── The tool questions its own inputs ── */
  r = await A.get(`/api/schedules/${xerId}/quality`)
  ok(r.status === 200 && r.data.dcma.checks.length === 14, `Quality: DCMA ${r.data.dcma.passed}/${r.data.dcma.applicable}, ${r.data.dataQuestions.length} data questions`)
  const dq = r.data.dataQuestions[0]
  if (dq) {
    console.log(`    e.g. "${dq.question}"`)
    r = await A.post(`/api/schedules/${xerId}/quality`, { questionId: dq.id, response: 'intentional', note: 'Owner approved' })
    ok(r.status === 200, 'Scheduler answers a data question')
    r = await A.get(`/api/schedules/${xerId}/quality`)
    ok(r.data.dataQuestions.find(q => q.id === dq.id).response?.response === 'intentional', 'Answer persisted')
  }

  /* ── Firm history: three completed hospitals ── */
  for (const [i, overrun] of [[0, 1.15], [3, 1.3], [6, 1.22]]) {
    r = await upload(A, `past-hospital-${i}.csv`, pastProjectCsv(i, overrun), { projectType: 'healthcare', region: 'CA', grossSqft: String(90000 + i * 10000) })
    ok(r.status === 200, `Past project ${i} uploaded (${r.data.summary?.classifiedPct}% of activities understood)`, r.data)
  }
  r = await A.get('/api/history')
  ok(r.status === 200 && r.data.categories.length >= 5, `Firm history: ${r.data.categories.length} work categories, overrun ×${r.data.overallOverrunMedian?.toFixed(2)}`, r.data)
  ok(r.data.backtest.projects.length === 3, `Backtest (leave-one-out) over 3 projects: MAPE ${r.data.backtest.mape}%, bias ${r.data.backtest.biasPct}%`, r.data.backtest)
  {
    const seq = r.data.sequencing
    const habit = seq?.patterns.find(p => p.from === 'mepRough' && p.to === 'drywall')
    ok(seq?.projectCount === 3 && habit?.type === 'SS' && habit.lag === 10 && habit.projects === 3, `Firm sequencing learned from 3 projects (${seq?.patterns.length} ties): MEP rough-in → drywall SS +10d in ${habit?.projects} of ${habit?.of}`, seq)
    // A new schedule with drywall left without a predecessor: the suggestion follows the firm's habit.
    const fresh = ['Act ID,Activity Name,OD,Start,Finish,Preds', 'B100,NTP,0,2027-01-04,2027-01-04,', 'B110,OH MEP rough L5,20,2027-01-05,2027-02-01,B100',
      'B120,Hang/Tape/Finish GWB L5,25,2027-02-02,2027-03-08,', 'B130,Sub Comp,0,2027-03-09,2027-03-09,B120'].join('\n')
    r = await upload(A, 'new-tower.csv', fresh)
    ok(r.status === 200, 'New schedule uploaded for logic suggestions', r.data)
    r = await A.get(`/api/schedules/${r.data.schedule.id}/logic-suggestions`)
    const sg = r.data.suggestions?.find(x => x.predecessor.code === 'B110' && x.successor.code === 'B120')
    ok(r.status === 200 && r.data.firm.projects === 3 && sg?.type === 'SS' && sg.lag === 10 && sg.firm?.projects === 3 && /Your firm tied/.test(sg.reason), `Logic suggestion follows the firm's own pattern: B110 → B120 ${sg?.type} +${sg?.lag}d ("${sg?.reason}")`, r.data)
  }

  /* ── Tenant isolation ── */
  r = await B.get(`/api/schedules?id=${xerId}`)
  ok(r.status === 404, "Firm B cannot read Firm A's schedule (404)")
  r = await B.get(`/api/schedules/${xerId}/quality`)
  ok(r.status === 404, "Firm B cannot run quality checks on Firm A's schedule")
  r = await B.post('/api/ask', { question: 'What is the critical path?', scheduleId: xerId })
  ok(r.status === 404, "Firm B cannot ask AI about Firm A's schedule")
  r = await B.get('/api/history')
  ok(r.data.schedules.length === 0 && r.data.categories.length === 0, "Firm B's history is empty — nothing learned from Firm A")
  r = await B.get('/api/schedules')
  ok(r.data.schedules.length === 0, "Firm B's schedule list is empty")

  /* ── Build: interview ── */
  r = await A.post('/api/plans', { name: 'Riverside Medical Office Building' })
  ok(r.status === 200, 'Plan created')
  const planId = r.data.plan.id
  r = await A.get(`/api/plans/${planId}`)
  ok(r.data.elicitation.questions[0].id === 'project.type' && r.data.elicitation.readiness === 0, `Interview opens with "${r.data.elicitation.questions[0].prompt}"`)

  r = await A.patch(`/api/plans/${planId}`, { answers: {
    'project.type': { value: 'healthcare' }, 'project.state': { value: 'CA' }, 'project.city': { value: 'Sacramento' },
    'project.scope': { value: 'new_construction' }, 'project.gross_sqft': { value: '110000' }, 'project.stories': { value: '4' },
    'project.target_start': { value: '2026-11-02' }, 'project.federal': { value: 'false' }, 'design.drawings': { value: true },
    'design.percent': { value: '65' }, 'history.use': { value: true },
  } })
  ok(r.status === 200 && Object.keys(r.data.errors).length === 0, `Answers saved; readiness ${r.data.elicitation.readiness}%`, r.data.errors)
  const permitQs = r.data.elicitation.questions.filter(q => q.section === 'permits')
  ok(permitQs.some(q => /HCAI/.test(q.prompt)), `Pulled ${permitQs.length} CA healthcare permits, e.g. "${permitQs.find(q => /HCAI/.test(q.prompt))?.prompt}"`)
  const llQs = r.data.elicitation.questions.filter(q => q.section === 'procurement')
  ok(llQs.length > 5, `Asked about ${llQs.length} long-lead items, e.g. "${llQs[0].prompt}"`)
  const stateQ = (await A.get(`/api/plans/${planId}`)).data
  r = await A.post('/api/plans', { name: 'Toronto check' })
  const p2 = r.data.plan.id
  r = await A.patch(`/api/plans/${p2}`, { answers: { 'project.type': { value: 'data_center' }, 'project.state': { value: 'Ontario, Canada' } } })
  ok(!r.data.errors['project.state'] && r.data.elicitation.assumptions.some(a => a.questionId === 'project.state' && a.kind === 'custom'), 'Location outside the US typed in and planned with generic permitting')
  void stateQ
  r = await A.patch(`/api/plans/${planId}`, { answers: { 'design.percent': { value: '140' } } })
  ok(r.data.errors['design.percent'], `Invalid answer rejected: ${r.data.errors['design.percent']}`)
  r = await A.patch(`/api/plans/${planId}`, { answers: { 'project.type': { status: 'withheld' } } })
  ok(r.data.errors['project.type'], 'Facility type cannot be withheld')

  const hcai = permitQs.find(q => /HCAI/.test(q.prompt))
  const gen = llQs.find(q => /generator/i.test(q.prompt))
  r = await A.patch(`/api/plans/${planId}`, { answers: {
    [hcai.id]: { value: 'submitted' }, [gen.id]: { value: 'released' }, 'project.city': { status: 'withheld' }, 'site.acres_disturbed': { status: 'unknown' },
  } })
  ok(r.data.elicitation.questions.some(q => q.id === hcai.id.replace('.status', '.expected')), 'Follow-up asked: expected HCAI issuance date')
  ok(r.data.elicitation.questions.some(q => q.id === gen.id.replace('.status', '.delivery')), 'Follow-up asked: committed generator delivery date')
  r = await A.patch(`/api/plans/${planId}`, { answers: { [hcai.id.replace('.status', '.expected')]: { value: '2027-06-01' }, [gen.id.replace('.status', '.delivery')]: { value: '2027-09-15' } } })
  ok(r.data.elicitation.assumptions.some(a => a.kind === 'withheld'), `Withheld/unknown answers recorded as ${r.data.elicitation.assumptions.length} explicit assumptions`)

  /* ── AI follow-ups from the on-prem model (withheld answers never sent) ── */
  r = await A.get('/api/org')
  ok(r.data.settings?.aiEnabled === false, 'AI is off by default for a new organization (opt-in)')
  r = await A.post(`/api/plans/${planId}/suggest`)
  ok(r.status === 400 && /turned off/i.test(r.data.error), 'Nothing is sent to a model until an admin turns AI on')
  r = await A.post('/api/org', { action: 'update_settings', settings: { aiEnabled: true } })
  ok(r.status === 200 && r.data.settings.aiEnabled === true, 'Admin opts the organization in to AI features')
  r = await A.post(`/api/plans/${planId}/suggest`)
  if (r.status === 200) {
    ok(r.data.added > 0, `On-prem model added ${r.data.added} follow-up questions`)
    if (process.env.LLM_LOG) {
      const log = fs.readFileSync(process.env.LLM_LOG, 'utf8')
      ok(!/Sacramento/.test(log) && /withheld/.test(log), 'Model request contained no withheld answer (city) — only a count')
    }
  } else {
    ok(/model|configured/i.test(r.data.error), `AI suggestions unavailable offline: ${r.data.error}`)
  }

  /* ── Generate ── */
  r = await A.post(`/api/plans/${planId}/generate`)
  ok(r.status === 200 && r.data.plan.generated.activities.length > 40, `Generated ${r.data.plan.generated.activities.length} activities, finish ${r.data.plan.generated.cpm.projectFinish}`, r.data.error)
  let g = r.data.plan.generated
  const ev = r.data.evaluation
  ok(ev && ev.dcma.checks.length === 14, `Evaluation: grade ${ev.grade} (${ev.score}), DCMA ${ev.dcma.passed}/${ev.dcma.applicable}, P50 ${ev.forecast.p50}, P80 ${ev.forecast.p80}`)
  ok(ev.benchmark.rows.length > 0, `Benchmarked ${ev.benchmark.rows.length} work packages against firm actuals`)
  ok(g.activities.every(a => a.rationale.summary && a.rationale.sources.length), 'Every activity carries a rationale with sources')
  ok(g.activities.some(a => a.rationale.sources.some(s => s.kind === 'firm_history')), 'Some durations grounded in firm history')
  const hcaiAct = g.activities.find(a => /HCAI/.test(a.name))
  ok(hcaiAct && /2027-06-01/.test(hcaiAct.rationale.summary), `HCAI review uses your expected date: "${hcaiAct?.rationale.summary}"`)
  const genAct = g.activities.find(a => a.id.endsWith('-delivered'))
  ok(genAct && g.cpm.times[genAct.id].earlyStart === '2027-09-15', `Generator delivery held at committed date ${g.cpm.times[genAct?.id]?.earlyStart}`)
  for (const f of ev.findings.slice(0, 4)) console.log(`    finding: ${f}`)

  /* ── Human in control: override with reason ── */
  const target = g.activities.find(a => g.cpm.times[a.id].critical && a.type === 'task' && a.calendarId === 'cal-field' && a.phase !== 'design')
  r = await A.post(`/api/plans/${planId}/edit`, { edit: { kind: 'duration', activityId: target.id, value: target.duration + 10, reason: '' } })
  ok(r.status === 400 && /reason/i.test(r.data.error), 'Override without a reason is refused')
  r = await A.post(`/api/plans/${planId}/edit`, { edit: { kind: 'duration', activityId: target.id, value: target.duration + 10, reason: 'Curtain wall sub has a single crew' } })
  ok(r.status === 200 && r.data.impact.finishDeltaDays > 0, `Override applied: ${r.data.summary}; finish ${r.data.impact.finishBefore} → ${r.data.impact.finishAfter} (+${r.data.impact.finishDeltaDays}d)`)
  const ntp = g.activities.find(a => a.category === 'ntp'), fin = g.activities.find(a => a.category === 'final_completion')
  r = await A.post(`/api/plans/${planId}/edit`, { edit: { kind: 'add_link', from: fin.id, to: ntp.id, type: 'FS', lag: 0, reason: 'test loop' } })
  ok(r.status === 400 && /loop/.test(r.data.error), 'Logic loop refused')
  r = await A.post(`/api/plans/${planId}/generate`)
  ok(r.data.plan.generated.activities.find(a => a.id === target.id).duration === target.duration + 10, 'Regeneration keeps the override')
  ok(r.data.evaluation.review.status === 'none', 'No review yet')

  /* ── Expert review ── */
  r = await A.post(`/api/plans/${planId}/review`, { verdict: 'reject' })
  ok(r.status === 400, 'Rejection requires a comment')
  r = await A.post(`/api/plans/${planId}/review`, { verdict: 'approve_with_comments', reviewer: 'Senior Scheduler', comment: 'Confirm HCAI date with the owner' })
  ok(r.data.evaluation.review.status === 'approved', `Review recorded; score ${r.data.evaluation.score}`)

  /* ── Exports (text document + schedule files) ── */
  let x = await A.req('GET', `/api/plans/${planId}/export?format=md`, undefined, true)
  ok(x.status === 200 && /# Basis of Schedule/.test(x.text) && /Scheduler overrides/.test(x.text) && /Curtain wall sub/.test(x.text), `Basis of Schedule narrative (${x.text.length} chars) includes overrides`)
  ok(!/Sacramento/.test(x.text) && /Withheld/.test(x.text), 'Narrative omits the withheld city and lists it as withheld')
  x = await A.req('GET', `/api/plans/${planId}/export?format=xml`, undefined, true)
  ok(x.status === 200 && /<Project xmlns="http:\/\/schemas.microsoft.com\/project"/.test(x.text), 'MS Project XML export')
  const xml = x.text
  // The export nests activities under WBS summary tasks (one per phase / work package); the importer
  // keeps those as summary rows, so they count too. UID 0 is the project summary, which it skips.
  const xmlSummaries = (xml.match(/<Summary>1<\/Summary>/g) || []).length - 1
  const xmlCount = g.activities.length + xmlSummaries
  x = await A.req('GET', `/api/plans/${planId}/export?format=csv`, undefined, true)
  ok(x.status === 200 && /Activity ID/.test(x.text), 'CSV export')

  /* ── Every export format ── */
  for (const [fmt, sig, ctype] of [['xer', 'ERMHDR', 'octet-stream'], ['pdf', '%PDF', 'pdf'], ['xlsx-p6', 'PK', 'spreadsheetml'], ['xlsx-import', 'PK', 'spreadsheetml']]) {
    const res = await fetch(`${BASE}/api/plans/${planId}/export?format=${fmt}`, { headers: { cookie: A.cookie } })
    const buf = Buffer.from(await res.arrayBuffer())
    ok(res.status === 200 && buf.subarray(0, sig.length).toString('latin1') === sig && res.headers.get('content-type').includes(ctype), `${fmt} export (${(buf.length / 1024).toFixed(0)} KB, ${res.headers.get('content-disposition').match(/filename="(.+)"/)[1]})`)
    if (fmt === 'xer') {
      r = await upload(A, 'roundtrip.xer', buf)
      ok(r.status === 200 && r.data.summary.activitiesImported === g.activities.length, `Exported XER re-imports (${r.data.summary?.activitiesImported} activities, ${r.data.summary?.relationshipsImported} links)`, r.data)
    }
  }
  x = await A.req('GET', `/api/plans/${planId}/export?format=csv`, undefined, true)
  ok(/\d{2}\/\d{2}\/\d{4}/.test(x.text) && !/,20\d\d-\d\d-\d\d,/.test(x.text), 'CSV dates are MM/DD/YYYY')

  /* ── Custom answers, notes and added work, after generation ── */
  r = await A.patch(`/api/plans/${planId}`, { answers: { 'site.conditions': { value: 'Karst limestone with sinkholes' } } })
  ok(!r.data.errors['site.conditions'] && r.data.elicitation.assumptions.some(a => a.kind === 'custom'), 'Typed "Other" answer accepted and flagged as a custom assumption')
  r = await A.patch(`/api/plans/${planId}`, { addNote: 'Utility energizes the substation only after owner Cx sign-off.' })
  ok(r.status === 200 && r.data.answered.some(a => /substation/.test(a.label)), 'Team note added to the brief')
  const lastFin = r.data.plan.generated.activities.find(a => a.category === 'finishes')
  r = await A.post(`/api/plans/${planId}/edit`, { edit: { kind: 'add_activity', name: 'Owner IT fit-out', duration: 15, after: lastFin.id, reason: 'Owner scope' } })
  ok(r.status === 200 && r.data.plan.generated.activities.some(a => a.name === 'Owner IT fit-out'), `Activity added: ${r.data.summary}`)

  /* ── Plain-English edits: preview, apply, undo ── */
  {
    const pg = r.data.plan.generated
    const t = pg.activities.find(a => a.id === target.id)
    r = await A.post(`/api/plans/${planId}/edit/interpret`, { instruction: `extend ${t.code} by 1 week; make the schedule better` })
    ok(r.status === 200 && r.data.edits.length === 1 && r.data.edits[0].kind === 'duration' && r.data.edits[0].value === t.duration + 5 && /could not read/.test(r.data.clauses[1].error) && r.data.method === 'rules',
      `Plain-English preview: "${r.data.clauses?.[0]?.summary}"; the unreadable clause is shown, not guessed`, r.data)
    ok(typeof r.data.impact?.finishDeltaDays === 'number' && r.data.impact.finishBefore === pg.cpm.projectFinish, `Preview recalculates the finish (${r.data.impact?.finishBefore} → ${r.data.impact?.finishAfter})`)
    ok((await A.get(`/api/plans/${planId}`)).data.plan.generated.activities.find(a => a.id === t.id).duration === t.duration, 'Preview changes nothing')
    const edits = r.data.edits.map(e => ({ ...e, reason: 'Glazing crew split across two buildings' }))
    r = await A.post(`/api/plans/${planId}/edit`, { edits, source: 'instruction' })
    ok(r.status === 200 && r.data.plan.generated.activities.find(a => a.id === t.id).duration === t.duration + 5 && r.data.undo?.summary && !r.data.plan.generated.undo, `Applied with a reason: ${r.data.summary}; the undo snapshot stays on the server`, r.data)
    ok(r.data.plan.audit.some(e => e.action === 'override:duration' && /Glazing crew/.test(e.detail) && /plain-English/.test(e.detail)), 'Audit trail records the plain-English edit and its reason')
    r = await A.post(`/api/plans/${planId}/edit/undo`)
    ok(r.status === 200 && r.data.plan.generated.activities.find(a => a.id === t.id).duration === t.duration && !r.data.undo && r.data.plan.audit.some(e => e.action === 'override:undo'), `Undo restores the schedule (${r.data.summary})`, r.data)
    r = await A.post(`/api/plans/${planId}/edit/undo`)
    ok(r.status === 400, 'Nothing left to undo')
  }
  r = await A.post(`/api/plans/${planId}/generate`)
  ok(r.data.plan.generated.activities.some(a => a.name === 'Owner IT fit-out'), 'Added activity survives regeneration')
  x = await A.req('GET', `/api/plans/${planId}/export?format=md`, undefined, true)
  ok(/substation only after owner Cx/.test(x.text) && /Karst limestone/.test(x.text), 'Basis of Schedule includes the team note and the custom answer')
  g = r.data.plan.generated

  /* ── Round trip: re-import our own XML ── */
  r = await upload(A, 'roundtrip.xml', xml)
  ok(r.status === 200 && r.data.summary.activitiesImported === xmlCount, `Exported XML re-imports (${r.data.summary?.activitiesImported} activities)`, r.data)
  r = await B.get(`/api/plans/${planId}`)
  ok(r.status === 404, "Firm B cannot open Firm A's plan")

  /* ── Publish → Phase Two (analyze / monitor) ── */
  r = await A.post(`/api/plans/${planId}/publish`)
  ok(r.status === 200 && r.data.schedule.sourceType === 'generated', `Published as ${r.data.schedule.version}`)
  const pubId = r.data.schedule.id
  r = await A.get(`/api/schedules?id=${pubId}`)
  ok(r.status === 200 && r.data.metrics.criticalCount > 0, `Dashboard metrics on published schedule: ${r.data.metrics.criticalCount} critical`)
  r = await A.get(`/api/schedules/${pubId}/quality`)
  ok(r.status === 200, `Quality on published schedule: DCMA ${r.data.dcma.passed}/${r.data.dcma.applicable}`)
  r = await A.post('/api/ask', { question: 'What drives the critical path?', scheduleId: pubId })
  ok(r.status === 200 && r.data.answer.length > 50, 'Ask AI answers (model or offline readout)')
  r = await A.post('/api/reports', { reportType: 'qa_qc', scheduleId: pubId })
  ok(r.status === 200 && r.data.content.length > 50, 'QA/QC report generated')
  if (process.env.LLM_LOG) ok(/DCMA 14-POINT RESULTS \(computed/.test(fs.readFileSync(process.env.LLM_LOG, 'utf8')), 'Report prompt was grounded in computed DCMA results')
  else ok(/DCMA/.test(r.data.content), 'Offline QA/QC report includes computed DCMA table')
  r = await A.get('/api/history')
  ok(!r.data.schedules.some(s => s.id === pubId), 'Generated schedules never pollute firm history')

  /* ── Daily Brief: the living schedule, its register, its correspondence and recent changes ── */
  {
    const iso = d => d.toISOString().slice(0, 10)
    const at = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return iso(d) }
    const live = ['Act ID,Activity Name,OD,Start,Finish,Actual Start,Actual Finish,Preds',
      `D100,NTP,0,${at(-30)},${at(-30)},${at(-30)},${at(-30)},`, `D110,Set main switchgear,20,${at(-20)},${at(8)},${at(-20)},,D100`,
      `D120,Pull feeders,15,${at(9)},${at(30)},,,D110`, `D130,Level 3 startup,10,${at(31)},${at(45)},,,D120`, `D140,Ready for service,0,${at(46)},${at(46)},,,D130`].join('\n')
    r = await upload(A, 'daily-brief.csv', live, { projectType: 'data_center' })
    ok(r.status === 200, 'Live schedule uploaded for the daily brief', r.data)
    const sid = r.data.schedule.id
    r = await A.get(`/api/schedules/${sid}/brief`)
    ok(r.status === 200 && r.data.brief.driving.today && r.data.brief.audiences.pm.length > 0 && r.data.brief.audiences.field.length > 0 && r.data.brief.audiences.client.length > 0 && r.data.brief.whatIfs.length > 0,
      `Daily brief: driving today ${r.data.brief?.driving?.today?.code}, ${r.data.brief?.whatIfs?.length} what-if runs, PM / field / client versions`, r.data)
    const finish0 = r.data.brief.headline.forecast
    r = await A.get(`/api/schedules/${sid}/brief?whatIfActivity=D120&whatIfDays=10`)
    ok(r.status === 200 && r.data.brief.whatIfs[0].title.startsWith('Your what-if') && r.data.brief.whatIfs[0].days > 0, `Custom what-if: D120 +10 work days moves the finish ${r.data.brief?.whatIfs?.[0]?.days} days`, r.data.brief?.whatIfs)
    // Register: add, appears in the brief, close, gone from the brief, delete.
    r = await A.post(`/api/schedules/${sid}/register`, { kind: 'pco', title: 'PCO-7 added feeder set', impactDays: 6, activityCodes: ['D120'], dueDate: at(5) })
    ok(r.status === 200 && r.data.item.kind === 'pco', 'Register item added (PCO)', r.data)
    const itemId = r.data.item.id
    ok((await A.post(`/api/schedules/${sid}/register`, { kind: 'nope', title: 'x' })).status === 400, 'Register refuses an unknown kind')
    r = await A.get(`/api/schedules/${sid}/brief`)
    ok(r.data.brief.changeItems.length === 1 && r.data.brief.changeImpactDays === 6 && r.data.brief.whatIfs.some(w => w.title.startsWith('Register:')), 'Open change item reaches the brief and its own what-if run', r.data.brief)
    r = await A.req('PATCH', `/api/schedules/${sid}/register?itemId=${itemId}`, { status: 'closed' })
    ok(r.status === 200 && r.data.item.status === 'closed', 'Register item closed')
    ok((await A.get(`/api/schedules/${sid}/brief`)).data.brief.changeItems.length === 0, 'Closed item leaves the brief')
    ok((await B.get(`/api/schedules/${sid}/brief`)).status === 404 && (await B.get(`/api/schedules/${sid}/register`)).status === 404 && (await B.get(`/api/schedules/${sid}/changes`)).status === 404, "Firm B cannot read Firm A's brief, register or changes")
    ok((await A.req('DELETE', `/api/schedules/${sid}/register?itemId=${itemId}`)).status === 200, 'Register item deleted')
    // Correspondence: a pasted meeting note becomes a signal tied to the activity.
    const fd = new FormData()
    fd.append('file', new Blob(['OAC meeting. The vendor reported the main switchgear will be delayed by 2 weeks. Next meeting Tuesday.']), 'oac.txt')
    fd.append('title', 'OAC minutes'); fd.append('docType', 'meeting')
    r = await A.req('POST', `/api/schedules/${sid}/documents`, fd)
    ok(r.status === 200, 'Meeting minutes added as a project document', r.data)
    r = await A.get(`/api/schedules/${sid}/brief`)
    const sig = r.data.brief.signals.find(x => x.kind === 'delay')
    ok(sig && sig.days === 10 && sig.activity?.code === 'D110' && r.data.brief.whatIfs.some(w => w.title.startsWith('Correspondence:')), `Signal from the minutes: delay of ${sig?.days} work days on ${sig?.activity?.code}, with its what-if run`, r.data.brief.signals)
    // Contract, specification and field report read against the schedule.
    const add = async (name, docType, text) => { const f = new FormData(); f.append('file', new Blob([text]), `${name}.txt`); f.append('title', name); f.append('docType', docType); return A.req('POST', `/api/schedules/${sid}/documents`, f) }
    ok((await add('Contract Article 8', 'contract', 'ARTICLE 8. The Contractor shall give written notice of any delay within seven (7) days of the event. The Contractor shall pay liquidated damages of $10,000 per day for each calendar day of delay.')).status === 200, 'Contract excerpt added')
    ok((await add('Daily report', 'daily_report', 'Daily report. The crew started D120 this morning ahead of plan. No incidents were recorded today.')).status === 200, 'Daily field report added')
    r = await A.get(`/api/schedules/${sid}/brief`)
    const notice = r.data.watch.contract.find(c => c.kind === 'notice'), ld = r.data.watch.contract.find(c => c.kind === 'damages')
    ok(notice?.days === 7 && notice.active && ld?.perDay === 10000 && notice.quote.includes('seven (7) days'), `Contract watch: notice within ${notice?.days} days (raised by the reported delay), damages ${ld?.perDay} per day`, r.data.watch)
    ok(r.data.watch.field.some(f => f.activity.code === 'D120' && f.schedule === 'not started'), 'Field report against the schedule: work reported on D120, which the schedule shows not started', r.data.watch.field)
    ok(r.data.alerts.some(a => a.level === 'act' && a.section === 'contract') && r.data.alerts.some(a => a.section === 'field'), `Alerts: ${r.data.alerts.length} (${r.data.alerts.filter(a => a.level === 'act').length} to act on)`, r.data.alerts)
    r = await A.post(`/api/schedules/${sid}/brief`, { audience: 'field' })
    ok(r.status === 200 && r.data.sent === true, 'Brief emailed to the member (field version)', r.data)
    ok((await B.post(`/api/schedules/${sid}/brief`, { audience: 'pm' })).status === 404, "Firm B cannot have Firm A's brief emailed")
    r = await A.req('PUT', `/api/schedules/${sid}/brief`, { audience: 'client' })
    ok(r.status === 200 && r.data.everyMorning === 'client' && (await A.get(`/api/schedules/${sid}/brief`)).data.email.everyMorning === 'client', 'Brief by email every working morning turned on (client version)', r.data)
    ok((await B.req('PUT', `/api/schedules/${sid}/brief`, { audience: 'pm' })).status === 404, "Firm B cannot subscribe to Firm A's brief")
    ok((await fetch(`${BASE}/api/cron/daily-brief`)).status !== 200, 'The morning scheduler endpoint refuses a caller without its secret')
    if (process.env.CRON_SECRET) {
      const run = async () => (await fetch(`${BASE}/api/cron/daily-brief`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }))
      const first = await run(), d1 = await first.json()
      const now = new Date(), due = now.getUTCDay() !== 0 && now.getUTCDay() !== 6 && now.getUTCHours() >= Number(process.env.RUNF9_BRIEF_HOUR_UTC ?? 11)
      ok(first.status === 200 && (due ? d1.sent >= 1 : d1.sent === 0), `Morning scheduler ran: ${d1.sent} brief${d1.sent === 1 ? '' : 's'} sent${due ? '' : ' (outside the sending hours, so none is due)'}`, d1)
      const d2 = await (await run()).json()
      ok(d2.sent === 0, 'A second run the same day sends nothing (one email per subscription per day)', d2)
      ok((await fetch(`${BASE}/api/cron/daily-brief`, { headers: { authorization: 'Bearer wrong' } })).status === 401, 'The scheduler endpoint refuses a wrong secret')
    }
    r = await A.req('DELETE', `/api/schedules/${sid}/brief`)
    ok(r.status === 200 && (await A.get(`/api/schedules/${sid}/brief`)).data.email.everyMorning === null, 'Brief by email turned off')
    // Progress recorded in RunF9, then highlighted as a recent change with what it moved.
    r = await A.get(`/api/schedules/${sid}/changes`)
    ok(r.status === 200 && r.data.changed.length === 0, 'No recent changes before any edit')
    const acts = (await A.get(`/api/schedules?id=${sid}`)).data.activities
    const d110 = acts.find(a => a.activityId === 'D110'), d120 = acts.find(a => a.activityId === 'D120')
    r = await A.post(`/api/schedules/${sid}/edits`, { change: { kind: 'progress', activityId: d110.id, actualStart: at(-20), actualFinish: at(3) }, reason: 'Future finish must be refused' })
    ok(r.status === 400, 'Progress with a future finish date is refused')
    r = await A.post(`/api/schedules/${sid}/edits`, { change: { kind: 'progress', activityId: d110.id, actualStart: at(-20), actualFinish: at(0) }, reason: 'Reported finished on the daily brief' })
    ok(r.status === 200, 'Progress recorded: D110 finished today', r.data)
    r = await A.post(`/api/schedules/${sid}/edits`, { change: { kind: 'duration', activityId: d120.id, remaining: 25 }, reason: 'Feeder pull re-estimated by the foreman' })
    ok(r.status === 200, 'Duration changed on D120')
    r = await A.get(`/api/schedules/${sid}/changes`)
    ok(r.status === 200 && r.data.changed.length === 2 && r.data.moved.some(m => m.code === 'D130') && r.data.finishMovedDays !== null, `Recent changes: ${r.data.changed?.length} changed, ${r.data.movedCount} moved, finish ${r.data.finishMovedDays} days`, r.data)
    r = await A.get(`/api/schedules/${sid}/brief`)
    ok(r.data.brief.changed.edits.length === 2 && r.data.brief.headline.forecast !== finish0 && !r.data.activities.some(a => a.code === 'D110'), 'Brief runs on the living schedule: D110 is done, the changes are listed, the forecast moved', r.data.brief.changed)
  }

  console.log(`\nAll ${passed} checks passed.`)
}

main().catch(err => { console.error(err); process.exit(1) })
