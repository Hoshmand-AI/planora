// Optional AI-written narrative for a TIA run. The model only explains the computed results (given to
// it as JSON) and cites activity codes in [brackets]; its text is checked before use: every cited code
// must be in the result, and it must not reach a conclusion on entitlement, excusability,
// compensability or fault. Anything else, offline / air-gapped mode, or a model failure gives the
// deterministic template narrative (tiaNarrative), so the output is always available.

import { chat, llmStatus } from '@/lib/llm/provider'
import { log } from '@/lib/server/log'
import { RESPONSIBILITY_LABELS, type DelayEvent, type TiaResult } from '@/lib/analysis/tia'
import { tiaNarrative } from './tia-report'

const CONCLUSION = /\b(entitle\w*|excusab\w*|non-excusab\w*|compensab\w*|liab\w*|at fault|is responsible|are responsible|owes?|damages)\b/i

/** Every activity code the result mentions (the codes a narrative may cite). */
export function citableCodes(r: TiaResult): Set<string> {
  return new Set([
    ...r.milestones.map(m => m.code), ...r.fragnet.map(f => f.code), ...r.drivingPath.before.map(s => s.code), ...r.drivingPath.after.map(s => s.code),
    ...r.concurrency.flags.map(f => f.code), ...(r.contractMilestone ? [r.contractMilestone.code] : []),
  ])
}

/** Null when the model's text may be used; otherwise why it was not. */
export function checkAiNarrative(text: string, r: TiaResult): string | null {
  if (!text.trim() || text.length > 8000) return 'empty or too long'
  if (CONCLUSION.test(text)) return 'it states or implies a contractual conclusion'
  const allowed = citableCodes(r)
  const cited = [...text.matchAll(/\[([^\]\n]{1,40})\]/g)].map(m => m[1].trim())
  if (!cited.length) return 'it cites no activity codes'
  const unknown = cited.filter(c => !allowed.has(c))
  if (unknown.length) return `it cites codes that are not in the results (${unknown.slice(0, 5).join(', ')})`
  return null
}

function facts(r: TiaResult, e: Pick<DelayEvent, 'title' | 'responsibility' | 'eventStart' | 'eventEnd'>) {
  return {
    event: { title: e.title, responsibilityLabelEnteredByUser: RESPONSIBILITY_LABELS[e.responsibility], start: e.eventStart, end: e.eventEnd },
    update: r.update, contractMilestone: r.contractMilestone, projectFinish: r.projectFinish,
    milestones: r.milestones.map(m => ({ code: m.code, name: m.name, kind: m.kind, contractDate: m.contractDate, before: m.before, after: m.after, impactCd: m.impactCd, impactWd: m.impactWd, floatChange: m.floatChange })),
    fragnet: r.fragnet, drivingPathBefore: r.drivingPath.before.map(s => s.code), drivingPathAfter: r.drivingPath.after.map(s => s.code), fragnetOnPath: r.drivingPath.fragnetOnPath,
    concurrencyIndicators: r.concurrency.flags.map(f => ({ code: f.code, detail: f.detail })), findings: r.findings,
  }
}

export async function tiaNarrativeWithAi(r: TiaResult, e: Pick<DelayEvent, 'title' | 'responsibility' | 'eventStart' | 'eventEnd' | 'description'>): Promise<{ text: string; source: 'ai' | 'template'; model: string | null; note: string | null }> {
  const template = { text: tiaNarrative(r, e), source: 'template' as const, model: null }
  if (!r.ok) return { ...template, note: 'The fragnet did not validate, so there are no results to explain.' }
  const status = llmStatus()
  try {
    const text = await chat([
      { role: 'system', content: 'You explain the results of a schedule Time Impact Analysis that has already been calculated. Use ONLY the facts in the JSON. Do not compute new numbers. Cite every activity you mention by its code in square brackets, e.g. [A1050]. Dates are MM/DD/YYYY. Do not state or imply entitlement, excusability, compensability, fault, liability or who is responsible: those are contractual and legal determinations outside this analysis. Mention that concurrency indicators require analyst judgment. Write 3 to 5 short plain paragraphs, no headings.' },
      { role: 'user', content: JSON.stringify(facts(r, e)) },
    ], { temperature: 0.2, maxTokens: 1200, purpose: 'tia.narrative' })
    if (!text) return { ...template, note: `No AI model is available (${status.error || 'offline mode'}); the template narrative is used.` }
    const why = checkAiNarrative(text, r)
    if (why) return { ...template, note: `The AI narrative was not used because ${why}; the template narrative is used.` }
    return { text: text.trim(), source: 'ai', model: status.model ?? null, note: null }
  } catch (err) {
    log('warn', 'model call failed', { purpose: 'tia.narrative', error: (err as Error).message })
    return { ...template, note: `The AI model could not be used (${(err as Error).message}); the template narrative is used.` }
  }
}
