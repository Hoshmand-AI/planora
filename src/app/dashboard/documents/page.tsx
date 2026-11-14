'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { digitsFont } from '@/app/fonts/digits'
import { Loader2, Search, ShieldAlert, Trash2, Upload, X } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { MoreMenu } from '@/components/MoreMenu'
import { FileSourcePicker } from '@/components/FileSourcePicker'
import { useApp } from '../layout'
import { Alert, Button, Field, Section, inputClass, postJson } from '@/components/ui'
import { askText } from '@/components/AskText'
import { fmtDay } from '@/lib/format'
import { formatMb, tooLargeMessage } from '@/lib/upload-limit'

interface Doc {
  id: string; scope: 'project' | 'org'; title: string; fileName: string; format: string; docType: string; trust: 'approved' | 'unreviewed'
  classification: string | null; sizeBytes: number; pageCount: number | null; chunkCount: number; flaggedCount: number; readBy?: 'text' | 'ai_vision'
  uploadedByName: string | null; createdAt: string; reviewedAt: string | null; anchorName?: string | null; anchorVersion?: string | null; scheduleId: string | null
}
interface Listing { documents: Doc[]; docTypes: { id: string; label: string }[]; limits: { maxBytes: number }; classification: string | null; cuiWarning?: string }
interface Hit {
  chunkId: string; documentId: string; title: string; trust: string; scope: string; section: string | null; heading: string | null
  page: number | null; citation: string; text: string; tier: number; tierLabel: string; flagged: boolean; flagReasons: string[]
}
interface Candidate {
  key: string; kind: string; label: string; value: string; quote: string; documentId: string; documentTitle: string; citation: string
  fromFlaggedPassage: boolean; documentTrust: string; review: { status: string; createdAt: string } | null
}

const passages = (n: number) => `${n} passage${n === 1 ? '' : 's'}`
const badge = 'inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-semibold'
const TrustBadge = ({ trust }: { trust: string }) => trust === 'approved'
  ? <span className={`${badge} bg-status-on-track-bg border-status-on-track/40 text-status-on-track`}>Approved</span>
  : <span className={`${badge} bg-status-attention-bg border-status-attention/40 text-status-attention`}>Unreviewed</span>

const ADD_WAYS = [{ id: 'file', label: 'Upload a file' }, { id: 'paste', label: 'Paste text' }, { id: 'inbox', label: 'Connect an inbox' }] as const

export default function DocumentsPage() {
  const { selectedSchedule, can, openUpload } = useApp()
  const [data, setData] = useState<Listing | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; text: string } | null>(null)
  const [requirements, setRequirements] = useState<Candidate[] | null>(null)
  const [addWay, setAddWay] = useState<'file' | 'paste' | 'inbox'>('file')
  // With documents already here, adding one is a dialog over the library, so the page is the library and not a form.
  const [adding, setAdding] = useState(false)
  const addClose = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!adding) return
    addClose.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAdding(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [adding])
  const base = selectedSchedule ? `/api/schedules/${encodeURIComponent(selectedSchedule.id)}/documents` : ''

  // Only the newest request may land: a slow answer for one project must never be listed under another.
  const seq = useRef(0)
  const load = useCallback(async () => {
    if (!base) return
    const mine = ++seq.current
    setError('')
    try {
      const [l, r] = await Promise.all([fetch(base), fetch(`${base}/requirements`)])
      const ld = await l.json().catch(() => ({}))
      if (mine !== seq.current) return
      if (!l.ok) { setError(ld.error || 'Could not load documents.'); return }
      setData(ld)
      const rd = await r.json().catch(() => ({}))
      if (mine !== seq.current) return
      setRequirements(r.ok ? rd.requirements : [])
    } catch { if (mine === seq.current) setError('Network error. Check your connection and try again.') }
  }, [base])
  useEffect(() => { setData(null); setRequirements(null); load() }, [load])

  if (!selectedSchedule) {
    return (
      <EmptyState title="Select a project to see its documents" action={{ label: can('schedule.write') ? 'Upload a schedule' : 'Build a schedule', onClick: openUpload }}>
        Contracts, scheduling specifications and owner requirements are kept with each project.
      </EmptyState>
    )
  }

  const setTrust = async (d: Doc, trust: 'approved' | 'unreviewed') => {
    const r = await postJson(`${base}/${d.id}`, { trust }, 'PATCH')
    setNotice(r.ok ? { tone: 'success', text: trust === 'approved' ? `"${d.title}" is approved for AI grounding.` : `"${d.title}" is marked unreviewed.` } : { tone: 'error', text: r.data.error || 'Could not change the document.' })
    load()
  }
  const remove = async (d: Doc) => {
    if (!window.confirm(`Delete "${d.title}"? Its text and search index are removed immediately. This can't be undone.`)) return
    const r = await postJson(`${base}/${d.id}`, {}, 'DELETE')
    setNotice(r.ok ? { tone: 'success', text: `"${d.title}" was deleted with its ${passages(Number(r.data.passagesDeleted))}.` } : { tone: 'error', text: r.data.error || 'Could not delete the document.' })
    load()
  }

  const hasDocs = !!data?.documents.length
  const libraryBlock = (
    <>
      <Section title="Documents" description="New documents start unreviewed. An admin or reviewer approves a document before AI answers rely on it by default.">
        {!data ? <p className="text-[13px] text-warm-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Loading…</p>
          : !data.documents.length ? <p className="text-[13px] text-warm-500">No documents yet.{can('schedule.write') ? ' Upload the contract or the scheduling specification to get started.' : ''}</p>
          : (
            <ul className="divide-y divide-warm-200">
              {data.documents.map(d => (
                <li key={d.id} className="py-3 flex flex-col md:flex-row md:items-start gap-2 md:gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-semibold text-navy-950 break-words">{d.title}</span>
                      <TrustBadge trust={d.trust} />
                      {d.scope === 'org' && <span className={`${badge} bg-accent-100 border-accent-500/40 text-warm-700`}>Organization standard</span>}
                      {d.classification && d.classification !== 'unclassified' && <span className={`${badge} bg-status-at-risk-bg border-status-at-risk/40 text-status-at-risk`}>{d.classification.toUpperCase()}</span>}
                    </div>
                    <div className="text-[12px] text-warm-500 mt-0.5">
                      {data.docTypes.find(t => t.id === d.docType)?.label ?? d.docType} · {d.format.toUpperCase()}{d.pageCount ? ` · ${d.pageCount} pages` : ''} · {passages(d.chunkCount)} · added {fmtDay(d.createdAt)}{d.uploadedByName ? ` by ${d.uploadedByName}` : ''}
                      {d.scope === 'project' && d.anchorName && d.scheduleId !== selectedSchedule.id ? ` · attached to ${d.anchorName}${d.anchorVersion ? ` (${d.anchorVersion})` : ''}` : ''}
                    </div>
                    {d.readBy === 'ai_vision' && (
                      <p className="mt-1 text-[12px] text-status-info">Text read by AI from the page images (scanned pages or drawing sheets): check it against the file before relying on it.</p>
                    )}
                    {d.flaggedCount > 0 && (
                      <p className="mt-1 text-[12px] text-status-attention flex items-center gap-1"><ShieldAlert size={13} aria-hidden="true" /> {d.flaggedCount} passage{d.flaggedCount === 1 ? '' : 's'} contain{d.flaggedCount === 1 ? 's' : ''} instruction-like text and {d.flaggedCount === 1 ? 'is' : 'are'} never sent to AI.</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Approving is the action a new document waits for, so it is the visible button. Withdrawing an approval
                        and deleting are rare, so they sit in the menu. */}
                    {(() => {
                      const scoped = d.scope === 'project' || can('org.manage')
                      const review = can('plan.review') && scoped, write = can('schedule.write') && scoped
                      const items = [
                        ...(review && d.trust === 'approved' ? [{ label: 'Mark unreviewed', onSelect: () => setTrust(d, 'unreviewed') }] : []),
                        ...(write ? [{ label: 'Delete this document', onSelect: () => remove(d), icon: <Trash2 size={15} aria-hidden="true" />, danger: true }] : []),
                      ]
                      return (
                        <>
                          {review && d.trust !== 'approved' && <Button onClick={() => setTrust(d, 'approved')} aria-label={`Approve ${d.title}`}>Approve</Button>}
                          {items.length > 0 && <MoreMenu label={`More actions for ${d.title}`} items={items} />}
                        </>
                      )
                    })()}
                  </div>
                </li>
              ))}
            </ul>
          )}
      </Section>

      {data && data.documents.length > 0 && <SearchPanel base={base} unreviewed={data.documents.filter(d => d.trust === 'unreviewed').length} />}

      {requirements && requirements.length > 0 && (
        <Requirements base={base} items={requirements} canDecide={can('schedule.write')} onChange={setRequirements} onError={t => setNotice({ tone: 'error', text: t })} />
      )}
    </>
  )

  return (
    <div className="max-w-6xl mx-auto px-5 md:px-8 py-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
        <h2 className="sr-only">Documents</h2>
        <p className="text-[13.5px] text-warm-500 max-w-[720px] max-md:line-clamp-2">
          Contracts, specifications and owner requirements, shared with every update of this project. RunF9 keeps the extracted text only, not the original file.
        </p>
        </div>
        {hasDocs && can('schedule.write') && <button type="button" onClick={() => setAdding(true)} className="pressable inline-flex items-center gap-1.5 rounded-full bg-accent-600 hover:bg-accent-700 text-white text-[13.5px] font-semibold px-4 min-h-[40px]"><Upload size={14} aria-hidden="true" /> Add a document</button>}
      </div>

      {data?.cuiWarning && <Alert tone="info">{data.cuiWarning}</Alert>}
      {(data?.classification === 'cui' || data?.classification === 'classified') && (
        <Alert tone="warning">This project is marked {data.classification === 'cui' ? 'CUI' : 'classified'}. Its documents are never sent to a cloud AI model; you get the matching passages with citations instead.</Alert>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      <div aria-live="polite">{notice && <Alert tone={notice.tone}>{notice.text}</Alert>}</div>

      {/* A project that already has documents opens on them; the ways to add more follow. An empty one opens on adding. */}
      {hasDocs && libraryBlock}
      {can('schedule.write') && data && (!hasDocs || adding) && ((block: React.ReactNode) => (hasDocs ? createPortal(block, document.body) : block))(
        <div className={hasDocs ? `${digitsFont.variable} font-sans fixed inset-0 z-50 overflow-y-auto bg-navy-950/45 p-3 md:p-8 flex justify-center items-start` : ''} onMouseDown={e => { if (hasDocs && e.target === e.currentTarget) setAdding(false) }}>
        <div id="upload-documents" role={hasDocs ? 'dialog' : undefined} aria-modal={hasDocs ? true : undefined} aria-labelledby={hasDocs ? 'add-h' : undefined}
          className={hasDocs ? 'relative w-full max-w-3xl rounded-2xl bg-warm-50 border border-warm-200 p-5 md:p-6 space-y-5 shadow-[0_24px_60px_-20px_rgb(6_20_27/0.45)]' : 'space-y-5 scroll-mt-4'}>
          {hasDocs && <button ref={addClose} type="button" onClick={() => setAdding(false)} aria-label="Close" className="absolute right-3 top-3 inline-flex items-center justify-center w-10 h-10 rounded-full text-navy-950 hover:bg-warm-200"><X size={18} aria-hidden="true" /></button>}
          {/* With documents already here, the three ways to add more are tabs, so the page does not end in four stacked forms. */}
          {hasDocs && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pr-10">
              <h2 id="add-h" className="text-[17px] font-semibold tracking-[-0.01em] text-navy-950">Add to this project</h2>
              <div role="tablist" aria-labelledby="add-h" className="flex flex-wrap gap-1.5">
                {ADD_WAYS.map(w => (
                  <button key={w.id} role="tab" type="button" aria-selected={addWay === w.id} onClick={() => setAddWay(w.id)}
                    className={`pressable px-3 py-1.5 rounded-lg text-[13.5px] font-semibold ${addWay === w.id ? 'bg-navy-900 text-white' : 'text-warm-700 hover:bg-warm-200 hover:text-navy-950'}`}>{w.label}</button>
                ))}
              </div>
            </div>
          )}
          <div hidden={hasDocs && addWay === 'inbox'} className="space-y-5">
            <UploadForm base={base} data={data} canOrg={can('org.manage')} show={hasDocs ? (addWay === 'paste' ? 'paste' : 'file') : 'both'} onDone={(n) => { setNotice(n); if (n.tone !== 'error') setAdding(false); load() }} />
          </div>
          <div hidden={hasDocs && addWay !== 'inbox'} className="space-y-5">
            <ProjectInbox base={base.replace(/\/documents$/, '')} onReceived={load} />
            <ProjectMailbox base={base.replace(/\/documents$/, '')} onReceived={load} />
          </div>
        </div>
        </div>
      )}
      {!hasDocs && libraryBlock}
    </div>
  )
}

function UploadForm({ base, data, canOrg, onDone, show = 'both' }: { base: string; data: Listing; canOrg: boolean; show?: 'both' | 'file' | 'paste'; onDone: (n: { tone: 'success' | 'warning' | 'error'; text: string }) => void }) {
  const [title, setTitle] = useState('')
  const [docType, setDocType] = useState('scheduling_spec')
  const [orgStandard, setOrgStandard] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const orgId = useId()

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setBusy(true)
    // file or sourceConnectionId + sourceKey, and keepIn, come from FileSourcePicker's fields.
    const fd = new FormData(e.currentTarget)
    fd.set('title', title)
    fd.set('docType', docType)
    if (orgStandard) fd.set('scope', 'org')
    try {
      const res = await fetch(base, { method: 'POST', body: fd })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) onDone({ tone: 'error', text: d.error || (res.status === 413 ? tooLargeMessage('document', data.limits.maxBytes) : 'Upload failed.') })
      else {
        onDone(d.warning ? { tone: 'warning', text: `"${d.document.title}" was added (${passages(d.document.chunkCount)}). ${d.warning}` } : { tone: 'success', text: `"${d.document.title}" was added (${passages(d.document.chunkCount)}). It is unreviewed until an admin or reviewer approves it.` })
        setTitle(''); setOrgStandard(false); setFormKey(k => k + 1)
      }
    } catch { onDone({ tone: 'error', text: 'Network error. Check your connection and try again.' }) }
    setBusy(false)
  }

  // Emails, meeting notes and field reports are usually pasted, not saved as files: send the text as a .txt.
  const [pasted, setPasted] = useState('')
  const [pasteTitle, setPasteTitle] = useState('')
  const [pasteType, setPasteType] = useState('email')
  const pasteTypes = data.docTypes.filter(t => ['email', 'meeting', 'daily_report'].includes(t.id))
  const submitPaste = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setBusy(true)
    const name = (pasteTitle.trim() || `${pasteTypes.find(t => t.id === pasteType)?.label ?? 'Note'} ${fmtDay(new Date().toISOString())}`).slice(0, 150)
    const fd = new FormData()
    fd.set('file', new File([pasted], `${name.replace(/[^\w .-]+/g, ' ').trim() || 'note'}.txt`, { type: 'text/plain' }))
    fd.set('title', name)
    fd.set('docType', pasteType)
    try {
      const res = await fetch(base, { method: 'POST', body: fd })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) onDone({ tone: 'error', text: d.error || 'The text was not added.' })
      else { onDone({ tone: d.warning ? 'warning' : 'success', text: `"${d.document.title}" was added (${passages(d.document.chunkCount)}). Anything in it that affects the schedule shows on the Today tab, quoted with its source.${d.warning ? ` ${d.warning}` : ''}` }); setPasted(''); setPasteTitle('') }
    } catch { onDone({ tone: 'error', text: 'Network error. Check your connection and try again.' }) }
    setBusy(false)
  }

  return (
    <>
    {pasteTypes.length > 0 && (
      <div hidden={show === 'file'}>
      <Section title="Paste an email, meeting notes or a field report" description="RunF9 reads it for delays, changes, risks and commitments, ties them to activities, and shows them on the Today tab with the sentence quoted. Nothing is sent to an AI model for this.">
        <form onSubmit={submitPaste} className="grid md:grid-cols-2 gap-3">
          <Field label="Title" hint="Defaults to the type and today’s date.">{p => <input {...p} value={pasteTitle} maxLength={150} onChange={e => setPasteTitle(e.target.value)} className={inputClass} placeholder="e.g. OAC meeting 11/10 minutes" />}</Field>
          <Field label="What it is">{p => (
            <select {...p} value={pasteType} onChange={e => setPasteType(e.target.value)} className={inputClass}>
              {pasteTypes.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          )}</Field>
          <div className="md:col-span-2">
            <Field label="Text">{p => <textarea {...p} value={pasted} onChange={e => setPasted(e.target.value)} rows={6} className={inputClass} placeholder="Paste the email thread, the minutes or transcript, or the daily report here." />}</Field>
          </div>
          <div className="md:col-span-2"><Button type="submit" disabled={busy || pasted.trim().length < 20}>{busy ? 'Reading…' : 'Add to this project'}</Button></div>
        </form>
      </Section>
      </div>
    )}
    <div hidden={show === 'paste'}>
    <Section title="Add a document" description={`PDF with selectable text, Word (.docx), text or Markdown, a saved email (.eml) or a meeting transcript from Teams, Zoom or Meet (.vtt, .srt), up to ${formatMb(data.limits.maxBytes)}. Scanned PDFs need OCR first.`}>
      <form key={formKey} onSubmit={submit} className="grid md:grid-cols-2 gap-3">
        <div className="md:col-span-2">
          <FileSourcePicker accept=".pdf,.docx,.txt,.md,.eml,.vtt,.srt" canManage={canOrg} keepValue="none" keepLabel="Not kept (RunF9 keeps only the extracted text)" inputClassName={inputClass} />
        </div>
        <Field label="Title" hint="Defaults to the file name.">{p => <input {...p} value={title} maxLength={160} onChange={e => setTitle(e.target.value)} className={inputClass} placeholder="e.g. Section 01 32 16 Construction Progress Schedule" />}</Field>
        <Field label="Document type">{p => (
          <select {...p} value={docType} onChange={e => setDocType(e.target.value)} className={inputClass}>
            {data.docTypes.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        )}</Field>
        {canOrg && (
          <div className="flex items-end">
            <label htmlFor={orgId} className="flex items-start gap-2 text-[13px] text-warm-700">
              <input id={orgId} type="checkbox" checked={orgStandard} onChange={e => setOrgStandard(e.target.checked)} className="mt-0.5" />
              <span>Organization standard (applies to every project of the organization)</span>
            </label>
          </div>
        )}
        <div className="md:col-span-2">
          <Button type="submit" disabled={busy}>{busy ? <><Loader2 size={13} className="inline animate-spin -mt-0.5" aria-hidden="true" /> Reading the document…</> : <><Upload size={13} className="inline -mt-0.5" aria-hidden="true" /> Upload</>}</Button>
        </div>
      </form>
    </Section>
    </div>
    </>
  )
}

function SearchPanel({ base, unreviewed }: { base: string; unreviewed: number }) {
  const [q, setQ] = useState('')
  const [includeUnreviewed, setIncludeUnreviewed] = useState(false)
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inc = useId()

  const run = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!q.trim()) return
    setBusy(true); setError('')
    const r = await postJson(`${base}/search`, { query: q, includeUnreviewed })
    if (r.ok) setHits((r.data.results as Hit[]) || [])
    else setError(r.data.error || 'Search failed.')
    setBusy(false)
  }

  return (
    <Section title="Search the documents" description="Ranked passages with citations. Approved project documents come first, then organization standards, then unreviewed contracts and owner requirements.">
      <form onSubmit={run} role="search" className="flex flex-col md:flex-row gap-2 md:items-end">
        <div className="flex-1">
          <Field label="Search">{p => <input {...p} type="search" value={q} onChange={e => setQ(e.target.value)} className={inputClass} placeholder='e.g. maximum activity duration, "float shall not", liquidated damages' />}</Field>
        </div>
        <Button type="submit" disabled={busy || !q.trim()}>{busy ? <Loader2 size={13} className="inline animate-spin -mt-0.5" aria-hidden="true" /> : <Search size={13} className="inline -mt-0.5" aria-hidden="true" />} Search</Button>
      </form>
      {unreviewed > 0 && (
        <label htmlFor={inc} className="mt-2 flex items-center gap-2 text-[13px] text-warm-700">
          <input id={inc} type="checkbox" checked={includeUnreviewed} onChange={e => setIncludeUnreviewed(e.target.checked)} />
          Include {unreviewed} unreviewed document{unreviewed === 1 ? '' : 's'} (labelled in the results)
        </label>
      )}
      {error && <div className="mt-3"><Alert tone="error">{error}</Alert></div>}
      <div aria-live="polite" className="mt-3">
        {hits && !hits.length && <p className="text-[13px] text-warm-500">No passage matched.{unreviewed > 0 && !includeUnreviewed ? ' Unreviewed documents were not searched.' : ''}</p>}
        {hits && hits.length > 0 && (
          <ol className="space-y-3">
            {hits.map(h => (
              <li key={h.chunkId} className={`border rounded-md p-3 ${h.flagged ? 'border-status-attention bg-status-attention-bg' : 'border-warm-200 bg-warm-100'}`}>
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-[13px] font-semibold text-navy-950">{h.citation}</span>
                  <span className="text-[12px] text-warm-500">{h.tierLabel}</span>
                  {h.trust !== 'approved' && <TrustBadge trust={h.trust} />}
                </div>
                {h.flagged && (
                  <p className="text-[12px] text-warm-700 mb-1 flex items-start gap-1"><ShieldAlert size={13} className="mt-0.5 shrink-0 text-status-attention" aria-hidden="true" />
                    <span><strong>Caution:</strong> this passage contains text that reads like instructions to an AI ({h.flagReasons.join('; ')}). It is never sent to a model. Check the source document.</span></p>
                )}
                {h.heading && !h.text.slice(0, 200).includes(h.heading) && <div className="text-[12px] font-medium text-warm-600">{h.heading}</div>}
                <p className="text-[13px] text-warm-700 whitespace-pre-wrap break-words">{h.text}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Section>
  )
}

function Requirements({ base, items, canDecide, onChange, onError }: { base: string; items: Candidate[]; canDecide: boolean; onChange: (c: Candidate[]) => void; onError: (t: string) => void }) {
  const decide = async (c: Candidate, status: 'confirmed' | 'dismissed') => {
    const r = await postJson(`${base}/requirements`, { documentId: c.documentId, key: c.key, status })
    if (r.ok) onChange(r.data.requirements as Candidate[])
    else onError(r.data.error || 'Could not save the decision.')
  }
  return (
    <Section title="Candidate scheduling requirements" description="Found by rules in the documents, each with its citation. Confirm the ones that apply to this project. Nothing is applied to the schedule or the quality checks automatically.">
      <ul className="space-y-3">
        {items.map(c => (
          <li key={`${c.documentId}:${c.key}`} className="border border-warm-200 rounded-md p-3 bg-warm-50">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13.5px] font-semibold text-navy-950">{c.label}: {c.value}</span>
              {c.review && <span className={`${badge} ${c.review.status === 'confirmed' ? 'bg-status-on-track-bg border-status-on-track/40 text-status-on-track' : 'bg-warm-100 border-warm-300 text-warm-600'}`}>{c.review.status === 'confirmed' ? 'Confirmed' : 'Dismissed'} {fmtDay(c.review.createdAt)}</span>}
              {c.documentTrust !== 'approved' && <TrustBadge trust={c.documentTrust} />}
            </div>
            <blockquote className="mt-1 border-l-2 border-warm-300 pl-2 text-[13px] text-warm-700">{c.quote}</blockquote>
            <div className="mt-1 text-[12px] text-warm-500">{c.citation}</div>
            {c.fromFlaggedPassage && <p className="mt-1 text-[12px] text-status-attention">From a passage flagged for instruction-like text — check the source before confirming.</p>}
            {canDecide && (
              <div className="mt-2 flex gap-2">
                <Button variant="secondary" onClick={() => decide(c, 'confirmed')} disabled={c.review?.status === 'confirmed'} aria-label={`Confirm: ${c.label} ${c.value}`}>Confirm</Button>
                <Button variant="ghost" onClick={() => decide(c, 'dismissed')} disabled={c.review?.status === 'dismissed'} aria-label={`Dismiss: ${c.label} ${c.value}`}>Dismiss</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Section>
  )
}

interface Inbox { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null; received: number; revokedAt: string | null }

/** The project's inbox: where a mail rule or a meeting recorder sends emails and transcripts on its own. */
function ProjectInbox({ base, onReceived }: { base: string; onReceived: () => void }) {
  const [data, setData] = useState<{ inboxes: Inbox[]; address: string; available: boolean } | null>(null)
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState('')
  const load = useCallback(async () => {
    const r = await fetch(`${base}/inbox`)
    if (r.ok) setData(await r.json())
  }, [base])
  useEffect(() => { setData(null); setFresh(null); setError(''); load() }, [load])

  const create = async () => {
    const name = await askText({ title: 'New project inbox', label: 'What will send to it?', placeholder: 'e.g. Project mailbox, Weekly OAC meeting recorder', required: true, confirmLabel: 'Create' })
    if (!name) return
    setBusy(true); setError('')
    const r = await postJson(`${base}/inbox`, { name })
    setBusy(false)
    if (!r.ok) { setError(r.data.error || 'The inbox was not created.'); return }
    setFresh({ name, token: String(r.data.token) })
    load()
  }
  const turnOff = async (i: Inbox) => {
    if (!window.confirm(`Turn off "${i.name}"? Whatever sends to it will be refused from now on.`)) return
    const r = await fetch(`${base}/inbox?${new URLSearchParams({ inboxId: i.id })}`, { method: 'DELETE' })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) setError(d.error || 'The inbox was not turned off.')
    else { setData(x => x && { ...x, inboxes: d.inboxes }); if (fresh?.name === i.name) setFresh(null) }
  }
  const copy = async (what: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(''), 2000) } catch { setError('Copy is not available in this browser. Select the text and copy it.') }
  }
  if (!data) return null
  const active = data.inboxes.filter(i => !i.revokedAt)
  const example = fresh ? `curl -X POST ${data.address} \\
  -H "Authorization: Bearer ${fresh.token}" \\
  -H "Content-Type: message/rfc822" \\
  --data-binary @message.eml` : ''
  return (
    <Section title="Project inbox" description="Connect the project mailbox and the meeting recorder once. Each email, transcript or daily report they send lands here as a project document, and the Today tab reads it for delays, changes, risks and commitments the same morning.">
      {!data.available ? <p className="text-[13px] text-warm-700">CUI and classified projects have no inbox. Add their documents by hand.</p> : (
        <div className="space-y-3">
          {error && <Alert tone="error">{error}</Alert>}
          {fresh && (
            <div className="border border-accent-600/40 bg-white rounded-md p-3 space-y-2" role="status">
              <p className="text-[13px] font-semibold text-navy-950">“{fresh.name}” is ready. Copy the token now: it is shown only once.</p>
              <div className="grid gap-2 text-[12.5px]">
                <div><span className="text-warm-700">Send to (POST): </span><code className="font-mono text-navy-950 break-all">{data.address}</code> <button type="button" onClick={() => copy('address', data.address)} className="text-accent-600 font-medium hover:underline ml-1">{copied === 'address' ? 'Copied' : 'Copy'}</button></div>
                <div><span className="text-warm-700">Token (Authorization: Bearer): </span><code className="font-mono text-navy-950 break-all">{fresh.token}</code> <button type="button" onClick={() => copy('token', fresh.token)} className="text-accent-600 font-medium hover:underline ml-1">{copied === 'token' ? 'Copied' : 'Copy'}</button></div>
              </div>
              <pre className="bg-warm-100 rounded p-2 text-[12px] text-navy-950 overflow-x-auto"><code>{example}</code></pre>
              <p className="text-[12px] text-warm-700">In Microsoft Power Automate, Zapier or n8n: on a new email in the project mailbox (or a finished meeting transcript), add an HTTP step that posts to the address with this token. Accepted: a raw email (message/rfc822), a transcript (text/vtt), plain text, or JSON with type, title and text.</p>
              <button type="button" onClick={() => { setFresh(null); onReceived() }} className="text-[12.5px] font-medium text-accent-600 hover:underline">I have copied it</button>
            </div>
          )}
          {active.length > 0 && (
            <ul className="divide-y divide-warm-200 border border-warm-200 rounded-md bg-white">
              {active.map(i => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[13px]">
                  <div>
                    <span className="font-medium text-navy-950">{i.name}</span>
                    <span className="text-warm-600"> · token {i.prefix}… · {i.received} received{i.lastUsedAt ? `, last ${fmtDay(i.lastUsedAt)}` : ''} · created {fmtDay(i.createdAt)}</span>
                  </div>
                  <button type="button" onClick={() => turnOff(i)} className="text-[12.5px] font-medium text-status-at-risk hover:underline">Turn off</button>
                </li>
              ))}
            </ul>
          )}
          <Button type="button" onClick={create} disabled={busy}>{busy ? 'Creating…' : active.length ? 'Add another inbox' : 'Create the project inbox'}</Button>
        </div>
      )}
    </Section>
  )
}

interface Mailbox { id: string; address: string; folderName: string; createdAt: string; lastSyncAt: string | null; lastStatus: string | null; received: number; revokedAt: string | null }

/**
 * A Microsoft 365 mail folder connected to the project (src/lib/server/project-mailbox.ts). An admin
 * signs in with Microsoft and names one folder; RunF9 copies that folder's new emails into the
 * project's documents every morning and on "Sync now". Hidden where Microsoft sign-in is not set up.
 */
function ProjectMailbox({ base, onReceived }: { base: string; onReceived: () => void }) {
  const [data, setData] = useState<{ mailboxes: Mailbox[]; offered: boolean; canConnect: boolean; available: boolean; firstSyncDays: number } | null>(null)
  const [folder, setFolder] = useState('RunF9')
  const [note, setNote] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)
  const [busy, setBusy] = useState('')
  const load = useCallback(async () => {
    const r = await fetch(`${base}/mailbox`)
    if (r.ok) setData(await r.json())
  }, [base])
  useEffect(() => { setData(null); load() }, [load])
  // Microsoft sends the admin back to this page with the outcome in the address.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get('mailbox') === 'connected') setNote({ tone: 'success', text: `Connected. RunF9 is reading the folder “${q.get('folder') || 'you named'}”.` })
    else if (q.get('mailbox_error')) setNote({ tone: 'error', text: q.get('mailbox_error')! })
    else return
    window.history.replaceState(null, '', window.location.pathname)
    onReceived()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const connect = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy('connect'); setNote(null)
    const r = await postJson(`${base}/mailbox`, { action: 'connect_start', folder })
    if (!r.ok || typeof r.data.url !== 'string') { setBusy(''); setNote({ tone: 'error', text: String(r.data.error || 'The sign-in could not be started.') }); return }
    window.location.assign(r.data.url)
  }
  const sync = async (m: Mailbox) => {
    setBusy(m.id); setNote(null)
    const r = await postJson(`${base}/mailbox`, { action: 'sync', mailboxId: m.id })
    setBusy('')
    if (!r.ok) { setNote({ tone: 'error', text: String(r.data.error || 'The mailbox could not be read.') }); return }
    setData(x => x && { ...x, mailboxes: r.data.mailboxes as Mailbox[] })
    setNote({ tone: String(r.data.status || '').startsWith('Stopped') ? 'error' : 'success', text: String(r.data.status || 'Done.') })
    if (Number(r.data.received) > 0) onReceived()
  }
  const disconnect = async (m: Mailbox) => {
    if (!window.confirm(`Disconnect ${m.address} (folder “${m.folderName}”)? RunF9 stops reading it and erases its sign-in. Emails already copied stay in the project.`)) return
    const r = await fetch(`${base}/mailbox?${new URLSearchParams({ mailboxId: m.id })}`, { method: 'DELETE' })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) setNote({ tone: 'error', text: d.error || 'The mailbox was not disconnected.' })
    else setData(x => x && { ...x, mailboxes: d.mailboxes })
  }
  if (!data || !data.offered || !data.available) return null
  const active = data.mailboxes.filter(m => !m.revokedAt)
  if (!active.length && !data.canConnect) return null
  return (
    <Section title="Microsoft 365 mailbox" description="Let RunF9 read one Outlook folder for this project. It copies that folder’s new emails into the project every morning before the brief, and when you press Sync now. It reads only the folder you name, and never sends, changes or deletes mail.">
      <div className="space-y-3">
        {note && <Alert tone={note.tone}>{note.text}</Alert>}
        {active.length > 0 && (
          <ul className="divide-y divide-warm-200 border border-warm-200 rounded-md bg-white">
            {active.map(m => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[13px]">
                <div className="min-w-0">
                  <span className="font-medium text-navy-950 break-all">{m.address}</span>
                  <span className="text-warm-600"> · folder “{m.folderName}” · {m.received} copied · connected {fmtDay(m.createdAt)}</span>
                  <div className="text-[12px] text-warm-600">{m.lastSyncAt ? `Last read ${fmtDay(m.lastSyncAt)}: ${m.lastStatus || ''}` : 'Not read yet.'}</div>
                </div>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => sync(m)} disabled={!!busy} className="text-[12.5px] font-medium text-accent-600 hover:underline disabled:opacity-60">{busy === m.id ? 'Reading…' : 'Sync now'}</button>
                  {data.canConnect && <button type="button" onClick={() => disconnect(m)} className="text-[12.5px] font-medium text-status-at-risk hover:underline">Disconnect</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
        {data.canConnect ? (
          <form onSubmit={connect} className="flex flex-wrap items-end gap-2">
            <Field label="Outlook folder to read">{p => <input {...p} required maxLength={80} className={inputClass} value={folder} onChange={e => setFolder(e.target.value)} />}</Field>
            <Button type="submit" disabled={busy === 'connect' || !folder.trim()}>{busy === 'connect' ? 'Opening Microsoft…' : 'Sign in with Microsoft'}</Button>
          </form>
        ) : <p className="text-[12.5px] text-warm-600">An organization admin connects or disconnects a mailbox.</p>}
        {data.canConnect && <p className="text-[12px] text-warm-600">Create the folder in Outlook first and move this project’s emails into it, or add an Outlook rule that does. RunF9 starts with the last {data.firstSyncDays} days of that folder. Attachments are not read. Sign in with a work account.</p>}
      </div>
    </Section>
  )
}
