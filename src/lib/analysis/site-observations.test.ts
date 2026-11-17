import { describe, it, expect } from 'vitest'
import { buildDailyBrief, type DailyBriefInput, type SiteObservation } from './daily-brief'
import { projectWatch } from './project-watch'
import type { Activity } from '@/lib/db'

// Site captures (a photo, a note, a status and activities picked on a phone) read by the Daily Brief.
// A capture carries its status and its activities as data, so nothing here depends on the wording of its note.

const acts = [
  { id: 'a1', code: 'E4020', name: 'Set Medium-Voltage Switchgear', started: false, done: false },
  { id: 'a2', code: 'D6010', name: 'Data Hall 1 Containment and Cable Tray', started: false, done: false },
  { id: 'a3', code: 'M5030', name: 'Install CRAH Units', started: true, done: false },
  { id: 'a4', code: 'S1010', name: 'Pour Level 2 Slab', started: true, done: true },
]
const ctx = { daysBehind: 0, delaysReported: [], openChangeItems: 0, staleDays: 1, projectType: null }
const obs = (o: Partial<SiteObservation>): SiteObservation => ({
  id: 'c1', text: '', takenAt: '2026-11-17T14:00:00.000Z', takenBy: 'Fay Field', activityCodes: [], location: 'Level 2 · Data Hall 1', status: 'progress', photos: 1, voiceNote: false, ...o,
})

describe('site captures against the schedule', () => {
  it('work seen under way on an activity the schedule shows not started is a mismatch', () => {
    const w = projectWatch([], acts, ctx, [obs({ activityCodes: ['d6010'], text: 'We are in Data Hall 1, containment is not finished.' })])
    expect(w.field.map(f => [f.activity.code, f.reported, f.schedule])).toEqual([['D6010', 'working', 'not started']])
    expect(w.field[0].text).toBe('A site capture in Level 2 · Data Hall 1 shows work under way on D6010 Data Hall 1 Containment and Cable Tray; the schedule shows it not started. Record the actual start.')
    expect(w.field[0]).toMatchObject({ documentId: 'c1', title: 'Site capture by Fay Field, Level 2 · Data Hall 1', citation: '2026-11-17', quote: 'We are in Data Hall 1, containment is not finished.' })
  })

  it('finished on site: a mismatch whether the schedule shows it not started or in progress, and nothing when it is complete', () => {
    const w = projectWatch([], acts, ctx, [obs({ status: 'complete', activityCodes: ['E4020', 'M5030', 'S1010'] })])
    expect(w.field.map(f => [f.activity.code, f.reported, f.schedule])).toEqual([['E4020', 'finished', 'not started'], ['M5030', 'finished', 'in progress']])
  })

  it('seen not started while the schedule has it under way or done is a mismatch the other way', () => {
    const w = projectWatch([], acts, ctx, [obs({ status: 'not_started', activityCodes: ['M5030', 'S1010', 'E4020'], location: '' })])
    expect(w.field.map(f => [f.activity.code, f.reported, f.schedule])).toEqual([['M5030', 'not started', 'in progress'], ['S1010', 'not started', 'complete']])
    expect(w.field[0].text).toBe('A site capture shows M5030 Install CRAH Units not started; the schedule shows it in progress. Check the actual start.')
  })

  it('agreement is not a finding, and a problem is not a progress report', () => {
    const w = projectWatch([], acts, ctx, [obs({ activityCodes: ['M5030'] }), obs({ id: 'c2', status: 'issue', activityCodes: ['E4020'], text: 'Damaged bus duct.' })])
    expect(w.field).toEqual([])
  })

  it('the newest capture of an activity is the one finding it gets, and it outranks a field report', () => {
    const older = obs({ id: 'old', takenAt: '2026-11-16T09:00:00.000Z', status: 'progress', activityCodes: ['D6010'] })
    const newer = obs({ id: 'new', takenAt: '2026-11-17T16:00:00.000Z', status: 'complete', activityCodes: ['D6010'] })
    const report = { documentId: 'd', title: 'Daily', docType: 'daily_report', citation: '', text: 'Crew continued installing D6010 containment in Data Hall 1 today.' }
    const w = projectWatch([report], acts, ctx, [older, newer])
    expect(w.field.map(f => [f.documentId, f.reported])).toEqual([['new', 'finished']])
  })

  it('a capture with no note still has something to quote, and an unknown activity ID is ignored', () => {
    const w = projectWatch([], acts, ctx, [obs({ activityCodes: ['E4020', 'ZZ999'], photos: 0, voiceNote: true })])
    expect(w.field).toHaveLength(1)
    expect(w.field[0].quote).toBe('Voice note.')
  })

  it('without captures the result is what it was', () => {
    expect(projectWatch([], acts, ctx).field).toEqual([])
    expect(projectWatch([], acts, ctx, []).field).toEqual([])
  })
})

describe('site captures in the daily brief', () => {
  const activity = (id: string, code: string, name: string): Activity => ({
    id, scheduleId: 's', activityId: code, name, activityType: 'task', status: 'not_started', wbs: '', calendarId: null,
    originalDuration: 5, remainingDuration: 5, percentComplete: 0, earlyStart: '2026-11-20', earlyFinish: '2026-11-26', lateStart: null, lateFinish: null,
    actualStart: null, actualFinish: null, baselineStart: null, baselineFinish: null, totalFloat: 3, freeFloat: 0, isCritical: false, constraintType: null, constraintDate: null,
  } as unknown as Activity)
  const input = (observations: SiteObservation[]): DailyBriefInput => ({
    today: '2026-11-17', dataDate: '2026-11-16', activities: [activity('a2', 'D6010', 'Data Hall 1 Containment and Cable Tray')], relationships: [], forecastFinish: '2027-03-01',
    required: null, milestoneForecast: '2027-03-01', drivingPathIds: [], register: [], signals: [], changes: [], whatIfs: [],
    logic: { looseEnds: 0, outOfSequence: [], proposals: [] }, missingScope: [], observations,
  })

  it('lists what was recorded since the previous working day, newest first, with its activities', () => {
    const b = buildDailyBrief(input([
      obs({ id: 'tue-am', takenAt: '2026-11-17T09:00:00.000Z', activityCodes: ['D6010', 'NOPE'], text: 'Tray going in.' }),
      obs({ id: 'tue-pm', takenAt: '2026-11-17T15:00:00.000Z', status: 'issue', text: 'Damaged section.' }),
      obs({ id: 'mon', takenAt: '2026-11-16T12:00:00.000Z' }),
      obs({ id: 'last-week', takenAt: '2026-11-12T12:00:00.000Z' }),
    ]))
    expect(b.site).toMatchObject({ since: '2026-11-16', count: 3, problems: 1 })
    expect(b.site.observations.map(o => o.id)).toEqual(['tue-pm', 'tue-am', 'mon'])
    expect(b.site.observations[1].activities).toEqual([{ id: 'a2', code: 'D6010', name: 'Data Hall 1 Containment and Cable Tray' }])
    expect(b.audiences.field).toContain('Recorded on site since 11/16/2026: 3 captures, 1 problem reported.')
  })

  it('a Monday brief covers the weekend', () => {
    const b = buildDailyBrief({ ...input([obs({ id: 'sat', takenAt: '2026-11-14T10:00:00.000Z' })]), today: '2026-11-16' })
    expect(b.site).toMatchObject({ since: '2026-11-13', count: 1, problems: 0 })
  })

  it('with no captures the block is empty and the field brief says nothing about them', () => {
    const b = buildDailyBrief(input([]))
    expect(b.site).toEqual({ since: '2026-11-16', count: 0, problems: 0, observations: [] })
    expect(b.audiences.field.some(l => l.startsWith('Recorded on site'))).toBe(false)
    const none = buildDailyBrief({ ...input([]), observations: undefined })
    expect(none.site.count).toBe(0)
  })
})
