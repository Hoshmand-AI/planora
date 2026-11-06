import { NextResponse } from 'next/server'
import { api, body as readBody } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { interpretInstruction } from '@/lib/server/edit-interpret'
import { projectClassification } from '@/lib/rag/scope'
import { loadScheduleData, networkOf } from '@/lib/planning/service'
import { applyScheduleEdits, remainingOf, validateEditChange, type ScheduleEditChange } from '@/lib/planning/uploaded-edits'
import { evaluateNetwork } from '@/lib/planning/uploaded-recovery'
import { toUploadedChange, type RefActivity } from '@/lib/planning/edit-instruction'

/**
 * Preview a plain-English edit of an uploaded schedule. Nothing is saved.
 *   POST { instruction } → { clauses: [{ text, method, change?, label?, before?, after?, error? }],
 *     changes (the valid ones, ready for POST /edits), preview: { finishBefore, finishAfter, finishDeltaDays,
 *     minFloatBefore, minFloatAfter, pathAdded, pathRemoved }, method, note }
 * Each clause is read by rules, then by the AI model for clauses rules can't read (with ai.use, a model
 * available, and never CUI/classified with a cloud model); every change is validated against the network
 * (with the earlier changes applied) exactly like a hand-made edit, then the network is recalculated.
 * The scheduler applies the changes with POST /api/schedules/[id]/edits (source 'instruction').
 * Audited without the instruction text.
 */
export const POST = api<{ id: string }>({ permission: 'schedule.write' }, async (req, { params, auth }) => {
  const data = await loadScheduleData(params.id, auth.orgId, { basis: 'scenario' })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (data.schedule.sourceType === 'generated') return NextResponse.json({ error: 'This schedule was published from a RunF9 plan; edit the plan instead (Plan → Schedule).', code: 'edit_plan_instead' }, { status: 400 })
  const b = await readBody(req)
  const open = data.activities.filter(a => (a.activityType === 'task' || a.activityType === 'milestone'))
  const refs: RefActivity[] = open.map(a => ({ id: a.id, code: a.activityId, name: a.name, remaining: a.activityType === 'milestone' ? null : remainingOf(a) }))
  const classification = await projectClassification(params.id, auth.orgId)
  const it = await interpretInstruction(b.instruction, refs, { role: auth.role, classification, structural: false, purpose: 'schedule.edit_instruction' })

  // Validate in order against the network as the earlier clauses leave it.
  let acts = data.activities, rels = data.relationships
  const changes: ScheduleEditChange[] = []
  const clauses = it.clauses.map(c => {
    if (!c.step) return { text: c.text, error: c.error }
    const live = new Map(acts.map(a => [a.id, a]))
    const raw = toUploadedChange(c.step, refs.map(r => { const a = live.get(r.id); return a ? { ...r, remaining: remainingOf(a) } : r }))
    if (!raw) return { text: c.text, error: 'That edit is only available for schedules built in RunF9.' }
    const v = validateEditChange(raw, acts, rels)
    if ('error' in v) return { text: c.text, method: c.method, error: v.error }
    const next = applyScheduleEdits(acts, rels, [{ id: `preview-${changes.length}`, change: v.change, reason: 'preview', by: auth.userId, at: '' }])
    const shown = next.applied[0]
    acts = next.activities; rels = next.relationships
    changes.push(v.change)
    return { text: c.text, method: c.method, change: v.change, label: shown.label, before: shown.before, after: shown.after }
  })

  const net = networkOf(data)
  const base = evaluateNetwork(net, [])
  const after = changes.length ? evaluateNetwork(net, changes) : base
  const code = new Map(data.activities.map(a => [a.id, a.activityId]))
  const pathB = new Set(base.longestPath), pathA = new Set(after.longestPath)
  const delta = base.measured && after.measured ? Math.round((Date.parse(after.measured) - Date.parse(base.measured)) / 86_400_000) : null

  await audit({ action: 'schedule.edit_previewed', targetType: 'schedule', targetId: data.schedule.id, detail: {
    schedule: data.schedule.name, version: data.schedule.version, clauses: clauses.length, read: changes.length, method: it.method,
  } })
  return NextResponse.json({
    clauses, changes, method: it.method, note: it.note,
    preview: {
      finishBefore: base.measured, finishAfter: after.measured, finishDeltaDays: delta,
      minFloatBefore: base.minFloat, minFloatAfter: after.minFloat,
      pathAdded: [...pathA].filter(x => !pathB.has(x)).map(x => code.get(x) ?? x).slice(0, 30),
      pathRemoved: [...pathB].filter(x => !pathA.has(x)).map(x => code.get(x) ?? x).slice(0, 30),
    },
  })
})
