import { NextResponse } from 'next/server'
import { api } from '@/lib/server/api'
import { entitlementsFor, requireFeature } from '@/lib/server/entitlements'
import { audit } from '@/lib/server/audit'
import { loadScheduleData } from '@/lib/planning/service'
import { generateReport } from '@/lib/openai'
import { getScheduleSeries } from '@/lib/db'
import { compareSchedules } from '@/lib/analysis/compare'
import { REPORT_TITLES, editsSection, type ReportType } from '@/lib/export/reports'
import { fmtDates } from '@/lib/format'
import { exportMarking, markText } from '@/lib/export/markings'
import { scheduleClassification } from '@/lib/server/classification'

const REPORT_TYPES = Object.keys(REPORT_TITLES) as ReportType[]

export const POST = api({ permission: 'ai.use' }, async (req, { auth }) => {
  const { reportType, scheduleId } = await req.json()
  if (!reportType || !scheduleId) return NextResponse.json({ error: 'reportType and scheduleId required' }, { status: 400 })
  // Validate the type before the plan check, so a typo isn't reported as a plan limit.
  if (!REPORT_TYPES.includes(String(reportType) as ReportType)) {
    return NextResponse.json({ error: `Unknown report type. Valid types: ${REPORT_TYPES.join(', ')}.`, code: 'unknown_report_type', validTypes: REPORT_TYPES }, { status: 400 })
  }

  requireFeature(auth.plan, entitlementsFor(auth.plan).reports.includes(String(reportType)), 'This report type')
  const data = await loadScheduleData(scheduleId, auth.orgId)
  if (!data) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
  const { schedule, activities, relationships, brief, hasLogic, analysis } = data

  // The previous upload of the same project, for the "since the last update" sections.
  let comparison = null
  if (schedule.projectKey) {
    const series = await getScheduleSeries(auth.orgId, schedule.projectKey)
    const idx = series.findIndex(s => s.id === schedule.id)
    const prev = idx > 0 ? await loadScheduleData(series[idx - 1].id, auth.orgId) : null
    if (prev) {
      const side = (d: NonNullable<typeof data>) => ({
        schedule: { id: d.schedule.id, name: d.schedule.name, version: d.schedule.version, dataDate: d.schedule.dataDate, forecastFinish: d.analysis.forecastFinish },
        activities: d.activities, relationships: d.relationships, longestPath: d.analysis.longestPath,
        finishMilestone: d.analysis.finishMilestone ? { code: d.analysis.finishMilestone.code, forecastFinish: d.analysis.finishMilestone.forecastFinish } : null,
      })
      comparison = compareSchedules(side(prev), side(data))
    }
  }

  const generated = await generateReport(reportType, { schedule, activities, relationships, brief, hasLogic, rules: auth.settings.quality, analysis, comparison })
  // Edits made in Planora to the uploaded file are always listed (whether or not a model wrote the report).
  const edits = editsSection(data.edits, data.revertedEdits)
  const report = edits ? `${generated.trimEnd()}\n\n${edits}\n` : generated

  // CUI / classified schedules: banner and designation on the report itself.
  const classification = await scheduleClassification(schedule.id, auth.orgId).catch(() => 'classified' as const)
  const marking = exportMarking(classification, { controlledBy: auth.orgName, poc: auth.name })

  await audit({ action: 'schedule.report', targetType: 'schedule', targetId: schedule.id, detail: { schedule: schedule.name, reportType } })
  return NextResponse.json({ success: true, reportType, scheduleName: schedule.name, version: schedule.version, generatedAt: new Date().toISOString(), content: markText(fmtDates(report), marking), marking: marking ? { banner: marking.banner, designation: marking.designation } : null })
})
