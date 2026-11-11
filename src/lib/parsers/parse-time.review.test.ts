import { describe, it, expect } from 'vitest'
import { parseMSProjectXML } from './xml-parser'
import { parseXER } from './xer-parser'

// A crafted upload parsed in quadratic time (found by a line-by-line review): these must stay fast.
describe('parse time on hostile files', () => {
  it('MS Project XML with thousands of unclosed <Task attr> openers is refused at once', () => {
    const xml = `<?xml version="1.0"?><Project><Name>P</Name><Tasks>${'<Task a="1"><UID>1</UID><Name>x</Name>'.repeat(20000)}</Tasks></Project>`
    const t0 = Date.now()
    expect(() => parseMSProjectXML(xml, 's')).toThrow(/damaged/)
    expect(Date.now() - t0).toBeLessThan(2000)
  })
  it('a well-formed file with attributes on its tags still imports', () => {
    const xml = `<?xml version="1.0"?><Project xmlns="http://schemas.microsoft.com/project"><Name>P</Name><StartDate>2026-03-02T08:00:00</StartDate><Tasks><Task id="a"><UID>1</UID><ID>1</ID><Name>One</Name><Duration>PT40H0M0S</Duration><Start>2026-03-02T08:00:00</Start><Finish>2026-03-06T17:00:00</Finish></Task></Tasks></Project>`
    expect(parseMSProjectXML(xml, 's').activities.map(a => a.name)).toEqual(['One'])
  })
  it('an XER with thousands of projects picks its project without rescanning the tasks each time', () => {
    const projects = Array.from({ length: 3000 }, (_, i) => `%R\t${i + 1}\tP${i + 1}`).join('\r\n')
    const tasks = Array.from({ length: 30000 }, (_, i) => `%R\t${i + 1}\t${(i % 3000) + 1}\tA${i + 1}\tTask ${i + 1}\tTK_NotStart\tTT_Task`).join('\r\n')
    const xer = `ERMHDR\t20.12\r\n%T\tPROJECT\r\n%F\tproj_id\tproj_short_name\r\n${projects}\r\n%T\tTASK\r\n%F\ttask_id\tproj_id\ttask_code\ttask_name\tstatus_code\ttask_type\r\n${tasks}\r\n%E\r\n`
    const t0 = Date.now()
    parseXER(xer, 's')
    expect(Date.now() - t0).toBeLessThan(4000)
  })
})
