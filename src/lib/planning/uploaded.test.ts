import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { Schedule } from '@/lib/db'
import { parseXER } from '@/lib/parsers/xer-parser'
import { completeSchedule } from '@/lib/planning/complete-schedule'
import { analyzeSchedule } from '@/lib/analysis/schedule-analysis'
import { uploadedToGenerated } from '@/lib/planning/uploaded'
import { exportXer } from '@/lib/export/xer'
import { exportMspXml } from '@/lib/export/msp-xml'
import { runSra } from '@/lib/planning/sra'

const xer = fs.readFileSync(path.join(__dirname, '../parsers/__fixtures__/sample.xer'), 'latin1')

function load(text: string, id: string) {
  const p = parseXER(text, id)
  const done = completeSchedule({ activities: p.activities, relationships: p.relationships, calendars: p.calendars, defaultCalendarId: p.defaultCalendarId, projectStart: p.projectStart, projectFinish: p.projectFinish, dataDate: p.dataDate, mustFinishBy: p.mustFinishBy })
  const analysis = analyzeSchedule({ activities: done.activities, links: p.relationships.map(r => ({ from: r.predecessorId, to: r.successorId })), cpm: done.cpm, reportedFinish: p.projectFinish, mustFinishBy: p.mustFinishBy ?? null })
  const schedule = { id, name: p.projectName, version: 'Update 1', fileName: 'sample.xer', uploadedAt: '2026-10-01', projectStart: done.projectStart, dataDate: p.dataDate, calendars: p.calendars, defaultCalendarId: p.defaultCalendarId } as unknown as Schedule
  return { p, done, analysis, schedule }
}

describe('uploaded schedules are first-class', () => {
  const a = load(xer, 's1')
  const g = uploadedToGenerated(a.schedule, a.done.activities, a.p.relationships, a.done.cpm, a.analysis)

  it('round-trips through XER with the same activity IDs, project name, progress and finish', () => {
    const out = exportXer(g, a.p.projectName, { now: new Date('2026-10-06T00:00:00Z') })
    const b = load(out, 's2')
    expect(b.p.projectName).toBe(a.p.projectName)
    const codes = (x: typeof a) => x.done.activities.filter(t => t.activityType !== 'summary' && t.activityType !== 'loe').map(t => t.activityId).sort()
    expect(codes(b)).toEqual(codes(a))
    expect(b.analysis.forecastFinish).toBe(a.analysis.forecastFinish)
    const status = (x: typeof a) => Object.fromEntries(x.done.activities.map(t => [t.activityId, t.status]))
    expect(status(b)).toMatchObject(Object.fromEntries(Object.entries(status(a)).filter(([k]) => codes(a).includes(k))))
  })

  it('runs a Monte Carlo risk analysis on the uploaded network', () => {
    const r = runSra(g, {}, null, { iterations: 200, seed: 7 })
    expect(r.iterations).toBe(200)
    expect(r.percentiles.p80 >= r.percentiles.p50).toBe(true)
  })

  it('exports an uploaded schedule to MS Project XML when the upload time is a Date (round-2 finding: HTTP 500)', () => {
    const fromDb = { ...a.schedule, uploadedAt: new Date('2026-10-01T12:00:00Z') } as unknown as Schedule
    const xml = exportMspXml(uploadedToGenerated(fromDb, a.done.activities, a.p.relationships, a.done.cpm, a.analysis), a.p.projectName)
    expect(xml).toMatch(/<CreationDate>2026-10-01T00:00:00<\/CreationDate>/)
  })
})
