'use client'

// Small accessible building blocks shared by the account and organization pages.

import { useId, useState } from 'react'

export function Section({ title, description, children, tone = 'default', id }: { title: string; description?: React.ReactNode; children: React.ReactNode; tone?: 'default' | 'danger'; id?: string }) {
  const hid = useId()
  // A long description shows its first line; the rest is one press away. Cards used to open on a paragraph.
  const [more, setMore] = useState(false)
  // A written description shows its first sentence whole, never cut mid-clause; anything else folds to one line.
  const text = typeof description === 'string' ? description : null
  const cut = text ? text.search(/[.!?](\s|$)/) + 1 : 0
  const first = text && cut > 0 && cut < text.length ? text.slice(0, cut) : text
  const rest = text && first !== text ? text.slice(cut) : ''
  const long = text ? !!rest.trim() : !!description
  return (
    <section id={id} aria-labelledby={hid} className={`border rounded-lg p-5 bg-warm-50 ${tone === 'danger' ? 'border-status-at-risk/30' : 'border-warm-200'}`}>
      <h2 id={hid} className={`text-[15px] font-semibold mb-1 ${tone === 'danger' ? 'text-status-at-risk' : 'text-navy-950'}`}>{title}</h2>
      {description && (
        <div className="mb-4 flex items-start gap-2">
          <p className={`flex-1 min-w-0 text-[13px] text-warm-600 ${!text && long && !more ? 'line-clamp-1' : ''}`}>{text ? <>{first}{more && rest}</> : description}</p>
          {long && <button type="button" data-compact aria-expanded={more} onClick={() => setMore(v => !v)} className="flex-shrink-0 text-[12.5px] font-semibold text-accent-600 hover:underline">{more ? 'Less' : 'More'}</button>}
        </div>
      )}
      {children}
    </section>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: (props: { id: string; 'aria-describedby'?: string }) => React.ReactNode }) {
  const id = useId()
  const hintId = `${id}-hint`
  return (
    <div>
      <label htmlFor={id} className="block text-[12px] font-semibold uppercase tracking-wider text-warm-500 mb-1.5">{label}</label>
      {children({ id, 'aria-describedby': hint ? hintId : undefined })}
      {hint && <p id={hintId} className="text-[12px] text-warm-500 mt-1">{hint}</p>}
    </div>
  )
}

export const inputClass = 'w-full bg-white border border-warm-300 rounded-md px-3 py-2 text-[14px] text-warm-700 placeholder:text-warm-400'

/** The two pill buttons as class strings, for a button that cannot be the <Button> component (a link, a label). Same size and colours as <Button>. */
export const buttonClass = {
  primary: 'px-4 py-2 rounded-full bg-accent-600 hover:bg-accent-700 text-white text-[13px] font-semibold transition-colors',
  secondary: 'px-4 py-2 rounded-full border border-warm-300 bg-white text-navy-950 text-[13px] font-medium hover:bg-warm-100 transition-colors',
}

export function Button({ variant = 'primary', className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  const styles = {
    primary: 'bg-accent-600 text-white hover:bg-accent-700 font-semibold pressable shadow-sm',
    secondary: 'border border-warm-300 bg-white text-navy-950 hover:bg-warm-100 font-medium',
    danger: 'bg-status-at-risk text-white hover:opacity-90 font-semibold',
    ghost: 'text-accent-600 hover:underline font-medium px-1',
  }[variant]
  return <button {...props} className={`${variant === 'ghost' ? '' : 'px-4 py-2 rounded-full'} text-[13px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${styles} ${className}`} />
}

export function Alert({ tone, children }: { tone: 'error' | 'success' | 'info' | 'warning'; children: React.ReactNode }) {
  const styles = {
    error: 'bg-status-at-risk-bg border-status-at-risk text-status-at-risk',
    success: 'bg-status-on-track-bg border-status-on-track text-warm-700',
    info: 'bg-accent-100 border-accent-500 text-warm-700',
    warning: 'bg-status-attention-bg border-status-attention text-warm-700',
  }[tone]
  return <div role={tone === 'error' ? 'alert' : 'status'} className={`border-l-2 text-[13px] px-3 py-2 rounded-md ${styles}`}>{children}</div>
}

/** POST JSON and return { ok, data } without throwing. */
export async function postJson(url: string, body: unknown, method = 'POST'): Promise<{ ok: boolean; status: number; data: Record<string, unknown> & { error?: string } }> {
  try {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, data }
  } catch {
    return { ok: false, status: 0, data: { error: 'Network error. Check your connection and try again.' } }
  }
}

export function downloadJson(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
