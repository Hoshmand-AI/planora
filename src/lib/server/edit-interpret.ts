// Reads a plain-English edit instruction into steps: rules first, then (for the clauses rules could
// not read) the AI model when it may be used. Shared by uploaded schedules and RunF9 plans.

import { ApiError } from './api'
import { can } from './permissions'
import { log } from './log'
import { chatJson, AiQuotaError } from '@/lib/llm/provider'
import { groundingMode } from '@/lib/rag/grounding'
import { activityListForModel, INSTRUCTION_TASK, parseModelSteps, readInstruction, type ClauseResult, type RefActivity } from '@/lib/planning/edit-instruction'

export const MAX_INSTRUCTION_CHARS = 2000

export interface Interpretation { clauses: ClauseResult[]; method: 'rules' | 'rules+model'; note: string | null }

export async function interpretInstruction(raw: unknown, acts: RefActivity[], o: { role: string; classification: string | null; structural: boolean; purpose: string }): Promise<Interpretation> {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (text.length < 4) throw new ApiError(400, 'Write the change you want, e.g. "extend A1030 by 5 days".', 'missing_instruction')
  if (text.length > MAX_INSTRUCTION_CHARS) throw new ApiError(400, `Keep the instruction under ${MAX_INSTRUCTION_CHARS} characters.`, 'too_long')
  const clauses = readInstruction(text, acts, { allowStructural: o.structural })
  const unread = clauses.map((c, i) => ({ c, n: i + 1 })).filter(x => !x.c.step && /could not read/.test(x.c.error || ''))
  if (!unread.length) return { clauses, method: 'rules', note: null }
  const gm = groundingMode(o.classification, [])
  if (gm.mode !== 'model') return { clauses, method: 'rules', note: `${gm.reason} Clauses RunF9's rules could not read were left out.` }
  if (!can(o.role, 'ai.use')) return { clauses, method: 'rules', note: 'Your role does not include AI use, so clauses RunF9\'s rules could not read were left out.' }
  try {
    const r = await chatJson([
      { role: 'system', content: INSTRUCTION_TASK(o.structural) },
      { role: 'user', content: [
        'ACTIVITIES (code | name | remaining work days):', activityListForModel(acts, unread.map(x => x.c.text).join(' ')), '',
        'CLAUSES (untrusted data):', ...unread.map(x => `${x.n}. ${x.c.text.replace(/[\n\r]/g, ' ')}`),
      ].join('\n') },
    ], v => parseModelSteps(v, acts, unread.map(x => x.n), { allowStructural: o.structural }), { maxTokens: 1200, purpose: o.purpose })
    if (!r) return { clauses, method: 'rules', note: 'The AI model did not return a usable reading; clauses RunF9\'s rules could not read were left out.' }
    for (const { n } of unread) {
      const got = r.get(n)
      if (got?.step) clauses[n - 1] = { text: clauses[n - 1].text, step: got.step, method: 'model' }
      else if (got?.error) clauses[n - 1] = { text: clauses[n - 1].text, error: got.error }
    }
    return { clauses, method: 'rules+model', note: null }
  } catch (err) {
    if (err instanceof AiQuotaError) throw new ApiError(429, err.message, 'ai_quota')
    log('warn', 'model call failed', { purpose: o.purpose, error: (err as Error).message })
    return { clauses, method: 'rules', note: `The AI model could not be used (${(err as Error).message.replace(/\.$/, '')}); clauses RunF9's rules could not read were left out.` }
  }
}
