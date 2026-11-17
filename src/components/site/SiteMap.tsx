'use client'

// The project's captures on the drawing of each level, and on the aerial picture of the ground. With the phone's
// position switched on it also shows where the person is standing, with the phone's own stated uncertainty.

import { useEffect, useMemo, useState } from 'react'
import { MapPin } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { Alert } from '@/components/ui'
import { AerialMap, PlanView, type GeoMark, type PlanMark } from './PlanCanvas'
import type { SiteImagery } from './PlanSetup'
import { fmtDateTime } from '@/lib/format'
import { CAPTURE_STATUS_LABELS, captureSummary, placeLabel, type CapturePosition, type SiteCapture } from '@/lib/site/capture'
import { accuracyLabel, watchPosition } from '@/lib/site/client'
import { capturePoint, fitPlan, locate, onSheet, type SitePlan } from '@/lib/site/plan'

export function SiteMap({ scheduleId, plans, imagery, captures, canEdit, onSetup, onOpen }: {
  scheduleId: string
  plans: SitePlan[]
  imagery: SiteImagery | null
  captures: SiteCapture[]
  canEdit: boolean
  /** Opens the drawings set-up (on a given drawing when there is one) */
  onSetup: (planId?: string) => void
  /** Opens a capture's photos */
  onOpen: (c: SiteCapture) => void
}) {
  const [selected, setSelected] = useState<string | null>(plans[0]?.id ?? null)
  const [aerial, setAerial] = useState(false)
  const [follow, setFollow] = useState(false)
  const [position, setPosition] = useState<CapturePosition | null>(null)
  const [denied, setDenied] = useState(false)
  const [picked, setPicked] = useState<SiteCapture | null>(null)
  const plan = plans.find(p => p.id === selected) ?? plans[0] ?? null
  const fit = useMemo(() => (plan ? fitPlan(plan) : null), [plan])
  useEffect(() => { if (!plans.some(p => p.id === selected)) setSelected(plans[0]?.id ?? null) }, [plans, selected])
  useEffect(() => { setPicked(null) }, [selected])
  useEffect(() => {
    if (!follow) { setPosition(null); setDenied(false); return }
    // A fix that does not come in time keeps the last one on the drawing; only a refusal clears it.
    return watchPosition((p, why) => { if (p) { setPosition(p); setDenied(false) } else if (why === 'denied') { setPosition(null); setDenied(true) } })
  }, [follow])

  const placed = useMemo(() => {
    if (!plan) return []
    return captures.flatMap(c => { const at = capturePoint(plan, fit, c); return at ? [{ c, ...at }] : [] })
  }, [plan, fit, captures])

  if (!plan) {
    return (
      <EmptyState heading="h3" title="No drawings yet" {...(canEdit ? { action: { label: 'Add a drawing', onClick: () => onSetup() } } : {})}>
        {canEdit ? 'Add a drawing of each level to see the captures on it, and to let a phone suggest which room it is in.' : 'Once a scheduler adds a drawing of each level, the captures are shown on it.'}
      </EmptyState>
    )
  }

  const label = (c: SiteCapture) => `${CAPTURE_STATUS_LABELS[c.status]}${placeLabel(c) ? `, ${placeLabel(c)}` : ''}, ${fmtDateTime(c.takenAt)}. Show this capture.`
  const marks: PlanMark[] = [
    ...(plan.rooms.length <= 60 ? plan.rooms.map(r => ({ id: `room-${r.id}`, tone: 'room' as const, x: r.x, y: r.y, label: `Room ${r.name}`, text: r.name })) : []),
    ...placed.map(({ c, point }) => ({ id: c.id, tone: c.status, x: point.x, y: point.y, label: label(c), onSelect: () => setPicked(c) })),
  ]
  const geoMarks: GeoMark[] = fit ? placed.map(({ c, point }) => ({ id: c.id, tone: c.status, ...fit.toGeo(point), label: label(c), onSelect: () => setPicked(c) })) : []
  const herePoint = position && fit ? fit.toPlan(position) : null
  const here = herePoint && onSheet(herePoint, 0) ? { ...herePoint, rx: (position!.accuracyM ?? 0) / fit!.widthM, ry: (position!.accuracyM ?? 0) / (fit!.widthM * plan.height / plan.width) } : null
  const near = position ? locate(plans, position, plan.level) : null
  const image = `/api/schedules/${encodeURIComponent(scheduleId)}/site-plans/${encodeURIComponent(plan.id)}/image`
  const chip = (on: boolean) => `pressable inline-flex items-center gap-1.5 rounded-lg border px-3 h-9 text-body font-semibold ${on ? 'border-accent-500 bg-accent-100 text-accent-700' : 'border-warm-300 bg-white text-ink hover:border-navy-900'}`
  const photo = picked?.media.find(m => m.kind === 'photo')

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div role="group" aria-label="Level" className="flex flex-wrap gap-1.5">
          {plans.map(p => <button key={p.id} type="button" aria-pressed={p.id === plan.id} onClick={() => setSelected(p.id)} className={chip(p.id === plan.id)}>{p.level}</button>)}
        </div>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {imagery && fit && <button type="button" aria-pressed={aerial} onClick={() => setAerial(a => !a)} className={chip(aerial)}>Aerial picture</button>}
          <button type="button" aria-pressed={follow} onClick={() => setFollow(f => !f)} className={chip(follow)}><MapPin size={14} aria-hidden="true" /> Where I am</button>
          {canEdit && <button type="button" onClick={() => onSetup(plan.id)} className={chip(false)}>Drawings</button>}
        </div>
      </div>

      {follow && (
        <p role="status" className="text-body text-warm-700">
          {denied ? 'Your position is not available. Allow location for RunF9 in your browser.'
            : !position ? 'Finding your position… Step into the open if it takes long.'
            : !fit ? `Your position is known ${accuracyLabel(position.accuracyM)}, but this drawing is not placed on the ground yet, so it cannot be shown on it.`
            : !here ? `Your position (${accuracyLabel(position.accuracyM)}) is not on this drawing.`
            : near?.best ? `Your position falls on this drawing, ${accuracyLabel(position.accuracyM)}. Nearest room on ${plan.level}: ${near.best.room}. A phone cannot tell floors apart, so the level is the one you chose.`
            : near?.rooms.length ? `Your position falls on this drawing, ${accuracyLabel(position.accuracyM)}. Rooms near it on ${plan.level}: ${near.rooms.slice(0, 3).map(r => r.room).join(', ')}.`
            : `Your position falls on this drawing, ${accuracyLabel(position.accuracyM)}.`}
        </p>
      )}

      {aerial && imagery && fit ? (
        <AerialMap center={fit.toGeo({ x: 0.5, y: 0.5 })} maxZoom={imagery.maxZoom} attribution={imagery.attribution} marks={geoMarks} here={position}
          overlay={{ src: image, fit, width: plan.width, height: plan.height }} tapLabel={`Aerial picture of the site with the drawing of ${plan.level}`} />
      ) : (
        <PlanView src={image} alt={`Drawing of ${plan.level}`} marks={marks} here={here} />
      )}

      <p className="text-caption text-warm-600">
        {placed.length} of {captures.length} loaded {captures.length === 1 ? 'capture is' : 'captures are'} shown on {plan.level}: those pinned on it, in one of its rooms, or taken with a position while on this level.
        {!fit && canEdit && ' Place the drawing on the ground to show positions on it.'}
      </p>

      <div aria-live="polite">
        {picked && (
          <div className="flex gap-3 rounded-lg border border-warm-200 bg-white p-3">
            {photo && (
              <button type="button" data-compact onClick={() => onOpen(picked)} aria-label="Open the photo" className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border border-warm-200 bg-warm-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/schedules/${encodeURIComponent(scheduleId)}/captures/${encodeURIComponent(picked.id)}/media/${encodeURIComponent(photo.id)}`} alt="" className="h-full w-full object-cover" />
              </button>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-body font-semibold text-ink">{CAPTURE_STATUS_LABELS[picked.status]}{placeLabel(picked) ? ` · ${placeLabel(picked)}` : ''}</p>
              <p className="break-words text-body text-warm-700">{captureSummary(picked)}</p>
              <p className="text-caption text-warm-600"><span className="tabular-nums">{fmtDateTime(picked.takenAt)}</span> · {picked.createdByName || 'A member'}</p>
            </div>
          </div>
        )}
      </div>
      {plans.length > 0 && !plans.some(p => fitPlan(p)) && !canEdit && <Alert tone="info">These drawings are not placed on the ground yet, so a phone&apos;s position is not shown on them.</Alert>}
    </div>
  )
}
