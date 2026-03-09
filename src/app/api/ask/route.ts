import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getScheduleById, getActivities, getRelationships, createChatMessage, getChatMessages } from '@/lib/db'
import { askScheduleQuestion } from '@/lib/openai'
import { v4 as uuid } from 'uuid'

export async function POST(req: NextRequest) {
  const auth = await getAuthUser()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { question, scheduleId } = await req.json()
  if (!question || !scheduleId) return NextResponse.json({ error: 'Question and scheduleId required' }, { status: 400 })

  const schedule = await getScheduleById(scheduleId)
  if (!schedule) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })

  await createChatMessage({ id: uuid(), scheduleId, userId: auth.userId, role: 'user', content: question, createdAt: new Date().toISOString() })

  const activities = await getActivities(scheduleId)
  const relationships = await getRelationships(scheduleId)
  const answer = await askScheduleQuestion(question, { schedule, activities, relationships })

  await createChatMessage({ id: uuid(), scheduleId, userId: auth.userId, role: 'assistant', content: answer, createdAt: new Date().toISOString() })

  return NextResponse.json({ answer })
}

export async function GET(req: NextRequest) {
  const auth = await getAuthUser()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const scheduleId = req.nextUrl.searchParams.get('scheduleId')
  if (!scheduleId) return NextResponse.json({ error: 'scheduleId required' }, { status: 400 })

  const messages = await getChatMessages(scheduleId, auth.userId)
  return NextResponse.json({ messages })
}
