import { NextResponse } from 'next/server'
import { api } from '@/lib/server/api'
import { basisFrom, basisWarning, loadScheduleData, networkOf } from '@/lib/planning/service'
import { recoveryUnavailableReason, uploadedRecoveryOptions } from '@/lib/planning/uploaded-recovery'

/**
 * What-if and recovery options for an uploaded schedule, modeled on its own network: crash a driving
 * field activity, overlap driving field activities (FS → SS with a lag), expedite a driving delivery.
 * Options target the contract milestone (designated or picked automatically) and its date (the
 * milestone's FNLT / FO / MFO date, else Must Finish By); work by others, fixed-duration work and work
 * after the milestone are never crashed or overlapped.
 * The network is the schedule as submitted; ?basis=scenario models on the what-if scenario with the
 * Planora edits. Each option lists its edits; apply one with POST /api/schedules/{id}/edits
 * { changes, reason, source: 'recovery', optionId }.
 * A schedule that cannot have options (no logic, a network the CPM could not run, no open work)
 * answers 200 with { available: false, reason, options: [] }: that is a state of the schedule, not an
 * error (the panel loads on every schedule view, so a 4xx here was noise in the logs).
 */
export const GET = api<{ id: string }>({ permission: 'read', apiKey: true }, async (req, { params, auth }) => {
  const data = await loadScheduleData(params.id, auth.orgId, { basis: basisFrom(req.nextUrl.searchParams) })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const plan = data.cpm ? uploadedRecoveryOptions({ ...networkOf(data), projectType: data.schedule.projectType ?? null }) : null
  const common = { basis: data.basis, editsApplied: data.editsApplied, basisNote: basisWarning(data.basis, data.editsApplied), editable: data.schedule.sourceType !== 'generated' }
  if (!plan) {
    const reason = recoveryUnavailableReason({ hasCpm: !!data.cpm, relationshipCount: data.relationships.length })
    return NextResponse.json({ available: false, reason, options: [], explanation: [], ...common })
  }
  return NextResponse.json({ available: true, ...plan, ...common })
})
