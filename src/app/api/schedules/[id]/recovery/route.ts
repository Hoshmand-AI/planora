import { NextResponse } from 'next/server'
import { api } from '@/lib/server/api'
import { loadScheduleData, networkOf } from '@/lib/planning/service'
import { uploadedRecoveryOptions } from '@/lib/planning/uploaded-recovery'

/**
 * What-if and recovery options for an uploaded schedule, modeled on its own (edited) network: crash a
 * driving activity, overlap driving activities (FS → SS with a lag), expedite a driving delivery.
 * Each option lists its edits; apply one with POST /api/schedules/{id}/edits { changes, reason,
 * source: 'recovery', optionId }.
 */
export const GET = api<{ id: string }>({ permission: 'read', apiKey: true }, async (_req, { params, auth }) => {
  const data = await loadScheduleData(params.id, auth.orgId)
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!data.cpm) return NextResponse.json({ error: 'This schedule has no activity relationships, so there is no driving path to recover on.' }, { status: 400 })
  const plan = uploadedRecoveryOptions(networkOf(data))
  if (!plan) return NextResponse.json({ error: 'No open driving path was found (the remaining work may be complete).' }, { status: 400 })
  return NextResponse.json({ ...plan, editable: data.schedule.sourceType !== 'generated' })
})
