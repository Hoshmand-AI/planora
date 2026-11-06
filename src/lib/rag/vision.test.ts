import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { parseVisionReply, pageText, readPdfWithAi, VISION_BATCH, VISION_MAX_PAGES, visionAllowed } from './vision'
import { DocumentRejected, extractDocument } from './extract'
import { toAnthropicPayload } from '@/lib/llm/anthropic-adapter'
import type { ChatMessage } from '@/lib/llm/gateway'

async function blankPdf(pages: number): Promise<Buffer> {
  const d = await PDFDocument.create()
  for (let i = 0; i < pages; i++) d.addPage([612, 792])
  return Buffer.from(await d.save())
}

/** A stand-in model: answers each batch from the page numbers in the prompt; records what it was sent. */
function fakeChat(reply: (first: number, last: number) => unknown) {
  const calls: { first: number; last: number; pagesInAttachment: number }[] = []
  const chat = async (messages: ChatMessage[], validate: (v: unknown) => unknown) => {
    const m = /pages? (\d+) to (\d+)|sheets (\d+) to (\d+)/.exec(messages[0].content)!
    const first = Number(m[1] ?? m[3]), last = Number(m[2] ?? m[4])
    const att = messages[0].attachments![0]
    const doc = await PDFDocument.load(Buffer.from(att.data, 'base64'))
    calls.push({ first, last, pagesInAttachment: doc.getPageCount() })
    const v = reply(first, last)
    return v == null ? null : validate(v)
  }
  return { chat: chat as never, calls }
}
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k)

describe('reading scanned pages and drawing sheets with AI', () => {
  it('sends the PDF in small batches and keeps the real page numbers', async () => {
    const { chat, calls } = fakeChat((f, l) => ({ pages: range(f, l).map(p => ({ page: p, text: `Text of page ${p}` })) }))
    const r = await readPdfWithAi(await blankPdf(7), 'scan', chat)
    expect(r.pageCount).toBe(7)
    expect(r.pages.map(p => p.page)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(r.pages[6].text).toBe('Text of page 7')
    expect(calls.map(c => [c.first, c.last, c.pagesInAttachment])).toEqual([[1, 3, 3], [4, 6, 3], [7, 7, 1]])
    expect(VISION_BATCH.scan).toBe(3)
  })

  it('indexes a drawing sheet by its number and title first, so it can be cited', async () => {
    const { chat } = fakeChat((f, l) => ({ pages: range(f, l).map(p => ({ page: p, sheet: `S-10${p}`, title: 'Foundation Plan', discipline: 'Structural', text: 'Footing F1: 6\'-0" x 6\'-0"', shows: 'Footing layout at grids A–D.' })) }))
    const r = await readPdfWithAi(await blankPdf(2), 'drawing', chat)
    expect(r.pages[0].text.split('\n')[0]).toBe('Sheet S-101 Foundation Plan (Structural)')
    expect(r.pages[0].text).toContain('Footing F1')
  })

  it('refuses a reply that skips or invents pages (the model must account for each page)', () => {
    expect(() => parseVisionReply({ pages: [{ page: 1, text: 'a' }] }, 1, 2)).toThrow(/page 2 is missing/)
    expect(() => parseVisionReply({ pages: [{ page: 1, text: 'a' }, { page: 9, text: 'b' }] }, 1, 2)).toThrow(/1 to 2/)
    expect(() => parseVisionReply({ text: 'no pages' }, 1, 1)).toThrow(/pages/)
    expect(pageText({ page: 1, text: 'plain' }, 'scan')).toBe('plain')
  })

  it('fails the upload with a clear message when a batch cannot be read, or the file is too long for AI reading', async () => {
    const { chat } = fakeChat(() => null)
    await expect(readPdfWithAi(await blankPdf(2), 'scan', chat)).rejects.toThrow(/could not read pages 1–2/)
    await expect(readPdfWithAi(await blankPdf(VISION_MAX_PAGES + 1), 'drawing', chat)).rejects.toBeInstanceOf(DocumentRejected)
  })

  it('a scanned PDF is transcribed when AI reading is allowed, and refused with the reason when it is not', async () => {
    const pdf = await blankPdf(2)
    const read = async () => ({ pages: [{ page: 1, text: 'SECTION 01 32 16 Construction Progress Schedule' }, { page: 2, text: 'Update the schedule monthly.' }], pageCount: 2 })
    const ok = await extractDocument(pdf, 'scan.pdf', { readImages: read })
    expect(ok.readBy).toBe('ai_vision')
    expect(ok.pages[1].text).toContain('monthly')
    await expect(extractDocument(pdf, 'scan.pdf', { whyNoAi: 'no AI model is configured' })).rejects.toThrow(/looks scanned.*not here: no AI model is configured/)
  })

  it('only allows AI page reading with a model that reads files, AI use, and never CUI to a cloud model', () => {
    const cloud = { mode: 'cloud' as const, provider: 'anthropic' as const, model: 'm', host: 'api.anthropic.com', airgapped: false, smallModel: false }
    expect(visionAllowed({ canUseAi: true, classification: null }, cloud as never).ok).toBe(true)
    expect(visionAllowed({ canUseAi: false, classification: null }, cloud as never).reason).toMatch(/role/)
    expect(visionAllowed({ canUseAi: true, classification: 'cui' }, cloud as never).reason).toMatch(/CUI/)
    expect(visionAllowed({ canUseAi: true, classification: null }, { ...cloud, provider: 'bedrock' } as never).reason).toMatch(/cannot read page images/)
    expect(visionAllowed({ canUseAi: true, classification: null }, { ...cloud, mode: 'offline', model: null } as never).ok).toBe(false)
  })

  it('sends attachments to Claude as document blocks ahead of the text', () => {
    const p = toAnthropicPayload([{ role: 'user', content: 'Read this', attachments: [{ kind: 'pdf', mediaType: 'application/pdf', data: 'QUJD' }] }])
    expect(p.messages[0].content).toEqual([
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'QUJD' } },
      { type: 'text', text: 'Read this' },
    ])
  })
})
