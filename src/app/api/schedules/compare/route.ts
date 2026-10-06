import { NextResponse } from 'next/server'
import { api } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { getScheduleById, getScheduleSeries } from '@/lib/db'
import { loadScheduleData } from '@/lib/planning/service'
import { compareSchedules, type CompareSide } from '@/lib/analysis/compare'

/**
 * Compare two uploads of a project. GET ?id=<later upload>&base=<earlier upload>.
 * Without `base`, the previous upload in the same project series (by data date) is used.
 * Always returns the series so the UI can offer other pairs.
 */
export const GET = api({ permission: 'read', apiKey: true }, async (req, { auth }) => {
  const id = req.nextUrl.searchParams.get('id')
  const baseId = req.nextUrl.searchParams.get('base')
  const after = id ? await getScheduleById(id, auth.orgId) : undefined
  if (!after) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const series = after.projectKey ? await getScheduleSeries(auth.orgId, after.projectKey) : [after]
  let before = baseId ? await getScheduleById(baseId, auth.orgId) : undefined
  if (baseId && !before) return NextResponse.json({ error: 'Base schedule not found' }, { status: 404 })
  if (!before) {
    const idx = series.findIndex(s => s.id === after.id)
    before = idx > 0 ? series[idx - 1] : undefined
  }
  const seriesOut = series.map(s => ({ id: s.id, name: s.name, version: s.version, dataDate: s.dataDate, uploadedAt: s.uploadedAt, forecastFinish: s.analysis?.forecastFinish ?? s.projectFinish, varianceDays: s.analysis?.varianceDays ?? s.varianceDays, status: s.analysis?.status ?? null }))
  if (!before) return NextResponse.json({ series: seriesOut, comparison: null, message: 'This is the first upload of this project. Upload the next update (same P6 project ID or MS Project title) to compare.' })

  const [a, b] = await Promise.all([loadScheduleData(after.id, auth.orgId), loadScheduleData(before.id, auth.orgId)])
  if (!a || !b) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const side = (d: NonNullable<typeof a>): CompareSide => ({
    schedule: { id: d.schedule.id, name: d.schedule.name, version: d.schedule.version, dataDate: d.schedule.dataDate, forecastFinish: d.analysis.forecastFinish },
    activities: d.activities, relationships: d.relationships, longestPath: d.analysis.longestPath,
    finishMilestone: d.analysis.finishMilestone ? { code: d.analysis.finishMilestone.code, forecastFinish: d.analysis.finishMilestone.forecastFinish } : null,
  })
  const comparison = compareSchedules(side(b), side(a))
  await audit({ action: 'schedule.compare', targetType: 'schedule', targetId: after.id, detail: { name: after.name, after: after.version, before: before.version, baseId: before.id } })
  return NextResponse.json({ series: seriesOut, comparison })
})
