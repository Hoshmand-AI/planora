'use client'

// Tools for an uploaded schedule: compare with the previous update, Monte Carlo risk, exports back
// to P6 / MS Project / Excel, the original file, and how Planora schedules it.

import { useEffect, useState } from 'react'
import { Disclosure } from './Disclosure'
import { fmtDate } from '@/lib/format'

interface SeriesRow { id: string; version: string; dataDate: string | null; forecastFinish: string | null; varianceDays: number | null; status: string | null }
interface Change { code: string; name: string; field: string; before: string | number | null; after: string | number | null; delta: number | null }
interface Comparison {
  before: { version: string; dataDate: string | null }
  summary: string[]
  added: { code: string; name: string }[]
  deleted: { code: string; name: string }[]
  logicAdded: { pred: string; succ: string; type: string; lag: number }[]
  logicDeleted: { pred: string; succ: string; type: string; lag: number }[]
  changes: Change[]
  actualsRewritten: Change[]
  floatErosion: { code: string; name: string; before: number; after: number; delta: number }[]
}
interface Sra { method: string; percentiles: { p10: string; p50: string; p80: string; p90: string }; deterministic: string; required?: { date: string; probability: number }; sensitivity: { code: string; name: string; correlation: number }[] }

const td = 'px-2 py-1.5 border-b border-warm-200 align-top'
const th = 'px-2 py-1.5 border-b border-warm-300 text-left font-semibold text-warm-600'

export function ScheduleTools({ scheduleId, progressMode, inHistory, onChanged, version = '', classification = null, origin = null, historyOverride = false }: {
  scheduleId: string; progressMode: 'retained' | 'override'; inHistory: boolean; onChanged: () => void
  version?: string; classification?: string | null; origin?: string | null; historyOverride?: boolean
}) {
  const [label, setLabel] = useState(version)
  const [notes, setNotes] = useState<string[]>([])
  useEffect(() => { setLabel(version) }, [version])
  const [series, setSeries] = useState<SeriesRow[]>([])
  const [cmp, setCmp] = useState<Comparison | null>(null)
  const [cmpMsg, setCmpMsg] = useState<string>('')
  const [base, setBase] = useState<string>('')
  const [sra, setSra] = useState<Sra | null>(null)
  const [sraErr, setSraErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    fetch(`/api/schedules/compare?id=${scheduleId}${base ? `&base=${base}` : ''}`).then(r => r.json()).then(d => {
      if (!live) return
      setSeries(d.series || [])
      setCmp(d.comparison || null)
      setCmpMsg(d.message || d.error || '')
    }).catch(() => {})
    return () => { live = false }
  }, [scheduleId, base])

  const runRisk = async () => {
    setBusy(true); setSraErr('')
    const r = await fetch(`/api/schedules/${scheduleId}/risk`)
    const d = await r.json().catch(() => ({}))
    setBusy(false)
    if (r.ok) setSra(d); else setSraErr(d.error || 'Risk analysis failed.')
  }
  const patch = async (body: Record<string, unknown>) => {
    const r = await fetch('/api/schedules', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: scheduleId, ...body }) })
    const d = await r.json().catch(() => ({}))
    setNotes(r.ok ? (d.warnings ?? []) : [d.error || 'The change was not saved.'])
    onChanged()
  }
  const restricted = classification === 'cui' || classification === 'classified'
  const exp = (format: string) => `/api/schedules/${scheduleId}/export?format=${format}`
  const others = series.filter(s => s.id !== scheduleId)

  return (
    <section aria-labelledby="tools-h" className="space-y-1">
      <h2 id="tools-h" className="font-display text-[18px] text-navy-950 mb-2">Updates, risk and exports</h2>

      <Disclosure title="Compare with another update" meta={series.length > 1 ? `${series.length} uploads of this project` : 'first upload'} defaultOpen={!!cmp}>
        {others.length > 0 && (
          <label className="block text-[13px] text-warm-700 mb-3">Compare against{' '}
            <select className="ml-1 border border-warm-300 rounded px-2 py-1 bg-white" value={base} onChange={e => setBase(e.target.value)}>
              <option value="">previous update (earlier data date)</option>
              {others.map(s => <option key={s.id} value={s.id}>{s.version}{s.dataDate ? ` (data date ${fmtDate(s.dataDate)})` : ''}</option>)}
            </select>
          </label>
        )}
        {!cmp ? <p className="text-[13px] text-warm-600">{cmpMsg || 'Loading…'}</p> : (
          <div className="space-y-4 text-[13px] text-warm-700">
            <p className="text-warm-600">Against {cmp.before.version}{cmp.before.dataDate ? ` (data date ${fmtDate(cmp.before.dataDate)})` : ''}:{' '}
              <a className="underline text-navy-950" href={`/api/schedules/compare?${new URLSearchParams({ id: scheduleId, ...(base ? { base } : {}), format: 'csv' }).toString()}`}>Download differences (CSV)</a></p>
            <ul className="list-disc pl-5 space-y-1">{cmp.summary.map((s, i) => <li key={i}>{s}</li>)}</ul>
            {cmp.floatErosion.length > 0 && (
              <div className="overflow-x-auto"><table className="w-full text-[12.5px]"><caption className="text-left font-semibold text-navy-950 mb-1">Largest float erosion (work days)</caption>
                <thead><tr><th className={th}>ID</th><th className={th}>Activity</th><th className={th}>Before</th><th className={th}>After</th><th className={th}>Change</th></tr></thead>
                <tbody>{cmp.floatErosion.slice(0, 10).map(f => <tr key={f.code}><td className={td}>{f.code}</td><td className={td}>{f.name}</td><td className={td}>{f.before}</td><td className={td}>{f.after}</td><td className={td}>{f.delta}</td></tr>)}</tbody></table></div>
            )}
            {cmp.changes.filter(c => ['duration', 'constraint', 'calendar'].includes(c.field)).length > 0 && (
              <div className="overflow-x-auto"><table className="w-full text-[12.5px]"><caption className="text-left font-semibold text-navy-950 mb-1">Duration, constraint and calendar changes</caption>
                <thead><tr><th className={th}>ID</th><th className={th}>Activity</th><th className={th}>Change</th><th className={th}>Before</th><th className={th}>After</th></tr></thead>
                <tbody>{cmp.changes.filter(c => ['duration', 'constraint', 'calendar'].includes(c.field)).slice(0, 20).map((c, i) => <tr key={i}><td className={td}>{c.code}</td><td className={td}>{c.name}</td><td className={td}>{c.field}</td><td className={td}>{String(c.before ?? '—')}</td><td className={td}>{String(c.after ?? '—')}</td></tr>)}</tbody></table></div>
            )}
            {(cmp.logicAdded.length + cmp.logicDeleted.length) > 0 && (
              <p><span className="font-semibold text-navy-950">Logic:</span> {cmp.logicAdded.slice(0, 8).map(l => `+ ${l.pred}→${l.succ} ${l.type}`).concat(cmp.logicDeleted.slice(0, 8).map(l => `− ${l.pred}→${l.succ} ${l.type}`)).join(' · ')}</p>
            )}
            {cmp.actualsRewritten.length > 0 && <p className="border-l-2 border-status-at-risk pl-2"><span className="font-semibold">Actuals rewritten:</span> {cmp.actualsRewritten.map(c => `${c.code} ${c.field.replace('_', ' ')} ${fmtDate(String(c.before))} → ${fmtDate(String(c.after))}`).join('; ')}</p>}
            {(cmp.added.length + cmp.deleted.length) > 0 && <p><span className="font-semibold text-navy-950">Added:</span> {cmp.added.map(a => a.code).join(', ') || 'none'} · <span className="font-semibold text-navy-950">Deleted:</span> {cmp.deleted.map(a => a.code).join(', ') || 'none'}</p>}
          </div>
        )}
      </Disclosure>

      <Disclosure title="Schedule risk analysis (Monte Carlo)" meta={sra ? `P80 ${fmtDate(sra.percentiles.p80)}` : undefined}>
        {!sra ? (
          <div className="text-[13px] text-warm-700 space-y-2">
            <p>Simulates this schedule&apos;s own network with three-point duration ranges and reports one labeled P50/P80.</p>
            <button type="button" onClick={runRisk} disabled={busy} className="px-3 py-1.5 rounded-full bg-navy-950 text-white text-[13px] font-medium disabled:opacity-60">{busy ? 'Running…' : 'Run risk analysis'}</button>
            {sraErr && <p className="text-status-at-risk">{sraErr}</p>}
          </div>
        ) : (
          <div className="text-[13px] text-warm-700 space-y-2">
            <p><span className="font-semibold text-navy-950">Monte Carlo P50 {fmtDate(sra.percentiles.p50)} · P80 {fmtDate(sra.percentiles.p80)}</span> (deterministic forecast {fmtDate(sra.deterministic)}){sra.required ? `; ${Math.round(sra.required.probability * 100)}% chance of meeting ${fmtDate(sra.required.date)}` : ''}.</p>
            <p className="text-warm-600">{sra.method}</p>
            {sra.sensitivity.length > 0 && <p>Biggest drivers: {sra.sensitivity.slice(0, 5).map(s => `${s.code} ${s.name}`).join('; ')}.</p>}
          </div>
        )}
      </Disclosure>

      <Disclosure title="Export and original file">
        <div className="flex flex-wrap gap-2 text-[13px]">
          {[['xer', 'Primavera P6 (.xer)'], ['xml', 'MS Project (.xml)'], ['xlsx-p6', 'Excel, P6 layout'], ['xlsx-import', 'Excel for import'], ...(restricted ? [] : [['csv', 'CSV']]), ['original', 'Original file as uploaded']].map(([f, label]) => (
            <a key={f} href={exp(f)} className="px-3 py-1.5 rounded-full border border-warm-300 text-navy-950 hover:bg-warm-100">{label}</a>
          ))}
        </div>
        <p className="text-[12px] text-warm-600 mt-2">Exports keep the file&apos;s activity IDs, WBS, progress and required finish. The original file is stored with its SHA-256, recorded in the audit log.</p>
        {restricted && <p className="text-[12px] text-warm-700 mt-1">This schedule is marked {classification === 'cui' ? 'CUI' : 'classified'}: every export carries the banner and designation markings, and CSV is not offered because it cannot carry them.</p>}
      </Disclosure>

      <Disclosure title="How Planora schedules this file">
        <div className="text-[13px] text-warm-700 space-y-3">
          <fieldset>
            <legend className="font-semibold text-navy-950 mb-1">Out-of-sequence progress</legend>
            <label className="mr-4"><input type="radio" name="pm" checked={progressMode === 'retained'} onChange={() => patch({ progressMode: 'retained' })} /> Retained logic (P6 default)</label>
            <label><input type="radio" name="pm" checked={progressMode === 'override'} onChange={() => patch({ progressMode: 'override' })} /> Progress override</label>
          </fieldset>
          <label className="block"><input type="checkbox" checked={inHistory} onChange={e => patch({ inHistory: e.target.checked })} /> Use this schedule&apos;s actuals to calibrate our firm history (only for your own as-built projects)</label>
          {inHistory && (
            <label className="block ml-5"><input type="checkbox" checked={historyOverride} onChange={e => patch({ inHistory: true, historyOverride: e.target.checked })} /> Include it even if not every activity has an actual finish</label>
          )}
          <label className="block">Whose schedule{' '}
            <select className="ml-1 border border-warm-300 rounded px-2 py-1 bg-white" value={origin ?? ''} onChange={e => patch({ origin: e.target.value || null })}>
              <option value="">Not stated</option>
              <option value="own">Our own project</option>
              <option value="third_party">Third-party (we review it)</option>
            </select>
          </label>
          <label className="block">Security classification{' '}
            <select className="ml-1 border border-warm-300 rounded px-2 py-1 bg-white" value={classification ?? 'unclassified'} onChange={e => patch({ classification: e.target.value })}>
              <option value="unclassified">Unclassified</option>
              <option value="cui">CUI</option>
              <option value="classified">Classified</option>
            </select>
          </label>
          <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); if (label.trim() && label.trim() !== version) patch({ version: label.trim() }) }}>
            <label htmlFor="ver-label">Version label</label>
            <input id="ver-label" className="border border-warm-300 rounded px-2 py-1 bg-white" maxLength={40} value={label} onChange={e => setLabel(e.target.value)} />
            <button type="submit" className="px-3 py-1 rounded-full border border-warm-300 text-navy-950 hover:bg-warm-100">Rename</button>
          </form>
          {notes.length > 0 && <ul role="status" className="list-disc pl-5 text-warm-700">{notes.map(n => <li key={n}>{n}</li>)}</ul>}
        </div>
      </Disclosure>
    </section>
  )
}
