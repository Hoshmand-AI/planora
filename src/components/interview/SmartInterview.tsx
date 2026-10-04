'use client'

// The interview, redesigned around one idea: ask the next question that matters, one at a time,
// and say plainly when the plan is good enough to build. Everything else (optional detail,
// questions waiting on an earlier answer, what's already answered) lives in quiet collapsible
// sections below. Numbers are real: "moves the finish up to N days" comes from re-scheduling the
// project under each answer (src/lib/planning/adaptive.ts).

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, Loader2, Lock, Sparkles, X } from 'lucide-react'
import type { Answer, Assumption, ElicitationResult, Question, SourceRef } from '@/lib/planning/types'
import type { AdaptiveInterview } from '@/lib/planning/adaptive'
import { Disclosure } from '@/components/Disclosure'
import { fmtDate, fmtDates } from '@/lib/format'

export const SECTION_LABEL: Record<string, string> = {
  project: 'Project', design: 'Design', permits: 'Permits', procurement: 'Long-lead', site: 'Site', milestones: 'Milestone targets',
  regulatory: 'Regulatory', calendar: 'Calendar', security: 'Security', history: 'Firm history', cost: 'Cost basis',
}
const SOURCE_LABEL: Record<SourceRef['kind'], string> = {
  user: 'Your answer', file: 'Uploaded file', catalog: 'Regional catalog', firm_history: 'Firm history', template: 'Template',
  model: 'AI suggestion', override: 'Override', assumption: 'Assumption',
}
/** Short labels for checklist rows (long-lead and permit status). */
const SHORT: Record<string, string> = {
  not_released: 'Not ordered', released: 'Ordered', owner_furnished: 'Owner supplies', not_in_scope: 'Not needed',
  issued: 'Issued', submitted: 'In review', not_submitted: 'Not submitted', not_required: 'Not needed',
}

export interface AnsweredItem { id: string; prompt: string; section: string; label: string; status: string; value: Answer['value'] | null; note: string | null; custom: boolean }

export interface SmartInterviewProps {
  el: ElicitationResult
  adaptive: AdaptiveInterview
  answered: AnsweredItem[]
  hasSchedule: boolean
  canWrite: boolean
  busy: string | null
  llm: { mode: 'cloud' | 'local' | 'offline'; error?: string }
  history: { projectCount: number; similarCount: number } | null
  onAnswer: (qid: string, a: Partial<Answer> | null) => Promise<void>
  onAnswerMany: (answers: Record<string, Partial<Answer>>) => Promise<void>
  onGenerate: () => void
  onSuggest: () => void
  onAddNote: (text: string) => Promise<boolean>
}

export function SmartInterview(p: SmartInterviewProps) {
  const { el, adaptive: ad } = p
  const current = ad.ask[0]
  const group = current ? ad.groups.find(g => g.questionIds.includes(current.id)) : undefined
  const upNext = useMemo(() => {
    const seen = new Set(group ? group.questionIds : current ? [current.id] : [])
    const out: { key: string; text: string; meta: string }[] = []
    for (const q of ad.ask) {
      if (seen.has(q.id)) continue
      const g = ad.groups.find(x => x.questionIds.includes(q.id))
      if (g) { g.questionIds.forEach(id => seen.add(id)); out.push({ key: g.id, text: g.label, meta: `${g.questionIds.length} items · up to ${g.swingDays} days` }) }
      else { seen.add(q.id); const s = ad.insights[q.id]?.swingDays; out.push({ key: q.id, text: q.prompt, meta: s ? `up to ${s} days` : SECTION_LABEL[q.section] || q.section }) }
    }
    return out
  }, [ad, current, group])
  const answeredCount = p.answered.length
  const progress = answeredCount + ad.remainingThatMatter ? answeredCount / (answeredCount + ad.remainingThatMatter) : 1

  return (
    <div className="max-w-[760px] mx-auto">
      <StatusHeader ad={ad} progress={progress} hasSchedule={p.hasSchedule} canWrite={p.canWrite} busy={p.busy} onGenerate={p.onGenerate} />

      {el.conflicts.length > 0 && (
        <div role="status" className="mt-4 rounded-2xl border border-status-attention/50 bg-status-attention-bg px-5 py-4 text-[13.5px] text-warm-700">
          <div className="font-semibold text-navy-950 mb-1">Two answers don&apos;t fit together</div>
          <ul className="space-y-1">{el.conflicts.map((c, i) => <li key={i}>{fmtDates(c)}</li>)}</ul>
        </div>
      )}

      <div className="mt-5">
        {!current ? (
          <div className="rise-in rounded-3xl bg-white border border-warm-200 px-6 py-8 text-center">
            <div className="mx-auto w-10 h-10 rounded-full bg-status-on-track-bg flex items-center justify-center mb-3"><Check size={18} className="text-status-on-track" aria-hidden /></div>
            <div className="text-[19px] font-semibold text-navy-950 tracking-[-0.01em]">Nothing left that changes your finish date</div>
            <p className="text-[14px] text-warm-600 mt-1.5 max-w-[460px] mx-auto">Optional details below refine the basis of schedule. They&apos;re there when you have them.</p>
          </div>
        ) : group ? (
          <GroupCard key={group.id} group={group} questions={ad.ask.filter(q => group.questionIds.includes(q.id))} busy={!!p.busy} disabled={!p.canWrite} onSave={p.onAnswerMany} />
        ) : (
          <FocusCard key={current.id} q={current} insight={ad.insights[current.id]} busy={p.busy === `answer:${current.id}`} disabled={!p.canWrite} onAnswer={p.onAnswer} />
        )}
      </div>

      {upNext.length > 0 && (
        <div className="mt-6">
          <div className="text-[12px] font-medium text-warm-500 mb-2">Up next</div>
          <ol className="space-y-1.5">
            {upNext.slice(0, 3).map(n => (
              <li key={n.key} className="flex items-baseline gap-3 text-[13.5px]">
                <span className="text-warm-700 flex-1 min-w-0 truncate">{n.text}</span>
                <span className="text-[12px] text-warm-500 tabular-nums whitespace-nowrap">{n.meta}</span>
              </li>
            ))}
          </ol>
          {upNext.length > 3 && <div className="text-[12px] text-warm-500 mt-1.5">and {upNext.length - 3} more</div>}
        </div>
      )}

      <div className="mt-8">
        {ad.optional.length > 0 && (
          <Disclosure title="Optional details" meta={`${ad.optional.length} · won't move your finish`}>
            <p className="text-[13px] text-warm-500 mb-3">We tried every answer to these against your schedule. None moves the finish by {ad.thresholdDays} days or more, so they&apos;re here when you want to be precise.</p>
            <div className="space-y-3">
              {ad.optional.slice(0, 40).map(q => <CompactQuestion key={q.id} q={q} reason={ad.insights[q.id]?.reason} busy={p.busy === `answer:${q.id}`} disabled={!p.canWrite} onAnswer={p.onAnswer} />)}
            </div>
          </Disclosure>
        )}
        {ad.deferred.length > 0 && (
          <Disclosure title="Waiting on an earlier answer" meta={ad.deferred.length}>
            <ul className="space-y-2">
              {ad.deferred.map(d => <li key={d.id} className="text-[13px]"><div className="text-warm-700">{d.prompt}</div><div className="text-[12px] text-warm-500">{d.reason}</div></li>)}
            </ul>
          </Disclosure>
        )}
        {p.answered.length > 0 && (
          <Disclosure title="Answered" meta={p.answered.length}>
            <ul className="divide-y divide-warm-200">
              {p.answered.map(a => <AnsweredRow key={a.id} a={a} issues={(el.dateIssues || []).filter(i => i.questionIds.includes(a.id)).map(i => i.text)} disabled={!p.canWrite} onAnswer={p.onAnswer} />)}
            </ul>
          </Disclosure>
        )}
        {p.canWrite && <AddNote busy={!!p.busy} onAddNote={p.onAddNote} />}
        {el.assumptions.length > 0 && (
          <Disclosure title="Assumptions in your schedule" meta={el.assumptions.length}>
            <ul className="space-y-2">
              {el.assumptions.map((a: Assumption) => (
                <li key={a.questionId} className="text-[13px] text-warm-600">{a.kind === 'withheld' && <Lock size={11} className="inline mr-1" aria-label="Withheld" />}{fmtDates(a.text)}{a.bufferDays ? <span className="text-warm-500"> (+{a.bufferDays} days contingency)</span> : null}</li>
              ))}
            </ul>
          </Disclosure>
        )}
        <Disclosure title="What the interview is based on">
          <ul className="text-[13px] text-warm-600 space-y-1.5">
            <li>Permits and regulations for {el.profile.state || 'your location (not set yet)'}{el.profile.projectType ? `, ${el.profile.projectType.replace(/_/g, ' ')}` : ''}.</li>
            <li>Long-lead equipment lead times (2024–25 market ranges).</li>
            <li>{p.history ? `${p.history.projectCount} of your firm's schedules (${p.history.similarCount} similar), private to your firm.` : 'No firm history yet. Upload past schedules to ground durations in your own actuals.'}</li>
            <li>Every question was ranked by re-scheduling the project {ad.simulations} times against its possible answers.</li>
          </ul>
          {p.canWrite && (p.llm.mode !== 'offline' ? (
            <button onClick={p.onSuggest} disabled={!!p.busy} className="pressable mt-3 inline-flex items-center gap-1.5 rounded-full border border-warm-300 bg-white px-3.5 py-1.5 text-[13px] font-medium text-navy-950 hover:border-navy-900 disabled:opacity-50">
              {p.busy === 'suggest' ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Sparkles size={13} aria-hidden />} Ask AI for project-specific follow-ups
            </button>
          ) : <p className="text-[12.5px] text-warm-500 mt-3">AI follow-ups are off ({p.llm.error || 'offline mode'}). The rule-based interview covers the core schedule drivers.</p>)}
        </Disclosure>
      </div>
    </div>
  )
}

/* ─── Status: how settled is the finish date ─────────── */

function StatusHeader({ ad, progress, hasSchedule, canWrite, busy, onGenerate }: { ad: AdaptiveInterview; progress: number; hasSchedule: boolean; canWrite: boolean; busy: string | null; onGenerate: () => void }) {
  const settled = ad.enoughToBuild
  return (
    <section aria-label="Interview progress" className="rounded-3xl bg-white border border-warm-200 px-6 py-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <div className="text-[12.5px] text-warm-500">{settled ? 'Your brief is ready' : 'Questions that can still move your finish'}</div>
          <div className="text-[28px] leading-none font-semibold text-navy-950 tracking-[-0.02em] mt-1.5 tabular-nums">
            {settled ? 'Enough to build' : ad.remainingThatMatter}
          </div>
          {ad.baselineFinish && (
            <div className="text-[13px] text-warm-600 mt-2">
              Forecast finish <span className="font-semibold text-navy-950 tabular-nums">{fmtDate(ad.baselineFinish)}</span>
              {ad.finishUncertaintyDays > 0 && !settled && <span className="text-warm-500"> · could still move about ±{ad.finishUncertaintyDays} days</span>}
            </div>
          )}
        </div>
        {canWrite && (settled || hasSchedule) && (
          <button onClick={onGenerate} disabled={!!busy} className="pressable inline-flex items-center gap-2 rounded-full bg-navy-950 text-white px-5 py-2.5 text-[14px] font-semibold hover:bg-navy-900 disabled:opacity-50">
            {busy === 'generate' ? <Loader2 size={15} className="animate-spin" aria-hidden /> : null}
            {hasSchedule ? 'Rebuild with my answers' : 'Build my schedule'} <ArrowRight size={15} aria-hidden />
          </button>
        )}
      </div>
      <div className="mt-4 h-1 rounded-full bg-warm-200 overflow-hidden" role="progressbar" aria-label="Interview progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
        <div className="meter-fill h-full rounded-full bg-accent-600" style={{ width: `${Math.max(4, Math.round(progress * 100))}%` }} />
      </div>
      {!settled && !hasSchedule && canWrite && (
        <p className="text-[12.5px] text-warm-500 mt-3">You can build at any time; anything still open becomes a stated assumption with contingency. <button onClick={onGenerate} disabled={!!busy} className="font-medium text-accent-600 hover:underline">Build now</button></p>
      )}
    </section>
  )
}

/* ─── The one question in focus ──────────────────────── */

function FocusCard({ q, insight, busy, disabled, onAnswer }: { q: Question; insight?: { swingDays: number | null; reason: string }; busy: boolean; disabled: boolean; onAnswer: SmartInterviewProps['onAnswer'] }) {
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [other, setOther] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const withNote = (a: Partial<Answer>): Partial<Answer> => (note.trim() ? { ...a, note: note.trim() } : a)
  const submit = (v: unknown) => { if (!disabled) onAnswer(q.id, withNote({ status: 'known', value: v as Answer['value'] })) }
  const choices = q.kind === 'boolean' ? [{ value: true, label: 'Yes' }, { value: false, label: 'No' }] : q.kind === 'choice' && (q.options?.length || 0) <= 12 ? q.options!.map(o => ({ value: o.value as unknown, label: o.label })) : null

  // Number keys pick an option, like a well-made form on a Mac.
  useEffect(() => {
    if (!choices || disabled) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) || e.metaKey || e.ctrlKey || e.altKey) return
      const n = Number(e.key)
      if (n >= 1 && n <= Math.min(9, choices.length)) { e.preventDefault(); submit(choices[n - 1].value) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div ref={ref} className="rise-in rounded-3xl bg-white border border-warm-200 shadow-[0_1px_2px_rgba(10,22,40,0.04),0_8px_24px_-12px_rgba(10,22,40,0.12)] px-6 py-6 md:px-8 md:py-7">
      <div className="flex items-center gap-2 text-[12.5px] text-warm-500">
        <span>{SECTION_LABEL[q.section] || q.section}</span>
        {insight?.swingDays ? <><span aria-hidden>·</span><span>moves the finish up to <span className="font-semibold text-navy-950 tabular-nums">{insight.swingDays} days</span></span></> : null}
        {q.id.startsWith('ai.') && <><span aria-hidden>·</span><span className="inline-flex items-center gap-1"><Sparkles size={11} aria-hidden /> AI follow-up</span></>}
      </div>
      <h2 className="text-[21px] md:text-[23px] leading-[1.25] font-semibold text-navy-950 tracking-[-0.015em] mt-2">{q.prompt}</h2>

      <div className="mt-5">
        {choices && (
          <div className={`grid gap-2 ${choices.length > 5 ? 'sm:grid-cols-2' : ''}`} role="group" aria-label="Answers">
            {choices.map((o, i) => (
              <button key={String(o.value)} disabled={busy || disabled} onClick={() => submit(o.value)}
                className="pressable group flex items-center gap-3 w-full text-left rounded-2xl border border-warm-300 bg-warm-50 hover:border-navy-900 hover:bg-white px-4 py-3 disabled:opacity-50">
                {i < 9 && <kbd className="hidden md:flex w-6 h-6 items-center justify-center rounded-md border border-warm-300 text-[11.5px] text-warm-500 font-sans group-hover:border-navy-900 group-hover:text-navy-950">{i + 1}</kbd>}
                <span className="text-[15px] text-navy-950">{o.label}</span>
              </button>
            ))}
            {q.allowOther && q.kind === 'choice' && (
              other ? <TextAnswer kind="text" placeholder={q.otherPrompt || 'Type your answer'} busy={busy} disabled={disabled} onSubmit={v => submit(v)} autoFocus />
                : <button disabled={busy || disabled} onClick={() => setOther(true)} className="text-left text-[13.5px] text-accent-600 hover:underline px-1 py-1 w-fit">Something else…</button>
            )}
          </div>
        )}
        {q.kind === 'choice' && !choices && (
          <div className="flex flex-wrap gap-2">
            <select value={value} onChange={e => setValue(e.target.value)} aria-label={q.prompt} className="flex-1 min-w-[220px] rounded-xl border border-warm-300 bg-warm-50 px-3 py-2.5 text-[15px] text-navy-950">
              <option value="">Choose…</option>
              {q.options!.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button disabled={busy || disabled || !value} onClick={() => submit(value)} className="pressable rounded-xl bg-navy-950 text-white px-4 py-2.5 text-[14px] font-semibold disabled:opacity-40">Continue</button>
            {q.allowOther && <div className="w-full"><TextAnswer kind="text" placeholder={q.id === 'project.state' ? 'Not in the US? e.g. Toronto, Ontario, Canada' : q.otherPrompt || 'Or type your answer'} busy={busy} disabled={disabled} onSubmit={v => submit(v)} /></div>}
          </div>
        )}
        {(q.kind === 'number' || q.kind === 'date' || q.kind === 'text') && (
          <TextAnswer kind={q.kind} unit={q.unit} placeholder={q.unit || 'Your answer'} busy={busy} disabled={disabled} onSubmit={v => submit(q.kind === 'number' ? Number(v) : v)} />
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13.5px]">
        <button disabled={busy || disabled} onClick={() => onAnswer(q.id, withNote({ status: 'unknown' }))} className="text-warm-600 hover:text-navy-950 disabled:opacity-50">I don&apos;t know yet</button>
        {q.allowWithheld && <button disabled={busy || disabled} onClick={() => onAnswer(q.id, { status: 'withheld' })} className="inline-flex items-center gap-1 text-warm-600 hover:text-navy-950 disabled:opacity-50" title="Plan around it without sharing the detail"><Lock size={12} aria-hidden /> Can&apos;t share</button>}
        {busy && <Loader2 size={14} className="animate-spin text-warm-500" aria-label="Saving" />}
      </div>

      <div className="mt-4">
        <Disclosure title="Why this matters">
          <p className="text-[13.5px] text-warm-600">{fmtDates(q.why)}</p>
          {insight?.reason && <p className="text-[13px] text-warm-500 mt-2">{insight.reason}</p>}
          {q.fallback?.explanation && <p className="text-[13px] text-warm-500 mt-2">If you don&apos;t know: {fmtDates(q.fallback.explanation)}</p>}
          {q.groundedBy && q.groundedBy.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {q.groundedBy.map((s, i) => <span key={i} title={s.detail} className="text-[12px] text-warm-600 bg-warm-100 rounded-full px-2.5 py-0.5"><span className="font-medium">{SOURCE_LABEL[s.kind]}:</span> {s.label}</span>)}
            </div>
          )}
        </Disclosure>
        <Disclosure title="Add detail in your own words">
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={1000} aria-label="Detail for this answer"
            placeholder={q.section === 'permits' ? 'e.g. Issued for foundations only; superstructure still in review' : q.section === 'procurement' ? 'e.g. Needed, but the utility is designing a new substation' : 'e.g. Mostly yes, except the east wing'}
            className="w-full rounded-xl border border-warm-300 bg-warm-50 px-3 py-2 text-[14px] text-warm-700 placeholder:text-warm-400" />
          <p className="text-[12px] text-warm-500 mt-1">Saved with whichever answer you choose; it goes into the Basis of Schedule and flags the related activities.</p>
        </Disclosure>
      </div>
    </div>
  )
}

function TextAnswer({ kind, unit, placeholder, busy, disabled, onSubmit, autoFocus }: { kind: 'number' | 'date' | 'text'; unit?: string; placeholder: string; busy: boolean; disabled: boolean; onSubmit: (v: string) => void; autoFocus?: boolean }) {
  const [v, setV] = useState('')
  return (
    <form onSubmit={e => { e.preventDefault(); if (v.trim()) onSubmit(v.trim()) }} className="flex flex-wrap gap-2 items-center">
      <input autoFocus={autoFocus} type={kind === 'number' ? 'number' : kind === 'date' ? 'date' : 'text'} value={v} onChange={e => setV(e.target.value)} min={kind === 'number' ? 0 : undefined} max={unit === '%' ? 100 : undefined}
        placeholder={placeholder} aria-label={placeholder}
        className={`rounded-xl border border-warm-300 bg-warm-50 px-3 py-2.5 text-[15px] text-navy-950 placeholder:text-warm-400 ${kind === 'text' ? 'flex-1 min-w-[240px]' : 'w-48'}`} />
      {unit && kind === 'number' && <span className="text-[13px] text-warm-500">{unit}</span>}
      <button disabled={busy || disabled || !v.trim()} className="pressable rounded-xl bg-navy-950 text-white px-4 py-2.5 text-[14px] font-semibold disabled:opacity-40">Continue</button>
    </form>
  )
}

/* ─── Parallel items asked together ──────────────────── */

function shortName(q: Question): string {
  const m = /^(?:Is|Do you have the) (.+?)(?: in scope, and has it been ordered\?|\?)$/.exec(q.prompt)
  const s = m ? m[1] : q.prompt.replace(/^Does (.+) apply to this project\?$/, '$1')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function GroupCard({ group, questions, busy, disabled, onSave }: { group: { id: string; label: string; swingDays: number; reason: string }; questions: Question[]; busy: boolean; disabled: boolean; onSave: SmartInterviewProps['onAnswerMany'] }) {
  const [picked, setPicked] = useState<Record<string, string | boolean>>({})
  const count = Object.keys(picked).length
  const save = (rest: 'skip' | 'unknown') => {
    const out: Record<string, Partial<Answer>> = {}
    for (const q of questions) {
      if (q.id in picked) out[q.id] = { status: 'known', value: picked[q.id] as Answer['value'] }
      else if (rest === 'unknown') out[q.id] = { status: 'unknown' }
    }
    if (Object.keys(out).length) onSave(out)
  }
  return (
    <div className="rise-in rounded-3xl bg-white border border-warm-200 shadow-[0_1px_2px_rgba(10,22,40,0.04),0_8px_24px_-12px_rgba(10,22,40,0.12)] px-6 py-6 md:px-8 md:py-7">
      <div className="text-[12.5px] text-warm-500">{group.label} · together they move the finish up to <span className="font-semibold text-navy-950 tabular-nums">{group.swingDays} days</span></div>
      <h2 className="text-[21px] md:text-[23px] leading-[1.25] font-semibold text-navy-950 tracking-[-0.015em] mt-2">
        {group.id === 'procurement' ? 'Where does each of these stand?' : group.id === 'permits' ? 'Where is each approval?' : 'Do these apply?'}
      </h2>
      <p className="text-[13.5px] text-warm-600 mt-1.5">Answer the ones you know. Any you leave are planned with typical lead times and a buffer.</p>
      <ul className="mt-5 divide-y divide-warm-200 border-y border-warm-200">
        {questions.map(q => {
          const opts = q.kind === 'boolean' ? [{ value: true, label: 'Yes' }, { value: false, label: 'No' }] : (q.options || []).map(o => ({ value: o.value as string | boolean, label: SHORT[o.value] || o.label }))
          return (
            <li key={q.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <span className="flex-1 min-w-0 text-[14px] text-navy-950">{shortName(q)}</span>
              <div role="radiogroup" aria-label={shortName(q)} className="flex flex-wrap gap-1 rounded-full bg-warm-100 p-1 w-fit">
                {opts.map(o => {
                  const on = picked[q.id] === o.value
                  return (
                    <button key={String(o.value)} role="radio" aria-checked={on} disabled={busy || disabled}
                      onClick={() => setPicked(prev => { const n = { ...prev }; if (on) delete n[q.id]; else n[q.id] = o.value; return n })}
                      className={`pressable rounded-full px-3 py-1 text-[12.5px] ${on ? 'bg-navy-950 text-white shadow-sm' : 'text-warm-700 hover:text-navy-950'}`}>{o.label}</button>
                  )
                })}
              </div>
            </li>
          )
        })}
      </ul>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button disabled={busy || disabled || !count} onClick={() => save('skip')} className="pressable rounded-full bg-navy-950 text-white px-5 py-2.5 text-[14px] font-semibold disabled:opacity-40">
          {busy ? <Loader2 size={14} className="animate-spin inline mr-1.5" aria-hidden /> : null}Save {count || ''} answer{count === 1 ? '' : 's'}
        </button>
        <button disabled={busy || disabled} onClick={() => save('unknown')} className="text-[13.5px] text-warm-600 hover:text-navy-950">{count ? 'Save, and I don’t know the rest' : 'I don’t know any of these yet'}</button>
      </div>
      <div className="mt-4"><Disclosure title="Why these are asked together"><p className="text-[13.5px] text-warm-600">{group.reason}</p></Disclosure></div>
    </div>
  )
}

/* ─── Secondary lists ────────────────────────────────── */

function CompactQuestion({ q, reason, busy, disabled, onAnswer }: { q: Question; reason?: string; busy: boolean; disabled: boolean; onAnswer: SmartInterviewProps['onAnswer'] }) {
  const choices = q.kind === 'boolean' ? [{ value: true, label: 'Yes' }, { value: false, label: 'No' }] : q.kind === 'choice' && (q.options?.length || 0) <= 6 ? q.options!.map(o => ({ value: o.value as unknown, label: SHORT[o.value] || o.label })) : null
  return (
    <div className="rounded-2xl bg-white border border-warm-200 px-4 py-3.5">
      <div className="text-[14px] text-navy-950">{q.prompt}</div>
      {reason && <div className="text-[12px] text-warm-500 mt-0.5">{reason}</div>}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {choices ? choices.map(o => (
          <button key={String(o.value)} disabled={busy || disabled} onClick={() => onAnswer(q.id, { status: 'known', value: o.value as Answer['value'] })} className="pressable rounded-full border border-warm-300 bg-warm-50 hover:border-navy-900 px-3 py-1 text-[12.5px] text-navy-950 disabled:opacity-50">{o.label}</button>
        )) : <TextAnswer kind={q.kind === 'number' || q.kind === 'date' ? q.kind : 'text'} unit={q.unit} placeholder={q.unit || 'Your answer'} busy={busy} disabled={disabled} onSubmit={v => onAnswer(q.id, { status: 'known', value: q.kind === 'number' ? Number(v) : v })} />}
        <button disabled={busy || disabled} onClick={() => onAnswer(q.id, { status: 'unknown' })} className="text-[12.5px] text-warm-500 hover:text-navy-950 ml-1">Don&apos;t know</button>
      </div>
    </div>
  )
}

function AnsweredRow({ a, issues, disabled, onAnswer }: { a: AnsweredItem; issues: string[]; disabled: boolean; onAnswer: SmartInterviewProps['onAnswer'] }) {
  return (
    <li className="py-2.5 text-[13.5px]">
      <div className="flex items-start gap-3">
        <span className="flex-1 min-w-0 text-warm-600">{a.prompt}</span>
        <span className="text-navy-950 font-medium text-right flex items-center gap-1">{a.status === 'withheld' && <Lock size={11} aria-label="Withheld" />}{fmtDates(a.label)}</span>
        {!disabled && <button onClick={() => onAnswer(a.id, null)} aria-label={`Clear the answer to: ${a.prompt}`} title="Clear and ask again" className="text-warm-400 hover:text-status-at-risk mt-0.5"><X size={14} aria-hidden /></button>}
      </div>
      {a.note && <p className="text-[12.5px] text-warm-500 mt-1">“{a.note}”</p>}
      {issues.map((t, i) => <p key={i} className="text-[12.5px] text-status-at-risk mt-1">{fmtDates(t)}</p>)}
    </li>
  )
}

function AddNote({ busy, onAddNote }: { busy: boolean; onAddNote: (t: string) => Promise<boolean> }) {
  const [note, setNote] = useState('')
  return (
    <Disclosure title="Add something I didn’t ask">
      <p className="text-[13px] text-warm-500 mb-2">Owner requirements, site constraints, phasing: anything that affects the schedule. It goes into the Basis of Schedule.</p>
      <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={2000} aria-label="Information to add"
        placeholder="e.g. The utility will only energize the substation after the owner's commissioning agent signs off"
        className="w-full rounded-xl border border-warm-300 bg-warm-50 px-3 py-2 text-[14px] text-warm-700 placeholder:text-warm-400" />
      <button disabled={busy || !note.trim()} onClick={async () => { if (await onAddNote(note)) setNote('') }} className="pressable mt-2 rounded-full bg-navy-950 text-white px-4 py-2 text-[13.5px] font-semibold disabled:opacity-40">Add to brief</button>
    </Disclosure>
  )
}
