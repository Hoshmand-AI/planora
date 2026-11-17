'use client'

// The capture screen: a photo, what it shows, a spoken or typed note, where and which activity. Made for a phone
// in one hand: the photo first, one tap for the status, everything else optional. With no signal the capture is
// kept on the phone and sent later.

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Camera, Loader2, MapPin, Mic, Square, Trash2, X } from 'lucide-react'
import { digitsFont } from '@/app/fonts/digits'
import { Alert } from '@/components/ui'
import {
  CAPTURE_STATUSES, CAPTURE_STATUS_LABELS, MAX_AUDIO_SECONDS, MAX_NOTE_CHARS, MAX_PHOTOS_PER_CAPTURE, MAX_PLACE_CHARS,
  type CaptureActivity, type CapturePosition, type CaptureStatus, type PlaceSource, type SiteCapture,
} from '@/lib/site/capture'
import { PlanView } from './PlanCanvas'
import { fitPlan, locate as locatePlace, onSheet, roomAt, sameLevel, type SitePlan } from '@/lib/site/plan'
import { accuracyLabel, canRecordAudio, currentPosition, outboxAdd, resizePhoto, sendCapture, startRecording, type PendingCapture, type Recording } from '@/lib/site/client'

interface Photo { blob: Blob; url: string }
interface Voice { blob: Blob; url: string; seconds: number }

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const POSITION_KEY = 'runf9.site.position'
const placeKey = (scheduleId: string) => `runf9.site.place.${scheduleId}`
const remember = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private browsing */ } }
const recall = (k: string): string | null => { try { return localStorage.getItem(k) } catch { return null } }

export function CaptureSheet({ scheduleId, userId, projectName, levels, rooms, activities, preset, plans = [], onClose, onSaved }: {
  scheduleId: string
  /** The signed-in member: a capture kept on the phone waits for this person */
  userId: string
  projectName: string
  /** Levels and rooms used on this project so far, most recent first */
  levels: string[]
  rooms: { level: string | null; room: string }[]
  activities: CaptureActivity[]
  /** A place read from a posted room code (the link the code opens), when there is one */
  preset?: { level?: string; room?: string } | null
  /** The drawings of the project's levels: used to suggest a room from the phone's position and to pin the capture */
  plans?: SitePlan[]
  onClose: () => void
  /** `queued` is true when the capture could not be sent and is kept on this phone */
  onSaved: (r: { capture: SiteCapture | null; queued: boolean }) => void
}) {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [status, setStatus] = useState<CaptureStatus | null>(null)
  const [note, setNote] = useState('')
  const [level, setLevel] = useState(preset?.level ?? '')
  const [room, setRoom] = useState(preset?.room ?? '')
  const [placeSource, setPlaceSource] = useState<PlaceSource>(preset?.level || preset?.room ? 'code' : 'none')
  const [codes, setCodes] = useState<string[]>([])
  const [find, setFind] = useState('')
  const [voice, setVoice] = useState<Voice | null>(null)
  const [recording, setRecording] = useState<Recording | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [usePosition, setUsePosition] = useState(false)
  const [position, setPosition] = useState<CapturePosition | null>(null)
  const [locating, setLocating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState('')
  const [pin, setPin] = useState<{ planId: string; x: number; y: number } | null>(null)
  const [pinning, setPinning] = useState(false)
  const takenAt = useRef<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const titleId = useId(), levelList = useId(), roomList = useId()

  // The last place used on this project is where the next capture most likely is.
  useEffect(() => {
    if (preset?.level || preset?.room) return
    const last = recall(placeKey(scheduleId))
    if (last) { try { const p = JSON.parse(last); if (p.level) setLevel(String(p.level)); if (p.room) setRoom(String(p.room)); if (p.level || p.room) setPlaceSource('picked') } catch { /* not ours */ } }
  }, [scheduleId, preset])
  // Position is stamped only once the person has chosen it; the choice is remembered on this phone.
  useEffect(() => { if (recall(POSITION_KEY) === '1') locate(true) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Focus moves into the sheet once, when it opens: never again while the person is typing in it.
  const escape = useRef({ busy, onClose })
  escape.current = { busy, onClose }
  useEffect(() => {
    closeBtn.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !escape.current.busy) escape.current.onClose() }
    document.addEventListener('keydown', onKey)
    const scroll = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = scroll }
  }, [])
  // Recordings and previews hold memory and, while recording, the microphone: let go of both when the screen closes.
  const live = useRef<{ photos: Photo[]; voice: Voice | null; recording: Recording | null }>({ photos: [], voice: null, recording: null })
  live.current = { photos, voice, recording }
  const alive = useRef(true), starting = useRef(false)
  useEffect(() => () => {
    alive.current = false
    live.current.recording?.cancel()
    live.current.photos.forEach(p => URL.revokeObjectURL(p.url))
    if (live.current.voice) URL.revokeObjectURL(live.current.voice.url)
  }, [])

  useEffect(() => {
    if (!recording) return
    const started = Date.now()
    const t = setInterval(() => {
      const s = (Date.now() - started) / 1000
      setElapsed(s)
      if (s >= MAX_AUDIO_SECONDS) stopRecording()
    }, 250)
    return () => clearInterval(t)
  }, [recording]) // eslint-disable-line react-hooks/exhaustive-deps

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return
    setError(''); setPreparing(true)
    try {
      const room = MAX_PHOTOS_PER_CAPTURE - photos.length
      const added: Photo[] = []
      for (const f of [...files].slice(0, room)) {
        const { blob } = await resizePhoto(f)
        added.push({ blob, url: URL.createObjectURL(blob) })
      }
      if (!takenAt.current) takenAt.current = new Date().toISOString()
      setPhotos(p => [...p, ...added])
      if (files.length > room) setError(`A capture holds up to ${MAX_PHOTOS_PER_CAPTURE} photos. Save this one and start another for the rest.`)
    } catch { setError('That file could not be read as a photo. Take the photo again.') }
    finally { setPreparing(false); if (fileInput.current) fileInput.current.value = '' }
  }
  const removePhoto = (i: number) => setPhotos(p => { URL.revokeObjectURL(p[i].url); return p.filter((_, j) => j !== i) })

  async function record() {
    // One microphone at a time: a second tap while the browser is still asking must not open a second one.
    if (starting.current || live.current.recording) return
    starting.current = true
    setError('')
    try {
      const r = await startRecording()
      // The sheet was closed while the browser was asking: let the microphone go at once.
      if (!alive.current) { r.cancel(); return }
      live.current.recording = r
      setElapsed(0); setRecording(r)
    } catch { if (alive.current) setError('The microphone could not be used. Allow the microphone for RunF9 in your browser, or type the note.') }
    finally { starting.current = false }
  }
  /** Stops the recording and gives the voice note it made (the one already held when nothing was recording). */
  async function stopRecording(): Promise<Voice | null> {
    const r = live.current.recording
    if (!r) return live.current.voice
    live.current.recording = null
    setRecording(null)
    const done = await r.stop()
    if (!done || done.seconds < 0.5) return null
    const v: Voice = { blob: done.blob, url: URL.createObjectURL(done.blob), seconds: Math.min(done.seconds, MAX_AUDIO_SECONDS) }
    if (!alive.current) { URL.revokeObjectURL(v.url); return null }
    live.current.voice = v
    setVoice(v)
    return v
  }
  const removeVoice = () => setVoice(v => { if (v) URL.revokeObjectURL(v.url); return null })

  async function locate(on: boolean) {
    setUsePosition(on)
    remember(POSITION_KEY, on ? '1' : '0')
    if (!on) { setPosition(null); return }
    setLocating(true)
    setPosition(await currentPosition())
    setLocating(false)
  }

  const shown = useMemo(() => {
    const q = find.trim().toLowerCase()
    const pool = activities.filter(a => !codes.includes(a.code))
    if (!q) return pool.filter(a => a.state === 'in_progress').slice(0, 5)
    return pool.filter(a => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)).slice(0, 8)
  }, [find, activities, codes])
  // What the phone's position says about the place. It can point to a room; it can never choose the floor.
  const near = useMemo(() => (usePosition && position && plans.length ? locatePlace(plans, position, level.trim() || null) : null), [usePosition, position, plans, level])
  const levelsHere = useMemo(() => [...new Set((near?.points ?? []).map(p => p.level))], [near])
  useEffect(() => {
    if (!near?.best || room.trim() || placeSource === 'code') return
    setRoom(near.best.room); setPlaceSource('position')
  }, [near]) // eslint-disable-line react-hooks/exhaustive-deps
  const levelPlan = useMemo(() => plans.find(p => sameLevel(p.level, level)) ?? null, [plans, level])
  const levelFit = useMemo(() => (levelPlan ? fitPlan(levelPlan) : null), [levelPlan])
  useEffect(() => { if (pin && pin.planId !== levelPlan?.id) setPin(null) }, [levelPlan, pin])
  const hereOnPlan = useMemo(() => {
    if (!levelPlan || !levelFit || !usePosition || !position) return null
    const p = levelFit.toPlan(position)
    return onSheet(p, 0) ? { ...p, rx: (position.accuracyM ?? 0) / levelFit.widthM, ry: (position.accuracyM ?? 0) / (levelFit.widthM * levelPlan.height / levelPlan.width) } : null
  }, [levelPlan, levelFit, usePosition, position])
  function pinAt(p: { x: number; y: number }) {
    if (!levelPlan) return
    setPin({ planId: levelPlan.id, x: p.x, y: p.y })
    const r = roomAt(levelPlan, p)
    if (r && (!room.trim() || placeSource === 'position')) { setRoom(r.name); setPlaceSource('picked') }
  }
  const roomsHere = useMemo(() => [...new Set(rooms.filter(r => !level || !r.level || r.level === level).map(r => r.room))], [rooms, level])
  const nameOf = (code: string) => activities.find(a => a.code === code)?.name ?? ''

  async function save() {
    // Saving while the microphone is still on keeps what was said: the recording is stopped and used.
    const spoken = recording ? await stopRecording() : voice
    if (!status) { setError('Say what you saw: in progress, done, not started or a problem.'); return }
    if (!(photos.length > 0 || !!spoken || note.trim().length >= 3)) { setError('Add a photo, a voice note or a few words.'); return }
    setBusy(true); setError('')
    const fields: Record<string, string> = {
      status, note: note.trim(), activityCodes: JSON.stringify(codes), level: level.trim(), room: room.trim(),
      placeSource: level.trim() || room.trim() ? (placeSource === 'none' ? 'picked' : placeSource) : 'none',
      takenAt: takenAt.current ?? new Date().toISOString(),
    }
    if (pin) { fields.planId = pin.planId; fields.planX = String(pin.x); fields.planY = String(pin.y) }
    if (usePosition && position) {
      fields.lat = String(position.lat); fields.lng = String(position.lng)
      if (position.accuracyM != null) fields.accuracyM = String(position.accuracyM)
      if (position.altitudeM != null) fields.altitudeM = String(position.altitudeM)
      if (position.headingDeg != null) fields.headingDeg = String(position.headingDeg)
    }
    const pending: PendingCapture = {
      id: crypto.randomUUID(), userId, scheduleId, fields, photos: photos.map(p => p.blob), audio: spoken?.blob ?? null,
      audioSeconds: spoken?.seconds ?? null, savedAt: new Date().toISOString(),
    }
    const r = await sendCapture(pending)
    if (level.trim() || room.trim()) remember(placeKey(scheduleId), JSON.stringify({ level: level.trim(), room: room.trim() }))
    if (r.ok) { setBusy(false); onSaved({ capture: r.capture, queued: false }); return }
    if (r.offline && await outboxAdd(pending)) { setBusy(false); onSaved({ capture: null, queued: true }); return }
    setBusy(false)
    setError(r.offline ? 'No connection, and this browser would not keep the capture. Stay on this screen and try again when you have signal.' : r.error)
  }

  const field = 'w-full rounded-lg border border-warm-300 bg-white px-3 h-11 text-body text-ink placeholder:text-warm-600'
  return createPortal(
    <div className={`${digitsFont.variable} font-sans fixed inset-0 z-50 overflow-y-auto bg-navy-950/45 md:p-8 flex justify-center items-start`} onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="relative w-full min-h-full md:min-h-0 md:max-w-xl bg-white md:rounded-2xl md:border md:border-warm-200 p-5 md:p-6 pb-28 md:pb-6">
        <button ref={closeBtn} type="button" onClick={onClose} disabled={busy} aria-label="Close" className="absolute right-3 top-3 inline-flex items-center justify-center w-10 h-10 rounded-lg text-ink hover:bg-warm-100"><X size={18} aria-hidden="true" /></button>
        <h2 id={titleId} className="text-heading font-semibold text-ink pr-10">New capture</h2>
        <p className="text-caption text-warm-600 truncate pr-10">{projectName}</p>

        <div className="mt-4 space-y-5">
          {/* The photo comes first: on a phone the button opens the camera. */}
          <div>
            <input ref={fileInput} type="file" accept="image/*" capture="environment" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={e => addPhotos(e.target.files)} />
            {photos.length > 0 && (
              <ul className="mb-2 grid grid-cols-4 gap-2" aria-label="Photos in this capture">
                {photos.map((p, i) => (
                  <li key={p.url} className="relative aspect-square overflow-hidden rounded-lg border border-warm-200 bg-warm-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                    {/* A full-size touch target; the mark inside it stays small so the photo shows. */}
                    <button type="button" onClick={() => removePhoto(i)} aria-label={`Remove photo ${i + 1}`} className="absolute right-0 top-0 inline-flex h-11 w-11 items-start justify-end p-1"><span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-navy-950 text-white"><X size={14} aria-hidden="true" /></span></button>
                  </li>
                ))}
              </ul>
            )}
            {photos.length < MAX_PHOTOS_PER_CAPTURE && (
              <button type="button" onClick={() => fileInput.current?.click()} disabled={preparing || busy}
                className={`pressable w-full inline-flex items-center justify-center gap-2 rounded-lg border border-warm-300 bg-white text-ink text-body font-semibold hover:bg-warm-100 ${photos.length ? 'h-11' : 'h-24'}`}>
                {preparing ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Camera size={photos.length ? 16 : 20} aria-hidden="true" />}
                {preparing ? 'Preparing the photo…' : photos.length ? 'Add another photo' : 'Take a photo'}
              </button>
            )}
          </div>

          <fieldset>
            <legend className="text-body font-medium text-ink mb-1.5">What does it show?</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {CAPTURE_STATUSES.map(s => (
                <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}
                  className={`pressable rounded-lg border px-2 h-11 text-body font-semibold ${status === s ? (s === 'issue' ? 'border-status-at-risk bg-status-at-risk-bg text-status-at-risk' : 'border-accent-600 bg-accent-100 text-accent-700') : 'border-warm-300 bg-white text-ink hover:bg-warm-100'}`}>
                  {CAPTURE_STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor={`${titleId}-note`} className="block text-body font-medium text-ink mb-1.5">Note</label>
            {canRecordAudio() && (
              <div className="mb-2">
                {recording ? (
                  <button type="button" onClick={stopRecording} className="pressable w-full inline-flex items-center justify-center gap-2 rounded-lg border border-status-at-risk bg-status-at-risk-bg text-status-at-risk h-11 text-body font-semibold">
                    <Square size={14} aria-hidden="true" fill="currentColor" /> Stop <span className="tabular-nums font-medium" role="timer" aria-live="off">{clock(elapsed)}</span>
                  </button>
                ) : voice ? (
                  <div className="flex items-center gap-2">
                    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                    <audio controls src={voice.url} className="h-11 min-w-0 flex-1" aria-label={`Voice note, ${clock(voice.seconds)}`} />
                    <button type="button" onClick={removeVoice} aria-label="Delete the voice note" className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border border-warm-300 text-ink hover:bg-warm-100"><Trash2 size={16} aria-hidden="true" /></button>
                  </div>
                ) : (
                  <button type="button" onClick={record} disabled={busy} className="pressable w-full inline-flex items-center justify-center gap-2 rounded-lg border border-warm-300 bg-white text-ink h-11 text-body font-semibold hover:bg-warm-100">
                    <Mic size={16} aria-hidden="true" /> Record a voice note
                  </button>
                )}
              </div>
            )}
            <textarea id={`${titleId}-note`} value={note} onChange={e => setNote(e.target.value)} maxLength={MAX_NOTE_CHARS} rows={3}
              placeholder="Type it, or use the microphone on your keyboard to dictate"
              className="w-full rounded-lg border border-warm-300 bg-white px-3 py-2 text-body text-ink placeholder:text-warm-600" />
          </div>

          <fieldset>
            <legend className="text-body font-medium text-ink mb-1.5">Where</legend>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor={`${titleId}-level`} className="sr-only">Level</label>
                <input id={`${titleId}-level`} list={levelList} value={level} maxLength={MAX_PLACE_CHARS} placeholder="Level" autoComplete="off"
                  onChange={e => { setLevel(e.target.value); setPlaceSource('picked') }} className={field} />
                <datalist id={levelList}>{levels.map(l => <option key={l} value={l} />)}</datalist>
              </div>
              <div>
                <label htmlFor={`${titleId}-room`} className="sr-only">Room or area</label>
                <input id={`${titleId}-room`} list={roomList} value={room} maxLength={MAX_PLACE_CHARS} placeholder="Room or area" autoComplete="off"
                  onChange={e => { setRoom(e.target.value); setPlaceSource('picked') }} className={field} />
                <datalist id={roomList}>{roomsHere.map(r => <option key={r} value={r} />)}</datalist>
              </div>
            </div>
            <label className="mt-2 text-body text-warm-700">
              <input type="checkbox" checked={usePosition} onChange={e => locate(e.target.checked)} />
              <span className="inline-flex flex-wrap items-center gap-x-1.5">
                <MapPin size={14} aria-hidden="true" className="text-warm-600" /> Add my position
                <span className="text-caption text-warm-600" role="status">
                  {!usePosition ? '' : locating ? 'finding it…' : position ? accuracyLabel(position.accuracyM) : 'not available: allow location for RunF9 in your browser'}
                </span>
              </span>
            </label>
            <div aria-live="polite" className="space-y-2">
              {near?.onSite && !level.trim() && levelsHere.length > 0 && (
                <div role="group" aria-label="Which level are you on?" className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-body text-warm-700">Which level are you on?</span>
                  {levelsHere.map(l => <button key={l} type="button" onClick={() => { setLevel(l); setPlaceSource('picked') }} className="pressable rounded-lg border border-warm-300 bg-white px-3 h-9 text-body font-semibold text-ink hover:bg-warm-100">{l}</button>)}
                </div>
              )}
              {placeSource === 'position' && room.trim() && <p className="mt-2 text-caption text-warm-600">Room suggested from your position. Change it if it is wrong; a phone cannot tell one floor from another.</p>}
              {near?.onSite && placeSource !== 'position' && !room.trim() && level.trim() && near.rooms.length > 0 && (
                <div role="group" aria-label="Rooms near you" className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-body text-warm-700">Near you:</span>
                  {near.rooms.slice(0, 4).map(r => <button key={`${r.level}-${r.room}`} type="button" onClick={() => { setRoom(r.room); setPlaceSource('position') }} className="pressable rounded-lg border border-warm-300 bg-white px-3 h-9 text-body font-semibold text-ink hover:bg-warm-100">{r.room}</button>)}
                </div>
              )}
            </div>
            {levelPlan && (
              <div className="mt-2 space-y-2">
                <button type="button" aria-expanded={pinning} onClick={() => setPinning(v => !v)} className="pressable inline-flex items-center gap-1.5 rounded-lg border border-warm-300 bg-white px-3 h-9 text-body font-semibold text-ink hover:bg-warm-100">
                  <MapPin size={14} aria-hidden="true" /> {pin ? 'Pinned on the drawing' : 'Pin it on the drawing'}
                </button>
                {pinning && (
                  <>
                    <PlanView src={`/api/schedules/${encodeURIComponent(scheduleId)}/site-plans/${encodeURIComponent(levelPlan.id)}/image`} alt={`Drawing of ${levelPlan.level}`}
                      marks={[...levelPlan.rooms.slice(0, 60).map(r => ({ id: r.id, tone: 'room' as const, x: r.x, y: r.y, label: `Room ${r.name}`, text: r.name })), ...(pin ? [{ id: 'pin', tone: 'pick' as const, x: pin.x, y: pin.y, label: 'Where this capture is pinned' }] : [])]}
                      here={hereOnPlan} onTap={pinAt} tapLabel="Pin this capture on the drawing" />
                    {pin && <button type="button" onClick={() => setPin(null)} className="text-body font-medium text-accent-600 hover:underline">Remove the pin</button>}
                  </>
                )}
              </div>
            )}
          </fieldset>

          {activities.length > 0 && (
            <div>
              <label htmlFor={`${titleId}-act`} className="block text-body font-medium text-ink mb-1.5">Activity</label>
              {codes.length > 0 && (
                <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Activities in this capture">
                  {codes.map(c => (
                    <li key={c} className="inline-flex max-w-full items-center gap-1 rounded-lg bg-accent-100 pl-2.5 text-body text-accent-700">
                      <span className="truncate"><span className="font-semibold tabular-nums">{c}</span> {nameOf(c)}</span>
                      <button type="button" onClick={() => setCodes(x => x.filter(y => y !== c))} aria-label={`Remove ${c}`} className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center"><X size={14} aria-hidden="true" /></button>
                    </li>
                  ))}
                </ul>
              )}
              <input id={`${titleId}-act`} value={find} onChange={e => setFind(e.target.value)} placeholder="Find an activity by ID or name" autoComplete="off" className={field} />
              {shown.length > 0 && (
                <ul className="mt-1.5 divide-y divide-warm-200 rounded-lg border border-warm-200" aria-label={find.trim() ? 'Matching activities' : 'Under way now'}>
                  {shown.map(a => (
                    <li key={a.code}>
                      <button type="button" onClick={() => { setCodes(x => [...x, a.code]); setFind('') }} className="flex w-full items-baseline gap-2 px-3 py-2 text-left text-body hover:bg-warm-100">
                        <span className="flex-shrink-0 font-semibold tabular-nums text-ink">{a.code}</span>
                        <span className="min-w-0 flex-1 text-warm-700">{a.name}</span>
                        <span className="flex-shrink-0 text-caption text-warm-600">{a.state === 'in_progress' ? 'under way' : a.state === 'complete' ? 'complete' : 'not started'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div aria-live="polite">{error && <Alert tone="error">{error}</Alert>}</div>
        </div>

        {/* One button, always in reach of the thumb on a phone. */}
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-warm-200 bg-white p-3 md:static md:mt-5 md:border-0 md:p-0">
          <button type="button" onClick={save} disabled={busy || preparing}
            className="pressable w-full inline-flex items-center justify-center gap-2 rounded-lg bg-accent-600 hover:bg-accent-700 text-white h-12 md:h-10 text-body font-semibold">
            {busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}{busy ? 'Saving…' : 'Save capture'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
