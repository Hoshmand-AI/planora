// Grounding in how the firm's own past projects actually went.
// Input rows come from db.getOrgHistory(orgId), which is filtered to one organization.

import { parseBool } from './elicitation'
import type { Answer, CanonicalCategory, ProjectType, WorkCalendar } from './types'
import { countWorkDaysInclusive, defaultCalendar } from './calendar'
import type { HistoryRow } from '@/lib/db'

export interface CategoryStats {
  category: CanonicalCategory
  /** Number of past activities (with actual start and finish) behind these statistics */
  samples: number
  projects: number
  /** Actual span of this work on a project (work days, first start → last finish), size-normalized to 100,000 sf when area is known */
  actualP20: number
  actualMedian: number
  actualP80: number
  /** actual / planned ratio where a baseline or original duration exists */
  overrunMedian: number | null
  overrunP80: number | null
  /** true when samples come from the same project type */
  sameType: boolean
  /** mean area of contributing projects (sf), if known */
  meanSqft: number | null
}

export interface FirmHistory {
  projectCount: number
  similarCount: number
  byCategory: Partial<Record<CanonicalCategory, CategoryStats>>
  /** Overall actual/planned ratio across all completed activities */
  overallOverrunMedian: number | null
  overallOverrunP80: number | null
}

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos), hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

const REF_SQFT = 100_000
/** Durations scale sub-linearly with area (crews scale up); 0.6 is a common rule of thumb. */
export const SIZE_EXPONENT = 0.6

export function scaleForSize(days: number, fromSqft: number | null | undefined, toSqft: number | null | undefined): number {
  if (!fromSqft || !toSqft) return days
  return days * Math.pow(toSqft / fromSqft, SIZE_EXPONENT)
}

export function computeFirmHistory(rows: HistoryRow[], calendars: Record<string, WorkCalendar[]>, projectType?: ProjectType): FirmHistory {
  const projects = new Set(rows.map(r => r.scheduleId))
  const typed = projectType ? rows.filter(r => r.projectType === projectType) : []
  const similar = new Set(typed.map(r => r.scheduleId))

  const calFor = (r: HistoryRow): WorkCalendar => {
    const cals = calendars[r.scheduleId] || []
    return cals.find(c => c.id === r.calendarId) || cals[0] || defaultCalendar()
  }

  type Sample = { actual: number; ratio: number | null; scheduleId: string; sqft: number | null; sameType: boolean; activities: number }
  // Firms split trades differently ("Drywall L1", "Drywall L2", …), so compare like with like:
  // one sample per project × work category, spanning its first actual start to last actual finish.
  const groups = new Map<string, HistoryRow[]>()
  for (const r of rows) {
    if (!r.actualStart || !r.actualFinish || r.actualFinish < r.actualStart) continue
    const key = `${r.scheduleId}|${r.category}`
    const g = groups.get(key)
    if (g) g.push(r)
    else groups.set(key, [r])
  }
  const byCat = new Map<string, Sample[]>()
  const allRatios: number[] = []
  groups.forEach(list => {
    const r0 = list[0]
    const cal = calFor(r0)
    const aStart = list.reduce((m, r) => (r.actualStart! < m ? r.actualStart! : m), list[0].actualStart!)
    const aFinish = list.reduce((m, r) => (r.actualFinish! > m ? r.actualFinish! : m), list[0].actualFinish!)
    const actual = countWorkDaysInclusive(aStart, aFinish, cal)
    if (actual <= 0) return
    let planned: number | null = null
    const bl = list.filter(r => r.baselineStart && r.baselineFinish && r.baselineFinish >= r.baselineStart)
    if (bl.length === list.length) {
      const bStart = bl.reduce((m, r) => (r.baselineStart! < m ? r.baselineStart! : m), bl[0].baselineStart!)
      const bFinish = bl.reduce((m, r) => (r.baselineFinish! > m ? r.baselineFinish! : m), bl[0].baselineFinish!)
      planned = countWorkDaysInclusive(bStart, bFinish, cal)
    } else if (list.length === 1 && r0.duration > 0) {
      planned = r0.duration
    }
    const ratio = planned && planned > 0 ? actual / planned : null
    if (ratio !== null && ratio < 10) allRatios.push(ratio)
    const samples = byCat.get(r0.category) || []
    samples.push({ actual: r0.grossSqft ? scaleForSize(actual, r0.grossSqft, REF_SQFT) : actual, ratio, scheduleId: r0.scheduleId, sqft: r0.grossSqft, sameType: !!projectType && r0.projectType === projectType, activities: list.length })
    byCat.set(r0.category, samples)
  })

  const byCategory: FirmHistory['byCategory'] = {}
  byCat.forEach((all, cat) => {
    // Prefer same-type projects when there are at least two of them.
    const sameType = all.filter(s => s.sameType)
    const use = new Set(sameType.map(s => s.scheduleId)).size >= 2 ? sameType : all
    const actuals = use.map(s => s.actual).sort((a, b) => a - b)
    const ratios = use.map(s => s.ratio).filter((x): x is number => x !== null && x < 10).sort((a, b) => a - b)
    const sq = use.map(s => s.sqft).filter((x): x is number => !!x)
    byCategory[cat as CanonicalCategory] = {
      category: cat as CanonicalCategory,
      samples: use.reduce((n, x) => n + x.activities, 0),
      projects: new Set(use.map(s => s.scheduleId)).size,
      actualP20: quantile(actuals, 0.2),
      actualMedian: quantile(actuals, 0.5),
      actualP80: quantile(actuals, 0.8),
      overrunMedian: ratios.length ? quantile(ratios, 0.5) : null,
      overrunP80: ratios.length ? quantile(ratios, 0.8) : null,
      sameType: use === sameType,
      meanSqft: sq.length ? sq.reduce((a, b) => a + b, 0) / sq.length : null,
    }
  })
  allRatios.sort((a, b) => a - b)
  return {
    projectCount: projects.size,
    similarCount: similar.size,
    byCategory,
    overallOverrunMedian: allRatios.length ? quantile(allRatios, 0.5) : null,
    overallOverrunP80: allRatios.length ? quantile(allRatios, 0.8) : null,
  }
}

/** Firm-history duration for a category at a given size, or null if there isn't enough evidence. */
export function historyDuration(h: FirmHistory | null | undefined, category: CanonicalCategory, sqft?: number): { days: number; stats: CategoryStats } | null {
  const s = h?.byCategory[category]
  if (!s || s.projects < 2) return null
  // Samples are normalized to REF_SQFT only when their project area was known.
  const days = sqft && s.meanSqft ? scaleForSize(s.actualMedian, REF_SQFT, sqft) : s.actualMedian
  return { days: Math.max(1, Math.round(days)), stats: s }
}

/** True when the team answered "No" to using the firm's history for this plan (`history.use`). */
export function historyOptedOut(answers: Record<string, Answer> | null | undefined): boolean {
  const a = answers?.['history.use']
  return a?.status === 'known' && parseBool(a.value) === false
}

/**
 * The firm history this plan may use: null when the team opted out in the interview. Every
 * consumer that turns history into durations, risk ranges or forecast ratios goes through this.
 */
export function historyForPlan(h: FirmHistory | null | undefined, answers: Record<string, Answer> | null | undefined): FirmHistory | null {
  return h && !historyOptedOut(answers) ? h : null
}
