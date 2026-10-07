import { NextResponse } from 'next/server'
import { createHash, randomUUID as uuid } from 'crypto'
import { api, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { entitlementsFor, requireFeature } from '@/lib/server/entitlements'
import { hit, LIMITS } from '@/lib/server/rate-limit'
import { createSchedule, getSchedules, getScheduleById, getScheduleSeries, getActivities, createActivities, createRelationships, deleteSchedule, updateScheduleProfile, saveScheduleFile, findScheduleFilesBySha, setScheduleInHistory, setScheduleFinishMilestone, updateScheduleAnalysis, updateScheduleMeta, setScheduleVersion, isPlanoraExportSha, countUploadedSchedules } from '@/lib/db'
import { analyzeSchedule } from '@/lib/analysis/schedule-analysis'
import { parseScheduleFile } from '@/lib/parsers'
import { classifySchedule, normalizeCalendar } from '@/lib/semantic/taxonomy'
import { checkInputs } from '@/lib/analysis/input-checks'
import { nearTermOutlook } from '@/lib/analysis/near-term'
import { recalcWarning } from '@/lib/analysis/recalc-warning'
import { analyzableFromDb, basisFrom, basisLabel, loadScheduleData, pickSeriesBaseline, seriesBaselineFrom } from '@/lib/planning/service'
import { completeSchedule } from '@/lib/planning/complete-schedule'
import { PROJECT_TYPES, projectTypeError } from '@/lib/planning/types'
import { fmtDate, fmtDay } from '@/lib/format'
import { decideHistory, inheritSeriesProfile, progressModeWarning, resolveProgressMode, seriesDataDateWarning } from '@/lib/planning/upload-rules'

const CLASSIFICATIONS = ['unclassified', 'cui', 'classified'] as const
type ScheduleClassification = typeof CLASSIFICATIONS[number]
const isClassification = (v: unknown): v is ScheduleClassification => typeof v === 'string' && (CLASSIFICATIONS as readonly string[]).includes(v)
const ORIGINS = ['own', 'third_party'] as const
const isOrigin = (v: unknown): v is 'own' | 'third_party' => typeof v === 'string' && (ORIGINS as readonly string[]).includes(v)
/** Activities that must carry an actual finish for an as-built schedule (not LOE or WBS summaries). */
const workCounts = (acts: { activityType: string; actualFinish: string | null }[]) => {
  const work = acts.filter(a => a.activityType !== 'loe' && a.activityType !== 'summary')
  return { workCount: work.length, openCount: work.filter(a => !a.actualFinish).length }
}
import { currentWorkspaceAccess } from '@/lib/server/workspace-scope'
import { classifiedCloudRefusal, CLASSIFIED_CLOUD_CODE } from '@/lib/server/classification'
import { deploymentKind } from '@/lib/llm/provider'
import { workspaceForNewItem } from '@/lib/server/workspaces'

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

export const GET = api({ permission: 'read', apiKey: true }, async (req, { auth: ctx }) => {
  const scheduleId = req.nextUrl.searchParams.get('id')

  if (scheduleId) {
    // Firm-scoped: a schedule from another organization is indistinguishable from a missing one.
    // As submitted by default; ?basis=scenario shows the what-if scenario with the Planora edits.
    const data = await loadScheduleData(scheduleId, ctx.orgId, { basis: basisFrom(req.nextUrl.searchParams) })
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const { schedule, activities, relationships, brief, analysis, edits, editedActivityIds, basis, editsApplied } = data

    const criticalActivities = activities.filter(a => a.isCritical)
    // Driving tasks: the longest path (P6 "longest path"), open work first, in sequence.
    const byId = new Map(activities.map(a => [a.id, a]))
    const longest = analysis.longestPath.map(id => byId.get(id)).filter((a): a is NonNullable<typeof a> => !!a && a.status !== 'complete')
    // Window: the data date (today when there is none) to +14 days; work under way is listed separately.
    const nearTerm = nearTermOutlook(activities, schedule.dataDate, new Date().toISOString().slice(0, 10))
    const completedCount = activities.filter(a => a.status === 'complete').length
    const percentComplete = activities.length > 0
      ? Math.round((completedCount / activities.length) * 100)
      : 0

    return NextResponse.json({
      schedule, activities, relationships, brief, analysis, edits, editedActivityIds,
      basis, basisLabel: basisLabel(basis, editsApplied), scenarioActivityIds: data.scenarioActivityIds,
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
        nearTerm,
        drivingTasks: (longest.length ? longest : criticalActivities).slice(0, 10),
        // Edits made in Planora (override layer on the uploaded file)
        editedActivityIds,
        editsCount: editsApplied,
        basis,
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
    // Plan limits count the whole organization, not just the workspaces this member can see.
    const uploaded = await countUploadedSchedules(ctx.orgId)
    requireFeature(ctx.plan, uploaded < ent.maxUploadedSchedules, `More than ${ent.maxUploadedSchedules} uploaded schedules`)
  }
  const quota = await hit(`upload:org:${ctx.orgId}`, LIMITS.uploadsPerOrg.limit, LIMITS.uploadsPerOrg.windowSec)
  if (!quota.ok) throw new ApiError(429, 'Your organization has uploaded a lot of files in the last hour. Try again later.', 'rate_limited', { retryAfterSec: quota.retryAfterSec })
  {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const versionInput = ((formData.get('version') as string) || '').trim().slice(0, 40)
    const progressInput = formData.get('progressMode')
    const chosenMode = progressInput === 'override' || progressInput === 'retained' ? progressInput : null
    const inHistoryInput = formData.get('inHistory')
    const historyOverrideInput = formData.get('historyOverride') === 'true'
    const classificationInput = formData.get('classification') || null
    if (classificationInput !== null && !isClassification(classificationInput)) return NextResponse.json({ error: `classification must be one of ${CLASSIFICATIONS.join(', ')}.` }, { status: 400 })
    // The commercial cloud does not take classified schedules (nothing is parsed or stored).
    const classifiedRefusal = classifiedCloudRefusal(classificationInput, deploymentKind())
    if (classifiedRefusal) {
      await audit({ action: 'schedule.upload_refused', detail: { reason: CLASSIFIED_CLOUD_CODE, fileName: file?.name ?? null, deployment: deploymentKind() } })
      return NextResponse.json({ error: classifiedRefusal, code: CLASSIFIED_CLOUD_CODE }, { status: 409 })
    }
    const originInput = formData.get('origin') || null
    if (originInput !== null && !isOrigin(originInput)) return NextResponse.json({ error: 'origin must be own or third_party.' }, { status: 400 })
    const projectIdInput = (formData.get('projectId') as string) || null
    const projectType = formData.get('projectType') as string | null
    const region = formData.get('region') as string | null
    const grossSqft = Number(formData.get('grossSqft')) || null
    const allowDuplicate = formData.get('allowDuplicate') === 'true'
    const workspaceInput = formData.get('workspaceId')
    // An unknown facility type is refused, not silently dropped (the upload would lose its grounding tag).
    const typeErr = projectTypeError(projectType)
    if (typeErr) return NextResponse.json({ error: typeErr, code: 'invalid_project_type', validTypes: PROJECT_TYPES }, { status: 400 })

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

    // Uploads of the same project form an update series.
    const projectKey = (parsed.projectKey || parsed.projectName || '').trim().toLowerCase().slice(0, 120) || null
    const series = projectKey ? await getScheduleSeries(ctx.orgId, projectKey) : []

    // The same bytes uploaded again are not a new update: point at the existing one instead of adding a
    // duplicate to the series (send allowDuplicate=true to store it anyway).
    const same = allowDuplicate ? [] : await findScheduleFilesBySha(ctx.orgId, sha256, series.map(s => s.id))
    const existing = same.length ? series.find(s => s.id === same[0]) : undefined
    if (existing) {
      const warning = `This file is identical to ${existing.version} uploaded ${fmtDay(existing.uploadedAt)} (same SHA-256); no new update was created.`
      await audit({ action: 'schedule.upload_duplicate', targetType: 'schedule', targetId: existing.id, detail: { name: existing.name, version: existing.version, fileName: file.name, sha256 } })
      return NextResponse.json({
        success: true, duplicate: true, duplicateOf: { id: existing.id, version: existing.version, uploadedAt: existing.uploadedAt }, warning, schedule: existing,
        summary: {
          activitiesImported: existing.activityCount, relationshipsImported: existing.relationshipCount, calendarsImported: existing.calendars.length,
          criticalCount: existing.criticalCount, projectStart: existing.projectStart, projectFinish: existing.projectFinish, forecastFinish: existing.analysis?.forecastFinish ?? existing.projectFinish,
          varianceDays: existing.varianceDays, status: existing.analysis?.status ?? null, sha256, series: series.length, classifiedPct: 0, dataQuestions: 0,
          warnings: [warning],
        },
      })
    }

    // Workspace (matter): the one asked for, else the update series' workspace, else the default for
    // this member (restricted members' uploads go into their workspace).
    const latestInSeries = series[series.length - 1]
    const workspaceId = workspaceInput || !latestInSeries
      ? await workspaceForNewItem(ctx.orgId, await currentWorkspaceAccess(), workspaceInput)
      : latestInSeries.workspaceId ?? null

    // Semantic normalization: firms label activities and calendars differently; map them to shared meaning.
    // Highway, bridge and airfield uploads are read with the road vocabulary (paving, signals, seeding, cure).
    let classified = 0
    const { results: classes } = classifySchedule(parsed.activities, projectType)
    parsed.activities.forEach((a, i) => {
      a.category = classes[i].category
      if (classes[i].category !== 'other') classified++
    })
    const warnings = [...parsed.warnings]
    for (const cal of parsed.calendars) {
      const n = normalizeCalendar({ name: cal.name, workDays: cal.workDays, hoursPerDay: cal.hoursPerDay })
      cal.sourceName = cal.sourceName || cal.name
      cal.canonical = n.canonical
      if (n.conflict) warnings.push(`Calendar "${cal.name}": ${n.conflict}`)
    }

    // Progress mode: the scheduler's choice, else the file's own P6 setting (SCHEDOPTIONS).
    const { mode: progressMode, warning: modeWarning } = resolveProgressMode(chosenMode, parsed.progressMode ?? null)
    if (modeWarning) warnings.push(modeWarning)

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

    // Label versions automatically when not given.
    const versionLabel = versionInput || (series.length ? `Update ${series.length}` : 'Baseline')
    // An update is measured against the series' upload marked Baseline (same activity codes).
    const baseUpload = pickSeriesBaseline({ id: scheduleId, version: versionLabel, dataDate: parsed.dataDate }, series)
    const baseActivities = baseUpload ? await getActivities(baseUpload.id) : []
    const seriesBaseline = seriesBaselineFrom({ id: scheduleId, version: versionLabel, dataDate: parsed.dataDate }, series, () => baseActivities)

    const analysis = analyzeSchedule({
      activities: parsed.activities, links: parsed.relationships.map(r => ({ from: r.predecessorId, to: r.successorId })), cpm: completed.cpm,
      reportedFinish, mustFinishBy: parsed.mustFinishBy ?? null, fileValues: completed.fileValues, today: new Date().toISOString().slice(0, 10),
      dataDate: parsed.dataDate, seriesBaseline, calendars: parsed.calendars, defaultCalendarId: parsed.defaultCalendarId,
      fileProgressMode: parsed.progressMode ?? null,
    })
    const recalcNote = recalcWarning(analysis.recalc)
    if (recalcNote) warnings.unshift(recalcNote)
    if (reportedFinish && analysis.forecastFinish && reportedFinish !== analysis.forecastFinish) {
      warnings.unshift(`The file's header finish is ${fmtDate(reportedFinish)}; Planora's recalculated forecast finish is ${fmtDate(analysis.forecastFinish)}. Planora reports its own forecast.`)
    }
    const varianceDays = analysis.varianceDays
    const percentComplete = parsed.activities.length > 0
      ? Math.round((parsed.activities.filter(a => a.status === 'complete').length / parsed.activities.length) * 100)
      : 0
    // Firm history: own as-built projects by default; never a Planora re-import or a third-party schedule.
    const planoraExport = !!parsed.planoraExport || await isPlanoraExportSha(ctx.orgId, sha256).catch(() => false)
    const history = decideHistory({
      requested: inHistoryInput === 'true' ? true : inHistoryInput === 'false' ? false : null, override: historyOverrideInput,
      origin: originInput, planoraExport, ...workCounts(parsed.activities),
    })
    const inHistory = history.inHistory
    warnings.push(...history.warnings)
    // Update series: a later upload inherits the project's tags it omits; flag out-of-order data dates.
    const profile = inheritSeriesProfile(series, {
      projectType: projectType && (PROJECT_TYPES as readonly string[]).includes(projectType) ? projectType : null,
      region: region ? region.toUpperCase().slice(0, 12) : null, grossSqft,
    })
    if (profile.inherited.length) warnings.push(`Tags carried over from earlier uploads of this project: ${profile.inherited.map(k => ({ projectType: 'facility type', region: 'state', grossSqft: 'gross area' } as Record<string, string>)[k]).join(', ')}.`)
    const orderWarning = seriesDataDateWarning(series, parsed.dataDate, versionLabel)
    if (orderWarning) warnings.unshift(orderWarning)

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
      projectType: profile.projectType,
      region: profile.region,
      grossSqft: profile.grossSqft,
      workspaceId,
    })
    const meta = { classification: classificationInput, uploadOrigin: originInput, planoraExport, historyOverride: history.historyOverride }
    await updateScheduleMeta(schedule.id, ctx.orgId, meta)
    Object.assign(schedule, meta)

    if (parsed.activities.length > 0) await createActivities(parsed.activities)
    if (parsed.relationships.length > 0) await createRelationships(parsed.relationships)
    // Keep the original file for chain of custody (its SHA-256 is also in the audit log).
    await saveScheduleFile({ scheduleId: schedule.id, orgId: ctx.orgId, fileName: file.name, sha256, content: bytes })

    const dataQuestions = checkInputs(analyzableFromDb(schedule, parsed.activities, parsed.relationships))
    await audit({ action: 'schedule.upload', targetType: 'schedule', targetId: schedule.id, detail: { name: schedule.name, version: schedule.version, fileName: file.name, bytes: file.size, sha256, sourceType: schedule.sourceType, activities: parsed.activities.length, relationships: parsed.relationships.length, classification: classificationInput, origin: originInput, inHistory, historyOverride: history.historyOverride, planoraExport, progressMode, workspaceId } })

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
 * firm history { inHistory, historyOverride (include although not as-built), origin: own | third_party };
 * choose progress handling { progressMode }; designate the contract / finish milestone
 * { finishMilestoneId: activity id or activity code, or null for automatic }; relabel the upload
 * { version }; or set its security classification { classification: unclassified | cui | classified }.
 * Every change is audited; `warnings` explains settings that will not behave as the caller may expect.
 */
export const PATCH = api({ permission: 'schedule.write' }, async (req, { auth: ctx }) => {
  const body = await req.json().catch(() => ({}))
  const s = body.id ? await getScheduleById(String(body.id), ctx.orgId) : undefined
  if (!s) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const typeErr = projectTypeError(body.projectType)
  if (typeErr) return NextResponse.json({ error: typeErr, code: 'invalid_project_type', validTypes: PROJECT_TYPES }, { status: 400 })
  if ('classification' in body && !isClassification(body.classification)) return NextResponse.json({ error: `classification must be one of ${CLASSIFICATIONS.join(', ')}.` }, { status: 400 })
  const classifiedRefusal = 'classification' in body ? classifiedCloudRefusal(body.classification, deploymentKind()) : null
  if (classifiedRefusal) {
    await audit({ action: 'schedule.classification_refused', targetType: 'schedule', targetId: s.id, detail: { name: s.name, requested: 'classified', reason: CLASSIFIED_CLOUD_CODE, deployment: deploymentKind() } })
    return NextResponse.json({ error: classifiedRefusal, code: CLASSIFIED_CLOUD_CODE }, { status: 409 })
  }
  if ('origin' in body && body.origin !== null && !isOrigin(body.origin)) return NextResponse.json({ error: 'origin must be own, third_party or null.' }, { status: 400 })
  let version: string | null = null
  if ('version' in body) {
    version = typeof body.version === 'string' ? body.version.trim().slice(0, 40) : ''
    if (!version) return NextResponse.json({ error: 'version must be a non-empty label (40 characters at most).' }, { status: 400 })
  }
  const warnings: string[] = []

  if (version !== null && version !== s.version) {
    await setScheduleVersion(s.id, ctx.orgId, version)
    await audit({ action: 'schedule.relabel', targetType: 'schedule', targetId: s.id, detail: { name: s.name, before: s.version, after: version } })
    // Relabeling can make (or stop making) this upload the series Baseline; the next read re-measures variance.
    if (s.projectKey) {
      const series = await getScheduleSeries(ctx.orgId, s.projectKey)
      if (series.some(x => x.id !== s.id && x.version.trim().toLowerCase() === version!.toLowerCase())) warnings.push(`Another upload of this project is also labelled "${version}".`)
    }
  }
  if ('classification' in body && body.classification !== (s.classification ?? null)) {
    await updateScheduleMeta(s.id, ctx.orgId, { classification: body.classification })
    await audit({ action: 'schedule.classification', targetType: 'schedule', targetId: s.id, detail: { name: s.name, before: s.classification ?? null, after: body.classification } })
    if (body.classification !== 'unclassified') warnings.push('CUI and classified schedules are never sent to a cloud AI model, every export carries the banner and designation markings, and CSV exports are refused.')
  }
  if ('origin' in body && (body.origin ?? null) !== (s.uploadOrigin ?? null)) {
    await updateScheduleMeta(s.id, ctx.orgId, { uploadOrigin: body.origin ?? null })
    await audit({ action: 'schedule.origin', targetType: 'schedule', targetId: s.id, detail: { name: s.name, before: s.uploadOrigin ?? null, after: body.origin ?? null } })
  }
  if (typeof body.inHistory === 'boolean' || typeof body.historyOverride === 'boolean') {
    const requested = typeof body.inHistory === 'boolean' ? body.inHistory : (s.inHistory ?? true)
    const decision = decideHistory({
      requested, override: typeof body.historyOverride === 'boolean' ? body.historyOverride : (s.historyOverride ?? false),
      origin: 'origin' in body ? (body.origin ?? null) : (s.uploadOrigin ?? null), planoraExport: !!s.planoraExport, ...workCounts(await getActivities(s.id)),
    })
    warnings.push(...decision.warnings)
    if (decision.inHistory !== (s.inHistory ?? true) || decision.historyOverride !== !!s.historyOverride) {
      await setScheduleInHistory(s.id, ctx.orgId, decision.inHistory)
      await updateScheduleMeta(s.id, ctx.orgId, { historyOverride: decision.historyOverride })
      await audit({ action: 'schedule.history', targetType: 'schedule', targetId: s.id, detail: { name: s.name, before: s.inHistory ?? true, after: decision.inHistory, requested, historyOverride: decision.historyOverride } })
    }
  }
  if ((body.progressMode === 'retained' || body.progressMode === 'override') && s.analysis && s.analysis.progressMode !== body.progressMode) {
    // Store the choice; the next read recalculates with it.
    await updateScheduleAnalysis(s.id, ctx.orgId, { analysis: { ...s.analysis, progressMode: body.progressMode, forecastFinish: null }, projectFinish: s.projectFinish, varianceDays: s.varianceDays, criticalCount: s.criticalCount })
    await audit({ action: 'schedule.progress_mode', targetType: 'schedule', targetId: s.id, detail: { name: s.name, before: s.analysis.progressMode, after: body.progressMode, fileProgressMode: s.analysis.fileProgressMode ?? null } })
    const w = progressModeWarning(body.progressMode, s.analysis.fileProgressMode)
    if (w) warnings.push(w)
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
    return NextResponse.json({ schedule: data?.schedule ?? await getScheduleById(s.id, ctx.orgId), analysis: data?.analysis ?? null, warnings })
  }
  return NextResponse.json({ schedule: await getScheduleById(s.id, ctx.orgId), warnings })
})

export const DELETE = api({ permission: 'schedule.write' }, async (req, { auth: ctx }) => {
  const id = req.nextUrl.searchParams.get('id')
  const existing = id ? await getScheduleById(id, ctx.orgId) : undefined
  if (!id || !existing || !(await deleteSchedule(id, ctx.orgId))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await audit({ action: 'schedule.delete', targetType: 'schedule', targetId: id, detail: { name: existing.name, version: existing.version, activities: existing.activityCount } })
  return NextResponse.json({ success: true })
})
