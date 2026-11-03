import { NextResponse } from 'next/server'
import { api, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { entitlementsFor, requireFeature } from '@/lib/server/entitlements'
import { hit, LIMITS } from '@/lib/server/rate-limit'
import { basisFrom, basisLabel, basisWarning } from '@/lib/planning/service'
import { loadEvmSeries, loadScheduleEvm } from '@/lib/planning/evm-service'
import { exportEvmXlsx } from '@/lib/export/analysis-xlsx'
import { loadProvenance } from '@/lib/export/provenance'
import { exportMarking } from '@/lib/export/markings'
import { scheduleClassification } from '@/lib/server/classification'

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * Earned value of one upload. GET [?format=json|xlsx][&basis=scenario].
 * Measured against the upload's resolved baseline (the one every other analysis uses) with the costs
 * read from its stored original file. When inputs are missing the result is
 * { status: 'not_available', missing: [...] } (or 'partial' without actual costs); nothing is estimated.
 * The XLSX adds the trend over the update series (reissues superseded) and carries provenance.
 */
export const GET = api<{ id: string }>({ permission: 'read', apiKey: true }, async (req, { params, auth }) => {
  const format = req.nextUrl.searchParams.get('format') || 'json'
  if (!['json', 'xlsx'].includes(format)) return NextResponse.json({ error: 'Unknown format. Use json or xlsx.' }, { status: 400 })
  if (format === 'xlsx') {
    requireFeature(auth.plan, entitlementsFor(auth.plan).exports.includes('xlsx-p6'), 'XLSX export')
    const rl = await hit(`export:user:${auth.userId}`, LIMITS.exportsPerUser.limit, LIMITS.exportsPerUser.windowSec)
    if (!rl.ok) throw new ApiError(429, 'Too many exports in the last hour. Try again later.', 'rate_limited', { retryAfterSec: rl.retryAfterSec })
  }
  const basis = basisFrom(req.nextUrl.searchParams)
  const loaded = await loadScheduleEvm(auth.orgId, params.id, { basis })
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { data, evm } = loaded
  const { schedule } = data
  await audit({ action: 'schedule.evm', targetType: 'schedule', targetId: schedule.id, detail: { name: schedule.name, version: schedule.version, status: evm.status, format, basis } })

  if (format === 'xlsx') {
    if (evm.status === 'not_available') return NextResponse.json({ error: `Earned value is not available: ${evm.missing.map(m => m.message).join(' ')}`, code: 'evm_not_available', missing: evm.missing }, { status: 409 })
    const trend = schedule.projectKey ? (await loadEvmSeries(auth.orgId, schedule, { basis })).series.points : null
    const prov = await loadProvenance(auth.orgId, [{ schedule, analysis: data.analysis, editsApplied: basis === 'scenario' ? data.editsApplied : 0 }], auth.settings.quality)
    const classification = await scheduleClassification(schedule.id, auth.orgId).catch(() => 'classified' as const)
    const buf = await exportEvmXlsx(evm, prov, `${schedule.name} (${schedule.version})`, trend && trend.length > 1 ? trend : null, exportMarking(classification, { controlledBy: auth.orgName, poc: auth.name }))
    const slug = `${schedule.name}-${schedule.version}-earned-value`.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'earned-value'
    return new NextResponse(buf as unknown as BodyInit, { headers: { 'Content-Type': XLSX, 'Content-Disposition': `attachment; filename="${slug}.xlsx"` } })
  }
  return NextResponse.json({ basis, basisLabel: basisLabel(basis, data.editsApplied), basisNote: basisWarning(basis, data.editsApplied), evm })
})
