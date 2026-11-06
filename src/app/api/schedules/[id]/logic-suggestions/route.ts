import { NextResponse } from 'next/server'
import { api } from '@/lib/server/api'
import { loadScheduleData } from '@/lib/planning/service'
import { suggestLogic } from '@/lib/logic-assist'
import { learnSequencing } from '@/lib/logic-assist/firm-patterns'
import { getOrgHistoryLogic } from '@/lib/db'
import { log } from '@/lib/server/log'

/**
 * Logic suggestions for one schedule (read-only; deterministic and offline, no AI call):
 * loose ends (missing predecessors / successors), work tied only to the finish, links against the
 * usual trade order and links implied by others, with a proposed finish-to-start link for each loose
 * end. Computed on the network with the RunF9 edits applied, so an applied suggestion disappears;
 * applying one goes through POST /api/schedules/[id]/edits (schedule.write, reason required, audited).
 * The firm's own sequencing patterns (learned from its past schedules that firm history uses, never
 * this one and never another firm's) favour the links the firm itself uses, with its link type and lag.
 *   GET → { schedule, editable, editsApplied, summary, suggestions, unresolved, firm: { projects, patterns } }
 */
export const GET = api<{ id: string }>({ permission: 'read', apiKey: true }, async (_req, { params, auth }) => {
  const data = await loadScheduleData(params.id, auth.orgId, { basis: 'scenario' })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { schedule, activities, relationships } = data
  const past = await getOrgHistoryLogic(auth.orgId, params.id).catch(err => { log('warn', 'firm sequencing unavailable', { error: (err as Error).message }); return [] })
  const firm = past.length ? learnSequencing(past) : null
  const result = suggestLogic(activities, relationships, { firm })
  return NextResponse.json({
    schedule: { id: schedule.id, name: schedule.name, version: schedule.version, sourceType: schedule.sourceType },
    // Uploads take edits; a schedule published from a RunF9 plan is edited in the plan instead.
    editable: schedule.sourceType !== 'generated',
    editsApplied: data.editsApplied,
    summary: result.summary,
    suggestions: result.suggestions,
    unresolved: result.unresolved,
    firm: { projects: firm?.projectCount ?? 0, patterns: firm?.patterns.length ?? 0 },
  })
})
