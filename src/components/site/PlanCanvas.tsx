'use client'

// Two pictures a site plan is shown on: the drawing itself (PlanView) and the aerial picture of the ground with
// the drawing laid over it (AerialMap). Both take points to mark and, when asked, report where the person tapped.
// Neither loads anything from outside RunF9: the aerial squares come through /api/site/tiles.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { TILE_SIZE, metersPerPixel, worldToGeo, worldXY, type PlanFit, type PlanPoint } from '@/lib/site/plan'

export type MarkTone = 'issue' | 'progress' | 'complete' | 'not_started' | 'room' | 'control' | 'pick'
export interface Mark { id: string; tone: MarkTone; label: string; text?: string; onSelect?: () => void }
export interface PlanMark extends Mark, PlanPoint {}
export interface GeoMark extends Mark { lat: number; lng: number }

const DOT: Record<MarkTone, string> = {
  issue: 'bg-status-at-risk border-white', progress: 'bg-accent-600 border-white', complete: 'bg-status-on-track border-white',
  not_started: 'bg-warm-600 border-white', room: 'bg-white border-navy-900', control: 'bg-navy-950 border-white', pick: 'bg-accent-600 border-white',
}

function MarkDot({ m, style, edge }: { m: Mark; style: React.CSSProperties; /** Which side of the picture the mark is near, so its name stays inside it */ edge?: 'left' | 'right' }) {
  const dot = <span aria-hidden="true" className={`block h-3.5 w-3.5 rounded-full border-2 ${DOT[m.tone]}`} />
  const text = m.text && <span className={`pointer-events-none absolute top-full mt-0.5 whitespace-nowrap rounded-md bg-white/90 px-1 text-caption font-medium text-ink ${edge === 'right' ? 'right-0' : edge === 'left' ? 'left-0' : 'left-1/2 -translate-x-1/2'}`}>{m.text}</span>
  return m.onSelect ? (
    <button type="button" data-compact data-mark={m.tone} onClick={e => { e.stopPropagation(); m.onSelect!() }} aria-label={m.label} style={style}
      className="absolute z-10 inline-flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full">{dot}{text}</button>
  ) : (
    <span role="img" data-mark={m.tone} aria-label={m.label} style={style} className="absolute z-10 inline-flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center">{dot}{text}</span>
  )
}

const zoomBtn = 'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-warm-300 bg-white text-ink hover:bg-warm-100 disabled:text-warm-600'
function ZoomButtons({ onIn, onOut, canIn, canOut }: { onIn: () => void; onOut: () => void; canIn: boolean; canOut: boolean }) {
  return (
    <div className="absolute right-2 top-2 z-20 flex flex-col gap-1">
      <button type="button" data-compact onClick={onIn} disabled={!canIn} aria-label="Zoom in" className={zoomBtn}><Plus size={16} aria-hidden="true" /></button>
      <button type="button" data-compact onClick={onOut} disabled={!canOut} aria-label="Zoom out" className={zoomBtn}><Minus size={16} aria-hidden="true" /></button>
    </div>
  )
}

/**
 * A level's drawing with points marked on it. With `onTap` the drawing takes a point: a tap or click, or from
 * the keyboard the arrow keys move a cross and Enter places it.
 */
export function PlanView({ src, alt, marks, here, onTap, tapLabel, className = '' }: {
  src: string
  alt: string
  marks: PlanMark[]
  /** The phone's position on this drawing and how far off it may be, as fractions of the sheet */
  here?: { x: number; y: number; rx: number; ry: number } | null
  onTap?: (p: PlanPoint) => void
  /** What a tap does, for people using the keyboard or a screen reader: "Place the room on the drawing" */
  tapLabel?: string
  className?: string
}) {
  const [zoom, setZoom] = useState(1)
  const [cross, setCross] = useState<PlanPoint | null>(null)
  const sheet = useRef<HTMLDivElement>(null)
  const clamp = (v: number) => Math.max(0, Math.min(1, v))
  function tap(e: React.MouseEvent) {
    if (!onTap || !sheet.current) return
    const r = sheet.current.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return
    onTap({ x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) })
  }
  function key(e: React.KeyboardEvent) {
    if (!onTap || e.target !== e.currentTarget) return
    const step = e.shiftKey ? 0.05 : 0.01, c = cross ?? { x: 0.5, y: 0.5 }
    const move: Record<string, PlanPoint> = { ArrowLeft: { x: c.x - step, y: c.y }, ArrowRight: { x: c.x + step, y: c.y }, ArrowUp: { x: c.x, y: c.y - step }, ArrowDown: { x: c.x, y: c.y + step } }
    if (move[e.key]) { e.preventDefault(); setCross({ x: clamp(move[e.key].x), y: clamp(move[e.key].y) }) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(c) }
  }
  return (
    <div className={`relative ${className}`}>
      <ZoomButtons onIn={() => setZoom(z => Math.min(4, z * 1.5))} onOut={() => setZoom(z => Math.max(1, z / 1.5))} canIn={zoom < 4} canOut={zoom > 1} />
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-warm-200 bg-warm-50">
        <div ref={sheet} data-plan-sheet className={`relative ${onTap ? 'cursor-crosshair' : ''}`} style={{ width: `${zoom * 100}%` }} onClick={tap}
          {...(onTap ? { tabIndex: 0, role: 'application', 'aria-label': `${tapLabel ?? 'Choose a point on the drawing'}. Arrow keys move the cross, Enter places it.`, onKeyDown: key, onBlur: () => setCross(null) } : {})}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} draggable={false} className="block w-full select-none" />
          {here && (
            <>
              <span aria-hidden="true" className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent-600 bg-accent-600/15" style={{ left: `${here.x * 100}%`, top: `${here.y * 100}%`, width: `${here.rx * 200}%`, height: `${here.ry * 200}%` }} />
              <span role="img" data-here aria-label="Your position" className="absolute z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent-600" style={{ left: `${here.x * 100}%`, top: `${here.y * 100}%` }} />
            </>
          )}
          {marks.map(m => <MarkDot key={m.id} m={m} edge={m.x > 0.75 ? 'right' : m.x < 0.25 ? 'left' : undefined} style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }} />)}
          {cross && <span aria-hidden="true" className="pointer-events-none absolute z-20 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent-600" style={{ left: `${cross.x * 100}%`, top: `${cross.y * 100}%` }} />}
        </div>
      </div>
    </div>
  )
}

/**
 * The aerial picture of the ground around a place, with a drawing laid over it where it has been placed.
 * Drag to move, the buttons (or + and −) to zoom. With `onTap` it takes a point on the ground: a tap, or from
 * the keyboard the arrow keys move the picture under the cross in the middle and Enter takes that point.
 */
export function AerialMap({ center, zoom: startZoom = 18, maxZoom, attribution, overlay, marks, here, onTap, tapLabel, className = '' }: {
  center: { lat: number; lng: number }
  zoom?: number
  /** The deepest zoom the source has pictures for; closer than that, the last pictures are enlarged */
  maxZoom: number
  attribution: string
  overlay?: { src: string; fit: PlanFit; width: number; height: number } | null
  marks: GeoMark[]
  here?: { lat: number; lng: number; accuracyM: number | null } | null
  onTap?: (p: { lat: number; lng: number }) => void
  tapLabel?: string
  className?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState({ ...center, z: Math.min(startZoom, maxZoom + 3) })
  const drag = useRef<{ x: number; y: number; lat: number; lng: number; moved: boolean } | null>(null)
  useEffect(() => { setView(v => ({ ...v, ...center })) }, [center.lat, center.lng]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Squares are asked for at the deepest zoom the source has; beyond it they are drawn larger.
  const tz = Math.min(view.z, maxZoom), scale = 2 ** (view.z - tz) * TILE_SIZE
  const c = worldXY(view.lat, view.lng, tz)
  const toScreen = (p: { lat: number; lng: number }) => { const w = worldXY(p.lat, p.lng, tz); return { x: (w.x - c.x) * scale + size.w / 2, y: (w.y - c.y) * scale + size.h / 2 } }
  const toGeo = (x: number, y: number) => worldToGeo(c.x + (x - size.w / 2) / scale, c.y + (y - size.h / 2) / scale, tz)
  const tiles = useMemo(() => {
    if (!size.w || !size.h) return []
    const n = 2 ** tz, out: { key: string; x: number; y: number; left: number; top: number }[] = []
    const x0 = Math.floor(c.x - size.w / 2 / scale), x1 = Math.floor(c.x + size.w / 2 / scale), y0 = Math.floor(c.y - size.h / 2 / scale), y1 = Math.floor(c.y + size.h / 2 / scale)
    for (let y = Math.max(0, y0); y <= Math.min(n - 1, y1); y++) for (let x = x0; x <= x1; x++) {
      if (out.length >= 64) break
      out.push({ key: `${tz}/${x}/${y}`, x: ((x % n) + n) % n, y, left: (x - c.x) * scale + size.w / 2, top: (y - c.y) * scale + size.h / 2 })
    }
    return out
  }, [c.x, c.y, scale, size.w, size.h, tz])

  const pan = (dx: number, dy: number) => setView(v => { const g = worldToGeo(c.x - dx / scale, c.y - dy / scale, tz); return { ...v, lat: Math.max(-85, Math.min(85, g.lat)), lng: g.lng } })
  const setZoom = (d: number) => setView(v => ({ ...v, z: Math.max(3, Math.min(maxZoom + 3, v.z + d)) }))
  function down(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest('button')) return
    drag.current = { x: e.clientX, y: e.clientY, lat: view.lat, lng: view.lng, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function move(e: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < 6) return
    d.moved = true
    const start = worldXY(d.lat, d.lng, tz), g = worldToGeo(start.x - dx / scale, start.y - dy / scale, tz)
    setView(v => ({ ...v, lat: Math.max(-85, Math.min(85, g.lat)), lng: g.lng }))
  }
  function up(e: React.PointerEvent) {
    const d = drag.current
    drag.current = null
    if (!d || d.moved || !onTap || !box.current) return
    const r = box.current.getBoundingClientRect()
    onTap(toGeo(e.clientX - r.left, e.clientY - r.top))
  }
  function key(e: React.KeyboardEvent) {
    if (e.target !== e.currentTarget) return
    const step = e.shiftKey ? 120 : 30
    const by: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
    if (by[e.key]) { e.preventDefault(); pan(...by[e.key]) }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(1) }
    else if (e.key === '-') { e.preventDefault(); setZoom(-1) }
    else if (onTap && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onTap({ lat: view.lat, lng: view.lng }) }
  }

  // The drawing as a picture stretched onto the ground: where three of its corners fall on the screen.
  let overlayStyle: React.CSSProperties | null = null
  if (overlay && size.w) {
    const p00 = toScreen(overlay.fit.toGeo({ x: 0, y: 0 })), p10 = toScreen(overlay.fit.toGeo({ x: 1, y: 0 })), p01 = toScreen(overlay.fit.toGeo({ x: 0, y: 1 }))
    const m = [(p10.x - p00.x) / overlay.width, (p10.y - p00.y) / overlay.width, (p01.x - p00.x) / overlay.height, (p01.y - p00.y) / overlay.height, p00.x, p00.y]
    if (m.every(Number.isFinite)) overlayStyle = { width: overlay.width, height: overlay.height, transformOrigin: '0 0', transform: `matrix(${m.join(',')})` }
  }
  const hereAt = here && size.w ? toScreen(here) : null
  const hereR = here?.accuracyM ? here.accuracyM / metersPerPixel(here.lat, view.z) : 0
  return (
    <div ref={box} data-aerial-map className={`relative h-[60vh] min-h-[320px] touch-none select-none overflow-hidden rounded-lg border border-warm-200 bg-warm-100 ${onTap ? 'cursor-crosshair' : 'cursor-grab'} ${className}`}
      tabIndex={0} role="application" aria-label={`${tapLabel ?? 'Aerial picture of the site'}. Arrow keys move it, plus and minus zoom${onTap ? ', Enter takes the point under the cross' : ''}.`}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null }} onKeyDown={key}>
      {tiles.map(t => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={t.key} src={`/api/site/tiles/${tz}/${t.x}/${t.y}`} alt="" draggable={false} className="pointer-events-none absolute max-w-none" style={{ left: t.left, top: t.top, width: scale + 0.5, height: scale + 0.5 }}
          onError={e => { e.currentTarget.style.visibility = 'hidden' }} />
      ))}
      {overlay && overlayStyle && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={overlay.src} alt="" draggable={false} data-plan-overlay className="pointer-events-none absolute left-0 top-0 max-w-none opacity-70" style={overlayStyle} />
      )}
      {hereAt && (
        <>
          {hereR > 8 && <span aria-hidden="true" className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent-600 bg-accent-600/15" style={{ left: hereAt.x, top: hereAt.y, width: hereR * 2, height: hereR * 2 }} />}
          <span role="img" data-here aria-label="Your position" className="absolute z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent-600" style={{ left: hereAt.x, top: hereAt.y }} />
        </>
      )}
      {size.w > 0 && marks.map(m => { const p = toScreen(m); return <MarkDot key={m.id} m={m} style={{ left: p.x, top: p.y }} /> })}
      {onTap && <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white ring-1 ring-navy-950" />}
      <ZoomButtons onIn={() => setZoom(1)} onOut={() => setZoom(-1)} canIn={view.z < maxZoom + 3} canOut={view.z > 3} />
      {attribution && <p className="absolute bottom-0 right-0 z-10 rounded-tl-md bg-white px-1.5 py-0.5 text-caption text-warm-700">{attribution}</p>}
    </div>
  )
}
