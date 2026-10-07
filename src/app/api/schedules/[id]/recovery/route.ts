import { NextResponse } from 'next/server'
import { api } from '@/lib/server/api'
import { basisFrom, basisWarning, loadScheduleData, networkOf } from '@/lib/planning/service'
import { uploadedRecoveryOptions } from '@/lib/planning/uploaded-recovery'

/**
 * What-if and recovery options for an uploaded schedule, modeled on its own network: crash a driving
 * field activity, overlap driving field activities (FS → SS with a lag), expedite a driving delivery.
 * Options target the contract milestone (designated or picked automatically) and its date (the
 * milestone's FNLT / FO / MFO date, else Must Finish By); work by others, fixed-duration work and work
 * after the milestone are never crashed or overlapped.
 * The network is the schedule as submitted; ?basis=scenario models on the what-if scenario with the
 * Planora edits. Each option lists its edits; apply one with POST /api/schedules/{id}/edits
 * { changes, reason, source: 'recovery', optionId }.
 */
export const GET = api<{ id: string }>({ permission: 'read', apiKey: true }, async (req, { params, auth }) => {
  const data = await loadScheduleData(params.id, auth.orgId, { basis: basisFrom(req.nextUrl.searchParams) })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!data.cpm) return NextResponse.json({ error: 'This schedule has no activity relationships, so there is no driving path to recover on.' }, { status: 400 })
  const plan = uploadedRecoveryOptions({ ...networkOf(data), projectType: data.schedule.projectType ?? null })
  if (!plan) return NextResponse.json({ error: 'No open driving path was found (the remaining work may be complete).' }, { status: 400 })
  return NextResponse.json({ ...plan, basis: data.basis, editsApplied: data.editsApplied, basisNote: basisWarning(data.basis, data.editsApplied), editable: data.schedule.sourceType !== 'generated' })
})
