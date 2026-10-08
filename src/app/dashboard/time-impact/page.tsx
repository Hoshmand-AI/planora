'use client'

// Time Impact Analysis for the selected update: delay events, a fragnet editor (new activities and
// their ties to existing activity codes), the run, and the results — milestone impact, driving path
// before / after, concurrency indicators and assumptions — with downloadable reports. The results are
// a calculation; entitlement is a contractual determination Planora does not make (said on the page).

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, Timer } from 'lucide-react'
import { useApp } from '../layout'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { Alert, postJson } from '@/components/ui'
import type { DelayEvent, Fragnet, FragnetActivity, FragnetLink, Responsibility, TiaResult, TiaRun } from '@/lib/analysis/tia'

interface Pick { code: string; name: string; type: string; status: string; start: string | null; finish: string | null; totalFloat: number }
interface Overview {
  schedule: { id: string; name: string; version: string; dataDate: string | null; editsApplied: number }
  contractMilestone: { code: string; name: string } | null
  events: (DelayEvent & { runs: number; lastRunAt: string | null })[]
  activities: Pick[]; calendars: { id: string; name: string }[]; defaultCalendarId: string | null
  previous: { label: string; dataDate: string | null } | null
  acceptanceNote: string | null; disclaimer: string
}

const RESP: [Responsibility, string][] = [['unassigned', 'Unassigned'], ['owner', 'Owner'], ['contractor', 'Contractor'], ['third_party', 'Third party'], ['force_majeure', 'Force majeure']]
const STATUS: Record<string, string> = { draft: 'Draft', analyzed: 'Analysed', accepted: 'Accepted', rejected: 'Rejected' }
const td = 'px-2 py-1.5 border-b border-warm-200 align-top'
const th = 'px-2 py-1.5 border-b border-warm-300 text-left font-semibold text-warm-600'
const input = 'border border-warm-300 rounded px-2 py-1 bg-white text-[13px] text-warm-700'
const primary = 'px-3 py-1.5 rounded-full bg-navy-950 text-white text-[13px] font-medium disabled:opacity-60'
const secondary = 'px-3 py-1.5 rounded-full border border-warm-300 text-navy-950 text-[13px] hover:bg-warm-100 disabled:opacity-60'
const signed = (n: number | null | undefined) => (n == null ? '—' : n > 0 ? `+${n}` : String(n))

export default function TimeImpactPage() {
  const { selectedSchedule, can } = useApp()
  const [data, setData] = useState<Overview | null>(null)
  const [err, setErr] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const canWrite = can('schedule.write')
  const sid = selectedSchedule?.id

  const load = useCallback(async () => {
    if (!sid) return
    setErr('')
    const r = await fetch(`/api/schedules/${sid}/time-impact`)
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { setErr(d.error || 'Could not load the time impact analysis.'); return }
    setData(d)
  }, [sid])
  useEffect(() => { setData(null); setSelected(null); load() }, [load])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sid) return
    setBusy(true)
    const r = await postJson(`/api/schedules/${sid}/time-impact`, { title: newTitle, responsibility: 'unassigned' })
    setBusy(false)
    if (!r.ok) { setErr(r.data.error || 'The delay event was not created.'); return }
    setNewTitle('')
    await load()
    setSelected((r.data.event as DelayEvent).id)
  }

  if (!selectedSchedule) return <div className="px-6 py-16 text-center text-[14px] text-warm-600"><Timer size={22} aria-hidden className="mx-auto mb-2 text-warm-500" />Upload or select a schedule update to run a time impact analysis.</div>
  if (!data) return <div className="px-6 py-10 text-[14px] text-warm-600 flex items-center gap-2" role="status">{err || <><Loader2 size={14} className="animate-spin" aria-hidden /> Loading delay events…</>}</div>
  const event = data.events.find(e => e.id === selected) ?? null

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 space-y-5">
      <header>
        <p className="text-[12px] text-warm-600"><Link href="/dashboard" className="underline">Overview</Link> / Time impact</p>
        <h1 className="font-display text-[24px] text-navy-950">Time impact analysis</h1>
        <p className="text-[13px] text-warm-700">{data.schedule.name} ({data.schedule.version}) · data date {fmtDate(data.schedule.dataDate)}{data.contractMilestone ? ` · contract milestone ${data.contractMilestone.code} ${data.contractMilestone.name}` : ''}{data.previous ? ` · previous update ${data.previous.label}` : ''}</p>
      </header>
      <Alert tone="info"><strong>Calculation, not conclusion.</strong> {data.disclaimer}</Alert>
      {data.acceptanceNote && <Alert tone="warning">{data.acceptanceNote}</Alert>}
      {err && <Alert tone="error">{err}</Alert>}

      <div className="grid md:grid-cols-[260px_1fr] gap-5 items-start">
        <section aria-labelledby="events-h" className="bg-warm-50 border border-warm-200 rounded-lg p-4 space-y-3">
          <h2 id="events-h" className="text-[15px] font-semibold text-navy-950">Delay events</h2>
          {data.events.length === 0 ? <p className="text-[13px] text-warm-600">None yet.</p> : (
            <ul className="space-y-1">
              {data.events.map(e => (
                <li key={e.id}>
                  <button type="button" onClick={() => setSelected(e.id)} aria-current={e.id === selected ? 'true' : undefined}
                    className={`w-full text-left px-2.5 py-2 rounded-md text-[13px] ${e.id === selected ? 'bg-accent-100 text-navy-950' : 'hover:bg-warm-100 text-warm-700'}`}>
                    <span className="block font-medium text-navy-950">{e.title}</span>
                    <span className="block text-[12px] text-warm-600">{STATUS[e.status]} · {e.runs} run{e.runs === 1 ? '' : 's'}{e.eventStart ? ` · from ${fmtDate(e.eventStart)}` : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {canWrite && (
            <form onSubmit={create} className="space-y-2 pt-2 border-t border-warm-200">
              <label htmlFor="new-ev" className="block text-[12px] font-semibold text-warm-700">New delay event</label>
              <input id="new-ev" className={`${input} w-full`} value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="e.g. Differing site condition at grid C" maxLength={200} />
              <button type="submit" className={primary} disabled={busy || newTitle.trim().length < 3}>Add event</button>
            </form>
          )}
        </section>

        {event ? <EventPanel key={event.id} scheduleId={data.schedule.id} event={event} overview={data} canWrite={canWrite} canAi={can('ai.use')} onChanged={load} />
          : <p className="text-[13px] text-warm-600 py-6">Select a delay event{canWrite ? ' or add one' : ''} to model its fragnet and run the analysis.</p>}
      </div>
    </div>
  )
}

/* ─── One event: details, evidence, fragnet, runs ─────────── */

function EventPanel({ scheduleId, event, overview, canWrite, canAi, onChanged }: { scheduleId: string; event: DelayEvent; overview: Overview; canWrite: boolean; canAi: boolean; onChanged: () => Promise<void> }) {
  const [form, setForm] = useState({ title: event.title, description: event.description ?? '', responsibility: event.responsibility, eventStart: event.eventStart ?? '', eventEnd: event.eventEnd ?? '', notifiedOn: event.notifiedOn ?? '' })
  const [evidence, setEvidence] = useState(event.evidence.map(e => ({ label: e.label, url: e.url ?? '' })))
  const [acts, setActs] = useState<FragnetActivity[]>(event.fragnet.activities ?? [])
  const [rels, setRels] = useState<FragnetLink[]>(event.fragnet.relationships ?? [])
  const [openEnds, setOpenEnds] = useState(!!event.fragnet.allowOpenEnds)
  const [msg, setMsg] = useState<{ tone: 'error' | 'success' | 'warning'; text: string; list?: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [runs, setRuns] = useState<TiaRun[]>([])
  const [runId, setRunId] = useState<string | null>(null)
  const [basis, setBasis] = useState<'submitted' | 'scenario'>('submitted')
  const [note, setNote] = useState('')
  const base = `/api/schedules/${scheduleId}/time-impact/${event.id}`
  const listId = `tia-codes-${event.id}`
  const ro = !canWrite

  const loadRuns = useCallback(async () => {
    const r = await fetch(`${base}/runs`)
    const d = await r.json().catch(() => ({}))
    if (r.ok) { setRuns(d.runs || []); setRunId(id => id ?? d.runs?.[0]?.id ?? null) }
  }, [base])
  useEffect(() => { loadRuns() }, [loadRuns])

  const fragnet: Fragnet = { activities: acts.map(a => ({ ...a, duration: Number(a.duration) })), relationships: rels.map(r => ({ ...r, lag: Number(r.lag) })), ...(openEnds ? { allowOpenEnds: true } : {}) }
  const save = async (): Promise<boolean> => {
    setBusy(true); setMsg(null)
    const r = await postJson(base, { ...form, description: form.description || null, evidence: evidence.filter(e => e.label.trim() || e.url.trim()), fragnet }, 'PATCH')
    setBusy(false)
    if (!r.ok) { setMsg({ tone: 'error', text: r.data.error || 'The event was not saved.' }); return false }
    await onChanged()
    return true
  }
  const run = async () => {
    if (canWrite && !(await save())) return
    setBusy(true); setMsg(null)
    const r = await postJson(`${base}/runs`, { basis })
    setBusy(false)
    if (!r.ok) {
      const v = r.data.validation as TiaResult['validation'] | undefined
      setMsg({ tone: 'error', text: r.data.error || 'The analysis did not run.', list: v ? [...v.errors, ...v.warnings.map(w => `Warning: ${w}`)] : undefined })
      return
    }
    const created = r.data.run as TiaRun
    setRunId(created.id)
    await loadRuns(); await onChanged()
    setMsg({ tone: 'success', text: 'Analysis run and stored. Results are below.' })
  }
  const setStatus = async (status: 'accepted' | 'rejected') => {
    setBusy(true)
    const r = await postJson(base, { status, statusNote: note }, 'PATCH')
    setBusy(false)
    setMsg(r.ok ? { tone: 'success', text: `Marked ${status}. This records the analysis decision only, not an entitlement.` } : { tone: 'error', text: r.data.error || 'Not saved.' })
    if (r.ok) { setNote(''); await onChanged() }
  }
  const remove = async () => {
    if (!confirm('Delete this draft delay event?')) return
    const r = await fetch(base, { method: 'DELETE' })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) setMsg({ tone: 'error', text: d.error || 'Not deleted.' }); else await onChanged()
  }

  const fragCodes = acts.map(a => a.code).filter(Boolean)
  const current = runs.find(r => r.id === runId) ?? null

  return (
    <div className="space-y-5 min-w-0">
      <datalist id={listId}>
        {fragCodes.map(c => <option key={`f-${c}`} value={c}>Fragnet</option>)}
        {overview.activities.map(a => <option key={a.code} value={a.code}>{a.name}{a.status === 'complete' ? ' (complete)' : ''}</option>)}
      </datalist>

      <section aria-labelledby="ev-h" className="bg-warm-50 border border-warm-200 rounded-lg p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="ev-h" className="text-[15px] font-semibold text-navy-950">Delay event</h2>
          <span className="text-[12px] text-warm-700">{STATUS[event.status]}{event.statusNote ? ` — ${event.statusNote}` : ''}</span>
        </div>
        <fieldset disabled={ro} className="grid sm:grid-cols-2 gap-3 text-[12px] text-warm-700">
          <label className="sm:col-span-2">Title<input className={`${input} w-full mt-0.5`} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} maxLength={200} /></label>
          <label className="sm:col-span-2">Description<textarea className={`${input} w-full mt-0.5`} rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} maxLength={5000} /></label>
          <label>Responsibility (label only)
            <select className={`${input} w-full mt-0.5`} value={form.responsibility} onChange={e => setForm({ ...form, responsibility: e.target.value as Responsibility })}>
              {RESP.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <span className="block text-[11.5px] text-warm-600 mt-0.5">A label you enter. Planora does not assess responsibility.</span>
          </label>
          <label>Notice date<input type="date" className={`${input} w-full mt-0.5`} value={form.notifiedOn} onChange={e => setForm({ ...form, notifiedOn: e.target.value })} /></label>
          <label>Event start<input type="date" className={`${input} w-full mt-0.5`} value={form.eventStart} onChange={e => setForm({ ...form, eventStart: e.target.value })} /></label>
          <label>Event end<input type="date" className={`${input} w-full mt-0.5`} value={form.eventEnd} onChange={e => setForm({ ...form, eventEnd: e.target.value })} /></label>
        </fieldset>

        <fieldset disabled={ro} className="space-y-2">
          <legend className="text-[13px] font-semibold text-navy-950">Evidence</legend>
          {evidence.length === 0 && <p className="text-[12.5px] text-warm-600">No references yet (letters, RFIs, daily reports, photos…).</p>}
          {evidence.map((ev, i) => (
            <div key={i} className="flex flex-wrap gap-2 items-end">
              <label className="text-[12px] text-warm-700 flex-1 min-w-[180px]">Reference<input className={`${input} w-full mt-0.5`} value={ev.label} onChange={e => setEvidence(evidence.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="e.g. RFI 042, owner letter 03/02/2026" /></label>
              <label className="text-[12px] text-warm-700 flex-1 min-w-[180px]">Link (optional)<input type="url" className={`${input} w-full mt-0.5`} value={ev.url} onChange={e => setEvidence(evidence.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} placeholder="https://…" /></label>
              <button type="button" className={secondary} onClick={() => setEvidence(evidence.filter((_, j) => j !== i))} aria-label={`Remove evidence ${i + 1}`}>Remove</button>
            </div>
          ))}
          {canWrite && <button type="button" className={secondary} onClick={() => setEvidence([...evidence, { label: '', url: '' }])}>Add reference</button>}
        </fieldset>
      </section>

      <section aria-labelledby="frag-h" className="bg-warm-50 border border-warm-200 rounded-lg p-4 space-y-3">
        <h2 id="frag-h" className="text-[15px] font-semibold text-navy-950">Fragnet</h2>
        <p className="text-[12.5px] text-warm-700">New activities that model the delay, tied to existing activity codes. Fragnet work cannot start before the data date ({fmtDate(overview.schedule.dataDate)}); completed activities are not moved. Durations and lags are work days.</p>
        <fieldset disabled={ro} className="space-y-2">
          <legend className="text-[13px] font-semibold text-navy-950">Activities</legend>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr><th className={th}>ID</th><th className={th}>Name</th><th className={th}>Duration (wd)</th><th className={th}>Calendar</th><th className={th}>Earliest start</th><th className={th}><span className="sr-only">Remove</span></th></tr></thead>
              <tbody>
                {acts.map((a, i) => {
                  const upd = (p: Partial<FragnetActivity>) => setActs(acts.map((x, j) => (j === i ? { ...x, ...p } : x)))
                  return (
                    <tr key={i}>
                      <td className={td}><input aria-label={`Fragnet activity ${i + 1} ID`} className={`${input} w-24`} value={a.code} onChange={e => upd({ code: e.target.value })} maxLength={40} /></td>
                      <td className={td}><input aria-label={`Fragnet activity ${i + 1} name`} className={`${input} w-full min-w-[160px]`} value={a.name} onChange={e => upd({ name: e.target.value })} maxLength={200} /></td>
                      <td className={td}><input aria-label={`Fragnet activity ${i + 1} duration in work days`} type="number" min={0} className={`${input} w-20`} value={String(a.duration)} onChange={e => upd({ duration: e.target.value === '' ? 0 : Number(e.target.value) })} /></td>
                      <td className={td}>
                        <select aria-label={`Fragnet activity ${i + 1} calendar`} className={input} value={a.calendarId ?? ''} onChange={e => upd({ calendarId: e.target.value || null })}>
                          <option value="">Schedule default</option>
                          {overview.calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </td>
                      <td className={td}><input aria-label={`Fragnet activity ${i + 1} earliest start`} type="date" className={input} value={a.startNoEarlierThan ?? ''} onChange={e => upd({ startNoEarlierThan: e.target.value || null })} /></td>
                      <td className={td}><button type="button" className="text-[12px] underline text-navy-950" onClick={() => setActs(acts.filter((_, j) => j !== i))}>Remove</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {canWrite && <button type="button" className={secondary} onClick={() => setActs([...acts, { code: `TIA-${String(acts.length + 1).padStart(2, '0')}`, name: '', duration: 1, calendarId: null, startNoEarlierThan: acts.length === 0 ? (form.eventStart || null) : null }])}>Add activity</button>}
        </fieldset>

        <fieldset disabled={ro} className="space-y-2">
          <legend className="text-[13px] font-semibold text-navy-950">Relationships</legend>
          <p className="text-[12px] text-warm-600">Type an activity ID or pick from the list (fragnet and existing activities).</p>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr><th className={th}>Predecessor</th><th className={th}>Successor</th><th className={th}>Type</th><th className={th}>Lag (wd)</th><th className={th}><span className="sr-only">Remove</span></th></tr></thead>
              <tbody>
                {rels.map((l, i) => {
                  const upd = (p: Partial<FragnetLink>) => setRels(rels.map((x, j) => (j === i ? { ...x, ...p } : x)))
                  return (
                    <tr key={i}>
                      <td className={td}><input aria-label={`Relationship ${i + 1} predecessor`} list={listId} className={`${input} w-32`} value={l.from} onChange={e => upd({ from: e.target.value })} /></td>
                      <td className={td}><input aria-label={`Relationship ${i + 1} successor`} list={listId} className={`${input} w-32`} value={l.to} onChange={e => upd({ to: e.target.value })} /></td>
                      <td className={td}>
                        <select aria-label={`Relationship ${i + 1} type`} className={input} value={l.type} onChange={e => upd({ type: e.target.value as FragnetLink['type'] })}>
                          {['FS', 'SS', 'FF', 'SF'].map(t => <option key={t}>{t}</option>)}
                        </select>
                      </td>
                      <td className={td}><input aria-label={`Relationship ${i + 1} lag in work days`} type="number" className={`${input} w-20`} value={String(l.lag)} onChange={e => upd({ lag: e.target.value === '' ? 0 : Number(e.target.value) })} /></td>
                      <td className={td}><button type="button" className="text-[12px] underline text-navy-950" onClick={() => setRels(rels.filter((_, j) => j !== i))}>Remove</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {canWrite && <button type="button" className={secondary} onClick={() => setRels([...rels, { from: '', to: '', type: 'FS', lag: 0 }])}>Add relationship</button>}
          <label className="block text-[12.5px] text-warm-700"><input type="checkbox" checked={openEnds} onChange={e => setOpenEnds(e.target.checked)} /> Open ends are intentional (report them as warnings, not errors)</label>
        </fieldset>

        {msg && <Alert tone={msg.tone}>{msg.text}{msg.list && <ul className="list-disc pl-5 mt-1">{msg.list.map((x, i) => <li key={i}>{x}</li>)}</ul>}</Alert>}
        <div className="flex flex-wrap items-center gap-2">
          {canWrite && <button type="button" className={secondary} onClick={() => { save().then(ok => ok && setMsg({ tone: 'success', text: 'Saved.' })) }} disabled={busy}>Save</button>}
          {canWrite && overview.schedule.editsApplied > 0 && (
            <label className="text-[12.5px] text-warm-700">Network{' '}
              <select className={input} value={basis} onChange={e => setBasis(e.target.value as 'submitted' | 'scenario')}>
                <option value="submitted">As submitted</option>
                <option value="scenario">With Planora edits ({overview.schedule.editsApplied})</option>
              </select>
            </label>
          )}
          {canWrite && <button type="button" className={primary} onClick={run} disabled={busy || !acts.length}>{busy ? 'Working…' : 'Save and run analysis'}</button>}
          {canWrite && event.status === 'draft' && <button type="button" className="text-[12.5px] underline text-status-at-risk ml-auto" onClick={remove}>Delete draft</button>}
        </div>
      </section>

      {runs.length > 0 && (
        <section aria-labelledby="runs-h" className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="runs-h" className="font-display text-[18px] text-navy-950">Results</h2>
            <label className="text-[12.5px] text-warm-700">Run{' '}
              <select className={input} value={runId ?? ''} onChange={e => setRunId(e.target.value)}>
                {runs.map(r => <option key={r.id} value={r.id}>{fmtDateTime(r.createdAt)}{r.createdByName ? ` · ${r.createdByName}` : ''} · {r.inputsHash.slice(0, 8)}</option>)}
              </select>
            </label>
          </div>
          {current && <RunResult base={`${base}/runs/${current.id}`} run={current} canAi={canAi} />}
          {canWrite && current && (
            <div className="bg-warm-50 border border-warm-200 rounded-lg p-4 space-y-2">
              <label htmlFor="st-note" className="block text-[13px] font-semibold text-navy-950">Record the analysis decision</label>
              <p className="text-[12px] text-warm-600">Accepting records that this analysis was accepted. It is not a determination of entitlement.</p>
              <input id="st-note" className={`${input} w-full`} value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional), e.g. accepted at the 05/04/2026 progress meeting" maxLength={2000} />
              <div className="flex gap-2">
                <button type="button" className={primary} disabled={busy} onClick={() => setStatus('accepted')}>Accept analysis</button>
                <button type="button" className={secondary} disabled={busy} onClick={() => setStatus('rejected')}>Reject</button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

/* ─── Results of one run ───────────────────────────────── */

function RunResult({ base, run, canAi }: { base: string; run: TiaRun; canAi: boolean }) {
  const r = run.result
  const [ai, setAi] = useState<{ text: string; source: string; note: string | null; content: string } | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  useEffect(() => { setAi(null) }, [run.id])
  const cm = r.milestones.find(m => m.kind === 'contract')
  const others = useMemo(() => r.milestones.filter(m => m.kind !== 'contract'), [r.milestones])
  const askAi = async () => {
    setAiBusy(true)
    const res = await postJson(base, {})
    setAiBusy(false)
    if (res.ok) setAi({ text: String(res.data.narrative), source: String(res.data.source), note: (res.data.note as string) ?? null, content: String(res.data.content) })
    else setAi({ text: res.data.error || 'The narrative could not be produced.', source: 'error', note: null, content: '' })
  }
  const downloadMd = () => {
    const url = URL.createObjectURL(new Blob([ai!.content], { type: 'text/markdown' }))
    const a = document.createElement('a'); a.href = url; a.download = 'time-impact-analysis.md'; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="space-y-4 text-[13px] text-warm-700">
      {cm && (
        <div className="grid sm:grid-cols-3 gap-3">
          <Stat label={`${cm.code} (logic-driven)`} value={signed(cm.impactCd.logic) + ' cd'} sub={`${fmtDate(cm.before.logic)} → ${fmtDate(cm.after.logic)} · ${signed(cm.impactWd.logic)} wd`} />
          <Stat label={`${cm.code} as scheduled`} value={signed(cm.impactCd.scheduled) + ' cd'} sub={`${fmtDate(cm.before.scheduled)} → ${fmtDate(cm.after.scheduled)}`} />
          <Stat label={`Float at ${cm.code}`} value={`${cm.before.totalFloat ?? '—'} → ${cm.after.totalFloat ?? '—'} wd`} sub={`change ${signed(cm.floatChange)} wd`} />
        </div>
      )}
      <ul className="list-disc pl-5 space-y-1">{r.findings.map((f, i) => <li key={i}>{f}</li>)}</ul>

      <div className="flex flex-wrap gap-2">
        <a className={secondary} href={`${base}?format=pdf`}>Report (PDF)</a>
        <a className={secondary} href={`${base}?format=xlsx`}>Report (Excel)</a>
        <a className={secondary} href={`${base}?format=md`}>Report (Markdown)</a>
        {canAi && <button type="button" className={secondary} onClick={askAi} disabled={aiBusy}>{aiBusy ? 'Writing…' : 'AI narrative'}</button>}
      </div>
      {ai && (
        <div className="bg-warm-50 border border-warm-200 rounded-lg p-4 space-y-2" role="status">
          <p className="text-[12px] text-warm-700 font-semibold">{ai.source === 'ai' ? 'AI-written explanation of the computed results (the tables govern)' : ai.source === 'template' ? 'Template narrative (no AI model)' : 'Narrative'}</p>
          {ai.note && <p className="text-[12px] text-warm-700">{ai.note}</p>}
          {ai.text.split('\n\n').map((p, i) => <p key={i}>{p}</p>)}
          {ai.content && <button type="button" className={secondary} onClick={downloadMd}>Download report with this narrative (Markdown)</button>}
        </div>
      )}

      <Table caption="Milestone impact (+ = later)" head={['ID', 'Milestone', 'Contract date', 'Logic before', 'Logic after', 'Impact', 'As scheduled before → after', 'Float before → after (wd)']}
        rows={[...(cm ? [cm] : []), ...others].map(m => [`${m.code}${m.kind === 'contract' ? ' (contract)' : m.kind === 'interim' ? ' (interim)' : ''}`, m.name, m.contractDate ? fmtDate(m.contractDate) : '—', fmtDate(m.before.logic), fmtDate(m.after.logic), `${signed(m.impactCd.logic)} cd / ${signed(m.impactWd.logic)} wd`, `${fmtDate(m.before.scheduled)} → ${fmtDate(m.after.scheduled)}`, `${m.before.totalFloat ?? '—'} → ${m.after.totalFloat ?? '—'}`])} />
      <p>Project finish (logic-driven): {fmtDate(r.projectFinish.before.logic)} → {fmtDate(r.projectFinish.after.logic)} ({signed(r.projectFinish.impactCd.logic)} cd, {signed(r.projectFinish.impactWd.logic)} wd on {r.projectFinish.calendar}).</p>

      <div className="grid md:grid-cols-2 gap-4">
        <PathList title={`Driving path to ${r.drivingPath.target ?? 'project finish'} — before`} steps={r.drivingPath.before} />
        <PathList title={`Driving path to ${r.drivingPath.target ?? 'project finish'} — after`} steps={r.drivingPath.after} />
      </div>

      <Table caption="Fragnet after insertion" head={['ID', 'Activity', 'Duration (wd)', 'Calendar', 'Start', 'Finish', 'Float (wd)', 'On driving path']}
        rows={r.fragnet.map(f => [f.code, f.name, f.duration, f.calendar, fmtDate(f.start), fmtDate(f.finish), f.totalFloat ?? '—', f.onDrivingPath ? 'Yes' : 'No'])} />

      <div>
        <h3 className="text-[13px] font-semibold text-navy-950 mb-1">Concurrency indicators</h3>
        <p className="text-[12.5px] text-warm-700 mb-1">{r.concurrency.basis === 'previous_update' ? `Compared with ${r.concurrency.comparedWith}.` : r.concurrency.basis === 'baseline' ? 'No previous update: compared with baseline dates.' : 'No previous update or baseline to compare with.'} Each flag is a potential concurrent delay and requires analyst judgment.</p>
        {r.concurrency.flags.length === 0 ? <p className="text-[12.5px] text-warm-600">None flagged.</p> : (
          <ul className="space-y-1">{r.concurrency.flags.map(f => <li key={f.code} className="border-l-2 border-status-attention pl-2"><span className="font-semibold text-navy-950">{f.code} {f.name}</span> — {f.detail}{f.overlapsEvent ? ' Overlaps the event period.' : ''} <span className="text-warm-700">({f.label})</span></li>)}</ul>
        )}
      </div>

      {(r.validation.warnings.length > 0 || r.warnings.length > 0) && (
        <div><h3 className="text-[13px] font-semibold text-navy-950 mb-1">Warnings</h3><ul className="list-disc pl-5">{[...r.validation.warnings, ...r.warnings].map((w, i) => <li key={i}>{w}</li>)}</ul></div>
      )}
      <div><h3 className="text-[13px] font-semibold text-navy-950 mb-1">Assumptions</h3><ul className="list-disc pl-5 space-y-0.5">{r.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></div>
      <p className="text-[12px] text-warm-600 break-all">Engine {run.engine} · inputs {run.inputsHash} · result {run.resultHash}</p>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-warm-50 border border-warm-200 rounded-lg p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-600">{label}</div>
      <div className="text-[20px] font-bold text-navy-950 tabular-nums">{value}</div>
      <div className="text-[12px] text-warm-700">{sub}</div>
    </div>
  )
}

function Table({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <caption className="text-left font-semibold text-navy-950 mb-1">{caption}</caption>
        <thead><tr>{head.map(h => <th key={h} scope="col" className={th}>{h}</th>)}</tr></thead>
        <tbody>{rows.length ? rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={td}>{c}</td>)}</tr>) : <tr><td className={td} colSpan={head.length}>None.</td></tr>}</tbody>
      </table>
    </div>
  )
}

function PathList({ title, steps }: { title: string; steps: TiaResult['drivingPath']['before'] }) {
  return (
    <div>
      <h3 className="text-[13px] font-semibold text-navy-950 mb-1">{title}</h3>
      {steps.length === 0 ? <p className="text-[12.5px] text-warm-600">No open driving path.</p> : (
        <ol className="list-decimal pl-5 space-y-0.5 text-[12.5px]">
          {steps.map(s => <li key={s.id} className={s.fragnet ? 'font-semibold text-navy-950' : ''}>{s.code} {s.name} · {fmtDate(s.finish)} · float {s.totalFloat ?? '—'}{s.fragnet ? ' (fragnet)' : ''}</li>)}
        </ol>
      )}
    </div>
  )
}
