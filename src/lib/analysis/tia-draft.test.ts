import { describe, expect, it } from 'vitest'
import type { Activity, Relationship } from '@/lib/db'
import { defaultCalendar } from '@/lib/planning/calendar'
import type { RetrievedChunk } from '@/lib/rag/types'
import { citationFor } from '@/lib/rag/citations'
import { finalizeModelDraft, parseModelDraft, pickListForModel, relatedActivities, rulesDraft, type ModelDraft } from './tia-draft'
import type { TiaNetwork } from './tia'

const DD = '2026-01-05'
function act(id: string, name: string, duration: number, extra: Partial<Activity> = {}): Activity {
  return {
    id, scheduleId: 's1', activityId: id, name, wbs: '', duration, remainingDuration: duration, percentComplete: 0,
    earlyStart: null, earlyFinish: null, lateStart: null, lateFinish: null, actualStart: null, actualFinish: null, baselineStart: null, baselineFinish: null,
    totalFloat: 0, freeFloat: 0, isCritical: false, status: 'not_started', activityType: duration === 0 ? 'milestone' : 'task',
    milestoneKind: duration === 0 ? 'finish' : null, calendarId: 'default-5d', constraintType: null, constraintDate: null, category: null, sourceId: null, ...extra,
  }
}
const rel = (p: string, s: string): Relationship => ({ id: `${p}-${s}`, scheduleId: 's1', predecessorId: p, successorId: s, type: 'FS', lag: 0 })
const net: TiaNetwork = {
  scheduleId: 's1', scheduleName: 'Test project', version: 'Update 3',
  activities: [
    act('NTP', 'Notice to Proceed', 0, { milestoneKind: 'start', status: 'complete', actualStart: '2025-12-15', actualFinish: '2025-12-15' }),
    act('A1010', 'Excavation', 10), act('A1020', 'Spread Footings', 10), act('A1030', 'Structural Steel Erection', 10), act('SC', 'Substantial Completion', 0),
  ],
  relationships: [rel('NTP', 'A1010'), rel('A1010', 'A1020'), rel('A1020', 'A1030'), rel('A1030', 'SC')],
  calendars: [defaultCalendar()], defaultCalendarId: 'default-5d', projectStart: '2025-12-15', dataDate: DD, mustFinishBy: null, progressMode: 'retained',
}

function chunk(text: string, page: number, ordinal = page - 1): RetrievedChunk {
  const base = { chunkId: `c${page}`, documentId: 'd1', ordinal, page, pageEnd: null, section: null, heading: null, title: 'Change Order 004' }
  return { ...base, text, flagged: false, flagReasons: [], docType: 'change_order', trust: 'unreviewed', scope: 'project', classification: null, rank: 0, tier: 4, citation: citationFor(base) }
}
const co = [
  chunk('Change Order 004. The footing design at grid C is revised. The Engineer of Record shall issue revised footing drawings within 10 working days. The Contractor shall re-fabricate rebar for the revised footings, estimated at 5 days.', 1),
  chunk('Work on the spread footings at grid C is suspended until the revised drawings are received.', 2),
]
const cite1 = co[0].citation

const proposal = (over: Partial<ModelDraft> = {}): ModelDraft => ({
  title: 'CO-004 footing redesign at grid C', summary: 'Revised footing design and rebar re-fabrication before footings resume.', eventStart: '2026-01-07',
  activities: [
    { ref: 'N1', name: 'Issue revised footing drawings', durationDays: 10, basis: 'stated', quote: 'The Engineer of Record shall issue revised footing drawings within 10 working days.', citation: cite1 },
    { ref: 'N2', name: 'Re-fabricate rebar for revised footings', durationDays: 5, basis: 'estimated', quote: 'The Contractor shall re-fabricate rebar for the revised footings, estimated at 5 days.', citation: cite1 },
  ],
  ties: [
    { from: 'A1010', to: 'N1', type: 'FS', lagDays: 0, reason: 'Redesign follows excavation' },
    { from: 'N1', to: 'N2', type: 'FS', lagDays: 0, reason: 'Rebar after drawings' },
    { from: 'N2', to: 'A1020', type: 'FS', lagDays: 0, reason: 'Footings resume after rebar' },
  ],
  ...over,
})

describe('TIA fragnet draft from a change document', () => {
  it('keeps activities whose quote is in the cited passage, gives them new codes, and validates the fragnet', () => {
    const d = finalizeModelDraft(proposal(), co, net, 'Change Order 004')
    expect(d.method).toBe('model')
    expect(d.fragnet.activities.map(a => [a.code, a.duration])).toEqual([['CO-01', 10], ['CO-02', 5]])
    expect(d.fragnet.relationships).toEqual([
      { from: 'A1010', to: 'CO-01', type: 'FS', lag: 0 }, { from: 'CO-01', to: 'CO-02', type: 'FS', lag: 0 }, { from: 'CO-02', to: 'A1020', type: 'FS', lag: 0 },
    ])
    expect(d.sources[0]).toMatchObject({ code: 'CO-01', basis: 'stated', citation: cite1 })
    expect(d.evidence).toEqual([{ label: `Change Order 004 ${cite1}` }])
    expect(d.validation.errors).toEqual([])
    expect(d.warnings).toEqual([])
  })

  it('drops an activity whose quote is invented, and one that cites a passage that was not given', () => {
    const d = finalizeModelDraft(proposal({ activities: [
      { ref: 'N1', name: 'Owner approval of redesign', durationDays: 15, basis: 'stated', quote: 'The Owner shall approve the redesign within 15 days.', citation: cite1 },
      { ref: 'N2', name: 'Survey', durationDays: 3, basis: 'estimated', quote: 'Work on the spread footings at grid C is suspended', citation: '[Some Other Document p.9]' },
      { ref: 'N3', name: 'Re-fabricate rebar', durationDays: 5, basis: 'estimated', quote: 're-fabricate rebar for the revised footings', citation: cite1 },
    ], ties: [{ from: 'A1010', to: 'N3', type: 'FS', lagDays: 0, reason: '' }, { from: 'N3', to: 'A1020', type: 'FS', lagDays: 0, reason: '' }] }), co, net, 'Change Order 004')
    expect(d.fragnet.activities.map(a => a.name)).toEqual(['Re-fabricate rebar'])
    expect(d.warnings.some(w => w.includes('Owner approval') && w.includes('quote'))).toBe(true)
    expect(d.warnings.some(w => w.includes('Survey') && w.includes('citation'))).toBe(true)
    expect(d.fragnet.activities[0].code).toBe('CO-01')
  })

  it('never lets a tie invent an activity code or link two existing activities', () => {
    const d = finalizeModelDraft(proposal({ ties: [
      { from: 'A9999', to: 'N1', type: 'FS', lagDays: 0, reason: '' },
      { from: 'A1010', to: 'A1020', type: 'FS', lagDays: 0, reason: '' },
      { from: 'A1010', to: 'N1', type: 'FS', lagDays: 0, reason: '' },
      { from: 'N1', to: 'N2', type: 'FS', lagDays: 0, reason: '' },
      { from: 'N2', to: 'A1020', type: 'FS', lagDays: 0, reason: '' },
    ] }), co, net, 'Change Order 004')
    expect(d.fragnet.relationships).toHaveLength(3)
    expect(d.warnings.some(w => w.includes('A9999'))).toBe(true)
    expect(d.warnings.some(w => w.includes('links two existing activities'))).toBe(true)
  })

  it('reports validation errors (e.g. no tie out) instead of hiding them', () => {
    const d = finalizeModelDraft(proposal({ ties: [{ from: 'A1010', to: 'N1', type: 'FS', lagDays: 0, reason: '' }, { from: 'N1', to: 'N2', type: 'FS', lagDays: 0, reason: '' }] }), co, net, 'Change Order 004')
    expect(d.validation.errors.length).toBeGreaterThan(0)
  })

  it('new codes never collide with codes already in the update', () => {
    const withCo = { ...net, activities: [...net.activities, act('CO-01', 'Earlier change', 3)] }
    const d = finalizeModelDraft(proposal(), co, withCo, 'Change Order 004')
    expect(d.fragnet.activities.map(a => a.code)).toEqual(['CO-02', 'CO-03'])
  })

  it('rejects malformed model output so the model can correct it', () => {
    expect(() => parseModelDraft({ activities: [] })).toThrow(/title/)
    expect(() => parseModelDraft({ title: 'x', activities: [{ ref: 'N1', name: 'a', durationDays: 'ten', quote: 'q', citation: 'c' }] })).toThrow(/durationDays/)
    expect(() => parseModelDraft({ title: 'x', activities: [{ ref: 'N1', name: 'a', durationDays: 1, quote: '', citation: '' }] })).toThrow(/quote/)
    expect(() => parseModelDraft({ title: 'x', activities: [], ties: [{ from: 'a', to: 'b', type: 'XX' }] })).toThrow(/type/)
    expect(parseModelDraft({ title: 'x', activities: [], eventStart: 'soon' }).eventStart).toBeNull()
  })

  it('without a model: sizes one activity from a stated number of days and ties it to the activity the document names', () => {
    const d = rulesDraft(co, net, 'Change Order 004', 'No AI model is configured (offline mode).')
    expect(d.method).toBe('rules')
    expect(d.fragnet.activities).toEqual([{ code: 'CO-01', name: 'Change: Change Order 004', duration: 10, calendarId: null, startNoEarlierThan: null }])
    expect(d.fragnet.relationships).toEqual([{ from: 'A1010', to: 'CO-01', type: 'FS', lag: 0 }, { from: 'CO-01', to: 'A1020', type: 'FS', lag: 0 }])
    expect(d.validation.errors).toEqual([])
    expect(d.sources[0].citation).toBe(cite1)
    expect(d.related[0].code).toBe('A1020')
    expect(d.reason).toMatch(/offline/)
  })

  it('without a model and no stated days: an empty draft that says what to do', () => {
    const d = rulesDraft([chunk('Revise the paint colour in the lobby.', 1)], net, 'RFI 12', 'offline')
    expect(d.fragnet.activities).toEqual([])
    expect(d.warnings.join(' ')).toMatch(/No duration stated/)
  })

  it('gives the model the activities the document names first', () => {
    expect(relatedActivities(net.activities, co.map(c => c.text).join(' '))[0].code).toBe('A1020')
    expect(pickListForModel(net.activities, co.map(c => c.text).join(' ')).split('\n')[0]).toMatch(/^A1020 \| Spread Footings/)
  })
})
