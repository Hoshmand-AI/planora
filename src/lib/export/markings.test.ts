import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import type { Answer } from '@/lib/planning/types'
import { generateSchedule } from '@/lib/planning/generator'
import { exportMarking, markText, markXer, markedTitle, CSV_CUI_REFUSAL } from './markings'
import { exportXer } from './xer'
import { exportMspXml } from './msp-xml'
import { exportImportXlsx, exportP6LayoutXlsx } from './xlsx'
import { exportPdf } from './pdf'
import { parseXER, readXerTables } from '@/lib/parsers/xer-parser'
import { mostRestrictive } from '@/lib/server/classification'

const k = (value: Answer['value']): Answer => ({ status: 'known', value, answeredAt: '2026-01-01T00:00:00.000Z' })
const g = generateSchedule({ answers: { 'project.type': k('federal_defense'), 'project.state': k('VA'), 'project.target_start': k('2026-03-02'), 'project.federal': k(true) }, today: '2026-01-15' })
const cui = exportMarking('cui', { controlledBy: 'Alpha Builders', poc: 'Ana Scheduler' })!

describe('CUI export markings', () => {
  it('only CUI and classified data are marked', () => {
    expect(exportMarking('unclassified', { controlledBy: 'X' })).toBeNull()
    expect(exportMarking(null, { controlledBy: 'X' })).toBeNull()
    expect(cui.banner).toBe('CUI')
    expect(cui.designation).toEqual(expect.arrayContaining(['Controlled by: Alpha Builders', 'POC: Ana Scheduler']))
    expect(exportMarking('classified', { controlledBy: 'X' })!.banner).toBe('CLASSIFIED')
    expect(CSV_CUI_REFUSAL).toMatch(/CSV exports are excluded/)
  })
  it('the schedule classification is the most restrictive of the upload and its plan', () => {
    expect(mostRestrictive('unclassified', 'cui')).toBe('cui')
    expect(mostRestrictive('classified', 'cui', null)).toBe('classified')
    expect(mostRestrictive(null, undefined)).toBeNull()
  })
  it('reports: banner at top and bottom, designation under the top banner', () => {
    const t = markText('# Report\n\nBody', cui)
    expect(t.startsWith('**CUI**')).toBe(true)
    expect(t.trimEnd().endsWith('**CUI**')).toBe(true)
    expect(t).toMatch(/> Controlled by: Alpha Builders/)
    expect(markText('x', null)).toBe('x')
  })
  it('XER: a project notebook topic carries the marking; the project name is not prefixed', () => {
    const plain = exportXer(g, 'Hangar')
    const x = markXer(plain, cui)
    const t = readXerTables(x)
    expect(t['PROJECT'][0]['proj_short_name']).toBe('Hangar')
    const mt = t['MEMOTYPE'].find(r => r['memo_type'] === 'CUI Marking')!
    expect(mt).toMatchObject({ proj_flag: 'Y' })
    const node = t['PROJWBS'].find(r => r['proj_node_flag'] === 'Y')!
    expect(t['WBSMEMO']).toEqual([expect.objectContaining({ wbs_id: node['wbs_id'], memo_type_id: mt['memo_type_id'] })])
    expect(t['WBSMEMO'][0]['wbs_memo']).toMatch(/<B>CUI<\/B>.*Controlled by: Alpha Builders/)
    // Every original line is kept; the file still parses the same.
    expect(x.split('\r\n').filter(l => !plain.split('\r\n').includes(l)).every(l => /MEMOTYPE|WBSMEMO|CUI/.test(l) || l.startsWith('%F'))).toBe(true)
    expect(parseXER(x, 's').activities.length).toBe(parseXER(plain, 's').activities.length)
    expect(markXer(plain, null)).toBe(plain)
  })
  it('XER: appends to existing MEMOTYPE / WBSMEMO tables with fresh ids', () => {
    const src = [
      'ERMHDR\t19.12\t2026-03-01\tProject\tu\tu\tdb\tProject Management\tUSD',
      '%T\tPROJWBS', '%F\twbs_id\tproj_id\tproj_node_flag\twbs_short_name', '%R\t7\t1\tY\tP1', '%R\t8\t1\tN\tA',
      '%T\tMEMOTYPE', '%F\tmemo_type_id\tmemo_type', '%R\t3\tNotes',
      '%T\tWBSMEMO', '%F\twbs_memo_id\tproj_id\twbs_id\tmemo_type_id\twbs_memo', '%R\t11\t1\t8\t3\t<HTML>old</HTML>',
      '%E', '',
    ].join('\n')
    const t = readXerTables(markXer(src, cui))
    expect(t['MEMOTYPE'].map(r => r['memo_type'])).toEqual(['Notes', 'CUI Marking'])
    expect(t['WBSMEMO'].map(r => r['wbs_id'])).toEqual(['8', '7'])
    expect(Number(t['WBSMEMO'][1]['wbs_memo_id'])).toBeGreaterThan(11)
  })
  it('MS Project XML: title and summary-task notes', () => {
    const x = exportMspXml(g, 'Hangar', { marking: cui })
    expect(x).toMatch(/<Title>CUI - Hangar<\/Title>/)
    expect(x).toMatch(/<Subject>CUI\. Controlled by: Alpha Builders/)
    expect(x).toMatch(/<UID>0<\/UID>[\s\S]*?<Notes>CUI\nControlled by: Alpha Builders[\s\S]*?\nCUI<\/Notes>/)
    expect(markedTitle('Hangar', null)).toBe('Hangar')
    expect(exportMspXml(g, 'Hangar')).not.toMatch(/<Subject>/)
  })
  it('Excel: the banner and designation are the first rows of every sheet; the content follows', async () => {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await exportImportXlsx(g, 'Hangar', { marking: cui }) as unknown as ArrayBuffer)
    for (const ws of wb.worksheets) {
      expect(ws.getCell(1, 1).value, ws.name).toBe('CUI')
      expect(String(ws.getCell(2, 1).value)).toMatch(/^Controlled by: Alpha Builders/)
      expect(ws.headerFooter.oddHeader).toMatch(/CUI/)
    }
    expect(wb.getWorksheet('MS Project Import')!.getCell(3, 2).value).toBe('Name')
    expect(wb.getWorksheet('TASK')!.getCell(3, 1).value).toBe('task_code')
    expect(wb.getWorksheet('TASK')!.getCell(4, 1).value).toBe('Activity ID')
    const layout = new ExcelJS.Workbook()
    await layout.xlsx.load(await exportP6LayoutXlsx(g, 'Hangar', { marking: cui }) as unknown as ArrayBuffer)
    const ws = layout.worksheets[0]
    expect(ws.getCell(1, 1).value).toBe('CUI')
    expect(ws.getCell(3, 1).value).toBe('Hangar')
    expect(ws.getCell(7, 1).value).toBe('Activity ID')
    // Unmarked exports are unchanged.
    const plain = new ExcelJS.Workbook()
    await plain.xlsx.load(await exportImportXlsx(g, 'Hangar') as unknown as ArrayBuffer)
    expect(plain.getWorksheet('MS Project Import')!.getCell(1, 2).value).toBe('Name')
    expect(plain.getWorksheet('TASK')!.getCell(1, 1).value).toBe('task_code')
  })
  it('PDF: renders with the marking', async () => {
    const bytes = await exportPdf(g, 'Hangar', null, { marking: cui })
    expect(bytes.length).toBeGreaterThan(1000)
  })
})
