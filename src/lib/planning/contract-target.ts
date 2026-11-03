// The contract milestone that recovery, risk analysis and reports measure against, and the date it
// must meet. Pure (no database access), so it is unit tested.

import type { ScheduleAnalysis } from '@/lib/analysis/schedule-analysis'
import type { Activity } from '@/lib/db'
import type { SraMilestone } from './sra'

/** Finish constraints whose date is a contract date the milestone must meet. */
export const FINISH_DATE_CONSTRAINTS = new Set(['FNLT', 'FO', 'MFO'])

/** The contract milestone recovery and risk analysis measure against, and the date it must meet. */
export interface ContractTarget {
  milestoneId: string | null
  code: string | null
  name: string | null
  /** The date to meet (the milestone's FNLT / FO / MFO date, else Must Finish By); null when there is none */
  date: string | null
  /** Where the date comes from, in words */
  dateSource: string | null
  designated: boolean
}

/**
 * The contract finish milestone of an analysis (designated or picked automatically) and the date it
 * must meet: its own finish constraint date (FNLT / FO / MFO), else the schedule's required finish.
 */
export function contractTarget(analysis: Pick<ScheduleAnalysis, 'finishMilestone' | 'mustFinishBy'>): ContractTarget | null {
  const fm = analysis.finishMilestone
  if (!fm) return analysis.mustFinishBy ? { milestoneId: null, code: null, name: null, date: analysis.mustFinishBy, dateSource: 'Must Finish By', designated: false } : null
  const c = fm.constraint && FINISH_DATE_CONSTRAINTS.has(fm.constraint.type) && fm.constraint.date ? fm.constraint : null
  return {
    milestoneId: fm.id, code: fm.code, name: fm.name, designated: !!fm.designated,
    date: c ? c.date.slice(0, 10) : analysis.mustFinishBy ?? null,
    dateSource: c ? `${fm.code} ${c.type} constraint` : analysis.mustFinishBy ? 'Must Finish By' : null,
  }
}

/**
 * Milestones a risk analysis reports separately: the contract milestone with its date, and every other
 * open milestone with a finish-date constraint (FNLT / FO / MFO). At most 25.
 */
export function trackedMilestones(activities: Pick<Activity, 'id' | 'activityId' | 'activityType' | 'actualFinish' | 'status' | 'constraintType' | 'constraintDate'>[], analysis: Pick<ScheduleAnalysis, 'finishMilestone' | 'mustFinishBy'>): SraMilestone[] {
  const out: SraMilestone[] = []
  const t = contractTarget(analysis)
  if (t?.milestoneId) out.push({ id: t.milestoneId, required: t.date, requiredSource: t.dateSource, contract: true })
  for (const a of activities) {
    if (a.activityType !== 'milestone' || a.actualFinish || a.status === 'complete' || a.id === t?.milestoneId) continue
    if (a.constraintType && FINISH_DATE_CONSTRAINTS.has(a.constraintType) && a.constraintDate) out.push({ id: a.id, required: a.constraintDate.slice(0, 10), requiredSource: `${a.activityId} ${a.constraintType} constraint`, contract: false })
  }
  return out.slice(0, 25)
}
