import type { DcmaRules } from '@/lib/analysis/dcma'
import type { GaoThresholds } from './config'
import type { Network } from './network'
import type { RuleMeta, RuleOutcome, ThresholdSpec, ThresholdSource } from './types'

/** Thresholds in force for one run. */
export interface EngineConfig {
  gao: GaoThresholds
  dcma: DcmaRules
}

export interface RuleContext {
  net: Network
  cfg: EngineConfig
}

/** A rule: immutable metadata, an optional configurable threshold, and a pure evaluation. */
export interface RuleDef extends RuleMeta {
  threshold?: (cfg: EngineConfig) => ThresholdSpec | null
  /** Secondary thresholds the rule depends on (e.g. the day count that defines "high float") */
  parameters?: (cfg: EngineConfig) => ThresholdSpec[]
  evaluate: (ctx: RuleContext, threshold: ThresholdSpec | null) => RuleOutcome
}

export function threshold(metricKey: string, value: number, unit: ThresholdSpec['unit'], direction: ThresholdSpec['direction'], source: ThresholdSource): ThresholdSpec {
  const v = unit === 'index' ? value.toFixed(2) : String(value)
  const u = unit === '%' ? '%' : unit === 'days' ? ' work days' : ''
  return { metricKey, value, unit, direction, source, display: `${direction === 'max' ? '≤' : '≥'} ${v}${u}` }
}

export const notAssessable = (reason: string, recommendation = ''): RuleOutcome =>
  ({ result: 'not_assessable', metric: 'not assessable', evidence: [], recommendation, reason })
