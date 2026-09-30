// PDF schedule report: a summary page (key dates, quality, assumptions) followed by a P6-style
// Gantt layout on 11×17 landscape pages — WBS bands, activity table, month timescale, critical bars.
// Uses pdf-lib's standard fonts, so no font files are needed (works air-gapped).

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { GeneratedSchedule } from '@/lib/planning/types'
import type { Evaluation } from '@/lib/planning/evaluation'
import { buildWbs } from './wbs'
import { fmtDate, fmtDates } from '@/lib/format'

const W = 1224, H = 792 // 17 × 11 in
const M = 28
const NAVY = rgb(0.059, 0.129, 0.251)
const GREY = rgb(0.42, 0.39, 0.35)
const LINE = rgb(0.85, 0.85, 0.85)
const CRIT = rgb(0.878, 0.188, 0.118)
const NONCRIT = rgb(0.235, 0.706, 0.294)
const WBS_FILL = [rgb(1, 0.9, 0.6), rgb(0.776, 0.878, 0.706), rgb(0.741, 0.843, 0.933)]

/** Standard PDF fonts only cover Windows-1252; map everything else to close ASCII. */
export function pdfSafe(text: string): string {
  return text
    .replace(/[≥]/g, '>=').replace(/[≤]/g, '<=').replace(/[→]/g, '->').replace(/[←]/g, '<-').replace(/[✓]/g, 'v').replace(/[✗]/g, 'x')
    .replace(/[◆]/g, '*').replace(/[  ]/g, ' ')
    .replace(/[^\x20-\x7e\xa0-\xff–—‘’“”•…€™]/g, '?')
}

function fit(text: string, font: PDFFont, size: number, max: number): string {
  let s = pdfSafe(text)
  if (font.widthOfTextAtSize(s, size) <= max) return s
  while (s.length > 1 && font.widthOfTextAtSize(s + '…', size) > max) s = s.slice(0, -1)
  return s + '…'
}

function wrap(text: string, font: PDFFont, size: number, max: number): string[] {
  const words = pdfSafe(text).split(/\s+/)
  const out: string[] = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (font.widthOfTextAtSize(next, size) > max && line) { out.push(line); line = w } else line = next
  }
  if (line) out.push(line)
  return out
}

export async function exportPdf(s: GeneratedSchedule, projectName: string, ev: Evaluation | null, opts: { preparedBy?: string } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(`${projectName} — Schedule`)
  doc.setProducer('Planora')
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const t = s.cpm?.times || {}
  const finish = s.cpm?.projectFinish || s.projectStart
  const printed = fmtDate(new Date().toISOString())

  const footer = (p: PDFPage, n: number) => {
    p.drawLine({ start: { x: M, y: 24 }, end: { x: W - M, y: 24 }, thickness: 0.5, color: LINE })
    p.drawText(pdfSafe(`${projectName} · Data date ${fmtDate(s.projectStart)} · Printed ${printed} · Planora`), { x: M, y: 12, size: 7, font, color: GREY })
    p.drawText(`Page ${n}`, { x: W - M - 40, y: 12, size: 7, font, color: GREY })
  }
  let pageNo = 0

  /* ── Summary page ── */
  {
    const p = doc.addPage([W, H]); pageNo++
    let y = H - M - 10
    p.drawText(fit(projectName, bold, 22, W - 2 * M), { x: M, y, size: 22, font: bold, color: NAVY }); y -= 20
    p.drawText(pdfSafe(`Schedule report · prepared ${printed}${opts.preparedBy ? ' by ' + opts.preparedBy : ''}`), { x: M, y, size: 10, font, color: GREY }); y -= 30
    const stats: [string, string][] = [
      ['Start (NTP)', fmtDate(s.projectStart)], ['Deterministic finish', fmtDate(finish)],
      ['P50 / P80 finish', ev ? `${fmtDate(ev.forecast.p50)} / ${fmtDate(ev.forecast.p80)}` : '—'],
      ['Activities', `${s.activities.length} (${s.activities.filter(a => t[a.id]?.critical).length} critical)`],
      ['Quality', ev ? `${ev.grade} (${ev.score}/100) · DCMA ${ev.dcma.passed}/${ev.dcma.applicable}` : '—'],
    ]
    const colW = (W - 2 * M) / stats.length
    stats.forEach(([k, v], i) => {
      const x = M + i * colW
      p.drawRectangle({ x, y: y - 44, width: colW - 8, height: 50, color: rgb(0.973, 0.965, 0.953), borderColor: LINE, borderWidth: 0.5 })
      p.drawText(k.toUpperCase(), { x: x + 8, y: y - 8, size: 7, font: bold, color: GREY })
      p.drawText(fit(v, bold, 13, colW - 24), { x: x + 8, y: y - 30, size: 13, font: bold, color: NAVY })
    })
    y -= 72
    const section = (title: string, items: string[], maxLines: number) => {
      if (!items.length) return
      p.drawText(title, { x: M, y, size: 11, font: bold, color: NAVY }); y -= 16
      let used = 0
      outer: for (const it of items) {
        for (const [i, l] of wrap(fmtDates(it), font, 9, W - 2 * M - 14).entries()) {
          if (used >= maxLines || y < 60) {
            p.drawText(pdfSafe(`… ${items.length} items in total — see the Basis of Schedule for the full list.`), { x: M + 12, y, size: 8, font, color: GREY })
            y -= 12
            break outer
          }
          p.drawText(i === 0 ? '•' : ' ', { x: M, y, size: 9, font, color: GREY })
          p.drawText(l, { x: M + 12, y, size: 9, font, color: rgb(0.29, 0.27, 0.24) })
          y -= 12; used++
        }
      }
      y -= 12
    }
    if (ev) section('Findings', ev.findings, 14)
    section('Assumptions and open items', s.assumptions.filter(a => a.kind !== 'inferred').map(a => `${a.text}${a.bufferDays ? ` (+${a.bufferDays} work days)` : ''}`), 18)
    section('Notes', s.notes || [], 6)
    footer(p, pageNo)
  }

  /* ── Gantt pages ── */
  const { rows } = buildWbs(s, projectName)
  const COLS = [{ k: 'ID', w: 62 }, { k: 'Activity Name', w: 250 }, { k: 'Dur', w: 30 }, { k: 'Start', w: 56 }, { k: 'Finish', w: 56 }, { k: 'TF', w: 28 }]
  const tableW = COLS.reduce((a, c) => a + c.w, 0)
  const gx0 = M + tableW + 6, gx1 = W - M
  const d0 = Date.parse(s.projectStart + 'T00:00:00Z')
  const d1 = Date.parse(finish + 'T00:00:00Z') + 86_400_000
  const span = Math.max(1, d1 - d0)
  const xOf = (iso: string, end = false) => gx0 + ((Date.parse(iso + 'T00:00:00Z') + (end ? 86_400_000 : 0) - d0) / span) * (gx1 - gx0)
  const ROW = 11
  const top = H - M - 44

  const pageHeader = (p: PDFPage) => {
    p.drawText(fit(projectName, bold, 12, 500), { x: M, y: H - M - 6, size: 12, font: bold, color: NAVY })
    p.drawText(pdfSafe(`Classic schedule layout · ${fmtDate(s.projectStart)} – ${fmtDate(finish)}`), { x: M + 510, y: H - M - 6, size: 8, font, color: GREY })
    // Column header band
    p.drawRectangle({ x: M, y: top, width: W - 2 * M, height: 26, color: NAVY })
    let x = M
    for (const c of COLS) { p.drawText(c.k, { x: x + 3, y: top + 9, size: 7.5, font: bold, color: rgb(1, 1, 1) }); x += c.w }
    // Two-tier timescale like P6: years on top, months (or quarters on long projects) below.
    const months = (d1 - d0) / (30.4 * 86_400_000)
    const step = months > 40 ? 3 : 1
    const xAt = (ms: number) => gx0 + ((Math.max(ms, d0) - d0) / span) * (gx1 - gx0)
    const mid = top + 13
    p.drawLine({ start: { x: gx0, y: mid }, end: { x: gx1, y: mid }, thickness: 0.4, color: rgb(0.45, 0.52, 0.64) })
    const firstYear = new Date(d0).getUTCFullYear(), lastYear = new Date(d1).getUTCFullYear()
    for (let yr = firstYear; yr <= lastYear; yr++) {
      const x1 = xAt(Date.UTC(yr, 0, 1)), x2 = Math.min(gx1, xAt(Date.UTC(yr + 1, 0, 1)))
      p.drawLine({ start: { x: x1, y: mid }, end: { x: x1, y: top + 26 }, thickness: 0.4, color: rgb(0.45, 0.52, 0.64) })
      if (x2 - x1 > 22) p.drawText(String(yr), { x: x1 + 3, y: mid + 4, size: 7, font: bold, color: rgb(1, 1, 1) })
    }
    const first = new Date(d0)
    let m = Date.UTC(first.getUTCFullYear(), Math.floor(first.getUTCMonth() / step) * step, 1)
    while (m < d1) {
      const d = new Date(m)
      const nd = new Date(m); nd.setUTCMonth(nd.getUTCMonth() + step)
      const x1 = xAt(m), x2 = Math.min(gx1, xAt(nd.getTime()))
      p.drawLine({ start: { x: x1, y: top }, end: { x: x1, y: mid }, thickness: 0.3, color: rgb(0.45, 0.52, 0.64) })
      const label = step === 1 ? d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) : `Q${Math.floor(d.getUTCMonth() / 3) + 1}`
      const lw = font.widthOfTextAtSize(label, 6)
      if (x2 - x1 > lw + 3) p.drawText(label, { x: x1 + (x2 - x1 - lw) / 2, y: top + 4, size: 6, font, color: rgb(1, 1, 1) })
      m = nd.getTime()
    }
  }

  let p: PDFPage | null = null
  let y = 0
  const newPage = () => { if (p) footer(p, pageNo); p = doc.addPage([W, H]); pageNo++; pageHeader(p); y = top - ROW }
  newPage()
  for (const r of rows) {
    if (y < 34) newPage()
    const pg = p as unknown as PDFPage
    const isWbs = r.kind === 'wbs'
    const lvl = r.level
    if (isWbs) pg.drawRectangle({ x: M, y: y - 2.5, width: W - 2 * M, height: ROW, color: WBS_FILL[(lvl - 1) % WBS_FILL.length] })
    const f = isWbs ? bold : font
    const tm = r.times
    const a = r.activity
    const vals = isWbs
      ? [r.code, r.name, '', fmtDate(r.node!.start), fmtDate(r.node!.finish), '']
      : [a!.code, a!.name, a!.type === 'milestone' ? '0' : String(a!.duration), fmtDate(tm?.earlyStart), fmtDate(tm?.earlyFinish), String(tm?.totalFloat ?? '')]
    let x = M
    COLS.forEach((c, i) => {
      const indent = i === 1 ? (lvl - 1) * 8 : 0
      const color = !isWbs && tm?.critical && i === 5 ? CRIT : rgb(0.15, 0.15, 0.15)
      pg.drawText(fit(vals[i], f, 6.8, c.w - 5 - indent), { x: x + 3 + indent, y, size: 6.8, font: f, color })
      x += c.w
    })
    // Bars
    const st = isWbs ? r.node!.start : tm?.earlyStart
    const fi = isWbs ? r.node!.finish : tm?.earlyFinish
    if (st && fi) {
      if (!isWbs && a!.type === 'milestone') {
        const cx = xOf(st, true), cy = y + 2.5
        pg.drawSvgPath(`M ${cx} ${-cy - 4} L ${cx + 4} ${-cy} L ${cx} ${-cy + 4} L ${cx - 4} ${-cy} Z`, { x: 0, y: 0, color: tm?.critical ? CRIT : NAVY })
      } else {
        const bx = xOf(st), bw = Math.max(1.2, xOf(fi, true) - bx)
        pg.drawRectangle({ x: bx, y: y + (isWbs ? 0.5 : -0.5), width: bw, height: isWbs ? 3 : 6, color: isWbs ? rgb(0.12, 0.12, 0.12) : tm?.critical ? CRIT : NONCRIT })
        if (!isWbs && bx + bw + 60 < gx1) pg.drawText(fit(a!.name, font, 5.5, 180), { x: bx + bw + 3, y: y, size: 5.5, font, color: GREY })
      }
    }
    pg.drawLine({ start: { x: M, y: y - 2.5 }, end: { x: W - M, y: y - 2.5 }, thickness: 0.2, color: LINE })
    y -= ROW
  }
  // Legend on the last Gantt page
  const last = p as unknown as PDFPage
  const ly = Math.max(30, y - 6)
  last.drawRectangle({ x: M, y: ly, width: 14, height: 5, color: CRIT }); last.drawText('Critical', { x: M + 18, y: ly, size: 7, font })
  last.drawRectangle({ x: M + 70, y: ly, width: 14, height: 5, color: NONCRIT }); last.drawText('Non-critical', { x: M + 88, y: ly, size: 7, font })
  last.drawRectangle({ x: M + 160, y: ly + 1, width: 14, height: 3, color: rgb(0.12, 0.12, 0.12) }); last.drawText('WBS summary', { x: M + 178, y: ly, size: 7, font })
  footer(last, pageNo)

  return doc.save()
}
