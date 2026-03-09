import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getScheduleById, getActivities, getRelationships } from '@/lib/db'
import { generateReport } from '@/lib/openai'

export async function POST(req: NextRequest) {
  const auth = await getAuthUser()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { reportType, scheduleId } = await req.json()
  if (!reportType || !scheduleId) return NextResponse.json({ error: 'reportType and scheduleId required' }, { status: 400 })

  const schedule = await getScheduleById(scheduleId)
  if (!schedule) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })

  const activities = await getActivities(scheduleId)
  const relationships = await getRelationships(scheduleId)
  const report = await generateReport(reportType, { schedule, activities, relationships })

  return NextResponse.json({ success: true, reportType, scheduleName: schedule.name, version: schedule.version, generatedAt: new Date().toISOString(), content: report })
}
