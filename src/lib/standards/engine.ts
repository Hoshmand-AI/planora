// The standards rules engine: runs one or more frameworks against a schedule or plan and returns
//   Framework → Characteristic / Category → Rule → Result → Evidence → Recommendation
// Deterministic: the same input, rules and thresholds always give the same output (apart from the
// caller-supplied timestamp, which is not part of the output here). `rulesVersion` is a hash of every
// rule's metadata and the thresholds in force, so a stored run states exactly which rules judged it.

import { DEFAULT_DCMA_RULES, normalizeDcmaRules, type DcmaRules } from '@/lib/analysis/dcma'
import { DEFAULT_GAO_THRESHOLDS, normalizeGaoThresholds, type GaoThresholds } from './config'
import { DCMA_DISCLAIMER, DCMA_RULES, DCMA_VERSION } from './dcma-pack'
import { GAO_DISCLAIMER, GAO_RULES, GAO_VERSION } from './gao'
import { buildNetwork, type Network } from './network'
import type { EngineConfig, RuleDef } from './rule'
import {
  CHARACTERISTICS, CHARACTERISTIC_LABELS, EVIDENCE_LIMIT, FRAMEWORK_LABELS,
  type Framework, type FrameworkResult, type GroupResult, type RuleResult, type RuleResultStatus,
  type StandardsInput, type StandardsRunOutput, type ThresholdConflict, type ThresholdSpec,
} from './types'

export const ENGINE_VERSION = '1.0.0'
export const COMPOSITE_VERSION = 'Planora Composite 1.0'
export const COMPOSITE_DISCLAIMER = 'Planora Composite applies the GAO screening checks and the DCMA 14-point checks side by side. Each finding keeps the framework, edition and threshold it came from; where two sources set different thresholds for the same measure, both results are shown and the difference is listed as a conflict rather than blended. This automated scan is not a GAO assessment, a DCMA review or a compliance determination.'
export const RUN_DISCLAIMER = 'Automated scan of schedule data. Results come only from deterministic rules; nothing here is decided by an AI model. It is not a GAO compliance determination or a substitute for a scheduler\'s or auditor\'s review.'

export const RULE_PACKS: Record<'GAO_SCHEDULE_GUIDE' | 'DCMA_14', RuleDef[]> = { GAO_SCHEDULE_GUIDE: GAO_RULES, DCMA_14: DCMA_RULES }

export function engineConfig(o: { gao?: Partial<GaoThresholds> | null; dcma?: Partial<DcmaRules> | null } = {}): EngineConfig {
  return { gao: normalizeGaoThresholds({ ...DEFAULT_GAO_THRESHOLDS, ...(o.gao || {}) }), dcma: normalizeDcmaRules({ ...DEFAULT_DCMA_RULES, ...(o.dcma || {}) }) }
}

/** Rules a framework applies, in order. */
export function rulesOf(fw: Framework): RuleDef[] {
  if (fw === 'GAO_SCHEDULE_GUIDE') return GAO_RULES
  if (fw === 'DCMA_14') return DCMA_RULES
  if (fw === 'PLANORA_COMPOSITE') return [...GAO_RULES, ...DCMA_RULES]
  return []
}

const emptyCounts = (): Record<RuleResultStatus, number> => ({ pass: 0, fail: 0, warning: 0, not_assessable: 0 })

export function evaluateRule(def: RuleDef, net: Network, cfg: EngineConfig): RuleResult {
  const { threshold: thFn, parameters: paramFn, evaluate, ...meta } = def
  const th = thFn ? thFn(cfg) : null
  const parameters = paramFn ? paramFn(cfg) : []
  let out
  if (!def.applicability.subjects.includes(net.input.subject.kind)) {
    out = { result: 'not_assessable' as const, metric: 'not assessable', evidence: [], recommendation: '', reason: `This rule applies to ${def.applicability.subjects.join(' and ')}s, not to a ${net.input.subject.kind}.` }
  } else {
    try { out = evaluate({ net, cfg }, th) } catch {
      out = { result: 'not_assessable' as const, metric: 'not assessable', evidence: [], recommendation: '', reason: 'The rule could not be evaluated on this data.' }
    }
  }
  return {
    ...meta,
    result: out.result, metric: out.metric, recommendation: out.recommendation, ...(out.reason ? { reason: out.reason } : {}),
    threshold: th, parameters,
    evidence: out.evidence.slice(0, EVIDENCE_LIMIT), evidenceTotal: out.evidence.length,
  }
}

export function countsOf(rules: RuleResult[]): Record<RuleResultStatus, number> {
  const c = emptyCounts()
  for (const r of rules) c[r.result]++
  return c
}

/** (pass + ½ warning) / assessed, 0–100; null when nothing could be assessed. */
export function scoreOf(c: Record<RuleResultStatus, number>): number | null {
  const assessed = c.pass + c.warning + c.fail
  return assessed ? Math.round((100 * (c.pass + 0.5 * c.warning)) / assessed) : null
}

function group(key: string, label: string, rules: RuleResult[]): GroupResult {
  const counts = countsOf(rules)
  return { key, label, score: scoreOf(counts), counts, rules }
}

function byCharacteristic(results: RuleResult[]): GroupResult[] {
  return CHARACTERISTICS.map(ch => group(ch, CHARACTERISTIC_LABELS[ch], results.filter(r => r.characteristic === ch))).filter(g => g.rules.length)
}

function byCategory(results: RuleResult[]): GroupResult[] {
  const keys = Array.from(new Set(results.map(r => r.category)))
  return keys.map(k => group(k.toLowerCase().replace(/\W+/g, '_'), k, results.filter(r => r.category === k)))
}

const describe = (t: ThresholdSpec) => `${t.display}${t.source === 'published' ? ' (published value)' : t.source === 'org_configured' ? ' (set by your organization)' : ' (Planora screening default)'}`

/**
 * Metrics that rules from different frameworks measure with different thresholds. Both findings
 * stay in the results under their own source; the conflict is reported, never resolved by blending.
 */
export function detectConflicts(results: RuleResult[]): ThresholdConflict[] {
  const byMetric = new Map<string, { r: RuleResult; t: ThresholdSpec }[]>()
  for (const r of results) {
    for (const t of [r.threshold, ...r.parameters]) {
      if (!t) continue
      byMetric.set(t.metricKey, [...(byMetric.get(t.metricKey) ?? []), { r, t }])
    }
  }
  const out: ThresholdConflict[] = []
  for (const [metricKey, list] of byMetric) {
    const frameworks = new Set(list.map(x => x.r.framework))
    const values = new Set(list.map(x => `${x.t.direction}:${x.t.value}`))
    if (frameworks.size < 2 || values.size < 2) continue
    out.push({
      metricKey,
      description: list.map(x => `${FRAMEWORK_LABELS[x.r.framework]} ${x.r.ruleId}: ${describe(x.t)}`).join(' vs '),
      sides: list.map(x => ({ ruleId: x.r.ruleId, framework: x.r.framework, threshold: x.t, result: x.r.result })),
      resolution: 'Both findings are reported, each against its own source\'s threshold. Planora does not merge them; decide which applies under your contract or set your organization\'s thresholds.',
    })
  }
  return out.sort((a, b) => a.metricKey.localeCompare(b.metricKey))
}

/** Canonical JSON (sorted keys) for hashing. */
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null)
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  return `{${Object.keys(v as object).sort().filter(k => typeof (v as Record<string, unknown>)[k] !== 'function').map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`
}

/** Two independent 32-bit FNV-1a style hashes, 16 hex chars (deterministic, dependency-free, runs anywhere). */
export function stableHash(text: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193)
    b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 15)
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')
}

/** Hash of the rules (metadata, versions) and thresholds a run uses. */
export function rulesVersionOf(frameworks: Framework[], cfg: EngineConfig): string {
  const rules = Array.from(new Map(frameworks.flatMap(rulesOf).map(r => [r.ruleId, r])).values())
  const body = rules.map(({ evaluate: _e, threshold: t, parameters: p, ...meta }) => ({ ...meta, threshold: t ? t(cfg) : null, parameters: p ? p(cfg) : [] }))
  return stableHash(canonical({ engine: ENGINE_VERSION, frameworks: [...frameworks].sort(), rules: body }))
}

function frameworkVersionOf(fw: Framework): string {
  return fw === 'GAO_SCHEDULE_GUIDE' ? GAO_VERSION : fw === 'DCMA_14' ? DCMA_VERSION : fw === 'PLANORA_COMPOSITE' ? COMPOSITE_VERSION : 'n/a'
}

export function runFramework(fw: Framework, net: Network, cfg: EngineConfig): FrameworkResult {
  const results = rulesOf(fw).map(r => evaluateRule(r, net, cfg))
  const counts = countsOf(results)
  return {
    framework: fw,
    frameworkVersion: frameworkVersionOf(fw),
    label: FRAMEWORK_LABELS[fw],
    groupBy: fw === 'DCMA_14' ? 'category' : 'characteristic',
    groups: fw === 'DCMA_14' ? byCategory(results) : byCharacteristic(results),
    counts,
    score: scoreOf(counts),
    conflicts: fw === 'PLANORA_COMPOSITE' ? detectConflicts(results) : [],
    disclaimer: fw === 'GAO_SCHEDULE_GUIDE' ? GAO_DISCLAIMER : fw === 'DCMA_14' ? DCMA_DISCLAIMER : COMPOSITE_DISCLAIMER,
  }
}

/** Runs the given frameworks (de-duplicated, in the order given) against one schedule or plan. */
export function runStandards(input: StandardsInput, frameworks: Framework[], cfg: EngineConfig = engineConfig()): StandardsRunOutput {
  const fws = Array.from(new Set(frameworks))
  const net = buildNetwork(input)
  return {
    engineVersion: ENGINE_VERSION,
    rulesVersion: rulesVersionOf(fws, cfg),
    subject: { ...input.subject, dataDate: input.schedule.dataDate ?? null },
    frameworks: fws.map(fw => runFramework(fw, net, cfg)),
    disclaimer: RUN_DISCLAIMER,
  }
}
