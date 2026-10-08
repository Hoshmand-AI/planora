// Context for any AI explanation of a standards run. The rule engine decides every result; a model
// may only explain those results, citing ruleIds. It never receives the job of judging pass/fail,
// and text it returns is checked for ruleIds that do not exist in the run.

import type { StandardsRunOutput } from './types'

export const STANDARDS_AI_INSTRUCTIONS = [
  'The results below were computed by Planora\'s deterministic rules engine and are authoritative.',
  'Explain them; do not re-judge, re-score, upgrade or downgrade any result, and do not add findings of your own.',
  'Cite the ruleId (for example GAO-BP2-01 or DCMA-06) for every statement about a result.',
  'Do not describe the scan as a GAO assessment or a compliance determination.',
].join(' ')

/** Plain-text summary of a run for a model prompt: one line per rule, with its ruleId and result. */
export function standardsPromptContext(run: StandardsRunOutput, opts: { maxEvidence?: number } = {}): string {
  const n = opts.maxEvidence ?? 5
  const lines: string[] = [STANDARDS_AI_INSTRUCTIONS, `Rules version ${run.rulesVersion} (engine ${run.engineVersion}).`]
  for (const fw of run.frameworks) {
    lines.push(`\n${fw.label} (${fw.frameworkVersion}): ${fw.counts.pass} pass, ${fw.counts.warning} warning, ${fw.counts.fail} fail, ${fw.counts.not_assessable} not assessable.`)
    for (const g of fw.groups) {
      lines.push(`- ${g.label}:`)
      for (const r of g.rules) {
        const ev = r.evidence.length ? ` Evidence: ${r.evidence.slice(0, n).join(', ')}${r.evidenceTotal > n ? ` (+${r.evidenceTotal - n} more)` : ''}.` : ''
        lines.push(`  ${r.ruleId} [${r.result.toUpperCase()}] ${r.title}: ${r.metric}${r.threshold ? `; threshold ${r.threshold.display}` : ''}.${ev}${r.reason && r.result === 'not_assessable' ? ` Reason: ${r.reason}` : ''}`)
      }
    }
    for (const c of fw.conflicts) lines.push(`  Threshold conflict on ${c.metricKey}: ${c.description}.`)
  }
  return lines.join('\n')
}

/** ruleIds a model's text cites that are not in the run (an explanation must not invent rules). */
export function unknownRuleCitations(text: string, run: StandardsRunOutput): string[] {
  const known = new Set(run.frameworks.flatMap(f => f.groups.flatMap(g => g.rules.map(r => r.ruleId))))
  const cited = text.match(/\b(?:GAO-BP\d{1,2}-\d{2}|DCMA-\d{2}|CUST-[A-Z0-9-]+)\b/g) ?? []
  return Array.from(new Set(cited.filter(c => !known.has(c))))
}
