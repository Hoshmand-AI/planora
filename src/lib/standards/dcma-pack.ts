// DCMA 14-point rule pack: an adapter over the existing checks in src/lib/analysis/dcma.ts. It does
// not re-implement anything: runDcma runs once per network (with the organization's DCMA thresholds)
// and each rule reads its check, so results are identical to the Quality page's DCMA table.

import { DEFAULT_DCMA_RULES, runDcma, type DcmaRules } from '@/lib/analysis/dcma'
import type { DcmaCheck, DcmaReport } from '@/lib/planning/types'
import type { Network } from './network'
import { threshold, type EngineConfig, type RuleDef } from './rule'
import type { Characteristic, RuleResultStatus, ThresholdSpec } from './types'

export const DCMA_VERSION = 'DCMA 14-Point Assessment (EVMS Program Analysis Pamphlet, 2012)'
export const DCMA_DISCLAIMER = 'DCMA 14-point checks are assessment metrics computed from the schedule data. Thresholds are the published DCMA values unless your organization changed them. Passing them is not, by itself, evidence that a schedule is realistic.'

const memo = new WeakMap<Network, Map<string, DcmaReport>>()
export function dcmaReportFor(net: Network, rules: DcmaRules): DcmaReport {
  let byRules = memo.get(net)
  if (!byRules) memo.set(net, (byRules = new Map()))
  const key = JSON.stringify(rules)
  let r = byRules.get(key)
  if (!r) byRules.set(key, (r = runDcma(net.input.schedule, rules)))
  return r
}

export const DCMA_RESULT: Record<DcmaCheck['result'], RuleResultStatus> = { pass: 'pass', fail: 'fail', warn: 'warning', 'n/a': 'not_assessable' }

function dt(cfg: EngineConfig, key: keyof DcmaRules, metricKey: string, unit: ThresholdSpec['unit'], direction: ThresholdSpec['direction']): ThresholdSpec {
  const v = cfg.dcma[key]
  return threshold(metricKey, v, unit, direction, v === DEFAULT_DCMA_RULES[key] ? 'published' : 'org_configured')
}
const fixed = (metricKey: string, value: number, unit: ThresholdSpec['unit'], direction: ThresholdSpec['direction']) => () => threshold(metricKey, value, unit, direction, 'published')

interface Spec {
  id: number; title: string; category: string; characteristic: Characteristic; severity: RuleDef['severity']; calculation: string
  message: string; recommendation: string
  threshold?: RuleDef['threshold']; parameters?: RuleDef['parameters']
}

const SPECS: Spec[] = [
  { id: 1, title: 'Logic', category: 'Logic', characteristic: 'well_constructed', severity: 'high', calculation: 'dcma.logic',
    message: 'Share of open activities missing a predecessor or a successor.', recommendation: 'Add the missing predecessors and successors so delays flow through the network.',
    threshold: cfg => dt(cfg, 'maxPct', 'logic.open_ends_pct', '%', 'max') },
  { id: 2, title: 'Leads', category: 'Logic', characteristic: 'well_constructed', severity: 'high', calculation: 'dcma.leads',
    message: 'Relationships into open work with a negative lag.', recommendation: 'Replace leads with SS/FF logic or split the work.',
    threshold: fixed('logic.leads_count', 0, 'count', 'max') },
  { id: 3, title: 'Lags', category: 'Logic', characteristic: 'well_constructed', severity: 'medium', calculation: 'dcma.lags',
    message: 'Share of relationships into open work with a positive lag.', recommendation: 'Replace lags with activities that can be statused.',
    threshold: cfg => dt(cfg, 'maxPct', 'logic.lags_share_pct', '%', 'max') },
  { id: 4, title: 'Relationship types', category: 'Logic', characteristic: 'well_constructed', severity: 'low', calculation: 'dcma.relationshipTypes',
    message: 'Share of relationships into open work that are finish-to-start.', recommendation: 'Prefer finish-to-start logic; review SS/FF/SF links.',
    threshold: cfg => dt(cfg, 'minFsPct', 'logic.fs_share_pct', '%', 'min') },
  { id: 5, title: 'Hard constraints', category: 'Constraints', characteristic: 'well_constructed', severity: 'high', calculation: 'dcma.hardConstraints',
    message: 'Share of open activities with a constraint that overrides logic.', recommendation: 'Replace hard constraints with logic or document why each date is imposed.',
    threshold: cfg => dt(cfg, 'maxPct', 'constraints.hard_share_pct', '%', 'max') },
  { id: 6, title: 'High float', category: 'Float', characteristic: 'well_constructed', severity: 'medium', calculation: 'dcma.highFloat',
    message: 'Share of open activities with total float above the high-float value.', recommendation: 'Check successors of high-float work for missing logic.',
    threshold: cfg => dt(cfg, 'maxPct', 'float.high_share_pct', '%', 'max'),
    parameters: cfg => [dt(cfg, 'highFloatDays', 'float.high_days', 'days', 'max')] },
  { id: 7, title: 'Negative float', category: 'Float', characteristic: 'well_constructed', severity: 'high', calculation: 'dcma.negativeFloat',
    message: 'Open activities with negative total float.', recommendation: 'Prepare a recovery plan or seek a revised required date.',
    threshold: fixed('float.negative_count', 0, 'count', 'max') },
  { id: 8, title: 'High duration', category: 'Durations', characteristic: 'comprehensive', severity: 'medium', calculation: 'dcma.highDuration',
    message: 'Share of open tasks with remaining duration above the high-duration value.', recommendation: 'Break long tasks into shorter, statusable pieces.',
    threshold: cfg => dt(cfg, 'maxPct', 'duration.long_share_pct', '%', 'max'),
    parameters: cfg => [dt(cfg, 'highDurationDays', 'duration.long_days', 'days', 'max')] },
  { id: 9, title: 'Invalid dates', category: 'Status', characteristic: 'controlled', severity: 'high', calculation: 'dcma.invalidDates',
    message: 'Actual dates after the data date, or forecast dates before it.', recommendation: 'Correct actuals and reschedule remaining work after the data date.',
    threshold: fixed('status.invalid_dates_count', 0, 'count', 'max') },
  { id: 10, title: 'Resources', category: 'Resources', characteristic: 'comprehensive', severity: 'medium', calculation: 'dcma.resources',
    message: 'Open tasks with duration but no resources assigned.', recommendation: 'Assign resources or cost to open tasks.',
    threshold: fixed('resources.loaded_pct', 100, '%', 'min') },
  { id: 11, title: 'Missed tasks', category: 'Execution', characteristic: 'controlled', severity: 'medium', calculation: 'dcma.missedTasks',
    message: 'Share of tasks baselined to finish before the data date that did not finish on time.', recommendation: 'Investigate why baselined work slipped and update the forecast.',
    threshold: cfg => dt(cfg, 'maxPct', 'execution.missed_share_pct', '%', 'max') },
  { id: 12, title: 'Critical path test', category: 'Critical path', characteristic: 'well_constructed', severity: 'high', calculation: 'dcma.criticalPathTest',
    message: 'Whether a delay on the driving path moves the finish by the same amount.', recommendation: 'Repair breaks in the driving path (constraints, missing logic).' },
  { id: 13, title: 'Critical path length index (CPLI)', category: 'Critical path', characteristic: 'well_constructed', severity: 'medium', calculation: 'dcma.cpli',
    message: 'How achievable the required finish is given the remaining critical path and its float.', recommendation: 'Recover negative float on the critical path or revisit the required finish.',
    threshold: cfg => dt(cfg, 'indexTarget', 'index.cpli', 'index', 'min') },
  { id: 14, title: 'Baseline execution index (BEI)', category: 'Execution', characteristic: 'controlled', severity: 'medium', calculation: 'dcma.bei',
    message: 'Tasks finished against tasks baselined to finish by the data date.', recommendation: 'Raise the completion rate of baselined work or re-forecast.',
    threshold: cfg => dt(cfg, 'indexTarget', 'index.bei', 'index', 'min') },
]

export const DCMA_RULES: RuleDef[] = SPECS.map(sp => ({
  ruleId: `DCMA-${String(sp.id).padStart(2, '0')}`,
  version: 1,
  framework: 'DCMA_14',
  frameworkVersion: DCMA_VERSION,
  kind: 'assessment_metric',
  category: sp.category,
  characteristic: sp.characteristic,
  severity: sp.severity,
  applicability: { subjects: ['schedule', 'plan'] },
  calculation: sp.calculation,
  title: sp.title,
  message: sp.message,
  sourceReference: `DCMA 14-Point Assessment, check ${sp.id} (${sp.title})`,
  threshold: sp.threshold,
  parameters: sp.parameters,
  evaluate: ({ net, cfg }) => {
    const c = dcmaReportFor(net, cfg.dcma).checks.find(x => x.id === sp.id)
    if (!c) return { result: 'not_assessable', metric: 'not assessable', evidence: [], recommendation: '', reason: 'The DCMA check did not run.' }
    const result = DCMA_RESULT[c.result]
    return {
      result,
      metric: `${c.metric} (DCMA target ${c.threshold})`,
      evidence: c.offenders,
      recommendation: result === 'pass' ? 'No action needed.' : result === 'not_assessable' ? '' : sp.recommendation,
      reason: c.explanation,
    }
  },
}))
