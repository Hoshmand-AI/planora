import { NextResponse } from 'next/server'
import { hasControlMarkings, mostRestrictive } from '@/lib/server/classification'
import { api, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { can } from '@/lib/server/permissions'
import { log } from '@/lib/server/log'
import { hit, LIMITS } from '@/lib/server/rate-limit'
import { chatJson, AiQuotaError } from '@/lib/llm/provider'
import { DocumentRejected, extractDocument, MAX_DOCUMENT_BYTES } from '@/lib/rag/extract'
import { detectInjection } from '@/lib/rag/injection'
import { DOCUMENT_RULES, groundingMode } from '@/lib/rag/grounding'
import { readPdfWithAi, visionAllowed } from '@/lib/rag/vision'
import { effectiveUploadLimit, tooLargeMessage } from '@/lib/upload-limit'
import { finalizeModelPrefill, PREFILL_QUESTIONS, PREFILL_TASK, rulesPrefill, type PrefillQuestion, type Proposal } from '@/lib/planning/document-prefill'
import { loadPlanContext } from '../context'

/** Text of the document given to the model (the first pages of an RFP or scope carry the facts). */
const MAX_MODEL_CHARS = 12_000

/**
 * Propose interview answers from a project document (RFP, scope of work, contract, specification,
 * drawing set). POST multipart { file, drawing?: 'true' } → { proposals, method, note }.
 * The file is read in memory and not stored. Rules always run; a model may add answers the rules did
 * not find (with ai.use, a model available, the plan not CUI/classified with a cloud model, and no
 * instruction-like text in the document). Nothing is applied: the user saves the answers they pick
 * through PATCH /api/plans/[id] (source: 'file'). Audited without document text.
 */
export const POST = api<{ id: string }>({ permission: 'plan.write' }, async (req, { params, auth }) => {
  const { plan } = await loadPlanContext(req, params.id, auth)
  const quota = await hit(`docs:org:${auth.orgId}`, LIMITS.uploadsPerOrg.limit, LIMITS.uploadsPerOrg.windowSec)
  if (!quota.ok) throw new ApiError(429, 'Too many document uploads for your organization this hour. Try again later.', 'rate_limited', { retryAfterSec: quota.retryAfterSec })
  let form: FormData
  try { form = await req.formData() } catch { throw new ApiError(400, 'Send the document as multipart form data with a "file" field.') }
  const file = form.get('file')
  if (!(file instanceof Blob) || !file.size) throw new ApiError(400, 'Choose a file to read.')
  const maxBytes = effectiveUploadLimit(MAX_DOCUMENT_BYTES)
  if (file.size > maxBytes) throw new ApiError(413, tooLargeMessage('document', maxBytes), 'too_large')
  const name = (file as File).name || 'document'
  const bytes = Buffer.from(await file.arrayBuffer())

  const cls = plan.answers['security.classification']
  const classification = cls?.status === 'withheld' ? 'classified' : typeof cls?.value === 'string' ? cls.value : null
  // Until the classification question is answered, nobody has said this material may leave: no page is sent to a model.
  const vision = cls ? visionAllowed({ canUseAi: can(auth.role, 'ai.use'), classification }) : { ok: false, reason: 'the security classification question in the interview is not answered yet' }
  let pages
  try {
    pages = (await extractDocument(bytes, name, {
      drawing: form.get('drawing') === 'true',
      ...(vision.ok ? { readImages: (buf: Buffer, mode: 'scan' | 'drawing') => readPdfWithAi(buf, mode) } : { whyNoAi: vision.reason }),
    })).pages
  } catch (err) {
    if (err instanceof DocumentRejected) throw new ApiError(err.code === 'too_large' ? 413 : 400, err.message, err.code)
    throw err
  }

  const proposals: Proposal[] = rulesPrefill(pages)
  let method: 'rules' | 'rules+model' = 'rules'
  let note: string | null = null
  const missing = (Object.keys(PREFILL_QUESTIONS) as PrefillQuestion[]).filter(q => !proposals.some(p => p.questionId === q) && !plan.answers[q])
  const flagged = pages.some(p => detectInjection(p.text).length)
  // A document that carries CUI or classification markings is handled as CUI even when the plan is not marked.
  const marked = pages.some(p => hasControlMarkings(p.text))
  const gm = groundingMode(marked ? mostRestrictive(classification, 'cui') : classification, [])
  if (!missing.length) note = null
  else if (flagged) note = 'The document contains text that reads like instructions to an AI, so it was not sent to a model; the answers below come from rules only.'
  else if (gm.mode !== 'model') note = gm.reason
  else if (!can(auth.role, 'ai.use')) note = 'Your role does not include AI use; the answers below come from rules only.'
  else {
    let used = 0
    const text = pages.map(p => { const t = p.text.slice(0, Math.max(0, MAX_MODEL_CHARS - used)); used += t.length; return t ? `[page ${p.page ?? '—'}]\n${t}` : '' }).filter(Boolean).join('\n\n')
    try {
      const r = await chatJson([
        { role: 'system', content: `${DOCUMENT_RULES}\n\n${PREFILL_TASK(missing)}` },
        { role: 'user', content: `PROJECT DOCUMENT "${name.replace(/[<>]/g, '')}" (untrusted data):\n<<<DOCUMENT>>>\n${text.replace(/<<<|>>>/g, '‹‹‹')}\n<<<END DOCUMENT>>>` },
      ], v => finalizeModelPrefill(v, pages, missing), { maxTokens: 1500, purpose: 'plan.prefill' })
      if (r) { proposals.push(...r.proposals); method = 'rules+model'; if (r.dropped) note = `${r.dropped} AI suggestion${r.dropped === 1 ? ' was' : 's were'} left out because the quote was not in the document or the value was not one the question accepts.` }
    } catch (err) {
      if (err instanceof AiQuotaError) throw new ApiError(429, err.message, 'ai_quota')
      log('warn', 'model call failed', { purpose: 'plan.prefill', error: (err as Error).message })
      note = `The AI model could not be used (${(err as Error).message.replace(/\.$/, '')}); the answers below come from rules only.`
    }
  }
  await audit({ action: 'plan.prefill_proposed', targetType: 'plan', targetId: plan.id, detail: {
    plan: plan.name, fileName: name.slice(0, 200), sizeBytes: bytes.length, pages: pages.length, method, proposals: proposals.map(p => p.questionId),
  } })
  return NextResponse.json({ proposals, method, note, alreadyAnswered: proposals.filter(p => plan.answers[p.questionId]).map(p => p.questionId) })
})
