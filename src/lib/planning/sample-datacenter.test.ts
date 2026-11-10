import { describe, it, expect } from 'vitest'
import { parseXER } from '@/lib/parsers/xer-parser'
import { completeSchedule } from './complete-schedule'
import { dataCenterSample } from './sample-datacenter'
import { extractSignals } from '@/lib/analysis/correspondence'
import { missingScope } from '@/lib/analysis/daily-brief'

describe('data center sample', () => {
  const s = dataCenterSample('2026-11-10')
  const p = parseXER(s.xer, 'dc')

  it('is a valid P6 file updated today, with logic on every activity', () => {
    expect(p.dataDate?.slice(0, 10)).toBe('2026-11-10')
    expect(p.activities.length).toBeGreaterThan(40)
    expect(p.relationships.length).toBeGreaterThan(50)
    expect(p.warnings.filter(w => /unknown|dangling|missing predecessor/i.test(w))).toEqual([])
    const linked = new Set(p.relationships.flatMap(r => [r.predecessorId, r.successorId]))
    expect(p.activities.every(a => linked.has(a.id))).toBe(true)
  })

  it('recalculates to a ready-for-service date later than the contract date, driven by the switchgear', () => {
    const done = completeSchedule({ activities: p.activities, relationships: p.relationships, calendars: p.calendars, defaultCalendarId: p.defaultCalendarId, projectStart: p.projectStart, dataDate: p.dataDate, mustFinishBy: p.mustFinishBy ?? null, progressMode: 'retained', projectFinish: null })
    const rfs = done.activities.find(a => a.activityId === 'T8010')!
    expect(rfs.earlyFinish!.slice(0, 10) > s.requiredDate).toBe(true)
    const path = done.cpm!.longestPath.map(id => done.activities.find(a => a.id === id)!.activityId)
    expect(path).toContain('P1030')
    expect(path).toContain('E4020')
  })

  it('its correspondence yields signals tied to activities, and it names the data center systems', () => {
    const acts = p.activities.map(a => ({ id: a.id, code: a.activityId, name: a.name, open: a.status !== 'complete' }))
    const sig = extractSignals(s.documents.map((d, i) => ({ documentId: `d${i}`, title: d.title, docType: d.docType, citation: '', text: d.text })), acts)
    expect(sig.some(x => x.kind === 'delay' && x.days === 15 && /switchgear/i.test(x.activity?.name ?? ''))).toBe(true)
    expect(sig.length).toBeGreaterThanOrEqual(4)
    expect(missingScope(p.activities, 'data_center').length).toBeLessThanOrEqual(2)
  })

  it('is the same for the same day and moves with the day', () => {
    expect(dataCenterSample('2026-11-10').xer).toBe(s.xer)
    expect(dataCenterSample('2026-11-14').dataDate).toBe('2026-11-13') // Saturday → the Friday before
  })
})
