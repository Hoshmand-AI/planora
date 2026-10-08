import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { api, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { entitlementsFor, requireFeature } from '@/lib/server/entitlements'
import { hit, LIMITS } from '@/lib/server/rate-limit'
import { getScheduleFile } from '@/lib/db'
import { basisFrom, loadScheduleData } from '@/lib/planning/service'
import { uploadedToGenerated } from '@/lib/planning/uploaded'
import { exportXer, exportXerFromOriginal, xerEditsFrom, xerUpdatesFrom } from '@/lib/export/xer'
import { decodeXer, encodeXer } from '@/lib/parsers/xer-codec'
import { exportMspXml } from '@/lib/export/msp-xml'
import { exportScheduleCsv } from '@/lib/export/csv'
import { exportImportXlsx, exportP6LayoutXlsx } from '@/lib/export/xlsx'
import { CSV_CUI_REFUSAL, exportMarking, markXer } from '@/lib/export/markings'
import { scheduleClassification } from '@/lib/server/classification'
import { exportLookaheadXlsx, lookaheadRows } from '@/lib/export/analysis-xlsx'
import { loadProvenance } from '@/lib/export/provenance'
import { exportExceptions, type ExportExceptionFormat } from '@/lib/export/exceptions'
import { exceptionHeader, summarizeExceptions } from '@/lib/parsers/exceptions'

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
 * Basis: every export is the schedule AS SUBMITTED unless the request asks for the what-if scenario
 * (&basis=scenario or &scenario=1). Only the scenario carries the edits made in Planora: written into
 * the original XER (durations, constraints, TASKPRED rows), and in the other formats through the edited
 * network, with their reasons as notes; its file name says "with-N-edits" and its provenance says
 * "derived from <sha> with N edits" rather than printing the original file's SHA-256 as the content's.
 * Export exceptions: every download says what the format could not carry (header
 * X-Planora-Export-Exceptions; XLSX also in the Provenance sheet); &exceptions=json returns that report
 * as JSON instead of the file.
 */
export const GET = api<{ id: string }>({ permission: 'read', apiKey: true }, async (req, { params, auth }) => {
  const format = req.nextUrl.searchParams.get('format') || 'xer'
  const basis = basisFrom(req.nextUrl.searchParams)
  const loaded = await loadScheduleData(params.id, auth.orgId, { basis })
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Exports carry the file's own baseline (P6 target) dates, not the baseline the analysis resolved.
  const data = { ...loaded, activities: loaded.fileActivities }
  const { schedule } = data
  // Edits in this export: only the scenario carries them.
  const scenarioEdits = basis === 'scenario' ? data.edits : []
  const editsApplied = basis === 'scenario' ? data.editsApplied : 0
  const slug = (`${schedule.name}-${schedule.version}`.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'schedule') + (editsApplied ? `-with-${editsApplied}-planora-edit${editsApplied === 1 ? '' : 's'}` : '')
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
  // CUI / classified uploads (or schedules built from such a plan) carry markings on every export.
  const classification = await scheduleClassification(schedule.id, auth.orgId).catch(() => 'classified' as const)
  const marking = exportMarking(classification, { controlledBy: auth.orgName, poc: auth.name })
  if (marking && format === 'csv') return NextResponse.json({ error: CSV_CUI_REFUSAL, code: 'cui_csv_excluded' }, { status: 409 })
  const prov = async (exceptions?: ReturnType<typeof exportExceptions>) => ({ ...await loadProvenance(auth.orgId, [{ schedule, analysis: data.analysis, editsApplied }], auth.settings.quality), exceptions })
  if (format === 'lookahead-xlsx') {
    if (!schedule.dataDate) return NextResponse.json({ error: 'This schedule has no data date, so a look-ahead cannot be built.' }, { status: 400 })
    const rows = lookaheadRows(data.activities, data.relationships, schedule.dataDate, 21)
    const file = `${slug}-3-week-look-ahead.xlsx`
    const body = await exportLookaheadXlsx(rows, await prov(), { project: `${schedule.name} (${schedule.version})`, dataDate: schedule.dataDate, days: 21 }, marking)
    await audit({ action: 'schedule.export', targetType: 'schedule', targetId: schedule.id, detail: { name: schedule.name, version: schedule.version, format, file, basis, editsInPlanora: editsApplied, activities: rows.length, marking: marking?.banner ?? null, sha256: createHash('sha256').update(body).digest('hex') } })
    return new NextResponse(body as unknown as BodyInit, { headers: { 'Content-Type': XLSX, 'Content-Disposition': `attachment; filename="${file}"` } })
  }
  if (!data.cpm) return NextResponse.json({ error: 'This schedule has no activity relationships to export as a network.' }, { status: 400 })
  const g = uploadedToGenerated(schedule, data.activities, data.relationships, data.cpm, data.analysis, scenarioEdits)
  // P6's progress option: written into the export when the scheduler changed it from the file's own.
  const mode = data.analysis.progressMode
  const fileMode = data.analysis.fileProgressMode ?? null
  const changedMode = fileMode ? (mode !== fileMode ? mode : null) : mode === 'override' ? mode : null

  // What this format cannot carry: the file's own unmapped data, activities the export model leaves
  // out (WBS summaries; level of effort outside MS Project XML), and the format's own limits.
  const original = format === 'xer' && schedule.sourceType === 'p6_xer' && req.nextUrl.searchParams.get('rebuild') !== '1' ? await getScheduleFile(schedule.id, auth.orgId) : undefined
  const exKey: ExportExceptionFormat = original ? 'xer-original' : format === 'xlsx-import' || format === 'xlsx-p6' || format === 'xml' || format === 'csv' ? format : format === 'xer' ? 'xer' : 'xlsx-p6'
  const mspG = format === 'xml' ? uploadedToGenerated(schedule, data.activities, data.relationships, data.cpm, data.analysis, data.edits, { includeLoe: true }) : null
  const exceptions = exportExceptions(mspG ?? g, exKey, {
    importReport: schedule.importExceptions ?? null, progressMode: mode,
    excluded: data.activities.filter(a => a.activityType === 'summary' || a.activityType === 'loe').map(a => ({ code: a.activityId, type: a.activityType === 'loe' ? 'loe' as const : 'summary' as const })),
  })
  if (req.nextUrl.searchParams.get('exceptions') === 'json') {
    return NextResponse.json({ format, basis, exceptions, summary: summarizeExceptions(exceptions) })
  }

  let body: string | Buffer, type: string, file: string
  switch (format) {
    case 'xer': {
      if (original) {
        const { text, encoding, bom } = decodeXer(original.content)
        body = encodeXer(markXer(exportXerFromOriginal(text, xerUpdatesFrom(data.activities, data.cpm), { forecastFinish: data.analysis.forecastFinish, edits: xerEditsFrom(data.activities, scenarioEdits), progressMode: changedMode }), marking), encoding, bom)
      } else {
        body = encodeXer(markXer(exportXer(g, schedule.name, { exportedBy: auth.name, projectShortName: schedule.name, progressMode: mode }), marking))
      }
      type = 'application/octet-stream'; file = `${slug}.xer`; break
    }
    // MS Project XML keeps level-of-effort activities and their relationships (as P6 → MSP does).
    case 'xml': body = exportMspXml(mspG!, schedule.name, { marking }); type = 'application/xml; charset=utf-8'; file = `${slug}.xml`; break
    case 'csv': body = exportScheduleCsv(g); type = 'text/csv; charset=utf-8'; file = `${slug}.csv`; break
    case 'xlsx-import': body = await exportImportXlsx(g, schedule.name, { marking, prov: await prov(exceptions) }); type = XLSX; file = `${slug}-import.xlsx`; break
    default: body = await exportP6LayoutXlsx(g, schedule.name, { marking, prov: await prov(exceptions) }); type = XLSX; file = `${slug}-p6-layout.xlsx`
  }
  const exSummary = summarizeExceptions(exceptions)
  await audit({ action: 'schedule.export', targetType: 'schedule', targetId: schedule.id, detail: { name: schedule.name, version: schedule.version, format, file, activities: g.activities.length, basis, editsInPlanora: editsApplied, marking: marking?.banner ?? null, sha256: createHash('sha256').update(body).digest('hex'), exportExceptions: { records: exceptions.records.length, total: exSummary.total, losses: exSummary.losses } } })
  return new NextResponse(body as BodyInit, { headers: { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${file}"`, 'X-Planora-Basis': editsApplied ? `scenario; ${editsApplied} edits` : 'as-submitted', 'X-Planora-Export-Exceptions': exceptionHeader(exceptions) } })
})
