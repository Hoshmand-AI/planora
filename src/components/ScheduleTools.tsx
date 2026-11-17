'use client'

// Tools for an uploaded schedule: compare with the previous update, edits made in RunF9 (with
// reasons), what-if / recovery options, Monte Carlo risk with the scheduler's own ranges and risk
// events, exports back to P6 / MS Project / Excel, the original file, and how RunF9 schedules it.

import { useEffect, useState, useRef } from 'react'
import { Disclosure } from './Disclosure'
import { FinishDistribution } from './FinishDistribution'
import { fmtDate, fmtDates } from '@/lib/format'
import { EditsPanel, RecoveryPanel, RiskInputsPanel, type RiskInputsView } from './UploadedScheduleEdits'

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
interface SraMilestone { id: string; code: string; name: string; contract: boolean; required: string | null; requiredSource: string | null; deterministic: string; p50: string; p80: string; probability: number | null }
interface Sra {
  method: string; percentiles: { p10: string; p50: string; p80: string; p90: string }; deterministic: string; required?: { date: string; probability: number }
  histogram?: { from: string; to: string; count: number }[]; iterations?: number
  contract?: SraMilestone | null; milestones?: SraMilestone[]; warnings?: string[]
  sensitivity: { code: string; name: string; correlation: number; basis: string }[]; assumptions: string[]
  events?: { id: string; name: string; code: string; probability: number; impactDays: number; occurred: number; finishDeltaDays: number }[]
  inputs?: RiskInputsView
}

const td = 'px-2 py-1.5 border-b border-warm-200 align-top'
const th = 'px-2 py-1.5 border-b border-warm-300 text-left font-semibold text-warm-600'

export function ScheduleTools({ scheduleId, progressMode, inHistory, onChanged, version = '', classification = null, origin = null, historyOverride = false, canEdit = false, editsCount = 0 }: {
  scheduleId: string; progressMode: 'retained' | 'override'; inHistory: boolean; onChanged: () => void
  version?: string; classification?: string | null; origin?: string | null; historyOverride?: boolean; canEdit?: boolean; editsCount?: number
}) {
  const [label, setLabel] = useState(version)
  const [notes, setNotes] = useState<string[]>([])
  useEffect(() => { setLabel(version) }, [version])
  const [series, setSeries] = useState<SeriesRow[]>([])
  const [cmp, setCmp] = useState<Comparison | null>(null)
  const [cmpMsg, setCmpMsg] = useState<string>('')
  const [base, setBase] = useState<string>('')
  // The uploads the project keeps to compare against (its baseline, and one more such as last month's update).
  const [kept, setKept] = useState<{ baselineId: string | null; comparisonId: string | null; comparisonApplies?: boolean }>({ baselineId: null, comparisonId: null })
  const [keptMsg, setKeptMsg] = useState('')
  async function keep(change: { baselineScheduleId?: string | null; comparisonScheduleId?: string | null }) {
    setKeptMsg('')
    try {
      const r = await fetch(`/api/schedules/${scheduleId}/roles`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setKeptMsg(d.error || 'The choice was not saved.'); return }
      setKept({ baselineId: d.baseline?.id ?? null, comparisonId: d.comparison?.id ?? null })
      setKeptMsg('baselineScheduleId' in change ? (d.baseline ? `${d.baseline.version} is now the baseline every update of this project is measured against.` : 'This project has no stored baseline now.') : (d.comparison ? `${d.comparison.version} is now what each update is compared with.` : 'Each update is compared with the one before it.'))
      // The comparison below follows the stored choice again, and the headline is measured against the new baseline.
      setBase(''); setRev(x => x + 1); onChanged()
    } catch { setKeptMsg('The choice was not saved: could not reach RunF9.') }
  }
  const [sra, setSra] = useState<Sra | null>(null)
  const [sraErr, setSraErr] = useState('')
  const [busy, setBusy] = useState(false)
  // Which network the tools below use: the schedule as submitted (default) or the what-if scenario.
  const [basis, setBasis] = useState<'submitted' | 'scenario'>('submitted')
  useEffect(() => { setBasis('submitted') }, [scheduleId])
  useEffect(() => { if (!editsCount) setBasis('submitted') }, [editsCount])
  const bq: Record<string, string> = basis === 'scenario' ? { basis: 'scenario' } : {}
  // Bumped after an edit so the edits list, the options and the risk analysis reload.
  const [rev, setRev] = useState(0)
  // Deep link from the Quality page (…#recovery) opens the what-if and recovery options.
  const [openRecovery] = useState(() => typeof window !== 'undefined' && window.location.hash === '#recovery')
  useEffect(() => {
    if (openRecovery) setTimeout(() => document.getElementById('recovery')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
  }, [openRecovery])
  const edited = () => { setRev(r => r + 1); setSra(null); onChanged() }

  useEffect(() => {
    let live = true
    fetch(`/api/schedules/compare?${new URLSearchParams({ id: scheduleId, ...(base ? { base } : {}), ...(basis === 'scenario' ? { basis } : {}) }).toString()}`).then(r => r.json()).then(d => {
      if (!live) return
      setSeries(d.series || [])
      setCmp(d.comparison || null)
      setCmpMsg(d.message || d.error || '')
      if (d.kept) setKept(d.kept)
    }).catch(() => { if (live) setCmpMsg('Could not load the comparison. Check your connection and reload.') })
    return () => { live = false }
  }, [scheduleId, base, basis, rev])
  useEffect(() => { setSra(null) }, [basis])

  // The basis the page shows now: an answer for another basis (switched while it ran) is dropped.
  const basisNow = useRef(basis)
  basisNow.current = basis
  const runRisk = async () => {
    const asked = basis
    setBusy(true); setSraErr('')
    try {
      const r = await fetch(`/api/schedules/${scheduleId}/risk${asked === 'scenario' ? '?basis=scenario' : ''}`)
      const d = await r.json().catch(() => ({}))
      if (basisNow.current !== asked) return
      if (r.ok) setSra(d); else setSraErr(d.error || 'Risk analysis failed.')
    } catch { setSraErr('Could not reach RunF9. Check your connection and try again.') } finally { setBusy(false) }
  }
  const patch = async (body: Record<string, unknown>) => {
    try {
      const r = await fetch('/api/schedules', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: scheduleId, ...body }) })
      const d = await r.json().catch(() => ({}))
      setNotes(r.ok ? (d.warnings ?? []) : [d.error || 'The change was not saved.'])
    } catch { setNotes(['The change was not saved: could not reach RunF9.']) }
    onChanged()
  }
  const restricted = classification === 'cui' || classification === 'classified'
  const exp = (format: string) => `/api/schedules/${scheduleId}/export?${new URLSearchParams({ format, ...(format !== 'original' ? bq : {}) }).toString()}`
  const others = series.filter(s => s.id !== scheduleId)

  return (
    <section aria-labelledby="tools-h" className="space-y-2">
      <h2 id="tools-h" className="text-heading font-semibold text-ink mb-2">Analysis tools for this schedule</h2>
      {editsCount > 0 && (
        <fieldset className="text-body text-warm-700 mb-2">
          <legend className="font-semibold text-ink mb-1">Basis for recovery, comparison, risk and exports</legend>
          <label className="mr-4"><input type="radio" name="basis" checked={basis === 'submitted'} onChange={() => setBasis('submitted')} /> As submitted</label>
          <label><input type="radio" name="basis" checked={basis === 'scenario'} onChange={() => setBasis('scenario')} /> With RunF9 edits ({editsCount})</label>
          <p className="text-caption text-warm-600 mt-1">{basis === 'scenario' ? `A what-if scenario: the ${editsCount} edit${editsCount === 1 ? '' : 's'} made in RunF9 are applied. Outputs say so, and exports say they are derived from the original file.` : 'The schedule exactly as submitted. Status, variance, quality and the portfolio always use it.'}</p>
        </fieldset>
      )}

      <Disclosure tone="card" id="compare" title="What changed since the last update" meta={series.length > 1 ? `${series.length} uploads of this project` : 'first upload'} defaultOpen={!!cmp}>
        {series.length > 1 && (
          <fieldset className="mb-4 rounded-lg border border-warm-200 bg-warm-50 p-3 text-body text-warm-700">
            <legend className="px-1 font-semibold text-ink">Kept for this project</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">Baseline
                <select aria-describedby="kept-note" disabled={!canEdit} className="mt-1 block w-full rounded-lg border border-warm-300 bg-white px-2 h-9 text-body text-ink" value={kept.baselineId ?? ''} onChange={e => keep({ baselineScheduleId: e.target.value || null })}>
                  <option value="">none stored (the upload labelled Baseline, if any)</option>
                  {series.map(s => <option key={s.id} value={s.id}>{s.version}{s.dataDate ? ` (data date ${fmtDate(s.dataDate)})` : ''}</option>)}
                </select>
              </label>
              <label className="block">Comparison schedule
                <select aria-describedby="kept-note" disabled={!canEdit} className="mt-1 block w-full rounded-lg border border-warm-300 bg-white px-2 h-9 text-body text-ink" value={kept.comparisonId ?? ''} onChange={e => keep({ comparisonScheduleId: e.target.value || null })}>
                  <option value="">the update before each one</option>
                  {series.map(s => <option key={s.id} value={s.id}>{s.version}{s.dataDate ? ` (data date ${fmtDate(s.dataDate)})` : ''}</option>)}
                </select>
              </label>
            </div>
            <p id="kept-note" className="mt-2 text-caption text-warm-600">Every upload of this project, and each new one, is measured against the baseline. The comparison schedule (last month&rsquo;s update, for example) is what &ldquo;what changed&rdquo; compares with unless you pick another below.</p>
            <p role="status" className="text-caption text-ink">{keptMsg}</p>
          </fieldset>
        )}
        {others.length > 0 && (
          <label className="block text-body text-warm-700 mb-3">Compare against{' '}
            <select className="ml-1 rounded-lg border border-warm-300 px-2 h-9 bg-white text-body text-ink" value={base} onChange={e => setBase(e.target.value)}>
              <option value="">{kept.comparisonApplies ? 'the stored comparison schedule' : 'previous update (earlier data date)'}</option>
              {kept.baselineId && kept.baselineId !== scheduleId && <option value="baseline">the stored baseline</option>}
              {others.map(s => <option key={s.id} value={s.id}>{s.version}{s.dataDate ? ` (data date ${fmtDate(s.dataDate)})` : ''}</option>)}
            </select>
          </label>
        )}
        {!cmp ? <p className="text-body text-warm-600">{cmpMsg || 'Loading…'}</p> : (
          <div className="space-y-4 text-body text-warm-700">
            <p className="text-warm-600">Against {cmp.before.version}{cmp.before.dataDate ? ` (data date ${fmtDate(cmp.before.dataDate)})` : ''}:{' '}
              <a className="underline text-ink" href={`/api/schedules/compare?${new URLSearchParams({ id: scheduleId, ...(base ? { base } : {}), ...bq, format: 'csv' }).toString()}`}>Download differences (CSV)</a>{' · '}
              <a className="underline text-ink" href={`/api/schedules/compare?${new URLSearchParams({ id: scheduleId, ...(base ? { base } : {}), ...bq, format: 'xlsx' }).toString()}`}>Excel, sheet per change type</a>{' · '}
              <a className="underline text-ink" href={`/api/schedules/windows?${new URLSearchParams({ id: scheduleId, ...bq, format: 'xlsx' }).toString()}`}>Windows analysis (Excel)</a></p>
            <ul className="list-disc pl-5 space-y-1">{cmp.summary.map((s, i) => <li key={i}>{s}</li>)}</ul>
            {cmp.floatErosion.length > 0 && (
              <div className="overflow-x-auto" tabIndex={0} role="group" aria-label="Largest float erosion (work days)"><table className="w-full text-body [&_th]:text-caption"><caption className="text-left font-semibold text-ink mb-1">Largest float erosion (work days)</caption>
                <thead><tr><th className={th}>ID</th><th className={th}>Activity</th><th className={th}>Before</th><th className={th}>After</th><th className={th}>Change</th></tr></thead>
                <tbody>{cmp.floatErosion.slice(0, 10).map(f => <tr key={f.code}><td className={td}>{f.code}</td><td className={td}>{f.name}</td><td className={td}>{f.before}</td><td className={td}>{f.after}</td><td className={td}>{f.delta}</td></tr>)}</tbody></table></div>
            )}
            {cmp.changes.filter(c => ['duration', 'constraint', 'calendar'].includes(c.field)).length > 0 && (
              <div className="overflow-x-auto" tabIndex={0} role="group" aria-label="Duration, constraint and calendar changes"><table className="w-full text-body [&_th]:text-caption"><caption className="text-left font-semibold text-ink mb-1">Duration, constraint and calendar changes</caption>
                <thead><tr><th className={th}>ID</th><th className={th}>Activity</th><th className={th}>Change</th><th className={th}>Before</th><th className={th}>After</th></tr></thead>
                <tbody>{cmp.changes.filter(c => ['duration', 'constraint', 'calendar'].includes(c.field)).slice(0, 20).map((c, i) => <tr key={i}><td className={td}>{c.code}</td><td className={td}>{c.name}</td><td className={td}>{c.field}</td><td className={td}>{fmtDates(String(c.before ?? '—'))}</td><td className={td}>{fmtDates(String(c.after ?? '—'))}</td></tr>)}</tbody></table></div>
            )}
            {(cmp.logicAdded.length + cmp.logicDeleted.length) > 0 && (
              <p><span className="font-semibold text-ink">Logic:</span> {cmp.logicAdded.slice(0, 8).map(l => `+ ${l.pred}→${l.succ} ${l.type}`).concat(cmp.logicDeleted.slice(0, 8).map(l => `− ${l.pred}→${l.succ} ${l.type}`)).join(' · ')}</p>
            )}
            {cmp.actualsRewritten.length > 0 && <p className="border-l-2 border-status-at-risk pl-2"><span className="font-semibold">Actuals rewritten:</span> {cmp.actualsRewritten.map(c => `${c.code} ${c.field.replace('_', ' ')} ${c.before ? fmtDate(String(c.before)) : 'none'} → ${c.after ? fmtDate(String(c.after)) : 'none'}`).join('; ')}</p>}
            {(cmp.added.length + cmp.deleted.length) > 0 && <p><span className="font-semibold text-ink">Added:</span> {cmp.added.map(a => a.code).join(', ') || 'none'} · <span className="font-semibold text-ink">Deleted:</span> {cmp.deleted.map(a => a.code).join(', ') || 'none'}</p>}
          </div>
        )}
      </Disclosure>

      <Disclosure tone="card" id="delays" title="Delays (time impact analysis)">
        <p className="text-body text-warm-700 mb-2">Model a delay event as a fragnet, insert it into this update as of its data date, recalculate, and compare the contract and interim milestones before and after, with the driving path, concurrency indicators and a downloadable report. The result is a calculation; entitlement is a contractual determination.</p>
        <a href="/dashboard/time-impact" className="inline-block px-3.5 py-1.5 rounded-lg border border-warm-300 text-ink text-body hover:bg-warm-100">Open time impact analysis</a>
      </Disclosure>

      <Disclosure tone="card" title="Edits made in RunF9" meta={editsCount ? `${editsCount} edit${editsCount === 1 ? '' : 's'}` : 'none'} defaultOpen={editsCount > 0}>
        <EditsPanel scheduleId={scheduleId} canEdit={canEdit} onChanged={edited} refreshKey={rev} />
      </Disclosure>

      <Disclosure tone="card" id="recovery" title="What-if and recovery options" meta={basis === 'scenario' ? `with RunF9 edits (${editsCount})` : 'as submitted'} defaultOpen={openRecovery}>
        <RecoveryPanel scheduleId={scheduleId} canEdit={canEdit} onApplied={edited} refreshKey={rev} basis={basis} />
      </Disclosure>

      <Disclosure tone="card" title="Schedule risk analysis (Monte Carlo)" meta={sra ? `P80 ${fmtDate(sra.percentiles.p80)}` : undefined}>
        {!sra ? (
          <div className="text-body text-warm-700 space-y-2">
            <p>Simulates this schedule&apos;s own network with three-point duration ranges and reports one labeled P50/P80.</p>
            <button type="button" onClick={runRisk} disabled={busy} className="px-3.5 py-1.5 rounded-lg bg-accent-600 hover:bg-accent-700 text-white text-body font-semibold">{busy ? 'Running…' : 'Run risk analysis'}</button>
            {sraErr && <p className="text-status-at-risk">{sraErr}</p>}
          </div>
        ) : (
          <div className="text-body text-warm-700 space-y-4">
            {/* The answer first: three figures. How it was simulated, and the scheduler's own inputs, are folded below. */}
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-8 gap-y-4 [&>div]:flex [&>div]:flex-col">
              <div>
                <dt className="order-2 text-caption text-warm-700">P50 finish</dt>
                <dd className="order-1 text-subhead font-semibold text-ink tabular-nums">{fmtDate(sra.percentiles.p50)}</dd>
                <dd className="order-3 text-caption text-warm-600">half of the simulated outcomes finish by then</dd>
              </div>
              <div>
                <dt className="order-2 text-caption text-warm-700">P80 finish</dt>
                <dd className="order-1 text-subhead font-semibold text-ink tabular-nums">{fmtDate(sra.percentiles.p80)}</dd>
                <dd className="order-3 text-caption text-warm-600">a date to commit to with 80% confidence</dd>
              </div>
              {sra.required ? (
                <div>
                  <dt className="order-2 text-caption text-warm-700">Chance of meeting {fmtDate(sra.required.date)}</dt>
                  <dd className="order-1 text-subhead font-semibold text-ink tabular-nums">{Math.round(sra.required.probability * 100)}%</dd>
                  <dd className="order-3 text-caption text-warm-600">deterministic forecast {fmtDate(sra.deterministic)}</dd>
                </div>
              ) : (
                <div>
                  <dt className="order-2 text-caption text-warm-700">Deterministic forecast</dt>
                  <dd className="order-1 text-subhead font-semibold text-ink tabular-nums">{fmtDate(sra.deterministic)}</dd>
                  <dd className="order-3 text-caption text-warm-600">if every activity takes its planned duration</dd>
                </div>
              )}
            </dl>
            {sra.histogram && sra.histogram.length > 0 && <FinishDistribution histogram={sra.histogram} iterations={sra.iterations} required={sra.required?.date} median={sra.percentiles.p50} />}
            {sra.warnings && sra.warnings.length > 0 && <ul className="list-disc pl-5 border-l-2 border-status-info">{sra.warnings.map((x, i) => <li key={i}>{x}</li>)}</ul>}
            {/* The contract milestone is spelled out only when its dates differ from the project's: the same dates are not said twice. */}
            {sra.contract && (sra.contract.p50 === sra.percentiles.p50 && sra.contract.p80 === sra.percentiles.p80 && (sra.contract.required ?? null) === (sra.required?.date ?? null)
              ? <p className="text-warm-600">These are also the dates of the contract milestone {sra.contract.code} {sra.contract.name}{sra.contract.requiredSource ? ` (${sra.contract.requiredSource})` : ''}.</p>
              : <p><span className="font-semibold text-ink">Contract milestone {sra.contract.code} {sra.contract.name}: P50 {fmtDate(sra.contract.p50)} · P80 {fmtDate(sra.contract.p80)}</span>{sra.contract.required && sra.contract.probability != null ? `; ${Math.round(sra.contract.probability * 100)}% chance of meeting ${fmtDate(sra.contract.required)}${sra.contract.requiredSource ? ` (${sra.contract.requiredSource})` : ''}` : '; no date to meet'}.</p>)}
            {sra.milestones && sra.milestones.filter(m => !m.contract).length > 0 && (
              <div className="overflow-x-auto" tabIndex={0} role="group" aria-label="Milestones with a finish constraint"><table className="w-full text-body [&_th]:text-caption"><caption className="text-left font-semibold text-ink mb-1">Milestones with a finish constraint</caption>
                <thead><tr><th className={th}>Milestone</th><th className={th}>Date to meet</th><th className={th}>P50</th><th className={th}>P80</th><th className={th}>Chance of meeting</th></tr></thead>
                <tbody>{sra.milestones.filter(m => !m.contract).map(m => <tr key={m.id}><td className={td}>{m.code} {m.name}</td><td className={td}>{m.required ? fmtDate(m.required) : '—'}</td><td className={td}>{fmtDate(m.p50)}</td><td className={td}>{fmtDate(m.p80)}</td><td className={td}>{m.probability != null ? `${Math.round(m.probability * 100)}%` : '—'}</td></tr>)}</tbody></table></div>
            )}
            {sra.sensitivity.length > 0 && (
              <div>
                <p className="text-caption font-semibold text-ink mb-1">Biggest drivers of the finish</p>
                <ol className="list-decimal pl-5 space-y-0.5">{sra.sensitivity.slice(0, 5).map(s => <li key={s.code}><span className="tabular-nums text-warm-600">{s.code}</span> {s.name}</li>)}</ol>
              </div>
            )}
            {sra.events && sra.events.length > 0 && (
              <div className="overflow-x-auto" tabIndex={0} role="group" aria-label="Risk events in the simulation"><table className="w-full text-body [&_th]:text-caption"><caption className="text-left font-semibold text-ink mb-1">Risk events in the simulation</caption>
                <thead><tr><th className={th}>Event</th><th className={th}>Activity</th><th className={th}>Probability</th><th className={th}>Impact (wd)</th><th className={th}>Finish when it occurs</th></tr></thead>
                <tbody>{sra.events.map(e => <tr key={e.id}><td className={td}>{e.name}</td><td className={td}>{e.code}</td><td className={td}>{Math.round(e.probability * 100)}%</td><td className={td}>{e.impactDays}</td><td className={td}>{e.finishDeltaDays > 0 ? `+${e.finishDeltaDays} calendar days` : 'no effect on the finish'}</td></tr>)}</tbody></table></div>
            )}
            {sraErr && <p role="alert" className="text-status-at-risk">{sraErr} The figures above are from the last run that worked.</p>}
            <div>
              <Disclosure title="How this was simulated">
                <p className="text-warm-700">{sra.method}</p>
                <ul className="mt-2 list-disc pl-5 text-warm-600 space-y-0.5">{sra.assumptions.slice(0, 4).map((x, i) => <li key={i}>{x}</li>)}</ul>
              </Disclosure>
              {sra.inputs && (
                <Disclosure title="Your ranges and risk events" meta={(() => {
                  const n = [[sra.inputs.ranges.length, 'range'], [sra.inputs.events.length, 'risk event'], [sra.inputs.commitments?.length ?? 0, 'committed date']] as const
                  const said = n.filter(([c]) => c > 0).map(([c, w]) => `${c} ${w}${c === 1 ? '' : 's'}`)
                  return said.length ? said.join(' · ') : 'none yet'
                })()}>
                  <RiskInputsPanel key={sra.inputs.updatedAt ?? 'none'} scheduleId={scheduleId} inputs={sra.inputs} canEdit={canEdit} onSaved={runRisk} />
                </Disclosure>
              )}
            </div>
          </div>
        )}
      </Disclosure>

      <Disclosure tone="card" title="Export and original file">
        <div className="flex flex-wrap gap-2 text-body">
          {[['xer', 'Primavera P6 (.xer)'], ['xml', 'MS Project (.xml)'], ['xlsx-p6', 'Excel, P6 layout'], ['xlsx-import', 'Excel for import'], ['lookahead-xlsx', 'Excel, 3-week look-ahead'], ...(restricted ? [] : [['csv', 'CSV'], ['ipmdar', 'IPMDAR schedule dataset (.zip)']]), ['original', 'Original file as uploaded']].map(([f, label]) => (
            <a key={f} href={exp(f)} className="px-3.5 py-1.5 rounded-lg border border-warm-300 text-ink hover:bg-warm-100">{label}</a>
          ))}
        </div>
        <p className="text-caption text-warm-600 mt-2">Exports keep the file&apos;s activity IDs, WBS, progress and required finish. {basis === 'scenario' ? `These exports are the what-if scenario with ${editsCount} RunF9 edit${editsCount === 1 ? '' : 's'}; their provenance says they are derived from the original file.` : 'These exports are the schedule as submitted (no RunF9 edits).'} The original file is stored with its SHA-256, recorded in the audit log.</p>
        {!restricted && <p className="text-caption text-warm-600 mt-1">The IPMDAR dataset follows the DoD Schedule Performance Dataset format, version 1.0, and carries the UNCLASSIFIED marking only when this schedule&apos;s classification is set to Unclassified; otherwise the marking is left for you to fill. Run it through the government&apos;s validator and add your contract details before you submit it.</p>}
        {restricted && <p className="text-caption text-warm-700 mt-1">This schedule is marked {classification === 'cui' ? 'CUI' : 'classified'}: every export carries the banner and designation markings, and CSV is not offered because it cannot carry them.</p>}
      </Disclosure>

      <Disclosure tone="card" title="How RunF9 schedules this file">
        <div className="text-body text-warm-700 space-y-3">
          <fieldset>
            <legend className="font-semibold text-ink mb-1">Out-of-sequence progress</legend>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <label className="inline-flex items-center gap-2 py-1"><input type="radio" name="pm" checked={progressMode === 'retained'} onChange={() => patch({ progressMode: 'retained' })} /> Retained logic (P6 default)</label>
              <label className="inline-flex items-center gap-2 py-1"><input type="radio" name="pm" checked={progressMode === 'override'} onChange={() => patch({ progressMode: 'override' })} /> Progress override</label>
            </div>
          </fieldset>
          <label className="flex items-start gap-2 py-1"><input type="checkbox" className="mt-0.5 flex-shrink-0" checked={inHistory} onChange={e => patch({ inHistory: e.target.checked })} /> <span>Use this schedule&apos;s actuals to calibrate our firm history (only for your own as-built projects)</span></label>
          {inHistory && (
            <label className="flex items-start gap-2 py-1 ml-6"><input type="checkbox" className="mt-0.5 flex-shrink-0" checked={historyOverride} onChange={e => patch({ inHistory: true, historyOverride: e.target.checked })} /> <span>Include it even if not every activity has an actual finish</span></label>
          )}
          <label className="block">Whose schedule{' '}
            <select className="ml-1 border border-warm-300 rounded-lg px-2 h-9 bg-white" value={origin ?? ''} onChange={e => patch({ origin: e.target.value || null })}>
              <option value="">Not stated</option>
              <option value="own">Our own project</option>
              <option value="third_party">Third-party (we review it)</option>
            </select>
          </label>
          <label className="block">Security classification{' '}
            <select className="ml-1 border border-warm-300 rounded-lg px-2 h-9 bg-white" value={classification ?? 'unclassified'} onChange={e => {
              const next = e.target.value
              const was = classification ?? 'unclassified'
              const msg = next === 'unclassified'
                ? `Remove the ${was === 'cui' ? 'CUI' : 'classified'} marking from this schedule? Exports will no longer carry the markings, and AI features and CSV export become available for it again.`
                : `Mark this schedule ${next === 'cui' ? 'CUI' : 'classified'}? Every export will carry the markings, and CSV export and cloud AI are turned off for it. Only keep ${next === 'cui' ? 'CUI' : 'classified material'} on a deployment your organization has approved for it.`
              if (window.confirm(msg)) patch({ classification: next })
            }}>
              <option value="unclassified">Unclassified</option>
              <option value="cui">CUI</option>
              <option value="classified">Classified</option>
            </select>
          </label>
          <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); if (label.trim() && label.trim() !== version) patch({ version: label.trim() }) }}>
            <label htmlFor="ver-label">Version label</label>
            <input id="ver-label" className="border border-warm-300 rounded px-2 py-1 bg-white" maxLength={40} value={label} onChange={e => setLabel(e.target.value)} />
            <button type="submit" className="px-3.5 py-1.5 rounded-lg border border-warm-300 text-ink hover:bg-warm-100">Rename</button>
          </form>
          {notes.length > 0 && <ul role="status" className="list-disc pl-5 text-warm-700">{notes.map(n => <li key={n}>{n}</li>)}</ul>}
        </div>
      </Disclosure>
    </section>
  )
}
