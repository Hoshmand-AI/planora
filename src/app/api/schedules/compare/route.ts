import { NextResponse } from 'next/server'
import { api, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { entitlementsFor, requireFeature } from '@/lib/server/entitlements'
import { hit, LIMITS } from '@/lib/server/rate-limit'
import { getScheduleById, getScheduleFileMeta, getScheduleSeries } from '@/lib/db'
import { loadScheduleData } from '@/lib/planning/service'
import { compareSchedules, orderSeries, pickDefaultBase, type CompareSide } from '@/lib/analysis/compare'
import { exportComparisonCsv } from '@/lib/export/csv'
import { CSV_CUI_REFUSAL, exportMarking } from '@/lib/export/markings'
import { isRestrictedClassification, mostRestrictive, scheduleClassification } from '@/lib/server/classification'
import { exportComparisonXlsx } from '@/lib/export/analysis-xlsx'
import { loadProvenance } from '@/lib/export/provenance'

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * Compare two uploads of a project. GET ?id=<later upload>&base=<earlier upload>.
 * Without `base`, the latest upload in the same project series with an EARLIER data date is used (a
 * re-upload with the same data date is never the default base).
 * Always returns the series (ordered by data date, then upload time) so the UI can offer other pairs.
 * &format=csv downloads the activity-level differences as CSV; &format=xlsx a workbook with one sheet
 * per change category (before/after with both data dates) and a Provenance sheet.
 * A schedule is never compared with itself (same id, or an upload of byte-identical file): 400.
 */
export const GET = api({ permission: 'read', apiKey: true }, async (req, { auth }) => {
  const id = req.nextUrl.searchParams.get('id')
  const baseId = req.nextUrl.searchParams.get('base')
  const format = req.nextUrl.searchParams.get('format') || 'json'
  if (format !== 'json' && format !== 'csv' && format !== 'xlsx') return NextResponse.json({ error: 'Unknown format. Use json, csv or xlsx.' }, { status: 400 })
  if (id && baseId && id === baseId) return NextResponse.json({ error: 'A schedule cannot be compared with itself. Pick a different update to compare against.', code: 'same_schedule' }, { status: 400 })
  const after = id ? await getScheduleById(id, auth.orgId) : undefined
  if (!after) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const series = orderSeries(after.projectKey ? await getScheduleSeries(auth.orgId, after.projectKey) : [after])
  let before = baseId ? await getScheduleById(baseId, auth.orgId) : undefined
  if (baseId && !before) return NextResponse.json({ error: 'Base schedule not found' }, { status: 404 })
  if (before && before.id === after.id) return NextResponse.json({ error: 'A schedule cannot be compared with itself. Pick a different update to compare against.', code: 'same_schedule' }, { status: 400 })
  if (before) {
    // Two uploads of the very same file are the same schedule, whatever their labels.
    const [fa, fb] = await Promise.all([getScheduleFileMeta(after.id, auth.orgId).catch(() => undefined), getScheduleFileMeta(before.id, auth.orgId).catch(() => undefined)])
    if (fa && fb && fa.sha256 === fb.sha256) return NextResponse.json({ error: 'These two uploads are the same file (identical SHA-256), so there is nothing to compare. Pick a different update.', code: 'same_schedule' }, { status: 400 })
  }
  if (!before) before = pickDefaultBase(series, after)
  const seriesOut = series.map(s => ({ id: s.id, name: s.name, version: s.version, dataDate: s.dataDate, uploadedAt: s.uploadedAt, forecastFinish: s.analysis?.forecastFinish ?? s.projectFinish, varianceDays: s.analysis?.varianceDays ?? s.varianceDays, status: s.analysis?.status ?? null }))
  if (!before) {
    const message = series.length > 1
      ? 'No upload of this project has an earlier data date than this one. Pick an update to compare against.'
      : 'This is the first upload of this project. Upload the next update (same P6 project ID or MS Project title) to compare.'
    if (format !== 'json') return NextResponse.json({ error: message }, { status: 404 })
    return NextResponse.json({ series: seriesOut, comparison: null, message })
  }

  if (format === 'xlsx') {
    requireFeature(auth.plan, entitlementsFor(auth.plan).exports.includes('xlsx-p6'), 'XLSX export')
    const rl = await hit(`export:user:${auth.userId}`, LIMITS.exportsPerUser.limit, LIMITS.exportsPerUser.windowSec)
    if (!rl.ok) throw new ApiError(429, 'Too many exports in the last hour. Try again later.', 'rate_limited', { retryAfterSec: rl.retryAfterSec })
  }
  const [a, b] = await Promise.all([loadScheduleData(after.id, auth.orgId), loadScheduleData(before.id, auth.orgId)])
  if (!a || !b) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const side = (d: NonNullable<typeof a>): CompareSide => ({
    schedule: { id: d.schedule.id, name: d.schedule.name, version: d.schedule.version, dataDate: d.schedule.dataDate, forecastFinish: d.analysis.forecastFinish, projectKey: d.schedule.projectKey ?? null },
    // File to file: a change of the file's own target dates (re-baselined in P6) still shows.
    activities: d.fileActivities, relationships: d.relationships, longestPath: d.analysis.longestPath,
    finishMilestone: d.analysis.finishMilestone ? { code: d.analysis.finishMilestone.code, forecastFinish: d.analysis.finishMilestone.forecastFinish } : null,
    calendars: d.schedule.calendars, defaultCalendarId: d.schedule.defaultCalendarId, violations: d.analysis.violations ?? [],
    logicLongestPath: d.cpm?.logicLongestPath ?? [], logicFinish: d.cpm?.logicFinish ?? null,
  })
  const comparison = compareSchedules(side(b), side(a))
  await audit({ action: 'schedule.compare', targetType: 'schedule', targetId: after.id, detail: { name: after.name, after: after.version, before: before.version, baseId: before.id, format } })
  const slug = `${after.name}-${before.version}-vs-${after.version}`.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'comparison'
  // CUI markings apply when either upload is CUI or classified (most restrictive wins).
  const classification = format === 'xlsx' || format === 'csv'
    ? mostRestrictive(...await Promise.all([after.id, before.id].map(id => scheduleClassification(id, auth.orgId).catch(() => 'classified' as const))))
    : null
  if (format === 'xlsx') {
    const marking = exportMarking(classification, { controlledBy: auth.orgName, poc: auth.name })
    const prov = await loadProvenance(auth.orgId, [{ role: 'Earlier update', schedule: b.schedule, analysis: b.analysis }, { role: 'Later update', schedule: a.schedule, analysis: a.analysis }], auth.settings.quality)
    const buf = await exportComparisonXlsx(comparison, prov, marking)
    return new NextResponse(buf as unknown as BodyInit, { headers: { 'Content-Type': XLSX, 'Content-Disposition': `attachment; filename="${slug}.xlsx"` } })
  }
  if (format === 'csv') {
    // A CSV cannot carry CUI markings: refused when either upload is CUI or classified.
    if (isRestrictedClassification(classification)) return NextResponse.json({ error: CSV_CUI_REFUSAL, code: 'cui_csv_excluded' }, { status: 409 })
    return new NextResponse(exportComparisonCsv(comparison), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${slug}.csv"` } })
  }
  return NextResponse.json({ series: seriesOut, comparison })
})
