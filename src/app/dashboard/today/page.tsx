'use client'

// Today: the Daily Brief for one project. What a person who knows the whole schedule would tell the
// team this morning: the deadline position, what happened yesterday, what happens today, what is
// overdue, what drives the finish, risks, issues, change items, recent changes, what-if runs, signals
// from emails and meetings, missing scope and logic findings; with a version for the PM, the field
// and the client. Everything is calculated from the schedule and the project's own records.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, FileText, HardHat, CalendarCheck, CalendarClock, CheckCircle2, ClipboardCopy, Flag, GitBranch, Loader2, Mail, PlayCircle, Route, ShieldAlert, Sparkles } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { Disclosure } from '@/components/Disclosure'
import { DataCenterSampleButton } from '@/components/DataCenterSample'
import { Alert, postJson } from '@/components/ui'
import { fmtDate, fmtDates } from '@/lib/format'
import type { BriefRow, DailyBrief, RegisterItem, RegisterKind } from '@/lib/analysis/daily-brief'
import type { BriefAlert, ProjectWatch } from '@/lib/analysis/project-watch'
import { useApp } from '../layout'

type Audience = 'pm' | 'field' | 'client'
interface BriefData { brief: DailyBrief; watch: ProjectWatch; alerts: BriefAlert[]; email?: { available: boolean; everyMorning: Audience | null }; schedule: { id: string; name: string; version: string; editsApplied: number; sourceType: string }; activities: { id: string; code: string; name: string }[] }
const AUDIENCES: { id: Audience; label: string; hint: string }[] = [
  { id: 'pm', label: 'Project manager', hint: 'Decisions, drivers and exposure' },
  { id: 'field', label: 'Field', hint: 'What to start, finish and protect today' },
  { id: 'client', label: 'Client', hint: 'Status against the required date' },
]
const KIND_LABEL: Record<RegisterKind, string> = { risk: 'Risk', issue: 'Issue', pco: 'PCO', change_request: 'Change request', change_order: 'Change order', amendment: 'Amendment' }
const input = 'border border-warm-300 rounded-md px-2.5 py-1.5 bg-white text-[13px] text-warm-700'
const btn = 'px-3 py-1.5 rounded-full border border-warm-300 text-navy-950 text-[13px] hover:bg-warm-100 disabled:opacity-60'
const btnPrimary = 'px-3 py-1.5 rounded-full bg-navy-950 text-white text-[13px] font-medium disabled:opacity-60'
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export default function TodayPage() {
  const { selectedSchedule, can, openUpload, refreshMetrics, refreshSchedules } = useApp()
  const sid = selectedSchedule?.id
  const [data, setData] = useState<BriefData | null>(null)
  const [items, setItems] = useState<RegisterItem[]>([])
  const [impact, setImpact] = useState<{ moved: { id: string; code: string; name: string; startDays: number; finishDays: number }[]; movedCount: number } | null>(null)
  const [err, setErr] = useState('')
  const [asOf, setAsOf] = useState(todayIso)
  const [audience, setAudience] = useState<Audience>('pm')
  const [whatIf, setWhatIf] = useState<{ activity: string; days: string }>({ activity: '', days: '5' })
  const [ranWhatIf, setRanWhatIf] = useState<{ activity: string; days: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [mailed, setMailed] = useState('')
  const [busy, setBusy] = useState('')
  const canWrite = can('schedule.write')

  // Only the newest request may land: a slow answer for one project must never show under another.
  const seq = useRef(0)
  const load = useCallback(async () => {
    if (!sid) return
    const mine = ++seq.current
    setErr('')
    const q = new URLSearchParams({ asOf })
    if (ranWhatIf?.activity) { q.set('whatIfActivity', ranWhatIf.activity); q.set('whatIfDays', ranWhatIf.days) }
    try {
      const [b, r] = await Promise.all([fetch(`/api/schedules/${encodeURIComponent(sid)}/brief?${q}`), fetch(`/api/schedules/${encodeURIComponent(sid)}/register`)])
      const bd = await b.json().catch(() => ({}))
      if (mine !== seq.current) return
      if (!b.ok) { setErr(bd.error || 'The brief could not be loaded.'); return }
      setData(bd)
      const rd = await r.json().catch(() => ({}))
      if (mine !== seq.current) return
      setItems(r.ok ? rd.items : [])
      // What the recent changes moved (also marked on the Schedule tab).
      fetch(`/api/schedules/${encodeURIComponent(sid)}/changes`).then(x => (x.ok ? x.json() : null)).then(d => { if (mine === seq.current) setImpact(d) }).catch(() => {})
    } catch { if (mine === seq.current) setErr('Network error. Check your connection and try again.') }
  }, [sid, asOf, ranWhatIf])
  // A new project starts clean; a new date or what-if keeps the page on screen while it recalculates.
  useEffect(() => { setData(null); setItems([]); setImpact(null); setRanWhatIf(null); setWhatIf({ activity: '', days: '5' }); setMailed(''); setErr('') }, [sid])
  useEffect(() => { load() }, [load])

  const progress = async (row: BriefRow, kind: 'start' | 'finish') => {
    if (!sid) return
    setBusy(row.id + kind); setErr('')
    const day = asOf > todayIso() ? todayIso() : asOf
    const r = await postJson(`/api/schedules/${encodeURIComponent(sid)}/edits`, { change: { kind: 'progress', activityId: row.id, actualStart: day, actualFinish: kind === 'finish' ? day : null }, reason: `Progress reported on the Daily Brief (${kind === 'finish' ? 'finished' : 'started'} ${fmtDate(day)})` })
    setBusy('')
    if (!r.ok) { setErr(r.data.error || 'Progress was not recorded.'); return }
    // The other tabs read the project's numbers and its list of edits from the shared state: bring them up to date too.
    await Promise.all([load(), refreshMetrics().catch(() => {}), refreshSchedules().catch(() => {})])
  }

  const text = useMemo(() => {
    if (!data) return ''
    const b = data.brief
    const title = AUDIENCES.find(a => a.id === audience)!.label
    return [`${data.schedule.name}: daily brief for ${fmtDate(b.asOf)} (${title})`, '', ...b.audiences[audience].map(l => `• ${fmtDates(l)}`)].join('\n')
  }, [data, audience])

  if (!selectedSchedule) return (
    <>
      <EmptyState title="Select a project to see today’s brief" action={{ label: can('schedule.write') ? 'Upload a schedule' : 'Build a schedule', onClick: openUpload }}>
        Every morning RunF9 tells you what finished, what starts, what is late, what drives the finish and what to do about it.
      </EmptyState>
      <DataCenterSampleButton className="-mt-10 pb-12 text-center" />
    </>
  )
  if (!data) return (
    <div className="px-6 py-10 text-[14px] text-warm-600" role="status">
      {err ? <><p className="mb-3 text-status-at-risk">{err}</p><button type="button" className={btn} onClick={load}>Try again</button></> : <span className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden /> Preparing today’s brief…</span>}
    </div>
  )

  const b = data.brief
  const tone = b.headline.status === 'behind' ? 'text-status-at-risk' : b.headline.status === 'unknown' ? 'text-warm-700' : 'text-status-on-track'
  const openItems = items.filter(i => i.status === 'open')

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-warm-600">Daily brief</p>
          <h1 className="page-title">Today, {fmtDate(b.asOf)}</h1>
          <p className="text-[13px] text-warm-700">{data.schedule.name} ({data.schedule.version}){b.dataDate ? ` · progress as of ${fmtDate(b.dataDate)}` : ''}{data.schedule.editsApplied ? ` · with ${data.schedule.editsApplied} RunF9 edit${data.schedule.editsApplied === 1 ? '' : 's'}` : ''}</p>
        </div>
        <label className="text-[12px] text-warm-600">Brief for
          <input type="date" value={asOf} onChange={e => e.target.value && setAsOf(e.target.value)} className={`${input} block mt-0.5`} />
        </label>
      </header>
      {err && <Alert tone="error">{err}</Alert>}

      {/* The answer first: are we meeting the deadline, and by how much. */}
      <section aria-labelledby="deadline-h" className="rounded-[14px] border border-warm-200 bg-white p-5">
        <h2 id="deadline-h" className="text-[12px] font-semibold uppercase tracking-[0.08em] text-warm-600">Are we meeting the deadline?</h2>
        <p className={`mt-1 text-[20px] md:text-[24px] font-bold tracking-[-0.02em] ${tone}`}>
          {b.headline.status === 'behind' ? `No. ${b.headline.daysBehind} day${b.headline.daysBehind === 1 ? '' : 's'} behind.` : b.headline.status === 'ahead' ? `Yes. ${-b.headline.daysBehind!} day${b.headline.daysBehind === -1 ? '' : 's'} ahead.` : b.headline.status === 'on_track' ? 'Yes. On time.' : 'No required date is set.'}
        </p>
        <p className="mt-1 text-[14px] text-warm-700">{fmtDates(b.headline.text)}{b.headline.requiredSource ? ` Required date from: ${b.headline.requiredSource}.` : ''}</p>
        <dl className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          {([['Forecast', fmtDate(b.headline.forecast)], ['Required', b.headline.required ? fmtDate(b.headline.required) : 'Not set'], ['Overdue', `${b.overdue.finishCount + b.overdue.startCount}`], ['Open change items', `${b.changeItems.length}${b.changeImpactDays ? ` · ${b.changeImpactDays}d` : ''}`]] as const).map(([k, v]) => (
            <div key={k} className="rounded-xl bg-warm-100 px-3 py-2"><dt className="text-[11.5px] text-warm-600">{k}</dt><dd className="text-[16px] font-semibold text-navy-950 tabular-nums">{v}</dd></div>
          ))}
        </dl>
      </section>

      {data.alerts.length > 0 && (
        <section aria-labelledby="alerts-h" className="rounded-[14px] border border-warm-200 bg-white p-5">
          <h2 id="alerts-h" className="text-[16px] font-semibold text-navy-950">Needs attention today ({data.alerts.filter(a => a.level === 'act').length} to act on, {data.alerts.filter(a => a.level === 'watch').length} to watch)</h2>
          <ul className="mt-2 space-y-1.5">
            {data.alerts.map((a, i) => (
              <li key={i} className="flex gap-2 text-[13.5px] text-warm-700">
                <span className={`mt-0.5 h-fit flex-shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ${a.level === 'act' ? 'bg-status-at-risk-bg text-status-at-risk' : 'bg-status-attention-bg text-status-attention'}`}>{a.level === 'act' ? 'Act' : 'Watch'}</span>
                <span>{fmtDates(a.text)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* One brief, three readers. */}
      <section aria-labelledby="aud-h" className="rounded-[14px] border border-warm-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="aud-h" className="text-[16px] font-semibold text-navy-950">What you should know today</h2>
          <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2500) } catch { setErr('Copy is not available in this browser; select the text instead.') } }}>
            <ClipboardCopy size={13} className="inline mr-1 -mt-0.5" aria-hidden />{copied ? 'Copied' : 'Copy to send'}
          </button>
          <button type="button" className={btn} disabled={busy === 'mail'} onClick={async () => {
            setBusy('mail'); setMailed('')
            const r = await postJson(`/api/schedules/${encodeURIComponent(sid!)}/brief`, { audience, asOf })
            setBusy(''); setMailed(r.ok ? 'Sent to your email.' : r.data.error || 'The email could not be sent.')
          }}><Mail size={13} className="inline mr-1 -mt-0.5" aria-hidden />{busy === 'mail' ? 'Sending…' : 'Email it to me'}</button>
          </div>
        </div>
        {mailed && <p role="status" className="mt-2 text-[13px] text-warm-700">{mailed}</p>}
        {data.email?.available && (
          <label className="mt-2 flex items-start gap-2 text-[13px] text-warm-700">
            <input type="checkbox" className="mt-0.5" checked={!!data.email.everyMorning} disabled={busy === 'sub'} onChange={async e => {
              setBusy('sub'); setMailed('')
              const r = await postJson(`/api/schedules/${encodeURIComponent(sid!)}/brief`, { audience }, e.target.checked ? 'PUT' : 'DELETE')
              setBusy('')
              if (!r.ok) setMailed(r.data.error || 'The setting was not saved.'); else await load()
            }} />
            <span>Email me this brief every working morning{data.email.everyMorning ? ` (${AUDIENCES.find(a => a.id === data.email!.everyMorning)!.label} version)` : ` (${AUDIENCES.find(a => a.id === audience)!.label} version)`}</span>
          </label>
        )}
        <div role="tablist" aria-label="Who the brief is for" className="mt-3 flex flex-wrap gap-1.5">
          {AUDIENCES.map(a => (
            <button key={a.id} role="tab" type="button" id={`aud-${a.id}`} aria-selected={audience === a.id} aria-controls="aud-panel" onClick={() => setAudience(a.id)}
              className={`px-3 py-1.5 rounded-full text-[13px] font-medium border ${audience === a.id ? 'bg-navy-950 text-white border-navy-950' : 'bg-white text-navy-950 border-warm-300 hover:bg-warm-100'}`}>{a.label}</button>
          ))}
        </div>
        <div id="aud-panel" role="tabpanel" aria-labelledby={`aud-${audience}`} className="mt-3">
          <p className="text-[12.5px] text-warm-600 mb-2">{AUDIENCES.find(a => a.id === audience)!.hint}</p>
          <ul className="space-y-2">
            {b.audiences[audience].map((l, i) => <li key={i} className="flex gap-2 text-[14px] text-warm-700"><span aria-hidden className="mt-2 w-1.5 h-1.5 rounded-full bg-accent-600 flex-shrink-0" /><span>{fmtDates(l)}</span></li>)}
          </ul>
        </div>
      </section>

      <div className="grid md:grid-cols-2 gap-5">
        <Card icon={<CheckCircle2 size={15} />} title={`Since ${fmtDate(b.yesterday.date)}`} sub="Completed and started, from actual dates">
          <List title="Completed" rows={b.yesterday.completed} empty="No actual finishes recorded." plain />
          <List title="Started" rows={b.yesterday.started} empty="No actual starts recorded." plain />
        </Card>
        <Card icon={<CalendarCheck size={15} />} title="Today" sub="What the schedule says happens today">
          <List title="Starts today" rows={b.today.starting} empty="Nothing is scheduled to start." action={canWrite ? r => <RowBtn busy={busy === r.id + 'start'} onClick={() => progress(r, 'start')} label="Mark started" /> : undefined} />
          <List title="Finishes today" rows={b.today.finishing} empty="Nothing is scheduled to finish." action={canWrite ? r => <RowBtn busy={busy === r.id + 'finish'} onClick={() => progress(r, 'finish')} label="Mark finished" /> : undefined} />
          <List title={`Under way (${b.today.inProgressCount})`} rows={b.today.inProgress.slice(0, 6)} empty="Nothing is in progress." dateLabel="finish" action={canWrite ? r => <RowBtn busy={busy === r.id + 'finish'} onClick={() => progress(r, 'finish')} label="Mark finished" /> : undefined} />
        </Card>
        <Card icon={<AlertTriangle size={15} />} title="Should have happened by now" sub={`${b.overdue.finishCount} finish${b.overdue.finishCount === 1 ? '' : 'es'} and ${b.overdue.startCount} start${b.overdue.startCount === 1 ? '' : 's'} without actual dates`}>
          <List title="Should have finished" rows={b.overdue.shouldHaveFinished} empty="Nothing is past its finish." late action={canWrite ? r => <RowBtn busy={busy === r.id + 'finish'} onClick={() => progress(r, 'finish')} label="Mark finished" /> : undefined} />
          <List title="Should have started" rows={b.overdue.shouldHaveStarted} empty="Nothing is past its start." late action={canWrite ? r => <RowBtn busy={busy === r.id + 'start'} onClick={() => progress(r, 'start')} label="Mark started" /> : undefined} />
          {canWrite && (b.overdue.finishCount + b.overdue.startCount > 0) && <p className="text-[12px] text-warm-600">“Mark started / finished” records the date above as the actual date, as a RunF9 edit with your name (Overview → Edits made in RunF9, where it can be reverted). Update P6 at the next update.</p>}
        </Card>
        <Card icon={<Route size={15} />} title="What is driving the project" sub="The open activities that set the finish date, in order">
          {b.driving.today ? <p className="text-[14px] text-navy-950"><strong>Driving today:</strong> {b.driving.today.code} {b.driving.today.name}{b.driving.today.date ? `, finish ${fmtDate(b.driving.today.date)}` : ''}</p> : <p className="text-[13px] text-warm-600">No driving path: the schedule has no logic RunF9 can calculate.</p>}
          {b.driving.path.length > 1 && <ol className="list-decimal pl-5 text-[13px] text-warm-700 space-y-0.5">{b.driving.path.map(r => <li key={r.id}>{r.code} {r.name}{r.date ? ` · ${fmtDate(r.date)}` : ''}</li>)}</ol>}
          <Link href="/dashboard/timeline" className="text-[13px] font-medium text-accent-600 hover:underline">Open the schedule</Link>
        </Card>
        <Card icon={<ShieldAlert size={15} />} title="Today’s risks" sub="What could move the finish">
          {b.risks.length === 0 ? <p className="text-[13px] text-warm-600">No schedule risk today.</p> : <ul className="space-y-2">{b.risks.map((r, i) => (
            <li key={i} className="text-[13.5px] text-warm-700"><span className={`mr-1.5 inline-block px-1.5 py-0.5 rounded text-[11px] font-bold ${r.severity === 'high' ? 'bg-status-at-risk-bg text-status-at-risk' : 'bg-status-attention-bg text-status-attention'}`}>{r.severity === 'high' ? 'High' : 'Watch'}</span>{fmtDates(r.text)} <span className="text-[11.5px] text-warm-600">({r.source})</span></li>
          ))}</ul>}
        </Card>
        <Card icon={<Flag size={15} />} title="Today’s issues" sub="What is already wrong">
          {b.issues.length === 0 ? <p className="text-[13px] text-warm-600">No open issues.</p> : <ul className="space-y-2">{b.issues.map((r, i) => <li key={i} className="text-[13.5px] text-warm-700">{fmtDates(r.text)} <span className="text-[11.5px] text-warm-600">({r.source})</span></li>)}</ul>}
        </Card>
        <Card icon={<CalendarClock size={15} />} title="At risk in the next week and month" sub="Critical and near-critical work, and float that is running out">
          <List title="Next 7 days" rows={b.lookahead.week} empty="No critical or near-critical work in the next 7 days." showNote />
          <List title="Next 30 days" rows={b.lookahead.month.slice(0, 8)} empty="None." showNote />
          <List title="About to become critical" rows={b.lookahead.becomingCritical.slice(0, 8)} empty="No work is within 10 work days of becoming critical." showNote dateLabel="start" />
          <List title="Milestones" rows={b.lookahead.milestones} empty="No milestones in the next 30 days." late />
        </Card>
        <Card icon={<Sparkles size={15} />} title="What-if, run today" sub="Recalculated on the real network; nothing is saved">
          {b.whatIfs.length === 0 ? <p className="text-[13px] text-warm-600">No what-if could be calculated (the schedule has no logic).</p> : <ul className="space-y-2.5">{b.whatIfs.map((w, i) => (
            <li key={i} className="text-[13.5px] text-warm-700"><span className="block text-[12px] font-semibold text-navy-950">{w.title}</span>{fmtDates(w.text)}</li>
          ))}</ul>}
          <form className="flex flex-wrap items-end gap-2 pt-1" onSubmit={e => { e.preventDefault(); if (whatIf.activity.trim()) setRanWhatIf({ ...whatIf }) }}>
            <datalist id="wi-acts">{data.activities.slice(0, 2000).map(a => <option key={a.id} value={a.code}>{a.name}</option>)}</datalist>
            <label className="text-[12px] text-warm-600">If this activity<input list="wi-acts" value={whatIf.activity} onChange={e => setWhatIf(w => ({ ...w, activity: e.target.value }))} placeholder="Activity ID" className={`${input} block mt-0.5 w-36`} /></label>
            <label className="text-[12px] text-warm-600">takes longer by (work days)<input type="number" min={1} max={365} value={whatIf.days} onChange={e => setWhatIf(w => ({ ...w, days: e.target.value }))} className={`${input} block mt-0.5 w-24`} /></label>
            <button type="submit" className={btnPrimary} disabled={!whatIf.activity.trim()}>Run what-if</button>
          </form>
        </Card>
      </div>

      <Card icon={<GitBranch size={15} />} title="What changed" sub="Changes made in RunF9 in the last 7 days, and since the previous update">
        {b.changed.finishMovedDays != null && <p className="text-[13.5px] text-navy-950">With all RunF9 edits, the finish is <strong>{Math.abs(b.changed.finishMovedDays)} day{Math.abs(b.changed.finishMovedDays) === 1 ? '' : 's'} {b.changed.finishMovedDays > 0 ? 'later' : 'earlier'}</strong> than the schedule as submitted.</p>}
        {b.changed.edits.length === 0 ? <p className="text-[13px] text-warm-600">No changes were made in RunF9 in the last 7 days.</p> : (
          <ul className="space-y-1.5">{b.changed.edits.map((c, i) => (
            <li key={i} className="rounded-lg border-l-2 border-accent-500 bg-accent-100 px-3 py-2 text-[13px] text-warm-700">
              <span className="font-semibold text-navy-950">{fmtDates(c.what)}</span>: {fmtDates(c.before)} → {fmtDates(c.after)}
              <span className="block text-[12px] text-warm-600">{c.by}, {fmtDate(c.at)} · {c.reason}</span>
            </li>
          ))}</ul>
        )}
        {impact && impact.movedCount > 0 && b.changed.edits.length > 0 && (
          <div>
            <p className="text-[12.5px] font-semibold text-navy-950">What these changes move ({impact.movedCount} open {impact.movedCount === 1 ? 'activity' : 'activities'})</p>
            <ul className="text-[13px] text-warm-700">{impact.moved.slice(0, 6).map(m => <li key={m.id}><span className="font-mono text-[11.5px] text-warm-600">{m.code}</span> {m.name}: finish {m.finishDays === 0 ? 'unchanged' : `${Math.abs(m.finishDays)} day${Math.abs(m.finishDays) === 1 ? '' : 's'} ${m.finishDays > 0 ? 'later' : 'earlier'}`}</li>)}</ul>
            <Link href="/dashboard/timeline" className="text-[13px] font-medium text-accent-600 hover:underline">See them marked on the schedule</Link>
          </div>
        )}
        {b.changed.sinceLastUpdate && (
          <p className="text-[13px] text-warm-700">Since {b.changed.sinceLastUpdate.version}: {b.changed.sinceLastUpdate.finishMovedDays == null ? 'finish not comparable' : b.changed.sinceLastUpdate.finishMovedDays === 0 ? 'finish unchanged' : `finish ${Math.abs(b.changed.sinceLastUpdate.finishMovedDays)} day${Math.abs(b.changed.sinceLastUpdate.finishMovedDays) === 1 ? '' : 's'} ${b.changed.sinceLastUpdate.finishMovedDays > 0 ? 'later' : 'earlier'}`}; {b.changed.sinceLastUpdate.added} activities added, {b.changed.sinceLastUpdate.deleted} deleted, {b.changed.sinceLastUpdate.durationChanges} durations changed, {b.changed.sinceLastUpdate.logicChanges} logic changes. <Link href="/dashboard/project#compare" className="font-medium text-accent-600 hover:underline">See the full comparison</Link></p>
        )}
      </Card>

      <Card icon={<Mail size={15} />} title="From emails, meetings and field reports" sub="Sentences in this project’s correspondence that affect the schedule, quoted with their source">
        {b.signals.length === 0 ? (
          <p className="text-[13px] text-warm-600">Nothing yet. Add emails, meeting minutes or transcripts and daily field reports under <Link href="/dashboard/documents" className="font-medium text-accent-600 hover:underline">Documents</Link> (type “Email / letter”, “Meeting minutes / transcript” or “Daily field report”); RunF9 reads them for delays, changes, risks and commitments and ties them to activities.</p>
        ) : (
          <ul className="space-y-2">{b.signals.slice(0, 10).map((s, i) => (
            <li key={i} className="rounded-lg border border-warm-200 p-3 text-[13px]">
              <span className={`mr-1.5 inline-block px-1.5 py-0.5 rounded text-[11px] font-bold uppercase ${s.kind === 'delay' ? 'bg-status-at-risk-bg text-status-at-risk' : s.kind === 'commitment' ? 'bg-status-on-track-bg text-status-on-track' : 'bg-status-attention-bg text-status-attention'}`}>{s.kind}</span>
              <q className="text-warm-700">{s.quote}</q>
              <span className="block text-[12px] text-warm-600 mt-1">{s.citation.includes(s.title) ? s.citation : `${s.title} ${s.citation}`}{s.activity ? ` · about ${s.activity.code} ${s.activity.name}` : ''}{s.days ? ` · ${s.days} work day${s.days === 1 ? '' : 's'}` : ''}</span>
              {canWrite && s.kind !== 'commitment' && (items.some(it => it.sourceQuote === s.quote) ? <span className="mt-1.5 block text-[12.5px] text-warm-600">In the register</span> : <button type="button" disabled={busy === `sig${i}`} className="mt-1.5 text-[12.5px] font-medium text-accent-600 hover:underline" onClick={async () => {
                setBusy(`sig${i}`)
                const r = await postJson(`/api/schedules/${encodeURIComponent(sid!)}/register`, { kind: s.kind === 'change' ? 'pco' : s.kind === 'delay' ? 'issue' : 'risk', title: s.quote.slice(0, 180), impactDays: s.days, activityCodes: s.activity ? [s.activity.code] : [], sourceDocumentId: s.documentId, sourceQuote: s.quote })
                setBusy('')
                if (!r.ok) setErr(r.data.error || 'The item was not added.'); else await load()
              }}>Add to the register</button>)}
            </li>
          ))}</ul>
        )}
      </Card>

      <div className="grid md:grid-cols-2 gap-5">
        <Card icon={<FileText size={15} />} title="Contract watch" sub="Notice periods, damages and update duties, read from the contract and what they mean today">
          {data.watch.contract.length === 0 ? (
            <p className="text-[13px] text-warm-600">{data.watch.read.contract ? 'No notice period, liquidated damages or update duty was found in the contract documents of this project.' : <>Add the contract and the scheduling specification under <Link href="/dashboard/documents" className="font-medium text-accent-600 hover:underline">Documents</Link>. RunF9 will watch the notice periods, the liquidated damages and the update duties against the schedule every day.</>}</p>
          ) : (
            <ul className="space-y-2.5">{data.watch.contract.map((c, i) => (
              <li key={i} className={`rounded-lg border p-3 text-[13px] ${c.active ? 'border-status-at-risk bg-status-at-risk-bg' : 'border-warm-200'}`}>
                <span className="font-medium text-navy-950">{fmtDates(c.text)}</span>
                <q className="mt-1 block text-warm-700">{c.quote}</q>
                <span className="mt-1 block text-[12px] text-warm-600">{c.citation.includes(c.title) ? c.citation : `${c.title} ${c.citation}`}</span>
              </li>
            ))}</ul>
          )}
          {data.watch.read.contract > 0 && (
            <p className="text-[12.5px] text-warm-600">These are the clauses that state a number of days, an amount or a frequency. For obligations worded less directly, <Link href={`/dashboard/ask?schedule=${encodeURIComponent(sid!)}&docs=1&unreviewed=1&q=${encodeURIComponent('List every obligation in the contract documents that carries a deadline, a notice requirement, a submittal or a penalty, with the clause each comes from, and say which ones the current schedule status triggers.')}`} className="font-medium text-accent-600 hover:underline">ask AI to read the contract</Link>; its answer cites each clause.</p>
          )}
        </Card>
        <Card icon={<HardHat size={15} />} title="The field and the drawings against the schedule" sub="What the daily reports and the design documents say that the schedule does not">
          <div>
            <h3 className="text-[12.5px] font-semibold text-navy-950">In the ground, not in the schedule</h3>
            {data.watch.field.length === 0 ? <p className="text-[13px] text-warm-600">{data.watch.read.field ? 'The daily reports agree with the schedule.' : 'Add daily field reports under Documents to compare the work on site with the schedule.'}</p> : (
              <ul className="space-y-2">{data.watch.field.map((f, i) => (
                <li key={i} className="text-[13px] text-warm-700"><span className="font-medium text-navy-950">{f.text}</span><q className="block">{f.quote}</q><span className="block text-[12px] text-warm-600">{f.citation.includes(f.title) ? f.citation : `${f.title} ${f.citation}`}</span></li>
              ))}</ul>
            )}
          </div>
          <div>
            <h3 className="text-[12.5px] font-semibold text-navy-950">In the drawings and specifications, not in the schedule</h3>
            {data.watch.notInSchedule.length === 0 ? <p className="text-[13px] text-warm-600">{data.watch.read.design ? 'Every kind of work the design documents name has an activity.' : 'Add drawings and specifications under Documents to check that their scope is in the schedule.'}</p> : (
              <ul className="space-y-2">{data.watch.notInSchedule.map((g, i) => (
                <li key={i} className="text-[13px] text-warm-700"><span className="font-medium text-navy-950">{g.label}: no activity covers it.</span><q className="block">{g.quote}</q><span className="block text-[12px] text-warm-600">{g.citation.includes(g.title) ? g.citation : `${g.title} ${g.citation}`}</span></li>
              ))}</ul>
            )}
          </div>
        </Card>
      </div>

      <Register sid={sid!} items={items} openCount={openItems.length} canWrite={canWrite} activities={data.activities} onChanged={load} today={b.asOf} />

      <div className="grid md:grid-cols-2 gap-5">
        <Card icon={<PlayCircle size={15} />} title="What is missing" sub="Scope and logic the schedule should probably have">
          {b.missing.scope.length > 0 && <div><p className="text-[12.5px] font-semibold text-navy-950">Not found in any activity name or WBS (confirm it is covered):</p><ul className="list-disc pl-5 text-[13px] text-warm-700">{b.missing.scope.map(x => <li key={x}>{x}</li>)}</ul></div>}
          {b.missing.looseEnds > 0 && <p className="text-[13px] text-warm-700">{b.missing.looseEnds} open activit{b.missing.looseEnds === 1 ? 'y has' : 'ies have'} no predecessor or no successor, so a delay there cannot reach the finish date.</p>}
          {b.missing.proposals.length > 0 && <ul className="space-y-1.5">{b.missing.proposals.map((p, i) => <li key={i} className="text-[13px] text-warm-700"><span className="font-medium text-navy-950">{p.text}</span><span className="block text-[12px] text-warm-600">{p.reason}</span></li>)}</ul>}
          {b.missing.scope.length === 0 && b.missing.looseEnds === 0 && <p className="text-[13px] text-warm-600">Nothing obvious is missing.</p>}
          <Link href="/dashboard/quality" className="text-[13px] font-medium text-accent-600 hover:underline">Review and add the links in Quality</Link>
        </Card>
        <Card icon={<GitBranch size={15} />} title="Logic that does not make sense" sub="Links that run against the usual order of work">
          {b.logic.length === 0 ? <p className="text-[13px] text-warm-600">No link runs against the usual order of work.</p> : <ul className="space-y-1.5">{b.logic.map((p, i) => <li key={i} className="text-[13px] text-warm-700"><span className="font-medium text-navy-950">{p.text}</span><span className="block text-[12px] text-warm-600">{p.reason}</span></li>)}</ul>}
        </Card>
      </div>
      <p className="text-[12px] text-warm-600">This brief is calculated from the schedule, the register and the documents of this project. No AI model writes it, so every line traces to an activity, an item or a quoted passage.</p>
    </div>
  )
}

function Card({ icon, title, sub, children }: { icon: React.ReactNode; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[14px] border border-warm-200 bg-white p-5 space-y-3 min-w-0">
      <div>
        <h2 className="flex items-center gap-2 text-[16px] font-semibold text-navy-950"><span aria-hidden className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-accent-100 text-accent-600">{icon}</span>{title}</h2>
        {sub && <p className="text-[12.5px] text-warm-600 mt-0.5">{sub}</p>}
      </div>
      {children}
    </section>
  )
}

function RowBtn({ label, onClick, busy }: { label: string; onClick: () => void; busy: boolean }) {
  return <button type="button" onClick={onClick} disabled={busy} className="flex-shrink-0 text-[12px] font-medium text-accent-600 hover:underline disabled:opacity-60">{busy ? 'Saving…' : label}</button>
}

function List({ title, rows, empty, late, showNote, dateLabel, plain, action }: { title: string; rows: BriefRow[]; empty: string; late?: boolean; showNote?: boolean; dateLabel?: string; /** Dates only: no float (work that is already done) */ plain?: boolean; action?: (r: BriefRow) => React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[12.5px] font-semibold text-navy-950">{title}</h3>
      {rows.length === 0 ? <p className="text-[13px] text-warm-600">{empty}</p> : (
        <ul className="divide-y divide-warm-200">
          {rows.map(r => (
            <li key={r.id} className="py-1.5 flex items-start justify-between gap-3 text-[13px]">
              <span className="min-w-0"><span className="font-mono text-[11.5px] text-warm-600">{r.code}</span> <span className="text-warm-700">{r.name}</span>
                {r.critical && <span className="ml-1.5 text-[11px] font-bold text-status-at-risk">CRITICAL</span>}
                <span className="block text-[12px] text-warm-600">{r.date ? `${showNote && r.note && !/float/.test(r.note) ? `${r.note} ` : dateLabel ? `${dateLabel} ` : ''}${fmtDate(r.date)}` : ''}{late && r.daysLate ? ` · ${r.daysLate} day${r.daysLate === 1 ? '' : 's'} late` : ''}{showNote && r.note && /float/.test(r.note) ? ` · ${r.note}` : ''}{!plain && !r.critical && r.float != null && !showNote ? ` · float ${r.float}d` : ''}</span>
              </span>
              {action?.(r)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Register({ sid, items, openCount, canWrite, activities, onChanged, today }: { sid: string; items: RegisterItem[]; openCount: number; canWrite: boolean; activities: { id: string; code: string; name: string }[]; onChanged: () => Promise<void>; today: string }) {
  const [f, setF] = useState({ kind: 'risk' as RegisterKind, title: '', owner: '', dueDate: '', impactDays: '', activity: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [showClosed, setShowClosed] = useState(false)
  const add = async () => {
    setBusy(true); setErr('')
    const r = await postJson(`/api/schedules/${encodeURIComponent(sid)}/register`, { kind: f.kind, title: f.title, owner: f.owner || null, dueDate: f.dueDate || null, impactDays: f.impactDays === '' ? null : Number(f.impactDays), activityCodes: f.activity.trim() ? [f.activity.trim()] : [] })
    setBusy(false)
    if (!r.ok) { setErr(r.data.error || 'The item was not added.'); return }
    setF({ ...f, title: '', owner: '', dueDate: '', impactDays: '', activity: '' })
    await onChanged()
  }
  const setStatus = async (i: RegisterItem, status: 'open' | 'closed') => {
    const r = await postJson(`/api/schedules/${encodeURIComponent(sid)}/register?itemId=${encodeURIComponent(i.id)}`, { status }, 'PATCH')
    if (!r.ok) setErr(r.data.error || 'The item was not updated.'); else await onChanged()
  }
  const shown = items.filter(i => showClosed || i.status === 'open')
  return (
    <section aria-labelledby="reg-h" className="rounded-[14px] border border-warm-200 bg-white p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="reg-h" className="text-[16px] font-semibold text-navy-950">Risks, issues and changes ({openCount} open)</h2>
          <p className="text-[12.5px] text-warm-600">Risks, issues, PCOs, change requests, change orders and contract amendments. Give an item an activity and a number of days and it joins tomorrow’s what-if runs.</p>
        </div>
        {items.some(i => i.status === 'closed') && <label className="text-[12.5px] text-warm-700"><input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} /> Show closed</label>}
      </div>
      {err && <Alert tone="error">{err}</Alert>}
      {shown.length === 0 ? <p className="text-[13px] text-warm-600">No items yet.</p> : (
        <ul className="divide-y divide-warm-200">
          {shown.map(i => (
            <li key={i.id} className="py-2 flex items-start justify-between gap-3 text-[13px]">
              <span className="min-w-0">
                <span className="mr-1.5 inline-block px-1.5 py-0.5 rounded bg-warm-100 text-[11px] font-bold text-navy-950">{KIND_LABEL[i.kind]}</span>
                <span className={i.status === 'closed' ? 'text-warm-600 line-through' : 'text-warm-700'}>{i.title}</span>
                <span className="block text-[12px] text-warm-600">{[i.owner && `owner ${i.owner}`, i.dueDate && `due ${fmtDate(i.dueDate)}${i.status === 'open' && i.dueDate < today ? ' (overdue)' : ''}`, i.impactDays != null && `${i.impactDays} work day${Math.abs(i.impactDays) === 1 ? '' : 's'}`, i.activityCodes?.length ? i.activityCodes.join(', ') : null, i.sourceDocumentId ? 'from a project document' : null, `added ${fmtDate(i.createdAt)}${i.createdByName ? ` by ${i.createdByName}` : ''}`].filter(Boolean).join(' · ')}</span>
              </span>
              {canWrite && <button type="button" onClick={() => setStatus(i, i.status === 'open' ? 'closed' : 'open')} className="flex-shrink-0 text-[12px] font-medium text-accent-600 hover:underline">{i.status === 'open' ? 'Close' : 'Reopen'}</button>}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <Disclosure title="Add an item">
          <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); add() }}>
            <datalist id="reg-acts">{activities.slice(0, 2000).map(a => <option key={a.id} value={a.code}>{a.name}</option>)}</datalist>
            <label className="text-[12px] text-warm-600">Type<select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value as RegisterKind })} className={`${input} block mt-0.5`}>{(Object.keys(KIND_LABEL) as RegisterKind[]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></label>
            <label className="text-[12px] text-warm-600 flex-1 min-w-[220px]">What<input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} maxLength={200} placeholder="e.g. Switchgear delivery slips to January" className={`${input} block mt-0.5 w-full`} /></label>
            <label className="text-[12px] text-warm-600">Owner<input value={f.owner} onChange={e => setF({ ...f, owner: e.target.value })} maxLength={120} className={`${input} block mt-0.5 w-32`} /></label>
            <label className="text-[12px] text-warm-600">Due<input type="date" value={f.dueDate} onChange={e => setF({ ...f, dueDate: e.target.value })} className={`${input} block mt-0.5`} /></label>
            <label className="text-[12px] text-warm-600">Impact (work days)<input type="number" value={f.impactDays} onChange={e => setF({ ...f, impactDays: e.target.value })} className={`${input} block mt-0.5 w-24`} /></label>
            <label className="text-[12px] text-warm-600">Activity<input list="reg-acts" value={f.activity} onChange={e => setF({ ...f, activity: e.target.value })} placeholder="Activity ID" className={`${input} block mt-0.5 w-32`} /></label>
            <button type="submit" disabled={busy || f.title.trim().length < 3} className={btnPrimary}>{busy ? 'Adding…' : 'Add'}</button>
          </form>
        </Disclosure>
      )}
    </section>
  )
}
