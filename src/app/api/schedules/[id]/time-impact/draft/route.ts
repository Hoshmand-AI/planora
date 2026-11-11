import { NextResponse } from 'next/server'
import { api, body as readBody, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { can } from '@/lib/server/permissions'
import { log } from '@/lib/server/log'
import { chatJson, AiQuotaError, RestrictedDataError } from '@/lib/llm/provider'
import { AiProviderError, AiRefusalError } from '@/lib/llm/gateway'
import { loadTiaContext } from '@/lib/server/tia-service'
import { projectClassification, projectScope } from '@/lib/rag/scope'
import { getDocument, scopedChunks } from '@/lib/rag/store'
import { buildDocumentBlocks, DOCUMENT_RULES, groundingMode } from '@/lib/rag/grounding'
import { finalizeModelDraft, FRAGNET_TASK, parseModelDraft, pickListForModel, rulesDraft, type FragnetDraft } from '@/lib/analysis/tia-draft'

/** Passages of one document given to the model (a change order is usually a few pages). */
const MAX_DRAFT_PASSAGES = 24

/**
 * Draft a delay event's fragnet from a change document (change order, RFI, directive, notice) that is
 * one of this project's documents.
 *   POST { documentId } → { draft } — nothing is saved. With ai.use and a model available, the model
 *   proposes activities and ties; every activity must quote its cited passage verbatim and ties may only
 *   use existing activity codes (lib/analysis/tia-draft.ts). Otherwise (offline, CUI/classified with a
 *   cloud model, no ai.use, a model failure) a rules-based starting point. Audited without document text.
 */
export const POST = api<{ id: string }>({ permission: 'schedule.write' }, async (req, { params, auth }) => {
  const b = await readBody(req)
  const documentId = typeof b.documentId === 'string' ? b.documentId : ''
  if (!documentId) throw new ApiError(400, 'Choose a project document to draft from.', 'missing_document')
  const ctx = await loadTiaContext(params.id, auth.orgId)
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { scope } = await projectScope(auth.orgId, params.id)
  const doc = await getDocument(scope, documentId)
  if (!doc) return NextResponse.json({ error: 'That document is not one of this project’s documents.' }, { status: 404 })
  // Only this document's passages are read (filtered in SQL, so a large project never cuts a recent document off).
  const all = (await scopedChunks(scope, { includeUnreviewed: true, documentId: doc.id })).filter(c => c.documentId === doc.id)
  if (!all.length) throw new ApiError(422, 'That document has no readable text.', 'empty_document')
  const flagged = all.filter(c => c.flagged)
  const usable = all.filter(c => !c.flagged).slice(0, MAX_DRAFT_PASSAGES)

  const classification = await projectClassification(params.id, auth.orgId)
  const gm = groundingMode(classification, usable)
  let draft: FragnetDraft | null = null
  let reason: string | null = gm.reason
  if (gm.mode === 'model' && !can(auth.role, 'ai.use')) reason = 'Your role does not include AI use.'
  else if (gm.mode === 'model' && usable.length) {
    try {
      const proposal = await chatJson([
        { role: 'system', content: `${DOCUMENT_RULES}\n\n${FRAGNET_TASK}` },
        { role: 'user', content: [
          `SCHEDULE UPDATE: ${ctx.data.schedule.name} (${ctx.data.schedule.version}), data date ${ctx.data.schedule.dataDate ?? 'not set'}.`,
          'SCHEDULE (code | name | start → finish | total float | status):', pickListForModel(ctx.data.activities, usable.map(c => c.text).join('\n')),
          '', `CHANGE DOCUMENT: ${doc.title}`, buildDocumentBlocks(usable),
        ].join('\n') },
      ], parseModelDraft, { maxTokens: 3000, purpose: 'tia.fragnet_draft' })
      if (proposal) draft = finalizeModelDraft(proposal, usable, ctx.net, doc.title)
      else reason = 'The AI model did not return a usable draft.'
    } catch (err) {
      if (err instanceof AiQuotaError) throw new ApiError(429, err.message, 'ai_quota')
      log('warn', 'model call failed', { purpose: 'tia.fragnet_draft', error: (err as Error).message })
      // Only messages written for users (provider, refusal, restricted data) are shown.
      reason = err instanceof AiProviderError || err instanceof AiRefusalError || err instanceof RestrictedDataError ? `The AI model could not be used (${err.message.replace(/\.$/, '')}).` : 'The AI model could not be used.'
    }
  }
  if (!draft) draft = rulesDraft(usable, ctx.net, doc.title, reason ?? 'No AI model is available.')
  if (flagged.length) draft.warnings.push(`${flagged.length} passage${flagged.length === 1 ? '' : 's'} of the document read like instructions to an AI and were left out; review them on the Documents page.`)

  await audit({ action: 'tia.fragnet_draft', targetType: 'schedule', targetId: params.id, detail: {
    schedule: ctx.data.schedule.name, version: ctx.data.schedule.version, documentId: doc.id, documentTitle: doc.title, method: draft.method,
    activities: draft.fragnet.activities.length, ties: draft.fragnet.relationships.length, droppedOrWarnings: draft.warnings.length, validationErrors: draft.validation.errors.length,
  } })
  return NextResponse.json({ draft })
})
