import { NextResponse } from 'next/server'
import { api } from '@/lib/server/api'
import { getScheduleById, createChatMessage, getChatMessages } from '@/lib/db'
import { loadScheduleData } from '@/lib/planning/service'
import { askScheduleQuestion } from '@/lib/openai'
import { randomUUID as uuid } from 'crypto'
import { groundedAsk } from '@/lib/rag/answer'
import { projectClassification, projectScope } from '@/lib/rag/scope'

export const POST = api({ permission: 'ai.use' }, async (req, { auth }) => {
  const { question, scheduleId, useDocuments, includeUnreviewed } = await req.json()
  if (!question || !scheduleId) return NextResponse.json({ error: 'Question and scheduleId required' }, { status: 400 })

  const data = await loadScheduleData(scheduleId, auth.orgId)
  if (!data) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
  const { schedule, activities, relationships, brief, hasLogic } = data

  await createChatMessage({ id: uuid(), scheduleId, userId: auth.userId, role: 'user', content: question, createdAt: new Date().toISOString() })

  // "Use project documents": retrieval is scoped in SQL to this organization, this project and the
  // caller's workspaces; see src/lib/rag/answer.ts for the CUI guard, injection screening and citations.
  let answer: string
  let documents = null
  if (useDocuments === true) {
    const { scope } = await projectScope(auth.orgId, String(scheduleId))
    const grounded = await groundedAsk(String(question), { schedule, activities, relationships, brief, hasLogic }, {
      scope, includeUnreviewed: includeUnreviewed === true, userId: auth.userId, projectClassification: await projectClassification(schedule.id, auth.orgId),
    })
    answer = grounded.answer
    documents = grounded.documents
  } else {
    answer = await askScheduleQuestion(question, { schedule, activities, relationships, brief, hasLogic })
  }

  const documentIds = documents ? [...new Set([...documents.sources, ...documents.flagged].map(s => s.documentId))] : []
  await createChatMessage({ id: uuid(), scheduleId, userId: auth.userId, role: 'assistant', content: answer, createdAt: new Date().toISOString(), documentIds })

  return NextResponse.json({ answer, documents })
})

export const GET = api({ permission: 'read' }, async (req, { auth }) => {
  const scheduleId = req.nextUrl.searchParams.get('scheduleId')
  if (!scheduleId) return NextResponse.json({ error: 'scheduleId required' }, { status: 400 })

  if (!(await getScheduleById(scheduleId, auth.orgId))) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
  const messages = await getChatMessages(scheduleId, auth.userId)
  return NextResponse.json({ messages })
})
