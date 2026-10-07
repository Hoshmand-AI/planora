import { NextResponse } from 'next/server'
import { api, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { entitlementsFor, requireFeature } from '@/lib/server/entitlements'
import { hit, LIMITS } from '@/lib/server/rate-limit'
import { getScheduleById } from '@/lib/db'
import { loadSeriesUpdates, MAX_WINDOW_UPDATES } from '@/lib/planning/service'
import { analyzeWindows, windowsTableRows, WINDOWS_COLUMNS, type WindowUpdate } from '@/lib/analysis/windows'
import { exportCsv } from '@/lib/export/csv'
import { exportWindowsXlsx } from '@/lib/export/analysis-xlsx'
import { loadProvenance } from '@/lib/export/provenance'
import { CSV_CUI_REFUSAL, exportMarking } from '@/lib/export/markings'
import { isRestrictedClassification, mostRestrictive, scheduleClassification } from '@/lib/server/classification'
import { fmtDate } from '@/lib/format'

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * Windows analysis of an update series. GET ?id=<any upload in the series>[&format=json|csv|xlsx][&reissues=include].
 * A reissue (same data date) supersedes the earlier upload of that period unless reissues=include.
 * Per consecutive pair of updates (by data date): data dates, finish-milestone movement (calendar
 * days), driving-path start/end, and the movement split into progress, added/deleted activities and
 * revisions (logic, durations, constraints, calendars) by half-step recalculation; plus the
 * finish-float / BEI trend per update. CSV carries no provenance row (it would break re-import);
 * the XLSX has a Provenance sheet and workbook metadata.
 */
export const GET = api({ permission: 'read', apiKey: true }, async (req, { auth }) => {
  const id = req.nextUrl.searchParams.get('id')
  const format = req.nextUrl.searchParams.get('format') || 'json'
  if (!['json', 'csv', 'xlsx'].includes(format)) return NextResponse.json({ error: 'Unknown format. Use json, csv or xlsx.' }, { status: 400 })
  const schedule = id ? await getScheduleById(id, auth.orgId) : undefined
  if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (format !== 'json') {
    if (format === 'xlsx') requireFeature(auth.plan, entitlementsFor(auth.plan).exports.includes('xlsx-p6'), 'XLSX export')
    const rl = await hit(`export:user:${auth.userId}`, LIMITS.exportsPerUser.limit, LIMITS.exportsPerUser.windowSec)
    if (!rl.ok) throw new ApiError(429, 'Too many exports in the last hour. Try again later.', 'rate_limited', { retryAfterSec: rl.retryAfterSec })
  }

  const { updates, truncated, total } = await loadSeriesUpdates(auth.orgId, schedule)
  if (updates.length < 2) {
    const message = 'A windows analysis needs at least two uploads of this project. Upload the next update with the same P6 project ID (or MS Project title).'
    return format === 'json' ? NextResponse.json({ windows: null, message }) : NextResponse.json({ error: message }, { status: 404 })
  }
  // A reissue with the same data date supersedes the earlier upload unless ?reissues=include.
  const includeReissues = req.nextUrl.searchParams.get('reissues') === 'include'
  const w = analyzeWindows(updates.map((d): WindowUpdate => ({ schedule: d.schedule, activities: d.activities, relationships: d.relationships, analysis: d.analysis })), { includeReissues })
  if (truncated) w.notes.unshift(`The series has ${total} uploads; the latest ${MAX_WINDOW_UPDATES} are analyzed.`)
  await audit({ action: 'schedule.windows', targetType: 'schedule', targetId: schedule.id, detail: { name: schedule.name, updates: updates.length, format } })

  const slug = `${schedule.name}-windows`.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'windows'
  // CUI markings apply when any update in the series is CUI or classified (most restrictive wins).
  const classification = format === 'json' ? null
    : mostRestrictive(...await Promise.all(updates.map(d => scheduleClassification(d.schedule.id, auth.orgId).catch(() => 'classified' as const))))
  if (format === 'csv') {
    // A CSV cannot carry CUI markings.
    if (isRestrictedClassification(classification)) return NextResponse.json({ error: CSV_CUI_REFUSAL, code: 'cui_csv_excluded' }, { status: 409 })
    const rows = windowsTableRows(w).map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, WINDOWS_COLUMNS.find(c => c.key === k)?.date && typeof v === 'string' ? fmtDate(v) : v])))
    return new NextResponse(exportCsv(rows, WINDOWS_COLUMNS), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${slug}.csv"` } })
  }
  if (format === 'xlsx') {
    const prov = await loadProvenance(auth.orgId, updates.map(d => ({ role: `${d.schedule.version}`, schedule: d.schedule, analysis: d.analysis })), auth.settings.quality)
    const buf = await exportWindowsXlsx(w, prov, schedule.name, exportMarking(classification, { controlledBy: auth.orgName, poc: auth.name }))
    return new NextResponse(buf as unknown as BodyInit, { headers: { 'Content-Type': XLSX, 'Content-Disposition': `attachment; filename="${slug}.xlsx"` } })
  }
  const superseded = new Set(w.series.flatMap(p => p.superseded.map(x => x.id)))
  const perDate = new Map(w.series.map(p => [p.dataDate, p.uploads]))
  return NextResponse.json({ windows: w, series: updates.map(d => ({ id: d.schedule.id, version: d.schedule.version, dataDate: d.schedule.dataDate, superseded: superseded.has(d.schedule.id), uploadsWithDataDate: perDate.get(d.schedule.dataDate) ?? 1 })) })
})
