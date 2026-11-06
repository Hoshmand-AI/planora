import { NextResponse } from 'next/server'
import { api, body as readBody } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { interpretInstruction } from '@/lib/server/edit-interpret'
import { applyEdit, combinedImpact, EditError, type Edit } from '@/lib/planning/overrides'
import { toPlanEdit, type RefActivity } from '@/lib/planning/edit-instruction'
import { loadPlanContext } from '../../context'

/** Placeholder reason for the preview; the scheduler's reason replaces it when the edits are applied. */
const PREVIEW_REASON = 'plain-English edit (preview)'

/**
 * Preview a plain-English edit of a RunF9 plan's schedule. Nothing is saved.
 *   POST { instruction } → { clauses: [{ text, method, edit?, summary?, error? }], edits (valid, in order;
 *     apply with POST ../edit { edits, source: 'instruction' } after setting each reason), impact, method, note }
 * Rules read each clause first; the AI model reads the rest when it may (ai.use, a model available, never
 * CUI/classified with a cloud model). Each edit is applied in order with the same checks as a hand-made
 * override (applyEdit), and the network is recalculated. Audited without the instruction text.
 */
export const POST = api<{ id: string }>({ permission: 'plan.write' }, async (req, { params, auth }) => {
  const { plan } = await loadPlanContext(req, params.id, auth)
  if (!plan.generated) return NextResponse.json({ error: 'Generate the schedule first.' }, { status: 400 })
  const b = await readBody(req)
  const refs: RefActivity[] = plan.generated.activities.map(a => ({ id: a.id, code: a.code, name: a.name, remaining: a.type === 'milestone' ? null : a.duration }))
  const cls = plan.answers['security.classification']
  const classification = cls?.status === 'withheld' ? 'classified' : typeof cls?.value === 'string' ? cls.value : null
  const it = await interpretInstruction(b.instruction, refs, { role: auth.role, classification, structural: true, purpose: 'plan.edit_instruction' })

  const start = plan.generated
  let schedule = start
  const edits: Edit[] = []
  const clauses = it.clauses.map(c => {
    if (!c.step) return { text: c.text, error: c.error }
    const e = toPlanEdit(c.step, schedule, PREVIEW_REASON)
    if (typeof e === 'string') return { text: c.text, method: c.method, error: e }
    try {
      const out = applyEdit(schedule, e, auth.name)
      schedule = out.schedule
      edits.push(e)
      return { text: c.text, method: c.method, edit: e, summary: out.summary }
    } catch (err) {
      if (err instanceof EditError) return { text: c.text, method: c.method, error: err.message }
      throw err
    }
  })
  await audit({ action: 'plan.edit_previewed', targetType: 'plan', targetId: plan.id, detail: { plan: plan.name, clauses: clauses.length, read: edits.length, method: it.method } })
  return NextResponse.json({ clauses, edits, impact: combinedImpact(start, schedule), method: it.method, note: it.note })
})
