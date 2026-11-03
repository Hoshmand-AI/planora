'use client'

// "Upload from" and "Keep the original file in" for schedule and document uploads. The file comes
// from this computer or a connected cloud storage (Organization > Cloud storage); the original can
// be kept in RunF9 or in a connected storage. Renders the form fields the upload APIs read:
// file | sourceConnectionId + sourceKey, and keepIn (src/lib/storage/upload-source.ts).

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Cloud, Folder, FileText, Laptop, Loader2, ChevronRight } from 'lucide-react'

interface Connection { id: string; name: string; providerLabel: string; location: string; canRead: boolean; canWrite: boolean }
interface Listing { prefix: string; base: string; folders: string[]; files: { key: string; size: number; modified: string | null }[] }

const fmtSize = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`

export function FileSourcePicker({ accept, hint, keepLabel = 'RunF9 (default)', keepValue = 'runf9', canManage = false, inputClassName }: {
  /** e.g. ".xer,.xml,.pdf,.xlsx,.csv" */
  accept: string
  hint?: string
  /** First "Keep the original file in" option */
  keepLabel?: string
  keepValue?: string
  canManage?: boolean
  inputClassName?: string
}) {
  const [connections, setConnections] = useState<Connection[] | null>(null)
  const [from, setFrom] = useState<string>('computer')
  const [listing, setListing] = useState<Listing | null>(null)
  const [browsing, setBrowsing] = useState(false)
  const [browseError, setBrowseError] = useState('')
  const [picked, setPicked] = useState('')

  useEffect(() => {
    let live = true
    fetch('/api/storage').then(r => r.ok ? r.json() : { connections: [] }).then(d => { if (live) setConnections(d.connections ?? []) }).catch(() => { if (live) setConnections([]) })
    return () => { live = false }
  }, [])

  const browse = useCallback(async (id: string, prefix?: string) => {
    setBrowsing(true); setBrowseError('')
    try {
      const res = await fetch(`/api/storage/${encodeURIComponent(id)}/objects${prefix !== undefined ? `?prefix=${encodeURIComponent(prefix)}` : ''}`)
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setBrowseError(d.error || 'Could not list the files.'); setListing(null); return }
      setListing(d)
    } catch { setBrowseError('Could not reach RunF9. Try again.') } finally { setBrowsing(false) }
  }, [])

  const choose = (id: string) => {
    setFrom(id); setPicked(''); setListing(null)
    if (id !== 'computer') browse(id)
  }

  const readable = (connections ?? []).filter(c => c.canRead)
  const writable = (connections ?? []).filter(c => c.canWrite)
  const exts = accept.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  const importable = (key: string) => !exts.length || exts.some(x => key.toLowerCase().endsWith(x))
  const crumbs = listing ? listing.prefix.slice(listing.base.length).split('/').filter(Boolean) : []
  const fieldClass = inputClassName ?? 'w-full border border-warm-300 bg-warm-100 rounded-md px-3 py-2 text-[13.5px] text-warm-700'

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="block text-[11px] font-semibold uppercase tracking-wider text-warm-600 mb-1.5">Upload from</legend>
        <div className="flex flex-wrap gap-1.5">
          <SourceChip active={from === 'computer'} onClick={() => choose('computer')} icon={<Laptop size={14} aria-hidden />} label="This computer" />
          {readable.map(c => <SourceChip key={c.id} active={from === c.id} onClick={() => choose(c.id)} icon={<Cloud size={14} aria-hidden />} label={c.name} title={`${c.providerLabel} · ${c.location}`} />)}
        </div>
        {connections && readable.length === 0 && (
          <p className="text-[11.5px] text-warm-600 mt-1.5">
            {canManage ? <>To upload from AWS, Azure or Google Cloud, <Link href="/dashboard/org#cloud-storage" className="text-accent-600 underline">connect your cloud storage</Link>.</> : 'An admin can connect your AWS, Azure or Google Cloud storage in Organization settings.'}
          </p>
        )}
      </fieldset>

      {from === 'computer' ? (
        <div>
          <input type="file" name="file" accept={accept} required aria-label="File"
            className={`${fieldClass} file:mr-3 file:bg-navy-900 file:text-white file:border-0 file:rounded file:px-3 file:py-1 file:text-[12px] file:font-medium`} />
          {hint && <p className="text-[11px] text-warm-600 mt-1.5">{hint}</p>}
        </div>
      ) : (
        <div className="rounded-lg border border-warm-300 bg-white">
          <input type="hidden" name="sourceConnectionId" value={from} />
          <input type="text" name="sourceKey" value={picked} onChange={() => {}} required tabIndex={-1} aria-hidden="true" className="sr-only" />
          <nav aria-label="Folder" className="flex flex-wrap items-center gap-1 px-3 py-2 border-b border-warm-200 text-[12.5px]">
            <button type="button" className="font-semibold text-accent-600 hover:underline" onClick={() => listing && browse(from, listing.base)}>{readable.find(c => c.id === from)?.name}</button>
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                <ChevronRight size={12} aria-hidden className="text-warm-500" />
                <button type="button" className="text-accent-600 hover:underline" onClick={() => listing && browse(from, listing.base + crumbs.slice(0, i + 1).join('/') + '/')}>{c}</button>
              </span>
            ))}
          </nav>
          <div className="max-h-56 overflow-y-auto">
            {browsing ? (
              <p className="px-3 py-4 text-[13px] text-warm-600 flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden /> Loading files…</p>
            ) : browseError ? (
              <p role="alert" className="px-3 py-4 text-[13px] text-status-at-risk">{browseError}</p>
            ) : listing && (
              <ul>
                {listing.folders.map(f => (
                  <li key={f}>
                    <button type="button" onClick={() => browse(from, f)} className="w-full flex items-center gap-2 px-3 py-2 text-left text-[13px] text-navy-950 hover:bg-warm-50">
                      <Folder size={14} aria-hidden className="text-warm-600" /> {f.slice(listing.prefix.length).replace(/\/$/, '')}
                    </button>
                  </li>
                ))}
                {listing.files.map(f => {
                  const ok = importable(f.key)
                  return (
                    <li key={f.key}>
                      <button type="button" disabled={!ok} aria-pressed={picked === f.key} onClick={() => setPicked(f.key)}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[13px] ${picked === f.key ? 'bg-accent-100 text-navy-950 font-semibold' : ok ? 'text-navy-950 hover:bg-warm-50' : 'text-warm-500 cursor-not-allowed'}`}>
                        <FileText size={14} aria-hidden className="text-warm-600 flex-shrink-0" />
                        <span className="truncate flex-1">{f.key.slice(listing.prefix.length)}</span>
                        <span className="text-[11.5px] text-warm-600 tabular-nums">{fmtSize(f.size)}</span>
                      </button>
                    </li>
                  )
                })}
                {listing.folders.length === 0 && listing.files.length === 0 && <li className="px-3 py-4 text-[13px] text-warm-600">This folder is empty.</li>}
              </ul>
            )}
          </div>
          <p className="px-3 py-2 border-t border-warm-200 text-[11.5px] text-warm-600">{picked ? <>Selected: <span className="font-semibold text-navy-950">{picked.split('/').pop()}</span></> : 'Choose a file.'}{hint ? ` ${hint}` : ''}</p>
        </div>
      )}

      <label className="block">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-warm-600 mb-1.5">Keep the original file in</span>
        <select name="keepIn" defaultValue={keepValue} className={fieldClass}>
          <option value={keepValue}>{keepLabel}</option>
          {writable.map(c => <option key={c.id} value={c.id}>{c.name} ({c.providerLabel})</option>)}
        </select>
        <span className="block text-[11px] text-warm-600 mt-1.5">{writable.length ? 'Kept in your storage, RunF9 records only where the file is and its fingerprint (SHA-256), and checks it each time it reads it back.' : 'Connect your cloud storage to keep original files there instead.'}</span>
      </label>
    </div>
  )
}

function SourceChip({ active, onClick, icon, label, title }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; title?: string }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} title={title}
      className={`pressable inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold border ${active ? 'bg-navy-900 text-white border-navy-900' : 'bg-white text-navy-950 border-warm-300 hover:border-navy-900'}`}>
      {icon}{label}
    </button>
  )
}
