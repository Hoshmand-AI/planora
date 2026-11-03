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
    logicFinish: '2026-03-19',
    criticalPath: ['a1', 'a2', 'a4'],
    longestPath: ['a1', 'a2', 'a4'],
    violations: [],
    progressMode: 'retained',
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
    const parsed = parseMSProjectXML(xml, 'rt')
    const p = { ...parsed, activities: parsed.activities.filter(a => a.activityType !== 'summary') }
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

  it('writes the phase WBS as summary tasks with activities nested under them', () => {
    const p = parseMSProjectXML(xml, 'rt')
    const summaries = p.activities.filter(a => a.activityType === 'summary')
    // preconstruction, sitework, structure, closeout
    expect(summaries.map(a => a.name)).toEqual(['Preconstruction', 'Sitework', 'Structure', 'Closeout'])
    expect(summaries.map(a => a.wbs)).toEqual(['01', '02', '03', '04'])
    const byCode = new Map(p.activities.map(a => [a.activityId, a]))
    expect(byCode.get('NTP')!.wbs).toBe('01 Preconstruction')
    expect(byCode.get('EW-100')!.wbs).toBe('02 Sitework')
    expect(byCode.get('FD-200')!.wbs).toBe('03 Structure')
    expect(byCode.get('IN-300')!.wbs).toBe('03 Structure')
    expect(byCode.get('SC')!.wbs).toBe('04 Closeout')
    // activity UIDs are stable (schedule order); summary rows take UIDs after them
    const task = (code: string) => xml.split('<Task>').find(b => b.includes(`<Value>${code}</Value>`))!
    expect(task('NTP')).toContain('<UID>1</UID>')
    expect(task('SC')).toContain('<UID>5</UID>')
    expect(task('SC')).toContain('<OutlineLevel>2</OutlineLevel>')
    expect(task('SC')).toMatch(/<PredecessorUID>4<\/PredecessorUID>/)
    expect(xml).toMatch(/<UID>0<\/UID>\s*<ID>0<\/ID>\s*<Name>Clinic &lt;Phase 1&gt;/)
  })

  it('uses each calendar\'s hours for finish times (08:00 start, lunch on 8h+ days)', () => {
    const task = (code: string) => xml.split('<Task>').find(b => b.includes(`<Value>${code}</Value>`))!
    expect(task('FD-200')).toContain('<Finish>2026-03-17T17:00:00</Finish>') // 8h + lunch
    expect(task('EW-100')).toContain('<Finish>2026-03-14T19:00:00</Finish>') // 10h + lunch
    expect(task('IN-300')).toContain('<Finish>2026-03-19T15:30:00</Finish>') // 7.5h, no lunch
    expect(task('IN-300')).toContain('<Start>2026-03-17T08:00:00</Start>')
  })
})

describe('exportMspXml: progressed (uploaded) schedule', () => {
  const sourceAct = (id: string, code: string, name: string, duration: number, wbs: string, extra: Partial<PlanActivity> = {}) => act(id, code, name, duration, { wbs, calendarId: 'std', ...extra })
  const progressed: GeneratedSchedule = {
    ...schedule,
    dataDate: '2026-03-16',
    mustFinishBy: '2026-04-15',
    calendars: [schedule.calendars[0]],
    activities: [
      sourceAct('p1', 'A1000', 'Notice to Proceed', 0, '1 Milestones', { actualStart: '2026-03-02', actualFinish: '2026-03-02', status: 'complete', percentComplete: 100 }),
      sourceAct('p2', 'A1010', 'Excavation', 10, '2.1 Sitework', { actualStart: '2026-03-02', actualFinish: '2026-03-13', status: 'complete', percentComplete: 100, baselineStart: '2026-03-02', baselineFinish: '2026-03-13' }),
      sourceAct('p3', 'A1020', 'Footings', 8, '2.2 Foundations', { actualStart: '2026-03-16', remaining: 6, status: 'in_progress', percentComplete: 25 }),
      sourceAct('p4', 'A1030', 'Slab on grade', 5, '2.2 Foundations'),
      sourceAct('p5', 'A1040', 'Substantial Completion', 0, '1 Milestones'),
    ],
    links: [link('p1', 'p2', 'FS', 0), link('p2', 'p3', 'FS', 0), link('p3', 'p4', 'FS', 0), link('p4', 'p5', 'FS', 0)],
    cpm: {
      ...schedule.cpm!,
      times: {
        p1: times('2026-03-02', '2026-03-02', '2026-03-02', '2026-03-02', 0, true),
        p2: times('2026-03-02', '2026-03-13', '2026-03-02', '2026-03-13', 0, true),
        p3: times('2026-03-16', '2026-03-23', '2026-03-16', '2026-03-23', 0, true),
        p4: times('2026-03-24', '2026-03-30', '2026-03-24', '2026-03-30', 0, true),
        p5: times('2026-03-30', '2026-03-30', '2026-03-30', '2026-03-30', 0, true),
      },
      projectFinish: '2026-03-30',
    },
  }
  const xml = exportMspXml(progressed, 'Harbor Point Tower — Update 7')
  const p = parseMSProjectXML(xml, 'rt')
  const work = p.activities.filter(a => a.activityType !== 'summary')
  const byCode = new Map(work.map(a => [a.activityId, a]))

  it('keeps project name, activity count, logic and status date', () => {
    expect(p.projectName).toBe('Harbor Point Tower — Update 7')
    expect(xml).toContain('<Name>Harbor Point Tower — Update 7</Name>')
    expect(work).toHaveLength(progressed.activities.length)
    expect(p.relationships).toHaveLength(progressed.links.length)
    expect(p.dataDate).toBe('2026-03-16')
    expect(p.warnings).toEqual([])
  })

  it('keeps the source WBS outline', () => {
    const summaries = p.activities.filter(a => a.activityType === 'summary').map(a => `${a.wbs} ${a.name}`)
    expect(summaries).toEqual(['1 Milestones', '2 2', '2.1 Sitework', '2.2 Foundations'])
    for (const a of progressed.activities) expect(byCode.get(a.code)!.wbs).toBe(a.wbs)
    expect(xml).toMatch(/<Name>Foundations<\/Name>\s*<Type>1<\/Type>\s*<IsNull>0<\/IsNull>\s*<WBS>2\.2<\/WBS>\s*<OutlineNumber>2\.2<\/OutlineNumber>\s*<OutlineLevel>2<\/OutlineLevel>/)
    const footings = xml.split('<Task>').find(b => b.includes('<Value>A1020</Value>'))!
    expect(footings).toContain('<OutlineLevel>3</OutlineLevel>')
    expect(footings).toContain('<WBS>2.2.1</WBS>')
  })

  it('carries progress: actuals, percent complete and remaining duration', () => {
    expect(byCode.get('A1010')).toMatchObject({ status: 'complete', percentComplete: 100, actualStart: '2026-03-02', actualFinish: '2026-03-13', remainingDuration: 0, baselineStart: '2026-03-02', baselineFinish: '2026-03-13' })
    expect(byCode.get('A1020')).toMatchObject({ status: 'in_progress', percentComplete: 25, actualStart: '2026-03-16', actualFinish: null, remainingDuration: 6, duration: 8 })
    expect(byCode.get('A1030')).toMatchObject({ status: 'not_started', percentComplete: 0, actualStart: null, remainingDuration: 5 })
    expect(xml).toContain('<ActualFinish>2026-03-13T17:00:00</ActualFinish>')
  })

  it('writes the required finish as a Deadline on the finish milestone', () => {
    const deadlines = xml.split('<Task>').filter(b => b.includes('<Deadline>'))
    expect(deadlines).toHaveLength(1)
    expect(deadlines[0]).toContain('<Value>A1040</Value>')
    expect(deadlines[0]).toContain('<Deadline>2026-04-15T17:00:00</Deadline>')
    expect(xml).toContain('<FinishDate>2026-03-30T17:00:00</FinishDate>')
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
