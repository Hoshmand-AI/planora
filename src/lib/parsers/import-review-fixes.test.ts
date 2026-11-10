import { describe, it, expect } from 'vitest'
import { parseMSProjectXML } from './xml-parser'
import { parseSpreadsheet, predCandidates } from './excel-parser'

const task = (uid: number, id: number, name: string, level: number, extra = '', links = '') =>
  `<Task><UID>${uid}</UID><ID>${id}</ID><Name>${name}</Name><OutlineLevel>${level}</OutlineLevel><Start>2026-03-02T08:00:00</Start><Finish>2026-03-06T17:00:00</Finish>${extra.includes('<Duration>') ? '' : '<Duration>PT40H0M0S</Duration>'}${extra}${links}</Task>`
const link = (pred: number) => `<PredecessorLink><PredecessorUID>${pred}</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag><LagFormat>7</LagFormat></PredecessorLink>`
const project = (tasks: string) => `<?xml version="1.0"?><Project xmlns="http://schemas.microsoft.com/project"><Name>T</Name><StartDate>2026-03-02T08:00:00</StartDate><MinutesPerDay>480</MinutesPerDay><Tasks>${tasks}</Tasks></Project>`

describe('MS Project import', () => {
  it('a link on a summary task is applied to the work under it', () => {
    const p = parseMSProjectXML(project([
      task(1, 1, 'Excavate', 1),
      task(2, 2, 'Structure', 1, '<Summary>1</Summary>', link(1)),
      task(3, 3, 'Footings', 2), task(4, 4, 'Columns', 2, '', link(3)),
    ].join('')), 's')
    const id = (n: string) => p.activities.find(a => a.name === n)!.id
    const has = (a: string, b: string) => p.relationships.some(r => r.predecessorId === id(a) && r.successorId === id(b))
    expect(has('Excavate', 'Footings')).toBe(true)
    expect(has('Excavate', 'Columns')).toBe(true)
    expect(p.relationships.some(r => r.successorId === id('Structure') || r.predecessorId === id('Structure'))).toBe(false)
    expect(p.warnings.join(' ')).toMatch(/summary task/)
  })

  it('an elapsed duration is wall-clock time, not three times as many work days', () => {
    const p = parseMSProjectXML(project(task(1, 1, 'Cure slab', 1, '<Duration>PT720H0M0S</Duration><DurationFormat>8</DurationFormat>')), 's')
    expect(p.activities[0].duration).toBe(21) // 30 calendar days is about 21 work days, not 90
  })

  it('an inactive task is left out, with a warning', () => {
    const p = parseMSProjectXML(project(task(1, 1, 'Live', 1) + task(2, 2, 'Dropped option', 1, '<Active>0</Active>')), 's')
    expect(p.activities.map(a => a.name)).toEqual(['Live'])
    expect(p.warnings.join(' ')).toMatch(/inactive/)
  })
})

describe('spreadsheet import', () => {
  const csv = (rows: string[]) => parseSpreadsheet(Buffer.from(rows.join('\n')), 't.csv', 's')

  it('an activity ID that matches as written wins over reading its tail as a lag', async () => {
    const p = await csv(['Act ID,Activity Name,OD,Preds', 'A1000,Dig,5,', 'A1000-1,Dig phase 1,5,', 'A2000,Pour,5,A1000-1'])
    const by = (c: string) => p.activities.find(a => a.activityId === c)!
    expect(p.relationships).toHaveLength(1)
    expect(p.relationships[0]).toMatchObject({ predecessorId: by('A1000-1').id, successorId: by('A2000').id, type: 'FS', lag: 0 })
  })

  it('a row whose name is "Finish" is an activity, not a repeated header', async () => {
    const p = await csv(['Task Name,Duration,Start,Finish,Predecessors', 'Mobilize,5,2026-03-02,2026-03-06,', 'Finish,0,2026-03-20,2026-03-20,3', 'Build,10,2026-03-09,2026-03-20,1'])
    expect(p.activities.map(a => a.name)).toEqual(['Mobilize', 'Finish', 'Build'])
    expect(p.relationships).toHaveLength(2)
  })

  it('a repeated header row is still skipped', async () => {
    const p = await csv(['Task Name,Duration,Start,Finish', 'Mobilize,5,2026-03-02,2026-03-06', 'Task Name,Duration,Start,Finish', 'Build,10,2026-03-09,2026-03-20'])
    expect(p.activities.map(a => a.name)).toEqual(['Mobilize', 'Build'])
  })

  it('a huge predecessor cell is taken as written instead of being pattern-matched', () => {
    const t = `${'A'.repeat(6000)} SS 5`
    const start = Date.now()
    expect(predCandidates(t)).toEqual([{ ref: t, type: 'FS', lag: 0 }])
    expect(Date.now() - start).toBeLessThan(200)
  })
})
