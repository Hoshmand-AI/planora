// Minimal, dependency-free DOCX text extraction: a DOCX is a ZIP archive whose body is
// word/document.xml. We read the ZIP central directory, inflate that one entry with Node's zlib, and
// turn <w:p> paragraphs into lines (heading styles become Markdown-style "#" headings so the chunker
// keeps them as section anchors). Macros, embedded objects and images are ignored.

import { inflateRawSync } from 'zlib'

export class DocxReadError extends Error {}

const MAX_XML_BYTES = 40 * 1024 * 1024

/** Reads one entry from a ZIP archive (stored or deflated). Returns null when the entry is absent. */
export function readZipEntry(buf: Buffer, name: string): Buffer | null {
  // End of central directory: signature 0x06054b50 within the last 64 KiB + 22 bytes.
  const min = Math.max(0, buf.length - 65_557)
  let eocd = -1
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new DocxReadError('This file is not a valid .docx (ZIP) document.')
  const entries = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new DocxReadError('This .docx file is damaged (bad central directory).')
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const size = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const entryName = buf.toString('utf8', p + 46, p + 46 + nameLen)
    if (entryName === name) {
      if (size > MAX_XML_BYTES) throw new DocxReadError('This .docx document is too large to index.')
      if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) throw new DocxReadError('This .docx file is damaged (bad local header).')
      const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28)
      const data = buf.subarray(start, start + compSize)
      if (method === 0) return Buffer.from(data)
      if (method === 8) return inflateRawSync(data, { maxOutputLength: MAX_XML_BYTES })
      throw new DocxReadError('This .docx uses an unsupported compression method.')
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  return null
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
  if (e[0] === '#') {
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''
  }
  return ENTITIES[e.toLowerCase()] ?? ''
})

/** Paragraph text from word/document.xml. Heading paragraphs are prefixed with "#"s. */
export function docxXmlToText(xml: string): string {
  const out: string[] = []
  const paras = xml.match(/<w:p[\s>][\s\S]*?<\/w:p>|<w:p\/>/g) || []
  for (const p of paras) {
    const style = /<w:pStyle\s+w:val="([^"]+)"/.exec(p)?.[1] || ''
    const level = /^(?:Heading|heading)\s*(\d)$/.exec(style)?.[1] ?? (/^Title$/i.test(style) ? '1' : null)
    let text = ''
    for (const m of p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g)) {
      if (m[1] !== undefined) text += decode(m[1])
      else text += m[0] === '<w:tab/>' ? '\t' : '\n'
    }
    text = text.replace(/[ \t]+$/gm, '')
    if (!text.trim()) { out.push(''); continue }
    out.push(level ? `${'#'.repeat(Math.min(Number(level), 6))} ${text.trim()}` : text)
    out.push('')
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function extractDocxText(buf: Buffer): string {
  let xml: Buffer | null
  try {
    xml = readZipEntry(buf, 'word/document.xml')
  } catch (err) {
    if (err instanceof DocxReadError) throw err
    throw new DocxReadError('This .docx file could not be read. It may be damaged; try saving it again from Word.')
  }
  if (!xml) throw new DocxReadError('This file is a ZIP archive but not a Word .docx document.')
  return docxXmlToText(xml.toString('utf8'))
}
