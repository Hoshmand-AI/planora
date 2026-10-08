import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import type { Activity, Relationship } from '@/lib/db'
import { defaultCalendar } from '@/lib/planning/calendar'
import { parseDelayEventFields, runTia, TIA_DISCLAIMER, type DelayEvent, type TiaNetwork } from '@/lib/analysis/tia'
import { exportTiaPdf, exportTiaXlsx, tiaMarkdown, tiaNarrative } from './tia-report'
import { checkAiNarrative, tiaNarrativeWithAi } from './tia-ai'
import type { Provenance } from './provenance'

function act(id: string, name: string, duration: number): Activity {
  return {
    id, scheduleId: 's1', activityId: id, name, wbs: '', duration, remainingDuration: duration, percentComplete: 0,
    earlyStart: null, earlyFinish: null, lateStart: null, lateFinish: null, actualStart: null, actualFinish: null, baselineStart: null, baselineFinish: null,
    totalFloat: 0, freeFloat: 0, isCritical: false, status: 'not_started', activityType: duration === 0 ? 'milestone' : 'task',
    milestoneKind: duration === 0 ? 'finish' : null, calendarId: 'default-5d', constraintType: null, constraintDate: null, category: null, sourceId: null,
  }
}
const rel = (p: string, s: string): Relationship => ({ id: `${p}-${s}`, scheduleId: 's1', predecessorId: p, successorId: s, type: 'FS', lag: 0 })
const net: TiaNetwork = {
  scheduleId: 's1', scheduleName: 'Clinic', version: 'Update 4', activities: [act('A', 'Excavation', 10), act('B', 'Structure', 10), act('SC', 'Substantial Completion', 0)],
  relationships: [rel('A', 'B'), rel('B', 'SC')], calendars: [defaultCalendar()], defaultCalendarId: 'default-5d', projectStart: '2026-01-05', dataDate: '2026-01-05', mustFinishBy: null, progressMode: 'retained',
}
const fragnet = { activities: [{ code: 'F1', name: 'Rock removal', duration: 5 }], relationships: [{ from: 'A', to: 'F1', type: 'FS' as const, lag: 0 }, { from: 'F1', to: 'B', type: 'FS' as const, lag: 0 }] }
const event: DelayEvent = {
  id: 'e1', scheduleId: 's1', title: 'Unforeseen rock', description: 'Rock found at grid C.', responsibility: 'owner', eventStart: '2026-01-12', eventEnd: null, notifiedOn: '2026-01-13',
  evidence: [{ label: 'RFI 042', url: 'https://example.com/rfi-042' }, { label: 'Daily report 01/12/2026', url: null }], fragnet, status: 'analyzed', statusNote: null,
  createdBy: 'u1', updatedBy: 'u1', createdAt: '2026-01-14T00:00:00.000Z', updatedAt: '2026-01-14T00:00:00.000Z',
}
const { result } = runTia(net, { title: event.title, responsibility: event.responsibility, eventStart: event.eventStart, fragnet })
const run = { id: 'r1', createdAt: '2026-01-14T10:00:00.000Z', createdBy: 'u1', createdByName: 'Ana', inputsHash: result.inputsHash, resultHash: result.resultHash, engine: result.engine, result }
const prov: Provenance = { sources: [{ scheduleName: 'Clinic', version: 'Update 4', fileName: 'u4.xer', sha256: 'abc', dataDate: '2026-01-05', progressMode: 'retained' }], release: 'test', settings: [], generatedAt: '2026-01-14T10:00:00.000Z' }

describe('TIA report', () => {
  it('Markdown carries the disclaimer, evidence links, assumptions, impact table and hashes, dates MM/DD/YYYY', () => {
    const md = tiaMarkdown({ event, run, provenance: prov, notes: ['This update is not recorded as accepted.'] })
    expect(md).toContain(TIA_DISCLAIMER)
    expect(md).toContain('<https://example.com/rfi-042>')
    expect(md).toContain('Daily report 01/12/2026')
    expect(md).toMatch(/Responsibility \(label entered by the user, not a determination\) \| Owner/)
    expect(md).toContain('## Milestone impact')
    expect(md).toMatch(/\| SC \| Substantial Completion \| Contract \|.*\| 01\/30\/2026 \| 02\/06\/2026 \| \+7 \| \+5 \|/)
    expect(md).toContain(result.inputsHash)
    expect(md).toContain('## Assumptions')
    expect(md).toContain('not recorded as accepted')
    expect(md).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/)
  })

  it('the template narrative explains the results with activity codes and is deterministic', () => {
    const a = tiaNarrative(result, event), b = tiaNarrative(result, event)
    expect(a).toBe(b)
    expect(a).toMatch(/SC Substantial Completion moves from 01\/30\/2026 to 02\/06\/2026/)
    expect(a).toMatch(/F1 .*on it/)
    expect(a).toMatch(/makes no finding on entitlement/)
  })

  it('an AI narrative is used only when it cites known codes and draws no contractual conclusion', () => {
    expect(checkAiNarrative('Inserting [F1] moves [SC] by 7 calendar days.', result)).toBeNull()
    expect(checkAiNarrative('Inserting [F1] moves [ZZ9] by 7 days.', result)).toMatch(/not in the results/)
    expect(checkAiNarrative('The owner is responsible and the contractor is entitled to 7 days [SC].', result)).toMatch(/conclusion/)
    expect(checkAiNarrative('It moves by 7 days.', result)).toMatch(/cites no activity codes/)
  })

  it('offline, the AI narrative falls back to the template', async () => {
    const n = await tiaNarrativeWithAi(result, event)
    expect(['template', 'ai']).toContain(n.source)
    if (n.source === 'template') expect(n.text).toBe(tiaNarrative(result, event))
  })

  it('Excel and PDF reports build', async () => {
    const buf = await exportTiaXlsx({ event, run, provenance: prov }, prov, null)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf as unknown as ArrayBuffer)
    expect(wb.worksheets.map(w => w.name)).toEqual(['Provenance', 'Summary', 'Milestone impact', 'Fragnet', 'Fragnet logic', 'Driving path before', 'Driving path after', 'Concurrency', 'Evidence', 'Assumptions'])
    expect(wb.getWorksheet('Evidence')!.getRow(2).getCell(2).value).toBe('https://example.com/rfi-042')
    const pdf = await exportTiaPdf(tiaMarkdown({ event, run }), 'Time Impact Analysis', { classification: 'cui', banner: 'CUI', designation: ['Controlled by: Test'] })
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe('%PDF-')
  })

  it('delay event fields: responsibility is one of the labels, links must be http(s)', () => {
    expect(parseDelayEventFields({ title: 'Rock', responsibility: 'owner', evidence: [{ label: 'x', url: 'javascript:alert(1)' }] }, false)).toHaveProperty('error')
    expect(parseDelayEventFields({ title: 'Rock', responsibility: 'excusable' }, false)).toHaveProperty('error')
    expect(parseDelayEventFields({ title: 'Rock', eventStart: '2026-02-01', eventEnd: '2026-01-01' }, false)).toHaveProperty('error')
    const ok = parseDelayEventFields({ title: 'Rock', evidence: [{ label: 'RFI 1', url: 'https://x.test/a' }] }, false)
    expect(ok).toMatchObject({ fields: { title: 'Rock', responsibility: 'unassigned', evidence: [{ label: 'RFI 1', url: 'https://x.test/a' }] } })
    expect(parseDelayEventFields({ status: 'x' }, true)).toEqual({ fields: {} })
  })
})
