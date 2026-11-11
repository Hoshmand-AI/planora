// Line-by-line review, round 2 (M7): Excel import says when rows or columns are cut off, and refuses
// a workbook that unpacks to an absurd size before loading it.
import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { MAX_SHEET_COLS, MAX_SHEET_ROWS, MAX_WORKBOOK_XML_BYTES, parseSpreadsheet, workbookXmlBytes } from './excel-parser'

const book = async (rows: number, extraCols = 0) => {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Schedule')
  ws.addRow(['Activity ID', 'Activity Name', 'Duration', ...Array.from({ length: extraCols }, (_, i) => `X${i}`)])
  for (let r = 0; r < rows; r++) ws.addRow([`A${r}`, 'n', 1, ...Array.from({ length: extraCols }, () => (r === 0 ? 1 : null))])
  return Buffer.from(await wb.xlsx.writeBuffer())
}

describe('M7: Excel import limits are never silent', () => {
  it('a normal sheet has no cut-off warning', async () => {
    const p = await parseSpreadsheet(await book(20), 'f.xlsx', 's')
    expect(p.activities).toHaveLength(20)
    expect(p.warnings.some(w => /NOT imported/.test(w))).toBe(false)
    expect(p.exceptions?.records.some(r => /beyond/.test(r.field)) ?? false).toBe(false)
  })
  it('rows past the limit are reported as a warning and a loss', async () => {
    const p = await parseSpreadsheet(await book(MAX_SHEET_ROWS + 10), 'f.xlsx', 's')
    expect(p.activities).toHaveLength(MAX_SHEET_ROWS - 1)
    expect(p.warnings.find(w => /NOT imported/.test(w))).toMatch(/Worksheet "Schedule" has more than 50,000 rows: the last 11 rows were NOT imported/)
    const rec = p.exceptions!.records.find(r => /rows beyond/.test(r.field))!
    expect(rec).toMatchObject({ severity: 'loss', disposition: 'dropped', count: 11 })
  }, 120_000)
  it('columns past the limit are reported', async () => {
    const p = await parseSpreadsheet(await book(3, MAX_SHEET_COLS + 2), 'f.xlsx', 's')
    expect(p.warnings.find(w => /columns/.test(w) && /NOT imported/.test(w))).toMatch(/more than 200 columns: the last 5 columns were NOT imported/)
    expect(p.exceptions!.records.find(r => /columns beyond/.test(r.field))).toMatchObject({ severity: 'loss', count: 5 })
  })
  it('the unpacked size is read from the ZIP directory', async () => {
    const buf = await book(50)
    const n = workbookXmlBytes(buf)!
    expect(n).toBeGreaterThan(1000)
    expect(n).toBeLessThan(MAX_WORKBOOK_XML_BYTES)
    expect(workbookXmlBytes(Buffer.from('not a zip file at all, just text'))).toBeNull()
  })
  it('a workbook that unpacks past the limit is refused with a plain message, before loading', async () => {
    // A real workbook whose directory declares a 3 GB sheet (what a zip bomb's directory looks like).
    const buf = await book(5)
    let patched = 0
    for (let i = 0; i + 46 < buf.length; i++) {
      if (buf.readUInt32LE(i) !== 0x02014b50) continue
      const name = buf.toString('latin1', i + 46, i + 46 + buf.readUInt16LE(i + 28))
      if (/^xl\/worksheets\/.+\.xml$/.test(name)) { buf.writeUInt32LE(3_000_000_000, i + 24); patched++ }
    }
    expect(patched).toBe(1)
    await expect(parseSpreadsheet(buf, 'f.xlsx', 's')).rejects.toThrow(/too large to import.*limit is 200 MB/)
  })
})
