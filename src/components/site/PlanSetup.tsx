'use client'

// Setting up a project's drawings: add a picture of each level, mark its rooms, place it on the ground with two
// or three matched points, and print the room codes. For people who can change the schedule.

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, MapPin, Trash2, X } from 'lucide-react'
import { digitsFont } from '@/app/fonts/digits'
import { Alert } from '@/components/ui'
import { AerialMap, PlanView, type GeoMark, type PlanMark } from './PlanCanvas'
import { accuracyLabel, currentPosition, resizePlanImage } from '@/lib/site/client'
import { MAX_PLAN_NAME_CHARS, PLAN_MAX_SIDE, fitPlan, type PlanControl, type PlanPoint, type PlanRoom, type SitePlan } from '@/lib/site/plan'

export interface SiteImagery { attribution: string; maxZoom: number }
type Mode = 'rooms' | 'place' | 'codes'
const MODES: { id: Mode; label: string }[] = [{ id: 'rooms', label: 'Rooms' }, { id: 'place', label: 'Place on the ground' }, { id: 'codes', label: 'Room codes' }]

export function PlanSetup({ scheduleId, plans, imagery, initialPlanId, onChanged, onClose }: {
  scheduleId: string
  plans: SitePlan[]
  imagery: SiteImagery | null
  initialPlanId?: string | null
  /** Called with the project's drawings after every saved change */
  onChanged: (plans: SitePlan[]) => void
  onClose: () => void
}) {
  const base = `/api/schedules/${encodeURIComponent(scheduleId)}/site-plans`
  const [selected, setSelected] = useState<string | null>(initialPlanId ?? plans[0]?.id ?? null)
  const [mode, setMode] = useState<Mode>('rooms')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [level, setLevel] = useState('')
  const [pick, setPick] = useState<PlanPoint | null>(null)
  const [roomName, setRoomName] = useState('')
  const [ground, setGround] = useState<{ lat: number; lng: number } | null>(null)
  const [goTo, setGoTo] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const roomInput = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const plan = plans.find(p => p.id === selected) ?? null
  const fit = useMemo(() => (plan ? fitPlan(plan) : null), [plan])
  const image = (id: string) => `${base}/${encodeURIComponent(id)}/image`

  // Focus moves into the dialog once, when it opens: never again while the person is working in it.
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
  // Points being matched again, before there are enough of them to save: kept here, so the drawing stays
  // placed everywhere else until the new placement is saved.
  const [draft, setDraft] = useState<PlanControl[] | null>(null)
  useEffect(() => { setPick(null); setRoomName(''); setError(''); setDraft(null) }, [selected, mode])
  const choose = (id: string) => { setNotice(''); setSelected(id) }
  const switchMode = (m: Mode) => { setNotice(''); setMode(m) }
  useEffect(() => { if (pick && mode === 'rooms') roomInput.current?.focus() }, [pick, mode])
  // The aerial picture opens on the site: where the drawing already sits, else wherever it was last moved to.
  useEffect(() => { if (plan?.controls[0]) setGround({ lat: plan.controls[0].lat, lng: plan.controls[0].lng }) }, [plan?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function call(url: string, init: RequestInit, fail: string): Promise<Record<string, unknown> | null> {
    setBusy(true); setError(''); setNotice('')
    try {
      const res = await fetch(url, init)
      const d = await res.json().catch(() => null)
      if (!res.ok) { setError(d?.error || fail); return null }
      return d ?? {}
    } catch { setError(`${fail} Check your connection and try again.`); return null }
    finally { setBusy(false) }
  }
  const replace = (p: SitePlan) => onChanged(plans.map(x => (x.id === p.id ? p : x)))
  async function patch(body: Record<string, unknown>, fail: string): Promise<SitePlan | null> {
    if (!plan) return null
    const d = await call(`${base}/${encodeURIComponent(plan.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, fail)
    if (!d?.plan) return null
    replace(d.plan as SitePlan)
    return d.plan as SitePlan
  }

  async function add(files: FileList | null) {
    const f = files?.[0]
    if (!f) return
    if (!level.trim()) { setError('Name the level this drawing shows first, for example "Level 2".'); if (file.current) file.current.value = ''; return }
    setBusy(true); setError('')
    let blob: Blob
    try { blob = (await resizePlanImage(f, PLAN_MAX_SIDE)).blob }
    catch { setBusy(false); setError('That file could not be read as a picture. Export the sheet as an image (PNG or JPEG), or take a screenshot of it.'); if (file.current) file.current.value = ''; return }
    const fd = new FormData()
    fd.set('level', level.trim()); fd.set('image', blob, 'drawing.jpg')
    const d = await call(base, { method: 'POST', body: fd }, 'The drawing could not be added.')
    if (file.current) file.current.value = ''
    if (!d?.plan) return
    const p = d.plan as SitePlan
    onChanged([...plans, p]); setSelected(p.id); setMode('rooms'); setLevel('')
    setNotice(`${p.level} was added. Tap the drawing to mark its rooms.`)
  }
  async function remove() {
    if (!plan || !window.confirm(`Delete the drawing of ${plan.level}? Captures keep their level and room.`)) return
    const d = await call(`${base}/${encodeURIComponent(plan.id)}`, { method: 'DELETE' }, 'The drawing could not be deleted.')
    if (!d) return
    const rest = plans.filter(p => p.id !== plan.id)
    onChanged(rest); setSelected(rest[0]?.id ?? null)
  }
  async function addRoom() {
    if (!plan || !pick) return
    const name = roomName.trim()
    if (!name) { setError('Type the room name.'); return }
    const saved = await patch({ rooms: [...plan.rooms, { name, x: pick.x, y: pick.y }] }, 'The room could not be added.')
    if (saved) { setPick(null); setRoomName('') }
  }
  const removeRoom = (r: PlanRoom) => patch({ rooms: plan!.rooms.filter(x => x.id !== r.id) }, 'The room could not be removed.')

  async function match(g: { lat: number; lng: number }, how: string) {
    if (!plan || !pick) return
    // Two points place a drawing; a third lets the sheet bend a little. Matching a point on a drawing that
    // already has three starts a new placement, which replaces the saved one only when it can be saved.
    const base: PlanControl[] = draft ?? (plan.controls.length >= 3 ? [] : plan.controls)
    const next = [...base, { x: pick.x, y: pick.y, lat: g.lat, lng: g.lng }]
    setPick(null); setGround(g)
    if (next.length === 1) {
      setDraft(next)
      setNotice(`First point matched ${how}. Now tap a second point on the drawing, far from the first.`)
      return
    }
    const saved = await patch({ controls: next }, 'The drawing could not be placed.')
    if (saved) { setDraft(null); const f = fitPlan(saved); setNotice(f ? `The drawing is placed. It is about ${Math.round(f.widthM).toLocaleString('en-US')} m wide on the ground. Check it against the picture below.` : 'The points were saved.') }
    else if (draft) setDraft(base)
  }
  async function standing() {
    setBusy(true); setError('')
    const p = await currentPosition()
    setBusy(false)
    if (!p) { setError('Your position is not available. Allow location for RunF9 in your browser, or tap the point on the aerial picture.'); return }
    if ((p.accuracyM ?? 99) > 20) { setError(`The phone is only sure of its position ${accuracyLabel(p.accuracyM)}. Step into the open and try again, or tap the point on the aerial picture.`); return }
    await match(p, `to where you are standing (${accuracyLabel(p.accuracyM)})`)
  }
  async function unplace() { if (await patch({ controls: [] }, 'The placement could not be removed.')) { setDraft(null); setNotice('The drawing is no longer placed on the ground.') } }
  async function findMe() {
    setBusy(true)
    const p = await currentPosition()
    setBusy(false)
    if (p) setGround(p); else setError('Your position is not available. Allow location for RunF9 in your browser, or type the latitude and longitude of the site.')
  }
  function go() {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(goTo)
    const lat = m ? Number(m[1]) : NaN, lng = m ? Number(m[2]) : NaN
    if (!m || Math.abs(lat) > 85 || Math.abs(lng) > 180) { setError('Type the site as latitude, longitude: for example 39.7392, -104.9903.'); return }
    setError(''); setGround({ lat, lng })
  }

  const shownControls = draft ?? plan?.controls ?? []
  const marks: PlanMark[] = !plan ? [] : mode === 'place'
    ? [...shownControls.map((c, i) => ({ id: `c${i}`, tone: 'control' as const, x: c.x, y: c.y, label: `Matched point ${i + 1}`, text: String(i + 1) })), ...(pick ? [{ id: 'pick', tone: 'pick' as const, x: pick.x, y: pick.y, label: 'The point you chose' }] : [])]
    : [...plan.rooms.map(r => ({ id: r.id, tone: 'room' as const, x: r.x, y: r.y, label: `Room ${r.name}`, text: r.name })), ...(pick ? [{ id: 'pick', tone: 'pick' as const, x: pick.x, y: pick.y, label: 'The point you chose' }] : [])]
  const geoMarks: GeoMark[] = plan && mode === 'place' ? shownControls.map((c, i) => ({ id: `g${i}`, tone: 'control' as const, lat: c.lat, lng: c.lng, label: `Matched point ${i + 1} on the ground`, text: String(i + 1) })) : []
  const field = 'rounded-lg border border-warm-300 bg-white px-3 h-11 text-body text-ink placeholder:text-warm-600'
  const quiet = 'pressable inline-flex items-center justify-center gap-1.5 rounded-lg border border-warm-300 bg-white px-3 h-11 text-body font-semibold text-ink hover:bg-warm-100'
  const primary = 'pressable inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent-600 hover:bg-accent-700 px-4 h-11 text-body font-semibold text-white'

  return createPortal(
    <div className={`${digitsFont.variable} font-sans fixed inset-0 z-50 overflow-y-auto bg-navy-950/45 md:p-8 flex justify-center items-start`} onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="relative w-full min-h-full md:min-h-0 md:max-w-3xl bg-white md:rounded-2xl md:border md:border-warm-200 p-5 md:p-6">
        <button ref={closeBtn} type="button" onClick={onClose} disabled={busy} aria-label="Close" className="absolute right-3 top-3 inline-flex items-center justify-center w-10 h-10 rounded-lg text-ink hover:bg-warm-100"><X size={18} aria-hidden="true" /></button>
        <h2 id={titleId} className="text-heading font-semibold text-ink pr-10">Drawings</h2>
        <p className="text-body text-warm-600 pr-10">One drawing for each level. Mark its rooms, then place it on the ground so a phone can suggest the room it is in.</p>

        <div className="mt-4 space-y-5">
          {plans.length > 0 && (
            <div role="group" aria-label="Level" className="flex flex-wrap gap-1.5">
              {plans.map(p => (
                <button key={p.id} type="button" aria-pressed={p.id === selected} onClick={() => choose(p.id)}
                  className={`pressable rounded-lg border px-3 h-9 text-body font-semibold ${p.id === selected ? 'border-accent-500 bg-accent-100 text-accent-700' : 'border-warm-300 bg-white text-ink hover:border-navy-900'}`}>{p.level}</button>
              ))}
            </div>
          )}

          <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); file.current?.click() }}>
            <div className="min-w-0 flex-1">
              <label htmlFor={`${titleId}-level`} className="block text-body font-medium text-ink mb-1.5">{plans.length ? 'Add another level' : 'Level'}</label>
              <input id={`${titleId}-level`} value={level} onChange={e => setLevel(e.target.value)} maxLength={MAX_PLAN_NAME_CHARS} placeholder="Level 2" autoComplete="off" className={`${field} w-full`} />
            </div>
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={e => add(e.target.files)} />
            <button type="submit" disabled={busy} className={plans.length ? quiet : primary}>{busy && !plan && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}Choose its drawing</button>
            <p className="w-full text-caption text-warm-600">A picture of the sheet: PNG or JPEG, or a screenshot of the PDF.</p>
          </form>

          <div aria-live="polite" className="space-y-2">{error && <Alert tone="error">{error}</Alert>}{notice && <Alert tone="success">{notice}</Alert>}</div>

          {plan && (
            <section aria-label={`Drawing of ${plan.level}`} className="space-y-3 border-t border-warm-200 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-subhead font-semibold text-ink">{plan.level} <span className="ml-1 text-body font-normal text-warm-600">{plan.rooms.length} {plan.rooms.length === 1 ? 'room' : 'rooms'} · {fit ? 'placed on the ground' : 'not placed yet'}</span></h3>
                <button type="button" onClick={remove} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg px-2 h-9 text-body font-medium text-status-at-risk hover:bg-status-at-risk-bg"><Trash2 size={14} aria-hidden="true" /> Delete drawing</button>
              </div>
              <div role="group" aria-label="What to set up" className="flex flex-wrap gap-1.5">
                {MODES.map(m => (
                  <button key={m.id} type="button" aria-pressed={mode === m.id} onClick={() => switchMode(m.id)}
                    className={`pressable rounded-lg border px-3 h-9 text-body font-semibold ${mode === m.id ? 'border-accent-500 bg-accent-100 text-accent-700' : 'border-warm-300 bg-white text-ink hover:border-navy-900'}`}>{m.label}</button>
                ))}
              </div>

              {mode === 'rooms' && (
                <>
                  <p className="text-body text-warm-700">Tap the drawing where a room is, then type its name.</p>
                  <PlanView src={image(plan.id)} alt={`Drawing of ${plan.level}`} marks={marks} onTap={setPick} tapLabel="Mark a room on the drawing" />
                  {pick && (
                    <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); addRoom() }}>
                      <div className="min-w-0 flex-1">
                        <label htmlFor={`${titleId}-room`} className="block text-body font-medium text-ink mb-1.5">Room name</label>
                        <input ref={roomInput} id={`${titleId}-room`} value={roomName} onChange={e => setRoomName(e.target.value)} maxLength={MAX_PLAN_NAME_CHARS} placeholder="Unit 201 kitchen" autoComplete="off" className={`${field} w-full`} />
                      </div>
                      <button type="submit" disabled={busy} className={primary}>Add room</button>
                      <button type="button" onClick={() => setPick(null)} className={quiet}>Cancel</button>
                    </form>
                  )}
                  {plan.rooms.length > 0 && (
                    <ul aria-label="Rooms on this drawing" className="flex flex-wrap gap-1.5">
                      {plan.rooms.map(r => (
                        <li key={r.id} className="inline-flex max-w-full items-center gap-1 rounded-lg bg-warm-100 pl-2.5 text-body text-ink">
                          <span className="truncate">{r.name}</span>
                          <button type="button" data-compact onClick={() => removeRoom(r)} disabled={busy} aria-label={`Remove ${r.name}`} className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center"><X size={14} aria-hidden="true" /></button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}

              {mode === 'place' && (
                <>
                  <p className="text-body text-warm-700">
                    {pick ? 'Now match that point to the ground: stand there, or tap the same point on the aerial picture.'
                      : draft ? 'Tap a second point on the drawing, far from the first.'
                      : plan.controls.length >= 2 ? 'Tap a point on the drawing to match it again, or leave it as it is.'
                      : 'Tap a point on the drawing that you can find on site, such as a corner of the building. Two points far apart place the drawing.'}
                  </p>
                  <PlanView src={image(plan.id)} alt={`Drawing of ${plan.level}`} marks={marks} onTap={setPick} tapLabel="Choose a point on the drawing to match to the ground" />
                  <div className="flex flex-wrap gap-2">
                    {pick && <button type="button" onClick={standing} disabled={busy} className={primary}>{busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <MapPin size={16} aria-hidden="true" />}I am standing at this point</button>}
                    {pick && <button type="button" onClick={() => setPick(null)} className={quiet}>Cancel</button>}
                    {!pick && plan.controls.length > 0 && <button type="button" onClick={unplace} disabled={busy} className={quiet}>Remove the placement</button>}
                  </div>
                  {imagery ? (
                    <div className="space-y-2">
                      <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); go() }}>
                        <div className="min-w-0 flex-1">
                          <label htmlFor={`${titleId}-go`} className="block text-body font-medium text-ink mb-1.5">Find the site on the aerial picture</label>
                          <input id={`${titleId}-go`} value={goTo} onChange={e => setGoTo(e.target.value)} placeholder="Latitude, longitude" inputMode="text" autoComplete="off" className={`${field} w-full`} />
                        </div>
                        <button type="submit" className={quiet}>Go</button>
                        <button type="button" onClick={findMe} disabled={busy} className={quiet}><MapPin size={16} aria-hidden="true" /> Where I am</button>
                      </form>
                      {ground ? (
                        <AerialMap center={ground} maxZoom={imagery.maxZoom} attribution={imagery.attribution} marks={geoMarks}
                          overlay={fit ? { src: image(plan.id), fit, width: plan.width, height: plan.height } : null}
                          {...(pick ? { onTap: (g: { lat: number; lng: number }) => match(g, 'on the aerial picture'), tapLabel: 'Tap the same point on the aerial picture' } : {})} />
                      ) : <p className="text-body text-warm-600">Type where the site is, or use your position, to open the aerial picture.</p>}
                    </div>
                  ) : <p className="text-body text-warm-600">The aerial picture is turned off on this deployment. Match each point by standing at it on site.</p>}
                  <p className="text-caption text-warm-600">A phone outdoors is sure of its position within a few metres, so a drawing placed by standing at two points can sit a few metres off. The aerial picture is usually closer.</p>
                </>
              )}

              {mode === 'codes' && (
                <div className="space-y-3">
                  <p className="text-body text-warm-700">Print a code for each room and post it by the door. Scanning it with a phone camera opens a new capture with {plan.level} and the room already filled in. This is the sure way to tell identical rooms on different floors apart.</p>
                  {plan.rooms.length > 0
                    ? <a href={`${base}/${encodeURIComponent(plan.id)}/codes`} className={`${primary} no-underline`}>Download the room codes (PDF)</a>
                    : <p className="text-body text-warm-600">Mark the rooms on this drawing first.</p>}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
