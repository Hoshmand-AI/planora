import { NextResponse } from 'next/server'
import { api } from '@/lib/server/api'
import { entitlementsFor, requireFeature } from '@/lib/server/entitlements'
import { audit } from '@/lib/server/audit'
import { basisFrom, basisLabel, loadScheduleData, loadSeriesUpdates } from '@/lib/planning/service'
import { generateReport } from '@/lib/openai'
import { getReviewState, getScheduleSeries } from '@/lib/db'
import { compareSchedules, type CompareSide } from '@/lib/analysis/compare'
import { analyzeWindows, type WindowsAnalysis } from '@/lib/analysis/windows'
import { REPORT_TITLES, editsSection, type ReportType } from '@/lib/export/reports'
import { loadProvenance } from '@/lib/export/provenance'
import { fmtDates } from '@/lib/format'
import { exportMarking, markText } from '@/lib/export/markings'
import { scheduleClassification } from '@/lib/server/classification'

const REPORT_TYPES = Object.keys(REPORT_TITLES) as ReportType[]

export const POST = api({ permission: 'ai.use' }, async (req, { auth }) => {
  const body = await req.json()
  const { reportType, scheduleId } = body
  // Reports are on the schedule as submitted unless the request asks for the scenario ({ basis: 'scenario' }).
  const basis = basisFrom(body && typeof body === 'object' ? body : null)
  if (!reportType || !scheduleId) return NextResponse.json({ error: 'reportType and scheduleId required' }, { status: 400 })
  // Validate the type before the plan check, so a typo isn't reported as a plan limit.
  if (!REPORT_TYPES.includes(String(reportType) as ReportType)) {
    return NextResponse.json({ error: `Unknown report type. Valid types: ${REPORT_TYPES.join(', ')}.`, code: 'unknown_report_type', validTypes: REPORT_TYPES }, { status: 400 })
  }

  requireFeature(auth.plan, entitlementsFor(auth.plan).reports.includes(String(reportType)), 'This report type')
  const data = await loadScheduleData(scheduleId, auth.orgId, { basis })
  if (!data) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
  const { schedule, activities, relationships, brief, hasLogic, analysis } = data

  // The previous upload of the same project, for the "since the last update" sections.
  let comparison = null
  if (schedule.projectKey) {
    const series = await getScheduleSeries(auth.orgId, schedule.projectKey)
    const idx = series.findIndex(s => s.id === schedule.id)
    const prev = idx > 0 ? await loadScheduleData(series[idx - 1].id, auth.orgId, { basis }) : null
    if (prev) {
      const side = (d: NonNullable<typeof data>): CompareSide => ({
        schedule: { id: d.schedule.id, name: d.schedule.name, version: d.schedule.version, dataDate: d.schedule.dataDate, forecastFinish: d.analysis.forecastFinish },
        activities: d.activities, relationships: d.relationships, longestPath: d.analysis.longestPath,
        finishMilestone: d.analysis.finishMilestone ? { code: d.analysis.finishMilestone.code, forecastFinish: d.analysis.finishMilestone.forecastFinish } : null,
        calendars: d.schedule.calendars, defaultCalendarId: d.schedule.defaultCalendarId, violations: d.analysis.violations ?? [],
        logicLongestPath: d.cpm?.logicLongestPath ?? [], logicFinish: d.cpm?.logicFinish ?? null,
      })
      comparison = compareSchedules(side(prev), side(data))
    }
  }

  // Variance report in an update series: windows analysis up to this update, and the float / BEI trend.
  let windows: WindowsAnalysis | null = null
  if (reportType === 'variance' && schedule.projectKey) {
    const { updates } = await loadSeriesUpdates(auth.orgId, schedule, { basis })
    const upTo = updates.slice(0, updates.findIndex(u => u.schedule.id === schedule.id) + 1)
    if (upTo.length >= 2) windows = analyzeWindows(upTo.map(u => ({ schedule: u.schedule, activities: u.activities, relationships: u.relationships, analysis: u.analysis })))
  }
  const evidence = {
    provenance: await loadProvenance(auth.orgId, [{ schedule, analysis, editsApplied: basis === 'scenario' ? data.editsApplied : 0 }], auth.settings.quality),
    windows,
    review: reportType === 'qa_qc' ? await getReviewState(schedule.id, auth.orgId) : null,
    linkFloat: data.cpm?.linkFloat ?? null,
  }

  const generated = await generateReport(reportType, { schedule, activities, relationships, brief, hasLogic, rules: auth.settings.quality, analysis, comparison, evidence })
  // Edits made in Planora to the uploaded file are always listed (whether or not a model wrote the report).
  const edits = editsSection(data.edits, data.revertedEdits, basis === 'scenario')
  const withEdits = edits ? `${generated.trimEnd()}\n\n${edits}\n` : generated
  // Header line: which network the report is on.
  const basisLine = `**Basis:** ${basisLabel(basis, data.editsApplied)}${basis === 'scenario' && data.editsApplied ? ' (a what-if scenario, not the schedule as submitted)' : data.editsApplied ? ` (${data.editsApplied} Planora edit${data.editsApplied === 1 ? ' is' : 's are'} not included)` : ''}`
  const lines = withEdits.split('\n')
  const report = lines[0]?.startsWith('#') ? [lines[0], '', basisLine, ...lines.slice(1)].join('\n') : `${basisLine}\n\n${withEdits}`

  // CUI / classified schedules: banner and designation on the report itself.
  const classification = await scheduleClassification(schedule.id, auth.orgId).catch(() => 'classified' as const)
  const marking = exportMarking(classification, { controlledBy: auth.orgName, poc: auth.name })

  await audit({ action: 'schedule.report', targetType: 'schedule', targetId: schedule.id, detail: { schedule: schedule.name, reportType, basis, editsApplied: basis === 'scenario' ? data.editsApplied : 0, sha256: evidence.provenance.sources[0]?.sha256 ?? null, release: evidence.provenance.release, marking: marking?.banner ?? null } })
  return NextResponse.json({ success: true, reportType, basis, scheduleName: schedule.name, version: schedule.version, generatedAt: evidence.provenance.generatedAt, provenance: evidence.provenance, content: markText(fmtDates(report), marking), marking: marking ? { banner: marking.banner, designation: marking.designation } : null })
})
