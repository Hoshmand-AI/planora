'use client'

// Site: what people recorded on site with a phone. Photos, a voice note and a few words, each with who, when and
// where, tied to schedule activities. The page is the record, newest first, by day; one button starts a capture.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Camera, Check, Loader2, MapPin, Mic, X } from 'lucide-react'
import { digitsFont } from '@/app/fonts/digits'
import { EmptyState } from '@/components/EmptyState'
import { MoreMenu } from '@/components/MoreMenu'
import { Alert } from '@/components/ui'
import { CaptureSheet } from '@/components/site/CaptureSheet'
import { useApp } from '../layout'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { CAPTURE_STATUS_LABELS, placeLabel, type CaptureActivity, type CaptureStatus, type SiteCapture } from '@/lib/site/capture'
import { accuracyLabel, outboxFlush, outboxList } from '@/lib/site/client'

interface Listing {
  captures: SiteCapture[]
  overview: { count: number; levels: string[]; rooms: { level: string | null; room: string }[] }
  canCapture: boolean
  enabled: boolean
  classification: string | null
  activities?: CaptureActivity[]
}

const PAGE = 60
const BADGE: Record<CaptureStatus, string> = {
  progress: 'bg-accent-100 text-accent-700', complete: 'bg-status-on-track-bg text-status-on-track',
  not_started: 'bg-warm-100 text-warm-700', issue: 'bg-status-at-risk-bg text-status-at-risk',
}
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
/** The calendar day a capture was taken, in the reader's own time zone. */
const dayOf = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export default function SitePage() {
  const { selectedSchedule, can, user, openUpload } = useApp()
  const [data, setData] = useState<Listing | null>(null)
  const [activities, setActivities] = useState<CaptureActivity[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; text: string } | null>(null)
  const [filter, setFilter] = useState<CaptureStatus | 'all'>('all')
  const [place, setPlace] = useState('')
  const [adding, setAdding] = useState(false)
  const [preset, setPreset] = useState<{ level?: string; room?: string } | null>(null)
  const [waiting, setWaiting] = useState(0)
  const [sending, setSending] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [done, setDone] = useState(false)
  const [open, setOpen] = useState<{ capture: SiteCapture; index: number } | null>(null)
  const sid = selectedSchedule?.id ?? null
  const base = sid ? `/api/schedules/${encodeURIComponent(sid)}/captures` : ''

  // Only the newest request may land: a slow answer for one project must never be listed under another.
  const seq = useRef(0)
  const load = useCallback(async () => {
    if (!base) return
    const mine = ++seq.current
    try {
      const res = await fetch(`${base}?limit=${PAGE}&activities=1`)
      const d = await res.json().catch(() => null)
      if (mine !== seq.current) return
      if (!res.ok) { setError(d?.error || 'The site captures could not be loaded.'); return }
      setError(''); setData(d); setActivities(d.activities ?? []); setDone((d.captures?.length ?? 0) < PAGE)
    } catch { if (mine === seq.current) setError('The site captures could not be loaded. Check your connection and try again.') }
  }, [base])
  useEffect(() => { setData(null); setFilter('all'); setPlace(''); setNotice(null); load() }, [load])

  // A capture taken with no signal waits on this phone: count them, and send them when the connection returns.
  const flush = useCallback(async () => {
    if (!sid) return
    setSending(true)
    const r = await outboxFlush(sid)
    setSending(false)
    setWaiting(r.left)
    if (r.sent) { setNotice({ tone: 'success', text: `${r.sent} ${r.sent === 1 ? 'capture that was waiting on this phone has' : 'captures that were waiting on this phone have'} been sent.` }); load() }
    if (r.error) setNotice({ tone: 'error', text: `A capture waiting on this phone could not be sent: ${r.error}` })
  }, [sid, load])
  useEffect(() => {
    if (!sid) return
    let live = true
    outboxList(sid).then(l => { if (live) { setWaiting(l.length); if (l.length && navigator.onLine) flush() } })
    const online = () => flush()
    window.addEventListener('online', online)
    return () => { live = false; window.removeEventListener('online', online) }
  }, [sid, flush])

  // A posted room code opens this page with the place already set, and "Add to project" opens it ready to capture.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const level = q.get('level')?.slice(0, 80) || undefined, room = q.get('room')?.slice(0, 80) || undefined
    if (level || room) setPreset({ level, room })
    if (q.get('new') === '1' || level || room) setAdding(true)
  }, [sid])

  async function more() {
    if (!data?.captures.length) return
    setLoadingMore(true)
    try {
      const res = await fetch(`${base}?limit=${PAGE}&before=${encodeURIComponent(data.captures[data.captures.length - 1].takenAt)}`)
      const d = await res.json().catch(() => null)
      if (res.ok && d) { setData({ ...data, captures: [...data.captures, ...d.captures] }); setDone(d.captures.length < PAGE) }
    } finally { setLoadingMore(false) }
  }
  async function remove(c: SiteCapture) {
    if (!window.confirm('Delete this capture? Its photos, voice note and words are erased. This cannot be undone.')) return
    const res = await fetch(`${base}/${encodeURIComponent(c.id)}`, { method: 'DELETE' })
    const d = await res.json().catch(() => null)
    if (!res.ok) { setNotice({ tone: 'error', text: d?.error || 'The capture could not be deleted.' }); return }
    setNotice({ tone: 'success', text: 'The capture was deleted.' })
    load()
  }

  const captures = useMemo(() => data?.captures ?? [], [data])
  const counts = useMemo(() => {
    const n: Record<string, number> = { all: captures.length }
    for (const c of captures) n[c.status] = (n[c.status] ?? 0) + 1
    return n
  }, [captures])
  const places = useMemo(() => [...new Set(captures.map(c => placeLabel(c)).filter(Boolean))], [captures])
  const shown = captures.filter(c => (filter === 'all' || c.status === filter) && (!place || placeLabel(c) === place))
  const days = useMemo(() => {
    const by = new Map<string, SiteCapture[]>()
    for (const c of shown) { const d = dayOf(c.takenAt); by.set(d, [...(by.get(d) ?? []), c]) }
    return [...by.entries()]
  }, [shown])
  const nameOf = (code: string) => activities.find(a => a.code.toLowerCase() === code.toLowerCase())?.name ?? ''
  const mediaUrl = (c: SiteCapture, id: string) => `${base}/${encodeURIComponent(c.id)}/media/${encodeURIComponent(id)}`

  if (!selectedSchedule) {
    return (
      <EmptyState title="Select a project to see its site captures" action={{ label: can('schedule.write') ? 'Upload a schedule' : 'Go to your projects', ...(can('schedule.write') ? { onClick: openUpload } : { href: '/dashboard' }) }}>
        Photos and notes from the site are kept with the project they were taken on.
      </EmptyState>
    )
  }

  const canCapture = !!data?.canCapture
  const chips = (['all', 'issue', 'progress', 'complete', 'not_started'] as const).filter(f => f === 'all' || filter === f || ((counts[f] ?? 0) > 0 && (counts[f] ?? 0) < counts.all))
  return (
    <div className="max-w-6xl mx-auto px-5 md:px-8 py-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h2 className="text-heading font-semibold text-ink">Site captures{data && data.overview.count > 0 && <span className="ml-1.5 text-body font-normal text-warm-600 tabular-nums">{data.overview.count.toLocaleString('en-US')}</span>}</h2>
          <p className="text-body text-warm-600 max-w-[720px]">What was seen on site: a photo, a note, who took it, when and where. A capture is a record, not a measurement.</p>
        </div>
        {canCapture && captures.length > 0 && (
          <button type="button" onClick={() => setAdding(true)} className="pressable inline-flex items-center gap-1.5 rounded-lg bg-accent-600 hover:bg-accent-700 text-white text-body font-semibold px-4 h-9"><Camera size={14} aria-hidden="true" /> New capture</button>
        )}
      </div>

      {data && !data.enabled && <Alert tone="info">Site captures are turned off on this deployment, so the camera, microphone and location stay blocked. Captures made before are listed below.</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      <div aria-live="polite">{notice && <Alert tone={notice.tone}>{notice.text}</Alert>}</div>
      {waiting > 0 && (
        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-body text-warm-700">
          <span className="min-w-0 flex-1">{waiting} {waiting === 1 ? 'capture is' : 'captures are'} saved on this phone and not sent yet.</span>
          <button type="button" onClick={flush} disabled={sending} className="pressable inline-flex items-center gap-1.5 rounded-lg border border-warm-300 bg-white px-3 h-9 text-body font-semibold text-ink hover:bg-warm-100">{sending && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}Send now</button>
        </div>
      )}

      {!data && !error ? (
        <p className="text-body text-warm-600 flex items-center gap-2" role="status"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Loading site captures…</p>
      ) : data && captures.length === 0 ? (
        <EmptyState heading="h3" title="No captures yet" {...(canCapture ? { action: { label: 'New capture', onClick: () => setAdding(true) } } : {})}>
          {canCapture ? 'Take a photo on site and say what it shows. It is filed with the place, the time and the activity.' : 'Captures made on site by your team will be listed here.'}
        </EmptyState>
      ) : data && (
        <>
          {(chips.length > 1 || places.length > 1) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              {chips.length > 1 && (
                <div role="group" aria-label="Filter captures by what they show" className="flex flex-wrap gap-1.5">
                  {chips.map(f => {
                    const on = filter === f
                    return (
                      <button key={f} type="button" aria-pressed={on} onClick={() => setFilter(on && f !== 'all' ? 'all' : f)}
                        className={`pressable inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-body font-semibold border ${on ? 'bg-accent-100 text-accent-700 border-accent-500' : 'bg-white text-ink border-warm-300 hover:border-navy-900'}`}>
                        {on && <Check size={14} aria-hidden="true" />}{f === 'all' ? 'All' : CAPTURE_STATUS_LABELS[f]} <span className={`tabular-nums font-medium ${on ? 'text-accent-700' : 'text-warm-600'}`}>{counts[f] ?? 0}</span>
                      </button>
                    )
                  })}
                </div>
              )}
              {places.length > 1 && (
                <label className="text-body text-warm-700">
                  <span className="sr-only">Place</span>
                  <select value={place} onChange={e => setPlace(e.target.value)} className="rounded-lg border border-warm-300 bg-white px-2 h-9 text-body text-ink">
                    <option value="">Every place</option>
                    {places.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}
          <p className="sr-only" role="status" aria-live="polite">{shown.length} {shown.length === 1 ? 'capture' : 'captures'} shown</p>

          {shown.length === 0 ? <p className="text-body text-warm-600">No capture matches. <button type="button" className="font-medium text-accent-600 hover:underline" onClick={() => { setFilter('all'); setPlace('') }}>Show all</button>.</p> : (
            <div className="space-y-6">
              {days.map(([day, list]) => (
                <section key={day} aria-label={`Captures on ${fmtDate(day)}`}>
                  <h3 className="text-subhead font-semibold text-ink tabular-nums mb-2">{fmtDate(day)} <span className="ml-1 text-body font-normal text-warm-600">{list.length} {list.length === 1 ? 'capture' : 'captures'}</span></h3>
                  <ul className="rounded-[14px] border border-warm-200 bg-white divide-y divide-warm-200">
                    {list.map(c => {
                      const photos = c.media.filter(m => m.kind === 'photo'), audio = c.media.find(m => m.kind === 'audio')
                      const where = placeLabel(c)
                      const mine = c.createdBy === user?.id
                      return (
                        <li key={c.id} className="flex gap-3 p-3 md:p-4">
                          {photos[0] ? (
                            <button type="button" data-compact onClick={() => setOpen({ capture: c, index: 0 })} aria-label={`Open the photo${photos.length > 1 ? `s (${photos.length})` : ''} taken ${fmtDateTime(c.takenAt)}`}
                              className="relative h-20 w-20 md:h-24 md:w-24 flex-shrink-0 overflow-hidden rounded-lg border border-warm-200 bg-warm-100">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={mediaUrl(c, photos[0].id)} alt="" loading="lazy" className="h-full w-full object-cover" />
                              {photos.length > 1 && <span className="absolute bottom-1 right-1 rounded-md bg-navy-950 px-1.5 text-caption font-semibold text-white tabular-nums">{photos.length}</span>}
                            </button>
                          ) : (
                            <span aria-hidden="true" className="inline-flex h-20 w-20 md:h-24 md:w-24 flex-shrink-0 items-center justify-center rounded-lg border border-warm-200 bg-warm-50 text-warm-600">{audio ? <Mic size={20} /> : <Camera size={20} />}</span>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-caption font-semibold ${BADGE[c.status]}`}>{CAPTURE_STATUS_LABELS[c.status]}</span>
                              {where && <span className="text-body font-semibold text-ink">{where}</span>}
                            </div>
                            {c.note && <p className="mt-1 whitespace-pre-line break-words text-body text-warm-700">{c.note}</p>}
                            {c.activityCodes.length > 0 && (
                              <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Activities">
                                {c.activityCodes.map(code => <li key={code} className="max-w-full truncate rounded-md bg-warm-100 px-2 py-0.5 text-caption text-warm-700"><span className="font-semibold tabular-nums text-ink">{code}</span> {nameOf(code)}</li>)}
                              </ul>
                            )}
                            {audio && (
                              // eslint-disable-next-line jsx-a11y/media-has-caption
                              <audio controls preload="none" src={mediaUrl(c, audio.id)} className="mt-2 h-10 w-full max-w-sm" aria-label={`Voice note${audio.seconds ? `, ${Math.round(audio.seconds)} seconds` : ''}`} />
                            )}
                            <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-caption text-warm-600">
                              <span className="tabular-nums">{timeOf(c.takenAt)}</span><span aria-hidden="true">·</span><span>{c.createdByName || 'A member'}</span>
                              {c.position && <><span aria-hidden="true">·</span><span className="inline-flex items-center gap-1"><MapPin size={12} aria-hidden="true" />position {accuracyLabel(c.position.accuracyM)}</span></>}
                              {c.placeSource === 'code' && <><span aria-hidden="true">·</span><span>place from a room code</span></>}
                            </p>
                          </div>
                          {data.enabled && (mine || can('schedule.write')) && can('site.capture') && (
                            <div className="flex-shrink-0"><MoreMenu label={`More for the capture taken ${fmtDateTime(c.takenAt)}`} items={[{ label: 'Delete this capture', onSelect: () => remove(c), danger: true }]} /></div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
          {!done && <button type="button" onClick={more} disabled={loadingMore} className="pressable inline-flex items-center gap-1.5 rounded-lg border border-warm-300 bg-white px-4 h-9 text-body font-medium text-ink hover:bg-warm-100">{loadingMore && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}Show older captures</button>}
        </>
      )}

      {adding && data && canCapture && sid && (
        <CaptureSheet scheduleId={sid} projectName={selectedSchedule.name} levels={data.overview.levels} rooms={data.overview.rooms} activities={activities} preset={preset}
          onClose={() => setAdding(false)}
          onSaved={r => {
            setAdding(false); setPreset(null)
            if (r.queued) { setNotice({ tone: 'warning', text: 'No connection: the capture is saved on this phone and will be sent when you are back online.' }); outboxList(sid).then(l => setWaiting(l.length)) }
            else { setNotice({ tone: 'success', text: 'Capture saved.' }); load() }
          }} />
      )}
      {open && <PhotoViewer capture={open.capture} index={open.index} url={id => mediaUrl(open.capture, id)} onIndex={i => setOpen({ capture: open.capture, index: i })} onClose={() => setOpen(null)} />}
    </div>
  )
}

/** A capture's photos at full size, one at a time. */
function PhotoViewer({ capture, index, url, onIndex, onClose }: { capture: SiteCapture; index: number; url: (mediaId: string) => string; onIndex: (i: number) => void; onClose: () => void }) {
  const photos = capture.media.filter(m => m.kind === 'photo')
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    close.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight' && index < photos.length - 1) onIndex(index + 1)
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [index, photos.length, onClose, onIndex])
  const p = photos[index]
  if (!p) return null
  const where = placeLabel(capture)
  return createPortal(
    <div className={`${digitsFont.variable} font-sans fixed inset-0 z-50 flex flex-col bg-navy-950`} role="dialog" aria-modal="true" aria-label={`Photo ${index + 1} of ${photos.length}`}>
      <div className="flex items-center gap-3 px-4 py-2 text-white">
        <p className="min-w-0 flex-1 truncate text-body"><span className="font-semibold">{CAPTURE_STATUS_LABELS[capture.status]}</span>{where ? ` · ${where}` : ''} · <span className="tabular-nums">{fmtDateTime(capture.takenAt)}</span> · {capture.createdByName || 'A member'}</p>
        {photos.length > 1 && <span className="flex-shrink-0 text-body tabular-nums text-navy-200">{index + 1} of {photos.length}</span>}
        <button ref={close} type="button" onClick={onClose} aria-label="Close" className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-white hover:bg-navy-800"><X size={18} aria-hidden="true" /></button>
      </div>
      <div className="relative min-h-0 flex-1" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url(p.id)} alt={capture.note ? `Site photo: ${capture.note.split('\n')[0].slice(0, 120)}` : 'Site photo'} className="absolute inset-0 m-auto max-h-full max-w-full object-contain" />
      </div>
      {photos.length > 1 && (
        <div className="flex justify-center gap-2 p-3">
          <button type="button" onClick={() => onIndex(index - 1)} disabled={index === 0} className="rounded-lg border border-navy-700 px-4 h-10 text-body font-medium text-white disabled:opacity-40">Previous</button>
          <button type="button" onClick={() => onIndex(index + 1)} disabled={index === photos.length - 1} className="rounded-lg border border-navy-700 px-4 h-10 text-body font-medium text-white disabled:opacity-40">Next</button>
        </div>
      )}
    </div>,
    document.body,
  )
}
