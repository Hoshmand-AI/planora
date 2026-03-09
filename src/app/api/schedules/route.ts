import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuid } from 'uuid'
import { getAuthUser } from '@/lib/auth'
import { createSchedule, getSchedules, getScheduleById, createActivities, createRelationships, getActivities, getRelationships } from '@/lib/db'
import { parseXER } from '@/lib/parsers/xer-parser'
import { parseMSProjectXML } from '@/lib/parsers/xml-parser'
import { parsePDF } from '@/lib/parsers/pdf-parser'

export async function GET(req: NextRequest) {
  const auth = await getAuthUser()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const scheduleId = req.nextUrl.searchParams.get('id')

  if (scheduleId) {
    const schedule = await getScheduleById(scheduleId)
    if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const activities = await getActivities(scheduleId)
    const relationships = await getRelationships(scheduleId)

    const criticalActivities = activities.filter(a => a.isCritical)
    const nearTermTasks = activities
      .filter(a => a.status !== 'complete' && a.earlyStart)
      .sort((a, b) => (a.earlyStart || '').localeCompare(b.earlyStart || ''))
      .slice(0, 10)
    const completedCount = activities.filter(a => a.status === 'complete').length
    const percentComplete = activities.length > 0
      ? Math.round((completedCount / activities.length) * 100)
      : 0

    return NextResponse.json({
      schedule, activities, relationships,
      metrics: {
        totalActivities: activities.length,
        criticalCount: criticalActivities.length,
        completedCount,
        inProgressCount: activities.filter(a => a.status === 'in_progress').length,
        notStartedCount: activities.filter(a => a.status === 'not_started').length,
        percentComplete,
        varianceDays: schedule.varianceDays,
        nearTermTasks,
        drivingTasks: criticalActivities.slice(0, 10),
      },
    })
  }

  const schedules = await getSchedules(auth.userId)
  return NextResponse.json({ schedules })
}

export async function POST(req: NextRequest) {
  const auth = await getAuthUser()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    const versionLabel = formData.get('version') as string || 'v1.0'

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    const fileName = file.name.toLowerCase()
    const scheduleId = uuid()
    let parsed

    if (fileName.endsWith('.xer')) {
      const text = await file.text()
      parsed = parseXER(text, scheduleId)
    } else if (fileName.endsWith('.xml')) {
      const text = await file.text()
      parsed = parseMSProjectXML(text, scheduleId)
    } else if (fileName.endsWith('.pdf')) {
      const buffer = Buffer.from(await file.arrayBuffer())
      parsed = await parsePDF(buffer, scheduleId)
    } else {
      return NextResponse.json({ error: 'Unsupported file format. Please upload .xer (P6), .xml (MS Project), or .pdf files.' }, { status: 400 })
    }

    let varianceDays: number | null = null
    if (parsed.projectFinish) {
      const baselineFinishes = parsed.activities
        .filter(a => a.baselineFinish)
        .map(a => new Date(a.baselineFinish!).getTime())
      if (baselineFinishes.length > 0) {
        const latestBaseline = new Date(Math.max(...baselineFinishes))
        const forecast = new Date(parsed.projectFinish)
        varianceDays = Math.round((forecast.getTime() - latestBaseline.getTime()) / (1000 * 60 * 60 * 24))
      }
    }

    const schedule = await createSchedule({
      id: scheduleId,
      userId: auth.userId,
      name: parsed.projectName,
      version: versionLabel,
      sourceType: fileName.endsWith('.xer') ? 'p6_xer' : fileName.endsWith('.xml') ? 'ms_xml' : 'pdf',
      fileName: file.name,
      uploadedAt: new Date().toISOString(),
      activityCount: parsed.activities.length,
      relationshipCount: parsed.relationships.length,
      projectStart: parsed.projectStart,
      projectFinish: parsed.projectFinish,
      dataDate: parsed.dataDate,
      varianceDays,
      criticalCount: parsed.activities.filter(a => a.isCritical).length,
      percentComplete: parsed.activities.length > 0
        ? Math.round((parsed.activities.filter(a => a.status === 'complete').length / parsed.activities.length) * 100)
        : 0,
    })

    if (parsed.activities.length > 0) await createActivities(parsed.activities)
    if (parsed.relationships.length > 0) await createRelationships(parsed.relationships)

    return NextResponse.json({
      success: true, schedule,
      summary: {
        activitiesImported: parsed.activities.length,
        relationshipsImported: parsed.relationships.length,
        criticalCount: parsed.activities.filter(a => a.isCritical).length,
        projectStart: parsed.projectStart,
        projectFinish: parsed.projectFinish,
      },
    })
  } catch (error: unknown) {
    const err = error as Error
    console.error('Upload error:', err)
    return NextResponse.json({ error: `Failed to parse file: ${err.message}` }, { status: 500 })
  }
}
