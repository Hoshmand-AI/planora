// A small, dependency-free XML reader (elements, attributes, text, CDATA, comments, processing
// instructions; no DTD expansion). Like the MS Project parser's regex helpers it needs no package,
// but it builds a tree so deeply nested formats (Primavera P6 XML) can be read safely. Namespace
// prefixes are dropped from element names. Malformed input throws an XmlError with a plain message.

export interface XNode {
  name: string
  attrs: Record<string, string>
  children: XNode[]
  /** Concatenated direct text content (decoded, untrimmed) */
  text: string
}

export class XmlError extends Error {}

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function safeCodePoint(n: number): string {
  try { return String.fromCodePoint(n) } catch { return '' }
}

const localName = (n: string) => n.slice(n.indexOf(':') + 1)

/** Parse a whole document; returns its root element. */
export function parseXmlTree(src: string): XNode {
  const text = src.replace(/^﻿/, '')
  const stack: XNode[] = []
  let root: XNode | null = null
  let i = 0
  const n = text.length
  while (i < n) {
    const lt = text.indexOf('<', i)
    const chunk = lt < 0 ? text.slice(i) : text.slice(i, lt)
    if (chunk) {
      if (stack.length) stack[stack.length - 1].text += decodeEntities(chunk)
      else if (chunk.trim()) throw new XmlError('Text outside the root element')
    }
    if (lt < 0) break
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4)
      if (end < 0) throw new XmlError('Unterminated comment')
      i = end + 3
    } else if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9)
      if (end < 0) throw new XmlError('Unterminated CDATA section')
      if (stack.length) stack[stack.length - 1].text += text.slice(lt + 9, end)
      i = end + 3
    } else if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt + 2)
      if (end < 0) throw new XmlError('Unterminated processing instruction')
      i = end + 2
    } else if (text.startsWith('<!', lt)) {
      // DOCTYPE (internal subsets are skipped, never expanded)
      let depth = 0, j = lt + 2
      for (; j < n; j++) {
        if (text[j] === '[') depth++
        else if (text[j] === ']') depth--
        else if (text[j] === '>' && depth <= 0) break
      }
      if (j >= n) throw new XmlError('Unterminated declaration')
      i = j + 1
    } else if (text[lt + 1] === '/') {
      const end = text.indexOf('>', lt)
      if (end < 0) throw new XmlError('Unterminated closing tag')
      const name = localName(text.slice(lt + 2, end).trim())
      const open = stack.pop()
      if (!open) throw new XmlError(`Unexpected closing tag </${name}>`)
      if (open.name !== name) throw new XmlError(`Closing tag </${name}> does not match <${open.name}>`)
      i = end + 1
    } else {
      // Start tag: find its end, honouring quoted attribute values.
      let j = lt + 1, quote = ''
      for (; j < n; j++) {
        const c = text[j]
        if (quote) { if (c === quote) quote = '' } else if (c === '"' || c === "'") quote = c
        else if (c === '>') break
      }
      if (j >= n) throw new XmlError('Unterminated start tag')
      let body = text.slice(lt + 1, j)
      const selfClosing = body.endsWith('/')
      if (selfClosing) body = body.slice(0, -1)
      const m = body.match(/^([^\s/>]+)/)
      if (!m) throw new XmlError('Element without a name')
      const node: XNode = { name: localName(m[1]), attrs: {}, children: [], text: '' }
      const attrRe = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g
      let a: RegExpExecArray | null
      const rest = body.slice(m[1].length)
      while ((a = attrRe.exec(rest)) !== null) node.attrs[localName(a[1])] = decodeEntities(a[3] ?? a[4] ?? '')
      if (stack.length) stack[stack.length - 1].children.push(node)
      else if (root) throw new XmlError('More than one root element')
      else root = node
      if (!selfClosing) stack.push(node)
      i = j + 1
    }
  }
  if (stack.length) throw new XmlError(`Element <${stack[stack.length - 1].name}> is not closed (file truncated?)`)
  if (!root) throw new XmlError('No XML element found')
  return root
}

/* ─── lookup helpers ───────────────────────────────────── */

export function child(n: XNode | null | undefined, name: string): XNode | undefined {
  return n?.children.find(c => c.name === name)
}

export function children(n: XNode | null | undefined, name: string): XNode[] {
  return n ? n.children.filter(c => c.name === name) : []
}

/** Trimmed text of a direct child element ('' when absent or empty). */
export function childText(n: XNode | null | undefined, name: string): string {
  return (child(n, name)?.text ?? '').trim()
}
