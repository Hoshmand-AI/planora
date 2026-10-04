import { NextResponse } from 'next/server'
import { api } from '@/lib/server/api'
import { getScheduleById, createChatMessage, getChatMessages } from '@/lib/db'
import { loadScheduleData } from '@/lib/planning/service'
import { askScheduleQuestion } from '@/lib/openai'
import { randomUUID as uuid } from 'crypto'

export const POST = api({ permission: 'ai.use' }, async (req, { auth }) => {
  const { question, scheduleId } = await req.json()
  if (!question || !scheduleId) return NextResponse.json({ error: 'Question and scheduleId required' }, { status: 400 })

  const data = await loadScheduleData(scheduleId, auth.orgId)
  if (!data) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
  const { schedule, activities, relationships, brief, hasLogic } = data

  await createChatMessage({ id: uuid(), scheduleId, userId: auth.userId, role: 'user', content: question, createdAt: new Date().toISOString() })

  const answer = await askScheduleQuestion(question, { schedule, activities, relationships, brief, hasLogic })

  await createChatMessage({ id: uuid(), scheduleId, userId: auth.userId, role: 'assistant', content: answer, createdAt: new Date().toISOString() })

  return NextResponse.json({ answer })
})

export const GET = api({ permission: 'read' }, async (req, { auth }) => {
  const scheduleId = req.nextUrl.searchParams.get('scheduleId')
  if (!scheduleId) return NextResponse.json({ error: 'scheduleId required' }, { status: 400 })

  if (!(await getScheduleById(scheduleId, auth.orgId))) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
  const messages = await getChatMessages(scheduleId, auth.userId)
  return NextResponse.json({ messages })
})
