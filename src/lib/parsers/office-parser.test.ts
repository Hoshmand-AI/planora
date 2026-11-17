import { describe, expect, it } from 'vitest'
import { joinContinuedTables, ooxmlTables, parseOfficeDocument } from './office-parser'
import { parseScheduleFile } from './index'

/** A ZIP with stored (uncompressed) entries: enough for a .docx or .pptx the reader accepts. */
function zip(files: Record<string, string>): Buffer {
  const local: Buffer[] = [], central: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8'), n = Buffer.from(name, 'utf8')
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(n.length, 26)
    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(data.length, 24); dir.writeUInt16LE(n.length, 28); dir.writeUInt32LE(offset, 42)
    local.push(head, n, data); central.push(dir, n)
    offset += 30 + n.length + data.length
  }
  const dirBytes = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(dirBytes.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, dirBytes, end])
}
const wTable = (rows: string[][]) => `<w:tbl>${rows.map(r => `<w:tr>${r.map(c => `<w:tc><w:p><w:r><w:t>${c}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`
const aTable = (rows: string[][]) => `<a:tbl>${rows.map(r => `<a:tr>${r.map(c => `<a:tc><a:txBody><a:p><a:r><a:t>${c}</a:t></a:r></a:p></a:txBody></a:tc>`).join('')}</a:tr>`).join('')}</a:tbl>`
const docx = (body: string) => zip({ 'word/document.xml': `<w:document><w:body>${body}</w:body></w:document>` })
const HEAD = ['Activity ID', 'Activity Name', 'Duration', 'Start', 'Finish', 'Predecessors']
const ROWS = [
  ['A100', 'Mobilize &amp; set up site', '5', '01/05/2026', '01/09/2026', ''],
  ['A110', 'Excavate footings', '10', '01/12/2026', '01/23/2026', 'A100'],
  ['A120', 'Pour footings', '8', '01/26/2026', '02/04/2026', 'A110'],
]

describe('a schedule in a Word document', () => {
  it('reads the schedule table: IDs, names, durations, dates and logic', async () => {
    const file = docx(`<w:p><w:r><w:t>Baseline schedule</w:t></w:r></w:p>${wTable([['Prepared by', 'Checked by'], ['PM', 'Scheduler']])}${wTable([HEAD, ...ROWS])}`)
    const s = await parseOfficeDocument(file, 'Schedule.docx', 'sched', 'docx')
    expect(s.sourceType).toBe('word')
    expect(s.activities.map(a => a.activityId)).toEqual(['A100', 'A110', 'A120'])
    expect(s.activities[0].name).toBe('Mobilize & set up site')
    expect(s.activities[1].duration).toBe(10)
    expect(s.relationships).toHaveLength(2)
    expect(s.warnings[0]).toMatch(/schedule table in this Word document/)
  })
  it('joins a table that continues on the next page under the same header', async () => {
    const more = [['A130', 'Backfill', '4', '02/05/2026', '02/10/2026', 'A120']]
    const s = await parseOfficeDocument(docx(wTable([HEAD, ...ROWS]) + wTable([HEAD, ...more])), 'Schedule.docx', 'sched', 'docx')
    expect(s.activities.map(a => a.activityId)).toEqual(['A100', 'A110', 'A120', 'A130'])
    expect(joinContinuedTables([[HEAD, ROWS[0]], [HEAD.map(h => h.toUpperCase()), ROWS[1]]])).toHaveLength(1)
  })
  it('with no table, reads lines of text that carry dates, and says so', async () => {
    const lines = ['Mobilize\t\t01/05/2026\t01/09/2026', 'Excavate footings\t\t01/12/2026\t01/23/2026', 'Pour footings\t\t01/26/2026\t02/04/2026']
    const s = await parseOfficeDocument(docx(lines.map(l => `<w:p><w:r>${l.split('\t').map(t => (t ? `<w:t>${t}</w:t>` : '')).join('<w:tab/>')}</w:r></w:p>`).join('')), 'Notes.docx', 'sched', 'docx')
    expect(s.activities.length).toBeGreaterThanOrEqual(3)
    expect(s.warnings[0]).toMatch(/No schedule table was found/)
  })
  it('says plainly when there is no schedule in the document', async () => {
    await expect(parseOfficeDocument(docx('<w:p><w:r><w:t>Minutes of the weekly meeting.</w:t></w:r></w:p>'), 'Minutes.docx', 'sched', 'docx')).rejects.toThrow(/No schedule was found in this Word document/)
    await expect(parseOfficeDocument(docx(''), 'Empty.docx', 'sched', 'docx')).rejects.toThrow(/no text to read/)
    await expect(parseOfficeDocument(Buffer.from('not a zip at all, just text'), 'Bad.docx', 'sched', 'docx')).rejects.toThrow()
    await expect(parseOfficeDocument(zip({ 'xl/workbook.xml': '<x/>' }), 'Wrong.docx', 'sched', 'docx')).rejects.toThrow(/not a Word \.docx/)
  })
})

describe('a schedule in a PowerPoint deck', () => {
  const slide = (inner: string) => `<p:sld><p:cSld><p:spTree>${inner}</p:spTree></p:cSld></p:sld>`
  it('reads a table spread over slides', async () => {
    const deck = zip({
      'ppt/slides/slide1.xml': slide('<p:sp><p:txBody><a:p><a:r><a:t>Project schedule</a:t></a:r></a:p></p:txBody></p:sp>'),
      'ppt/slides/slide2.xml': slide(aTable([HEAD, ROWS[0], ROWS[1]])),
      'ppt/slides/slide4.xml': slide(aTable([HEAD, ROWS[2]])),
    })
    const s = await parseScheduleFile('Lookahead.pptx', deck, 'sched')
    expect(s.sourceType).toBe('powerpoint')
    expect(s.activities.map(a => a.activityId)).toEqual(['A100', 'A110', 'A120'])
    expect(s.relationships).toHaveLength(2)
  })
  it('refuses a file that is not a deck, and the legacy formats, with what to do', async () => {
    await expect(parseScheduleFile('Deck.pptx', zip({ 'word/document.xml': '<w:document/>' }), 'sched')).rejects.toThrow(/not a PowerPoint \.pptx/)
    await expect(parseScheduleFile('Old.ppt', Buffer.from('x'), 'sched')).rejects.toThrow(/save as \.docx or \.pptx/)
    await expect(parseScheduleFile('Old.doc', Buffer.from('x'), 'sched')).rejects.toThrow(/save as \.docx or \.pptx/)
  })
})

describe('tables in the file', () => {
  it('keeps cell text and drops empty rows and one-row tables', () => {
    expect(ooxmlTables(wTable([['A', 'B'], ['', ''], ['1', '2']]) + wTable([['only']]), 'w')).toEqual([[['A', 'B'], ['1', '2']]])
  })
})

describe('awkward Word and PowerPoint tables', () => {
  it('keeps the columns of a row with a cell merged across two columns', () => {
    const merged = `<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Site works</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>10</w:t></w:r></w:p></w:tc></w:tr>`
    const [t] = ooxmlTables(`<w:tbl><w:tr>${['ID', 'Name', 'Duration'].map(c => `<w:tc><w:p><w:r><w:t>${c}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>${merged}</w:tbl>`, 'w')
    expect(t[1]).toEqual(['Site works', '', '10'])
  })
  it('reads a table inside a cell on its own and keeps the rows after it', () => {
    const innerT = wTable([['x', 'y'], ['1', '2']])
    const outer = `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>c</w:t></w:r></w:p>${innerT}</w:tc><w:tc><w:p><w:r><w:t>d</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>e</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>f</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`
    const tables = ooxmlTables(outer, 'w')
    expect(tables[0]).toEqual([['A', 'B'], ['c', 'd'], ['e', 'f']])
    expect(tables[1]).toEqual([['x', 'y'], ['1', '2']])
  })
  it('keeps names that hold semicolons whole', async () => {
    const rows = ROWS.map(r => [r[0], `${r[1]}; phase 1; zone A; level 2`, ...r.slice(2)])
    const s = await parseOfficeDocument(docx(wTable([HEAD, ...rows])), 'S.docx', 'sched', 'docx')
    expect(s.activities).toHaveLength(3)
    expect(s.activities[1].name).toBe('Excavate footings; phase 1; zone A; level 2')
  })
  it('gets through a body of opening tags that are never closed quickly', () => {
    const xml = '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>'.repeat(60_000)
    const t0 = performance.now()
    expect(ooxmlTables(xml, 'w')).toEqual([])
    expect(performance.now() - t0).toBeLessThan(2000)
  })
})
