'use client'

// "Nora's logic suggestions": loose ends in the network and the likely fix for each, read from the
// activity names (work type, location, the usual trade order). Top suggestions first, one action
// each; the rest behind "Show all"; everything as CSV. Applying adds the link through the same
// audited edit route as the schedule dashboard's edits (reason required, uploaded file unchanged).

import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Download, Loader2 } from 'lucide-react'
import { MoodTile, Robot, type RobotMood } from '@/components/Robot'
import { Disclosure } from '@/components/Disclosure'
import { postJson } from '@/components/ui'
import type { LogicSuggestion, LogicAssistResult } from '@/lib/logic-assist/suggest'
import { suggestionsCsv, SUGGESTION_KIND_LABEL } from '@/lib/logic-assist/csv'

interface Data {
  schedule: { id: string; name: string; version: string; sourceType: string }
  editable: boolean
  editsApplied: number
  summary: LogicAssistResult['summary']
  suggestions: LogicSuggestion[]
  unresolved: LogicAssistResult['unresolved']
}

const TOP = 3
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const level = (c: number) => (c >= 0.75 ? 'Likely' : c >= 0.5 ? 'Possible' : 'Worth a look')

function headline(d: Data): { mood: RobotMood; title: string; sub: string } {
  const s = d.summary
  const adds = d.suggestions.filter(x => x.action === 'add_link').length
  const tiedOnly = d.suggestions.filter(x => x.kind === 'completion_only').length
  if (s.looseEnds === 0 && tiedOnly === 0) {
    return { mood: 'done', title: 'Every activity is tied in: no loose ends.', sub: s.outOfSequence + s.redundant > 0 ? `${plural(s.outOfSequence + s.redundant, 'link')} you may want to tidy up are under “Show all”.` : 'Nothing is waiting for you here.' }
  }
  const mood: RobotMood = s.looseEnds > Math.max(5, s.activities * 0.25) ? 'worried' : 'waiting'
  const title = s.looseEnds > 0
    ? `${plural(s.looseEnds, 'activity has', 'activities have')} a loose end${adds ? ': here are likely fixes.' : '.'}`
    : tiedOnly > 0 && tiedOnly < s.completionOnly
      ? `No loose ends, but ${plural(s.completionOnly, 'activity leads', 'activities lead')} only to the finish: Nora has a likely place for ${tiedOnly}.`
      : `No loose ends, but ${plural(s.completionOnly, 'activity leads', 'activities lead')} only to the finish: here is where ${s.completionOnly === 1 ? 'it' : 'they'} likely fit${s.completionOnly === 1 ? 's' : ''}.`
  const sub = s.unresolved > 0 ? `Nora found a likely fix for ${s.suggested} of ${s.looseEnds}; the other ${s.unresolved} are listed under “Show all”.` : 'Read from the activity names: the kind of work, its location and the usual trade order.'
  return { mood, title, sub }
}

export function NoraLogicPanel({ scheduleId, canEdit }: { scheduleId: string; canEdit: boolean }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  const load = useCallback(async () => {
    setError('')
    const res = await fetch(`/api/schedules/${encodeURIComponent(scheduleId)}/logic-suggestions`)
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { setError(d.error || 'Nora could not read this schedule’s logic.'); return }
    setData(d)
  }, [scheduleId])
  useEffect(() => { setData(null); setStatus(''); load() }, [load])

  const download = () => {
    if (!data) return
    const blob = new Blob([suggestionsCsv(data.suggestions)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(data.schedule.name || 'schedule').replace(/[^\w.-]+/g, '_').slice(0, 60)}-logic-suggestions.csv`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  if (error) {
    return (
      <MoodTile mood="worried" as="section" className="flex items-center gap-3">
        <Robot mood="worried" size={48} />
        <p role="alert" className="text-[13.5px] text-warm-700">{error}</p>
      </MoodTile>
    )
  }
  if (!data) {
    return (
      <MoodTile mood="working" as="section" className="flex items-center gap-3">
        <Robot mood="working" size={48} />
        <p className="text-[13.5px] text-warm-700 flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden /> Nora is reading the activity names and tracing the logic…</p>
      </MoodTile>
    )
  }

  const h = headline(data)
  const adds = data.suggestions.filter(x => x.action === 'add_link')
  const top = adds.slice(0, TOP)
  const canApply = canEdit && data.editable
  const applied = (s: LogicSuggestion) => {
    setStatus(`Added ${s.predecessor.code} → ${s.successor.code} to the “With RunF9 edits” scenario. The uploaded file is unchanged; you can revert it from the schedule dashboard’s edits.`)
    load()
  }
  return (
    <section aria-labelledby="nora-logic-h" id="nora-logic" className="space-y-3">
      <MoodTile mood={h.mood} className="flex items-start gap-3.5">
        <Robot mood={h.mood} size={56} className="flex-shrink-0 -mt-1" />
        <div className="min-w-0 flex-1">
          <h2 id="nora-logic-h" className="text-[11px] font-semibold uppercase tracking-wider text-warm-600">Nora&apos;s logic suggestions</h2>
          <p className="text-[15px] font-medium text-navy-950 mt-0.5">{h.title}</p>
          <p className="text-[12.5px] text-warm-600 mt-0.5">{h.sub}</p>
        </div>
      </MoodTile>

      {top.length > 0 && (
        <div>
          <h3 className="text-[12px] font-semibold text-navy-950 mb-1.5">Waiting for you</h3>
          <ol className="space-y-2">
            {top.map(s => <SuggestionCard key={s.id} s={s} scheduleId={scheduleId} canApply={canApply} onApplied={applied} />)}
          </ol>
        </div>
      )}
      <div aria-live="polite">{status && <p role="status" className="text-[12.5px] text-status-on-track">{status}</p>}</div>

      {(data.suggestions.length > top.length || data.unresolved.length > 0) && (
        <Disclosure tone="card" title={`Show all suggestions`} meta={`${data.suggestions.length} suggestion${data.suggestions.length === 1 ? '' : 's'}${data.unresolved.length ? ` · ${data.unresolved.length} without one` : ''}`}>
          <div className="space-y-3">
            {adds.length > TOP && (
              <ol className="space-y-2" start={TOP + 1}>
                {adds.slice(TOP).map(s => <SuggestionCard key={s.id} s={s} scheduleId={scheduleId} canApply={canApply} onApplied={applied} compact />)}
              </ol>
            )}
            {data.suggestions.some(s => s.action !== 'add_link') && (
              <div>
                <h3 className="text-[12.5px] font-semibold text-navy-950 mb-1">Links to look over (optional)</h3>
                <ul className="divide-y divide-warm-200 text-[12.5px]">
                  {data.suggestions.filter(s => s.action !== 'add_link').map(s => (
                    <li key={s.id} className="py-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-warm-600">{SUGGESTION_KIND_LABEL[s.kind]}</span>
                      <p className="text-navy-950"><LinkText s={s} /></p>
                      <p className="text-warm-600">{s.reason}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {data.unresolved.length > 0 && (
              <div>
                <h3 className="text-[12.5px] font-semibold text-navy-950 mb-1">Loose ends without a suggestion</h3>
                <p className="text-[12px] text-warm-600 mb-1">Nora could not tell what kind of work these are, or every likely link would have created a loop. Link them in your scheduling tool or in RunF9&apos;s edits.</p>
                <ul className="text-[12.5px] text-warm-700 space-y-0.5">
                  {data.unresolved.map(u => <li key={`${u.id}-${u.missing}`}><span className="font-mono text-warm-600">{u.code}</span> {u.name} <span className="text-warm-600">· no {u.missing}</span></li>)}
                </ul>
              </div>
            )}
          </div>
        </Disclosure>
      )}

      {data.suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <button type="button" onClick={download} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-warm-300 bg-warm-50 hover:border-navy-900 text-[12.5px] text-navy-950">
            <Download size={13} aria-hidden /> Download all as CSV
          </button>
          <span className="text-[12px] text-warm-600">
            Suggestions are checked so none creates a logic loop or repeats an existing path.{data.editsApplied > 0 ? ` Includes the ${plural(data.editsApplied, 'edit')} made in RunF9.` : ''}
          </span>
        </div>
      )}
    </section>
  )
}

function LinkText({ s }: { s: LogicSuggestion }) {
  return (
    <>
      <span className="font-mono text-[11.5px] text-warm-600">{s.predecessor.code}</span> {s.predecessor.name}
      <ArrowRight size={12} className="inline mx-1 -mt-0.5 text-warm-500" aria-label="then" />
      <span className="font-mono text-[11.5px] text-warm-600">{s.successor.code}</span> {s.successor.name}
    </>
  )
}

function SuggestionCard({ s, scheduleId, canApply, onApplied, compact = false }: { s: LogicSuggestion; scheduleId: string; canApply: boolean; onApplied: (s: LogicSuggestion) => void; compact?: boolean }) {
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState(`Nora suggestion: ${s.reason}`)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const apply = async () => {
    setBusy(true); setErr('')
    const r = await postJson(`/api/schedules/${encodeURIComponent(scheduleId)}/edits`, {
      change: { kind: 'link_set', predecessorId: s.predecessor.id, successorId: s.successor.id, type: s.type, lag: s.lag },
      reason,
    })
    setBusy(false)
    if (!r.ok) { setErr(r.data.error || 'The link was not added.'); return }
    setConfirming(false)
    onApplied(s)
  }
  return (
    <li className={`bg-white/80 border border-warm-200 rounded-xl ${compact ? 'px-3.5 py-2.5' : 'px-4 py-3'}`}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] text-warm-600">{s.problem}</p>
          <p className="text-[13.5px] text-navy-950 mt-0.5"><span className="font-semibold">Link </span><LinkText s={s} /></p>
          <p className="text-[12.5px] text-warm-700 mt-0.5">{s.reason} <span className="text-warm-600">· {level(s.confidence)} ({Math.round(s.confidence * 100)}%)</span></p>
        </div>
        {canApply && !confirming && (
          <button type="button" onClick={() => setConfirming(true)} className="px-3 py-1.5 rounded-md bg-navy-900 text-white text-[12.5px] font-medium flex-shrink-0">Add this link</button>
        )}
      </div>
      {confirming && (
        <div className="mt-2.5 pt-2.5 border-t border-warm-200 space-y-2">
          <label className="block text-[12px] text-warm-600">Reason (kept with the edit and in the audit log)
            <input value={reason} onChange={e => setReason(e.target.value)} className="block mt-0.5 w-full border border-warm-300 rounded-md px-2.5 py-1.5 bg-white text-[13px] text-warm-700" />
          </label>
          <p className="text-[12px] text-warm-600">Adds a finish-to-start link to RunF9&apos;s “With RunF9 edits” scenario and recalculates it. Your uploaded file is not changed.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || reason.trim().length < 5} onClick={apply} className="px-3 py-1.5 rounded-md bg-navy-900 text-white text-[12.5px] font-medium disabled:opacity-60">{busy ? 'Adding…' : 'Add link and recalculate'}</button>
            <button type="button" disabled={busy} onClick={() => { setConfirming(false); setErr('') }} className="px-3 py-1.5 rounded-md border border-warm-300 text-[12.5px] text-navy-950">Cancel</button>
          </div>
          {err && <p role="alert" className="text-[12px] text-status-at-risk">{err}</p>}
        </div>
      )}
    </li>
  )
}
