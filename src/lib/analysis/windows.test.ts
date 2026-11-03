import { describe, it, expect } from 'vitest'
import type { Activity, Relationship } from '@/lib/db'
import { makeActivity } from '@/lib/parsers/types'
import type { WorkCalendar } from '@/lib/planning/types'
import { completeSchedule } from '@/lib/planning/complete-schedule'
import { analyzeSchedule } from '@/lib/analysis/schedule-analysis'
import { analyzeWindow, analyzeWindows, windowsMarkdown, trendMarkdown, type WindowUpdate } from '@/lib/analysis/windows'
import { fmtDate } from '@/lib/format'

// Calendar ids differ between updates (P6 renumbers them); they are matched by name.
const cal5 = (id: string): WorkCalendar => ({ id, name: 'Standard 5-Day', workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidays: [] })

function update(id: string, version: string, dataDate: string, calId: string, acts: Partial<Activity>[], links: [string, string][]): WindowUpdate {
  const activities = acts.map(f => makeActivity(id, { calendarId: calId, name: f.activityId, ...f }))
  const byCode = new Map(activities.map(a => [a.activityId, a]))
  const relationships: Relationship[] = links.map(([p, s], i) => ({ id: `${id}r${i}`, scheduleId: id, predecessorId: byCode.get(p)!.id, successorId: byCode.get(s)!.id, type: 'FS', lag: 0 }))
  const calendars = [cal5(calId)]
  const done = completeSchedule({ activities, relationships, calendars, defaultCalendarId: calId, projectStart: '2026-03-02', projectFinish: null, dataDate })
  const analysis = analyzeSchedule({ activities: done.activities, links: relationships.map(r => ({ from: r.predecessorId, to: r.successorId })), cpm: done.cpm, reportedFinish: null, mustFinishBy: null, dataDate })
  return { schedule: { id, name: 'Riverside', version, dataDate, projectStart: '2026-03-02', calendars, defaultCalendarId: calId }, activities: done.activities, relationships, analysis }
}

const FIN = { activityId: 'F900', name: 'Substantial Completion', activityType: 'milestone' as const, duration: 0 }

describe('windows analysis (half-step attribution)', () => {
  // Update 1: A(5) -> B(10) -> F, nothing started.
  const u1 = update('U1', 'Update 1', '2026-03-02', '10', [
    { activityId: 'A100', duration: 5 }, { activityId: 'B200', duration: 10 }, FIN,
  ], [['A100', 'B200'], ['B200', 'F900']])
  // Update 2, one week later: A started on time but has 3 days left (2 days late: progress),
  // B's original duration grew 10 -> 12 (revision: durations), C300 (4d) was added before F (added).
  const u2 = update('U2', 'Update 2', '2026-03-09', '77', [
    { activityId: 'A100', duration: 5, actualStart: '2026-03-02', status: 'in_progress', remainingDuration: 3, percentComplete: 40 },
    { activityId: 'B200', duration: 12 }, { activityId: 'C300', duration: 4 }, FIN,
  ], [['A100', 'B200'], ['B200', 'C300'], ['C300', 'F900']])

  const w = analyzeWindow(u1, u2)

  it('measures the finish milestone in both updates', () => {
    expect(w.finishCode).toBe('F900')
    // A 03/02-03/06, B 03/09-03/20.
    expect(w.before.finish).toBe('2026-03-20')
    // A finishes 03/11 (3 days left from 03/09), B 12 days to 03/27, C 4 days: F on 04/02.
    expect(w.after.finish).toBe('2026-04-02')
    expect(w.movement).toBe(13)
  })
  it('splits the movement into progress, added/deleted and revisions that add up to it', () => {
    const a = w.attribution!
    // Half-step: update 1's network with update 2's progress: A to 03/11, B (10d) to 03/25 = +5.
    expect(w.halfStepFinish).toBe('2026-03-25')
    expect(a.progress).toBe(5)
    // C300 (4d) added after B: 03/25 -> 03/31 = +6; B 10 -> 12 days: 03/31 -> 04/02 = +2.
    expect(a.addedDeleted).toBe(6)
    expect(a.revisions.durations).toBe(2)
    expect(a.revisions.logic).toBe(0)
    expect(a.revisions.constraints).toBe(0)
    expect(a.revisions.calendars).toBe(0) // renumbered ids, same calendar by name
    expect(a.progress + a.addedDeleted + a.revisions.total).toBe(w.movement)
    expect(w.counts).toMatchObject({ added: 1, deleted: 0, durationsChanged: 1, constraintsChanged: 0, calendarsChanged: 0 })
  })
  it('reports the driving path ends and the half-step finish', () => {
    expect(w.drivingPath.after.start?.code).toBe('A100')
    expect(w.drivingPath.after.end?.code).toBe('F900')
    expect(w.halfStepFinish).toBeTruthy()
  })
  it('attributes a new constraint to revisions, not progress, when progress is on plan', () => {
    // Update 3: progress exactly as forecast; C300 gets an SNET 04/06 (constraint): F 04/02 -> 04/09.
    const u3 = update('U3', 'Update 3', '2026-03-16', '77', [
      { activityId: 'A100', duration: 5, actualStart: '2026-03-02', actualFinish: '2026-03-11', status: 'complete', remainingDuration: 0, percentComplete: 100 },
      { activityId: 'B200', duration: 12, actualStart: '2026-03-12', status: 'in_progress', remainingDuration: 10, percentComplete: 20 },
      { activityId: 'C300', duration: 4, constraintType: 'SNET', constraintDate: '2026-04-06' }, FIN,
    ], [['A100', 'B200'], ['B200', 'C300'], ['C300', 'F900']])
    const w2 = analyzeWindow(u2, u3, 2)
    expect(w2.attribution).toMatchObject({ progress: 0, addedDeleted: 0, revisions: { logic: 0, durations: 0, constraints: 7, calendars: 0, total: 7 } })
    expect(w2.attribution!.progress + w2.attribution!.addedDeleted + w2.attribution!.revisions.total).toBe(w2.movement)
    const all = analyzeWindows([u1, u2, u3])
    expect(all.windows.map(x => x.window)).toEqual([1, 2])
    expect(all.trend).toHaveLength(3)
    expect(all.trend[2].finishFloat).not.toBeNull()
    const md = windowsMarkdown(all, fmtDate).join('\n')
    expect(md).toMatch(/\| 1 \| Update 1 \(03\/02\/2026\) \| Update 2 \(03\/09\/2026\) \| 03\/20\/2026 → 04\/02\/2026 \| \+13 \| \+13 \| \+5 \| \+6 \| 0 \| \+2 \|/)
    expect(trendMarkdown(all.trend, fmtDate).join('\n')).toMatch(/Update 3 \| 03\/16\/2026/)
  })
  it('credits a logic change (resequencing) to the logic revision', () => {
    // Update 2b: same progress and activities as update 2, but C300 now runs in parallel with B (A -> C).
    const u2b = update('U2b', 'Update 2b', '2026-03-16', '77', [
      { activityId: 'A100', duration: 5, actualStart: '2026-03-02', actualFinish: '2026-03-11', status: 'complete', remainingDuration: 0, percentComplete: 100 },
      { activityId: 'B200', duration: 12, actualStart: '2026-03-12', status: 'in_progress', remainingDuration: 10, percentComplete: 20 },
      { activityId: 'C300', duration: 4 }, FIN,
    ], [['A100', 'B200'], ['A100', 'C300'], ['B200', 'F900'], ['C300', 'F900']])
    const w3 = analyzeWindow(u2, u2b, 2)
    expect(w3.attribution!.revisions.logic).toBeLessThan(0)
    expect(w3.attribution!.progress).toBe(0)
    expect(w3.movement).toBe(w3.attribution!.progress + w3.attribution!.addedDeleted + w3.attribution!.revisions.total)
  })
})

describe('windows analysis: scope, drivers, hidden delay and reissues', () => {
  const sum = (w: ReturnType<typeof analyzeWindow>) => w.attribution!.progress + w.attribution!.addedDeleted + w.attribution!.revisions.total

  it('does not offset added/deleted against logic when a deleted activity\'s link is replaced', () => {
    // Update 1: A -> D500 (60d) -> F, and A -> B200 (70d) as an open end.
    const e = update('R1', 'Update 1', '2026-03-02', '10', [
      { activityId: 'A100', duration: 5 }, { activityId: 'D500', duration: 60 }, { activityId: 'B200', duration: 70 }, FIN,
    ], [['A100', 'D500'], ['D500', 'F900'], ['A100', 'B200']])
    // Update 2: A finished as planned; D500 deleted and replaced by the link B200 -> F900.
    const l = update('R2', 'Update 2', '2026-03-09', '10', [
      { activityId: 'A100', duration: 5, actualStart: '2026-03-02', actualFinish: '2026-03-06', status: 'complete', remainingDuration: 0, percentComplete: 100 },
      { activityId: 'B200', duration: 70 }, FIN,
    ], [['A100', 'B200'], ['B200', 'F900']])
    const w = analyzeWindow(e, l)
    expect(w.movement).toBe(14) // 10 more work days
    expect(w.attribution).toMatchObject({ progress: 0, addedDeleted: 14, revisions: { logic: 0, total: 0 }, method: 'symmetric' })
    for (const x of [w.attribution!.progress, w.attribution!.addedDeleted, w.attribution!.revisions.logic]) expect(Math.abs(x)).toBeLessThanOrEqual(Math.abs(w.movement!))
    expect(sum(w)).toBe(w.movement)
    expect(w.notes.join(' ')).toMatch(/1 relationship replacing added or deleted activities is counted with added\/deleted activities/)
  })

  it('names the driving activities and their changes, adding up to the movement', () => {
    const u1 = update('D1', 'Update 1', '2026-03-02', '10', [{ activityId: 'A100', duration: 5 }, { activityId: 'B200', duration: 10 }, FIN], [['A100', 'B200'], ['B200', 'F900']])
    const u2 = update('D2', 'Update 2', '2026-03-09', '10', [
      { activityId: 'A100', duration: 5, actualStart: '2026-03-02', status: 'in_progress', remainingDuration: 3, percentComplete: 40 },
      { activityId: 'B200', duration: 12 }, { activityId: 'C300', duration: 4 }, FIN,
    ], [['A100', 'B200'], ['B200', 'C300'], ['C300', 'F900']])
    const w = analyzeWindow(u1, u2)
    expect(w.drivers.map(d => [d.code, d.days, d.workDays, d.changes.map(c => c.kind)])).toEqual([
      ['A100', 5, 3, ['progress']], ['B200', 2, 2, ['duration']], ['C300', 6, 4, ['added']],
    ])
    expect(w.drivers.reduce((t, d) => t + d.days, 0) + w.unattributed).toBe(w.movement)
    expect(w.logicPath.before).toEqual(['A100', 'B200', 'F900'])
    expect(w.logicPath.after).toEqual(['A100', 'B200', 'C300', 'F900'])
  })

  it('reports delay hidden by a Mandatory Finish and never shows 0 movement for a masked slip', () => {
    // A1190 carries an MFO on its planned finish; in update 2 A100 overruns by 8 work days.
    const mfo = { activityId: 'A1190', duration: 10, constraintType: 'MFO' as const, constraintDate: '2026-03-20' }
    const u1 = update('M1', 'Update 1', '2026-03-02', '10', [{ activityId: 'A100', duration: 5 }, mfo, FIN], [['A100', 'A1190'], ['A1190', 'F900']])
    const u2 = update('M2', 'Update 2', '2026-03-09', '10', [
      { activityId: 'A100', duration: 5, actualStart: '2026-03-02', status: 'in_progress', remainingDuration: 8, percentComplete: 10 }, mfo, FIN,
    ], [['A100', 'A1190'], ['A1190', 'F900']])
    const w = analyzeWindow(u1, u2)
    expect(w.asScheduled.movement).toBe(0)
    expect(w.movement).toBe(12) // logic: A100 to 03/18, A1190 to 04/01
    expect(w.attribution!.progress).toBe(12)
    expect(w.hidden).toEqual([expect.objectContaining({ code: 'A1190', type: 'MFO', days: 8, daysBefore: 0 })])
    expect(w.hidden[0].text).toMatch(/^8 wd hidden by MFO on A1190/)
    expect(w.drivers).toEqual([expect.objectContaining({ code: 'A100', days: 12, hiddenBy: 'A1190' })])
    expect(w.notes.join(' ')).toMatch(/As scheduled \(mandatory constraints honored\) the finish moved 0 calendar days; the logic-driven finish moved 12/)
  })

  it('treats a same-data-date reissue as superseding the earlier upload', () => {
    const acts = [{ activityId: 'A100', duration: 5 }, { activityId: 'B200', duration: 10 }, FIN]
    const links: [string, string][] = [['A100', 'B200'], ['B200', 'F900']]
    const a = update('S1', 'Update 1', '2026-03-02', '10', acts, links)
    const b = update('S2', 'Update 2', '2026-03-09', '10', acts, links)
    const b2 = update('S2r', 'Update 2 rev 1', '2026-03-09', '10', acts, links)
    const c = update('S3', 'Update 3', '2026-03-16', '10', acts, links)
    const w = analyzeWindows([a, b, b2, c])
    expect(w.windows.map(x => `${x.before.version} → ${x.after.version}`)).toEqual(['Update 1 → Update 2 rev 1', 'Update 2 rev 1 → Update 3'])
    expect(w.series.map(p => [p.dataDate, p.uploads])).toEqual([['2026-03-02', 1], ['2026-03-09', 2], ['2026-03-16', 1]])
    expect(w.series[1].superseded).toEqual([{ id: 'S2', version: 'Update 2' }])
    expect(w.notes.join(' ')).toMatch(/2 uploads have the data date 03\/09\/2026; Update 2 is superseded by the reissue Update 2 rev 1/)
    expect(w.trend).toHaveLength(3)
    const all = analyzeWindows([a, b, b2, c], { includeReissues: true })
    expect(all.windows).toHaveLength(3)
    expect(all.windows[1].notes.join(' ')).toMatch(/reissue \(a revision of the same period\)/)
  })
})
