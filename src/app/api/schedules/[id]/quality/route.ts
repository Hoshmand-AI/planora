import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getDataQuestionResponses, getScheduleById, saveDataQuestionResponse } from '@/lib/db'
import { runDcma } from '@/lib/analysis/dcma'
import { checkInputs } from '@/lib/analysis/input-checks'
import { analyzableFromDb, loadScheduleData } from '@/lib/planning/service'
import { guidanceFor } from '@/lib/analysis/dcma-guidance'

/** DCMA 14-point assessment + the tool's own questions about the imported data. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const data = await loadScheduleData(params.id, ctx.orgId)
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { schedule, activities, relationships } = data
  const responses = await getDataQuestionResponses(schedule.id)
  const a = analyzableFromDb(schedule, activities, relationships)
  const dcma = runDcma(a)
  const questions = checkInputs(a)
  const byId = new Map(responses.map(r => [r.questionId, r]))
  const guidance = dcma.checks.filter(c => c.result === 'fail' || c.result === 'warn').map(c => ({
    ...guidanceFor(c, { generated: false }),
    decision: byId.get(`dcma:${c.id}`) ?? null,
  }))
  return NextResponse.json({
    guidance,
    brief: data.brief,
    schedule: { id: schedule.id, name: schedule.name, version: schedule.version, sourceType: schedule.sourceType, calendars: schedule.calendars, warnings: schedule.warnings },
    dcma,
    dataQuestions: questions.map(q => ({ ...q, response: byId.get(q.id) ?? null })),
    classification: summarizeCategories(activities.map(x => x.category || 'other')),
  })
}

/** Answer one of the tool's data questions: { questionId, response: intentional|will_fix|not_an_issue, note? } */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const schedule = await getScheduleById(params.id, ctx.orgId)
  if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = await req.json().catch(() => ({}))
  if (typeof body.questionId !== 'string' || !['intentional', 'will_fix', 'not_an_issue'].includes(body.response)) {
    return NextResponse.json({ error: 'questionId and response (intentional | will_fix | not_an_issue) required' }, { status: 400 })
  }
  await saveDataQuestionResponse(schedule.id, { questionId: body.questionId.slice(0, 200), response: body.response, note: typeof body.note === 'string' ? body.note.slice(0, 1000) : null, userId: ctx.userId })
  return NextResponse.json({ success: true })
}

function summarizeCategories(cats: string[]) {
  const counts: Record<string, number> = {}
  for (const c of cats) counts[c] = (counts[c] || 0) + 1
  const total = cats.length || 1
  return { counts, classifiedPct: Math.round(100 * (total - (counts.other || 0)) / total) }
}
