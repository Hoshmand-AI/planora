import { describe, it, expect } from 'vitest'
import type { GeneratedSchedule, PlanActivity, PlanLink, CpmTimes } from '@/lib/planning/types'
import { exportMspXml, escapeXml } from './msp-xml'
import { exportCsv, exportScheduleCsv } from './csv'
import { parseMSProjectXML } from '@/lib/parsers/xml-parser'
import { parseSpreadsheet, parseCsv } from '@/lib/parsers/excel-parser'

const rationale = (summary: string) => ({ summary, sources: [{ kind: 'catalog' as const, label: 'RSMeans', detail: 'div 03' }, { kind: 'assumption' as const, label: 'Crew of 6' }], confidence: 'medium' as const })

function act(id: string, code: string, name: string, duration: number, extra: Partial<PlanActivity> = {}): PlanActivity {
  return { id, code, name, duration, type: duration === 0 ? 'milestone' : 'task', category: 'other', phase: 'structure', rationale: rationale(`Why ${name}`), ...extra }
}
function link(from: string, to: string, type: PlanLink['type'], lag: number): PlanLink {
  return { id: `${from}-${to}`, from, to, type, lag, rationale: rationale('logic') }
}
function times(es: string, ef: string, ls: string, lf: string, tf: number, critical: boolean): CpmTimes {
  return { earlyStart: es, earlyFinish: ef, lateStart: ls, lateFinish: lf, totalFloat: tf, freeFloat: 0, critical }
}

const schedule: GeneratedSchedule = {
  generatedAt: '2026-09-30T12:00:00Z',
  projectStart: '2026-03-02',
  defaultCalendarId: 'std',
  calendars: [
    { id: 'std', name: '5-day x 8h', workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidays: ['2026-05-25', '2026-07-03'], extraWorkDays: ['2026-03-14'] },
    { id: 'ext', name: 'Earthwork 6-day x 10h', workDays: [1, 2, 3, 4, 5, 6], hoursPerDay: 10, holidays: [] },
    { id: 'half', name: 'Inspector 4x7.5h', workDays: [1, 2, 3, 4], hoursPerDay: 7.5, holidays: ['2026-03-26'] },
  ],
  activities: [
    act('a1', 'NTP', 'Notice to Proceed', 0, { category: 'ntp', phase: 'preconstruction', calendarId: 'std' }),
    act('a2', 'EW-100', 'Mass excavation, "cut" & fill', 12, { category: 'earthwork', phase: 'sitework', calendarId: 'ext' }),
    act('a3', 'FD-200', 'Footings <Grid A–F>', 8.5, { category: 'foundations', calendarId: 'std', constraint: { type: 'SNET', date: '2026-03-23' } }),
    act('a4', 'IN-300', "Special inspection 'footings'", 3, { category: 'inspections', calendarId: 'half' }),
    act('a5', 'SC', 'Substantial Completion', 0, { category: 'substantial_completion', phase: 'closeout', constraint: { type: 'FNLT', date: '2026-04-30' } }),
  ],
  links: [
    link('a1', 'a2', 'FS', 0),
    link('a2', 'a3', 'SS', 3),
    link('a3', 'a4', 'FF', 1.5),
    link('a2', 'a4', 'FS', -2),
    link('a4', 'a5', 'FS', 0),
  ],
  assumptions: [],
  cpm: {
    times: {
      a1: times('2026-03-02', '2026-03-02', '2026-03-02', '2026-03-02', 0, true),
      a2: times('2026-03-02', '2026-03-14', '2026-03-02', '2026-03-14', 0, true),
      a3: times('2026-03-05', '2026-03-17', '2026-03-09', '2026-03-19', 2, false),
      a4: times('2026-03-17', '2026-03-19', '2026-03-17', '2026-03-19', 0, true),
      a5: times('2026-03-19', '2026-03-19', '2026-04-30', '2026-04-30', 29, false),
    },
    projectFinish: '2026-03-19',
    criticalPath: ['a1', 'a2', 'a4'],
    cycles: [],
    warnings: [],
  },
}

describe('exportMspXml', () => {
  const xml = exportMspXml(schedule, 'Clinic <Phase 1> & "Garage"')

  it('produces well-formed, escaped MSPDI', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"')).toBe(true)
    expect(xml).toContain('<Project xmlns="http://schemas.microsoft.com/project">')
    expect(xml).toContain('<Title>Clinic &lt;Phase 1&gt; &amp; &quot;Garage&quot;</Title>')
    expect(xml).toContain('<Duration>PT120H0M0S</Duration>') // 12d on the 10h calendar
    expect(xml).toContain('<Duration>PT68H0M0S</Duration>') // 8.5d on the 8h calendar
    expect(xml).toContain('<Duration>PT22H30M0S</Duration>') // 3d x 7.5h
    expect(xml).toContain('<LagFormat>7</LagFormat>')
    // no raw special characters left inside element text
    const texts = xml.replace(/<[^>]+>/g, '\n')
    expect(/[<>]/.test(texts)).toBe(false)
    expect(escapeXml('a & b < c')).toBe('a &amp; b &lt; c')
  })

  it('round-trips through parseMSProjectXML', () => {
    const p = parseMSProjectXML(xml, 'rt')
    expect(p.projectName).toBe('Clinic <Phase 1> & "Garage"')
    expect(p.projectStart).toBe('2026-03-02')
    expect(p.projectFinish).toBe('2026-03-19')
    expect(p.activities).toHaveLength(schedule.activities.length)

    // calendars
    expect(p.calendars).toHaveLength(3)
    for (const c of schedule.calendars) {
      const pc = p.calendars.find(x => x.name === c.name)!
      expect(pc).toBeDefined()
      expect(pc.workDays).toEqual(c.workDays)
      expect(pc.hoursPerDay).toBe(c.hoursPerDay)
      expect(pc.holidays).toEqual(c.holidays)
      expect(pc.extraWorkDays ?? []).toEqual(c.extraWorkDays ?? [])
    }
    expect(p.calendars.find(c => c.id === p.defaultCalendarId)!.name).toBe('5-day x 8h')

    const calName = (id: string | null | undefined) => p.calendars.find(c => c.id === id)?.name
    for (const a of schedule.activities) {
      const pa = p.activities.find(x => x.activityId === a.code)!
      expect(pa).toBeDefined()
      expect(pa.name).toBe(a.name)
      expect(pa.duration).toBe(a.duration)
      expect(pa.activityType).toBe(a.type)
      expect(calName(pa.calendarId)).toBe(schedule.calendars.find(c => c.id === (a.calendarId ?? 'std'))!.name)
      expect(pa.constraintType ?? null).toBe(a.constraint?.type ?? null)
      expect(pa.constraintDate ?? null).toBe(a.constraint?.date ?? null)
      const t = schedule.cpm!.times[a.id]
      expect(pa.earlyStart).toBe(t.earlyStart)
      expect(pa.lateFinish).toBe(t.lateFinish)
      expect(pa.totalFloat).toBe(t.totalFloat)
      expect(pa.isCritical).toBe(t.critical)
    }

    const codeOf = new Map(p.activities.map(a => [a.id, a.activityId]))
    const got = p.relationships.map(r => `${codeOf.get(r.predecessorId)}>${codeOf.get(r.successorId)} ${r.type} ${r.lag}`).sort()
    const codeById = new Map(schedule.activities.map(a => [a.id, a.code]))
    const want = schedule.links.map(l => `${codeById.get(l.from)}>${codeById.get(l.to)} ${l.type} ${l.lag}`).sort()
    expect(got).toEqual(want)
    expect(p.warnings).toEqual([])
  })
})

describe('exportCsv', () => {
  it('quotes per RFC 4180', () => {
    const csv = exportCsv(
      [{ a: 'plain', b: 'has, comma', c: 'has "quote"', d: 'multi\nline', e: 3, f: null, g: true }],
      [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }, { key: 'd', label: 'D' }, { key: 'e', label: 'E' }, { key: 'f', label: 'F' }, { key: 'g', label: 'G' }],
    )
    expect(csv).toBe('A,B,C,D,E,F,G\r\nplain,"has, comma","has ""quote""","multi\nline",3,,Yes\r\n')
    expect(parseCsv(csv)[1]).toEqual(['plain', 'has, comma', 'has "quote"', 'multi\nline', '3', '', 'Yes'])
  })
})

describe('exportScheduleCsv', () => {
  const csv = exportScheduleCsv(schedule)

  it('writes the expected columns', () => {
    expect(csv.split('\r\n')[0]).toBe('Activity ID,Name,Phase,Category,Duration,Early Start,Early Finish,Late Start,Late Finish,Total Float,Critical,Predecessors,Rationale,Sources')
    expect(csv).toContain('"FD-200 FF+1.5d, EW-100 FS-2d"')
  })

  it('round-trips through parseSpreadsheet', async () => {
    const p = await parseSpreadsheet(Buffer.from(csv, 'utf8'), 'export.csv', 'rt')
    expect(p.activities).toHaveLength(schedule.activities.length)
    for (const a of schedule.activities) {
      const pa = p.activities.find(x => x.activityId === a.code)!
      const t = schedule.cpm!.times[a.id]
      expect(pa).toMatchObject({
        name: a.name,
        duration: a.duration,
        category: a.category,
        activityType: a.type,
        earlyStart: t.earlyStart,
        earlyFinish: t.earlyFinish,
        lateStart: t.lateStart,
        lateFinish: t.lateFinish,
        totalFloat: t.totalFloat,
        isCritical: t.critical,
      })
    }
    const codeOf = new Map(p.activities.map(a => [a.id, a.activityId]))
    const got = p.relationships.map(r => `${codeOf.get(r.predecessorId)}>${codeOf.get(r.successorId)} ${r.type} ${r.lag}`).sort()
    const codeById = new Map(schedule.activities.map(a => [a.id, a.code]))
    const want = schedule.links.map(l => `${codeById.get(l.from)}>${codeById.get(l.to)} ${l.type} ${l.lag}`).sort()
    expect(got).toEqual(want)
    expect(p.warnings.some(w => /Unresolved/.test(w))).toBe(false)
  })
})
