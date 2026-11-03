// Logic integrity of a generated plan, independent of the template that produced it:
//   1. no open ends — every activity but the start milestone has a predecessor and every activity but
//      the finish milestone has a successor;
//   2. no work tied only to completion — an activity whose only successor is Substantial Completion
//      (or the contingency held in front of it) must be a designated closeout item; a foundation,
//      structure, MEP or framing segment always feeds technical work;
//   3. phase order — commissioning / TAB after dry-in and permanent power; finishes after dry-in;
//      structure after foundations; a data center substation energized only after its transformers
//      and switchgear are delivered, and substantial completion driven by integrated systems testing.

import type { CanonicalCategory, GeneratedSchedule } from './types'

/** Categories that may legitimately lead straight into substantial completion. */
export const CLOSEOUT_CATEGORIES = new Set<CanonicalCategory>([
  'punchlist', 'inspections', 'commissioning', 'startup_testing', 'paving_landscape', 'restoration', 'cutover',
  'contingency', 'closeout', 'permit_site', 'permit_building', 'permit_other', 'other',
])

export interface LogicIssue { rule: 'open_start' | 'open_end' | 'completion_only' | 'phase_order' | 'driver'; activityId: string; text: string }

const base = (id: string) => id.replace(/#\d+$/, '')

export function checkPlanLogic(g: GeneratedSchedule): LogicIssue[] {
  const out: LogicIssue[] = []
  const byId = new Map(g.activities.map(a => [a.id, a]))
  const succ = new Map<string, string[]>(), pred = new Map<string, string[]>()
  for (const l of g.links) {
    if (!byId.has(l.from) || !byId.has(l.to)) continue
    succ.set(l.from, [...(succ.get(l.from) ?? []), l.to])
    pred.set(l.to, [...(pred.get(l.to) ?? []), l.from])
  }
  const start = g.activities.find(a => a.category === 'ntp')?.id
  const finish = g.activities.find(a => a.category === 'final_completion')?.id
  const sc = g.activities.find(a => a.category === 'substantial_completion')?.id
  const name = (id: string) => byId.get(id)?.name ?? id

  /* 1. Open ends */
  for (const a of g.activities) {
    if (a.id !== start && !pred.get(a.id)?.length) out.push({ rule: 'open_start', activityId: a.id, text: `${a.name} has no predecessor.` })
    if (a.id !== finish && !succ.get(a.id)?.length) out.push({ rule: 'open_end', activityId: a.id, text: `${a.name} has no successor.` })
  }

  /* 2. Tied only to completion */
  // The schedule contingency is held directly in front of substantial completion.
  const terminal = new Set([sc, byId.has('contingency') ? 'contingency' : undefined].filter((x): x is string => !!x))
  for (const a of g.activities) {
    if (terminal.has(a.id) || a.id === finish || CLOSEOUT_CATEGORIES.has(a.category) || a.placeholder) continue
    const s = succ.get(a.id) ?? []
    if (s.length && s.every(x => terminal.has(x))) {
      out.push({ rule: 'completion_only', activityId: a.id, text: `${a.name} has no technical successor: its only successor is ${name(s[0])}.` })
    }
  }

  /* 3. Phase order */
  const reach = (from: string, targets: Set<string>): boolean => {
    const seen = new Set<string>(), stack = [from]
    while (stack.length) {
      const x = stack.pop()!
      if (targets.has(x)) return true
      if (seen.has(x)) continue
      seen.add(x)
      stack.push(...(succ.get(x) ?? []))
    }
    return false
  }
  const segments = (id: string) => g.activities.filter(a => base(a.id) === id).map(a => a.id).sort((x, y) => x.localeCompare(y, undefined, { numeric: true }))
  const lastOf = (id: string) => segments(id).pop()
  /** `later` (every segment / activity in the list) must follow the end of `first`. */
  const after = (first: string | undefined, laterIds: string[], why: string) => {
    if (!first) return
    for (const id of laterIds) {
      if (!reach(first, new Set([id]))) out.push({ rule: 'phase_order', activityId: id, text: `${name(id)} is not logically after ${name(first)} (${why}).` })
    }
  }
  const dryIn = lastOf('t-dry_in'), power = lastOf('t-electrical_service')
  const cx = g.activities.filter(a => a.category === 'commissioning' && a.type === 'task' && a.id !== 'dc-l1').map(a => a.id)
  after(dryIn, cx, 'commissioning and TAB need a dried-in building')
  after(power, cx, 'commissioning needs permanent power')
  after(dryIn, segments('t-finishes'), 'finishes need a dried-in building')
  const structure = g.activities.filter(a => /^t-structure_(steel|concrete|wood)(#\d+)?$/.test(a.id)).map(a => a.id)
  const foundations = segments('t-foundations')
  if (foundations.length && structure.length) {
    const firstStructure = structure.sort((x, y) => x.localeCompare(y, undefined, { numeric: true }))[0]
    if (!foundations.some(f => reach(f, new Set([firstStructure])))) out.push({ rule: 'phase_order', activityId: firstStructure, text: `${name(firstStructure)} does not follow the foundations.` })
  }
  if (byId.has('dc-substation-energize')) {
    const deliveries = g.activities.filter(a => /^ll-(padmount-transformer|mv-switchgear)-(fab|delivered)$/.test(a.id)).map(a => a.id)
    for (const d of deliveries) after(d, ['dc-substation-energize'], 'the substation is energized only after its transformers and switchgear are delivered')
    after('dc-substation-energize', segments('t-electrical_service').slice(0, 1), 'the MV switchgear is energized from the substation')
  }

  /* Data centers: substantial completion is driven by integrated systems testing. */
  if (sc && byId.has('dc-l4') && g.cpm) {
    const t = g.cpm.times
    const through = (id: string): string[] => (id === 'contingency' ? pred.get(id) ?? [] : [id])
    const drivers = (pred.get(sc) ?? []).flatMap(through).filter(id => t[id])
    const latest = drivers.reduce((m, id) => (t[id].earlyFinish > m ? t[id].earlyFinish : m), '')
    const driving = drivers.filter(id => t[id].earlyFinish === latest)
    if (driving.length && !driving.some(id => byId.get(id)?.category === 'commissioning')) {
      out.push({ rule: 'driver', activityId: driving[0], text: `Substantial completion is driven by ${name(driving[0])}, not by integrated systems testing.` })
    }
  }
  return out
}
