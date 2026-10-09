// Organization-level configuration of the standards engine: which framework(s) run by default and
// the GAO screening thresholds. GAO's guide states best practices, not numeric pass marks, so every
// GAO threshold here is a Planora screening default (source 'planora_default') that an organization
// may tune; DCMA thresholds stay in OrgSettings.quality (the DCMA 14-point rules).

import { isRunnableFramework, type Framework } from './types'

export interface GaoThresholds {
  /** BP1: minimum share of work activities carrying a WBS code (%) */
  wbsMinCoveragePct: number
  /** BP2: maximum share of open activities with an open end (no predecessor or no successor) (%) */
  openEndsMaxPct: number
  /** BP2: maximum share of relationships into open work carrying a positive lag before it is flagged (%) */
  lagsMaxPct: number
  /** BP2: minimum share of finish-to-start relationships (%) */
  minFsPct: number
  /** BP2: maximum share of open activities with a hard constraint (%) */
  hardConstraintsMaxPct: number
  /** BP4: remaining duration above this many work days counts as long */
  longDurationDays: number
  /** BP4: maximum share of open tasks with a long duration (%) */
  longDurationMaxPct: number
  /** BP7: total float above this many work days counts as high */
  highFloatDays: number
  /** BP7: maximum share of open activities with high float before it is flagged (%) */
  highFloatMaxPct: number
  /** BP3: minimum share of open tasks with resources assigned (%) */
  resourcesMinLoadedPct: number
  /** BP5: maximum share of open activities with no logic path to the finish (%) */
  unlinkedToFinishMaxPct: number
  /** BP10: minimum share of work activities carrying baseline dates (%) */
  baselineMinCoveragePct: number
}

export const DEFAULT_GAO_THRESHOLDS: GaoThresholds = {
  wbsMinCoveragePct: 95,
  openEndsMaxPct: 0,
  lagsMaxPct: 0,
  minFsPct: 90,
  hardConstraintsMaxPct: 5,
  longDurationDays: 44,
  longDurationMaxPct: 5,
  highFloatDays: 44,
  highFloatMaxPct: 0,
  resourcesMinLoadedPct: 90,
  unlinkedToFinishMaxPct: 0,
  baselineMinCoveragePct: 95,
}

const LIMITS: Record<keyof GaoThresholds, [number, number]> = {
  wbsMinCoveragePct: [50, 100], openEndsMaxPct: [0, 25], lagsMaxPct: [0, 25], minFsPct: [50, 100], hardConstraintsMaxPct: [0, 25],
  longDurationDays: [5, 260], longDurationMaxPct: [0, 25], highFloatDays: [10, 260], highFloatMaxPct: [0, 25],
  resourcesMinLoadedPct: [0, 100], unlinkedToFinishMaxPct: [0, 25], baselineMinCoveragePct: [50, 100],
}

export interface StandardsSettings {
  /** Framework(s) the Standards view runs first. Planora Composite is the recommended default. */
  defaultFrameworks: Framework[]
  gao: GaoThresholds
}

export const DEFAULT_STANDARDS_SETTINGS: StandardsSettings = { defaultFrameworks: ['PLANORA_COMPOSITE'], gao: DEFAULT_GAO_THRESHOLDS }

export function normalizeGaoThresholds(raw: unknown): GaoThresholds {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out = { ...DEFAULT_GAO_THRESHOLDS }
  for (const k of Object.keys(LIMITS) as (keyof GaoThresholds)[]) {
    const v = Number(r[k])
    if (r[k] !== undefined && r[k] !== null && r[k] !== '' && Number.isFinite(v)) out[k] = Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], Math.round(v)))
  }
  return out
}

export function normalizeFrameworkList(raw: unknown, fallback: Framework[] = DEFAULT_STANDARDS_SETTINGS.defaultFrameworks): Framework[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : []
  const out = Array.from(new Set(list.map(x => String(x).trim()).filter(isRunnableFramework)))
  return out.length ? out : [...fallback]
}

export function normalizeStandardsSettings(raw: unknown): StandardsSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return { defaultFrameworks: normalizeFrameworkList(r.defaultFrameworks), gao: normalizeGaoThresholds(r.gao) }
}
