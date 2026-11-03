import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import type { Activity, Schedule } from '@/lib/db'
import { parseXER, xerResourceCounts } from '@/lib/parsers/xer-parser'
import { parseP6Xml, p6XmlResourceCounts } from '@/lib/parsers/p6-xml-parser'
import { parseMSProjectXML } from '@/lib/parsers/xml-parser'
import { parseSpreadsheet } from '@/lib/parsers/excel-parser'
import type { ParsedSchedule } from '@/lib/parsers/types'
import { assignmentCounts } from '@/lib/planning/resource-service'
import { GAO_RULES } from './gao'
import { engineConfig, evaluateRule } from './engine'
import { buildNetwork } from './network'
import { scheduleStandardsInput } from './inputs'

// GAO best practice 3 reads the resource data of every format that carries it (the same counts the
// Quality page's DCMA #10 uses), not only P6 XER; without resource data it stays not assessable.

const fx = (f: string) => readFileSync(path.join(__dirname, '..', 'parsers', '__fixtures__', f), 'utf8')
const bp3 = GAO_RULES.find(r => r.ruleId === 'GAO-BP3-01')!

function runBp3(p: ParsedSchedule, counts: Record<string, number> | null) {
  const schedule = { id: 's', name: p.projectName, version: 'Update 1', sourceType: p.sourceType, projectStart: p.projectStart, dataDate: p.dataDate, calendars: p.calendars, defaultCalendarId: p.defaultCalendarId } as unknown as Schedule
  const acts = p.activities as Activity[]
  const input = scheduleStandardsInput({ schedule, activities: acts, relationships: p.relationships, baseline: null, resourceCounts: counts })
  return evaluateRule(bp3, buildNetwork(input), engineConfig())
}

describe('GAO BP3 with resource data from every format', () => {
  it('P6 XER and P6 XML: the same assessment from their assignment rows', () => {
    const xer = parseXER(fx('p6-equivalence.xer'), 's'), xml = parseP6Xml(fx('p6-equivalence.xml'), 's')
    const a = runBp3(xer, xerResourceCounts(fx('p6-equivalence.xer')))
    const b = runBp3(xml, p6XmlResourceCounts(fx('p6-equivalence.xml')))
    expect(a.result).not.toBe('not_assessable')
    expect(b.result).toBe(a.result)
    expect(b.metric).toBe(a.metric)
    expect(b.evidence).toEqual(a.evidence)
  })

  it('MS Project XML with Assignments is assessable; without them it is not', () => {
    const base = fx('sample-msp.xml')
    const plain = parseMSProjectXML(base, 's')
    expect(plain.resources ?? null).toBeNull()
    expect(runBp3(plain, assignmentCounts(plain.resources, plain.activities)).result).toBe('not_assessable')
    const work = plain.activities.filter(a => a.activityType === 'task' && a.duration > 0)
    const uids = work.map(a => a.sourceId)
    const doc = base.replace(/<\/Project>\s*$/, `<Resources><Resource><UID>1</UID><Name>Crew</Name><Type>1</Type></Resource></Resources>
      <Assignments>${uids.map((u, i) => `<Assignment><UID>${i + 1}</UID><TaskUID>${u}</TaskUID><ResourceUID>1</ResourceUID><Work>PT8H0M0S</Work></Assignment>`).join('')}</Assignments></Project>`)
    const loaded = parseMSProjectXML(doc, 's')
    const r = runBp3(loaded, assignmentCounts(loaded.resources, loaded.activities))
    expect(r.result).toBe('pass')
    expect(r.metric).toMatch(/^100\.0% of \d+ open tasks have resources/)
  })

  it('a spreadsheet resource column is assessable and names the bare tasks', async () => {
    const csv = ['Activity ID,Activity Name,Duration,Predecessors,Resource Names', 'A1,Start,0,,', 'A2,Excavate,5,A1,Crew A', 'A3,Pour,5,A2,', 'A4,Finish,0,A3,'].join('\n')
    const p = await parseSpreadsheet(Buffer.from(csv), 'plan.csv', 's')
    const r = runBp3(p, assignmentCounts(p.resources, p.activities))
    expect(r.result).toBe('fail')
    expect(r.evidence).toEqual(['A3'])
  })
})
