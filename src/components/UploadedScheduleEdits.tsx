'use client'

// Uploaded schedules, inside Planora: edits with reasons (an override layer on the imported file),
// what-if / recovery options modeled on the file's own network, and the scheduler's Monte Carlo inputs
// (three-point ranges and discrete risk events). Writing needs schedule.write; others see read-only.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { fmtDate } from '@/lib/format'
import { postJson } from './ui'

interface EditRow {
  id: string; label: string; before: string; after: string; reason: string; by: string; byName?: string | null; at: string
  status: 'applied' | 'skipped'; note?: string; source?: 'manual' | 'recovery'
}
interface ActivityChoice { id: string; code: string; name: string; type: string; status: string; remaining: number; constraint: string | null }
interface EditsData {
  edits: EditRow[]; reverted: { id: string; reason: string; at: string; revertedAt: string | null; revertReason: string | null }[]
  forecastFinish: string | null; minFloat: number | null; editable: boolean
  activities: ActivityChoice[]; relationships: { predecessorId: string; successorId: string; type: string; lag: number }[]
}
type Change = Record<string, unknown>
interface RecoveryOption {
  id: string; title: string; description: string; tradeoff: string; changes: Change[]; reason: string
  newFinish: string; daysSaved: number; minFloatBefore: number | null; minFloatAfter: number | null; meetsDate: boolean | null
}
interface RecoveryData {
  finish: string; required: string | null; requiredSource?: string | null; gapDays: number; minFloat: number | null; explanation: string[]; options: RecoveryOption[]; editable: boolean
  milestone?: { code: string; name: string; designated: boolean } | null; basisNote?: string | null
}

const td = 'px-2 py-1.5 border-b border-warm-200 align-top'
const th = 'px-2 py-1.5 border-b border-warm-300 text-left font-semibold text-warm-600'
const input = 'border border-warm-300 rounded px-2 py-1 bg-white text-[13px] text-warm-700'
const primary = 'px-3 py-1.5 rounded-full bg-navy-950 text-white text-[13px] font-medium disabled:opacity-60'
const secondary = 'px-3 py-1.5 rounded-full border border-warm-300 text-navy-950 text-[13px] hover:bg-warm-100 disabled:opacity-60'
const CONSTRAINTS = [['SNET', 'Start on or after'], ['SNLT', 'Start on or before'], ['FNET', 'Finish on or after'], ['FNLT', 'Finish on or before'], ['SO', 'Start on'], ['FO', 'Finish on'], ['MSO', 'Mandatory start'], ['MFO', 'Mandatory finish']]

/** Activities picker shared by the forms: type an activity ID or pick it from the list. */
function ActivityInput({ id, label, value, onChange, listId }: { id: string; label: string; value: string; onChange: (v: string) => void; listId: string }) {
  return (
    <label htmlFor={id} className="block text-[12px] text-warm-600">{label}
      <input id={id} list={listId} value={value} onChange={e => onChange(e.target.value)} placeholder="Activity ID" className={`${input} block mt-0.5 w-40`} />
    </label>
  )
}

export function EditsPanel({ scheduleId, canEdit, onChanged, refreshKey }: { scheduleId: string; canEdit: boolean; onChanged: () => void; refreshKey: number }) {
  const [data, setData] = useState<EditsData | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [kind, setKind] = useState<'duration' | 'link_set' | 'link_remove' | 'constraint'>('duration')
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [num, setNum] = useState('')
  const [type, setType] = useState('FS')
  const [cType, setCType] = useState('')
  const [cDate, setCDate] = useState('')
  const [reason, setReason] = useState('')
  const listId = `acts-${scheduleId}`

  const load = useCallback(async () => {
    const r = await fetch(`/api/schedules/${scheduleId}/edits`)
    const d = await r.json().catch(() => ({}))
    if (r.ok) setData(d); else setErr(d.error || 'Could not load edits.')
  }, [scheduleId])
  useEffect(() => { load() }, [load, refreshKey])

  const byCode = useMemo(() => new Map((data?.activities || []).map(x => [x.code.toLowerCase(), x])), [data])
  const picked = byCode.get(a.trim().toLowerCase())

  const submit = async () => {
    setErr('')
    const change: Change = kind === 'duration' ? { kind, activityId: a, remaining: Number(num) }
      : kind === 'link_set' ? { kind, predecessorId: a, successorId: b, type, lag: Number(num || 0) }
        : kind === 'link_remove' ? { kind, predecessorId: a, successorId: b }
          : { kind, activityId: a, constraint: cType ? { type: cType, date: cDate } : null }
    setBusy(true)
    const r = await postJson(`/api/schedules/${scheduleId}/edits`, { change, reason })
    setBusy(false)
    if (!r.ok) { setErr(r.data.error || 'The edit was not saved.'); return }
    setData(r.data as unknown as EditsData)
    setA(''); setB(''); setNum(''); setReason(''); setCType(''); setCDate('')
    onChanged()
  }
  const revert = async (e: EditRow) => {
    const why = window.prompt(`Reason for reverting "${e.label}" (${e.before} → ${e.after}):`)
    if (!why) return
    setBusy(true)
    const r = await fetch(`/api/schedules/${scheduleId}/edits?${new URLSearchParams({ editId: e.id, reason: why })}`, { method: 'DELETE' })
    const d = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) { setErr(d.error || 'Could not revert the edit.'); return }
    setData(d); onChanged()
  }

  if (!data) return <p className="text-[13px] text-warm-600">{err || 'Loading…'}</p>
  const applied = data.edits
  return (
    <div className="space-y-4 text-[13px] text-warm-700">
      <p className="text-warm-600">Edits change Planora&apos;s copy of this schedule only; the uploaded file is kept unchanged. Each edit is recalculated with the full network, recorded with its reason in the audit log, and included in exports and reports.</p>
      {applied.length === 0 ? <p>No edits yet.</p> : (
        <div className="overflow-x-auto"><table className="w-full text-[12.5px]"><caption className="text-left font-semibold text-navy-950 mb-1">{applied.length} edit{applied.length === 1 ? '' : 's'} made in Planora · forecast finish {fmtDate(data.forecastFinish)}</caption>
          <thead><tr><th className={th}>Change</th><th className={th}>Before</th><th className={th}>After</th><th className={th}>Reason</th><th className={th}>By</th>{canEdit && data.editable && <th className={th}><span className="sr-only">Revert</span></th>}</tr></thead>
          <tbody>{applied.map(e => (
            <tr key={e.id} className={e.status === 'skipped' ? 'text-warm-500' : ''}>
              <td className={td}>{e.label}{e.source === 'recovery' && <span className="ml-1 text-[11px] font-semibold uppercase text-accent-600">recovery</span>}{e.status === 'skipped' && <span className="block text-[11.5px] text-status-attention">Not applied: {e.note}</span>}</td>
              <td className={td}>{e.before}</td><td className={td}>{e.after}</td><td className={td}>{e.reason}</td>
              <td className={td}>{e.byName || 'Member'}<span className="block text-warm-500">{fmtDate(e.at)}</span></td>
              {canEdit && data.editable && <td className={td}><button type="button" disabled={busy} onClick={() => revert(e)} className="text-accent-600 hover:underline">Revert</button></td>}
            </tr>))}</tbody></table></div>
      )}
      {data.reverted.length > 0 && <p className="text-warm-600">{data.reverted.length} earlier edit{data.reverted.length === 1 ? ' was' : 's were'} reverted (kept in the audit log).</p>}

      {canEdit && data.editable ? (
        <form className="border border-warm-200 rounded-lg p-3 space-y-2 bg-warm-50" onSubmit={e => { e.preventDefault(); submit() }}>
          <datalist id={listId}>{data.activities.map(x => <option key={x.id} value={x.code}>{x.name}</option>)}</datalist>
          <fieldset className="flex flex-wrap gap-3">
            <legend className="font-semibold text-navy-950 mb-1">New edit</legend>
            {([['duration', 'Remaining duration'], ['link_set', 'Add / change relationship'], ['link_remove', 'Remove relationship'], ['constraint', 'Set / clear constraint']] as const).map(([k, l]) => (
              <label key={k}><input type="radio" name={`kind-${scheduleId}`} checked={kind === k} onChange={() => setKind(k)} /> {l}</label>
            ))}
          </fieldset>
          <div className="flex flex-wrap gap-3 items-end">
            <ActivityInput id={`ea-${scheduleId}`} label={kind === 'link_set' || kind === 'link_remove' ? 'Predecessor' : 'Activity'} value={a} onChange={setA} listId={listId} />
            {(kind === 'link_set' || kind === 'link_remove') && <ActivityInput id={`eb-${scheduleId}`} label="Successor" value={b} onChange={setB} listId={listId} />}
            {kind === 'duration' && <label className="block text-[12px] text-warm-600">Remaining (work days){picked ? ` — now ${picked.remaining}` : ''}<input type="number" min={0} value={num} onChange={e => setNum(e.target.value)} className={`${input} block mt-0.5 w-28`} /></label>}
            {kind === 'link_set' && <>
              <label className="block text-[12px] text-warm-600">Type<select value={type} onChange={e => setType(e.target.value)} className={`${input} block mt-0.5`}>{['FS', 'SS', 'FF', 'SF'].map(t => <option key={t}>{t}</option>)}</select></label>
              <label className="block text-[12px] text-warm-600">Lag (work days)<input type="number" value={num} onChange={e => setNum(e.target.value)} className={`${input} block mt-0.5 w-24`} /></label>
            </>}
            {kind === 'constraint' && <>
              <label className="block text-[12px] text-warm-600">Constraint{picked?.constraint ? ` — now ${picked.constraint}` : ''}<select value={cType} onChange={e => setCType(e.target.value)} className={`${input} block mt-0.5`}><option value="">None (clear)</option>{CONSTRAINTS.map(([k, l]) => <option key={k} value={k}>{l} ({k})</option>)}</select></label>
              {cType && <label className="block text-[12px] text-warm-600">Date<input type="date" value={cDate} onChange={e => setCDate(e.target.value)} className={`${input} block mt-0.5`} /></label>}
            </>}
          </div>
          {picked && <p className="text-[12px] text-warm-600">{picked.code} {picked.name} · {picked.status.replace('_', ' ')}</p>}
          <label className="block text-[12px] text-warm-600">Reason (required, kept with the edit)
            <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Steel erector confirmed a second crew from 11/02" className={`${input} block mt-0.5 w-full`} />
          </label>
          <button type="submit" disabled={busy || reason.trim().length < 5 || !a.trim()} className={primary}>{busy ? 'Recalculating…' : 'Save edit and recalculate'}</button>
        </form>
      ) : !data.editable ? <p className="text-warm-600">This schedule was published from a Planora plan; edit the plan instead.</p>
        : <p className="text-warm-600">Your role can view edits but not make them.</p>}
      {err && <p role="alert" className="text-status-at-risk">{err}</p>}
    </div>
  )
}

export function RecoveryPanel({ scheduleId, canEdit, onApplied, refreshKey, basis = 'submitted' }: { scheduleId: string; canEdit: boolean; onApplied: () => void; refreshKey: number; basis?: 'submitted' | 'scenario' }) {
  const [data, setData] = useState<RecoveryData | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')
  const [reasons, setReasons] = useState<Record<string, string>>({})

  useEffect(() => {
    let live = true
    setData(null); setMsg('')
    fetch(`/api/schedules/${scheduleId}/recovery${basis === 'scenario' ? '?basis=scenario' : ''}`).then(async r => {
      const d = await r.json().catch(() => ({}))
      if (!live) return
      if (r.ok) setData(d); else setMsg(d.error || 'No options for this schedule.')
    }).catch(() => live && setMsg('Could not load the options.'))
    return () => { live = false }
  }, [scheduleId, refreshKey, basis])

  const apply = async (o: RecoveryOption) => {
    setBusy(o.id); setMsg('')
    const r = await postJson(`/api/schedules/${scheduleId}/edits`, { changes: o.changes, reason: reasons[o.id] ?? o.reason, source: 'recovery', optionId: o.id })
    setBusy('')
    if (!r.ok) { setMsg(r.data.error || 'The option was not applied.'); return }
    setMsg(`Applied to the "With Planora edits" scenario: ${o.title}. Scenario forecast finish ${fmtDate(String(r.data.forecastFinish ?? ''))}; the schedule as submitted is unchanged.`)
    onApplied()
  }

  if (!data) return <p className="text-[13px] text-warm-600">{msg || 'Modeling options on this network…'}</p>
  return (
    <div className="space-y-3 text-[13px] text-warm-700">
      {data.basisNote && <p className="border-l-2 border-status-info pl-2">{data.basisNote}</p>}
      <p className="text-warm-600">Target: {data.milestone ? `${data.milestone.code} ${data.milestone.name}` : 'project finish'}{data.required ? `, required ${fmtDate(data.required)}${data.requiredSource ? ` (${data.requiredSource})` : ''}` : ', no required date'}.</p>
      <ul className="list-disc pl-5 space-y-1">{data.explanation.map((x, i) => <li key={i}>{x}</li>)}</ul>
      {data.options.length > 0 && (
        <ul className="space-y-3">{data.options.map(o => (
          <li key={o.id} className="border border-warm-200 rounded-lg p-3 bg-warm-50">
            <p className="font-semibold text-navy-950">{o.title}</p>
            <p className="mt-0.5">{data.milestone ? data.milestone.code : 'Finish'} {fmtDate(o.newFinish)} ({o.daysSaved > 0 ? `${o.daysSaved} calendar days earlier` : o.daysSaved < 0 ? `${-o.daysSaved} days later` : 'no change'}){o.minFloatBefore != null && o.minFloatAfter != null ? ` · lowest float ${o.minFloatBefore} → ${o.minFloatAfter} work days` : ''}{o.meetsDate != null ? (o.meetsDate ? ' · meets the required date' : ' · still after the required date') : ''}.</p>
            <p className="text-warm-600 mt-1">{o.description} <span className="text-warm-700">Trade-off:</span> {o.tradeoff}</p>
            {canEdit && data.editable && (
              <div className="flex flex-wrap gap-2 items-end mt-2">
                <label className="flex-1 min-w-[240px] text-[12px] text-warm-600">Reason for applying
                  <input value={reasons[o.id] ?? o.reason} onChange={e => setReasons(r => ({ ...r, [o.id]: e.target.value }))} className={`${input} block mt-0.5 w-full`} />
                </label>
                <button type="button" disabled={!!busy || (reasons[o.id] ?? o.reason).trim().length < 5} onClick={() => apply(o)} className={secondary}>{busy === o.id ? 'Applying…' : 'Apply as edit'}</button>
              </div>
            )}
          </li>))}</ul>
      )}
      {msg && <p role="status" className="text-warm-700 border-l-2 border-status-info pl-2">{msg}</p>}
    </div>
  )
}

interface RangeRow { activityId: string; code?: string; name?: string; optimistic: number | string; mostLikely: number | string; pessimistic: number | string }
interface EventRow { id?: string; activityId: string; code?: string; name: string; probability: number | string; impactDays: number | string }
interface CommitmentRow { activityId: string; code?: string; name?: string; date: string; note?: string }
export interface RiskInputsView { ranges: RangeRow[]; events: (EventRow & { name: string })[]; commitments?: CommitmentRow[]; updatedAt: string | null; defaults: { procurement: number; cure: number } }

/** The scheduler's ranges and risk events; saving re-runs the analysis. Probability is entered in %. */
export function RiskInputsPanel({ scheduleId, inputs, canEdit, onSaved }: { scheduleId: string; inputs: RiskInputsView; canEdit: boolean; onSaved: () => void }) {
  const [ranges, setRanges] = useState<RangeRow[]>(inputs.ranges.map(r => ({ ...r, activityId: r.code || r.activityId })))
  const [events, setEvents] = useState<EventRow[]>(inputs.events.map(e => ({ ...e, activityId: e.code || e.activityId, probability: Math.round(Number(e.probability) * 100) })))
  const [commitments, setCommitments] = useState<CommitmentRow[]>((inputs.commitments ?? []).map(c => ({ ...c, activityId: c.code || c.activityId })))
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true); setErr('')
    const r = await postJson(`/api/schedules/${scheduleId}/risk`, {
      ranges: ranges.map(x => ({ activityId: x.activityId, optimistic: Number(x.optimistic), mostLikely: Number(x.mostLikely), pessimistic: Number(x.pessimistic) })),
      events: events.map(x => ({ id: x.id, name: x.name, activityId: x.activityId, probability: Number(x.probability) / 100, impactDays: Number(x.impactDays) })),
      commitments: commitments.map(x => ({ activityId: x.activityId, date: x.date, note: x.note })),
    }, 'PUT')
    setBusy(false)
    if (!r.ok) { setErr(r.data.error || 'Not saved.'); return }
    onSaved()
  }
  const cell = `${input} w-16`
  return (
    <div className="space-y-3 text-[13px] text-warm-700 border-t border-warm-200 pt-3">
      <p className="font-semibold text-navy-950">Your ranges and risk events</p>
      <p className="text-warm-600">Ranges are work days of remaining work (optimistic / most likely / pessimistic) and replace the rule-based range for that activity. By name, {inputs.defaults.procurement} fabrication / delivery / procurement activities use a supplier range and {inputs.defaults.cure} cure activities are held at fixed duration unless you give them a range.</p>
      <div className="overflow-x-auto"><table className="text-[12.5px]"><caption className="text-left font-semibold text-navy-950 mb-1">Three-point ranges</caption>
        <thead><tr><th className={th}>Activity ID</th><th className={th}>Optimistic</th><th className={th}>Most likely</th><th className={th}>Pessimistic</th>{canEdit && <th className={th}><span className="sr-only">Remove</span></th>}</tr></thead>
        <tbody>{ranges.map((r, i) => (
          <tr key={i}>
            <td className={td}><input aria-label="Activity ID" disabled={!canEdit} value={r.activityId} onChange={e => setRanges(rs => rs.map((x, j) => j === i ? { ...x, activityId: e.target.value } : x))} className={`${input} w-28`} />{r.name && <span className="block text-warm-500 text-[11.5px]">{r.name}</span>}</td>
            {(['optimistic', 'mostLikely', 'pessimistic'] as const).map(k => <td key={k} className={td}><input aria-label={k} type="number" min={0} disabled={!canEdit} value={r[k]} onChange={e => setRanges(rs => rs.map((x, j) => j === i ? { ...x, [k]: e.target.value } : x))} className={cell} /></td>)}
            {canEdit && <td className={td}><button type="button" onClick={() => setRanges(rs => rs.filter((_, j) => j !== i))} className="text-accent-600 hover:underline">Remove</button></td>}
          </tr>))}</tbody></table></div>
      {canEdit && <button type="button" onClick={() => setRanges(rs => [...rs, { activityId: '', optimistic: '', mostLikely: '', pessimistic: '' }])} className={secondary}>Add range</button>}
      <div className="overflow-x-auto"><table className="text-[12.5px]"><caption className="text-left font-semibold text-navy-950 mb-1">Risk events</caption>
        <thead><tr><th className={th}>Event</th><th className={th}>Probability %</th><th className={th}>Impact (work days)</th><th className={th}>Affects activity or milestone</th>{canEdit && <th className={th}><span className="sr-only">Remove</span></th>}</tr></thead>
        <tbody>{events.map((r, i) => (
          <tr key={i}>
            <td className={td}><input aria-label="Event name" disabled={!canEdit} value={r.name} onChange={e => setEvents(rs => rs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} className={`${input} w-48`} /></td>
            <td className={td}><input aria-label="Probability percent" type="number" min={1} max={100} disabled={!canEdit} value={r.probability} onChange={e => setEvents(rs => rs.map((x, j) => j === i ? { ...x, probability: e.target.value } : x))} className={cell} /></td>
            <td className={td}><input aria-label="Impact work days" type="number" min={1} disabled={!canEdit} value={r.impactDays} onChange={e => setEvents(rs => rs.map((x, j) => j === i ? { ...x, impactDays: e.target.value } : x))} className={cell} /></td>
            <td className={td}><input aria-label="Affected activity or milestone ID" disabled={!canEdit} value={r.activityId} onChange={e => setEvents(rs => rs.map((x, j) => j === i ? { ...x, activityId: e.target.value } : x))} className={`${input} w-28`} /></td>
            {canEdit && <td className={td}><button type="button" onClick={() => setEvents(rs => rs.filter((_, j) => j !== i))} className="text-accent-600 hover:underline">Remove</button></td>}
          </tr>))}</tbody></table></div>
      {canEdit && <button type="button" onClick={() => setEvents(rs => [...rs, { activityId: '', name: '', probability: '', impactDays: '' }])} className={secondary}>Add risk event</button>}
      <div className="overflow-x-auto"><table className="text-[12.5px]"><caption className="text-left font-semibold text-navy-950 mb-1">Committed delivery dates</caption>
        <thead><tr><th className={th}>Activity ID</th><th className={th}>Committed date</th><th className={th}>Note (e.g. supplier letter)</th>{canEdit && <th className={th}><span className="sr-only">Remove</span></th>}</tr></thead>
        <tbody>{commitments.map((r, i) => (
          <tr key={i}>
            <td className={td}><input aria-label="Committed activity ID" disabled={!canEdit} value={r.activityId} onChange={e => setCommitments(rs => rs.map((x, j) => j === i ? { ...x, activityId: e.target.value } : x))} className={`${input} w-28`} />{r.name && <span className="block text-warm-500 text-[11.5px]">{r.name}</span>}</td>
            <td className={td}><input aria-label="Committed delivery date" type="date" disabled={!canEdit} value={r.date} onChange={e => setCommitments(rs => rs.map((x, j) => j === i ? { ...x, date: e.target.value } : x))} className={input} /></td>
            <td className={td}><input aria-label="Commitment note" disabled={!canEdit} value={r.note ?? ''} onChange={e => setCommitments(rs => rs.map((x, j) => j === i ? { ...x, note: e.target.value } : x))} className={`${input} w-48`} /></td>
            {canEdit && <td className={td}><button type="button" onClick={() => setCommitments(rs => rs.filter((_, j) => j !== i))} className="text-accent-600 hover:underline">Remove</button></td>}
          </tr>))}</tbody></table></div>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setCommitments(rs => [...rs, { activityId: '', date: '' }])} className={secondary}>Add committed date</button>
          <button type="button" disabled={busy} onClick={save} className={primary}>{busy ? 'Saving…' : 'Save and re-run'}</button>
        </div>
      )}
      {inputs.updatedAt && <p className="text-[12px] text-warm-600">Last changed {fmtDate(inputs.updatedAt)}.</p>}
      {err && <p role="alert" className="text-status-at-risk">{err}</p>}
    </div>
  )
}
