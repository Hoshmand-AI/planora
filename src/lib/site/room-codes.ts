// The sheet of room codes for one level: a page of square codes, one per room, to print and post at each door.
// Scanning one with a phone's camera opens RunF9 on a new capture with the level and room already filled in,
// which is how two identical rooms on two floors are told apart without anyone typing.

import QRCode from 'qrcode'
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib'
import { roomCodePath, type SitePlan } from './plan'

// Letter paper, six codes a page (two across, three down).
const PAGE_W = 612, PAGE_H = 792, MARGIN = 36, COLS = 2, ROWS = 3

/** Text the standard PDF fonts can draw: anything outside Latin-1 becomes "?" instead of failing the page. */
const latin = (s: string) => s.replace(/[^\x20-\x7e\xa0-\xff]/g, '?')
function fit(text: string, font: PDFFont, size: number, max: number): string {
  let t = latin(text)
  if (font.widthOfTextAtSize(t, size) <= max) return t
  while (t.length > 1 && font.widthOfTextAtSize(t + '...', size) > max) t = t.slice(0, -1)
  return t.trimEnd() + '...'
}

export async function roomCodesPdf(origin: string, scheduleId: string, projectName: string, plan: Pick<SitePlan, 'level' | 'rooms'>): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(latin(`Room codes: ${plan.level}`)); pdf.setCreator('RunF9')
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold), regular = await pdf.embedFont(StandardFonts.Helvetica)
  const cellW = (PAGE_W - 2 * MARGIN) / COLS, cellH = (PAGE_H - 2 * MARGIN) / ROWS
  const ink = rgb(0.07, 0.09, 0.15), grey = rgb(0.35, 0.37, 0.42), line = rgb(0.8, 0.8, 0.8)
  const rooms = [...plan.rooms].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
  rooms.forEach((room, i) => {
    const slot = i % (COLS * ROWS)
    const page = slot === 0 ? pdf.addPage([PAGE_W, PAGE_H]) : pdf.getPage(pdf.getPageCount() - 1)
    const x0 = MARGIN + (slot % COLS) * cellW, yTop = PAGE_H - MARGIN - Math.floor(slot / COLS) * cellH
    // A cut line around each code
    page.drawRectangle({ x: x0 + 4, y: yTop - cellH + 4, width: cellW - 8, height: cellH - 8, borderColor: line, borderWidth: 0.5 })
    const qr = QRCode.create(origin + roomCodePath(scheduleId, plan.level, room.name), { errorCorrectionLevel: 'M' })
    const n = qr.modules.size, side = 150, quiet = 4, unit = side / (n + 2 * quiet)
    const qx = x0 + (cellW - side) / 2, qy = yTop - 20 - side
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (qr.modules.get(r, c)) page.drawRectangle({ x: qx + (c + quiet) * unit, y: qy + side - (r + quiet + 1) * unit, width: unit + 0.05, height: unit + 0.05, color: ink })
    }
    const max = cellW - 32
    const name = fit(room.name, bold, 15, max), level = fit(plan.level, regular, 11, max), project = fit(projectName, regular, 8, max), hint = 'Scan with a phone camera to file a photo here.'
    const centre = (t: string, f: PDFFont, s: number) => x0 + (cellW - f.widthOfTextAtSize(t, s)) / 2
    page.drawText(name, { x: centre(name, bold, 15), y: qy - 16, size: 15, font: bold, color: ink })
    page.drawText(level, { x: centre(level, regular, 11), y: qy - 32, size: 11, font: regular, color: ink })
    page.drawText(hint, { x: centre(hint, regular, 8), y: qy - 48, size: 8, font: regular, color: grey })
    page.drawText(project, { x: centre(project, regular, 8), y: qy - 59, size: 8, font: regular, color: grey })
  })
  if (!rooms.length) pdf.addPage([PAGE_W, PAGE_H]).drawText('No rooms are marked on this drawing yet.', { x: MARGIN, y: PAGE_H - MARGIN - 20, size: 12, font: regular, color: ink })
  return pdf.save()
}
