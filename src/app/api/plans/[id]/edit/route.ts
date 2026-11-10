import { NextResponse } from 'next/server'
import { api } from '@/lib/server/api'
import { savePlan } from '@/lib/db'
import { applyEdit, combinedImpact, EditError, type Edit } from '@/lib/planning/overrides'
import { approvalOfCurrentVersion } from '@/lib/server/approval'
import { loadPlanContext, planView } from '../context'

/** Most edits in one change (a plain-English instruction becomes several). */
const MAX_EDITS = 20

/**
 * Scheduler override: { edit: Edit } or { edits: Edit[], source?: 'instruction' } (applied in order, all
 * or nothing). Reason is mandatory; impact on finish and critical path is returned. The schedule before
 * the change is kept so it can be undone (POST ./undo).
 */
export const POST = api<{ id: string }>({ permission: 'plan.write' }, async (req, { params, auth }) => {
  const r = await loadPlanContext(req, params.id, auth)
  const { plan, ctx } = r
  if (!plan.generated) return NextResponse.json({ error: 'Generate the schedule first.' }, { status: 400 })
  const b = await req.json().catch(() => ({})) as { edit?: Edit; edits?: Edit[]; source?: string }
  const edits = Array.isArray(b.edits) ? b.edits : b.edit ? [b.edit] : []
  if (!edits.length) return NextResponse.json({ error: 'edit required' }, { status: 400 })
  if (edits.length > MAX_EDITS) return NextResponse.json({ error: `Send at most ${MAX_EDITS} edits at a time.` }, { status: 400 })
  const fromInstruction = b.source === 'instruction'
  try {
    const wasApproved = approvalOfCurrentVersion(plan).approved
    const { undo: _undo, ...previous } = plan.generated
    void _undo
    let schedule = plan.generated
    const summaries: string[] = []
    for (const edit of edits) {
      const out = applyEdit(schedule, edit, ctx.name)
      schedule = out.schedule
      summaries.push(out.summary)
    }
    const impact = combinedImpact(previous, schedule)
    const summary = summaries.join('; ')
    plan.generated = { ...schedule, undo: { at: new Date().toISOString(), by: ctx.name, summary, previous } }
    // The approval was bound to the previous content; it no longer applies (publishing needs a fresh review).
    const approvalInvalidated = wasApproved && !approvalOfCurrentVersion(plan).approved
    const at = new Date().toISOString()
    edits.forEach((edit, i) => plan.audit.push({ at, by: ctx.name, byId: ctx.userId, action: `override:${edit.kind}`, detail: `${summaries[i]}. Reason: ${String(edit.reason).trim().slice(0, 500)}${fromInstruction ? ' (plain-English edit)' : ''}${approvalInvalidated && i === edits.length - 1 ? '. Earlier approval no longer applies; a fresh review is required.' : ''}` }))
    const saved = await savePlan(plan)
    return NextResponse.json({ ...(await planView(saved, ctx.orgId)), impact, summary, approvalInvalidated })
  } catch (err) {
    if (err instanceof EditError) return NextResponse.json({ error: edits.length > 1 ? `Nothing was changed: ${err.message}` : err.message }, { status: 400 })
    throw err
  }
})
