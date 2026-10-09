// "Use project documents" for Ask AI and AI reports: retrieve (scoped in SQL), screen, decide whether
// the passages may go to the model, generate, validate citations, and log the retrieval (ids only).

import { query } from '@/lib/db'
import { chat, AiQuotaError, RestrictedDataError } from '@/lib/llm/provider'
import { askMessages, buildAskPrompt, askScheduleQuestion } from '@/lib/openai'
import { log } from '@/lib/server/log'
import { finishGroundedAnswer, flaggedNote, groundedPrompt, groundingMode, partition, passagesAnswer, REPORT_QUERIES, type GroundingMode } from './grounding'
import { logRetrieval, type Delivery } from './retrieval'
import { retriever } from './store'
import { validateCitations } from './citations'
import type { RetrievalScope, RetrievedChunk } from './types'

type AskContext = Parameters<typeof askScheduleQuestion>[1]

export interface SourceRef { citation: string; documentId: string; chunkId: string; title: string; trust: string; tier: number }
export interface DocumentsOutcome {
  mode: GroundingMode | 'no_match'
  reason: string | null
  sources: SourceRef[]
  /** Citations the model used that matched a retrieved passage */
  cited: string[]
  /** Citations removed because they matched nothing retrieved */
  removedCitations: number
  flagged: { citation: string; documentId: string; chunkId: string; reasons: string[] }[]
}

const ref = (c: RetrievedChunk): SourceRef => ({ citation: c.citation, documentId: c.documentId, chunkId: c.chunkId, title: c.title, trust: c.trust, tier: c.tier })
const flaggedRef = (c: RetrievedChunk) => ({ citation: c.citation, documentId: c.documentId, chunkId: c.chunkId, reasons: c.flagReasons })

interface Args { scope: RetrievalScope; includeUnreviewed: boolean; userId: string; projectClassification: string | null }

/** Ask AI with project documents. */
export async function groundedAsk(question: string, ctx: AskContext, a: Args): Promise<{ answer: string; documents: DocumentsOutcome }> {
  const r = retriever()
  const retrieved = await r.search(a.scope, question, { match: 'any', includeUnreviewed: a.includeUnreviewed, limit: 16 })
  const { usable, flagged } = partition(retrieved)
  let answer: string
  let delivery: Delivery
  let mode: DocumentsOutcome['mode']
  let reason: string | null = null
  let cited: string[] = []
  let removed = 0

  if (!usable.length) {
    answer = await askScheduleQuestion(question, ctx)
    answer += `\n\n_No passage in ${a.includeUnreviewed ? 'the project documents' : 'the approved project documents'} matched this question${a.includeUnreviewed ? '' : ' (unreviewed documents were not searched)'}._`
    if (flagged.length) answer += `\n\n${flaggedNote(flagged)}`
    delivery = 'none'; mode = 'no_match'
  } else {
    const m = groundingMode(a.projectClassification, usable)
    mode = m.mode; reason = m.reason
    if (m.mode === 'model') {
      const prompt = buildAskPrompt(question, ctx)
      let text: string | null = null
      try {
        text = await chat(askMessages(prompt.system, question, groundedPrompt(usable, question)), { temperature: 0.2, maxTokens: 2000, purpose: 'ask_ai.documents' })
      } catch (err) {
        if (err instanceof RestrictedDataError) { mode = 'withheld_restricted'; reason = err.message }
        else if (err instanceof AiQuotaError) { mode = 'passages_only'; reason = err.message }
        else { log('warn', 'model call failed', { purpose: 'ask_ai.documents', error: (err as Error).message }); mode = 'passages_only'; reason = 'AI analysis is temporarily unavailable.' }
      }
      if (text) {
        const check = finishGroundedAnswer(text, usable, flagged)
        answer = check.text; cited = check.valid.map(v => v.citation); removed = check.invalid.length
        delivery = 'model'
      } else {
        if (mode === 'model') { mode = 'passages_only'; reason = 'No AI model answered.' }
        answer = passagesAnswer(usable, flagged, reason)
        delivery = mode === 'withheld_restricted' ? 'withheld_restricted' : 'passages_only'
      }
    } else {
      answer = passagesAnswer(usable, flagged, reason)
      delivery = m.mode === 'withheld_restricted' ? 'withheld_restricted' : 'passages_only'
    }
  }
  await logRetrieval(query, { orgId: a.scope.orgId, userId: a.userId, scheduleId: a.scope.scheduleId, purpose: 'ask_ai', backend: r.backend, query: question, includeUnreviewed: a.includeUnreviewed, delivery, chunks: retrieved, invalidCitations: removed })
  return { answer, documents: { mode, reason, sources: usable.map(ref), cited, removedCitations: removed, flagged: flagged.map(flaggedRef) } }
}

/** Retrieval for an AI report: the grounding to pass to the model (only when allowed) and what to append. */
export async function reportGrounding(reportType: string, a: Args) {
  const r = retriever()
  const q = REPORT_QUERIES[reportType] || REPORT_QUERIES.executive_summary
  const retrieved = await r.search(a.scope, q, { match: 'any', includeUnreviewed: a.includeUnreviewed, limit: 16 })
  const { usable, flagged } = partition(retrieved)
  const m = usable.length ? groundingMode(a.projectClassification, usable) : { mode: 'passages_only' as GroundingMode, reason: null }
  const grounding = m.mode === 'model' && usable.length ? groundedPrompt(usable, q) : undefined

  /** Validates the report's citations, appends the documents section, and logs the retrieval. */
  const finish = async (report: string): Promise<{ report: string; documents: DocumentsOutcome }> => {
    let text = report
    let cited: string[] = []
    let removed = 0
    if (grounding) {
      const check = validateCitations(report, usable)
      text = check.text; cited = check.valid.map(v => v.citation); removed = check.invalid.length
    }
    const section: string[] = ['', '## Project documents']
    if (!usable.length) section.push(`No ${a.includeUnreviewed ? '' : 'approved '}project document passage matched this report's topics.${a.includeUnreviewed ? '' : ' Unreviewed documents were not used.'}`)
    else if (grounding) {
      section.push('Passages given to the AI model (untrusted document text, cited where used):')
      for (const c of usable) section.push(`- ${c.citation}${c.trust === 'unreviewed' ? ' (unreviewed)' : ''}${cited.includes(c.citation) ? ' — cited' : ''}`)
    } else {
      if (m.reason) section.push(`_${m.reason} The passages below were not sent to a model._`)
      section.push('Relevant passages:')
      for (const c of usable.slice(0, 6)) section.push(`- **${c.citation}**${c.trust === 'unreviewed' ? ' (unreviewed)' : ''}: ${c.text.replace(/\s+/g, ' ').slice(0, 400)}${c.text.length > 400 ? '…' : ''}`)
    }
    if (flagged.length) section.push('', flaggedNote(flagged))
    const delivery: Delivery = !usable.length ? 'none' : grounding ? 'model' : m.mode === 'withheld_restricted' ? 'withheld_restricted' : 'passages_only'
    await logRetrieval(query, { orgId: a.scope.orgId, userId: a.userId, scheduleId: a.scope.scheduleId, purpose: `report.${reportType}`.slice(0, 60), backend: r.backend, query: q, includeUnreviewed: a.includeUnreviewed, delivery, chunks: retrieved, invalidCitations: removed })
    return {
      report: `${text.trimEnd()}\n${section.join('\n')}\n`,
      documents: { mode: usable.length ? (grounding ? 'model' : m.mode) : 'no_match', reason: m.reason, sources: usable.map(ref), cited, removedCitations: removed, flagged: flagged.map(flaggedRef) },
    }
  }
  return { grounding, finish }
}
