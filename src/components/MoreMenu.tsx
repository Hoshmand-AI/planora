'use client'

// A small "more actions" menu: a three-dot button that opens a short list. Used where a page has one
// main action and a few rare or destructive ones, so those do not sit beside it at equal weight.
// Escape and a click outside close it; the arrow keys move between items; focus returns to the button.

import { useEffect, useId, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'

export interface MoreMenuItem {
  label: string
  onSelect: () => void
  icon?: React.ReactNode
  /** Shown in the at-risk colour, below a divider: an action that removes something. */
  danger?: boolean
  /** Extra classes for the item, e.g. `md:hidden` when a button already shows this action on wide screens. */
  className?: string
}

export function MoreMenu({ label, items }: { label: string; items: MoreMenuItem[] }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus() } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    // Put focus on the first action, so the keyboard lands inside the menu.
    wrap.current?.querySelector<HTMLElement>('[role="menuitem"]:not(.hidden)')?.focus()
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const move = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const all = [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])].filter(el => el.offsetParent !== null)
    const at = all.indexOf(document.activeElement as HTMLElement)
    all[(at + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus()
  }

  return (
    <div ref={wrap} className="relative flex-shrink-0">
      <button ref={button} type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(o => !o)}
        className="pressable inline-flex items-center justify-center w-10 h-10 rounded-full border border-warm-300 bg-white text-navy-950 hover:bg-warm-100">
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
      {open && (
        <div id={id} role="menu" aria-label={label} onKeyDown={move}
          className="absolute right-0 top-full mt-2 z-30 min-w-[220px] rounded-xl border border-warm-200 bg-white p-1.5 shadow-[0_1px_2px_rgb(6_20_27/0.06),0_18px_40px_-18px_rgb(6_20_27/0.35)]">
          {items.map(it => (
            <button key={it.label} type="button" role="menuitem" onClick={() => { setOpen(false); it.onSelect() }}
              className={`w-full flex items-center gap-2.5 rounded-lg px-3 min-h-[44px] text-left text-[14px] font-medium hover:bg-warm-100 ${it.danger ? 'text-status-at-risk' : 'text-navy-950'} ${it.className ?? ''}`}>
              {it.icon}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
