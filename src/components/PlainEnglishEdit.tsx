'use client'

// "Describe the change": the scheduler writes what to change in plain English; RunF9 shows the exact
// edits it read (each clause, before → after, or why it could not be read) and the recalculated finish.
// Nothing changes until the scheduler gives a reason and applies; the applied change can be undone.

import { useState } from 'react'
import { MessageSquareText } from 'lucide-react'
import { fmtDate, fmtDates } from '@/lib/format'

export interface PreviewClause { text: string; method?: 'rules' | 'model'; what?: string; before?: string; after?: string; error?: string }
export interface EditPreview {
  clauses: PreviewClause[]
  /** Number of edits that would be applied */
  count: number
  finishBefore: string | null; finishAfter: string | null; finishDeltaDays: number | null
  details: string[]
  note: string | null
}

const input = 'border border-warm-300 rounded px-2 py-1 bg-white text-[13px] text-warm-700'
const primary = 'px-3 py-1.5 rounded-full bg-navy-950 text-white text-[13px] font-medium disabled:opacity-60'
const secondary = 'px-3 py-1.5 rounded-full border border-warm-300 text-navy-950 text-[13px] hover:bg-warm-100 disabled:opacity-60'

const shift = (d: number | null) => d == null ? '' : d === 0 ? 'no change' : `${Math.abs(d)} calendar day${Math.abs(d) === 1 ? '' : 's'} ${d > 0 ? 'later' : 'earlier'}`

export function PlainEnglishEdit({ id, examples, preview, apply, undo }: {
  id: string
  examples: string
  preview: (instruction: string) => Promise<EditPreview | { error: string }>
  /** Applies the previewed edits with the reason; returns an error or what was applied */
  apply: (reason: string) => Promise<{ error: string } | { done: string }>
  /** Undo of the change just applied (absent when the panel can't undo) */
  undo?: () => Promise<{ error: string } | { done: string }>
}) {
  const [text, setText] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [p, setP] = useState<EditPreview | null>(null)
  const [done, setDone] = useState('')
  const [canUndo, setCanUndo] = useState(false)

  const read = async () => {
    setBusy('read'); setErr(''); setDone(''); setP(null); setCanUndo(false)
    const r = await preview(text)
    setBusy('')
    if ('error' in r) { setErr(r.error); return }
    setP(r)
    if (!reason) setReason(text.slice(0, 300))
  }
  const go = async () => {
    setBusy('apply'); setErr('')
    const r = await apply(reason)
    setBusy('')
    if ('error' in r) { setErr(r.error); return }
    setDone(r.done); setP(null); setText(''); setReason(''); setCanUndo(!!undo)
  }
  const back = async () => {
    if (!undo) return
    setBusy('undo'); setErr('')
    const r = await undo()
    setBusy('')
    if ('error' in r) { setErr(r.error); return }
    setDone(r.done); setCanUndo(false)
  }

  return (
    <div className="border border-warm-200 rounded-lg p-3 space-y-2 bg-white">
      <label htmlFor={`pe-${id}`} className="flex items-center gap-2 font-semibold text-navy-950"><MessageSquareText size={15} aria-hidden className="text-accent-600" />Describe the change</label>
      <p className="text-[12.5px] text-warm-600">Write it the way you would say it. RunF9 shows the exact edits and the new finish first; nothing changes until you apply. {examples}</p>
      <textarea id={`pe-${id}`} value={text} onChange={e => { setText(e.target.value); setP(null) }} rows={2} maxLength={2000} className={`${input} w-full`} placeholder="e.g. extend A1030 by 5 days; start A1070 3 days after A1060 starts" />
      <button type="button" onClick={read} disabled={busy !== '' || text.trim().length < 4} className={secondary}>{busy === 'read' ? 'Reading…' : 'Preview change'}</button>

      {p && (
        <div className="space-y-2" aria-live="polite">
          <ul className="space-y-1.5">
            {p.clauses.map((c, i) => (
              <li key={i} className="rounded border border-warm-200 p-2 text-[12.5px]">
                <span className="block text-warm-600">“{c.text}”</span>
                {c.error ? <span className="block text-status-at-risk">Not applied: {c.error}</span>
                  : <span className="block text-navy-950"><strong>{fmtDates(c.what ?? '')}</strong>{c.before != null && <> · {fmtDates(c.before)} → {fmtDates(c.after ?? '')}</>}{c.method === 'model' && <span className="ml-2 text-[12px] text-status-info">read by AI, check it</span>}</span>}
              </li>
            ))}
          </ul>
          {p.count > 0 ? (
            <>
              <p className="text-[13px] text-navy-950">Finish {fmtDate(p.finishBefore ?? '')} → <strong>{fmtDate(p.finishAfter ?? '')}</strong> ({shift(p.finishDeltaDays)})</p>
              {p.details.map((d, i) => <p key={i} className="text-[12.5px] text-warm-600">{fmtDates(d)}</p>)}
              <label className="block text-[12px] text-warm-600">Reason (required, kept with each edit and in the audit log)
                <input value={reason} onChange={e => setReason(e.target.value)} className={`${input} block mt-0.5 w-full`} />
              </label>
              <button type="button" onClick={go} disabled={busy !== '' || reason.trim().length < 5} className={primary}>{busy === 'apply' ? 'Applying…' : `Apply ${p.count} edit${p.count === 1 ? '' : 's'}`}</button>
            </>
          ) : <p className="text-[12.5px] text-warm-600">Nothing to apply.</p>}
          {p.note && <p className="text-[12.5px] text-warm-600">{p.note}</p>}
        </div>
      )}
      {done && <p role="status" className="text-status-on-track text-[13px]">{fmtDates(done)}{canUndo && <> <button type="button" onClick={back} disabled={busy !== ''} className="ml-1 text-accent-600 underline">{busy === 'undo' ? 'Undoing…' : 'Undo this change'}</button></>}</p>}
      {err && <p role="alert" className="text-status-at-risk text-[13px]">{err}</p>}
    </div>
  )
}
