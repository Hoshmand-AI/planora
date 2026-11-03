// Controlled Unclassified Information (CUI) markings on exports of CUI plans and uploads.
//
// 32 CFR 2002.20 asks for a banner marking ("CUI") at the top (and, by agency practice, the bottom) of
// every page or document and a designation indicator block ("Controlled by", "CUI Category", "POC")
// on the first page. Each format carries them where a reader will see them on opening the file:
//   - PDF and Markdown reports: banner at the top and bottom, designation block on the first page;
//   - Excel: the first rows of every sheet, plus the print header/footer;
//   - MS Project XML: the project Title, Subject and the project summary task's Notes;
//   - P6 XER: a project notebook topic (WBSMEMO on the project node) holding the banner and designation.
//     Prefixing the P6 project name is NOT a marking (it is truncated and lost on re-import);
//   - CSV cannot carry a marking a reader sees, so CUI exports refuse CSV (see CSV_CUI_REFUSAL).
// Pure, unit tested.

export type MarkingClassification = 'unclassified' | 'cui' | 'classified'

export interface ExportMarking {
  classification: 'cui' | 'classified'
  /** Banner line shown at the top and bottom */
  banner: string
  /** Designation indicator lines (first page / first rows) */
  designation: string[]
}

/** Marking for an export of data with this classification; null for unclassified or unset data. */
export function exportMarking(c: string | null | undefined, who: { controlledBy: string; poc?: string | null }): ExportMarking | null {
  if (c !== 'cui' && c !== 'classified') return null
  if (c === 'classified') {
    return {
      classification: 'classified',
      banner: 'CLASSIFIED',
      designation: [
        'Classified information. Apply the classification level, banner and portion markings required by the program security classification guide.',
        `Controlled by: ${who.controlledBy}`,
        ...(who.poc ? [`POC: ${who.poc}`] : []),
      ],
    }
  }
  return {
    classification: 'cui',
    banner: 'CUI',
    designation: [
      `Controlled by: ${who.controlledBy}`,
      'CUI Category: as designated by the contract or the controlling agency',
      'Limited dissemination: authorized holders with a lawful government purpose only',
      ...(who.poc ? [`POC: ${who.poc}`] : []),
    ],
  }
}

/** Why a CSV export of CUI is refused (CSV cannot carry a banner or designation a reader will see). */
export const CSV_CUI_REFUSAL = 'CSV exports are excluded for CUI and classified schedules: a CSV file cannot carry the required CUI banner and designation markings. Use the Excel (XLSX), PDF, MS Project XML or P6 XER export, which carry the markings.'

/** Markdown / plain-text report: banner at the top and bottom, designation block under the top banner. */
export function markText(text: string, m: ExportMarking | null): string {
  if (!m) return text
  const top = [`**${m.banner}**`, '', ...m.designation.map(l => `> ${l}`), '', '---', '']
  const bottom = ['', '---', '', `**${m.banner}**`, '']
  return [...top, text.replace(/\s+$/, ''), ...bottom].join('\n')
}

/** Rows to put first on every Excel sheet: the banner, then the designation on one line. */
export function markingRows(m: ExportMarking): string[][] {
  return [[m.banner], [m.designation.join(' · ')]]
}

/** MS Project XML title for a marked export (the title is what MS Project shows in File > Info). */
export function markedTitle(projectName: string, m: ExportMarking | null): string {
  return m ? `${m.banner} - ${projectName}` : projectName
}

const htmlEsc = (v: string) => v.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!))

/**
 * Add the marking to an XER as a project notebook topic ("CUI Marking") on each project's root WBS
 * node: a MEMOTYPE row and a WBSMEMO row per project, appended to existing tables or as new tables.
 * Every other line is kept exactly as it was.
 */
export function markXer(xer: string, m: ExportMarking | null): string {
  if (!m) return xer
  const eol = xer.includes('\r\n') ? '\r\n' : '\n'
  const endsWithNl = /(\r\n|\n|\r)$/.test(xer)
  const lines = xer.split(/\r\n|\n|\r/)
  if (endsWithNl && lines[lines.length - 1] === '') lines.pop()

  // Read the tables we need: fields and the line index of each table's last row.
  type T = { fields: string[]; rows: Record<string, string>[]; lastLine: number }
  const tables = new Map<string, T>()
  let cur: T | null = null
  lines.forEach((line, i) => {
    const cols = line.split('\t')
    const tag = cols[0].trim()
    if (tag === '%T') { cur = { fields: [], rows: [], lastLine: i }; tables.set((cols[1] || '').trim(), cur) }
    else if (tag === '%F' && cur) { cur.fields = cols.slice(1).map(f => f.trim()); cur.lastLine = i }
    else if (tag === '%R' && cur) { cur.rows.push(Object.fromEntries(cur.fields.map((f, j) => [f, cols[j + 1] ?? '']))); cur.lastLine = i }
  })
  const projNodes = (tables.get('PROJWBS')?.rows ?? []).filter(r => r['proj_node_flag'] === 'Y' && r['wbs_id'])
  if (!projNodes.length) return xer

  const maxId = (t: T | undefined, f: string) => (t?.rows ?? []).reduce((mx, r) => Math.max(mx, Number(r[f]) || 0), 0)
  const memoTypeTable = tables.get('MEMOTYPE')
  const memoTypeId = Math.max(900000, maxId(memoTypeTable, 'memo_type_id') + 1)
  const wbsMemoTable = tables.get('WBSMEMO')
  let nextMemo = Math.max(900000, maxId(wbsMemoTable, 'wbs_memo_id') + 1)
  const text = `<HTML><BODY><P><B>${htmlEsc(m.banner)}</B></P>${m.designation.map(l => `<P>${htmlEsc(l)}</P>`).join('')}<P><B>${htmlEsc(m.banner)}</B></P></BODY></HTML>`
  const row = (fields: string[], v: Record<string, string | number>) => `%R\t${fields.map(f => String(v[f] ?? '')).join('\t')}`

  const MT_FIELDS = ['memo_type_id', 'seq_num', 'eps_flag', 'proj_flag', 'wbs_flag', 'task_flag', 'memo_type']
  const WM_FIELDS = ['wbs_memo_id', 'proj_id', 'wbs_id', 'memo_type_id', 'wbs_memo']
  const mtRow = { memo_type_id: memoTypeId, seq_num: 0, eps_flag: 'N', proj_flag: 'Y', wbs_flag: 'Y', task_flag: 'N', memo_type: `${m.banner} Marking` }
  const wmRows = projNodes.map(n => ({ wbs_memo_id: nextMemo++, proj_id: n['proj_id'], wbs_id: n['wbs_id'], memo_type_id: memoTypeId, wbs_memo: text }))

  // Insert after existing tables' last rows (from the bottom up so indexes stay valid), or append new tables before %E.
  const inserts: { at: number; add: string[] }[] = []
  const appended: string[] = []
  if (memoTypeTable) inserts.push({ at: memoTypeTable.lastLine, add: [row(memoTypeTable.fields, mtRow)] })
  else appended.push('%T\tMEMOTYPE', `%F\t${MT_FIELDS.join('\t')}`, row(MT_FIELDS, mtRow))
  if (wbsMemoTable) inserts.push({ at: wbsMemoTable.lastLine, add: wmRows.map(r => row(wbsMemoTable.fields, r)) })
  else appended.push('%T\tWBSMEMO', `%F\t${WM_FIELDS.join('\t')}`, ...wmRows.map(r => row(WM_FIELDS, r)))
  inserts.sort((a, b) => b.at - a.at).forEach(ins => lines.splice(ins.at + 1, 0, ...ins.add))
  if (appended.length) {
    const end = lines.findIndex(l => l.trim() === '%E')
    if (end >= 0) lines.splice(end, 0, ...appended)
    else lines.push(...appended)
  }
  return lines.join(eol) + (endsWithNl ? eol : '')
}
