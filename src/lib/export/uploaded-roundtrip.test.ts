// Uploaded schedules exported by Planora and imported again must give the same network: the same
// activities, logic, forecast finish, required finish and critical path. (The generated-schedule
// corpus is in roundtrip.test.ts; these are contractor files with progress and constraints.)
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { parseScheduleFile } from '@/lib/parsers'
import type { ParsedSchedule } from '@/lib/parsers/types'
import { completeSchedule } from '@/lib/planning/complete-schedule'
import { analyzeSchedule } from '@/lib/analysis/schedule-analysis'
import { uploadedToGenerated } from '@/lib/planning/uploaded'
import type { Schedule } from '@/lib/db'
import { exportXer } from './xer'
import { exportMspXml } from './msp-xml'
import { leanXer } from '@/lib/parsers/__fixtures__/lean-schedule'

const fx = (f: string) => readFileSync(path.join(__dirname, '../parsers/__fixtures__', f))

function calc(p: ParsedSchedule) {
  const done = completeSchedule({
    activities: p.activities.filter(a => a.activityType !== 'summary'), relationships: p.relationships, calendars: p.calendars, defaultCalendarId: p.defaultCalendarId,
    projectStart: p.projectStart, projectFinish: p.projectFinish, dataDate: p.dataDate, mustFinishBy: p.mustFinishBy ?? null,
  })
  const critical = done.activities.filter(a => a.isCritical).map(a => a.activityId).sort()
  return { done, critical }
}

describe.each([
  ['sample-msp.xml', () => fx('sample-msp.xml')],
  ['sample.xer', () => fx('sample.xer')],
  ['lean P6 network (330 activities)', () => Buffer.from(leanXer())],
] as const)('uploaded %s → export → import', (name, file) => {
  it('MS Project XML and P6 XER keep the finish, the (absent) required finish and the critical path', async () => {
    const p = await parseScheduleFile(name.endsWith('.xml') ? 'u.xml' : 'u.xer', file(), 's')
    const { done, critical } = calc(p)
    const an = analyzeSchedule({ activities: done.activities, links: p.relationships.map(r => ({ from: r.predecessorId, to: r.successorId })), cpm: done.cpm, reportedFinish: null, mustFinishBy: p.mustFinishBy ?? null })
    const s = { id: 's', name: 'RT', projectStart: done.projectStart, dataDate: p.dataDate, calendars: p.calendars, defaultCalendarId: p.defaultCalendarId, analysis: an } as unknown as Schedule
    const g = uploadedToGenerated(s, done.activities, p.relationships, done.cpm, an)
    expect(critical.length).toBeGreaterThan(0)
    for (const [ext, text] of [['xml', exportMspXml(g, 'RT')], ['xer', exportXer(g, 'RT')]] as const) {
      const q = await parseScheduleFile(`rt.${ext}`, Buffer.from(text), 'r')
      // A milestone's own finish constraint is not a project required finish: a Deadline written from it
      // came back as Must Finish By, gave every activity float and emptied the critical path.
      expect(q.mustFinishBy ?? null, ext).toBe(p.mustFinishBy ?? null)
      const again = calc(q)
      expect(again.done.cpm!.projectFinish, ext).toBe(done.cpm!.projectFinish)
      expect(again.critical, ext).toEqual(critical)
    }
  })
})
