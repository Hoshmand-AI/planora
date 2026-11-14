'use client'

// "Fill answers from a document": the user picks an RFP, scope of work, contract, specification or
// drawing set; RunF9 reads it (not stored) and proposes interview answers, each with the sentence and
// page it came from. The user ticks the ones to use; saved answers record that they came from the file.

import { useState } from 'react'
import { FileSearch, Loader2 } from 'lucide-react'
import { Disclosure } from '@/components/Disclosure'
import type { Answer } from '@/lib/planning/types'
import { PREFILL_QUESTIONS, type Proposal } from '@/lib/planning/prefill-labels'

export function DocumentPrefill({ planId, canWrite, onSave }: {
  planId: string; canWrite: boolean
  onSave: (answers: Record<string, Partial<Answer>>) => Promise<void>
}) {
  const [file, setFile] = useState<File | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState<{ proposals: Proposal[]; note: string | null; method: string; alreadyAnswered: string[] } | null>(null)
  const [pick, setPick] = useState<Record<string, boolean>>({})
  const [saved, setSaved] = useState('')
  // Bumped after saving so the file box is emptied along with the chosen file.
  const [inputKey, setInputKey] = useState(0)
  if (!canWrite) return null

  const read = async () => {
    if (!file) return
    setBusy(true); setErr(''); setResult(null); setSaved('')
    const fd = new FormData()
    fd.append('file', file)
    if (drawing) fd.append('drawing', 'true')
    try {
      const r = await fetch(`/api/plans/${planId}/prefill`, { method: 'POST', body: fd })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(d.error || 'The document could not be read.'); return }
      setResult(d)
      // Pre-tick the questions that are not answered yet.
      setPick(Object.fromEntries((d.proposals as Proposal[]).map(p => [p.questionId, !(d.alreadyAnswered as string[]).includes(p.questionId)])))
    } catch { setErr('The document could not be read. Check your connection and try again.') } finally { setBusy(false) }
  }

  const use = async () => {
    if (!result || !file) return
    const chosen = result.proposals.filter(p => pick[p.questionId])
    if (!chosen.length) return
    setBusy(true); setErr('')
    try {
      await onSave(Object.fromEntries(chosen.map(p => [p.questionId, {
        status: 'known' as const, value: p.value, source: 'file' as const,
        note: `From ${file.name}${p.page != null ? `, p.${p.page}` : ''}: "${p.quote.slice(0, 300)}"`,
      }])))
    } catch { setErr('The answers were not saved. Try again.'); return } finally { setBusy(false) }
    setSaved(`${chosen.length} answer${chosen.length === 1 ? '' : 's'} saved from ${file.name}.`)
    setResult(null); setFile(null); setInputKey(k => k + 1)
  }

  return (
    <div className="mb-4">
      <Disclosure tone="card" title={<span className="inline-flex items-center gap-2"><FileSearch size={15} aria-hidden className="text-accent-600" />Fill answers from a document</span>} meta="RFP, scope, contract, specs or drawings">
        <div className="space-y-3 text-[13.5px] text-warm-700">
          <p>RunF9 reads the document and proposes answers, each with the sentence and page it came from. The file is not stored. You choose which answers to use.</p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2">
              <span className="sr-only">Document</span>
              <input key={inputKey} type="file" accept=".pdf,.docx,.txt,.md" onChange={e => { setFile(e.target.files?.[0] ?? null); setResult(null); setErr('') }} className="text-[13px]" />
            </label>
            <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={drawing} onChange={e => setDrawing(e.target.checked)} /> It is a drawing set</label>
      <button type="button" onClick={read} disabled={!file || busy} className="pressable rounded-full bg-accent-600 hover:bg-accent-700 text-white px-4 py-1.5 text-[13px] font-semibold disabled:opacity-50">
              {busy && !result ? <><Loader2 size={13} className="inline animate-spin mr-1" aria-hidden />Reading…</> : 'Read document'}
            </button>
          </div>
          {err && <p role="alert" className="text-status-at-risk">{err}</p>}
          {saved && <p role="status" className="text-status-on-track">{saved}</p>}
          {result && (
            <div className="space-y-2">
              {result.note && <p className="text-[12.5px] text-warm-600">{result.note}</p>}
              {result.proposals.length === 0 ? <p>No interview answers were found in this document.</p> : (
                <fieldset className="space-y-2">
                  <legend className="font-semibold text-navy-950 mb-1">Proposed answers ({result.proposals.length})</legend>
                  {result.proposals.map(p => (
                    <label key={p.questionId} className="flex gap-2.5 items-start rounded-xl border border-warm-200 bg-white p-3">
                      <input type="checkbox" className="mt-1" checked={!!pick[p.questionId]} onChange={e => setPick(s => ({ ...s, [p.questionId]: e.target.checked }))} />
                      <span className="min-w-0">
                        <span className="block"><span className="text-warm-600">{PREFILL_QUESTIONS[p.questionId]}: </span><strong className="text-navy-950">{p.display}</strong>
                          {result.alreadyAnswered.includes(p.questionId) && <span className="ml-2 text-[12px] text-warm-600">(replaces your current answer)</span>}
                          {p.method === 'model' && <span className="ml-2 text-[12px] text-status-info">AI suggestion</span>}</span>
                        <span className="block text-[12.5px] text-warm-600 mt-0.5"><q>{p.quote}</q>{p.page != null ? ` p.${p.page}` : ''}</span>
                      </span>
                    </label>
                  ))}
                  <button type="button" onClick={use} disabled={busy || !Object.values(pick).some(Boolean)} className="pressable rounded-full bg-accent-600 hover:bg-accent-700 text-white px-4 py-2 text-[13px] font-semibold disabled:opacity-50">
                    Use selected answers
                  </button>
                </fieldset>
              )}
            </div>
          )}
        </div>
      </Disclosure>
    </div>
  )
}
