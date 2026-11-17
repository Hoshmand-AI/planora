'use client'

// The plan's secondary numbers (forecast range, quality grade, DCMA, AI mode…), each with a short
// plain-language explanation, in a popover so the header can stay to one sentence and one date.
// Closes on Escape or a click outside; focus returns to the button.

import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

export interface NumberRow {
  key: string
  label: string
  value: React.ReactNode
  explain: React.ReactNode
  tone?: 'warn' | 'bad'
  go?: { label: string; onClick: () => void }
}

export function MoreNumbers({ rows, align = 'right' }: { rows: NumberRow[]; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const wrap = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus() } }
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown) }
  }, [open])
  return (
    <div ref={wrap} className="relative">
      <button ref={btn} type="button" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(o => !o)}
        className="pressable inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-body font-medium text-warm-600 hover:text-ink hover:bg-warm-100">
        More numbers <ChevronDown size={13} aria-hidden className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div id={id} role="region" aria-label="More numbers"
          className={`rise-in absolute z-40 mt-2 w-[min(calc(100vw-2rem),420px)] rounded-2xl border border-warm-200 bg-white shadow-[0_12px_40px_-12px_rgba(29,33,37,0.25)] p-2 max-h-[min(70vh,560px)] overflow-y-auto overscroll-contain ${align === 'right' ? 'right-0' : 'left-0'}`}>
          <ul className="divide-y divide-warm-200">
            {rows.map(r => (
              <li key={r.key} className="flex items-start gap-4 px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <div className="text-body font-medium text-ink">{r.label}</div>
                  <div className="text-caption text-warm-500 mt-0.5 leading-snug">{r.explain}</div>
                </div>
                <div className="text-right flex-shrink-0 max-w-[48%]">
                  <div className={`text-body font-semibold tabular-nums ${r.tone === 'bad' ? 'text-status-at-risk' : r.tone === 'warn' ? 'text-status-attention' : 'text-ink'}`}>{r.value}</div>
                  {r.go && <button type="button" onClick={() => { setOpen(false); r.go!.onClick() }} className="text-body text-accent-600 hover:underline mt-0.5">{r.go.label}</button>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
