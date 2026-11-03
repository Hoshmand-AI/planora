// Text extraction for project documents: PDF (existing pdf-parse based extractor), DOCX (built-in
// ZIP + XML reader, no extra dependency) and plain text / Markdown. Everything else is refused with
// a message that says what to do instead. Only the extracted text is kept.

import { extractPdfText, PdfReadError } from '@/lib/parsers/pdf-parser'
import { extractDocxText, DocxReadError } from './docx'
import { textDensity, type PageText } from './chunk'
import { log, errorFields } from '@/lib/server/log'

export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024
export const MAX_DOCUMENT_CHARS = 2_000_000
export const MAX_PAGES = 1500
/** Below this many non-space characters per page a PDF is treated as scanned (no text layer). */
export const MIN_CHARS_PER_PAGE = 40

export type DocFormat = 'pdf' | 'docx' | 'txt' | 'md'

export class DocumentRejected extends Error {
  constructor(message: string, public code: string) { super(message) }
}

export function formatOf(fileName: string, head: Buffer): DocFormat {
  const ext = (/\.([a-z0-9]+)$/i.exec(fileName)?.[1] || '').toLowerCase()
  const isPdf = head.subarray(0, 5).toString('latin1') === '%PDF-'
  const isZip = head.length >= 4 && head.readUInt32LE(0) === 0x04034b50
  if (ext === 'pdf' || isPdf) {
    if (!isPdf) throw new DocumentRejected('This file has a .pdf name but is not a PDF.', 'not_pdf')
    return 'pdf'
  }
  if (ext === 'docx') {
    if (!isZip) throw new DocumentRejected('This file has a .docx name but is not a Word document.', 'not_docx')
    return 'docx'
  }
  if (ext === 'doc') throw new DocumentRejected('Old Word .doc files are not supported. Save the document as .docx or PDF in Word, then upload it.', 'unsupported_format')
  if (ext === 'txt' || ext === 'text') return 'txt'
  if (ext === 'md' || ext === 'markdown') return 'md'
  throw new DocumentRejected(`Unsupported file type "${ext ? '.' + ext : fileName}". Upload a PDF, Word (.docx), text (.txt) or Markdown (.md) document.`, 'unsupported_format')
}

/** UTF-8 text; refuses binary content that slipped in under a .txt name. */
function decodeText(buf: Buffer): string {
  const text = buf.toString('utf8').replace(/^﻿/, '')
  // eslint-disable-next-line no-control-regex
  const control = (text.match(/[\u0000-\u0008\u000e-\u001f]/g) || []).length
  if (control > Math.max(10, text.length * 0.01)) throw new DocumentRejected('This file does not look like plain text. Upload a PDF, Word (.docx), text or Markdown document.', 'not_text')
  return text
}

/** Extracts text page by page (pages are null for formats without pages). */
export async function extractDocument(buf: Buffer, fileName: string): Promise<{ format: DocFormat; pages: PageText[]; pageCount: number | null }> {
  if (!buf.length) throw new DocumentRejected('The file is empty.', 'empty')
  if (buf.length > MAX_DOCUMENT_BYTES) throw new DocumentRejected(`The file is larger than ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB. Split it (for example by specification section) and upload the parts.`, 'too_large')
  const format = formatOf(fileName, buf.subarray(0, 8))
  let pages: PageText[]
  let pageCount: number | null = null
  try {
    if (format === 'pdf') {
      const r = await extractPdfText(buf)
      pages = r.pages
      pageCount = r.pages.length
      if (pageCount > MAX_PAGES) throw new DocumentRejected(`The PDF has ${pageCount} pages; the limit is ${MAX_PAGES}. Split it and upload the parts.`, 'too_many_pages')
      if (textDensity(pages) < MIN_CHARS_PER_PAGE) {
        throw new DocumentRejected('This PDF has little or no selectable text, so it looks scanned (images of pages). Run it through OCR (for example "Recognize Text" in Acrobat) and upload the searchable PDF.', 'scanned_pdf')
      }
    } else if (format === 'docx') {
      pages = [{ page: null, text: extractDocxText(buf) }]
    } else {
      pages = [{ page: null, text: decodeText(buf) }]
    }
  } catch (err) {
    if (err instanceof DocumentRejected) throw err
    if (err instanceof PdfReadError || err instanceof DocxReadError) throw new DocumentRejected(err.message, 'unreadable')
    // Error name and message only (never document text).
    log('warn', 'document extraction failed', { format, ...errorFields(err) })
    throw new DocumentRejected('The document could not be read. Check that it opens on your computer, then upload it again.', 'unreadable')
  }
  const chars = pages.reduce((n, p) => n + p.text.length, 0)
  if (!pages.some(p => p.text.trim())) throw new DocumentRejected('No text was found in this document.', 'empty')
  if (chars > MAX_DOCUMENT_CHARS) throw new DocumentRejected(`The document has more than ${MAX_DOCUMENT_CHARS.toLocaleString('en-US')} characters of text. Split it and upload the parts.`, 'too_long')
  return { format, pages, pageCount }
}
