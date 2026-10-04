import { NextResponse } from 'next/server'
import { api } from '@/lib/server/api'
import { entitlementsFor, requireFeature } from '@/lib/server/entitlements'
import { audit } from '@/lib/server/audit'
import { loadScheduleData } from '@/lib/planning/service'
import { generateReport } from '@/lib/openai'

export const POST = api({ permission: 'ai.use' }, async (req, { auth }) => {
  const { reportType, scheduleId } = await req.json()
  if (!reportType || !scheduleId) return NextResponse.json({ error: 'reportType and scheduleId required' }, { status: 400 })

  requireFeature(auth.plan, entitlementsFor(auth.plan).reports.includes(String(reportType)), 'This report type')
  const data = await loadScheduleData(scheduleId, auth.orgId)
  if (!data) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
  const { schedule, activities, relationships, brief, hasLogic } = data

  const report = await generateReport(reportType, { schedule, activities, relationships, brief, hasLogic, rules: auth.settings.quality })

  await audit({ action: 'schedule.report', targetType: 'schedule', targetId: schedule.id, detail: { schedule: schedule.name, reportType } })
  return NextResponse.json({ success: true, reportType, scheduleName: schedule.name, version: schedule.version, generatedAt: new Date().toISOString(), content: report })
})
