import { describe, expect, it } from 'vitest'
import {
  buildMaster, dataStatus, lookAhead, parseDictionary, parseMapping, parseOwnerForecasts, parsePartyFields, partyStatus, readDate, reportTable, suggestMapping,
  EXPIRED_AFTER_DAYS, STALE_AFTER_DAYS, type ActivityDates, type DictMilestone, type PartyItem, type ProjectInput,
} from './master-schedule'

const DICT: DictMilestone[] = [
  { key: 'ds', name: 'Design start', phase: 'Design' },
  { key: 'dc', name: 'Design complete', phase: 'Design' },
  { key: 'ntp', name: 'Notice to proceed', phase: 'Construction' },
  { key: 'sc', name: 'Substantial completion', phase: 'Construction' },
]
const act = (code: string, o: Partial<ActivityDates> = {}): ActivityDates => ({
  code, name: code, type: 'milestone', milestoneKind: null, earlyStart: null, earlyFinish: null, actualStart: null, actualFinish: null,
  baselineStart: null, baselineFinish: null, totalFloat: 0, isCritical: false, ...o,
})
const up = (id: string, dataDate: string | null, version = id) => ({ id, version, dataDate, uploadedAt: `${dataDate ?? '2026-01-01'}T12:00:00.000Z` })
const project = (o: Partial<ProjectInput> = {}): ProjectInput => ({
  id: 'p1', name: 'School A', sector: 'Education', location: null, contractor: 'Builder', mapping: {}, ownerForecasts: {},
  latest: up('u2', '2026-11-01'), previous: null, baseline: null, latestRejected: false, latestActs: {}, previousActs: {}, baselineActs: {}, ...o,
})
const master = (projects: ProjectInput[], parties: PartyItem[] = [], asOf = '2026-11-18') => buildMaster({ dictionary: DICT, projects, parties, asOf })

describe('reading a contractor date', () => {
  it('takes the actual when there is one and says so', () => {
    expect(readDate(act('A', { earlyFinish: '2026-03-01T17:00:00', actualFinish: '2026-03-04T17:00:00' }), 'finish')).toEqual({ date: '2026-03-04', actual: true })
    expect(readDate(act('A', { earlyFinish: '2026-03-01' }), 'finish')).toEqual({ date: '2026-03-01', actual: false })
  })
  it('reads the start or the finish of a task as asked', () => {
    const a = act('T', { type: 'task', earlyStart: '2026-01-05', earlyFinish: '2026-02-20' })
    expect(readDate(a, 'start').date).toBe('2026-01-05')
    expect(readDate(a, 'finish').date).toBe('2026-02-20')
  })
  it('answers for a milestone that carries only its other date', () => {
    expect(readDate(act('M', { earlyStart: '2026-05-01' }), 'finish').date).toBe('2026-05-01')
    expect(readDate(act('T', { type: 'task', earlyStart: '2026-05-01' }), 'finish').date).toBeNull()
  })
})

describe('how current the data is', () => {
  it('counts from the data date of the newest upload', () => {
    expect(dataStatus(up('u', '2026-11-01'), false, '2026-11-18')).toEqual({ status: 'current', ageDays: 17 })
    expect(dataStatus(up('u', '2026-10-01'), false, '2026-11-18').status).toBe('stale')
    expect(dataStatus(up('u', '2026-08-01'), false, '2026-11-18').status).toBe('expired')
    expect(dataStatus(null, false, '2026-11-18')).toEqual({ status: 'none', ageDays: null })
  })
  it('sits exactly on the limits', () => {
    const on = (n: number) => dataStatus(up('u', new Date(Date.parse('2026-11-18T00:00:00Z') - n * 86_400_000).toISOString().slice(0, 10)), false, '2026-11-18').status
    expect(on(STALE_AFTER_DAYS)).toBe('current')
    expect(on(STALE_AFTER_DAYS + 1)).toBe('stale')
    expect(on(EXPIRED_AFTER_DAYS)).toBe('stale')
    expect(on(EXPIRED_AFTER_DAYS + 1)).toBe('expired')
  })
  it('a rejected newest upload is "not accepted" while it is recent, and stale wins once it is old', () => {
    expect(dataStatus(up('u', '2026-11-01'), true, '2026-11-18').status).toBe('provisional')
    expect(dataStatus(up('u', '2026-09-20'), true, '2026-11-18').status).toBe('stale')
  })
  it('uses the upload day when the file has no data date', () => {
    expect(dataStatus({ id: 'u', version: 'v', dataDate: null, uploadedAt: '2026-11-10T08:00:00.000Z' }, false, '2026-11-18').ageDays).toBe(8)
  })
})

describe('the master', () => {
  const p = project({
    mapping: { ds: { code: 'D100', use: 'start' }, dc: { code: 'D900', use: 'finish' }, sc: { code: 'C900', use: 'finish' } },
    ownerForecasts: { sc: { date: '2027-07-01', note: 'progress meeting', by: null, at: '2026-11-10T00:00:00.000Z' } },
    previous: up('u1', '2026-10-01'), baseline: up('u0', '2026-01-01', 'Baseline'),
    latestActs: {
      D100: act('D100', { name: 'Start design', actualStart: '2026-02-02' }),
      D900: act('D900', { name: 'Design complete', actualFinish: '2026-06-10' }),
      C900: act('C900', { name: 'Substantial completion', earlyFinish: '2027-06-15T17:00:00', totalFloat: -12, isCritical: true }),
    },
    previousActs: { C900: act('C900', { earlyFinish: '2027-06-01' }) },
    baselineActs: { D100: act('D100', { earlyStart: '2026-02-02' }), D900: act('D900', { earlyFinish: '2026-06-01' }), C900: act('C900', { earlyFinish: '2027-05-01' }) },
  })
  const m = master([p])
  const row = m.rows[0]
  const cell = (k: string) => row.cells[DICT.findIndex(x => x.key === k)]

  it('shows the contractor date exactly as the newest upload holds it', () => {
    expect(cell('sc').date).toBe('2027-06-15')
    expect(cell('sc').actual).toBe(false)
    expect(cell('dc')).toMatchObject({ date: '2026-06-10', actual: true })
  })
  it('measures against the baseline upload and the previous upload in calendar days', () => {
    expect(cell('sc')).toMatchObject({ baseline: '2027-05-01', varianceDays: 45, previous: '2027-06-01', movedDays: 14 })
    expect(cell('dc').varianceDays).toBe(9)
    expect(cell('ds').varianceDays).toBe(0)
  })
  it('keeps the owner forecast beside the contractor date, never in place of it', () => {
    expect(cell('sc').ownerForecast?.date).toBe('2027-07-01')
    expect(cell('sc').ownerGapDays).toBe(16)
    expect(cell('sc').date).toBe('2027-06-15')
  })
  it('leaves an unmapped milestone empty and does not call it missing', () => {
    expect(cell('ntp')).toMatchObject({ mapped: null, missing: false, date: null })
    expect(row.mappedCount).toBe(3)
  })
  it('does not carry float or criticality for a date that has happened', () => {
    expect(cell('dc')).toMatchObject({ totalFloat: null, critical: false })
    expect(cell('sc')).toMatchObject({ totalFloat: -12, critical: true })
  })
  it('builds phases from the earliest to the latest mapped milestone', () => {
    const design = row.phases.find(x => x.phase === 'Design')!
    expect(design).toMatchObject({ start: '2026-02-02', finish: '2026-06-10', done: true, baselineFinish: '2026-06-01', varianceDays: 9 })
    const build = row.phases.find(x => x.phase === 'Construction')!
    expect(build).toMatchObject({ start: '2027-06-15', finish: '2027-06-15', done: false, started: false })
    expect(row.currentPhase).toBe('Construction')
  })
  it('takes the project finish from the last milestone that has a date', () => {
    expect(row.finish).toBe('2027-06-15')
    expect(row.finishVarianceDays).toBe(45)
  })

  it('flags a mapped activity that is not in the newest upload', () => {
    const r = master([project({ mapping: { sc: { code: 'GONE', use: 'finish' } } })]).rows[0]
    expect(r.cells[3]).toMatchObject({ missing: true, date: null })
    expect(r.missingCount).toBe(1)
  })
  it('a project with no upload is not "missing" anything: it has no schedule', () => {
    const r = master([project({ latest: null, mapping: { sc: { code: 'C900', use: 'finish' } } })]).rows[0]
    expect(r.status).toBe('none')
    expect(r.cells[3].missing).toBe(false)
  })
  it("falls back to the file's own target dates when the project has no baseline upload", () => {
    const r = master([project({ mapping: { sc: { code: 'C900', use: 'finish' } }, latestActs: { C900: act('C900', { earlyFinish: '2027-06-15', baselineFinish: '2027-06-01' }) } })]).rows[0]
    expect(r.cells[3]).toMatchObject({ baseline: '2027-06-01', varianceDays: 14 })
  })
  it('reads no baseline when the baseline upload does not hold the activity', () => {
    const r = master([project({ baseline: up('u0', '2026-01-01'), mapping: { sc: { code: 'C900', use: 'finish' } }, latestActs: { C900: act('C900', { earlyFinish: '2027-06-15', baselineFinish: '2027-06-01' }) } })]).rows[0]
    expect(r.cells[3]).toMatchObject({ baseline: null, varianceDays: null })
  })

  it('rolls projects up by sector', () => {
    const late = project({ id: 'a', name: 'A', mapping: { sc: { code: 'X', use: 'finish' } }, latestActs: { X: act('X', { earlyFinish: '2027-03-10', baselineFinish: '2027-03-01' }) } })
    const done = project({ id: 'b', name: 'B', mapping: { sc: { code: 'X', use: 'finish' } }, latestActs: { X: act('X', { actualFinish: '2026-10-01', baselineFinish: '2026-10-05' }) } })
    const clinic = project({ id: 'c', name: 'C', sector: 'Health', latest: up('u', '2026-08-01'), mapping: { sc: { code: 'X', use: 'finish' } }, latestActs: { X: act('X', { earlyFinish: '2028-01-10' }) } })
    const none = project({ id: 'd', name: 'D', sector: null, latest: null })
    const mm = master([late, done, clinic, none])
    expect(mm.sectors.map(s => s.sector)).toEqual(['Education', 'Health', 'No sector'])
    const edu = mm.sectors[0]
    expect(edu).toMatchObject({ projects: 2, late: 1, worstVarianceDays: 9, finish: '2027-03-10' })
    expect(edu.milestones[3]).toEqual({ key: 'sc', achieved: 1, mapped: 2, latest: '2027-03-10' })
    expect(mm.sectors[1].byStatus.expired).toBe(1)
    expect(mm.totals).toMatchObject({ projects: 4, late: 1, finish: '2028-01-10' })
    expect(mm.totals.byStatus).toEqual({ current: 2, provisional: 0, stale: 0, expired: 1, none: 1 })
  })
})

describe('other parties', () => {
  it('is late when forecast after the need date, or when the need date has passed with nothing delivered', () => {
    expect(partyStatus({ needDate: '2026-12-01', forecastDate: '2026-12-15', actualDate: null }, '2026-11-18')).toEqual({ status: 'late', lateDays: 14 })
    expect(partyStatus({ needDate: '2026-11-01', forecastDate: null, actualDate: null }, '2026-11-18')).toEqual({ status: 'late', lateDays: 17 })
    expect(partyStatus({ needDate: '2026-11-01', forecastDate: '2026-11-10', actualDate: null }, '2026-11-18').lateDays).toBe(17)
  })
  it('is due soon inside 30 days, open beyond, done with an actual', () => {
    expect(partyStatus({ needDate: '2026-12-10', forecastDate: null, actualDate: null }, '2026-11-18').status).toBe('due_soon')
    expect(partyStatus({ needDate: '2027-03-01', forecastDate: '2027-02-20', actualDate: null }, '2026-11-18').status).toBe('open')
    expect(partyStatus({ needDate: '2026-11-01', forecastDate: null, actualDate: '2026-11-05' }, '2026-11-18')).toEqual({ status: 'done', lateDays: 4 })
    expect(partyStatus({ needDate: null, forecastDate: '2026-11-01', actualDate: null }, '2026-11-18').status).toBe('late')
    expect(partyStatus({ needDate: null, forecastDate: null, actualDate: null }, '2026-11-18').status).toBe('open')
  })
  const item = (o: Partial<PartyItem>): PartyItem => ({ id: 'i', projectId: null, party: 'Utility', title: 'Permanent power', needDate: null, forecastDate: null, actualDate: null, note: null, milestoneKey: null, updatedAt: '' , ...o })
  it('names the contractor milestone an item is needed for, with its date on the master', () => {
    const p = project({ mapping: { sc: { code: 'X', use: 'finish' } }, latestActs: { X: act('X', { earlyFinish: '2027-03-10' }) } })
    const mm = master([p], [item({ projectId: 'p1', milestoneKey: 'sc', needDate: '2027-02-01' })])
    expect(mm.parties[0]).toMatchObject({ project: 'School A', sector: 'Education', neededFor: { name: 'Substantial completion', date: '2027-03-10' } })
  })
  it('leaves out an item filed under a project the reader cannot see', () => {
    expect(master([project()], [item({ projectId: 'hidden' }), item({ id: 'j' })]).parties.map(x => x.id)).toEqual(['j'])
  })
  it('lists open items by date, done ones last', () => {
    const mm = master([], [item({ id: 'a', needDate: '2027-05-01' }), item({ id: 'b', needDate: '2027-01-01', actualDate: '2027-01-01' }), item({ id: 'c', needDate: '2027-02-01' })])
    expect(mm.parties.map(x => x.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('look-ahead', () => {
  it('lists unreached contractor milestones and open items inside the window, earliest first', () => {
    const p = project({
      mapping: { dc: { code: 'A', use: 'finish' }, ntp: { code: 'B', use: 'finish' }, sc: { code: 'C', use: 'finish' } },
      latestActs: { A: act('A', { actualFinish: '2026-11-01' }), B: act('B', { earlyFinish: '2026-12-20' }), C: act('C', { earlyFinish: '2027-09-01' }) },
    })
    const parties: PartyItem[] = [
      { id: 'i', projectId: null, party: 'Permitting', title: 'Building permit', needDate: '2026-12-01', forecastDate: null, actualDate: null, note: null, milestoneKey: null, updatedAt: '' },
      { id: 'k', projectId: null, party: 'Owner', title: 'Done already', needDate: '2026-12-01', forecastDate: null, actualDate: '2026-11-02', note: null, milestoneKey: null, updatedAt: '' },
    ]
    const items = lookAhead(master([p], parties))
    expect(items.map(i => [i.kind, i.what, i.daysOut])).toEqual([['party', 'Building permit', 13], ['milestone', 'Notice to proceed', 32]])
    expect(items[1].source).toBe('Contractor schedule, current')
  })
  it('keeps a forecast date that has passed without an actual: it is overdue, not gone', () => {
    const p = project({ mapping: { ntp: { code: 'B', use: 'finish' } }, latestActs: { B: act('B', { earlyFinish: '2026-11-10' }) } })
    expect(lookAhead(master([p]))[0].daysOut).toBe(-8)
  })
})

describe('suggesting a mapping', () => {
  const acts = [
    { code: 'M10', name: 'NTP Issued', type: 'milestone', milestoneKind: 'start' as const },
    { code: 'M90', name: 'Substantial Completion', type: 'milestone', milestoneKind: 'finish' as const },
    { code: 'T50', name: 'Punch list prior to substantial completion walk', type: 'task', milestoneKind: null },
    { code: 'M20', name: 'Design Development Complete', type: 'milestone', milestoneKind: 'finish' as const },
  ]
  it('matches on names, understands common abbreviations and prefers the closest milestone activity', () => {
    const s = suggestMapping(DICT, acts)
    expect(s.ntp).toMatchObject({ code: 'M10', use: 'start' })
    expect(s.sc).toMatchObject({ code: 'M90', use: 'finish' })
    expect(s.dc).toMatchObject({ code: 'M20' })
    expect(s.ds).toBeUndefined()
  })
  it('never proposes a change to a milestone that is already mapped', () => {
    expect(suggestMapping(DICT, acts, { sc: { code: 'OTHER', use: 'finish' } }).sc).toBeUndefined()
  })
})

describe('printouts', () => {
  const p = project({ mapping: { sc: { code: '=C900', use: 'finish' } }, latestActs: { '=C900': act('=C900', { name: 'Substantial completion', earlyFinish: '2027-06-15', baselineFinish: '2027-06-01' }) } })
  const m = master([p])
  const us = (x: string | null) => (x ? `${x.slice(5, 7)}/${x.slice(8, 10)}/${x.slice(0, 4)}` : '')
  it('the milestone printout has one line per mapped milestone, with its source and data status', () => {
    const t = reportTable(m, 'milestones', us)
    expect(t).toHaveLength(2)
    expect(t[1].slice(0, 4)).toEqual(['Education', 'School A', 'Builder', 'Substantial completion'])
    expect(t[1]).toContain('06/15/2027')
    expect(t[1]).toContain('+14')
    expect(t[1][t[1].length - 2]).toBe('u2, data date 11/01/2026')
    expect(t[1][t[1].length - 1]).toBe('Current')
  })
  it('every printout has a header row and the same number of cells on every line', () => {
    for (const r of ['milestones', 'phases', 'sectors', 'lookahead', 'parties', 'updates'] as const) {
      const t = reportTable(m, r, us)
      expect(t.length).toBeGreaterThan(0)
      for (const line of t) expect(line).toHaveLength(t[0].length)
    }
  })
})

describe('validating what a person typed', () => {
  let n = 0
  const key = () => `k${++n}`
  it('keeps the keys it was sent and makes one for a new milestone', () => {
    const r = parseDictionary([{ key: 'sc', name: ' Substantial   completion ', phase: 'Construction' }, { name: 'Occupancy', phase: 'Closeout' }], key)
    expect('dictionary' in r && r.dictionary).toEqual([{ key: 'sc', name: 'Substantial completion', phase: 'Construction' }, { key: 'k1', name: 'Occupancy', phase: 'Closeout' }])
  })
  it('refuses a milestone with no name or phase, a repeated name, and a list that is too long', () => {
    expect(parseDictionary([{ name: '', phase: 'X' }], key)).toHaveProperty('error')
    expect(parseDictionary([{ name: 'A', phase: '' }], key)).toHaveProperty('error')
    expect(parseDictionary([{ name: 'A', phase: 'X' }, { name: 'a', phase: 'Y' }], key)).toHaveProperty('error')
    expect(parseDictionary(Array.from({ length: 41 }, (_, i) => ({ name: `M${i}`, phase: 'X' })), key)).toHaveProperty('error')
    expect(parseDictionary('no', key)).toHaveProperty('error')
  })
  it('gives two milestones sent with the same key different keys', () => {
    const r = parseDictionary([{ key: 'a', name: 'One', phase: 'X' }, { key: 'a', name: 'Two', phase: 'X' }], key)
    expect('dictionary' in r && new Set(r.dictionary.map(m => m.key)).size).toBe(2)
  })
  it('a mapping names an activity, never a date; null removes it; an unknown milestone is refused', () => {
    const cur = { ds: { code: 'A', use: 'start' as const } }
    expect(parseMapping({ sc: { code: ' C900 ', use: 'finish', date: '2030-01-01' }, ds: null }, DICT, cur)).toEqual({ mapping: { sc: { code: 'C900', use: 'finish' } } })
    expect(parseMapping({ nope: { code: 'X' } }, DICT, cur)).toHaveProperty('error')
    expect(parseMapping({ sc: { code: '' } }, DICT, cur)).toHaveProperty('error')
  })
  it('an owner forecast needs a real date', () => {
    expect(parseOwnerForecasts({ sc: { date: '2027-02-30' } }, DICT, {}, null, 'now')).toHaveProperty('error')
    expect(parseOwnerForecasts({ sc: { date: '2027-02-27', note: ' site visit ' } }, DICT, {}, null, 'now')).toEqual({ ownerForecasts: { sc: { date: '2027-02-27', note: 'site visit', by: null, at: 'now' } } })
    expect(parseOwnerForecasts({ sc: null }, DICT, { sc: { date: '2027-01-01', note: null, by: null, at: 'x' } }, null, 'now')).toEqual({ ownerForecasts: {} })
  })
  it("an item needs a party and a title; its milestone must be the program's", () => {
    expect(parsePartyFields({ title: 'Permit' }, true, DICT)).toHaveProperty('error')
    expect(parsePartyFields({ party: 'Permitting', title: 'ab' }, true, DICT)).toHaveProperty('error')
    expect(parsePartyFields({ party: 'Permitting', title: 'Permit', milestoneKey: 'zz' }, true, DICT)).toHaveProperty('error')
    expect(parsePartyFields({ party: 'Permitting', title: 'Permit', needDate: 'soon' }, true, DICT)).toHaveProperty('error')
    expect(parsePartyFields({ party: 'Permitting', title: 'Permit', needDate: '2027-01-05', forecastDate: '', milestoneKey: 'ntp' }, true, DICT))
      .toEqual({ fields: { party: 'Permitting', title: 'Permit', needDate: '2027-01-05', forecastDate: null, milestoneKey: 'ntp' } })
    expect(parsePartyFields({ actualDate: '2027-01-05' }, false, DICT)).toEqual({ fields: { actualDate: '2027-01-05' } })
  })
})
