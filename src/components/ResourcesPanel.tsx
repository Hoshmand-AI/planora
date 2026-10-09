'use client'

// Resource analysis: resources with peak vs available, a histogram per resource (demand bars against an
// availability line; over-allocated periods hatched AND marked with "!" and listed in words), the
// over-allocations with the activities contributing, and leveling / smoothing with a staffing what-if.
// Works for an uploaded schedule (/api/schedules/{id}/resources) and a plan (/api/plans/{id}/resources).

import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { fmtDate } from '@/lib/format'
import { Alert, Button, inputClass, postJson } from './ui'
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

  useEffect(() => {
    let live = true
    setLoading(true); setError('')
    const q = new URLSearchParams({ bucket, ...(basis === 'scenario' ? { basis } : {}), ...(selected && bucket === 'day' ? { resource: selected } : {}), ...(Object.keys(staffing).length ? { availability: JSON.stringify(staffing) } : {}) })
    fetch(`${base}?${q}`).then(async r => {
      const d = await r.json().catch(() => ({}))
      if (!live) return
      if (!r.ok) { setError(d.error || 'Could not load the resource analysis.'); setData(null) } else setData(d)
    }).catch(() => live && setError('Network error. Check your connection and try again.')).finally(() => live && setLoading(false))
    return () => { live = false }
  }, [base, bucket, basis, selected, staffing, refresh])

  const resources = useMemo(() => data?.resources ?? [], [data])
  const current = resources.find(r => r.id === selected) ?? resources.find(r => r.overAllocatedDays > 0) ?? resources[0] ?? null

  if (error) return <Alert tone="error">{error}</Alert>
  if (!data) return <p className="text-[13px] text-warm-600" role="status">{loading ? 'Loading resources…' : ''}</p>

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4 text-[13px] text-warm-700">
        <label className="flex items-center gap-2">Period
          <select value={bucket} onChange={e => setBucket(e.target.value as HistogramBucket)} className="bg-warm-100 border border-warm-300 rounded-md px-2 py-1">
            <option value="day">Day</option><option value="week">Week</option><option value="month">Month</option>
          </select>
        </label>
        {kind === 'schedule' && (
          <fieldset className="flex items-center gap-3">
            <legend className="sr-only">Basis</legend>
            <label><input type="radio" name="res-basis" checked={basis === 'submitted'} onChange={() => setBasis('submitted')} /> As submitted</label>
            <label><input type="radio" name="res-basis" checked={basis === 'scenario'} onChange={() => setBasis('scenario')} /> With Planora edits{data.levelingEdits ? ' (Leveled scenario)' : ''}</label>
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
          <Staffing resources={resources} staffing={staffing} setStaffing={setStaffing} />
          <Leveling base={base} kind={kind} canEdit={canEdit && kind === 'schedule' && !!data.editable} hasLogic={data.hasLogic !== false} staffing={staffing}
            selected={current?.id ?? null} bucket={bucket} levelingEdits={data.levelingEdits ?? 0} onSaved={() => { setBasis('scenario'); setRefresh(x => x + 1) }} />
          {(data.assumptions.length > 0 || data.notes.length > 0) && (
            <section aria-labelledby="res-assume" className="text-[12px] text-warm-600">
              <h3 id="res-assume" className="font-semibold text-warm-700 mb-1">Assumptions and notes</h3>
              <ul className="list-disc pl-5 space-y-0.5">{[...data.assumptions, ...data.notes].map((t, i) => <li key={i}>{t}</li>)}</ul>
              {data.unscheduled.length > 0 && <p className="mt-1">Not loaded (no scheduled dates): {data.unscheduled.slice(0, 20).join(', ')}{data.unscheduled.length > 20 ? ', …' : ''}</p>}
            </section>
          )}
        </>
      )}
    </div>
  )
}

function Summary({ data }: { data: Analysis }) {
  const t = data.totals
  const items = [
    ['Resources', n(t.resources)], ['Assignments', n(t.assignments)], ['Total units', n(t.units)],
    ['Over-allocated resources', n(t.overAllocatedResources)], ['Over-allocated resource-days', n(t.overAllocatedDays)],
  ]
  return (
    <dl className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {items.map(([k, v]) => (
        <div key={k} className="bg-warm-50 border border-warm-200 rounded-md px-3 py-2">
          <dt className="text-[11px] uppercase tracking-wider text-warm-600">{k}</dt>
          <dd className="text-[18px] font-semibold text-navy-950 tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function ResourceTable({ resources, current, onSelect }: { resources: ResourceSummary[]; current: string | null; onSelect: (id: string) => void }) {
  return (
    <section aria-labelledby="res-list">
      <h3 id="res-list" className="text-[14px] font-semibold text-navy-950 mb-2">Resources: peak demand vs available</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] text-warm-700">
          <thead><tr className="text-left text-[11px] uppercase tracking-wider text-warm-600 border-b border-warm-200">
            <th scope="col" className="py-1.5 pr-3">Resource</th><th scope="col" className="pr-3">Type</th>
            <th scope="col" className="pr-3 text-right">Available / day</th><th scope="col" className="pr-3 text-right">Peak / day</th>
            <th scope="col" className="pr-3">Peak on</th><th scope="col" className="pr-3 text-right">Total units</th><th scope="col" className="pr-3 text-right">Over-allocated days</th><th scope="col"><span className="sr-only">Chart</span></th>
          </tr></thead>
          <tbody>
            {resources.map(r => (
              <tr key={r.id} className={`border-b border-warm-200 ${r.id === current ? 'bg-accent-100' : ''}`}>
                <th scope="row" className="py-1.5 pr-3 text-left font-medium text-navy-950">{r.code}<span className="block text-[12px] font-normal text-warm-600">{r.name}</span></th>
                <td className="pr-3 capitalize">{r.kind}</td>
                <td className="pr-3 text-right tabular-nums">{n(r.availablePerDay)} {r.unit}<span className="block text-[11px] text-warm-600">{SOURCE_LABEL[r.availabilitySource]}</span></td>
                <td className="pr-3 text-right tabular-nums">{n(r.peakPerDay)} {r.unit}</td>
                <td className="pr-3 tabular-nums">{fmtDate(r.peakDate)}</td>
                <td className="pr-3 text-right tabular-nums">{n(r.totalUnits)}</td>
                <td className={`pr-3 text-right tabular-nums ${r.overAllocatedDays ? 'text-status-at-risk font-semibold' : ''}`}>{r.overAllocatedDays ? `! ${r.overAllocatedDays}` : '0'}</td>
                <td><Button variant="ghost" aria-pressed={r.id === current} onClick={() => onSelect(r.id)}>Show histogram<span className="sr-only"> for {r.code}</span></Button></td>
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
  const summary = `${r.code} ${r.name}: demand by ${BUCKET_WORD[bucket]} from ${fmtDate(bars[0]?.start)} to ${fmtDate(bars[bars.length - 1]?.end)}. Peak ${n(r.peakPerDay)} ${r.unit} per day on ${fmtDate(r.peakDate)}; available ${n(r.availablePerDay)} ${r.unit} per day. ${over.length ? `${over.length} ${BUCKET_WORD[bucket]}${over.length === 1 ? '' : 's'} over-allocated.` : 'Never over-allocated.'}`
  return (
    <section aria-labelledby="res-hist">
      <div className="flex items-center justify-between mb-2">
        <h3 id="res-hist" className="text-[14px] font-semibold text-navy-950">Histogram: {r.code} — {r.name}</h3>
        <Button variant="secondary" aria-pressed={asTable} onClick={() => setAsTable(v => !v)}>{asTable ? 'Show chart' : 'Show as table'}</Button>
      </div>
      {!bars.length ? <p className="text-[13px] text-warm-600">No load in this view. Pick the resource with “Show histogram” to load its daily histogram.</p>
        : asTable ? <HistogramTable bars={bars} unit={r.unit} /> : <HistogramChart bars={bars} unit={r.unit} summary={summary} bucket={bucket} />}
      <p className="text-[12px] text-warm-600 mt-1">{summary}</p>
    </section>
  )
}

function HistogramChart({ bars, unit, summary, bucket }: { bars: HistogramBar[]; unit: string; summary: string; bucket: HistogramBucket }) {
  const pid = useId().replace(/:/g, '')
  const [hover, setHover] = useState<number | null>(null)
  const W = 760, H = 240, L = 48, B = 28, T = 16
  const max = Math.max(1, ...bars.map(b => Math.max(b.demand, b.available ?? 0))) * 1.1
  const bw = (W - L - 8) / bars.length
  const y = (v: number) => T + (H - T - B) * (1 - v / max)
  const ticks = [0, max / 2 / 1.1, max / 1.1].map(v => Math.round(v))
  const labelEvery = Math.max(1, Math.ceil(bars.length / 8))
  const line = bars.map((b, i) => b.available == null ? '' : `${i ? 'L' : 'M'}${L + i * bw},${y(b.available)} H${L + (i + 1) * bw}`).join(' ')
  const h = hover != null ? bars[hover] : null
  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={summary}>
        <defs>
          <pattern id={`${pid}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#A64848" /><line x1="0" y1="0" x2="0" y2="6" stroke="#FBF0F0" strokeWidth="2" />
          </pattern>
        </defs>
        {ticks.map(t => (
          <g key={t}>
            <line x1={L} x2={W - 8} y1={y(t)} y2={y(t)} stroke="#E2DDD5" strokeWidth="1" />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#575047">{t}</text>
          </g>
        ))}
        {bars.map((b, i) => {
          const isOver = b.overAllocatedDays > 0
          const x = L + i * bw + Math.min(2, bw * 0.1)
          const w = Math.max(1, bw - Math.min(4, bw * 0.2))
          return (
            <g key={b.start} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={L + i * bw} y={T} width={bw} height={H - T - B} fill="transparent" />
              {b.demand > 0 && <rect x={x} y={y(b.demand)} width={w} height={Math.max(0, y(0) - y(b.demand))} rx={Math.min(4, w / 2)} fill={isOver ? `url(#${pid}-hatch)` : '#3b82f6'} />}
              {isOver && <text x={x + w / 2} y={y(b.demand) - 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#A64848">!</text>}
              {i % labelEvery === 0 && <text x={L + i * bw + bw / 2} y={H - 10} textAnchor="middle" fontSize="10" fill="#575047">{fmtDate(b.start).slice(0, 5)}</text>}
            </g>
          )
        })}
        {line && <path d={line} fill="none" stroke="#0A1628" strokeWidth="2" strokeDasharray="5 3" />}
      </svg>
      {h && (
        <div className="absolute top-1 right-1 bg-white border border-warm-300 rounded-md px-2 py-1 text-[12px] text-warm-700 shadow-sm pointer-events-none">
          <div className="font-semibold text-navy-950">{BUCKET_WORD[bucket]} of {fmtDate(h.start)}</div>
          <div>Demand {n(h.demand)} {unit} (peak day {n(h.peakDaily)})</div>
          <div>Available {n(h.available)} {unit}</div>
          {h.overAllocatedDays > 0 && <div className="text-status-at-risk font-semibold">Over-allocated on {h.overAllocatedDays} day{h.overAllocatedDays === 1 ? '' : 's'}</div>}
        </div>
      )}
      <figcaption className="flex flex-wrap gap-4 text-[12px] text-warm-700 mt-1">
        <span className="flex items-center gap-1.5"><svg width="14" height="10" aria-hidden><rect width="14" height="10" rx="2" fill="#3b82f6" /></svg>Demand ({unit})</span>
        <span className="flex items-center gap-1.5"><svg width="14" height="10" aria-hidden><rect width="14" height="10" rx="2" fill={`url(#${pid}-hatch)`} /></svg>Over-allocated (hatched, marked “!”)</span>
        <span className="flex items-center gap-1.5"><svg width="18" height="10" aria-hidden><line x1="0" x2="18" y1="5" y2="5" stroke="#0A1628" strokeWidth="2" strokeDasharray="5 3" /></svg>Available</span>
      </figcaption>
    </figure>
  )
}

function HistogramTable({ bars, unit }: { bars: HistogramBar[]; unit: string }) {
  return (
    <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
      <table className="w-full text-[12.5px] text-warm-700">
        <caption className="sr-only">Demand and availability by period ({unit})</caption>
        <thead><tr className="text-left text-[11px] uppercase tracking-wider text-warm-600 border-b border-warm-200">
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
  return (
    <section aria-label={title}>
      <h3 className="text-[14px] font-semibold text-navy-950 mb-2">{title} ({periods.length})</h3>
      {!periods.length ? <p className="text-[13px] text-warm-600">No resource is over-allocated from the data date on.</p> : (
        <ul className="space-y-2 text-[13px] text-warm-700">
          {periods.slice(0, 50).map(p => (
            <li key={`${p.resourceId}-${p.from}`} className="border-l-2 border-status-at-risk pl-3">
              <span className="font-semibold text-navy-950">{p.resourceCode}</span> {fmtDate(p.from)}{p.to !== p.from ? ` – ${fmtDate(p.to)}` : ''}: {p.days} day{p.days === 1 ? '' : 's'} over, peak {n(p.peakDemand)} vs {n(p.available)} available (up to {n(p.maxExcess)} over).
              <span className="block text-[12px] text-warm-600">Contributing: {p.activities.slice(0, 8).map(a => `${a.code} ${a.name} (${n(a.unitsPerDay)}/day)`).join('; ')}{p.activities.length > 8 ? `; and ${p.activities.length - 8} more` : ''}</span>
            </li>
          ))}
          {periods.length > 50 && <li className="text-warm-600">…and {periods.length - 50} more periods.</li>}
        </ul>
      )}
    </section>
  )
}

function Staffing({ resources, staffing, setStaffing }: { resources: ResourceSummary[]; staffing: Record<string, number>; setStaffing: (s: Record<string, number>) => void }) {
  const limited = resources.filter(r => r.kind !== 'material')
  const [rid, setRid] = useState(limited[0]?.id ?? '')
  const [val, setVal] = useState('')
  const r = limited.find(x => x.id === rid)
  if (!limited.length) return null
  const crew = r ? (r.fileAvailablePerDay ?? r.availablePerDay ?? r.hoursPerDay) : 0
  const set = (v: number) => setStaffing({ ...staffing, [rid]: Math.max(0, Math.round(v * 100) / 100) })
  return (
    <section aria-labelledby="res-staff" className="border border-warm-200 rounded-md p-3 bg-warm-50">
      <h3 id="res-staff" className="text-[14px] font-semibold text-navy-950 mb-1">Staffing what-if</h3>
      <p className="text-[12px] text-warm-600 mb-2">Change how many units a resource can supply per day (for example, add a crew), then look at the histogram or run leveling to see the date impact. Nothing is saved.</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[12px] text-warm-700">Resource
          <select value={rid} onChange={e => setRid(e.target.value)} className="block bg-warm-100 border border-warm-300 rounded-md px-2 py-1.5 text-[13px]">
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
    </section>
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
    setMsg(`Saved as the Leveled scenario: ${(r.data.added as string[] | undefined)?.length ?? 0} delay edit(s)${r.data.replaced ? `, replacing ${r.data.replaced} from the previous run` : ''}. Every view and export can now use it (basis: with Planora edits).`)
    setReason('')
    onSaved()
  }
  const remove = async () => {
    const why = window.prompt('Reason for removing the leveled scenario (kept in the audit log):')
    if (!why) return
    const res = await fetch(`${base}/level?reason=${encodeURIComponent(why)}`, { method: 'DELETE' })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) setErr(d.error || 'Could not remove the leveled scenario.')
    else { setMsg(`Leveled scenario removed (${d.reverted} edit(s) reverted).`); onSaved() }
  }
  const res = preview?.result
  return (
    <section aria-labelledby="res-level" className="border border-warm-200 rounded-md p-3">
      <h3 id="res-level" className="text-[14px] font-semibold text-navy-950 mb-1">Resource leveling</h3>
      {!hasLogic ? <p className="text-[13px] text-warm-600">This schedule has no activity relationships, so it cannot be recalculated to level resources.</p> : (
        <>
          <p className="text-[12px] text-warm-600 mb-2">Delays not-started work so no resource is over its limit. Priority: least total float keeps the resource, then the earliest late start, then the activity ID. Work in progress, actuals, the data date and constraints are never moved. Delays become Start On or After dates in a scenario labelled “Leveled scenario”; the schedule as submitted is unchanged.</p>
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
    </section>
  )
}

function LevelingResults({ p }: { p: Preview }) {
  const r = p.result
  const fin = (d: number) => (d === 0 ? 'no change' : `${d > 0 ? '+' : ''}${d} calendar day${Math.abs(d) === 1 ? '' : 's'}`)
  return (
    <div className="mt-3 space-y-3 text-[13px] text-warm-700">
      <h4 className="font-semibold text-navy-950">{r.label} — {r.mode === 'smooth' ? 'smoothing (within float)' : r.allowFinishExtension ? 'leveling, finish may extend' : 'leveling within float'}</h4>
      <table className="text-[13px]">
        <thead><tr className="text-left text-[11px] uppercase tracking-wider text-warm-600"><th scope="col" className="pr-4">Measure</th><th scope="col" className="pr-4">Before</th><th scope="col">After</th></tr></thead>
        <tbody>
          <tr><th scope="row" className="text-left pr-4 font-medium">Finish</th><td className="pr-4 tabular-nums">{fmtDate(r.before.finish)}</td><td className="tabular-nums">{fmtDate(r.after.finish)} ({fin(r.finishChangeDays)})</td></tr>
          {r.before.milestones.map((m, i) => (
            <tr key={m.id}><th scope="row" className="text-left pr-4 font-medium">{m.code} {m.name}{m.required ? ` (required ${fmtDate(m.required)})` : ''}</th><td className="pr-4 tabular-nums">{fmtDate(m.date)}</td><td className="tabular-nums">{fmtDate(r.after.milestones[i]?.date)}</td></tr>
          ))}
          <tr><th scope="row" className="text-left pr-4 font-medium">Over-allocated resource-days</th><td className="pr-4 tabular-nums">{r.before.overAllocatedDays}</td><td className="tabular-nums">{r.after.overAllocatedDays}</td></tr>
        </tbody>
      </table>
      <div>
        <h5 className="font-semibold text-navy-950 mb-1">Delays introduced ({r.delays.length})</h5>
        {!r.delays.length ? <p className="text-warm-600">No activity needs to wait.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-[12.5px]">
            <thead><tr className="text-left text-[11px] uppercase tracking-wider text-warm-600 border-b border-warm-200">
              <th scope="col" className="py-1 pr-3">Activity</th><th scope="col" className="pr-3">Start before</th><th scope="col" className="pr-3">Start after</th><th scope="col" className="pr-3 text-right">Delay (work days)</th><th scope="col" className="pr-3">Within float</th><th scope="col">Resources</th>
            </tr></thead>
            <tbody>{r.delays.map(d => (
              <tr key={d.activityId} className="border-b border-warm-200">
                <td className="py-1 pr-3"><span className="font-medium text-navy-950">{d.code}</span> {d.name}</td>
                <td className="pr-3 tabular-nums">{fmtDate(d.fromStart)}</td><td className="pr-3 tabular-nums">{fmtDate(d.toStart)}</td>
                <td className="pr-3 text-right tabular-nums">{d.workDays}</td><td className="pr-3">{d.withinFloat ? 'Yes' : 'No — moves later work'}</td><td>{d.resources.join(', ')}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {r.knockOn.length > 0 && <p className="text-[12px] text-warm-600 mt-1">Moved by logic as a result: {r.knockOn.slice(0, 15).map(k => `${k.code} (+${k.calendarDays}d)`).join(', ')}{r.knockOn.length > 15 ? ', …' : ''}</p>}
      </div>
      {r.unresolved.length > 0 && (
        <div><h5 className="font-semibold text-navy-950 mb-1">Not resolved</h5>
          <ul className="list-disc pl-5 text-[12.5px]">{r.unresolved.slice(0, 15).map((u, i) => <li key={i}>{u.resourceCode} from {fmtDate(u.date)}: {u.reason}</li>)}</ul></div>
      )}
      <OverAllocations periods={r.remaining} title="Remaining over-allocations after leveling" />
      {r.assumptions.length > 0 && <ul className="list-disc pl-5 text-[12px] text-warm-600">{r.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>}
    </div>
  )
}
