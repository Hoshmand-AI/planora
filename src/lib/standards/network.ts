// Read-only view of a schedule's network shared by the rule packs: populations, logic maps, a lazily
// computed CPM and total float. Population conventions match DCMA (src/lib/analysis/dcma.ts):
// "scheduled" = not WBS summary and not level of effort; "open" = scheduled and not complete.

import type { AnalyzableActivity, CpmLink, CpmResult } from '@/lib/planning/types'
import { runCpm } from '@/lib/planning/cpm'
import { isValidDate, toDayNumber } from '@/lib/planning/calendar'
import { isCompleteActivity, normalizeConstraintType, scheduleToCpmInput } from '@/lib/analysis/dcma'
import type { StandardsInput } from './types'

export const HARD_CONSTRAINTS = new Set(['MSO', 'MFO', 'SO', 'FO', 'SNLT', 'FNLT'])

export interface Network {
  input: StandardsInput
  /** Every activity, summaries and LOE included */
  every: AnalyzableActivity[]
  byId: Map<string, AnalyzableActivity>
  /** Non-summary, non-LOE activities */
  all: AnalyzableActivity[]
  /** Scheduled activities that are not complete */
  open: AnalyzableActivity[]
  openIds: Set<string>
  /** Links between scheduled activities */
  links: CpmLink[]
  /** Every link in the file, summaries/LOE included */
  rawLinks: CpmLink[]
  preds: Map<string, CpmLink[]>
  succs: Map<string, CpmLink[]>
  /** The project start and finish activities exempt from open-end tests (DCMA convention) */
  startId: string | null
  finishId: string | null
  cpm: () => CpmResult | null
  totalFloat: (a: AnalyzableActivity) => number | null
  isComplete: (a: AnalyzableActivity) => boolean
  hardConstraint: (a: AnalyzableActivity) => string | null
  code: (id: string) => string
}

export function buildNetwork(input: StandardsInput): Network {
  const s = input.schedule
  const every = s.activities
  const byId = new Map<string, AnalyzableActivity>()
  for (const a of every) if (!byId.has(a.id)) byId.set(a.id, a)
  const all = every.filter(a => a.type !== 'summary' && a.type !== 'loe')
  const allIds = new Set(all.map(a => a.id))
  const open = all.filter(a => !isCompleteActivity(a))
  const openIds = new Set(open.map(a => a.id))
  const links = s.links.filter(l => allIds.has(l.from) && allIds.has(l.to))
  const preds = new Map<string, CpmLink[]>()
  const succs = new Map<string, CpmLink[]>()
  for (const l of links) {
    preds.set(l.to, [...(preds.get(l.to) ?? []), l])
    succs.set(l.from, [...(succs.get(l.from) ?? []), l])
  }

  let cpmCache: CpmResult | null | undefined = input.cpm === undefined ? undefined : input.cpm
  const cpm = (): CpmResult | null => {
    if (cpmCache !== undefined) return cpmCache
    const inp = scheduleToCpmInput(s)
    try { cpmCache = inp && inp.activities.length ? runCpm(inp) : null } catch { cpmCache = null }
    return cpmCache
  }
  const storedTf = all.some(a => a.totalFloat !== null && a.totalFloat !== undefined)
  const totalFloat = (a: AnalyzableActivity): number | null => storedTf ? (a.totalFloat ?? null) : (cpm()?.times[a.id]?.totalFloat ?? null)

  const dayOf = (d: string | null | undefined) => (isValidDate(d) ? toDayNumber(d) : 0)
  const esOf = (a: AnalyzableActivity) => dayOf(a.earlyStart ?? a.actualStart ?? cpm()?.times[a.id]?.earlyStart)
  const efOf = (a: AnalyzableActivity) => dayOf(a.earlyFinish ?? a.actualFinish ?? cpm()?.times[a.id]?.earlyFinish)
  const noPred = all.filter(a => !preds.has(a.id))
  const noSucc = all.filter(a => !succs.has(a.id))
  const start = noPred.length ? noPred.reduce((m, a) => (esOf(a) < esOf(m) ? a : m)) : null
  const designated = s.finishMilestoneId ? all.find(a => a.id === s.finishMilestoneId || a.code === s.finishMilestoneId) : undefined
  const finishPool = noSucc.some(a => a.type === 'milestone') ? noSucc.filter(a => a.type === 'milestone') : noSucc
  const finish = designated ?? (finishPool.length ? finishPool.reduce((m, a) => (efOf(a) >= efOf(m) ? a : m)) : null)

  return {
    input, every, byId, all, open, openIds, links, rawLinks: s.links, preds, succs,
    startId: start?.id ?? null, finishId: finish?.id ?? null,
    cpm, totalFloat, isComplete: isCompleteActivity,
    hardConstraint: a => { const t = normalizeConstraintType(a.constraint?.type); return t && HARD_CONSTRAINTS.has(t) ? t : null },
    code: id => byId.get(id)?.code ?? id,
  }
}

/** "3 of 120 (2.5%)" */
export function shareText(n: number, d: number): string {
  return `${n} of ${d} (${d === 0 ? '0.0' : ((100 * n) / d).toFixed(1)}%)`
}
export const sharePct = (n: number, d: number) => (d === 0 ? 0 : (100 * n) / d)
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
export const uniq = (xs: string[]) => Array.from(new Set(xs))
