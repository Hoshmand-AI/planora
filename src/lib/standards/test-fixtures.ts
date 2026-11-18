// Schedules for the rule-pack tests (usace.test.ts, pmi.test.ts). Not used by the application.

import type { AnalyzableActivity, CpmLink } from '@/lib/planning/types'
import { defaultCalendar } from '@/lib/planning/calendar'
import type { StandardsInput } from './types'

const cal = defaultCalendar()
export const task = (id: string, duration = 5, extra: Partial<AnalyzableActivity> = {}): AnalyzableActivity =>
  ({ id, code: id, name: `Task ${id}`, type: 'task', duration, baselineStart: '2026-03-02', baselineFinish: '2026-12-31', ...extra })
export const ms = (id: string, extra: Partial<AnalyzableActivity> = {}): AnalyzableActivity =>
  ({ id, code: id, name: `Milestone ${id}`, type: 'milestone', duration: 0, baselineStart: '2026-03-02', baselineFinish: '2026-12-31', ...extra })
export const link = (from: string, to: string, type: CpmLink['type'] = 'FS', lag = 0): CpmLink => ({ from, to, type, lag })

/** A clean chain S → A1..An → F, not started, with WBS and a baseline. */
export function clean(n = 10): StandardsInput {
  const acts: AnalyzableActivity[] = [ms('S', { milestoneKind: 'start' })]
  const links: CpmLink[] = []
  let prev = 'S'
  for (let i = 1; i <= n; i++) { acts.push(task(`A${i}`)); links.push(link(prev, `A${i}`)); prev = `A${i}` }
  acts.push(ms('F', { milestoneKind: 'finish' }))
  links.push(link(prev, 'F'))
  return {
    subject: { kind: 'schedule', id: 'sch1', name: 'Test', version: 'Update 1' },
    schedule: { projectStart: '2026-03-02', dataDate: '2026-03-02', activities: acts, links, calendars: [cal], defaultCalendarId: cal.id },
    wbs: Object.fromEntries(acts.map(a => [a.id, '1.1 Work'])),
    baseline: { source: 'baseline_upload', label: 'Baseline' },
    riskAnalysis: null,
  }
}

/** The clean chain with progress in sequence: S and A1 complete, A2 in progress, data date 03/16/2026. */
export function progressed(): StandardsInput {
  const inp = clean()
  const a = inp.schedule.activities
  a[0] = { ...a[0], actualStart: '2026-03-02', actualFinish: '2026-03-02', status: 'complete' }
  a[1] = { ...a[1], actualStart: '2026-03-02', actualFinish: '2026-03-06', status: 'complete', percentComplete: 100 }
  a[2] = { ...a[2], actualStart: '2026-03-09', status: 'in_progress', percentComplete: 50, remaining: 3 }
  inp.schedule.dataDate = '2026-03-16'
  return inp
}

export const mutate = (fn: (i: StandardsInput) => void, base = clean()) => { fn(base); return base }
export const actOf = (i: StandardsInput, id: string) => i.schedule.activities.find(a => a.id === id)!
/** Every activity complete: nothing open is left to test. */
export const allComplete = () => mutate(i => { i.schedule.activities = i.schedule.activities.map(a => ({ ...a, status: 'complete' as const, actualStart: '2026-03-02', actualFinish: '2026-03-06' })) })
/** The clean chain with no relationships at all. */
export const noLinks = () => mutate(i => { i.schedule.links = [] })
