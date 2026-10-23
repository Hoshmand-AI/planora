/**
 * Renders the small Markdown subset Planora's reports and Ask AI answers use (headings, paragraphs,
 * bullet and numbered lists, pipe tables, **bold**, _italic_ / *italic*, `code`) as React elements.
 * No HTML is ever injected: model output and document text stay plain text nodes.
 */
import { Fragment, type ReactNode } from 'react'
import { fmtDates } from '@/lib/format'

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  // **bold**, `code`, _italic_ or *italic* (single-word boundaries so snake_case and 5*3 stay as they are)
  const re = /\*\*([^*]+?)\*\*|`([^`]+?)`|(?<![\w*])_([^_\n]+?)_(?![\w])|(?<![\w*])\*([^*\n]+?)\*(?![\w*])/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const k = `${keyBase}-${i++}`
    if (m[1] !== undefined) out.push(<strong key={k} className="font-semibold text-navy-950">{inline(m[1], k)}</strong>)
    else if (m[2] !== undefined) out.push(<code key={k} className="font-mono text-[0.92em] bg-warm-200/60 rounded px-1">{m[2]}</code>)
    else out.push(<em key={k}>{inline(m[3] ?? m[4], k)}</em>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const cells = (row: string) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
const isTableSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l)

export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const lines = fmtDates(text).replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let para: string[] = []
  const flush = () => {
    if (para.length) { const k = `p${blocks.length}`; blocks.push(<p key={k}>{para.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l, `${k}-${j}`)}</Fragment>)}</p>) }
    para = []
  }
  while (i < lines.length) {
    const line = lines[i]
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (!line.trim()) { flush(); i++; continue }
    if (/^\s*```/.test(line)) {
      flush()
      const body: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) { body.push(lines[i]); i++ }
      i++
      blocks.push(<pre key={`c${blocks.length}`} className="whitespace-pre-wrap font-mono text-[12px] bg-warm-200/50 rounded-md p-3">{body.join('\n')}</pre>)
      continue
    }
    if (h) {
      flush()
      const k = `h${blocks.length}`
      const level = h[1].length
      const cls = level === 1 ? 'font-display text-[20px] text-navy-950 leading-snug' : level === 2 ? 'text-[16px] font-semibold text-navy-950 pt-2' : 'text-[14.5px] font-semibold text-navy-950'
      blocks.push(level === 1 ? <h3 key={k} className={cls}>{inline(h[2], k)}</h3> : level === 2 ? <h4 key={k} className={cls}>{inline(h[2], k)}</h4> : <h5 key={k} className={cls}>{inline(h[2], k)}</h5>)
      i++; continue
    }
    if (line.trim().startsWith('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flush()
      const head = cells(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(cells(lines[i])); i++ }
      const k = `t${blocks.length}`
      blocks.push(
        <div key={k} className="overflow-x-auto -mx-1 px-1" tabIndex={0} role="region" aria-label="Table (scrolls sideways)">
          <table className="min-w-full text-[12.5px] border-collapse">
            <thead><tr>{head.map((c, j) => <th key={j} scope="col" className="text-left font-semibold text-navy-950 border-b border-warm-300 px-2 py-1.5 align-bottom">{inline(c, `${k}-h${j}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri} className="border-b border-warm-200">{r.map((c, j) => <td key={j} className="px-2 py-1.5 align-top">{inline(c, `${k}-${ri}-${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      )
      continue
    }
    const bullet = /^\s*[-*•]\s+(.*)$/
    const numbered = /^\s*\d+[.)]\s+(.*)$/
    if (bullet.test(line) || numbered.test(line)) {
      flush()
      const ordered = numbered.test(line) && !bullet.test(line)
      const re = ordered ? numbered : bullet
      const items: string[] = []
      while (i < lines.length && re.test(lines[i])) { items.push(re.exec(lines[i])![1]); i++ }
      const k = `l${blocks.length}`
      const lis = items.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>)
      blocks.push(ordered ? <ol key={k} className="list-decimal ml-5 space-y-1">{lis}</ol> : <ul key={k} className="list-disc ml-5 space-y-1">{lis}</ul>)
      continue
    }
    para.push(line)
    i++
  }
  flush()
  return <div className={`space-y-3 break-words ${className}`}>{blocks}</div>
}
