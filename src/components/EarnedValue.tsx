'use client'

// "Earned value" tab of the schedule dashboard (src/lib/analysis/evm.ts): KPI tiles with what each
// means, the PV / EV / AC S-curve (plain SVG, distinct line styles and markers, with a table toggle),
// the WBS roll-up, the integrity checks and, when the inputs are missing, what is needed. Only real
// cost data from the uploaded file is used; nothing is estimated from durations.

import { useEffect, useId, useState } from 'react'
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

  if (loading) return <p className="text-[13px] text-warm-600" role="status">Loading earned value…</p>
  if (error) return <p className="text-[13px] text-status-at-risk" role="alert">{error}</p>
  if (!evm) return null

  if (evm.status === 'not_available') {
    return (
      <section aria-labelledby="evm-h" className="space-y-3">
        <h2 id="evm-h" className="font-display text-[18px] text-navy-950">Earned value</h2>
        <div className="bg-warm-100 border border-warm-200 rounded-lg p-5">
          <p className="text-[14px] font-semibold text-navy-950">Not available for this upload. It needs:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1 text-[13px] text-warm-700">
            {evm.missing.map(m => <li key={m.code}>{m.message}</li>)}
          </ul>
          <p className="text-[12.5px] text-warm-600 mt-3">Planora computes earned value only from real budgets and costs in the uploaded file (P6 resource assignments and expenses, MS Project cost fields, or cost columns in a spreadsheet). It never estimates them from durations.</p>
          <p className="text-[12px] text-warm-600 mt-1">{evm.baseline.header}</p>
        </div>
      </section>
    )
  }

  const m = evm.metrics!
  const $ = (n: number | null | undefined) => fmtMoney(n, evm.currency)
  const es = evm.earnedSchedule
  const tone = (v: number | null | undefined, good: (x: number) => boolean) => (v == null ? undefined : good(v) ? 'on-track' as const : 'attention' as const)
  const tiles: { label: string; value: string; meaning: string; tone?: 'on-track' | 'attention' }[] = [
    { label: 'SPI', value: idx(m.spi), tone: tone(m.spi, x => x >= 1), meaning: m.spi == null ? 'No work was planned before the data date.' : `For every $1 of work planned to date, $${m.spi.toFixed(2)} of work was done.` },
    { label: 'CPI', value: idx(m.cpi), tone: tone(m.cpi, x => x >= 1), meaning: m.cpi == null ? 'Needs actual costs in the file.' : `For every $1 spent, $${m.cpi.toFixed(2)} of budgeted work was done.` },
    { label: 'Schedule variance (SV)', value: $(m.sv), tone: tone(m.sv, x => x >= 0), meaning: m.sv < 0 ? 'Less work done than planned by the data date (in budget terms).' : 'At or ahead of the planned work.' },
    { label: 'Cost variance (CV)', value: $(m.cv), tone: tone(m.cv, x => x >= 0), meaning: m.cv == null ? 'Needs actual costs in the file.' : m.cv < 0 ? 'The work done cost more than its budget.' : 'The work done cost no more than its budget.' },
    { label: 'Estimate at completion (EAC)', value: $(m.eacCpi), meaning: m.eacCpi == null ? 'Needs actual costs in the file.' : `Forecast total cost if cost efficiency continues (BAC ÷ CPI). With schedule efficiency too: ${$(m.eacCpiSpi)}.` },
    { label: 'Variance at completion (VAC)', value: $(m.vac), tone: tone(m.vac, x => x >= 0), meaning: m.vac == null ? 'Needs actual costs in the file.' : m.vac < 0 ? `Forecast overrun against the ${$(m.bac)} budget.` : `Forecast underrun against the ${$(m.bac)} budget.` },
    { label: 'TCPI (to BAC)', value: idx(m.tcpiBac), tone: tone(m.tcpiBac, x => x <= 1), meaning: m.tcpiBac == null ? 'Needs actual costs in the file.' : `Cost efficiency the remaining work needs to finish on budget${m.tcpiEac != null ? ` (${idx(m.tcpiEac)} to finish at the EAC)` : ''}.` },
  ]

  return (
    <section aria-labelledby="evm-h" className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="evm-h" className="font-display text-[18px] text-navy-950">Earned value</h2>
          <p className="text-[12.5px] text-warm-600 mt-0.5">{evm.baseline.header} · data date {fmtDate(evm.dataDate)} · BAC {$(m.bac)} · PV {$(m.pv)} · EV {$(m.ev)} · AC {$(m.ac)}</p>
        </div>
        <a href={`/api/schedules/${scheduleId}/evm?format=xlsx`} className="text-[13px] font-medium text-accent-600 hover:underline">Download earned value (.xlsx)</a>
      </div>
      {evm.labels.map((l, i) => <p key={i} className="border-l-2 border-status-attention pl-3 text-[13px] text-warm-700">{l}</p>)}

      <ul className="grid grid-cols-2 md:grid-cols-4 gap-3" aria-label="Earned value indicators">
        {tiles.map(t => (
          <li key={t.label} className="bg-warm-50 border border-warm-200 rounded-lg p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-500 mb-1.5">{t.label}</div>
            <div className={`text-[22px] font-bold tabular-nums leading-none ${t.tone === 'on-track' ? 'text-status-on-track' : t.tone === 'attention' ? 'text-status-attention' : 'text-navy-950'}`}>{t.value}</div>
            <p className="text-[12px] text-warm-600 mt-2 leading-snug">{t.meaning}</p>
          </li>
        ))}
        {es && (
          <li className="bg-warm-50 border border-warm-200 rounded-lg p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-500 mb-1.5">Earned schedule</div>
            <div className={`text-[22px] font-bold tabular-nums leading-none ${es.svT < 0 ? 'text-status-attention' : 'text-status-on-track'}`}>{es.svT > 0 ? '+' : ''}{es.svT} days</div>
            <p className="text-[12px] text-warm-600 mt-2 leading-snug">The work done was planned by {fmtDate(es.esDate)}: SV(t) {es.svT} calendar days, SPI(t) {idx(es.spiT)}.{es.forecastFinish ? ` At this rate the work finishes about ${fmtDate(es.forecastFinish)} (baseline ${fmtDate(es.baselineFinish)}).` : ''}</p>
          </li>
        )}
      </ul>

      <SCurve evm={evm} points={series?.points ?? null} />
      {series && series.notes.length > 0 && <ul className="text-[12px] text-warm-600 space-y-0.5">{series.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}

      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <caption className="text-left font-semibold text-navy-950 mb-1">By WBS</caption>
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

      <div>
        <h3 className="text-[14px] font-semibold text-navy-950">Earned value data integrity</h3>
        <p className="text-[12px] text-warm-600 mb-2">{EVM_PRINCIPLE_NOTE}</p>
        <ul className="space-y-2">
          {evm.checks.map(c => (
            <li key={c.id} className={`border-l-2 pl-3 text-[13px] ${c.result === 'flag' ? 'border-status-attention' : c.result === 'pass' ? 'border-status-on-track' : 'border-warm-300'}`}>
              <span className="font-medium text-navy-950">{c.title}</span>{' '}
              <span className={`text-[11px] font-bold uppercase tracking-wider ${c.result === 'flag' ? 'text-status-attention' : c.result === 'pass' ? 'text-status-on-track' : 'text-warm-600'}`}>{c.result === 'flag' ? 'Review' : c.result === 'pass' ? 'Pass' : 'n/a'}</span>
              <div className="text-warm-700">{c.detail}</div>
              {c.activityCodes.length > 0 && <div className="text-[12px] text-warm-600">Activities: {c.activityCodes.slice(0, 20).join(', ')}{c.activityCodes.length > 20 ? ` and ${c.activityCodes.length - 20} more` : ''}</div>}
              <div className="text-[11.5px] text-warm-500">{c.principle}</div>
            </li>
          ))}
        </ul>
      </div>

      <Disclosure title="How these figures are calculated" meta={evm.costSource === 'p6_xer' ? 'P6 XER' : evm.costSource === 'ms_xml' ? 'MS Project XML' : 'Spreadsheet'}>
        <dl className="text-[12.5px] text-warm-700 space-y-1.5">
          {(['bac', 'pv', 'ev', 'ac', 'es'] as const).map(k => <div key={k}><dt className="inline font-semibold text-navy-950">{k.toUpperCase()}: </dt><dd className="inline">{evm.methods[k]}</dd></div>)}
        </dl>
        {evm.notes.length > 0 && <ul className="list-disc pl-5 mt-2 text-[12.5px] text-warm-700 space-y-0.5">{evm.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        <p className="text-[12px] text-warm-600 mt-2">Percent types used: {[...new Set(evm.activities.map(a => percentTypeLabel(a.percentType)))].join(', ')}.</p>
      </Disclosure>
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
  const W = 640, H = 260, L = 64, R = 12, T = 12, B = 34
  const sx = (d: string) => L + ((t(d) - x0) / Math.max(DAY, x1 - x0)) * (W - L - R)
  const sy = (v: number) => H - B - (v / yMax) * (H - T - B)
  const path = (pts: { date?: string; v: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.date!).toFixed(1)},${sy(p.v).toFixed(1)}`).join(' ')
  const ticksY = [0, 0.25, 0.5, 0.75, 1].map(f => f * yMax / 1.05)
  const ticksX = Array.from({ length: 5 }, (_, i) => new Date(x0 + ((x1 - x0) * i) / 4).toISOString().slice(0, 10))
  const $ = (n: number | null | undefined) => fmtMoney(n, evm.currency)
  const dd = evm.dataDate
  const summary = `Cumulative planned value rises to ${$(m.bac)} by ${fmtDate(evm.earnedSchedule?.baselineFinish ?? pvPts[pvPts.length - 1]?.date)}. At the data date ${fmtDate(dd)}: planned ${$(m.pv)}, earned ${$(m.ev)}${m.ac != null ? `, actual cost ${$(m.ac)}` : ''}.`
  const rows = [...new Set([...upd.map(p => p.dataDate!), ...(asTable ? pvPts.map(p => p.date) : [])])].sort()

  return (
    <figure className="bg-warm-50 border border-warm-200 rounded-lg p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <figcaption id={titleId} className="text-[14px] font-semibold text-navy-950">Cumulative cost over time (S-curve)</figcaption>
        <button type="button" onClick={() => setAsTable(v => !v)} aria-pressed={asTable} className="text-[12.5px] font-medium text-accent-600 hover:underline">{asTable ? 'Show chart' : 'Show as table'}</button>
      </div>
      <p id={descId} className="text-[12px] text-warm-600 mb-2">{summary}</p>
      {!asTable ? (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-labelledby={`${titleId} ${descId}`}>
            {ticksY.map((v, i) => (
              <g key={i}>
                <line x1={L} x2={W - R} y1={sy(v)} y2={sy(v)} stroke="#E2DDD5" strokeWidth={1} />
                <text x={L - 6} y={sy(v) + 4} textAnchor="end" fontSize={10} fill="#575047">{$(v)}</text>
              </g>
            ))}
            {ticksX.map((d, i) => <text key={i} x={sx(d)} y={H - B + 16} textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'} fontSize={10} fill="#575047">{fmtDate(d)}</text>)}
            {dd && t(dd) >= x0 && t(dd) <= x1 && (
              <g><line x1={sx(dd)} x2={sx(dd)} y1={T} y2={H - B} stroke="#736A60" strokeWidth={1} strokeDasharray="2 3" /><text x={sx(dd) + 4} y={T + 10} fontSize={10} fill="#433D36">Data date</text></g>
            )}
            <path d={path(pvPts)} fill="none" stroke="#0F2140" strokeWidth={2.25} />
            <path d={path(evPts)} fill="none" stroke="#2563eb" strokeWidth={2.25} strokeDasharray="7 4" />
            {evPts.slice(1).map((p, i) => <circle key={i} cx={sx(p.date!)} cy={sy(p.v)} r={4} fill="#2563eb" />)}
            {acPts.length > 0 && <path d={path(acPts)} fill="none" stroke="#94601C" strokeWidth={2.25} strokeDasharray="2 3" />}
            {acPts.slice(1).map((p, i) => <rect key={i} x={sx(p.date!) - 3.5} y={sy(p.v) - 3.5} width={7} height={7} fill="#94601C" />)}
          </svg>
          <ul className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-[12px] text-warm-700" aria-label="Legend">
            <li className="flex items-center gap-2"><svg width="28" height="10" aria-hidden><line x1="0" x2="28" y1="5" y2="5" stroke="#0F2140" strokeWidth="2.25" /></svg>PV, planned value (solid)</li>
            <li className="flex items-center gap-2"><svg width="28" height="10" aria-hidden><line x1="0" x2="28" y1="5" y2="5" stroke="#2563eb" strokeWidth="2.25" strokeDasharray="7 4" /><circle cx="14" cy="5" r="3.5" fill="#2563eb" /></svg>EV, earned value (dashed, circles)</li>
            {acPts.length > 0 && <li className="flex items-center gap-2"><svg width="28" height="10" aria-hidden><line x1="0" x2="28" y1="5" y2="5" stroke="#94601C" strokeWidth="2.25" strokeDasharray="2 3" /><rect x="10.5" y="1.5" width="7" height="7" fill="#94601C" /></svg>AC, actual cost (dotted, squares)</li>}
          </ul>
          <p className="text-[11.5px] text-warm-600 mt-1">EV and AC are known at each update&apos;s data date{obs.length > 1 ? ` (${obs.length} updates)` : ''}; between updates the lines are straight.</p>
        </>
      ) : (
        <div className="overflow-x-auto max-h-[360px]">
          <table className="w-full text-[12.5px]">
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
