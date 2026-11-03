'use client'

// Collapsible section with an animated reveal. The header is a real button (aria-expanded,
// aria-controls); the panel animates its height with CSS grid rows and fades its content, and
// both collapse to instant changes under prefers-reduced-motion (see globals.css).

import { useId, useState } from 'react'
import { ChevronRight } from 'lucide-react'

export function Disclosure({ title, meta, children, defaultOpen = false, tone = 'plain', id }: {
  title: React.ReactNode
  /** Small right-aligned hint, e.g. a count */
  meta?: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
  tone?: 'plain' | 'card'
  id?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const pid = useId()
  return (
    <div id={id} className={tone === 'card' ? 'bg-white/70 border border-warm-200 rounded-2xl' : 'border-t border-warm-200'}>
      <button type="button" aria-expanded={open} aria-controls={pid} onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-2.5 text-left ${tone === 'card' ? 'px-5 py-4' : 'py-3.5'} group`}>
        <ChevronRight size={15} aria-hidden data-open={open} className="disclosure-chevron text-warm-400 group-hover:text-navy-950 flex-shrink-0" />
        <span className="flex-1 text-[14px] font-medium text-navy-950 tracking-[-0.005em]">{title}</span>
        {meta != null && <span className="text-[12.5px] text-warm-500 tabular-nums">{meta}</span>}
      </button>
      <div id={pid} role="region" data-open={open} className="disclosure-panel" inert={!open || undefined}>
        <div className="disclosure-inner">
          <div className={tone === 'card' ? 'px-5 pb-5' : 'pb-4 pl-[25px]'}>{children}</div>
        </div>
      </div>
    </div>
  )
}
