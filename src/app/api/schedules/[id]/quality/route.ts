import { NextResponse } from 'next/server'
import { api } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { getDataQuestionResponses, getReviewState, getScheduleById, getScheduleFile, saveDataQuestionResponse } from '@/lib/db'
import { xerResourceCounts } from '@/lib/parsers/xer-parser'
import { decodeXer } from '@/lib/parsers/xer-codec'
import { runDcma } from '@/lib/analysis/dcma'
import { checkInputs } from '@/lib/analysis/input-checks'
import { analyzableFromDb, basisFrom, basisLabel, basisWarning, loadScheduleData } from '@/lib/planning/service'
import { guidanceFor } from '@/lib/analysis/dcma-guidance'
import { loadScheduleResources } from '@/lib/planning/resource-service'

/** DCMA 14-point assessment + the tool's own questions about the imported data. */
export const GET = api<{ id: string }>({ permission: 'read', apiKey: true }, async (req, { params, auth: ctx }) => {
  // DCMA of the schedule as submitted; ?basis=scenario assesses the what-if scenario with the Planora edits.
  const data = await loadScheduleData(params.id, ctx.orgId, { basis: basisFrom(req.nextUrl.searchParams) })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { schedule, activities, relationships } = data
  const [responses, review] = await Promise.all([getDataQuestionResponses(schedule.id), getReviewState(schedule.id, ctx.orgId)])
  // P6 resource assignments (TASKRSRC) are not stored per activity; read them from the original file.
  let resourceCounts: Record<string, number> | null = null
  if (schedule.sourceType === 'p6_xer') {
    const f = await getScheduleFile(schedule.id, ctx.orgId).catch(() => undefined)
    if (f) resourceCounts = xerResourceCounts(decodeXer(f.content).text)
  } else if (schedule.sourceType === 'ms_xml' || schedule.sourceType === 'excel' || schedule.sourceType === 'csv') {
    // MS Project Assignments / spreadsheet resource columns (resource analysis reads the same data).
    const rd = await loadScheduleResources(schedule, ctx.orgId, activities).catch(() => null)
    if (rd) {
      const byId = new Map(activities.map(x => [x.id, x.sourceId]))
      resourceCounts = Object.fromEntries(activities.filter(x => x.sourceId).map(x => [x.sourceId!, 0]))
      for (const x of rd.assignments) { const k = byId.get(x.activityId); if (k) resourceCounts[k] = (resourceCounts[k] || 0) + 1 }
    }
  }
  const a = analyzableFromDb(schedule, activities, relationships, resourceCounts)
  const dcma = runDcma(a, ctx.settings.quality)
  const questions = checkInputs(a)
  const byId = new Map(responses.map(r => [r.questionId, r]))
  const guidance = dcma.checks.filter(c => c.result === 'fail' || c.result === 'warn').map(c => ({
    // Uploads with logic have what-if / recovery options and Planora edits on the schedule dashboard.
    ...guidanceFor(c, { generated: false, uploadedRecoveryHref: data.cpm && schedule.sourceType !== 'generated' ? `/dashboard?schedule=${encodeURIComponent(schedule.id)}#recovery` : undefined }),
    decision: byId.get(`dcma:${c.id}`) ?? null,
  }))
  return NextResponse.json({
    basis: data.basis, basisLabel: basisLabel(data.basis, data.editsApplied), editsApplied: data.editsApplied,
    basisNote: basisWarning(data.basis, data.editsApplied),
    guidance,
    brief: data.brief,
    schedule: { id: schedule.id, name: schedule.name, version: schedule.version, sourceType: schedule.sourceType, calendars: schedule.calendars, warnings: schedule.warnings },
    dcma,
    dataQuestions: questions.map(q => ({ ...q, response: byId.get(q.id) ?? null })),
    classification: summarizeCategories(activities.map(x => x.category || 'other')),
    review,
  })
})

/** Answer one of the tool's data questions: { questionId, response: intentional|will_fix|not_an_issue, note? } */
export const POST = api<{ id: string }>({ permission: 'schedule.write' }, async (req, { params, auth: ctx }) => {
  const schedule = await getScheduleById(params.id, ctx.orgId)
  if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = await req.json().catch(() => ({}))
  if (typeof body.questionId !== 'string' || !['intentional', 'will_fix', 'not_an_issue'].includes(body.response)) {
    return NextResponse.json({ error: 'questionId and response (intentional | will_fix | not_an_issue) required' }, { status: 400 })
  }
  const note = typeof body.note === 'string' ? body.note.slice(0, 1000) : null
  await saveDataQuestionResponse(schedule.id, { questionId: body.questionId.slice(0, 200), response: body.response, note, userId: ctx.userId })
  await audit({ action: body.questionId.startsWith('dcma:') ? 'schedule.dcma_decision' : 'schedule.data_question', targetType: 'schedule', targetId: schedule.id, detail: { schedule: schedule.name, questionId: body.questionId.slice(0, 200), response: body.response, note } })
  return NextResponse.json({ success: true })
})

function summarizeCategories(cats: string[]) {
  const counts: Record<string, number> = {}
  for (const c of cats) counts[c] = (counts[c] || 0) + 1
  const total = cats.length || 1
  return { counts, classifiedPct: Math.round(100 * (total - (counts.other || 0)) / total) }
}
