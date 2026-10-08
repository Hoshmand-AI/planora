// Builds the engine's input from an uploaded schedule (as loaded by loadScheduleData) or from a
// generated plan. Pure: the callers load the data (and any risk inputs) and pass it in.

import type { Activity, Plan, Relationship, Schedule } from '@/lib/db'
import type { ResolvedBaseline } from '@/lib/analysis/baseline'
import { analyzableFromDb } from '@/lib/planning/service'
import { toAnalyzable } from '@/lib/planning/evaluation'
import type { StandardsInput } from './types'

export interface RiskRecord { updatedAt: string | null; ranges: unknown[]; events: unknown[]; commitments?: unknown[] }

function riskOf(r: RiskRecord | null | undefined): StandardsInput['riskAnalysis'] {
  if (!r || !r.updatedAt) return null
  return { recordedAt: r.updatedAt, ranges: r.ranges.length, events: r.events.length, commitments: r.commitments?.length ?? 0, source: 'risk inputs saved for this schedule (Risk view)' }
}

export function scheduleStandardsInput(o: {
  schedule: Schedule; activities: Activity[]; relationships: Relationship[]; baseline: ResolvedBaseline | null
  resourceCounts?: Record<string, number> | null; risk?: RiskRecord | null
}): StandardsInput {
  return {
    subject: { kind: 'schedule', id: o.schedule.id, name: o.schedule.name, version: o.schedule.version },
    schedule: analyzableFromDb(o.schedule, o.activities, o.relationships, o.resourceCounts ?? null),
    wbs: Object.fromEntries(o.activities.map(a => [a.id, a.wbs || ''])),
    baseline: o.baseline ? { source: o.baseline.source, label: o.baseline.header } : { source: 'none' },
    riskAnalysis: riskOf(o.risk),
  }
}

/** A generated plan: its WBS is the source WBS where it has one, else the phase the generator gave. */
export function planStandardsInput(plan: Plan): StandardsInput | null {
  const g = plan.generated
  if (!g) return null
  return {
    subject: { kind: 'plan', id: plan.id, name: plan.name, version: String(plan.version) },
    schedule: toAnalyzable(g),
    cpm: g.cpm ?? undefined,
    wbs: Object.fromEntries(g.activities.map(a => [a.id, a.wbs || a.phase || ''])),
    baseline: plan.scheduleId ? { source: 'published_plan', label: 'Published as a baseline schedule' } : { source: 'none' },
    riskAnalysis: null,
  }
}
