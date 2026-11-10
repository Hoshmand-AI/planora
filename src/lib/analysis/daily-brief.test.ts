import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseXER } from '@/lib/parsers/xer-parser'
import { completeSchedule } from '@/lib/planning/complete-schedule'
import { applyScheduleEdits, validateEditChange, type ScheduleEdit } from '@/lib/planning/uploaded-edits'
import { buildDailyBrief, missingScope, previousWorkday, type DailyBriefInput, type RegisterItem } from './daily-brief'
import { extractSignals } from './correspondence'
import { parseRegisterFields } from '@/lib/server/register'
import { exportXerFromOriginal, xerEditsFrom } from '@/lib/export/xer'
import { projectWatch } from './project-watch'

const xer = fs.readFileSync(path.join(__dirname, '../parsers/__fixtures__/sample.xer'), 'latin1')
const p = parseXER(xer, 's1')
const done = completeSchedule({ activities: p.activities, relationships: p.relationships, calendars: p.calendars, defaultCalendarId: p.defaultCalendarId, projectStart: p.projectStart, dataDate: p.dataDate, mustFinishBy: p.mustFinishBy ?? null, progressMode: 'retained', projectFinish: null })
const acts = done.activities
const finish = acts.map(a => a.earlyFinish ?? '').sort().pop()!.slice(0, 10)

const input = (over: Partial<DailyBriefInput> = {}): DailyBriefInput => ({
  today: p.dataDate!.slice(0, 10), dataDate: p.dataDate, activities: acts, relationships: p.relationships, forecastFinish: finish,
  required: null, milestoneForecast: finish, drivingPathIds: done.cpm?.longestPath ?? [], register: [], signals: [], changes: [], whatIfs: [],
  logic: { looseEnds: 0, outOfSequence: [], proposals: [] }, missingScope: [], ...over,
})
const item = (o: Partial<RegisterItem>): RegisterItem => ({ id: 'i1', kind: 'risk', title: 'Switchgear delivery slips', detail: null, status: 'open', owner: null, dueDate: null, impactDays: null, activityCodes: [], sourceDocumentId: null, sourceQuote: null, createdByName: 'Ana', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', closedAt: null, ...o } as RegisterItem)

describe('daily brief', () => {
  it('previous work day skips the weekend', () => {
    expect(previousWorkday('2026-11-09')).toBe('2026-11-06') // Monday → Friday
    expect(previousWorkday('2026-11-10')).toBe('2026-11-09')
  })

  it('says how many days behind against the required date, and ahead when early', () => {
    const d = new Date(finish + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 12)
    const late = buildDailyBrief(input({ required: { date: d.toISOString().slice(0, 10), source: 'Contract', milestone: null } }))
    expect(late.headline.status).toBe('behind')
    expect(late.headline.daysBehind).toBe(12)
    d.setUTCDate(d.getUTCDate() + 20)
    const early = buildDailyBrief(input({ required: { date: d.toISOString().slice(0, 10), source: 'Contract', milestone: null } }))
    expect(early.headline.status).toBe('ahead')
    expect(early.headline.daysBehind).toBe(-8)
    expect(buildDailyBrief(input()).headline.status).toBe('unknown')
  })

  it('lists overdue work, and every list holds only open activities', () => {
    const far = new Date(finish + 'T00:00:00Z'); far.setUTCDate(far.getUTCDate() + 30)
    const b = buildDailyBrief(input({ today: far.toISOString().slice(0, 10) }))
    const open = acts.filter(a => a.activityType === 'task' && a.status !== 'complete' && !a.actualFinish)
    expect(b.overdue.finishCount).toBeGreaterThanOrEqual(open.length) // open tasks, plus any open milestone
    expect(b.overdue.shouldHaveFinished.every(r => (r.daysLate ?? 0) > 0)).toBe(true)
    expect(b.staleDays).toBeGreaterThan(0)
    const completeIds = new Set(acts.filter(a => a.status === 'complete').map(a => a.id))
    for (const r of [...b.today.starting, ...b.today.finishing, ...b.today.inProgress, ...b.overdue.shouldHaveFinished, ...b.overdue.shouldHaveStarted, ...b.driving.path]) expect(completeIds.has(r.id)).toBe(false)
  })

  it('the driving activity today is the first open activity on the driving path', () => {
    const b = buildDailyBrief(input())
    const firstOpen = (done.cpm?.longestPath ?? []).map(id => acts.find(a => a.id === id)!).find(a => a.status !== 'complete' && !a.actualFinish)
    expect(b.driving.today?.id).toBe(firstOpen?.id)
  })

  it('open register items reach the right sections; closed ones do not', () => {
    const b = buildDailyBrief(input({ register: [
      item({ id: 'r', kind: 'risk', title: 'Transformer lead time' }), item({ id: 'x', kind: 'issue', title: 'Crane down' }),
      item({ id: 'c', kind: 'pco', title: 'PCO 14 added conduit', impactDays: 6 }), item({ id: 'z', kind: 'risk', title: 'Closed risk', status: 'closed' }),
    ] }))
    expect(b.risks.some(r => r.text.includes('Transformer lead time'))).toBe(true)
    expect(b.issues.some(r => r.text.includes('Crane down'))).toBe(true)
    expect(b.changeItems.map(c => c.id)).toEqual(['c'])
    expect(b.changeImpactDays).toBe(6)
    expect(JSON.stringify(b)).not.toContain('Closed risk')
  })

  it('writes a version for the PM, the field and the client; the client never sees internal risk wording', () => {
    const b = buildDailyBrief(input({ register: [item({ kind: 'risk', title: 'Sub may default' })] }))
    expect(b.audiences.pm.length).toBeGreaterThan(0)
    expect(b.audiences.field.length).toBeGreaterThan(0)
    expect(b.audiences.client.length).toBeGreaterThan(0)
    expect(b.audiences.client.join(' ')).not.toContain('Sub may default')
  })

  it('missing scope: flags data-center systems that no activity names, and stays quiet on small schedules', () => {
    expect(missingScope(acts, 'data_center')).toEqual([]) // under 25 activities: not enough to judge
    const many = Array.from({ length: 40 }, (_, i) => ({ ...acts[0], id: `x${i}`, activityId: `X${i}`, name: i % 2 ? 'Install generators and UPS' : 'Pour slab on grade', wbsName: 'Building' }))
    const miss = missingScope(many, 'data_center')
    expect(miss.some(m => /commission/i.test(m))).toBe(true)
    expect(miss.some(m => /generator/i.test(m))).toBe(false)
  })
})

describe('signals from correspondence', () => {
  const activities = [{ id: 'a1', code: 'A1050', name: 'Erect structural steel', open: true }, { id: 'a2', code: 'E2000', name: 'Install main switchgear', open: true }]
  const chunk = (text: string, docType = 'email') => ({ documentId: 'd1', title: 'OAC minutes', docType, citation: '§1', text })

  it('finds a delay with its days and the activity it is about', () => {
    const s = extractSignals([chunk('Vendor confirmed the main switchgear will be delayed by 3 weeks due to a breaker shortage. Lunch was good.')], activities)
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ kind: 'delay', days: 15, activity: { code: 'E2000' } })
    expect(s[0].quote).toContain('switchgear')
  })

  it('matches an activity by its ID and ignores sentences with no schedule meaning', () => {
    const s = extractSignals([chunk('A1050 is on hold pending the revised anchor bolt detail. Thanks all for attending.', 'meeting')], activities)
    expect(s.map(x => x.activity?.code)).toEqual(['A1050'])
    expect(extractSignals([chunk('Thanks all for attending. Parking is on the east lot.')], activities)).toEqual([])
  })
})

describe('register fields', () => {
  it('validates kind, title, dates and impact', () => {
    expect(parseRegisterFields({ kind: 'nope', title: 'abc' }, true)).toHaveProperty('error')
    expect(parseRegisterFields({ kind: 'risk', title: 'a' }, true)).toHaveProperty('error')
    expect(parseRegisterFields({ kind: 'pco', title: 'PCO 14', dueDate: '11/10/2026' }, true)).toHaveProperty('error')
    expect(parseRegisterFields({ kind: 'pco', title: 'PCO 14', impactDays: 99999 }, true)).toHaveProperty('error')
    const ok = parseRegisterFields({ kind: 'pco', title: ' PCO 14 ', impactDays: '6', activityCodes: ['A1050', 'A1050', ''] }, true)
    expect(ok).toMatchObject({ fields: { kind: 'pco', title: 'PCO 14', impactDays: 6, activityCodes: ['A1050'] } })
    expect(parseRegisterFields({ status: 'closed' }, false)).toEqual({ fields: { status: 'closed' } })
  })
})

describe('progress recorded in RunF9', () => {
  const open = p.activities.find(a => a.activityType === 'task' && a.status === 'not_started')!
  const edit = (change: ScheduleEdit['change']): ScheduleEdit => ({ id: 'e1', change, reason: 'Reported on site', by: 'u1', byName: 'Ana', at: '2026-01-05T00:00:00.000Z' })

  it('marking finished completes the activity without touching the import', () => {
    const v = validateEditChange({ kind: 'progress', activityId: open.id, actualStart: '2020-01-06', actualFinish: '2020-01-10' }, p.activities, p.relationships)
    expect(v).toHaveProperty('change')
    const r = applyScheduleEdits(p.activities, p.relationships, [edit((v as { change: ScheduleEdit['change'] }).change)])
    const a = r.activities.find(x => x.id === open.id)!
    expect(a).toMatchObject({ status: 'complete', percentComplete: 100 })
    expect(a.actualFinish?.slice(0, 10)).toBe('2020-01-10')
    expect(open.status).toBe('not_started')
  })

  it('marking started puts it in progress; future or reversed dates are refused', () => {
    const r = applyScheduleEdits(p.activities, p.relationships, [edit({ kind: 'progress', activityId: open.id, actualStart: '2020-01-06', actualFinish: null })])
    expect(r.activities.find(x => x.id === open.id)).toMatchObject({ status: 'in_progress' })
    expect(validateEditChange({ kind: 'progress', activityId: open.id, actualStart: '2999-01-01', actualFinish: null }, p.activities, p.relationships)).toHaveProperty('error')
    expect(validateEditChange({ kind: 'progress', activityId: open.id, actualStart: '2020-01-10', actualFinish: '2020-01-06' }, p.activities, p.relationships)).toHaveProperty('error')
  })
})

describe('progress reaches the exported P6 file', () => {
  it('writes the actual dates and the status into the original XER', () => {
    const open = p.activities.find(a => a.activityType === 'task' && a.status === 'not_started')!
    const applied = applyScheduleEdits(p.activities, p.relationships, [{ id: 'e1', change: { kind: 'progress', activityId: open.id, actualStart: '2026-03-17', actualFinish: '2026-03-24' }, reason: 'Reported on site', by: 'u1', byName: 'Ana', at: '2026-03-25T00:00:00.000Z' }]).applied
    const out = exportXerFromOriginal(xer, new Map(), { edits: xerEditsFrom(p.activities, applied) })
    const again = parseXER(out, 's2').activities.find(a => a.activityId === open.activityId)!
    expect(again.status).toBe('complete')
    expect(again.actualStart?.slice(0, 10)).toBe('2026-03-17')
    expect(again.actualFinish?.slice(0, 10)).toBe('2026-03-24')
    // Every other activity is written back as read.
    expect(parseXER(out, 's2').activities.filter(a => a.status === 'complete').length).toBe(p.activities.filter(a => a.status === 'complete').length + 1)
  })
})

describe('project documents read against the schedule', () => {
  const acts = [
    { id: 'a1', code: 'E4020', name: 'Set Medium-Voltage Switchgear', started: false, done: false },
    { id: 'a2', code: 'D6010', name: 'Data Hall 1 Containment and Cable Tray', started: false, done: false },
    { id: 'a3', code: 'M5030', name: 'Install CRAH Units', started: true, done: false },
    ...Array.from({ length: 10 }, (_, i) => ({ id: `x${i}`, code: `X${i}`, name: 'Erect structural steel', started: false, done: false })),
  ]
  const doc = (docType: string, text: string) => ({ documentId: docType, title: `The ${docType}`, docType, citation: '§8', text })
  const ctx = { daysBehind: 12, delaysReported: [{ title: 'OAC minutes', activity: 'E4020 Set Medium-Voltage Switchgear' }], openChangeItems: 0, staleDays: 40, projectType: 'data_center' }

  it('contract watch: notice period, liquidated damages exposure and an overdue update', () => {
    const w = projectWatch([doc('contract', 'The Contractor shall give written notice of any delay within seven (7) days of the event. The Contractor shall pay liquidated damages of $50,000 per day for each calendar day of delay. The Contractor shall submit an updated schedule monthly.')], acts, ctx)
    const notice = w.contract.find(c => c.kind === 'notice')!, ld = w.contract.find(c => c.kind === 'damages')!, up = w.contract.find(c => c.kind === 'update')!
    expect(notice).toMatchObject({ days: 7, active: true })
    expect(notice.text).toContain('OAC minutes')
    expect(ld).toMatchObject({ perDay: 50000, exposure: 600000, active: true })
    expect(up.active).toBe(true)
    expect(notice.quote).toContain('seven (7) days')
  })

  it('on time and nothing reported: the clauses are listed but not raised', () => {
    const w = projectWatch([doc('contract', 'The Contractor shall give written notice of any delay within 10 days. Liquidated damages of $5,000 per day apply.')], acts, { ...ctx, daysBehind: 0, delaysReported: [], staleDays: 3 })
    expect(w.contract.every(c => !c.active)).toBe(true)
    expect(w.contract.find(c => c.kind === 'damages')!.exposure).toBeNull()
  })

  it('finds scope in the specifications that no activity covers, with the sentence', () => {
    const w = projectWatch([doc('specification', 'Each data hall shall be protected by a double-interlock pre-action sprinkler system. Structural steel shall conform to ASTM A992.')], acts, ctx)
    expect(w.notInSchedule.map(g => g.label)).toContain('Fire detection and suppression')
    expect(w.notInSchedule.find(g => /Fire/.test(g.label))!.quote).toContain('pre-action')
    expect(w.notInSchedule.map(g => g.label)).not.toContain('Structure')
  })

  it('compares the field report with the schedule', () => {
    const w = projectWatch([doc('daily_report', 'The crew started Data Hall 1 containment and cable tray in row A. M5030 is completed in the hall. The switchgear will complete next week.')], acts, ctx)
    expect(w.field.map(f => [f.activity.code, f.schedule])).toEqual([['D6010', 'not started'], ['M5030', 'in progress']])
  })

  it('reads only the right kinds of document', () => {
    const w = projectWatch([doc('email', 'Liquidated damages of $50,000 per day. Written notice of delay within 7 days. The crew started Data Hall 1 containment and cable tray.')], acts, ctx)
    expect(w).toMatchObject({ contract: [], field: [], notInSchedule: [] })
  })
})
