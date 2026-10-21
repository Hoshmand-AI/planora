import { NextResponse } from 'next/server'
import { api } from '@/lib/server/api'
import { loadScheduleData } from '@/lib/planning/service'
import { suggestLogic } from '@/lib/logic-assist'

/**
 * Nora's logic suggestions for one schedule (read-only; deterministic and offline, no AI call):
 * loose ends (missing predecessors / successors), work tied only to the finish, links against the
 * usual trade order and links implied by others, with a proposed finish-to-start link for each loose
 * end. Computed on the network with the Planora edits applied, so an applied suggestion disappears;
 * applying one goes through POST /api/schedules/[id]/edits (schedule.write, reason required, audited).
 *   GET → { schedule, editable, editsApplied, summary, suggestions, unresolved }
 */
export const GET = api<{ id: string }>({ permission: 'read', apiKey: true }, async (_req, { params, auth }) => {
  const data = await loadScheduleData(params.id, auth.orgId, { basis: 'scenario' })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { schedule, activities, relationships } = data
  const result = suggestLogic(activities, relationships)
  return NextResponse.json({
    schedule: { id: schedule.id, name: schedule.name, version: schedule.version, sourceType: schedule.sourceType },
    // Uploads take edits; a schedule published from a Planora plan is edited in the plan instead.
    editable: schedule.sourceType !== 'generated',
    editsApplied: data.editsApplied,
    summary: result.summary,
    suggestions: result.suggestions,
    unresolved: result.unresolved,
  })
})
