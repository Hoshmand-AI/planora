import { NextResponse } from 'next/server'
import { api, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { entitlementsFor, requireFeature } from '@/lib/server/entitlements'
import { hit, LIMITS } from '@/lib/server/rate-limit'
import { getScheduleFile } from '@/lib/db'
import { loadScheduleData } from '@/lib/planning/service'
import { uploadedToGenerated } from '@/lib/planning/uploaded'
import { exportXer, exportXerFromOriginal, xerUpdatesFrom } from '@/lib/export/xer'
import { decodeXer, encodeXer } from '@/lib/parsers/xer-codec'
import { exportMspXml } from '@/lib/export/msp-xml'
import { exportScheduleCsv } from '@/lib/export/csv'
import { exportImportXlsx, exportP6LayoutXlsx } from '@/lib/export/xlsx'
import { exportLookaheadXlsx, lookaheadRows } from '@/lib/export/analysis-xlsx'
import { loadProvenance } from '@/lib/export/provenance'

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * Download an uploaded schedule, recalculated by Planora, with its own activity IDs, WBS, progress
 * and required finish:
 *   ?format=xer | xml | csv | xlsx-p6 | xlsx-import
 *   ?format=lookahead-xlsx  3-week look-ahead: activities in progress or starting within 21 days of
 *                           the data date, with remaining duration, float and predecessors
 * XLSX downloads carry provenance (source file, SHA-256, release, progress mode, settings, data date).
 *   ?format=original   the file exactly as uploaded (its SHA-256 is in the X-Content-SHA256 header)
 * An uploaded P6 file exports as its original XER with Planora's recalculated dates and float written
 * in, so everything Planora does not model (activity codes, UDFs, resources, notebooks...) is kept;
 * &rebuild=1 builds a fresh XER from Planora's model instead.
 */
export const GET = api<{ id: string }>({ permission: 'read', apiKey: true }, async (req, { params, auth }) => {
  const format = req.nextUrl.searchParams.get('format') || 'xer'
  const data = await loadScheduleData(params.id, auth.orgId)
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { schedule } = data
  const slug = `${schedule.name}-${schedule.version}`.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'schedule'
  const rl = await hit(`export:user:${auth.userId}`, LIMITS.exportsPerUser.limit, LIMITS.exportsPerUser.windowSec)
  if (!rl.ok) throw new ApiError(429, 'Too many exports in the last hour. Try again later.', 'rate_limited', { retryAfterSec: rl.retryAfterSec })

  if (format === 'original') {
    const f = await getScheduleFile(schedule.id, auth.orgId)
    if (!f) return NextResponse.json({ error: 'The original file was not kept for this upload (uploaded before files were retained).' }, { status: 404 })
    await audit({ action: 'schedule.download_original', targetType: 'schedule', targetId: schedule.id, detail: { name: schedule.name, version: schedule.version, file: f.fileName, sha256: f.sha256 } })
    return new NextResponse(f.content as unknown as BodyInit, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${f.fileName.replace(/"/g, '')}"`, 'X-Content-SHA256': f.sha256 } })
  }
  if (!['xer', 'xml', 'csv', 'xlsx-p6', 'xlsx-import', 'lookahead-xlsx'].includes(format)) return NextResponse.json({ error: 'Unknown format. Use xer, xml, csv, xlsx-p6, xlsx-import, lookahead-xlsx or original.' }, { status: 400 })
  requireFeature(auth.plan, entitlementsFor(auth.plan).exports.includes(format), `${format.toUpperCase()} export`)
  const prov = () => loadProvenance(auth.orgId, [{ schedule, analysis: data.analysis }], auth.settings.quality)
  if (format === 'lookahead-xlsx') {
    if (!schedule.dataDate) return NextResponse.json({ error: 'This schedule has no data date, so a look-ahead cannot be built.' }, { status: 400 })
    const rows = lookaheadRows(data.activities, data.relationships, schedule.dataDate, 21)
    const file = `${slug}-3-week-look-ahead.xlsx`
    const body = await exportLookaheadXlsx(rows, await prov(), { project: `${schedule.name} (${schedule.version})`, dataDate: schedule.dataDate, days: 21 })
    await audit({ action: 'schedule.export', targetType: 'schedule', targetId: schedule.id, detail: { name: schedule.name, version: schedule.version, format, file, activities: rows.length } })
    return new NextResponse(body as unknown as BodyInit, { headers: { 'Content-Type': XLSX, 'Content-Disposition': `attachment; filename="${file}"` } })
  }
  if (!data.cpm) return NextResponse.json({ error: 'This schedule has no activity relationships to export as a network.' }, { status: 400 })
  const g = uploadedToGenerated(schedule, data.activities, data.relationships, data.cpm, data.analysis)

  let body: string | Buffer, type: string, file: string
  switch (format) {
    case 'xer': {
      const original = schedule.sourceType === 'p6_xer' && req.nextUrl.searchParams.get('rebuild') !== '1' ? await getScheduleFile(schedule.id, auth.orgId) : undefined
      if (original) {
        const { text, encoding, bom } = decodeXer(original.content)
        body = encodeXer(exportXerFromOriginal(text, xerUpdatesFrom(data.activities, data.cpm), { forecastFinish: data.analysis.forecastFinish }), encoding, bom)
      } else {
        body = encodeXer(exportXer(g, schedule.name, { exportedBy: auth.name, projectShortName: schedule.name }))
      }
      type = 'application/octet-stream'; file = `${slug}.xer`; break
    }
    case 'xml': body = exportMspXml(g, schedule.name); type = 'application/xml; charset=utf-8'; file = `${slug}.xml`; break
    case 'csv': body = exportScheduleCsv(g); type = 'text/csv; charset=utf-8'; file = `${slug}.csv`; break
    case 'xlsx-import': body = await exportImportXlsx(g, schedule.name, await prov()); type = XLSX; file = `${slug}-import.xlsx`; break
    default: body = await exportP6LayoutXlsx(g, schedule.name, await prov()); type = XLSX; file = `${slug}-p6-layout.xlsx`
  }
  await audit({ action: 'schedule.export', targetType: 'schedule', targetId: schedule.id, detail: { name: schedule.name, version: schedule.version, format, file, activities: g.activities.length } })
  return new NextResponse(body as BodyInit, { headers: { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${file}"` } })
})
