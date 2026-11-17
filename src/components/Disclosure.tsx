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
    <div id={id} className={tone === 'card' ? 'bg-white border border-warm-200 rounded-[14px]' : 'border-t border-warm-200'}>
      <button type="button" aria-expanded={open} aria-controls={pid} onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-2.5 text-left ${tone === 'card' ? 'px-5 py-4' : 'py-3.5'} group`}>
        <ChevronRight size={15} aria-hidden data-open={open} className="disclosure-chevron text-warm-400 group-hover:text-ink flex-shrink-0" />
        {/* The hint sits at the right while there is room, and drops under the title on a narrow screen instead of squeezing it. */}
        <span className="flex-1 min-w-0 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="text-[14px] font-medium text-ink tracking-[-0.01em]">{title}</span>
          {meta != null && <span className="text-[12px] text-warm-600 tabular-nums">{meta}</span>}
        </span>
      </button>
      <div id={pid} role="region" data-open={open} className="disclosure-panel" inert={!open || undefined}>
        <div className="disclosure-inner">
          <div className={tone === 'card' ? 'px-5 pb-5' : 'pb-4 pl-[25px]'}>{children}</div>
        </div>
      </div>
    </div>
  )
}
