import { NextResponse } from 'next/server'
import { randomUUID as uuid } from 'crypto'
import { api, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { entitlementsFor, requireFeature } from '@/lib/server/entitlements'
import { hit, LIMITS } from '@/lib/server/rate-limit'
import { createSchedule, getSchedules, getScheduleById, createActivities, createRelationships, deleteSchedule, updateScheduleProfile } from '@/lib/db'
import { parseScheduleFile } from '@/lib/parsers'
import { classifyActivity, normalizeCalendar } from '@/lib/semantic/taxonomy'
import { checkInputs } from '@/lib/analysis/input-checks'
import { analyzableFromDb, loadScheduleData } from '@/lib/planning/service'
import { completeSchedule } from '@/lib/planning/complete-schedule'
import { PROJECT_TYPES } from '@/lib/planning/types'

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

export const GET = api({ permission: 'read', apiKey: true }, async (req, { auth: ctx }) => {
  const scheduleId = req.nextUrl.searchParams.get('id')

  if (scheduleId) {
    // Firm-scoped: a schedule from another organization is indistinguishable from a missing one.
    const data = await loadScheduleData(scheduleId, ctx.orgId)
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const { schedule, activities, relationships, brief } = data

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
      schedule, activities, relationships, brief,
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

  const schedules = await getSchedules(ctx.orgId)
  return NextResponse.json({ schedules })
})

export const POST = api({ permission: 'schedule.write' }, async (req, { auth: ctx }) => {
  const ent = entitlementsFor(ctx.plan)
  if (ent.maxUploadedSchedules != null) {
    const uploaded = (await getSchedules(ctx.orgId)).filter(s => s.sourceType !== 'generated').length
    requireFeature(ctx.plan, uploaded < ent.maxUploadedSchedules, `More than ${ent.maxUploadedSchedules} uploaded schedules`)
  }
  const quota = await hit(`upload:org:${ctx.orgId}`, LIMITS.uploadsPerOrg.limit, LIMITS.uploadsPerOrg.windowSec)
  if (!quota.ok) throw new ApiError(429, 'Your organization has uploaded a lot of files in the last hour. Try again later.', 'rate_limited', { retryAfterSec: quota.retryAfterSec })
  {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const versionLabel = (formData.get('version') as string) || 'v1.0'
    const projectType = formData.get('projectType') as string | null
    const region = formData.get('region') as string | null
    const grossSqft = Number(formData.get('grossSqft')) || null

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: 'File is larger than 25 MB.' }, { status: 413 })

    const scheduleId = uuid()
    let parsed
    try {
      parsed = await parseScheduleFile(file.name, Buffer.from(await file.arrayBuffer()), scheduleId)
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 })
    }

    // Semantic normalization: firms label activities and calendars differently; map them to shared meaning.
    let classified = 0
    for (const a of parsed.activities) {
      const c = classifyActivity(a.name, a.wbs)
      a.category = c.category
      if (c.category !== 'other') classified++
    }
    const warnings = [...parsed.warnings]
    for (const cal of parsed.calendars) {
      const n = normalizeCalendar({ name: cal.name, workDays: cal.workDays, hoursPerDay: cal.hoursPerDay })
      cal.sourceName = cal.sourceName || cal.name
      cal.canonical = n.canonical
      if (n.conflict) warnings.push(`Calendar "${cal.name}": ${n.conflict}`)
    }

    // Fill in dates/float when the file arrived without calculated results.
    const completed = completeSchedule({
      activities: parsed.activities, relationships: parsed.relationships, calendars: parsed.calendars, defaultCalendarId: parsed.defaultCalendarId,
      projectStart: parsed.projectStart, projectFinish: parsed.projectFinish, dataDate: parsed.dataDate,
    })
    parsed.activities = completed.activities
    parsed.projectStart = completed.projectStart
    parsed.projectFinish = completed.projectFinish
    if (completed.note) warnings.unshift(completed.note)

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
      userId: ctx.userId,
      orgId: ctx.orgId,
      name: parsed.projectName,
      version: versionLabel,
      sourceType: parsed.sourceType,
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
      calendars: parsed.calendars,
      defaultCalendarId: parsed.defaultCalendarId,
      warnings,
      planId: null,
      projectType: projectType && (PROJECT_TYPES as readonly string[]).includes(projectType) ? projectType : null,
      region: region ? region.toUpperCase().slice(0, 12) : null,
      grossSqft,
    })

    if (parsed.activities.length > 0) await createActivities(parsed.activities)
    if (parsed.relationships.length > 0) await createRelationships(parsed.relationships)

    const dataQuestions = checkInputs(analyzableFromDb(schedule, parsed.activities, parsed.relationships))
    await audit({ action: 'schedule.upload', targetType: 'schedule', targetId: schedule.id, detail: { name: schedule.name, version: schedule.version, fileName: file.name, bytes: file.size, sourceType: schedule.sourceType, activities: parsed.activities.length, relationships: parsed.relationships.length } })

    return NextResponse.json({
      success: true, schedule,
      summary: {
        activitiesImported: parsed.activities.length,
        relationshipsImported: parsed.relationships.length,
        calendarsImported: parsed.calendars.length,
        criticalCount: parsed.activities.filter(a => a.isCritical).length,
        projectStart: parsed.projectStart,
        projectFinish: parsed.projectFinish,
        classifiedPct: parsed.activities.length ? Math.round((classified / parsed.activities.length) * 100) : 0,
        dataQuestions: dataQuestions.length,
        warnings,
      },
    })
  }
})

/** Tag a schedule so it can ground future plans: { id, projectType, region, grossSqft } */
export const PATCH = api({ permission: 'schedule.write' }, async (req, { auth: ctx }) => {
  const body = await req.json().catch(() => ({}))
  const s = body.id ? await getScheduleById(String(body.id), ctx.orgId) : undefined
  if (!s) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const projectType = typeof body.projectType === 'string' && (PROJECT_TYPES as readonly string[]).includes(body.projectType) ? body.projectType : null
  const profile = { projectType, region: typeof body.region === 'string' ? body.region.toUpperCase().slice(0, 12) : null, grossSqft: Number(body.grossSqft) || null }
  await updateScheduleProfile(s.id, ctx.orgId, profile)
  await audit({ action: 'schedule.tag', targetType: 'schedule', targetId: s.id, detail: { name: s.name, before: { projectType: s.projectType, region: s.region, grossSqft: s.grossSqft }, after: profile } })
  return NextResponse.json({ schedule: await getScheduleById(s.id, ctx.orgId) })
})

export const DELETE = api({ permission: 'schedule.write' }, async (req, { auth: ctx }) => {
  const id = req.nextUrl.searchParams.get('id')
  const existing = id ? await getScheduleById(id, ctx.orgId) : undefined
  if (!id || !existing || !(await deleteSchedule(id, ctx.orgId))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await audit({ action: 'schedule.delete', targetType: 'schedule', targetId: id, detail: { name: existing.name, version: existing.version, activities: existing.activityCount } })
  return NextResponse.json({ success: true })
})
