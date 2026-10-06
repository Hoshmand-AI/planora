import { NextResponse } from 'next/server'
import { createHash, randomUUID as uuid } from 'crypto'
import { api, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { entitlementsFor, requireFeature } from '@/lib/server/entitlements'
import { hit, LIMITS } from '@/lib/server/rate-limit'
import { createSchedule, getSchedules, getScheduleById, getScheduleSeries, getActivities, createActivities, createRelationships, deleteSchedule, updateScheduleProfile, saveScheduleFile, setScheduleInHistory, setScheduleFinishMilestone, updateScheduleAnalysis } from '@/lib/db'
import { analyzeSchedule } from '@/lib/analysis/schedule-analysis'
import { parseScheduleFile } from '@/lib/parsers'
import { classifyActivity, normalizeCalendar } from '@/lib/semantic/taxonomy'
import { checkInputs } from '@/lib/analysis/input-checks'
import { analyzableFromDb, loadScheduleData, pickSeriesBaseline, seriesBaselineFrom } from '@/lib/planning/service'
import { completeSchedule } from '@/lib/planning/complete-schedule'
import { PROJECT_TYPES } from '@/lib/planning/types'
import { fmtDate } from '@/lib/format'

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

export const GET = api({ permission: 'read', apiKey: true }, async (req, { auth: ctx }) => {
  const scheduleId = req.nextUrl.searchParams.get('id')

  if (scheduleId) {
    // Firm-scoped: a schedule from another organization is indistinguishable from a missing one.
    const data = await loadScheduleData(scheduleId, ctx.orgId)
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const { schedule, activities, relationships, brief, analysis } = data

    const criticalActivities = activities.filter(a => a.isCritical)
    // Driving tasks: the longest path (P6 "longest path"), open work first, in sequence.
    const byId = new Map(activities.map(a => [a.id, a]))
    const longest = analysis.longestPath.map(id => byId.get(id)).filter((a): a is NonNullable<typeof a> => !!a && a.status !== 'complete')
    const nearTermTasks = activities
      .filter(a => a.status !== 'complete' && a.earlyStart)
      .sort((a, b) => (a.earlyStart || '').localeCompare(b.earlyStart || ''))
      .slice(0, 10)
    const completedCount = activities.filter(a => a.status === 'complete').length
    const percentComplete = activities.length > 0
      ? Math.round((completedCount / activities.length) * 100)
      : 0

    return NextResponse.json({
      schedule, activities, relationships, brief, analysis,
      metrics: {
        totalActivities: activities.length,
        criticalCount: criticalActivities.length,
        completedCount,
        inProgressCount: activities.filter(a => a.status === 'in_progress').length,
        notStartedCount: activities.filter(a => a.status === 'not_started').length,
        percentComplete,
        varianceDays: analysis.varianceDays,
        varianceBasis: analysis.varianceBasis,
        forecastFinish: analysis.forecastFinish,
        reportedFinish: analysis.reportedFinish,
        status: analysis.status,
        statusReasons: analysis.statusReasons,
        minFloat: analysis.minFloat,
        nearTermTasks,
        drivingTasks: (longest.length ? longest : criticalActivities).slice(0, 10),
      },
    })
  }

  // The list carries the headline analysis only (no driving-path ids or recalculation samples).
  const schedules = (await getSchedules(ctx.orgId)).map(s => s.analysis
    ? { ...s, analysis: { ...s.analysis, longestPath: [], recalc: s.analysis.recalc ? { ...s.analysis.recalc, samples: [] } : null } }
    : s)
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
    const versionInput = ((formData.get('version') as string) || '').trim().slice(0, 40)
    const progressMode = formData.get('progressMode') === 'override' ? 'override' : 'retained'
    const inHistoryInput = formData.get('inHistory')
    const projectIdInput = (formData.get('projectId') as string) || null
    const projectType = formData.get('projectType') as string | null
    const region = formData.get('region') as string | null
    const grossSqft = Number(formData.get('grossSqft')) || null

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: 'File is larger than 25 MB.' }, { status: 413 })

    const scheduleId = uuid()
    let parsed
    const bytes = Buffer.from(await file.arrayBuffer())
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    try {
      parsed = await parseScheduleFile(file.name, bytes, scheduleId, { projectId: projectIdInput })
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

    // Recalculate the network (never trust header dates or stored float) and analyze it.
    const reportedFinish = parsed.projectFinish
    const completed = completeSchedule({
      activities: parsed.activities, relationships: parsed.relationships, calendars: parsed.calendars, defaultCalendarId: parsed.defaultCalendarId,
      projectStart: parsed.projectStart, projectFinish: parsed.projectFinish, dataDate: parsed.dataDate,
      mustFinishBy: parsed.mustFinishBy ?? null, progressMode,
    })
    parsed.activities = completed.activities
    parsed.projectStart = completed.projectStart
    if (completed.note) warnings.unshift(completed.note)

    // Uploads of the same project form an update series; label versions automatically when not given.
    const projectKey = (parsed.projectKey || parsed.projectName || '').trim().toLowerCase().slice(0, 120) || null
    const series = projectKey ? await getScheduleSeries(ctx.orgId, projectKey) : []
    const versionLabel = versionInput || (series.length ? `Update ${series.length}` : 'Baseline')
    // An update is measured against the series' upload marked Baseline (same activity codes).
    const baseUpload = pickSeriesBaseline({ id: scheduleId, version: versionLabel, dataDate: parsed.dataDate }, series)
    const baseActivities = baseUpload ? await getActivities(baseUpload.id) : []
    const seriesBaseline = seriesBaselineFrom({ id: scheduleId, version: versionLabel, dataDate: parsed.dataDate }, series, () => baseActivities)

    const analysis = analyzeSchedule({
      activities: parsed.activities, links: parsed.relationships.map(r => ({ from: r.predecessorId, to: r.successorId })), cpm: completed.cpm,
      reportedFinish, mustFinishBy: parsed.mustFinishBy ?? null, fileValues: completed.fileValues, today: new Date().toISOString().slice(0, 10),
      dataDate: parsed.dataDate, seriesBaseline, calendars: parsed.calendars, defaultCalendarId: parsed.defaultCalendarId,
    })
    if (analysis.recalc && analysis.recalc.differing > 0) {
      warnings.unshift(`${analysis.recalc.differing} of ${analysis.recalc.compared} open activities have a finish or total float in the file that differs from Planora's recalculation by more than 1 day (e.g. ${analysis.recalc.samples.slice(0, 3).map(d => `${d.code}: file ${d.fileFloat ?? '?'}d / Planora ${d.planoraFloat}d float`).join('; ')}).`)
    }
    if (reportedFinish && analysis.forecastFinish && reportedFinish !== analysis.forecastFinish) {
      warnings.unshift(`The file's header finish is ${fmtDate(reportedFinish)}; Planora's recalculated forecast finish is ${fmtDate(analysis.forecastFinish)}. Planora reports its own forecast.`)
    }
    const varianceDays = analysis.varianceDays
    const percentComplete = parsed.activities.length > 0
      ? Math.round((parsed.activities.filter(a => a.status === 'complete').length / parsed.activities.length) * 100)
      : 0
    // Only finished (as-built) projects calibrate firm history unless the uploader says otherwise.
    const inHistory = inHistoryInput === 'true' ? true : inHistoryInput === 'false' ? false : percentComplete >= 95

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
      projectFinish: analysis.forecastFinish,
      dataDate: parsed.dataDate,
      varianceDays,
      criticalCount: parsed.activities.filter(a => a.isCritical).length,
      percentComplete,
      analysis,
      projectKey,
      inHistory,
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
    // Keep the original file for chain of custody (its SHA-256 is also in the audit log).
    await saveScheduleFile({ scheduleId: schedule.id, orgId: ctx.orgId, fileName: file.name, sha256, content: bytes })

    const dataQuestions = checkInputs(analyzableFromDb(schedule, parsed.activities, parsed.relationships))
    await audit({ action: 'schedule.upload', targetType: 'schedule', targetId: schedule.id, detail: { name: schedule.name, version: schedule.version, fileName: file.name, bytes: file.size, sha256, sourceType: schedule.sourceType, activities: parsed.activities.length, relationships: parsed.relationships.length } })

    return NextResponse.json({
      success: true, schedule,
      summary: {
        activitiesImported: parsed.activities.length,
        relationshipsImported: parsed.relationships.length,
        calendarsImported: parsed.calendars.length,
        criticalCount: parsed.activities.filter(a => a.isCritical).length,
        projectStart: parsed.projectStart,
        projectFinish: analysis.forecastFinish,
        forecastFinish: analysis.forecastFinish,
        reportedFinish,
        varianceDays,
        varianceBasis: analysis.varianceBasis,
        status: analysis.status,
        sha256,
        series: series.length + 1,
        classifiedPct: parsed.activities.length ? Math.round((classified / parsed.activities.length) * 100) : 0,
        dataQuestions: dataQuestions.length,
        warnings,
      },
    })
  }
})

/**
 * Tag a schedule so it can ground future plans: { id, projectType, region, grossSqft }; include it in
 * firm history { inHistory }; choose progress handling { progressMode }; or designate the contract /
 * finish milestone { finishMilestoneId: activity id or activity code, or null for automatic }.
 */
export const PATCH = api({ permission: 'schedule.write' }, async (req, { auth: ctx }) => {
  const body = await req.json().catch(() => ({}))
  const s = body.id ? await getScheduleById(String(body.id), ctx.orgId) : undefined
  if (!s) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (typeof body.inHistory === 'boolean') {
    await setScheduleInHistory(s.id, ctx.orgId, body.inHistory)
    await audit({ action: 'schedule.history', targetType: 'schedule', targetId: s.id, detail: { name: s.name, before: s.inHistory ?? true, after: body.inHistory } })
  }
  if ((body.progressMode === 'retained' || body.progressMode === 'override') && s.analysis && s.analysis.progressMode !== body.progressMode) {
    // Store the choice; the next read recalculates with it.
    await updateScheduleAnalysis(s.id, ctx.orgId, { analysis: { ...s.analysis, progressMode: body.progressMode, forecastFinish: null }, projectFinish: s.projectFinish, varianceDays: s.varianceDays, criticalCount: s.criticalCount })
    await audit({ action: 'schedule.progress_mode', targetType: 'schedule', targetId: s.id, detail: { name: s.name, before: s.analysis.progressMode, after: body.progressMode } })
  }
  if ('finishMilestoneId' in body) {
    const raw = body.finishMilestoneId
    if (raw !== null && typeof raw !== 'string') return NextResponse.json({ error: 'finishMilestoneId must be an activity id, an activity code or null' }, { status: 400 })
    let next: string | null = null
    let label: string | null = null
    if (typeof raw === 'string' && raw.trim()) {
      const want = raw.trim().slice(0, 200)
      const acts = await getActivities(s.id)
      const hit = acts.find(a => a.id === want) ?? acts.find(a => a.activityId === want) ?? acts.find(a => a.activityId.toLowerCase() === want.toLowerCase())
      if (!hit || hit.activityType === 'summary' || hit.activityType === 'loe') return NextResponse.json({ error: `No activity "${want}" in this schedule can be the finish milestone.` }, { status: 400 })
      next = hit.activityId || hit.id
      label = `${hit.activityId} ${hit.name}`
    }
    const before = s.finishMilestoneId ?? null
    if (before !== next) {
      await setScheduleFinishMilestone(s.id, ctx.orgId, next)
      await audit({ action: 'schedule.finish_milestone', targetType: 'schedule', targetId: s.id, detail: { name: s.name, before, after: next, milestone: label, previousAutomatic: before ? null : s.analysis?.finishMilestone?.code ?? null } })
    }
  }
  if ('projectType' in body || 'region' in body || 'grossSqft' in body) {
    const projectType = typeof body.projectType === 'string' && (PROJECT_TYPES as readonly string[]).includes(body.projectType) ? body.projectType : null
    const profile = { projectType, region: typeof body.region === 'string' ? body.region.toUpperCase().slice(0, 12) : null, grossSqft: Number(body.grossSqft) || null }
    await updateScheduleProfile(s.id, ctx.orgId, profile)
    await audit({ action: 'schedule.tag', targetType: 'schedule', targetId: s.id, detail: { name: s.name, before: { projectType: s.projectType, region: s.region, grossSqft: s.grossSqft }, after: profile } })
  }
  if ('finishMilestoneId' in body) {
    // Recalculate now so the stored headline (lists, portfolio) reflects the designated milestone.
    const data = await loadScheduleData(s.id, ctx.orgId)
    return NextResponse.json({ schedule: data?.schedule ?? await getScheduleById(s.id, ctx.orgId), analysis: data?.analysis ?? null })
  }
  return NextResponse.json({ schedule: await getScheduleById(s.id, ctx.orgId) })
})

export const DELETE = api({ permission: 'schedule.write' }, async (req, { auth: ctx }) => {
  const id = req.nextUrl.searchParams.get('id')
  const existing = id ? await getScheduleById(id, ctx.orgId) : undefined
  if (!id || !existing || !(await deleteSchedule(id, ctx.orgId))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await audit({ action: 'schedule.delete', targetType: 'schedule', targetId: id, detail: { name: existing.name, version: existing.version, activities: existing.activityCount } })
  return NextResponse.json({ success: true })
})
