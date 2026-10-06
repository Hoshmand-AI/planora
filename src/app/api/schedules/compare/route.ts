import { NextResponse } from 'next/server'
import { api } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { getScheduleById, getScheduleSeries } from '@/lib/db'
import { loadScheduleData } from '@/lib/planning/service'
import { compareSchedules, orderSeries, pickDefaultBase, type CompareSide } from '@/lib/analysis/compare'
import { exportComparisonCsv } from '@/lib/export/csv'

/**
 * Compare two uploads of a project. GET ?id=<later upload>&base=<earlier upload>.
 * Without `base`, the latest upload in the same project series with an EARLIER data date is used (a
 * re-upload with the same data date is never the default base).
 * Always returns the series (ordered by data date, then upload time) so the UI can offer other pairs.
 * &format=csv downloads the activity-level differences as CSV.
 */
export const GET = api({ permission: 'read', apiKey: true }, async (req, { auth }) => {
  const id = req.nextUrl.searchParams.get('id')
  const baseId = req.nextUrl.searchParams.get('base')
  const format = req.nextUrl.searchParams.get('format') || 'json'
  if (format !== 'json' && format !== 'csv') return NextResponse.json({ error: 'Unknown format. Use json or csv.' }, { status: 400 })
  const after = id ? await getScheduleById(id, auth.orgId) : undefined
  if (!after) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const series = orderSeries(after.projectKey ? await getScheduleSeries(auth.orgId, after.projectKey) : [after])
  let before = baseId ? await getScheduleById(baseId, auth.orgId) : undefined
  if (baseId && !before) return NextResponse.json({ error: 'Base schedule not found' }, { status: 404 })
  if (before && before.id === after.id) return NextResponse.json({ error: 'Pick a different update to compare against.' }, { status: 400 })
  if (!before) before = pickDefaultBase(series, after)
  const seriesOut = series.map(s => ({ id: s.id, name: s.name, version: s.version, dataDate: s.dataDate, uploadedAt: s.uploadedAt, forecastFinish: s.analysis?.forecastFinish ?? s.projectFinish, varianceDays: s.analysis?.varianceDays ?? s.varianceDays, status: s.analysis?.status ?? null }))
  if (!before) {
    const message = series.length > 1
      ? 'No upload of this project has an earlier data date than this one. Pick an update to compare against.'
      : 'This is the first upload of this project. Upload the next update (same P6 project ID or MS Project title) to compare.'
    if (format === 'csv') return NextResponse.json({ error: message }, { status: 404 })
    return NextResponse.json({ series: seriesOut, comparison: null, message })
  }

  const [a, b] = await Promise.all([loadScheduleData(after.id, auth.orgId), loadScheduleData(before.id, auth.orgId)])
  if (!a || !b) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const side = (d: NonNullable<typeof a>): CompareSide => ({
    schedule: { id: d.schedule.id, name: d.schedule.name, version: d.schedule.version, dataDate: d.schedule.dataDate, forecastFinish: d.analysis.forecastFinish, projectKey: d.schedule.projectKey ?? null },
    activities: d.activities, relationships: d.relationships, longestPath: d.analysis.longestPath,
    finishMilestone: d.analysis.finishMilestone ? { code: d.analysis.finishMilestone.code, forecastFinish: d.analysis.finishMilestone.forecastFinish } : null,
    calendars: d.schedule.calendars, defaultCalendarId: d.schedule.defaultCalendarId, violations: d.analysis.violations ?? [],
  })
  const comparison = compareSchedules(side(b), side(a))
  await audit({ action: 'schedule.compare', targetType: 'schedule', targetId: after.id, detail: { name: after.name, after: after.version, before: before.version, baseId: before.id, format } })
  if (format === 'csv') {
    const slug = `${after.name}-${before.version}-vs-${after.version}`.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'comparison'
    return new NextResponse(exportComparisonCsv(comparison), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${slug}.csv"` } })
  }
  return NextResponse.json({ series: seriesOut, comparison })
})
