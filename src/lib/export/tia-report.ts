// Time Impact Analysis report: Markdown (the report the app shows and downloads), a deterministic
// template narrative, Excel (one sheet per table) and PDF. Every format carries the disclaimer that
// separates calculation from conclusion, the assumptions, the evidence references with their links,
// provenance, and the inputs / result hashes that make the run reproducible.
// Dates are MM/DD/YYYY; impacts are calendar days (cd) and work days (wd). Pure apart from rendering.

import ExcelJS from 'exceljs'
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib'
import { fmtDate, fmtDates } from '@/lib/format'
import { RESPONSIBILITY_LABELS, TIA_DISCLAIMER, type DelayEvent, type TiaResult, type TiaRun } from '@/lib/analysis/tia'
import { addProvenance, provenanceMarkdown, type Provenance } from './provenance'
import { markingRows, type ExportMarking } from './markings'
import { neutralizeFormula } from './csv'
import { pdfSafe } from './pdf'

const d = (v: string | null | undefined) => (v ? fmtDate(v) : '—')
const signed = (n: number | null | undefined) => (n == null ? '—' : n > 0 ? `+${n}` : String(n))
const cell = (v: unknown) => String(v ?? '—').replace(/\|/g, '/').replace(/\s+/g, ' ')
const table = (head: string[], rows: unknown[][]) => rows.length
  ? [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.map(cell).join(' | ')} |`)].join('\n')
  : '_None._'
const STATUS_LABELS = { draft: 'Draft', analyzed: 'Analysed', accepted: 'Accepted', rejected: 'Rejected' } as const
const INDICATOR = { slipped_since_previous: 'Slipped since previous update', late_start_since_previous: 'Not started as forecast in previous update', late_vs_baseline: 'Late against baseline' } as const

export const MILESTONE_HEAD = ['ID', 'Milestone', 'Kind', 'Contract date', 'Before (logic)', 'After (logic)', 'Impact cd', 'Impact wd', 'Before (as scheduled)', 'After (as scheduled)', 'Impact cd (as scheduled)', 'Float before (wd)', 'Float after (wd)', 'Float change (wd)', 'Late vs contract after (cd)']
export function milestoneRows(r: TiaResult): unknown[][] {
  return r.milestones.map(m => [m.code, m.name, m.kind === 'contract' ? 'Contract' : m.kind === 'interim' ? 'Interim (constrained)' : 'Milestone', m.contractDate ? `${d(m.contractDate)}${m.contractSource ? ` (${m.contractSource})` : ''}` : '—',
    d(m.before.logic), d(m.after.logic), signed(m.impactCd.logic), signed(m.impactWd.logic), d(m.before.scheduled), d(m.after.scheduled), signed(m.impactCd.scheduled),
    m.before.totalFloat ?? '—', m.after.totalFloat ?? '—', signed(m.floatChange), signed(m.lateVsContract.after)])
}

/**
 * The template narrative (no model): explains the computed results only, citing activity codes. The
 * same result always gives the same text.
 */
export function tiaNarrative(r: TiaResult, e: Pick<DelayEvent, 'title' | 'responsibility' | 'eventStart' | 'eventEnd' | 'description'>): string {
  if (!r.ok) return `The fragnet for "${e.title}" could not be analysed: ${r.validation.errors.join(' ')}`
  const p: string[] = []
  const frag = r.fragnet
  const cm = r.milestones.find(m => m.kind === 'contract')
  p.push(`The delay event "${e.title}"${e.eventStart ? `, which began ${d(e.eventStart)}${e.eventEnd ? ` and ended ${d(e.eventEnd)}` : ''},` : ''} was modelled as a fragnet of ${frag.length} activit${frag.length === 1 ? 'y' : 'ies'} (${frag.map(f => `${f.code} ${f.name}, ${f.duration} wd`).join('; ')}) and inserted into ${r.update.name} (${r.update.version}) as of its data date ${d(r.update.dataDate)}. The responsibility label entered for the event is "${RESPONSIBILITY_LABELS[e.responsibility] ?? e.responsibility}"; it is recorded as entered and is not assessed by this analysis.`)
  if (cm) {
    const moved = (cm.impactCd.logic ?? 0) !== 0
    p.push(`After recalculation, the contract milestone ${cm.code} ${cm.name} ${moved ? `moves from ${d(cm.before.logic)} to ${d(cm.after.logic)} on its logic-driven date, ${signed(cm.impactCd.logic)} calendar days (${signed(cm.impactWd.logic)} work days on the ${cm.calendar} calendar)` : `stays on ${d(cm.after.logic)}`}. Its total float changes from ${cm.before.totalFloat ?? '—'} to ${cm.after.totalFloat ?? '—'} work days.${cm.impactCd.scheduled !== cm.impactCd.logic ? ` As scheduled (constraints honoured) it shows ${d(cm.before.scheduled)} → ${d(cm.after.scheduled)} (${signed(cm.impactCd.scheduled)} calendar days), because a mandatory constraint holds the scheduled date.` : ''}${cm.contractDate ? ` Against the contract date ${d(cm.contractDate)} the logic-driven date is ${signed(cm.lateVsContract.before)} calendar days before the fragnet and ${signed(cm.lateVsContract.after)} after.` : ''}`)
  }
  p.push(`The project finish (all work) is ${d(r.projectFinish.before.logic)} before and ${d(r.projectFinish.after.logic)} after insertion (${signed(r.projectFinish.impactCd.logic)} calendar days).`)
  p.push(r.drivingPath.fragnetOnPath.length
    ? `After insertion the driving path to ${r.drivingPath.target ?? 'the project finish'} runs ${r.drivingPath.after.map(s => s.code).join(' → ')}; fragnet activit${r.drivingPath.fragnetOnPath.length === 1 ? 'y' : 'ies'} ${r.drivingPath.fragnetOnPath.join(', ')} ${r.drivingPath.fragnetOnPath.length === 1 ? 'is' : 'are'} on it. Before insertion it ran ${r.drivingPath.before.map(s => s.code).join(' → ') || '—'}.`
    : `No fragnet activity is on the driving path to ${r.drivingPath.target ?? 'the project finish'} after insertion; the fragnet ${frag.some(f => (f.totalFloat ?? 0) >= 0) ? `keeps ${frag.map(f => `${f.code} ${f.totalFloat ?? '—'} wd`).join(', ')} of total float` : 'is absorbed'}.`)
  const others = r.milestones.filter(m => m.kind !== 'contract' && (m.impactCd.logic ?? 0) !== 0)
  if (others.length) p.push(`Other milestones that move: ${others.map(m => `${m.code} ${m.name} ${signed(m.impactCd.logic)} cd`).join('; ')}.`)
  if (r.concurrency.flags.length) {
    p.push(`${r.concurrency.flags.length} activit${r.concurrency.flags.length === 1 ? 'y' : 'ies'} on the driving path before insertion ${r.concurrency.flags.length === 1 ? 'was' : 'were'} already slipping (${r.concurrency.basis === 'previous_update' ? `compared with ${r.concurrency.comparedWith}` : 'compared with the baseline'}): ${r.concurrency.flags.map(f => f.code).join(', ')}. These are indicators of potential concurrent delay only and require analyst judgment.`)
  } else if (r.concurrency.basis === 'none') {
    p.push('No previous update or baseline was available, so no concurrency indicators were computed.')
  }
  p.push('This narrative describes a schedule calculation. It makes no finding on entitlement, excusability, compensability or responsibility.')
  return p.join('\n\n')
}

export interface TiaReportInput {
  event: DelayEvent
  run: Pick<TiaRun, 'id' | 'createdAt' | 'createdByName' | 'createdBy' | 'inputsHash' | 'resultHash' | 'engine'> & { result: TiaResult }
  provenance?: Provenance | null
  /** An AI-written explanation (validated) to use instead of the template narrative */
  narrative?: { text: string; source: 'ai' | 'template'; model?: string | null } | null
  /** Notes on the run that are not part of the calculation (e.g. the update is not recorded as accepted) */
  notes?: string[]
}

/** The TIA report as Markdown. */
export function tiaMarkdown(input: TiaReportInput): string {
  const { event: e, run } = input
  const r = run.result
  const out: string[] = []
  out.push(`# Time Impact Analysis — ${e.title}`, '')
  out.push(`**${r.update.name} (${r.update.version})** · data date ${d(r.update.dataDate)} · basis: ${r.update.basis === 'scenario' && r.update.editsApplied ? `with ${r.update.editsApplied} Planora edits (a what-if scenario)` : 'as submitted'} · run ${fmtDate(run.createdAt)}${run.createdByName ? ` by ${run.createdByName}` : ''}`, '')
  for (const n of input.notes ?? []) out.push(`**Note:** ${n}`, '')
  out.push('## Calculation, not conclusion', '', `> ${TIA_DISCLAIMER}`, '')
  out.push('## Delay event', '', table(['Item', 'Value'], [
    ['Title', e.title],
    ['Description', e.description ?? '—'],
    ['Responsibility (label entered by the user, not a determination)', RESPONSIBILITY_LABELS[e.responsibility] ?? e.responsibility],
    ['Event start / end', `${d(e.eventStart)} / ${d(e.eventEnd)}`],
    ['Notice date', d(e.notifiedOn)],
    ['Status', `${STATUS_LABELS[e.status]}${e.statusNote ? ` — ${e.statusNote}` : ''}`],
  ]), '')
  out.push('### Evidence', '', e.evidence.length ? e.evidence.map(x => `- ${x.label.replace(/[[\]]/g, '')}${x.url ? ` — <${x.url}>` : ''}`).join('\n') : '_No evidence references recorded._', '')
  if (!r.ok) {
    out.push('## Validation', '', ...r.validation.errors.map(x => `- **Error:** ${x}`), ...r.validation.warnings.map(x => `- Warning: ${x}`), '')
  } else {
    out.push('## Findings (calculated)', '', ...r.findings.map(f => `- ${f}`), '')
    const nar = input.narrative ?? { text: tiaNarrative(r, e), source: 'template' as const }
    out.push('## Narrative', '', nar.source === 'ai' ? `_Written by an AI model${nar.model ? ` (${nar.model})` : ''} from the computed results only; the tables below are Planora's calculation and govern._` : '_Template narrative generated from the computed results (no AI model)._', '', nar.text, '')
    out.push('## Milestone impact', '', 'Impact = after − before (+ = later). "Logic" dates relax mandatory constraints; "as scheduled" dates honour them.', '', table(MILESTONE_HEAD, milestoneRows(r)), '')
    out.push('## Project finish', '', table(['', 'Before', 'After', 'Impact cd', `Impact wd (${r.projectFinish.calendar})`], [
      ['Logic-driven', d(r.projectFinish.before.logic), d(r.projectFinish.after.logic), signed(r.projectFinish.impactCd.logic), signed(r.projectFinish.impactWd.logic)],
      ['As scheduled', d(r.projectFinish.before.scheduled), d(r.projectFinish.after.scheduled), signed(r.projectFinish.impactCd.scheduled), signed(r.projectFinish.impactWd.scheduled)],
    ]), '')
    out.push('## Fragnet', '', table(['ID', 'Activity', 'Duration (wd)', 'Calendar', 'Earliest start', 'Start', 'Finish', 'Total float (wd)', 'On driving path'],
      r.fragnet.map(f => [f.code, f.name, f.duration, f.calendar, d(f.startNoEarlierThan), d(f.start), d(f.finish), f.totalFloat ?? '—', f.onDrivingPath ? 'Yes' : 'No'])), '')
    const logic = (e.fragnet.relationships ?? []).map(l => [l.from, l.to, l.type, l.lag])
    out.push('### Fragnet logic', '', table(['Predecessor', 'Successor', 'Type', 'Lag (wd)'], logic), '')
    const path = (steps: TiaResult['drivingPath']['before']) => table(['#', 'ID', 'Activity', 'Start', 'Finish', 'Float (wd)', 'Fragnet'], steps.map((s, i) => [i + 1, s.code, s.name, d(s.start), d(s.finish), s.totalFloat ?? '—', s.fragnet ? 'Yes' : '']))
    out.push(`## Driving path to ${r.drivingPath.target ?? 'the project finish'}`, '', `### Before (${r.drivingPath.basisBefore === 'logic' ? 'logic-driven' : 'as scheduled'})`, '', path(r.drivingPath.before), '', `### After (${r.drivingPath.basisAfter === 'logic' ? 'logic-driven' : 'as scheduled'})`, '', path(r.drivingPath.after), '')
    out.push('## Concurrency indicators', '', `Basis: ${r.concurrency.basis === 'previous_update' ? `comparison with ${r.concurrency.comparedWith}` : r.concurrency.basis === 'baseline' ? 'baseline dates (no previous update available)' : 'none available'}; period ${d(r.concurrency.period.from)} to ${d(r.concurrency.period.to)}. Each flag is a **potential concurrent delay — requires analyst judgment**.`, '',
      table(['ID', 'Activity', 'Indicator', 'Slip (cd)', 'Overlaps event', 'Detail'], r.concurrency.flags.map(f => [f.code, f.name, INDICATOR[f.indicator], signed(f.slipCd), f.overlapsEvent ? 'Yes' : 'No', f.detail])), '')
    if (r.validation.warnings.length || r.warnings.length) out.push('## Warnings', '', ...[...r.validation.warnings, ...r.warnings].map(w => `- ${w}`), '')
  }
  out.push('## Assumptions', '', ...(r.assumptions.length ? r.assumptions.map(a => `- ${a}`) : ['_The fragnet was not analysed._']), '')
  out.push('## Reproducibility', '', table(['Item', 'Value'], [['Engine', run.engine], ['Inputs hash (SHA-256)', run.inputsHash], ['Result hash (SHA-256)', run.resultHash], ['Run id', run.id]]), '')
  if (input.provenance) out.push(...provenanceMarkdown(input.provenance))
  return fmtDates(out.join('\n'))
}

/* ─── Excel ─────────────────────────────────────────── */

const safe = (v: unknown) => (v == null ? '' : typeof v === 'string' ? neutralizeFormula(fmtDates(v)) : v)

function sheet(wb: ExcelJS.Workbook, name: string, head: string[], rows: unknown[][], widths: number[] = []) {
  const ws = wb.addWorksheet(name.slice(0, 31))
  ws.columns = head.map((h, i) => ({ header: h, key: `c${i}`, width: widths[i] ?? 16 }))
  for (const r of rows) ws.addRow(Object.fromEntries(r.map((v, i) => [`c${i}`, safe(v)])))
  const h = ws.getRow(1)
  h.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  h.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2140' } }; c.alignment = { vertical: 'middle', wrapText: true } })
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  return ws
}

export async function exportTiaXlsx(input: TiaReportInput, prov: Provenance, marking?: ExportMarking | null): Promise<Buffer> {
  const { event: e, run } = input
  const r = run.result
  const wb = new ExcelJS.Workbook()
  addProvenance(wb, prov, `Time Impact Analysis — ${e.title}`)
  sheet(wb, 'Summary', ['Item', 'Value'], [
    ['Disclaimer', TIA_DISCLAIMER],
    ['Delay event', e.title], ['Description', e.description ?? ''],
    ['Responsibility (label entered by the user, not a determination)', RESPONSIBILITY_LABELS[e.responsibility] ?? e.responsibility],
    ['Event start', d(e.eventStart)], ['Event end', d(e.eventEnd)], ['Notice date', d(e.notifiedOn)], ['Status', STATUS_LABELS[e.status]],
    ['Update', `${r.update.name} (${r.update.version})`], ['Data date', d(r.update.dataDate)], ['Basis', r.update.basis === 'scenario' && r.update.editsApplied ? `with ${r.update.editsApplied} Planora edits` : 'as submitted'],
    ...r.findings.map((f, i) => [`Finding ${i + 1}`, f]),
    ...r.validation.errors.map(x => ['Validation error', x]),
    ['Engine', run.engine], ['Inputs hash (SHA-256)', run.inputsHash], ['Result hash (SHA-256)', run.resultHash], ['Run', `${fmtDate(run.createdAt)}${run.createdByName ? ` by ${run.createdByName}` : ''}`],
  ], [44, 120]).getColumn(2).alignment = { wrapText: true, vertical: 'top' }
  sheet(wb, 'Milestone impact', MILESTONE_HEAD, milestoneRows(r))
  sheet(wb, 'Fragnet', ['ID', 'Activity', 'Duration (wd)', 'Calendar', 'Earliest start', 'Start', 'Finish', 'Total float (wd)', 'On driving path'], r.fragnet.map(f => [f.code, f.name, f.duration, f.calendar, d(f.startNoEarlierThan), d(f.start), d(f.finish), f.totalFloat, f.onDrivingPath ? 'Yes' : 'No']))
  sheet(wb, 'Fragnet logic', ['Predecessor', 'Successor', 'Type', 'Lag (wd)'], (e.fragnet.relationships ?? []).map(l => [l.from, l.to, l.type, l.lag]))
  const path = (steps: TiaResult['drivingPath']['before']) => steps.map((s, i) => [i + 1, s.code, s.name, d(s.start), d(s.finish), s.totalFloat, s.fragnet ? 'Yes' : ''])
  const ph = ['#', 'ID', 'Activity', 'Start', 'Finish', 'Float (wd)', 'Fragnet']
  sheet(wb, 'Driving path before', ph, path(r.drivingPath.before))
  sheet(wb, 'Driving path after', ph, path(r.drivingPath.after))
  sheet(wb, 'Concurrency', ['ID', 'Activity', 'Indicator', 'Slip (cd)', 'Overlaps event', 'Detail', 'Note'], r.concurrency.flags.map(f => [f.code, f.name, INDICATOR[f.indicator], f.slipCd, f.overlapsEvent ? 'Yes' : 'No', f.detail, f.label]))
  sheet(wb, 'Evidence', ['Reference', 'Link'], e.evidence.map(x => [x.label, x.url ?? '']), [60, 80])
  sheet(wb, 'Assumptions', ['Assumption'], [...r.assumptions, ...r.validation.warnings.map(w => `Warning: ${w}`), ...r.warnings.map(w => `Warning: ${w}`)].map(a => [a]), [140])
  if (marking) {
    wb.worksheets.forEach((ws, i) => {
      ws.headerFooter = { oddHeader: `&C&B${marking.banner}`, oddFooter: `&C&B${marking.banner}&R&P / &N` }
      if (i === 0) ws.insertRows(1, markingRows(marking))
    })
  }
  return Buffer.from(await wb.xlsx.writeBuffer())
}

/* ─── PDF ───────────────────────────────────────────── */

function wrap(text: string, font: PDFFont, size: number, max: number): string[] {
  const out: string[] = []
  for (const para of pdfSafe(text).split('\n')) {
    let line = ''
    for (const w of para.split(/\s+/)) {
      const next = line ? `${line} ${w}` : w
      if (font.widthOfTextAtSize(next, size) > max && line) { out.push(line); line = w } else line = next
    }
    out.push(line)
  }
  return out
}

/** The Markdown report laid out as a letter-size PDF (headings, paragraphs, tables as rows). */
export async function exportTiaPdf(markdown: string, title: string, marking?: ExportMarking | null): Promise<Uint8Array> {
  const W = 612, H = 792, M = 48
  const doc = await PDFDocument.create()
  doc.setTitle(pdfSafe(title))
  doc.setProducer('Planora')
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const NAVY = rgb(0.059, 0.129, 0.251), TEXT = rgb(0.2, 0.19, 0.17), GREY = rgb(0.36, 0.34, 0.31)
  let page = doc.addPage([W, H])
  let y = H - M
  let n = 1
  const decorate = () => {
    if (marking) {
      const bw = bold.widthOfTextAtSize(marking.banner, 10)
      page.drawText(marking.banner, { x: (W - bw) / 2, y: H - 22, size: 10, font: bold, color: rgb(0.48, 0.12, 0.07) })
      page.drawText(marking.banner, { x: (W - bw) / 2, y: 30, size: 10, font: bold, color: rgb(0.48, 0.12, 0.07) })
    }
    page.drawText(pdfSafe(`${title} · Planora · page ${n}`).slice(0, 120), { x: M, y: 16, size: 7, font, color: GREY })
  }
  decorate()
  const ensure = (h: number) => {
    if (y - h < M) { page = doc.addPage([W, H]); n++; y = H - M; decorate() }
  }
  const write = (text: string, f: PDFFont, size: number, color = TEXT, indent = 0, gap = 3) => {
    for (const l of wrap(text, f, size, W - 2 * M - indent)) {
      ensure(size + gap)
      page.drawText(l, { x: M + indent, y: y - size, size, font: f, color })
      y -= size + gap
    }
  }
  if (marking) for (const l of marking.designation) write(l, font, 8, GREY)
  for (const raw of markdown.split('\n')) {
    const line = raw.replace(/\*\*/g, '').replace(/<(https?:[^>]+)>/g, '$1')
    if (!line.trim()) { y -= 5; continue }
    if (/^\|[-|\s]+\|$/.test(line)) continue
    if (line.startsWith('# ')) { y -= 4; write(line.slice(2), bold, 16, NAVY); continue }
    if (line.startsWith('## ')) { y -= 6; write(line.slice(3), bold, 12.5, NAVY); continue }
    if (line.startsWith('### ')) { y -= 3; write(line.slice(4), bold, 10.5, NAVY); continue }
    if (line.startsWith('|')) { write(line.split('|').slice(1, -1).map(c => c.trim()).join('  ·  '), font, 8, TEXT, 6, 2); continue }
    if (line.startsWith('> ')) { write(line.slice(2), font, 9, GREY, 10); continue }
    if (line.startsWith('- ')) { write(`•  ${line.slice(2)}`, font, 9, TEXT, 6); continue }
    write(line.replace(/^_(.*)_$/, '$1'), font, 9)
  }
  return doc.save()
}
