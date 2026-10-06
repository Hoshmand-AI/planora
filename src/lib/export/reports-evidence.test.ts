import { describe, it, expect } from 'vitest'
import type { Activity, Relationship, Schedule } from '@/lib/db'
import { makeActivity } from '@/lib/parsers/types'
import { completeSchedule } from '@/lib/planning/complete-schedule'
import { analyzeSchedule } from '@/lib/analysis/schedule-analysis'
import { runDcma } from '@/lib/analysis/dcma'
import { analyzableFromDb } from '@/lib/planning/service'
import { buildReport, reportSupplement } from '@/lib/export/reports'
import { planoraRelease, withProvenance, type Provenance } from '@/lib/export/provenance'
import { defaultCalendar } from '@/lib/planning/calendar'

// Same fixture as reports.test.ts: NTP done, A200 in progress, A300, M900 (baseline 03/30, forecast 04/01).
const cal = defaultCalendar()
const act = (code: string, f: Partial<Activity> = {}) => makeActivity('s', { activityId: code, name: `Activity ${code}`, calendarId: cal.id, duration: 5, ...f })
const link = (p: Activity, s: Activity): Relationship => ({ id: p.id + s.id, scheduleId: 's', predecessorId: p.id, successorId: s.id, type: 'FS', lag: 0 })

const ntp = act('M100', { name: 'NTP', activityType: 'milestone', duration: 0, actualStart: '2026-03-02', actualFinish: '2026-03-02', status: 'complete', baselineFinish: '2026-03-02' })
const a = act('A200', { duration: 10, baselineStart: '2026-03-03', baselineFinish: '2026-03-16', actualStart: '2026-03-03', remainingDuration: 8, status: 'in_progress' })
const b = act('A300', { duration: 10, baselineStart: '2026-03-17', baselineFinish: '2026-03-30' })
const f = act('M900', { name: 'Substantial Completion', activityType: 'milestone', duration: 0, baselineFinish: '2026-03-30' })
const rels = [link(ntp, a), link(a, b), link(b, f)]
const schedule = { id: 's', name: 'Bridge 12', version: 'Update 3', dataDate: '2026-03-09', projectStart: '2026-03-02', calendars: [cal], defaultCalendarId: cal.id, warnings: [] } as unknown as Schedule
const done = completeSchedule({ activities: [ntp, a, b, f], relationships: rels, calendars: [cal], defaultCalendarId: cal.id, projectStart: '2026-03-02', projectFinish: null, dataDate: '2026-03-09' })
const analysis = analyzeSchedule({ activities: done.activities, links: rels.map(r => ({ from: r.predecessorId, to: r.successorId })), cpm: done.cpm, reportedFinish: null, mustFinishBy: null })
const dcma = runDcma(analyzableFromDb(schedule, done.activities, rels))
const input = { schedule, activities: done.activities, relationships: rels, analysis, dcma }

const prov: Provenance = {
  sources: [{ scheduleName: 'Bridge 12', version: 'Update 3', fileName: 'bridge12_upd3.xer', sha256: 'a'.repeat(64), dataDate: '2026-03-09', progressMode: 'retained' }],
  release: 'abc1234', settings: ['CPM recalculation by Planora; out-of-sequence progress: Retained logic'], generatedAt: '2026-10-06T12:00:00.000Z',
}

describe('report provenance header', () => {
  it('starts every report type with the provenance block', () => {
    for (const t of ['executive_summary', 'critical_path', 'variance', 'qa_qc']) {
      const out = buildReport(t, { ...input, provenance: prov })
      const at = out.indexOf('## Provenance')
      expect(at).toBeGreaterThan(0)
      expect(at).toBeLessThan(out.indexOf('## 1.'))
      expect(out).toContain('| Source file | bridge12_upd3.xer |')
      expect(out).toContain(`| SHA-256 | ${'a'.repeat(64)} |`)
      expect(out).toContain('| Planora version (release) | abc1234 |')
      expect(out).toContain('| Progress mode | Retained logic |')
      expect(out).toContain('| Data date | 03/09/2026 |')
      expect(out).toContain('| Calculation settings | CPM recalculation by Planora')
    }
  })
  it('adds provenance once to an AI-written report, and in the supplement', () => {
    const once = withProvenance('# AI report\n\nText.', prov)
    expect(once).toContain('## Provenance')
    expect(withProvenance(once, prov)).toBe(once)
    const sup = reportSupplement('qa_qc', { ...input, provenance: prov })
    expect(sup).toContain('## Provenance')
    expect(sup).toContain('## Reviewer disposition')
  })
  it('states the release the same way /api/health does', () => {
    expect(planoraRelease({ VERCEL_GIT_COMMIT_SHA: '0123456789abcdef' })).toBe('0123456')
    expect(planoraRelease({ PLANORA_RELEASE: 'v2.4.0' })).toBe('v2.4.0')
    expect(planoraRelease({})).toBe('local')
  })
})

describe('variance report: contract dates, WBS roll-up, every activity', () => {
  it('puts the contract date next to the forecast with days late against it', () => {
    const acts = done.activities.map(x => x.id === f.id ? { ...x, constraintType: 'FNLT', constraintDate: '2026-03-27' } : x)
    const out = buildReport('variance', { ...input, activities: acts })
    const row = out.split('\n').find(l => l.startsWith('| M900 |'))!
    // forecast 04/01 vs FNLT 03/27: 5 days late; vs baseline 03/30: +2
    expect(row).toContain('| FNLT 03/27/2026 | +5 | +2 |')
  })
  it('rolls finish variance up by top-level WBS and lists every activity by variance', () => {
    const acts = done.activities.map(x => ({ ...x, wbs: x.activityId === 'A300' ? 'STR.DECK Deck' : x.activityId === 'A200' ? 'CIV.EARTH Earthwork' : 'MS' }))
    const out = buildReport('variance', { ...input, activities: acts })
    expect(out).toContain('## 3. Finish variance by top-level WBS')
    expect(out).toMatch(/\| STR \| 1 \| 0 \| 03\/30\/2026 \| 04\/01\/2026 \| \+2 \| 1 \| A300 \(\+2\) \|/)
    expect(out).toMatch(/\| CIV \| 1 \|/)
    const all = out.split('## 4.')[1].split('## 5.')[0]
    expect(all.indexOf('| A300 |')).toBeGreaterThan(0)
    expect(all.indexOf('| A300 |')).toBeLessThan(all.indexOf('| M100 |'))
  })
})

describe('critical path report: tied driving branches', () => {
  it('shows tied driving branches and the real driving relationship type', () => {
    const s0 = act('S0', { activityType: 'milestone', duration: 0 })
    const p = act('P1', { duration: 5 })
    const q = act('Q1', { duration: 5 }) // ties with P1 into Z1
    const z = act('Z1', { duration: 3 })
    const fin = act('F9', { activityType: 'milestone', duration: 0 })
    const ss: Relationship = { id: 'pz-ss', scheduleId: 's', predecessorId: p.id, successorId: z.id, type: 'SS', lag: 1 }
    const rs = [link(s0, p), link(s0, q), ss, link(p, z), link(q, z), link(z, fin)]
    const dn = completeSchedule({ activities: [s0, p, q, z, fin], relationships: rs, calendars: [cal], defaultCalendarId: cal.id, projectStart: '2026-03-02', projectFinish: null, dataDate: '2026-03-02' })
    const an = analyzeSchedule({ activities: dn.activities, links: rs.map(r => ({ from: r.predecessorId, to: r.successorId })), cpm: dn.cpm, reportedFinish: null, mustFinishBy: null })
    const out = buildReport('critical_path', { ...input, activities: dn.activities, relationships: rs, analysis: an, linkFloat: dn.cpm!.linkFloat })
    // Z1 follows its path predecessor by FS (driving), not by the SS listed first.
    const zRow = out.split('\n').find(l => /^\| \d+ \| Z1 \|/.test(l))!
    expect(zRow).toContain('| FS |')
    expect(out).toContain('## 3. All driving branches to the finish (relationship free float 0)')
    expect(out).toMatch(/driven by more than one tied predecessor \(Z1\)/)
    expect(out).toContain('tied branch')
    expect(out).toMatch(/\| Z1 Activity Z1 \| (P1 Activity P1|Q1 Activity Q1) \| FS \| 0 \| tied branch \|/)
  })
})

describe('QA/QC report: reviewer disposition', () => {
  it('prints the overall and per-finding dispositions', () => {
    const review = {
      submission: { disposition: 'approved_as_noted' as const, comments: 'Resequence the deck pours in the next update.', userId: 'u1', reviewer: 'Rita Reviewer', createdAt: '2026-03-12T10:00:00.000Z' },
      items: [
        { itemId: 'dcma:14', disposition: 'exception' as const, justification: 'Weather days granted by the owner (CO-7).', userId: 'u1', reviewer: 'Rita Reviewer', createdAt: '2026-03-12T10:00:00.000Z' },
        { itemId: 'q-weekend', disposition: 'needs_revision' as const, justification: null, userId: 'u1', reviewer: 'Rita Reviewer', createdAt: '2026-03-12T10:00:00.000Z' },
      ],
    }
    const out = buildReport('qa_qc', { ...input, review, dataQuestions: [{ id: 'q-weekend', severity: 'warning', question: 'A300 is scheduled on a Saturday on a 5-day calendar. Intentional?' }] })
    expect(out).toContain('## 7. Reviewer disposition')
    expect(out).toContain('**Submission disposition: Approved as noted** — Rita Reviewer, 03/12/2026. Comments: Resequence the deck pours in the next update.')
    expect(out).toMatch(/\| DCMA #14 BEI \([A-Z/]+\) \| Exception \(justified\) \| Weather days granted by the owner \(CO-7\)\. \| Rita Reviewer \| 03\/12\/2026 \|/)
    expect(out).toContain('| Data question: A300 is scheduled on a Saturday on a 5-day calendar. Intentional? | Needs revision |')
  })
})
