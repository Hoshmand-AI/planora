import { NextResponse } from 'next/server'
import { api } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { getScheduleById } from '@/lib/db'
import { basisFrom, basisWarning, MAX_WINDOW_UPDATES } from '@/lib/planning/service'
import { loadEvmSeries } from '@/lib/planning/evm-service'

/**
 * Earned value trend of a project's update series. GET ?id=<any upload in the series>[&basis=scenario].
 * One point per data date: a reissue with the same data date supersedes the earlier upload (as in the
 * windows analysis). Every update is measured against the baseline the given upload resolves to
 * (remeasureSeries), with costs from each upload's stored original file; updates without the inputs
 * are listed with status 'not_available' and no figures.
 */
export const GET = api({ permission: 'read', apiKey: true }, async (req, { auth }) => {
  const id = req.nextUrl.searchParams.get('id')
  const schedule = id ? await getScheduleById(id, auth.orgId) : undefined
  if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const basis = basisFrom(req.nextUrl.searchParams)
  const { series, truncated, total, updates } = await loadEvmSeries(auth.orgId, schedule, { basis })
  if (truncated) series.notes.unshift(`The series has ${total} uploads; the latest ${MAX_WINDOW_UPDATES} are analyzed.`)
  series.notes.unshift(...updates.map(d => basisWarning(basis, d.editsApplied, d.schedule.version)).filter((x): x is string => !!x))
  await audit({ action: 'schedule.evm_series', targetType: 'schedule', targetId: schedule.id, detail: { name: schedule.name, updates: updates.length, basis } })
  // The full per-update result is GET /api/schedules/[id]/evm; the series carries the trend.
  return NextResponse.json({ basis, points: series.points, superseded: series.superseded, notes: series.notes })
})
