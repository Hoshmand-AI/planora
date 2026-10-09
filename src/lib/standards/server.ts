// Server-side helpers shared by the standards API routes: which frameworks a request asks for, the
// organization's thresholds, and loading an uploaded schedule into the engine's input.

import type { OrgSettings } from '@/lib/server/settings'
import { ApiError } from '@/lib/server/api'
import { getScheduleRiskInputs } from '@/lib/db'
import { loadScheduleData, type ScheduleBasis } from '@/lib/planning/service'
import { scheduleResourceCounts } from '@/lib/planning/resource-service'
import { normalizeFrameworkList } from './config'
import { engineConfig } from './engine'
import { scheduleStandardsInput } from './inputs'
import type { EngineConfig } from './rule'
import { FRAMEWORKS, RUNNABLE_FRAMEWORKS, isRunnableFramework, type Framework, type StandardsInput } from './types'

export function configFor(settings: OrgSettings): EngineConfig {
  return engineConfig({ gao: settings.standards.gao, dcma: settings.quality })
}

/**
 * Frameworks from a query value ("GAO_SCHEDULE_GUIDE,DCMA_14") or a JSON body array. Absent → the
 * organization's defaults. Unknown names are refused rather than silently dropped.
 */
export function frameworksFrom(raw: unknown, settings: OrgSettings): Framework[] {
  if (raw === undefined || raw === null || raw === '') return normalizeFrameworkList(settings.standards.defaultFrameworks)
  const list = (Array.isArray(raw) ? raw : String(raw).split(',')).map(x => String(x).trim()).filter(Boolean)
  const bad = list.filter(x => !isRunnableFramework(x))
  if (bad.length || !list.length) {
    const known = (FRAMEWORKS as readonly string[]).includes(bad[0] ?? '')
    throw new ApiError(400, `${known ? `${bad[0]} cannot be run yet` : `Unknown framework "${String(bad[0] ?? '').slice(0, 40)}"`}. Use one or more of: ${RUNNABLE_FRAMEWORKS.join(', ')}.`, 'invalid_framework')
  }
  return Array.from(new Set(list)) as Framework[]
}

/** Loads an uploaded schedule (org- and workspace-scoped) as engine input; null when not found. */
export async function loadScheduleStandardsInput(id: string, orgId: string, basis: ScheduleBasis): Promise<{ input: StandardsInput; basis: ScheduleBasis; name: string } | null> {
  const data = await loadScheduleData(id, orgId, { basis })
  if (!data) return null
  const { schedule } = data
  // Resource assignments are read from the original file, as on the Quality page: P6 XER / P6 XML
  // assignment rows, MS Project Assignments, spreadsheet resource columns (GAO best practice 3).
  const resourceCounts = await scheduleResourceCounts(schedule, orgId, data.activities).catch(() => null)
  const risk = await getScheduleRiskInputs(schedule.id, orgId).catch(() => null)
  const hasRisk = !!risk && (risk.ranges.length + risk.events.length + risk.commitments.length) > 0
  return {
    input: scheduleStandardsInput({ schedule, activities: data.activities, relationships: data.relationships, baseline: data.baseline, resourceCounts, risk: hasRisk ? risk : null }),
    basis: data.basis,
    name: schedule.name,
  }
}
