'use client'

// An in-page replacement for the browser's prompt(): a small modal that asks for one line of text.
// `askText()` resolves to the text, or null when the person cancels. <AskTextHost /> is mounted once
// in the dashboard layout.

import { useEffect, useId, useRef, useState } from 'react'

export interface AskTextOptions {
  title: string
  /** Label of the text box */
  label: string
  placeholder?: string
  /** When true, an empty answer cannot be submitted */
  required?: boolean
  confirmLabel?: string
}

type Pending = AskTextOptions & { resolve: (v: string | null) => void }

let open: ((p: Pending) => void) | null = null

export function askText(opts: AskTextOptions): Promise<string | null> {
  return new Promise(resolve => {
    if (!open) { resolve(null); return }
    open({ ...opts, resolve })
  })
}

export function AskTextHost() {
  const [pending, setPending] = useState<Pending | null>(null)
  const [value, setValue] = useState('')
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const inputId = useId()
  // Where the press began: a text selection dragged out of the box and released on the backdrop is not a click on it.
  const downOnBackdrop = useRef(false)
  const pendingRef = useRef<Pending | null>(null)
  pendingRef.current = pending

  useEffect(() => {
    open = p => { setValue(''); setPending(prev => { prev?.resolve(null); return p }) }
    // Unmounted while open (a page change): answer the caller with "cancelled" instead of leaving it waiting.
    return () => { open = null; pendingRef.current?.resolve(null) }
  }, [])
  useEffect(() => {
    const d = ref.current
    if (pending && d && !d.open) d.showModal()
  }, [pending])

  const finish = (v: string | null) => {
    pending?.resolve(v)
    setPending(null)
    if (ref.current?.open) ref.current.close()
  }
  if (!pending) return null
  const text = value.trim()
  return (
    <dialog ref={ref} aria-labelledby={titleId} onCancel={e => { e.preventDefault(); finish(null) }}
      onMouseDown={e => { downOnBackdrop.current = e.target === ref.current }}
      onClick={e => { if (e.target === ref.current && downOnBackdrop.current) finish(null) }}
      className="rounded-xl border border-warm-200 bg-white p-0 w-[min(440px,calc(100vw-32px))] shadow-xl backdrop:bg-navy-950/40">
      <form className="p-5" onSubmit={e => { e.preventDefault(); if (pending.required && !text) return; finish(text) }}>
        <h2 id={titleId} className="text-[16px] font-semibold text-navy-950 mb-3">{pending.title}</h2>
        <label htmlFor={inputId} className="block text-[13px] text-warm-700 mb-1.5">{pending.label}</label>
        <input id={inputId} autoFocus value={value} onChange={e => setValue(e.target.value)} maxLength={500} placeholder={pending.placeholder}
          className="w-full border border-warm-300 rounded-md px-3 py-2 text-[16px] md:text-[14px] text-navy-950 placeholder:text-warm-500 focus:outline-none focus:ring-2 focus:ring-accent-500" />
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={() => finish(null)} className="px-4 py-2 rounded-full text-[14px] font-medium text-warm-700 hover:bg-warm-100">Cancel</button>
          <button type="submit" disabled={!!pending.required && !text} className="px-4 py-2 rounded-full text-[13px] font-semibold bg-accent-600 hover:bg-accent-700 text-white">{pending.confirmLabel ?? 'Save'}</button>
        </div>
      </form>
    </dialog>
  )
}
