'use client'

// Earned value (src/lib/analysis/evm.ts): the indicators, each a number and a few words; the
// PV / EV / AC S-curve (plain SVG, distinct line styles and markers, with a table toggle); and, folded,
// the WBS roll-up, the integrity checks and how every figure is calculated and what it means. When the
// inputs are missing it says what is needed. Only real cost data from the uploaded file is used;
// nothing is estimated from durations.

import { useEffect, useId, useRef, useState } from 'react'
import { fmtDate } from '@/lib/format'
import { fmtMoney, percentTypeLabel, EVM_PRINCIPLE_NOTE } from '@/lib/analysis/evm-format'
import type { EvmAnalysis, EvmTrendPoint } from '@/lib/analysis/evm'
import { Disclosure } from './Disclosure'

interface SeriesResponse { points: EvmTrendPoint[]; superseded: { id: string; version: string; dataDate: string | null }[]; notes: string[] }

const idx = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(2))
const td = 'px-2 py-1.5 border-b border-warm-200 text-warm-700 tabular-nums'
const th = 'px-2 py-1.5 text-left font-semibold text-warm-600 border-b border-warm-300'

export function EarnedValue({ scheduleId }: { scheduleId: string }) {
  const [evm, setEvm] = useState<EvmAnalysis | null>(null)
  const [series, setSeries] = useState<SeriesResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    setLoading(true); setEvm(null); setSeries(null); setError('')
    fetch(`/api/schedules/${scheduleId}/evm`).then(async r => {
      const d = await r.json().catch(() => ({}))
      if (!live) return
      if (r.ok) setEvm(d.evm ?? null); else setError(d.error || 'Earned value could not be loaded.')
      setLoading(false)
      // The trend needs every update of the series; only worth loading when there is something to show.
      if (r.ok && d.evm?.status !== 'not_available') {
        fetch(`/api/schedules/evm?${new URLSearchParams({ id: scheduleId })}`).then(x => x.json()).then(s => { if (live && Array.isArray(s.points)) setSeries(s) }).catch(() => {})
      }
    }).catch(() => { if (live) { setError('Earned value could not be loaded.'); setLoading(false) } })
    return () => { live = false }
  }, [scheduleId])

  if (loading) return <p className="text-body text-warm-600" role="status">Loading earned value…</p>
  if (error) return <p className="text-body text-status-at-risk" role="alert">{error}</p>
  if (!evm) return null

  if (evm.status === 'not_available') {
    return (
      <section aria-labelledby="evm-h" className="space-y-3">
        <h2 id="evm-h" className="text-heading font-semibold text-ink">Earned value</h2>
        <div className="bg-white border border-warm-200 rounded-[14px] p-5">
          <p className="text-body font-semibold text-ink">Not available for this upload. It needs:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1 text-body text-warm-700">
            {evm.missing.map(m => <li key={m.code}>{m.message}</li>)}
          </ul>
          <p className="text-caption text-warm-600 mt-3">RunF9 computes earned value only from real budgets and costs in the uploaded file (P6 resource assignments and expenses, MS Project cost fields, or cost columns in a spreadsheet). It never estimates them from durations.</p>
          <p className="text-caption text-warm-600 mt-1">{evm.baseline.header}</p>
        </div>
      </section>
    )
  }

  const m = evm.metrics!
  const $ = (n: number | null | undefined) => fmtMoney(n, evm.currency)
  const es = evm.earnedSchedule
  // The file's own currency in the plain-words tiles ("$" when the file names none), as fmtMoney does.
  const unit = evm.currency?.symbol || (evm.currency?.code ? `${evm.currency.code} ` : '$')
  const tone = (v: number | null | undefined, good: (x: number) => boolean) => (v == null ? undefined : good(v) ? 'on-track' as const : 'attention' as const)
  const tiles: { label: string; value: string; meaning: string; short: string; tone?: 'on-track' | 'attention' }[] = [
    { label: 'SPI', value: idx(m.spi), tone: tone(m.spi, x => x >= 1), short: m.spi == null ? 'no work planned yet' : `work done per ${unit}1 planned`, meaning: m.spi == null ? 'No work was planned before the data date.' : `For every ${unit}1 of work planned to date, ${unit}${m.spi.toFixed(2)} of work was done.` },
    { label: 'CPI', value: idx(m.cpi), tone: tone(m.cpi, x => x >= 1), short: m.cpi == null ? 'needs actual costs' : `work done per ${unit}1 spent`, meaning: m.cpi == null ? 'Needs actual costs in the file.' : `For every ${unit}1 spent, ${unit}${m.cpi.toFixed(2)} of budgeted work was done.` },
    { label: 'Schedule variance (SV)', value: $(m.sv), tone: tone(m.sv, x => x >= 0), short: m.sv < 0 ? 'behind the plan' : 'at or ahead of the plan', meaning: m.sv < 0 ? 'Less work done than planned by the data date (in budget terms).' : 'At or ahead of the planned work.' },
    { label: 'Cost variance (CV)', value: $(m.cv), tone: tone(m.cv, x => x >= 0), short: m.cv == null ? 'needs actual costs' : m.cv < 0 ? 'over budget so far' : 'within budget so far', meaning: m.cv == null ? 'Needs actual costs in the file.' : m.cv < 0 ? 'The work done cost more than its budget.' : 'The work done cost no more than its budget.' },
    { label: 'Estimate at completion (EAC)', value: $(m.eacCpi), short: m.eacCpi == null ? 'needs actual costs' : 'forecast total cost', meaning: m.eacCpi == null ? 'Needs actual costs in the file.' : `Forecast total cost if cost efficiency continues (BAC ÷ CPI). With schedule efficiency too: ${$(m.eacCpiSpi)}.` },
    { label: 'Variance at completion (VAC)', value: $(m.vac), tone: tone(m.vac, x => x >= 0), short: m.vac == null ? 'needs actual costs' : m.vac < 0 ? 'forecast overrun' : 'forecast underrun', meaning: m.vac == null ? 'Needs actual costs in the file.' : m.vac < 0 ? `Forecast overrun against the ${$(m.bac)} budget.` : `Forecast underrun against the ${$(m.bac)} budget.` },
    { label: 'TCPI (to BAC)', value: idx(m.tcpiBac), tone: tone(m.tcpiBac, x => x <= 1), short: m.tcpiBac == null ? 'needs actual costs' : 'efficiency needed to finish on budget', meaning: m.tcpiBac == null ? 'Needs actual costs in the file.' : `Cost efficiency the remaining work needs to finish on budget${m.tcpiEac != null ? ` (${idx(m.tcpiEac)} to finish at the EAC)` : ''}.` },
  ]

  const esMeaning = es ? `The work done was planned by ${fmtDate(es.esDate)}: SV(t) ${es.svT} calendar days, SPI(t) ${idx(es.spiT)}.${es.forecastFinish ? ` At this rate the work finishes about ${fmtDate(es.forecastFinish)} (baseline ${fmtDate(es.baselineFinish)}).` : ''}` : ''
  const flagged = evm.checks.filter(c => c.result === 'flag').length
  const passed = evm.checks.filter(c => c.result === 'pass').length
  const notApplicable = evm.checks.length - flagged - passed
  const tile = 'bg-white border border-warm-200 rounded-[14px] p-4'

  return (
    <section aria-labelledby="evm-h" className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="evm-h" className="text-heading font-semibold text-ink">Earned value</h2>
          <p className="text-caption text-warm-600 mt-0.5">{evm.baseline.header} · data date {fmtDate(evm.dataDate)} · budget (BAC) {$(m.bac)}</p>
        </div>
        <a href={`/api/schedules/${scheduleId}/evm?format=xlsx`} className="text-body font-medium text-accent-600 hover:underline">Download (.xlsx)</a>
      </div>
      {evm.labels.map((l, i) => <p key={i} className="border-l-2 border-status-attention pl-3 text-body text-warm-700">{l}</p>)}

      {/* A number and a few words each. What every figure means, in full, is under "How these figures are calculated". */}
      <ul className="grid grid-cols-2 md:grid-cols-4 gap-3" aria-label="Earned value indicators">
        {tiles.map(t => (
          <li key={t.label} className={tile}>
            <div className="text-heading font-semibold tabular-nums text-ink">{t.value}</div>
            <div className="text-caption text-warm-700">{t.label}</div>
            <p className="text-caption text-warm-600 leading-snug">{t.short}</p>
          </li>
        ))}
        {es && (
          <li className={tile}>
            <div className="text-heading font-semibold tabular-nums text-ink">{es.svT > 0 ? '+' : ''}{es.svT} day{Math.abs(es.svT) === 1 ? '' : 's'}</div>
            <div className="text-caption text-warm-700">Earned schedule</div>
            <p className="text-caption text-warm-600 leading-snug">{es.forecastFinish ? `work finishes about ${fmtDate(es.forecastFinish)}` : `done work was planned by ${fmtDate(es.esDate)}`}</p>
          </li>
        )}
      </ul>

      <SCurve evm={evm} points={series?.points ?? null} />

      <div className="space-y-3">
        <Disclosure tone="card" title="By WBS" meta={`${evm.wbs.length} work area${evm.wbs.length === 1 ? '' : 's'}`}>
          <div tabIndex={0} role="region" aria-label="Earned value by WBS (scrolls sideways on small screens)" className="overflow-x-auto">
            <table className="w-full text-body [&_th]:text-caption min-w-[640px]">
              <caption className="sr-only">Earned value by WBS</caption>
              <thead><tr><th scope="col" className={th}>WBS</th><th scope="col" className={th}>BAC</th><th scope="col" className={th}>PV</th><th scope="col" className={th}>EV</th><th scope="col" className={th}>AC</th><th scope="col" className={th}>SV</th><th scope="col" className={th}>CV</th><th scope="col" className={th}>SPI</th><th scope="col" className={th}>CPI</th></tr></thead>
              <tbody>{evm.wbs.slice(0, 200).map(w => (
                <tr key={w.key}>
                  <th scope="row" className={`${td} text-left font-normal`} style={{ paddingLeft: `${0.5 + w.level * 1}rem` }}>{w.label}</th>
                  <td className={td}>{$(w.bac)}</td><td className={td}>{$(w.pv)}</td><td className={td}>{$(w.ev)}</td><td className={td}>{$(w.ac)}</td>
                  <td className={td}>{$(w.sv)}</td><td className={td}>{$(w.cv)}</td><td className={td}>{idx(w.spi)}</td><td className={td}>{idx(w.cpi)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Disclosure>

        {/* Open when something needs review; folded when every check passes or does not apply. */}
        <Disclosure tone="card" defaultOpen={flagged > 0} title="Earned value data integrity" meta={[flagged && `${flagged} to review`, passed && `${passed} pass`, notApplicable && `${notApplicable} not applicable`].filter(Boolean).join(' · ')}>
          <p className="text-caption text-warm-600 mb-2">{EVM_PRINCIPLE_NOTE}</p>
          <ul className="divide-y divide-warm-200">
            {evm.checks.map(c => (
              <li key={c.id} className="py-2 text-body">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="flex-1 min-w-[200px] font-medium text-ink">{c.title}</span>
                  {c.result === 'flag'
                    ? <span className="rounded-full bg-status-attention-bg px-2 py-0.5 text-caption font-semibold text-status-attention">Review</span>
                    : <span className="text-caption text-warm-600">{c.result === 'pass' ? 'Pass' : 'Not applicable'}</span>}
                </div>
                <div className="text-warm-700">{c.detail}</div>
                {c.activityCodes.length > 0 && <div className="text-caption text-warm-600">Activities: {c.activityCodes.slice(0, 20).join(', ')}{c.activityCodes.length > 20 ? ` and ${c.activityCodes.length - 20} more` : ''}</div>}
                <div className="text-caption text-warm-600">{c.principle}</div>
              </li>
            ))}
          </ul>
        </Disclosure>

        <Disclosure tone="card" title="How these figures are calculated" meta={evm.costSource === 'p6_xer' ? 'P6 XER' : evm.costSource === 'p6_xml' ? 'P6 XML' : evm.costSource === 'ms_xml' ? 'MS Project XML' : 'Spreadsheet'}>
          <dl className="text-caption text-warm-700 space-y-1.5">
            {(['bac', 'pv', 'ev', 'ac', 'es'] as const).map(k => <div key={k}><dt className="inline font-semibold text-ink">{k.toUpperCase()}: </dt><dd className="inline">{evm.methods[k]}</dd></div>)}
          </dl>
          <h3 className="text-body font-semibold text-ink mt-3 mb-1">What each figure means</h3>
          <dl className="text-caption text-warm-700 space-y-1.5">
            {tiles.map(t => <div key={t.label}><dt className="inline font-semibold text-ink">{t.label}: </dt><dd className="inline">{t.meaning}</dd></div>)}
            {es && <div><dt className="inline font-semibold text-ink">Earned schedule: </dt><dd className="inline">{esMeaning}</dd></div>}
          </dl>
          {evm.notes.length > 0 && <ul className="list-disc pl-5 mt-2 text-caption text-warm-700 space-y-0.5">{evm.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
          {series && series.notes.length > 0 && <ul className="list-disc pl-5 mt-2 text-caption text-warm-700 space-y-0.5">{series.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
          <p className="text-caption text-warm-600 mt-2">Percent types used: {[...new Set(evm.activities.map(a => percentTypeLabel(a.percentType)))].join(', ')}.</p>
        </Disclosure>
      </div>
    </section>
  )
}

/* ─── S-curve ─────────────────────────────────────────── */

const DAY = 86_400_000
const t = (d: string) => Date.parse(d.slice(0, 10) + 'T00:00:00Z')

/**
 * Cumulative PV (solid line), EV (dashed, circles) and AC (dotted, squares) over time. PV is the
 * time-phased baseline; EV and AC are known at each update's data date (one point per update).
 */
function SCurve({ evm, points }: { evm: EvmAnalysis; points: EvmTrendPoint[] | null }) {
  const [asTable, setAsTable] = useState(false)
  const titleId = useId()
  const descId = useId()
  // The chart is drawn at the width it is shown at, so 12px text is 12px on a phone and on a wide screen.
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => setWidth(Math.max(280, Math.round(el.clientWidth)))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [asTable])
  const m = evm.metrics!
  const start = evm.earnedSchedule?.baselineStart ?? evm.curve[0]?.date
  // EV / AC observations: each update of the series with figures, else just this one.
  const obs = (points?.filter(p => p.status !== 'not_available' && p.dataDate && p.ev != null) ?? [])
  const upd = obs.length ? obs : [{ version: evm.version, dataDate: evm.dataDate, ev: m.ev, ac: m.ac, pv: m.pv } as EvmTrendPoint]
  const evPts = [{ date: start, v: 0 }, ...upd.map(p => ({ date: p.dataDate!, v: p.ev! }))].filter(p => p.date)
  const acPts = upd.some(p => p.ac != null) ? [{ date: start, v: 0 }, ...upd.filter(p => p.ac != null).map(p => ({ date: p.dataDate!, v: p.ac! }))].filter(p => p.date) : []
  const pvPts = evm.curve.map(c => ({ date: c.date, v: c.pv }))
  const all = [...pvPts, ...evPts, ...acPts]
  if (!all.length || !start) return null
  const x0 = Math.min(...all.map(p => t(p.date!))), x1 = Math.max(...all.map(p => t(p.date!)))
  const yMax = Math.max(1, ...all.map(p => p.v)) * 1.05
  const W = width, H = width < 520 ? 220 : 280, L = 52, R = 12, T = 12, B = 30
  const sx = (d: string) => L + ((t(d) - x0) / Math.max(DAY, x1 - x0)) * (W - L - R)
  const sy = (v: number) => H - B - (v / yMax) * (H - T - B)
  const path = (pts: { date?: string; v: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.date!).toFixed(1)},${sy(p.v).toFixed(1)}`).join(' ')
  const ticksY = [0, 0.25, 0.5, 0.75, 1].map(f => f * yMax / 1.05)
  // One label when every point shares a date (five identical labels would be drawn on top of each other).
  const nx = x1 === x0 ? 1 : width < 520 ? 3 : 5
  const ticksX = Array.from({ length: nx }, (_, i) => new Date(x0 + ((x1 - x0) * i) / Math.max(1, nx - 1)).toISOString().slice(0, 10))
  // Axis amounts are short ($49.2M); the exact figures are in the key under the chart.
  const sym = evm.currency?.symbol || (evm.currency?.code ? `${evm.currency.code} ` : '$')
  const axis = (v: number) => { const a = Math.abs(v); const [d, u] = a >= 1e9 ? [1e9, 'B'] : a >= 1e6 ? [1e6, 'M'] : a >= 1e3 ? [1e3, 'K'] : [1, '']; return `${sym}${(v / d).toFixed(d === 1 || a / d >= 100 ? 0 : 1)}${u}` }
  const $ = (n: number | null | undefined) => fmtMoney(n, evm.currency)
  const dd = evm.dataDate
  const summary = `Cumulative planned value rises to ${$(m.bac)} by ${fmtDate(evm.earnedSchedule?.baselineFinish ?? pvPts[pvPts.length - 1]?.date)}. At the data date ${fmtDate(dd)}: planned ${$(m.pv)}, earned ${$(m.ev)}${m.ac != null ? `, actual cost ${$(m.ac)}` : ''}.`
  const rows = [...new Set([...upd.map(p => p.dataDate!), ...(asTable ? pvPts.map(p => p.date) : [])])].sort()

  return (
    <figure className="bg-white border border-warm-200 rounded-[14px] p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <figcaption id={titleId} className="text-subhead font-semibold text-ink">Cumulative cost over time</figcaption>
        <button type="button" onClick={() => setAsTable(v => !v)} aria-pressed={asTable} className="text-body font-medium text-accent-600 hover:underline">{asTable ? 'Show chart' : 'Show as table'}</button>
      </div>
      {/* The sentence the chart is described by: read by a screen reader, not printed above the picture that shows it. */}
      <p id={descId} className="sr-only">{summary}</p>
      {!asTable ? (
        <div ref={box}>
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-labelledby={`${titleId} ${descId}`}>
            {ticksY.map((v, i) => (
              <g key={i}>
                <line x1={L} x2={W - R} y1={sy(v)} y2={sy(v)} stroke="#D3D6D9" strokeWidth={1} />
                <text x={L - 8} y={sy(v) + 4} textAnchor="end" fontSize={12} fill="#4B5056">{axis(v)}</text>
              </g>
            ))}
            {ticksX.map((d, i) => <text key={i} x={sx(d)} y={H - B + 16} textAnchor={i === 0 ? 'start' : i === nx - 1 ? 'end' : 'middle'} fontSize={12} fill="#4B5056">{fmtDate(d)}</text>)}
            {dd && t(dd) >= x0 && t(dd) <= x1 && (
              <g><line x1={sx(dd)} x2={sx(dd)} y1={T} y2={H - B} stroke="#666C72" strokeWidth={1} strokeDasharray="2 3" /><text x={sx(dd) + 4} y={T + 10} fontSize={12} fill="#33383D">Data date</text></g>
            )}
            <path d={path(pvPts)} fill="none" stroke="#1D2125" strokeWidth={2} />
            <path d={path(evPts)} fill="none" stroke="#2B63C1" strokeWidth={2} strokeDasharray="7 4" />
            {evPts.slice(1).map((p, i) => <circle key={i} cx={sx(p.date!)} cy={sy(p.v)} r={4} fill="#2B63C1" />)}
            {acPts.length > 0 && <path d={path(acPts)} fill="none" stroke="#555B61" strokeWidth={2} strokeDasharray="2 3" />}
            {acPts.slice(1).map((p, i) => <rect key={i} x={sx(p.date!) - 3.5} y={sy(p.v) - 3.5} width={7} height={7} fill="#555B61" />)}
          </svg>
          {/* The key carries the figures at the data date, so they are said once. */}
          <ul className="flex flex-wrap gap-x-6 gap-y-1 mt-3 text-caption text-warm-700" aria-label={`Key, with the figures at the data date ${fmtDate(dd)}`}>
            <li className="flex items-center gap-2"><svg width="28" height="10" aria-hidden><line x1="0" x2="28" y1="5" y2="5" stroke="#1D2125" strokeWidth="2" /></svg>Planned (PV) <span className="font-semibold text-ink tabular-nums">{$(m.pv)}</span></li>
            <li className="flex items-center gap-2"><svg width="28" height="10" aria-hidden><line x1="0" x2="28" y1="5" y2="5" stroke="#2B63C1" strokeWidth="2" strokeDasharray="7 4" /><circle cx="14" cy="5" r="3.5" fill="#2B63C1" /></svg>Earned (EV) <span className="font-semibold text-ink tabular-nums">{$(m.ev)}</span></li>
            {acPts.length > 0 && <li className="flex items-center gap-2"><svg width="28" height="10" aria-hidden><line x1="0" x2="28" y1="5" y2="5" stroke="#555B61" strokeWidth="2" strokeDasharray="2 3" /><rect x="10.5" y="1.5" width="7" height="7" fill="#555B61" /></svg>Actual cost (AC) <span className="font-semibold text-ink tabular-nums">{$(m.ac)}</span></li>}
            {obs.length > 1 && <li className="text-warm-600">{obs.length} updates; lines are straight between them</li>}
          </ul>
        </div>
      ) : (
        <div tabIndex={0} role="region" aria-label="Cumulative cost by date (scrolls)" className="overflow-auto max-h-[360px]">
          <table className="w-full text-body [&_th]:text-caption">
            <thead><tr><th scope="col" className={th}>Date</th><th scope="col" className={th}>Update</th><th scope="col" className={th}>PV (cumulative)</th><th scope="col" className={th}>EV</th><th scope="col" className={th}>AC</th></tr></thead>
            <tbody>{rows.map(d => {
              const u = upd.find(p => p.dataDate === d)
              const pv = pvPts.find(p => p.date === d)?.v ?? (u?.pv ?? null)
              return <tr key={d}><td className={td}>{fmtDate(d)}</td><td className={td}>{u?.version ?? ''}</td><td className={td}>{$(pv)}</td><td className={td}>{u ? $(u.ev) : ''}</td><td className={td}>{u ? $(u.ac) : ''}</td></tr>
            })}</tbody>
          </table>
        </div>
      )}
    </figure>
  )
}
