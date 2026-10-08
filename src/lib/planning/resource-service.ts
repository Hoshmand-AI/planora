// Server glue for resource analysis and leveling of uploaded schedules and plans.
//
// Uploaded schedules: resources and assignments are not stored per activity (no schema change); they
// are read from the stored original file (P6 RSRC/TASKRSRC, MS Project Resources/Assignments,
// spreadsheet resource columns) and bound to the stored activities by source id / activity code.
// Parsed resource data is cached in memory per schedule and file SHA-256.

import type { Activity, Schedule } from '@/lib/db'
import { bindAssignments, type ResourceData } from './resource-types'
import type { AppliedEdit } from './uploaded-edits'
import { applyScheduleEdits } from './uploaded-edits'
import { contractTarget, networkOf, trackedMilestones, type loadScheduleData } from './service'
import { uploadedLevelingNetwork, type LevelingNetwork } from './leveling'
import type { HistogramBucket, LoadActivity } from '@/lib/analysis/resources'
import { HISTOGRAM_BUCKETS } from '@/lib/analysis/resources'

type Loaded = NonNullable<Awaited<ReturnType<typeof loadScheduleData>>>

const CACHE_MAX = 32
const cache = new Map<string, ResourceData | null>()
const RESOURCE_SOURCES = new Set(['p6_xer', 'ms_xml', 'excel', 'csv'])

/** Resources of an uploaded schedule, read from its stored file and bound to `activities`; null when there are none. */
export async function loadScheduleResources(schedule: Schedule, orgId: string, activities: Activity[]): Promise<ResourceData | null> {
  if (!RESOURCE_SOURCES.has(schedule.sourceType)) return null
  const { getScheduleFile, getScheduleFileMeta } = await import('@/lib/db')
  const meta = await getScheduleFileMeta(schedule.id, orgId).catch(() => undefined)
  if (!meta) return null
  const key = `${orgId}:${schedule.id}:${meta.sha256}`
  let data = cache.get(key)
  if (data === undefined) {
    const f = await getScheduleFile(schedule.id, orgId).catch(() => undefined)
    if (!f) return null
    const { parseScheduleFile } = await import('@/lib/parsers')
    try {
      const parsed = await parseScheduleFile(f.fileName, f.content, schedule.id, { projectId: schedule.sourceType === 'p6_xer' ? schedule.projectKey ?? null : null })
      data = parsed.resources ?? null
    } catch {
      data = null
    }
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!)
    cache.set(key, data)
  }
  return data ? bindAssignments(data, activities) : null
}

/** Histogram period from a request (?bucket=day|week|month); week by default. */
export function bucketFrom(v: unknown): HistogramBucket {
  return HISTOGRAM_BUCKETS.includes(v as HistogramBucket) ? (v as HistogramBucket) : 'week'
}

/**
 * What-if availability from a request: { resourceId: units per day } with finite, non-negative values
 * for resources the schedule has (at most 200). Anything else is dropped.
 */
export function availabilityFrom(raw: unknown, data: ResourceData | null): Record<string, number> {
  const out: Record<string, number> = {}
  if (!raw || typeof raw !== 'object' || !data) return out
  const ids = new Set(data.resources.map(r => r.id))
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 200)) {
    const n = Number(v)
    if (ids.has(k) && Number.isFinite(n) && n >= 0 && n <= 1_000_000) out[k] = Math.round(n * 100) / 100
  }
  return out
}

/** Leveling edits of a scenario: active edits recorded by a leveling run. */
export const isLevelingEdit = (e: Pick<AppliedEdit, 'source'>) => e.source === 'leveling'

/**
 * The network a leveling run works on: the schedule as submitted plus the active Planora edits that
 * are NOT from an earlier leveling run (a new run replaces the previous leveled scenario).
 */
export function levelingNetworkOf(data: Loaded, resources: ResourceData | null): LevelingNetwork {
  const keep = data.edits.filter(e => e.status === 'applied' && !isLevelingEdit(e))
  const edited = keep.length ? applyScheduleEdits(data.activities, data.relationships, keep) : { activities: data.activities, relationships: data.relationships }
  const net = { ...networkOf(data), activities: edited.activities, relationships: edited.relationships }
  const target = contractTarget(data.analysis)
  const byId = new Map(edited.activities.map(a => [a.id, a]))
  const milestones = trackedMilestones(edited.activities, data.analysis).map(m => {
    const a = byId.get(m.id)
    return { id: m.id, code: a?.activityId ?? m.id, name: a?.name ?? '', required: m.required ?? null }
  })
  // The finish milestone is reported even without a required date.
  if (target?.milestoneId && !milestones.some(m => m.id === target.milestoneId) && byId.has(target.milestoneId)) {
    const a = byId.get(target.milestoneId)!
    milestones.unshift({ id: a.id, code: a.activityId, name: a.name, required: target.date })
  }
  return uploadedLevelingNetwork(net, resources, milestones)
}

/** Activities of loaded schedule data as resource loading needs them (Planora's recalculated dates; the file's without logic). */
export function loadActivitiesOfData(data: Pick<Loaded, 'activities'>): LoadActivity[] {
  return data.activities.filter(a => a.activityType === 'task' || a.activityType === 'milestone').map(a => ({
    id: a.id, code: a.activityId, name: a.name, isMilestone: a.activityType === 'milestone', calendarId: a.calendarId ?? null,
    status: a.status, actualStart: a.actualStart, actualFinish: a.actualFinish, start: a.earlyStart, finish: a.earlyFinish,
  }))
}
