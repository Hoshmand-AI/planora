'use client'

import { useCallback, useEffect, useId, useState } from 'react'
import { FolderOpen, Loader2, Search, ShieldAlert, Trash2, Upload } from 'lucide-react'
import { useApp } from '../layout'
import { Alert, Button, Field, Section, inputClass, postJson } from '@/components/ui'
import { fmtDay } from '@/lib/format'

interface Doc {
  id: string; scope: 'project' | 'org'; title: string; fileName: string; format: string; docType: string; trust: 'approved' | 'unreviewed'
  classification: string | null; sizeBytes: number; pageCount: number | null; chunkCount: number; flaggedCount: number
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

const badge = 'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium border'
const TrustBadge = ({ trust }: { trust: string }) => trust === 'approved'
  ? <span className={`${badge} bg-status-on-track-bg border-status-on-track/40 text-status-on-track`}>Approved</span>
  : <span className={`${badge} bg-status-attention-bg border-status-attention/40 text-status-attention`}>Unreviewed</span>

export default function DocumentsPage() {
  const { selectedSchedule, can } = useApp()
  const [data, setData] = useState<Listing | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; text: string } | null>(null)
  const [requirements, setRequirements] = useState<Candidate[] | null>(null)
  const base = selectedSchedule ? `/api/schedules/${encodeURIComponent(selectedSchedule.id)}/documents` : ''

  const load = useCallback(async () => {
    if (!base) return
    setError('')
    try {
      const [l, r] = await Promise.all([fetch(base), fetch(`${base}/requirements`)])
      const ld = await l.json().catch(() => ({}))
      if (!l.ok) { setError(ld.error || 'Could not load documents.'); return }
      setData(ld)
      const rd = await r.json().catch(() => ({}))
      setRequirements(r.ok ? rd.requirements : [])
    } catch { setError('Network error. Check your connection and try again.') }
  }, [base])
  useEffect(() => { setData(null); setRequirements(null); load() }, [load])

  if (!selectedSchedule) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center px-6">
        <div className="w-12 h-12 bg-warm-100 border border-warm-200 rounded-lg flex items-center justify-center mb-4">
          <FolderOpen size={20} className="text-warm-500" aria-hidden="true" />
        </div>
        <h1 className="text-[17px] font-semibold text-navy-950 mb-2">Select a project to see its documents</h1>
        <p className="text-[14px] text-warm-500 max-w-[380px]">Contracts, scheduling specifications and owner requirements are kept with each project.</p>
      </div>
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
    setNotice(r.ok ? { tone: 'success', text: `"${d.title}" was deleted with its ${r.data.passagesDeleted} passages.` } : { tone: 'error', text: r.data.error || 'Could not delete the document.' })
    load()
  }

  return (
    <div className="p-5 md:p-6 space-y-5">
      <div>
        <h1 className="font-display text-[22px] text-navy-950 mb-1">Project documents</h1>
        <p className="text-[13.5px] text-warm-500 max-w-[720px]">
          Contracts, scheduling specifications and owner requirements for <span className="font-medium text-warm-700">{selectedSchedule.name}</span>, shared with every update of this project.
          Ask AI and reports can cite them when you choose &ldquo;Use project documents&rdquo;. Planora keeps the extracted text only, not the original file.
        </p>
      </div>

      {data?.cuiWarning && <Alert tone="info">{data.cuiWarning}</Alert>}
      {(data?.classification === 'cui' || data?.classification === 'classified') && (
        <Alert tone="warning">This project is marked {data.classification === 'cui' ? 'CUI' : 'classified'}. Its documents are never sent to a cloud AI model; you get the matching passages with citations instead.</Alert>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      <div aria-live="polite">{notice && <Alert tone={notice.tone}>{notice.text}</Alert>}</div>

      {can('schedule.write') && data && <UploadForm base={base} data={data} canOrg={can('org.manage')} onDone={(n) => { setNotice(n); load() }} />}

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
                      {data.docTypes.find(t => t.id === d.docType)?.label ?? d.docType} · {d.format.toUpperCase()}{d.pageCount ? ` · ${d.pageCount} pages` : ''} · {d.chunkCount} passages · added {fmtDay(d.createdAt)}{d.uploadedByName ? ` by ${d.uploadedByName}` : ''}
                      {d.scope === 'project' && d.anchorName && d.scheduleId !== selectedSchedule.id ? ` · attached to ${d.anchorName}${d.anchorVersion ? ` (${d.anchorVersion})` : ''}` : ''}
                    </div>
                    {d.flaggedCount > 0 && (
                      <p className="mt-1 text-[12px] text-status-attention flex items-center gap-1"><ShieldAlert size={13} aria-hidden="true" /> {d.flaggedCount} passage{d.flaggedCount === 1 ? '' : 's'} contain{d.flaggedCount === 1 ? 's' : ''} instruction-like text and {d.flaggedCount === 1 ? 'is' : 'are'} never sent to AI.</p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {can('plan.review') && (d.scope === 'project' || can('org.manage')) && (
                      d.trust === 'approved'
                        ? <Button variant="secondary" onClick={() => setTrust(d, 'unreviewed')} aria-label={`Mark ${d.title} unreviewed`}>Mark unreviewed</Button>
                        : <Button variant="secondary" onClick={() => setTrust(d, 'approved')} aria-label={`Approve ${d.title}`}>Approve</Button>
                    )}
                    {can('schedule.write') && (d.scope === 'project' || can('org.manage')) && (
                      <Button variant="secondary" onClick={() => remove(d)} aria-label={`Delete ${d.title}`}><Trash2 size={13} className="inline -mt-0.5" aria-hidden="true" /> Delete</Button>
                    )}
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
    </div>
  )
}

function UploadForm({ base, data, canOrg, onDone }: { base: string; data: Listing; canOrg: boolean; onDone: (n: { tone: 'success' | 'warning' | 'error'; text: string }) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [docType, setDocType] = useState('scheduling_spec')
  const [orgStandard, setOrgStandard] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const orgId = useId()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) return
    setBusy(true)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('title', title)
    fd.append('docType', docType)
    if (orgStandard) fd.append('scope', 'org')
    try {
      const res = await fetch(base, { method: 'POST', body: fd })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) onDone({ tone: 'error', text: d.error || 'Upload failed.' })
      else {
        onDone(d.warning ? { tone: 'warning', text: `"${d.document.title}" was added (${d.document.chunkCount} passages). ${d.warning}` } : { tone: 'success', text: `"${d.document.title}" was added (${d.document.chunkCount} passages). It is unreviewed until an admin or reviewer approves it.` })
        setFile(null); setTitle(''); setOrgStandard(false); setFormKey(k => k + 1)
      }
    } catch { onDone({ tone: 'error', text: 'Network error. Check your connection and try again.' }) }
    setBusy(false)
  }

  return (
    <Section title="Add a document" description={`PDF with selectable text, Word (.docx), text or Markdown, up to ${Math.round(data.limits.maxBytes / 1024 / 1024)} MB. Scanned PDFs need OCR first.`}>
      <form key={formKey} onSubmit={submit} className="grid md:grid-cols-2 gap-3">
        <Field label="File">{p => <input {...p} type="file" required accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown" onChange={e => setFile(e.target.files?.[0] ?? null)} className="text-[13px] text-warm-700 file:mr-3 file:rounded-md file:border file:border-warm-300 file:bg-warm-50 file:px-3 file:py-1.5 file:text-[13px] file:text-navy-950" />}</Field>
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
          <Button type="submit" disabled={!file || busy}>{busy ? <><Loader2 size={13} className="inline animate-spin -mt-0.5" aria-hidden="true" /> Reading the document…</> : <><Upload size={13} className="inline -mt-0.5" aria-hidden="true" /> Upload</>}</Button>
        </div>
      </form>
    </Section>
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
                  <span className="text-[11px] text-warm-500">{h.tierLabel}</span>
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
