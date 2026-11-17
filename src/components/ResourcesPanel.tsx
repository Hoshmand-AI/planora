'use client'

// Resource analysis: one sentence that says whether anything is over its limit, the resources with peak
// vs available, a histogram per resource (demand bars against an availability line; over-allocated
// periods hatched, named in the key and listed in words), the over-allocations with the activities
// contributing, and, folded, leveling / smoothing with a staffing what-if.
// Works for an uploaded schedule (/api/schedules/{id}/resources) and a plan (/api/plans/{id}/resources).

import { askText } from '@/components/AskText'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { fmtDate } from '@/lib/format'
import { Hint, Alert, Button, inputClass, postJson } from './ui'
import { Disclosure } from './Disclosure'
import type { HistogramBar, HistogramBucket, OverAllocationPeriod, ResourceAnalysis, ResourceSummary } from '@/lib/analysis/resources'
import type { LevelingResult } from '@/lib/planning/leveling'

type Analysis = ResourceAnalysis & { availability?: Record<string, number>; basis?: string; editsApplied?: number; levelingEdits?: number; editable?: boolean; hasLogic?: boolean; basisNote?: string | null }
type Preview = { result: LevelingResult; leveled: ResourceAnalysis | null }

const n = (v: number | null | undefined) => (v == null ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 }))
const SOURCE_LABEL: Record<string, string> = { file: 'from the file', assumed_one_crew: 'assumed: one crew', what_if: 'what-if', unlimited: 'not limited' }

export function ResourcesPanel({ kind, id, canEdit }: { kind: 'schedule' | 'plan'; id: string; canEdit: boolean }) {
  const base = kind === 'schedule' ? `/api/schedules/${id}/resources` : `/api/plans/${id}/resources`
  const [bucket, setBucket] = useState<HistogramBucket>('week')
  const [basis, setBasis] = useState<'submitted' | 'scenario'>('submitted')
  const [data, setData] = useState<Analysis | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [staffing, setStaffing] = useState<Record<string, number>>({})
  const [refresh, setRefresh] = useState(0)

  // Figures belong to one schedule or plan: a different one starts empty.
  useEffect(() => { setData(null) }, [base])
  useEffect(() => {
    let live = true
    setLoading(true); setError('')
    const q = new URLSearchParams({ bucket, ...(basis === 'scenario' ? { basis } : {}), ...(selected && bucket === 'day' ? { resource: selected } : {}), ...(Object.keys(staffing).length ? { availability: JSON.stringify(staffing) } : {}) })
    fetch(`${base}?${q}`).then(async r => {
      const d = await r.json().catch(() => ({}))
      if (!live) return
      if (!r.ok) setError(d.error || 'Could not load the resource analysis.'); else setData(d)
    }).catch(() => live && setError('Network error. Check your connection and try again.')).finally(() => live && setLoading(false))
    return () => { live = false }
  }, [base, bucket, basis, selected, staffing, refresh])

  const resources = useMemo(() => data?.resources ?? [], [data])
  const current = resources.find(r => r.id === selected) ?? resources.find(r => r.overAllocatedDays > 0) ?? resources[0] ?? null

  const retry = <Button variant="secondary" onClick={() => setRefresh(x => x + 1)}>Try again</Button>
  if (!data) return error ? <div className="space-y-2"><Alert tone="error">{error}</Alert>{retry}</div> : <p className="text-[13px] text-warm-600" role="status">{loading ? 'Loading resources…' : ''}</p>

  return (
    <div className="space-y-6">
      {error && <div className="space-y-2"><Alert tone="error">{error} The figures below are the last ones that loaded.</Alert>{retry}</div>}
      <div className="flex flex-wrap items-center gap-4 text-[13px] text-warm-700">
        <label className="flex items-center gap-2">Period
          <select value={bucket} onChange={e => setBucket(e.target.value as HistogramBucket)} className="bg-white border border-warm-300 rounded-lg px-2 py-1">
            <option value="day">Day</option><option value="week">Week</option><option value="month">Month</option>
          </select>
        </label>
        {kind === 'schedule' && (
          <fieldset className="flex items-center gap-3">
            <legend className="sr-only">Basis</legend>
            <label><input type="radio" name="res-basis" checked={basis === 'submitted'} onChange={() => setBasis('submitted')} /> As submitted</label>
            <label><input type="radio" name="res-basis" checked={basis === 'scenario'} onChange={() => setBasis('scenario')} /> With RunF9 edits{data.levelingEdits ? ' (Leveled scenario)' : ''}</label>
          </fieldset>
        )}
        {loading && <span role="status" className="text-warm-600">Updating…</span>}
      </div>
      {data.basisNote && <p className="text-[12px] text-warm-600">{data.basisNote}</p>}

      {data.state === 'no_resource_data' ? (
        <Alert tone="info">{data.message}</Alert>
      ) : (
        <>
          <Summary data={data} />
          <ResourceTable resources={resources} current={current?.id ?? null} onSelect={setSelected} />
          {current && <HistogramSection r={current} bucket={bucket} />}
          <OverAllocations periods={data.overAllocations} />
          {/* Tools and fine print, folded: the page is about what is over its limit and when. */}
          <div className="space-y-3">
            <Staffing resources={resources} staffing={staffing} setStaffing={setStaffing} />
            <Leveling base={base} kind={kind} canEdit={canEdit && kind === 'schedule' && !!data.editable} hasLogic={data.hasLogic !== false} staffing={staffing}
              selected={current?.id ?? null} bucket={bucket} levelingEdits={data.levelingEdits ?? 0} onSaved={() => { setBasis('scenario'); setRefresh(x => x + 1) }} />
            {(data.assumptions.length > 0 || data.notes.length > 0) && (
              <Disclosure tone="card" title="Assumptions and notes" meta={data.assumptions.length + data.notes.length}>
                <ul className="list-disc pl-5 space-y-0.5 text-[12px] text-warm-700">{[...data.assumptions, ...data.notes].map((t, i) => <li key={i}>{t}</li>)}</ul>
                {data.unscheduled.length > 0 && <p className="mt-1 text-[12px] text-warm-600">Not loaded (no scheduled dates): {data.unscheduled.slice(0, 20).join(', ')}{data.unscheduled.length > 20 ? ', …' : ''}</p>}
              </Disclosure>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Summary({ data }: { data: Analysis }) {
  const t = data.totals
  const over = t.overAllocatedResources
  return (
    <div>
      <p className="text-[16px] font-semibold text-ink">{over
        ? `${n(over)} of ${n(t.resources)} resource${t.resources === 1 ? '' : 's'} ${over === 1 ? 'is' : 'are'} over ${over === 1 ? 'its' : 'their'} limit, on ${n(t.overAllocatedDays)} day${t.overAllocatedDays === 1 ? '' : 's'} ahead`
        : 'No resource is over its limit from the data date on'}</p>
      <p className="text-[12px] text-warm-600 mt-0.5">{n(t.resources)} resource{t.resources === 1 ? '' : 's'} · {n(t.assignments)} assignment{t.assignments === 1 ? '' : 's'} · {n(t.units)} units</p>
    </div>
  )
}

function ResourceTable({ resources, current, onSelect }: { resources: ResourceSummary[]; current: string | null; onSelect: (id: string) => void }) {
  return (
    <section aria-labelledby="res-list">
      <h3 id="res-list" className="sr-only">Resources: peak demand vs available</h3>
      <Hint label="How days are counted" className="mb-2">Over-allocated days are counted from the data date on. A peak above the limit that has already passed is shown, not counted.</Hint>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] text-warm-700">
          <thead><tr className="text-left text-[12px] font-medium text-warm-600 border-b border-warm-200">
            <th scope="col" className="py-1.5 pr-3 font-medium">Resource</th><th scope="col" className="pr-3 font-medium">Type</th>
            <th scope="col" className="pr-3 text-right font-medium">Available / day</th><th scope="col" className="pr-3 text-right font-medium">Peak / day</th>
            <th scope="col" className="pr-3 font-medium">Peak on</th><th scope="col" className="pr-3 text-right font-medium">Total units</th><th scope="col" className="pr-3 text-right font-medium">Days over, ahead</th><th scope="col"><span className="sr-only">Chart</span></th>
          </tr></thead>
          <tbody>
            {resources.map(r => (
              <tr key={r.id} className={`border-b border-warm-200 ${r.id === current ? 'bg-warm-100' : ''}`}>
                <th scope="row" className="py-1.5 pr-3 text-left font-medium text-ink">{r.code}<span className="block text-[12px] font-normal text-warm-600">{r.name}</span></th>
                <td className="pr-3 capitalize">{r.kind}</td>
                <td className="pr-3 text-right tabular-nums">{n(r.availablePerDay)} {r.unit}{/* "from the file" is the normal case and is not repeated on every row; anything else is said. */}{r.availabilitySource !== 'file' && <span className="block text-[12px] text-warm-600">{SOURCE_LABEL[r.availabilitySource]}</span>}</td>
                <td className="pr-3 text-right tabular-nums">{n(r.peakPerDay)} {r.unit}</td>
                <td className="pr-3 tabular-nums">{fmtDate(r.peakDate)}</td>
                <td className="pr-3 text-right tabular-nums">{n(r.totalUnits)}</td>
                <td className="pr-3 text-right tabular-nums">{r.overAllocatedDays ? <span className="rounded-full bg-status-at-risk-bg px-2 py-0.5 text-[12px] font-semibold text-status-at-risk">{r.overAllocatedDays}<span className="sr-only"> over-allocated</span></span> : <span className="text-warm-600">0</span>}{r.availablePerDay !== null && r.peakPerDay > r.availablePerDay && !r.overAllocatedDays && <span className="block text-[12px] font-normal text-warm-600">the peak has passed</span>}</td>
                <td className="text-right"><button type="button" aria-pressed={r.id === current} onClick={() => onSelect(r.id)} className={`px-1 text-[13px] hover:underline ${r.id === current ? 'font-semibold text-ink' : 'text-warm-700'}`}><span className="sr-only">Show the </span>{r.id === current ? 'Shown below' : 'Histogram'}<span className="sr-only"> for {r.code}</span></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

const BUCKET_WORD: Record<HistogramBucket, string> = { day: 'day', week: 'week', month: 'month' }

function HistogramSection({ r, bucket }: { r: ResourceSummary; bucket: HistogramBucket }) {
  const [asTable, setAsTable] = useState(false)
  const bars = r.histogram ?? []
  const over = bars.filter(b => b.overAllocatedDays > 0)
  const summary = `${r.code} ${r.name}: demand by ${BUCKET_WORD[bucket]} from ${fmtDate(bars[0]?.start)} to ${fmtDate(bars[bars.length - 1]?.end)}. Peak ${n(r.peakPerDay)} ${r.unit} per day on ${fmtDate(r.peakDate)}; available ${n(r.availablePerDay)} ${r.unit} per day. ${over.length ? `Over-allocated on ${r.overAllocatedDays} day${r.overAllocatedDays === 1 ? '' : 's'} ahead${bucket === 'day' ? '' : `, in ${over.length} ${BUCKET_WORD[bucket]}${over.length === 1 ? '' : 's'}`}.` : 'Not over-allocated from the data date on.'}`
  return (
    <section aria-labelledby="res-hist">
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 id="res-hist" className="text-[16px] font-semibold text-ink">{r.code} — {r.name} <span className="text-[13px] font-normal text-warm-600">{r.unit} per {BUCKET_WORD[bucket]}</span></h3>
        <button type="button" aria-pressed={asTable} onClick={() => setAsTable(v => !v)} className="flex-shrink-0 whitespace-nowrap text-[13px] font-medium text-accent-600 hover:underline">{asTable ? 'Show chart' : 'Show as table'}</button>
      </div>
      {!bars.length ? <p className="text-[13px] text-warm-600">No load in this view. Pick the resource in the table above to load its histogram.</p>
        : asTable ? <HistogramTable bars={bars} unit={r.unit} /> : <HistogramChart bars={bars} unit={r.unit} summary={summary} bucket={bucket} />}
      {/* The chart's description in words is its accessible name; it is not printed again under the picture. */}
      {asTable && <p className="sr-only">{summary}</p>}
    </section>
  )
}

function HistogramChart({ bars, unit, summary, bucket }: { bars: HistogramBar[]; unit: string; summary: string; bucket: HistogramBucket }) {
  const pid = useId().replace(/:/g, '')
  const [hover, setHover] = useState<number | null>(null)
  // Drawn at the width it is shown at, so its 12px text is 12px on a phone and on a wide screen.
  const box = useRef<HTMLElement>(null)
  const [width, setWidth] = useState(760)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => setWidth(Math.max(280, Math.round(el.clientWidth)))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const W = width, H = width < 520 ? 200 : 240, L = 44, B = 26, T = 12
  const anyOver = bars.some(b => b.overAllocatedDays > 0), anyWorked = bars.some(b => b.remaining === 0 && b.demand > 0), anyAhead = bars.some(b => b.remaining !== 0 && b.overAllocatedDays === 0 && b.demand > 0)
  const max = Math.max(1, ...bars.map(b => Math.max(b.demand, b.available ?? 0))) * 1.1
  const bw = (W - L - 8) / bars.length
  const y = (v: number) => T + (H - T - B) * (1 - v / max)
  const ticks = [0, max / 2 / 1.1, max / 1.1].map(v => Math.round(v))
  const labelEvery = Math.max(1, Math.ceil(bars.length / (width < 520 ? 4 : 8)))
  const line = bars.map((b, i) => b.available == null ? '' : `${i ? 'L' : 'M'}${L + i * bw},${y(b.available)} H${L + (i + 1) * bw}`).join(' ')
  const h = hover != null ? bars[hover] : null
  return (
    <figure ref={box} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-label={summary}>
        <defs>
          <pattern id={`${pid}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#A64848" /><line x1="0" y1="0" x2="0" y2="6" stroke="#FBF0F0" strokeWidth="2" />
          </pattern>
        </defs>
        {ticks.map(t => (
          <g key={t}>
            <line x1={L} x2={W - 8} y1={y(t)} y2={y(t)} stroke="#D3D6D9" strokeWidth="1" />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="12" fill="#4B5056">{t}</text>
          </g>
        ))}
        {bars.map((b, i) => {
          const isOver = b.overAllocatedDays > 0
          const x = L + i * bw + Math.min(2, bw * 0.1)
          const w = Math.max(1, bw - Math.min(4, bw * 0.2))
          return (
            <g key={b.start} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={L + i * bw} y={T} width={bw} height={H - T - B} fill="transparent" />
              {b.demand > 0 && <rect x={x} y={y(b.demand)} width={w} height={Math.max(0, y(0) - y(b.demand))} rx={Math.min(4, w / 2)} fill={isOver ? `url(#${pid}-hatch)` : b.remaining === 0 ? '#A2A7AC' : '#4A82D6'} />}
              {i % labelEvery === 0 && <text x={L + i * bw + bw / 2} y={H - 10} textAnchor="middle" fontSize="12" fill="#4B5056">{fmtDate(b.start).slice(0, 5)}</text>}
            </g>
          )
        })}
        {line && <path d={line} fill="none" stroke="#1D2125" strokeWidth="2" strokeDasharray="5 3" />}
      </svg>
      {h && (
        <div className="absolute top-1 right-1 bg-white border border-warm-300 rounded-md px-2 py-1 text-[12px] text-warm-700 shadow-sm pointer-events-none">
          <div className="font-semibold text-ink">{BUCKET_WORD[bucket]} of {fmtDate(h.start)}</div>
          <div>Demand {n(h.demand)} {unit} (peak day {n(h.peakDaily)})</div>
          <div>Available {n(h.available)} {unit}</div>
          {h.overAllocatedDays > 0 && <div className="text-status-at-risk font-semibold">Over-allocated on {h.overAllocatedDays} day{h.overAllocatedDays === 1 ? '' : 's'}</div>}
        </div>
      )}
      <figcaption className="flex flex-wrap gap-4 text-[12px] text-warm-700 mt-1">
        {anyAhead && <span className="flex items-center gap-1.5"><svg width="14" height="10" aria-hidden><rect width="14" height="10" rx="2" fill="#4A82D6" /></svg>Demand ahead</span>}
        {anyWorked && <span className="flex items-center gap-1.5"><svg width="14" height="10" aria-hidden><rect width="14" height="10" rx="2" fill="#A2A7AC" /></svg>Already worked</span>}
        {anyOver && <span className="flex items-center gap-1.5"><svg width="14" height="10" aria-hidden><rect width="14" height="10" rx="2" fill={`url(#${pid}-hatch)`} /></svg>Over the daily limit (hatched)</span>}
        <span className="flex items-center gap-1.5"><svg width="18" height="10" aria-hidden><line x1="0" x2="18" y1="5" y2="5" stroke="#1D2125" strokeWidth="2" strokeDasharray="5 3" /></svg>Available</span>
      </figcaption>
    </figure>
  )
}

function HistogramTable({ bars, unit }: { bars: HistogramBar[]; unit: string }) {
  return (
    <div tabIndex={0} role="region" aria-label={`Demand and availability by period, in ${unit} (scrolls)`} className="overflow-x-auto max-h-[360px] overflow-y-auto">
      <table className="w-full text-[12px] text-warm-700">
        <caption className="sr-only">Demand and availability by period ({unit})</caption>
        <thead><tr className="text-left text-[12px] font-medium text-warm-600 border-b border-warm-200">
          <th scope="col" className="py-1 pr-3">From</th><th scope="col" className="pr-3">To</th><th scope="col" className="pr-3 text-right">Demand</th>
          <th scope="col" className="pr-3 text-right">Actual</th><th scope="col" className="pr-3 text-right">Remaining</th><th scope="col" className="pr-3 text-right">Available</th><th scope="col" className="pr-3 text-right">Peak day</th><th scope="col">Over-allocated days</th>
        </tr></thead>
        <tbody>{bars.map(b => (
          <tr key={b.start} className="border-b border-warm-200">
            <td className="py-1 pr-3 tabular-nums">{fmtDate(b.start)}</td><td className="pr-3 tabular-nums">{fmtDate(b.end)}</td>
            <td className="pr-3 text-right tabular-nums">{n(b.demand)}</td><td className="pr-3 text-right tabular-nums">{n(b.actual)}</td><td className="pr-3 text-right tabular-nums">{n(b.remaining)}</td>
            <td className="pr-3 text-right tabular-nums">{n(b.available)}</td><td className="pr-3 text-right tabular-nums">{n(b.peakDaily)}</td>
            <td className={b.overAllocatedDays ? 'text-status-at-risk font-semibold' : ''}>{b.overAllocatedDays ? `Yes (${b.overAllocatedDays})` : 'No'}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

function OverAllocations({ periods, title = 'Over-allocations' }: { periods: OverAllocationPeriod[]; title?: string }) {
  // The headline already says when nothing is over its limit; an empty list is only stated for a named result (after leveling).
  if (!periods.length && title === 'Over-allocations') return null
  return (
    <section aria-label={title}>
      <h3 className="text-[16px] font-semibold text-ink mb-1">{title} <span className="ml-1 text-[13px] font-normal text-warm-600">{periods.length}</span></h3>
      {!periods.length ? <p className="text-[13px] text-warm-600">No resource is over-allocated from the data date on.</p> : (
        <ul className="divide-y divide-warm-200 text-[13px] text-warm-700">
          {periods.slice(0, 50).map(p => (
            <li key={`${p.resourceId}-${p.from}`} className="py-2">
              <details className="group">
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-semibold text-ink">{p.resourceCode}</span>
                  <span className="tabular-nums">{fmtDate(p.from)}{p.to !== p.from ? ` – ${fmtDate(p.to)}` : ''}</span>
                  <span className="flex-1 min-w-[200px]">{p.days} day{p.days === 1 ? '' : 's'} over, peak {n(p.peakDemand)} vs {n(p.available)} available</span>
                  <span className="text-[12px] font-semibold text-accent-600 group-open:hidden">{p.activities.length} contributing</span>
                </summary>
                <p className="mt-1 text-[12px] text-warm-600">Up to {n(p.maxExcess)} over. Contributing: {p.activities.slice(0, 8).map(a => `${a.code} ${a.name} (${n(a.unitsPerDay)}/day)`).join('; ')}{p.activities.length > 8 ? `; and ${p.activities.length - 8} more` : ''}</p>
              </details>
            </li>
          ))}
          {periods.length > 50 && <li className="py-2 text-warm-600">…and {periods.length - 50} more periods.</li>}
        </ul>
      )}
    </section>
  )
}

function Staffing({ resources, staffing, setStaffing }: { resources: ResourceSummary[]; staffing: Record<string, number>; setStaffing: (s: Record<string, number>) => void }) {
  const limited = resources.filter(r => r.kind !== 'material')
  const [rid, setRid] = useState((limited.find(r => r.overAllocatedDays > 0) ?? limited[0])?.id ?? '')
  const [val, setVal] = useState('')
  const r = limited.find(x => x.id === rid)
  if (!limited.length) return null
  const crew = r ? (r.fileAvailablePerDay ?? r.availablePerDay ?? r.hoursPerDay) : 0
  const set = (v: number) => setStaffing({ ...staffing, [rid]: Math.max(0, Math.round(v * 100) / 100) })
  return (
    <Disclosure tone="card" title="Staffing what-if" meta={Object.keys(staffing).length ? 'in effect' : 'nothing is saved'}>
      <p className="text-[12px] text-warm-600 mb-2 max-w-[80ch]">Change how many units a resource can supply per day (for example, add a crew), then look at the histogram or run leveling to see the date impact.</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[12px] text-warm-700">Resource
          <select value={rid} onChange={e => setRid(e.target.value)} className="block bg-white border border-warm-300 rounded-lg px-2 py-1.5 text-[13px]">
            {limited.map(x => <option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}
          </select>
        </label>
        <label className="text-[12px] text-warm-700">Available per day ({r?.unit})
          <input type="number" min={0} step="any" value={val} placeholder={String(r?.availablePerDay ?? '')} onChange={e => setVal(e.target.value)} className={`${inputClass} w-32`} />
        </label>
        <Button variant="secondary" disabled={val === '' || !Number.isFinite(Number(val))} onClick={() => { set(Number(val)); setVal('') }}>Apply</Button>
        <Button variant="secondary" onClick={() => set((staffing[rid] ?? r?.availablePerDay ?? 0) + crew)}>Add one crew (+{n(crew)})</Button>
        {Object.keys(staffing).length > 0 && <Button variant="ghost" onClick={() => setStaffing({})}>Reset to the file</Button>}
      </div>
      {Object.keys(staffing).length > 0 && (
        <p className="text-[12px] text-warm-700 mt-2">What-if: {Object.entries(staffing).map(([k, v]) => `${resources.find(x => x.id === k)?.code ?? k} ${n(v)}/day`).join('; ')}</p>
      )}
    </Disclosure>
  )
}

function Leveling({ base, kind, canEdit, hasLogic, staffing, selected, bucket, levelingEdits, onSaved }: {
  base: string; kind: 'schedule' | 'plan'; canEdit: boolean; hasLogic: boolean; staffing: Record<string, number>; selected: string | null; bucket: HistogramBucket; levelingEdits: number; onSaved: () => void
}) {
  const [mode, setMode] = useState<'level' | 'smooth'>('level')
  const [extend, setExtend] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [reason, setReason] = useState('')
  const opts = useCallback(() => ({ mode, allowFinishExtension: mode === 'level' && extend, availability: staffing, resource: selected, bucket }), [mode, extend, staffing, selected, bucket])

  // A preview belongs to the options it was run with: changing them clears it, so what is saved is what was shown.
  useEffect(() => { setPreview(null) }, [mode, extend, staffing])

  const run = async () => {
    setBusy(true); setErr(''); setMsg('')
    const r = await postJson(base, opts())
    setBusy(false)
    if (!r.ok) { setErr(r.data.error || 'Leveling failed.'); setPreview(null); return }
    setPreview(r.data as unknown as Preview)
  }
  const save = async () => {
    setBusy(true); setErr(''); setMsg('')
    const r = await postJson(`${base}/level`, { ...opts(), reason })
    setBusy(false)
    if (!r.ok) { setErr(r.data.error || 'Could not save the leveled scenario.'); return }
    setMsg(`Saved as the Leveled scenario: ${(r.data.added as string[] | undefined)?.length ?? 0} delay edit(s)${r.data.replaced ? `, replacing ${r.data.replaced} from the previous run` : ''}. Every view and export can now use it (basis: with RunF9 edits).`)
    setReason('')
    onSaved()
  }
  const remove = async () => {
    const why = await askText({ title: 'Remove the leveled scenario', label: 'Reason (kept in the audit log)', required: true, confirmLabel: 'Remove' })
    if (!why) return
    const res = await fetch(`${base}/level?reason=${encodeURIComponent(why)}`, { method: 'DELETE' })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) setErr(d.error || 'Could not remove the leveled scenario.')
    else { setMsg(`Leveled scenario removed (${d.reverted} edit(s) reverted).`); onSaved() }
  }
  const res = preview?.result
  return (
    <Disclosure tone="card" title="Resource leveling" meta={levelingEdits > 0 ? `leveled scenario saved (${levelingEdits} edits)` : undefined}>
      {!hasLogic ? <p className="text-[13px] text-warm-600">This schedule has no activity relationships, so it cannot be recalculated to level resources.</p> : (
        <>
          <Hint label="How leveling works" className="mb-2">Delays not-started work so no resource is over its limit. Priority: least total float keeps the resource, then the earliest late start, then the activity ID. Work in progress, actuals, the data date and constraints are never moved. Delays become Start On or After dates in a scenario labelled “Leveled scenario”; the schedule as submitted is unchanged.</Hint>
          <fieldset className="flex flex-wrap items-center gap-4 text-[13px] text-warm-700">
            <legend className="sr-only">Leveling mode</legend>
            <label><input type="radio" name="lv-mode" checked={mode === 'level'} onChange={() => setMode('level')} /> Level (within float first)</label>
            <label><input type="radio" name="lv-mode" checked={mode === 'smooth'} onChange={() => setMode('smooth')} /> Smooth (within float only)</label>
            <label className={mode === 'smooth' ? 'opacity-60' : ''}><input type="checkbox" disabled={mode === 'smooth'} checked={mode === 'level' && extend} onChange={e => setExtend(e.target.checked)} /> Allow the finish to extend</label>
            <Button onClick={run} disabled={busy}>{busy ? 'Working…' : 'Preview leveling'}</Button>
            {kind === 'schedule' && canEdit && levelingEdits > 0 && <Button variant="ghost" onClick={remove}>Remove the leveled scenario ({levelingEdits} edits)</Button>}
          </fieldset>
          {err && <div className="mt-2"><Alert tone="error">{err}</Alert></div>}
          {msg && <div className="mt-2"><Alert tone="success">{msg}</Alert></div>}
          {res && <LevelingResults p={preview!} />}
          {res && kind === 'schedule' && (canEdit ? (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="text-[12px] text-warm-700 flex-1 min-w-[240px]">Reason (kept with each edit and in the audit log)
                <input value={reason} onChange={e => setReason(e.target.value)} className={inputClass} placeholder="e.g. Level carpenters to one crew per the superintendent" />
              </label>
              <Button onClick={save} disabled={busy || reason.trim().length < 5 || !res.changes.length}>Save as Leveled scenario</Button>
            </div>
          ) : <p className="text-[12px] text-warm-600 mt-2">Saving the leveled scenario needs the scheduler role.</p>)}
          {res && kind === 'plan' && <p className="text-[12px] text-warm-600 mt-2">Plans change through plan edits: apply these Start On or After dates as constraint edits on the plan to keep them.</p>}
        </>
      )}
    </Disclosure>
  )
}

function LevelingResults({ p }: { p: Preview }) {
  const r = p.result
  const fin = (d: number) => (d === 0 ? 'no change' : `${d > 0 ? '+' : ''}${d} calendar day${Math.abs(d) === 1 ? '' : 's'}`)
  return (
    <div className="mt-3 space-y-3 text-[13px] text-warm-700">
      <h4 className="font-semibold text-ink">{r.label} — {r.mode === 'smooth' ? 'smoothing (within float)' : r.allowFinishExtension ? 'leveling, finish may extend' : 'leveling within float'}</h4>
      <table className="text-[13px]">
        <thead><tr className="text-left text-[12px] font-medium text-warm-600"><th scope="col" className="pr-4">Measure</th><th scope="col" className="pr-4">Before</th><th scope="col">After</th></tr></thead>
        <tbody>
          <tr><th scope="row" className="text-left pr-4 font-medium">Finish</th><td className="pr-4 tabular-nums">{fmtDate(r.before.finish)}</td><td className="tabular-nums">{fmtDate(r.after.finish)} ({fin(r.finishChangeDays)})</td></tr>
          {r.before.milestones.map((m, i) => (
            <tr key={m.id}><th scope="row" className="text-left pr-4 font-medium">{m.code} {m.name}{m.required ? ` (required ${fmtDate(m.required)})` : ''}</th><td className="pr-4 tabular-nums">{fmtDate(m.date)}</td><td className="tabular-nums">{fmtDate(r.after.milestones[i]?.date)}</td></tr>
          ))}
          <tr><th scope="row" className="text-left pr-4 font-medium">Over-allocated resource-days</th><td className="pr-4 tabular-nums">{r.before.overAllocatedDays}</td><td className="tabular-nums">{r.after.overAllocatedDays}</td></tr>
        </tbody>
      </table>
      <div>
        <h5 className="font-semibold text-ink mb-1">Delays introduced ({r.delays.length})</h5>
        {!r.delays.length ? <p className="text-warm-600">No activity needs to wait.</p> : (
          <div tabIndex={0} role="region" aria-label="Activities moved by leveling (scrolls sideways on small screens)" className="overflow-x-auto"><table className="w-full text-[12px]">
            <thead><tr className="text-left text-[12px] font-medium text-warm-600 border-b border-warm-200">
              <th scope="col" className="py-1 pr-3">Activity</th><th scope="col" className="pr-3">Start before</th><th scope="col" className="pr-3">Start after</th><th scope="col" className="pr-3 text-right">Delay (work days)</th><th scope="col" className="pr-3">Within float</th><th scope="col">Resources</th>
            </tr></thead>
            <tbody>{r.delays.map(d => (
              <tr key={d.activityId} className="border-b border-warm-200">
                <td className="py-1 pr-3"><span className="font-medium text-ink">{d.code}</span> {d.name}</td>
                <td className="pr-3 tabular-nums">{fmtDate(d.fromStart)}</td><td className="pr-3 tabular-nums">{fmtDate(d.toStart)}</td>
                <td className="pr-3 text-right tabular-nums">{d.workDays}</td><td className="pr-3">{d.withinFloat ? 'Yes' : 'No — moves later work'}</td><td>{d.resources.join(', ')}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {r.knockOn.length > 0 && <p className="text-[12px] text-warm-600 mt-1">Moved by logic as a result: {r.knockOn.slice(0, 15).map(k => `${k.code} (+${k.calendarDays}d)`).join(', ')}{r.knockOn.length > 15 ? ', …' : ''}</p>}
      </div>
      {r.unresolved.length > 0 && (
        <div><h5 className="font-semibold text-ink mb-1">Not resolved</h5>
          <ul className="list-disc pl-5 text-[12px]">{r.unresolved.slice(0, 15).map((u, i) => <li key={i}>{u.resourceCode} from {fmtDate(u.date)}: {u.reason}</li>)}</ul></div>
      )}
      <OverAllocations periods={r.remaining} title="Remaining over-allocations after leveling" />
      {r.assumptions.length > 0 && <ul className="list-disc pl-5 text-[12px] text-warm-600">{r.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>}
    </div>
  )
}
