// Model-assisted elicitation. The rule-based question bank covers the known gaps; the model is asked
// only for a few project-specific follow-ups a senior scheduler might add. Designed for small
// self-hosted models: one narrow task, JSON-only output, strict validation, and a hard cap.

import { chatJson, llmStatus } from '@/lib/llm/provider'
import type { Answer, Question, QuestionSection } from './types'

const SECTIONS: QuestionSection[] = ['project', 'design', 'permits', 'procurement', 'site', 'regulatory', 'calendar', 'security']

/** Only answers the user chose to share are ever sent to a model. Withheld items appear as a count. */
export function redactedBrief(answers: Record<string, Answer>, bank: Question[]): string {
  const byId = new Map(bank.map(q => [q.id, q]))
  const lines: string[] = []
  let withheld = 0
  for (const [id, a] of Object.entries(answers)) {
    if (a.status === 'withheld') { withheld++; continue }
    const q = byId.get(id)
    const label = q ? q.prompt : id
    const value = a.status === 'unknown' ? 'unknown' : Array.isArray(a.value) ? a.value.join(', ') : String(a.value)
    const shown = q?.options?.find(o => o.value === a.value)?.label || value
    lines.push(`- ${label} ${shown}`)
  }
  if (withheld) lines.push(`- (${withheld} answers withheld for security reasons — do not ask about them)`)
  return lines.join('\n')
}

function hashId(text: string): string {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

export function validateSuggestions(raw: unknown, existing: Question[]): Question[] {
  if (!Array.isArray(raw)) throw new Error('expected a JSON array')
  const seen = new Set(existing.map(q => q.prompt.toLowerCase()))
  const out: Question[] = []
  for (const item of raw.slice(0, 5)) {
    if (!item || typeof item !== 'object') continue
    const { question, why, section } = item as Record<string, unknown>
    if (typeof question !== 'string' || question.length < 10 || question.length > 240) continue
    if (typeof why !== 'string' || why.length < 10) continue
    if (seen.has(question.toLowerCase())) continue
    seen.add(question.toLowerCase())
    const sec = SECTIONS.includes(section as QuestionSection) ? (section as QuestionSection) : 'project'
    out.push({
      id: `ai.${hashId(question)}`, section: sec, kind: 'text', impact: 25, allowWithheld: true,
      prompt: question.trim(), why: why.trim().slice(0, 400),
      groundedBy: [{ kind: 'model', label: `Suggested by ${llmStatus().model ?? 'model'}`, detail: 'Model-proposed follow-up; answer is recorded as an assumption note.' }],
    })
    if (out.length >= 3) break
  }
  if (!out.length && raw.length) throw new Error('no valid items; each item needs "question" and "why" strings')
  return out
}

export async function suggestQuestions(answers: Record<string, Answer>, bank: Question[]): Promise<Question[]> {
  const status = llmStatus()
  if (status.mode === 'offline') return []
  const covered = bank.map(q => `- ${q.prompt}`).join('\n')
  const system = status.smallModel
    ? 'You help a construction scheduler find missing information. Output JSON only.'
    : 'You are a senior construction scheduler interviewing a project team before building a CPM schedule. You find information gaps that would change durations, logic, or the critical path. Output JSON only.'
  const user = `Project brief so far:
${redactedBrief(answers, bank) || '- (nothing answered yet)'}

Questions already asked (do NOT repeat these):
${covered}

List up to 3 more questions that would change the schedule for THIS project. Return a JSON array like:
[{"question": "...", "why": "how the answer changes the schedule", "section": "site"}]
section is one of: ${SECTIONS.join(', ')}.`
  const result = await chatJson([{ role: 'system', content: system }, { role: 'user', content: user }], v => validateSuggestions(v, bank), { maxTokens: 700 })
  return result ?? []
}
