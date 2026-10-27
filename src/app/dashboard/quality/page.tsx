'use client'

import { useCallback, useEffect, useState } from 'react'
import type { CheckGuidance } from '@/lib/analysis/dcma-guidance'
import { Loader2, ShieldCheck, AlertTriangle, Info, XCircle, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react'
import { useApp } from '../layout'
import type { DataQuestion, DcmaReport, WorkCalendar } from '@/lib/planning/types'
import { fmtDate, fmtDates } from '@/lib/format'
import { FINDING_DISPOSITIONS, FINDING_LABELS, SUBMISSION_DISPOSITIONS, SUBMISSION_LABELS, type FindingDisposition, type ItemDisposition, type ReviewState, type SubmissionDisposition } from '@/lib/analysis/review'
import Link from 'next/link'
import { StandardsPanel } from './standards-panel'
import { NoraLogicPanel } from './nora-logic'
import { ImportExceptions } from '@/components/ImportExceptions'
import { Disclosure } from '@/components/Disclosure'
import { MoodTile, Robot, type RobotMood } from '@/components/Robot'
import type { ExceptionReport } from '@/lib/parsers/exceptions'

interface QuestionRow extends DataQuestion { response: { response: string; note: string | null } | null }
interface Quality {
  schedule: { id: string; name: string; version: string; sourceType: string; calendars: WorkCalendar[]; warnings: string[]; importExceptions?: ExceptionReport | null }
  dcma: DcmaReport
  dataQuestions: QuestionRow[]
  classification: { counts: Record<string, number>; classifiedPct: number }
  guidance: (CheckGuidance & { decision: { response: string; note: string | null } | null })[]
  brief: { summary: string } | null
  review: ReviewState
}

type Dispose = (itemId: string, disposition: FindingDisposition, justification: string) => Promise<string | null>

const SEV_ICON = { error: XCircle, warning: AlertTriangle, info: Info }
const SEV_STYLE = { error: 'border-status-at-risk', warning: 'border-status-attention', info: 'border-status-info' }
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function QualityPage() {
  const { selectedSchedule, setSelectedSchedule, schedules, can, openUpload } = useApp()
  const [data, setData] = useState<Quality | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [hideAnswered, setHideAnswered] = useState(true)
  const [tab, setTab] = useState<QualityTab>('checks')

  const load = useCallback(async () => {
    if (!selectedSchedule) return
    setLoading(true); setError('')
    const res = await fetch(`/api/schedules/${selectedSchedule.id}/quality`)
    const d = await res.json()
    setLoading(false)
    if (!res.ok) { setError(d.error || 'Could not analyze schedule.'); return }
    setData(d)
  }, [selectedSchedule])
  useEffect(() => { load() }, [load])

  const respond = async (q: QuestionRow, response: string) => {
    const note = response === 'intentional' ? prompt('Optional note (e.g. "weekend pour approved by owner"):') ?? '' : ''
    const res = await fetch(`/api/schedules/${data!.schedule.id}/quality`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questionId: q.id, response, note }) })
    if (res.ok) setData(d => d && ({ ...d, dataQuestions: d.dataQuestions.map(x => x.id === q.id ? { ...x, response: { response, note } } : x) }))
  }

  const decide = async (id: number, response: 'intentional' | 'will_fix', note: string) => {
    const res = await fetch(`/api/schedules/${data!.schedule.id}/quality`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questionId: `dcma:${id}`, response, note }) })
    if (res.ok) setData(d => d && ({ ...d, guidance: d.guidance.map(g => g.id === id ? { ...g, decision: { response, note } } : g) }))
  }
  // Reviewer dispositions (reviewer / admin / owner): per finding or question, and for the submission.
  const postReview = async (body: Record<string, unknown>): Promise<string | null> => {
    const res = await fetch(`/api/schedules/${data!.schedule.id}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) return d.error || 'Could not save the disposition.'
    setData(x => x && ({ ...x, review: d.review }))
    return null
  }
  const dispose: Dispose = (itemId, disposition, justification) => postReview({ itemId, disposition, justification })
  const [stickyTop, setStickyTop] = useState(0)
  useEffect(() => {
    const measure = () => setStickyTop(document.querySelector('header')?.getBoundingClientRect().height ?? 0)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  if (!selectedSchedule) {
    return <EmptyState schedules={schedules} onPick={setSelectedSchedule} canUpload={can('schedule.write')} onUpload={openUpload} />
  }
  if (tab === 'standards') {
    return (
      <div className="px-4 md:px-6 pt-4 pb-8 space-y-5">
        <div>
          <h1 className="font-display text-[22px] md:text-[26px] text-navy-950 leading-tight">Schedule quality</h1>
          <p className="text-[12.5px] text-warm-500 truncate">{selectedSchedule.name}</p>
          <QualityTabs tab={tab} onChange={setTab} />
        </div>
        <div role="tabpanel" id="quality-panel-standards" aria-labelledby="quality-tab-standards">
          <StandardsPanel key={selectedSchedule.id} endpoint={`/api/schedules/${encodeURIComponent(selectedSchedule.id)}/standards`} canRecord={can('schedule.write')} />
        </div>
      </div>
    )
  }
  if (loading || !data) {
    return (
      <div className="px-4 md:px-6 py-8 max-w-5xl">
        <MoodTile mood={error ? 'worried' : 'working'} className="flex items-center gap-3">
          <Robot mood={error ? 'worried' : 'working'} size={48} />
          <p role={error ? 'alert' : undefined} className="text-[14px] text-warm-700 flex items-center gap-2">{error || <><Loader2 size={14} className="animate-spin" aria-hidden /> Checking logic, calendars and dates…</>}</p>
        </MoodTile>
      </div>
    )
  }

  const open = data.dataQuestions.filter(q => !q.response)
  const shown = hideAnswered ? open : data.dataQuestions
  const resultStyle = (r: string) => r === 'pass' ? 'text-status-on-track' : r === 'fail' ? 'text-status-at-risk' : r === 'warn' ? 'text-status-attention' : 'text-warm-400'

  const failing = data.dcma.checks.filter(c => c.result === 'fail').length
  const reviewer = can('plan.review') && data.schedule.sourceType !== 'generated'
  const review = data.review ?? { items: [], submission: null }
  const dispositionOf = (id: string) => review.items.find(x => x.itemId === id) ?? null
  const resultOf = (id: number) => data.dcma.checks.find(c => c.id === id)?.result
  // Failing checks first, then warnings; within each, the ones still waiting for a decision first.
  const guidance = [...data.guidance].sort((a, b) =>
    (resultOf(a.id) === 'fail' ? 0 : 1) - (resultOf(b.id) === 'fail' ? 0 : 1) || Number(!!a.decision) - Number(!!b.decision) || a.id - b.id)
  const flagged = data.dcma.checks.filter(c => c.result === 'fail' || c.result === 'warn')
    .sort((a, b) => (a.result === 'fail' ? 0 : 1) - (b.result === 'fail' ? 0 : 1) || a.id - b.id)
  const clean = data.dcma.checks.filter(c => c.result !== 'fail' && c.result !== 'warn')
  const grade = gradeOf(data.dcma, open.length)
  const importNotes = data.schedule.warnings.length + (data.schedule.importExceptions ? 1 : 0)
  return (
    <div id="quality-panel-checks" className="px-4 md:px-6 pb-8">
      {/* Frozen header: the schedule and the views stay visible while scrolling */}
      <div style={{ top: stickyTop }} className="sticky z-30 -mx-4 md:-mx-6 px-4 md:px-6 pt-4 pb-3 bg-warm-50/95 backdrop-blur border-b border-warm-200">
        <div className="min-w-0">
          <h1 className="font-display text-[22px] md:text-[26px] text-navy-950 leading-tight">Schedule quality</h1>
          <p className="text-[12.5px] text-warm-500 truncate">{data.schedule.name} · {data.schedule.version}</p>
          <QualityTabs tab={tab} onChange={setTab} />
        </div>
      </div>

      <div className="max-w-5xl space-y-6 mt-5">
        {/* One sentence sums up the grade in one sentence; the key numbers sit underneath */}
        <MoodTile mood={grade.mood} as="section" className="space-y-3">
          <div className="flex items-start gap-3.5">
            <Robot mood={grade.mood} size={64} className="flex-shrink-0 -mt-1" />
            <div className="min-w-0">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-warm-600">How this schedule looks</h2>
              <p className="text-[16px] md:text-[17px] font-medium text-navy-950 leading-snug mt-0.5">{grade.title}</p>
              <p className="text-[13px] text-warm-600 mt-0.5">{grade.sub}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Card label="DCMA 14-point" value={`${data.dcma.passed}/${data.dcma.applicable}`} sub={failing ? `${failing} to fix — see below` : 'all applicable checks pass'} />
            <Card label="Questions about the data" value={String(open.length)} sub={`${data.dataQuestions.length - open.length} answered`} />
            <Card label="Calendars" value={String(data.schedule.calendars.length)} sub="imported and normalized" />
            <Card label="Activities understood" value={`${data.classification.classifiedPct}%`} sub="mapped to standard work categories" />
          </div>
        </MoodTile>

        {data.brief && (
          <div className="bg-warm-100 border border-warm-200 rounded-lg p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-500 mb-1">About this project</div>
            <p className="text-[13.5px] text-warm-700">{data.brief.summary}</p>
          </div>
        )}

        <SubmissionPanel review={review} reviewer={reviewer} onSave={(disposition, comments) => postReview({ submission: disposition, comments })} />

        {guidance.length > 0 && (
          <section aria-labelledby="what-to-fix-h">
            <h2 id="what-to-fix-h" className="text-[15px] font-semibold text-navy-950">What to fix <span className="font-normal text-warm-600">· {guidance.filter(g => !g.decision).length} of {guidance.length} open</span></h2>
            <p className="text-[12.5px] text-warm-600 mt-0.5 mb-2.5">Failing checks come first. Fix in P6 / MS Project and re-upload, or edit durations, logic and constraints in RunF9 (with a reason) from the schedule dashboard.</p>
            <div className="space-y-3">
              {guidance.map((g, i) => <QualityGuide key={g.id} startOpen={i === guidance.findIndex(x => !x.decision)} g={g} check={data.dcma.checks.find(c => c.id === g.id)!} onDecide={decide} disposition={dispositionOf(`dcma:${g.id}`)} reviewer={reviewer} onDispose={dispose} />)}
            </div>
          </section>
        )}

        <NoraLogicPanel key={data.schedule.id} scheduleId={data.schedule.id} canEdit={can('schedule.write')} />

        <section aria-labelledby="data-questions-h" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="data-questions-h" className="text-[15px] font-semibold text-navy-950">RunF9&apos;s questions about this file <span className="font-normal text-warm-600">· {open.length} open</span></h2>
            <label className="text-[12px] text-warm-600 flex items-center gap-1.5"><input type="checkbox" checked={hideAnswered} onChange={e => setHideAnswered(e.target.checked)} /> Hide answered</label>
          </div>
          {shown.length === 0 && <div className="bg-warm-100 border border-warm-200 rounded-lg p-5 text-[13.5px] text-warm-600"><CheckCircle2 size={15} className="inline mr-1.5 text-status-on-track" />No open questions about the data.</div>}
          {shown.map(q => {
            const Icon = SEV_ICON[q.severity]
            return (
              <div key={q.id} className={`bg-warm-100 border border-warm-200 border-l-2 ${SEV_STYLE[q.severity]} rounded-lg p-4`}>
                <div className="flex gap-2">
                  <Icon size={15} className="flex-shrink-0 mt-0.5 text-warm-500" />
                  <div className="flex-1">
                    <div className="text-[13.5px] text-navy-950">{fmtDates(q.question)}</div>
                    <div className="text-[12px] text-warm-500 mt-1">{fmtDates(q.detail)}</div>
                    {q.response ? (
                      <div className="text-[12px] text-status-on-track mt-2 font-medium">Answered: {q.response.response.replace(/_/g, ' ')}{q.response.note ? ` — ${q.response.note}` : ''}</div>
                    ) : (
                      <div className="flex flex-wrap gap-2 mt-2.5">
                        <button onClick={() => respond(q, 'intentional')} className="px-2.5 py-1 rounded-md border border-warm-300 bg-warm-50 hover:border-navy-900 text-[12px] text-navy-950 transition-colors">Yes, intentional</button>
                        <button onClick={() => respond(q, 'will_fix')} className="px-2.5 py-1 rounded-md border border-warm-300 bg-warm-50 hover:border-navy-900 text-[12px] text-navy-950 transition-colors">No — will fix in source</button>
                        <button onClick={() => respond(q, 'not_an_issue')} className="px-2.5 py-1 rounded-md border border-warm-300 bg-warm-50 hover:border-navy-900 text-[12px] text-navy-950 transition-colors">Not an issue</button>
                      </div>
                    )}
                    <ReviewControl itemId={q.id} label={q.question} disposition={dispositionOf(q.id)} reviewer={reviewer} onDispose={dispose} />
                  </div>
                </div>
              </div>
            )
          })}
        </section>

        <section aria-labelledby="dcma-h" className="bg-warm-100 border border-warm-200 rounded-lg p-5">
          <h2 id="dcma-h" className="text-[11px] font-semibold uppercase tracking-wider text-warm-500 mb-2">DCMA 14-point</h2>
          {flagged.length > 0 ? (
            <ul className="divide-y divide-warm-200">
              {flagged.map(c => (
                <li key={c.id} className="py-2">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                    <span className={`font-semibold uppercase text-[11px] ${resultStyle(c.result)}`}>{c.result}</span>
                    <span className="text-warm-500 tabular-nums">#{c.id}</span>
                    <span className="text-navy-950 font-medium">{c.name}</span>
                    <span className="text-warm-600 tabular-nums">{c.metric} <span className="text-warm-500">(target {c.threshold})</span></span>
                  </div>
                  <p className="text-[12.5px] text-warm-700 mt-0.5">{c.explanation}{c.offenders.length ? <span className="text-warm-500"> e.g. <span className="font-mono">{c.offenders.slice(0, 6).join(', ')}</span></span> : null}</p>
                </li>
              ))}
            </ul>
          ) : <p className="text-[13px] text-warm-700"><CheckCircle2 size={14} className="inline mr-1.5 -mt-0.5 text-status-on-track" />Every applicable check passes.</p>}
          {clean.length > 0 && (
            <div className="mt-2">
              <Disclosure title={`${clean.length} check${clean.length === 1 ? '' : 's'} pass or do not apply`} meta={`${data.dcma.passed} pass`}>
                <table className="w-full text-[12.5px]">
                  <tbody>
                    {clean.map(c => (
                      <tr key={c.id} className="border-b border-warm-200 last:border-0" title={`${c.explanation}${c.offenders.length ? ' e.g. ' + c.offenders.slice(0, 6).join(', ') : ''}`}>
                        <td className="py-1.5 pr-2 text-warm-500 tabular-nums">{c.id}</td>
                        <td className="py-1.5 pr-2 text-navy-950">{c.name}</td>
                        <td className="py-1.5 pr-2 text-warm-600 tabular-nums">{c.metric}</td>
                        <td className={`py-1.5 font-semibold uppercase text-[11px] ${resultStyle(c.result)}`}>{c.result}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Disclosure>
            </div>
          )}
        </section>

        <Disclosure tone="card" title="Calendars — as labeled vs. as understood" meta={`${data.schedule.calendars.length} calendar${data.schedule.calendars.length === 1 ? '' : 's'}${importNotes ? ` · ${importNotes} import note${importNotes === 1 ? '' : 's'}` : ''}`}>
          {data.schedule.calendars.length === 0 && <p className="text-[12.5px] text-warm-500">This file has no calendar data{data.schedule.sourceType === 'pdf' ? ' (PDF)' : ''}.</p>}
          <ul className="space-y-2">
            {data.schedule.calendars.map(c => (
              <li key={c.id} className="text-[12.5px]">
                <div className="text-navy-950 font-medium">“{c.sourceName || c.name}”</div>
                <div className="text-warm-500">{c.canonical || `${c.workDays.map(d => DAYS[d]).join(', ')} × ${c.hoursPerDay}h`} · {c.holidays.length} holidays</div>
              </li>
            ))}
          </ul>
          {data.schedule.warnings.length > 0 && (
            <div className="mt-3 pt-3 border-t border-warm-200 space-y-1">
              {data.schedule.warnings.slice(0, 8).map((w, i) => <p key={i} className="text-[12px] text-warm-500">· {w}</p>)}
            </div>
          )}
          {data.schedule.importExceptions && (
            <div className="mt-3 pt-3 border-t border-warm-200">
              <ImportExceptions report={data.schedule.importExceptions} />
            </div>
          )}
        </Disclosure>
      </div>
    </div>
  )
}

/** A one-sentence read of the DCMA grade: all good, a few things to fix, or needs work. */
function gradeOf(dcma: DcmaReport, openQuestions: number): { mood: RobotMood; title: string; sub: string } {
  const fail = dcma.checks.filter(c => c.result === 'fail').length
  const warn = dcma.checks.filter(c => c.result === 'warn').length
  const questions = openQuestions ? `${openQuestions} question${openQuestions === 1 ? '' : 's'} about the data ${openQuestions === 1 ? 'is' : 'are'} waiting for you.` : 'No open questions about the data.'
  if (fail === 0 && warn === 0) return { mood: 'done', title: `In good shape: all ${dcma.applicable} applicable DCMA checks pass.`, sub: questions }
  if (fail <= 3 && dcma.passed >= 0.7 * dcma.applicable) {
    const n = fail + warn
    return { mood: 'waiting', title: `A few things to fix: ${n} of ${dcma.applicable} checks need${n === 1 ? 's' : ''} attention.`, sub: `Start with the first item under “What to fix”. ${questions}` }
  }
  return { mood: 'worried', title: `This schedule needs work: ${fail} of ${dcma.applicable} checks fail.`, sub: `Start with the first item under “What to fix”; each says what it means and how to fix it. ${questions}` }
}

/** No schedule yet: an idle status and one clear next step. */
function EmptyState<S extends { id: string; name: string }>({ schedules, onPick, canUpload, onUpload }: { schedules: S[]; onPick: (s: S) => void; canUpload: boolean; onUpload: () => void }) {
  const latest = schedules[0]
  return (
    <div className="px-4 md:px-6 py-12 flex justify-center">
      <MoodTile mood="idle" as="section" className="max-w-md w-full text-center px-6 py-8">
        <Robot mood="idle" size={80} className="mx-auto" />
        <h1 className="font-display text-[22px] text-navy-950 mt-3">Schedule quality</h1>
        <p className="text-[14px] text-warm-600 mt-1"><ShieldCheck size={15} className="inline mr-1 -mt-0.5 text-warm-500" aria-hidden />Upload or select a schedule to run quality checks.</p>
        <p className="text-[12.5px] text-warm-600 mt-1">RunF9 checks the logic, calendars and dates, and points out the few things worth fixing first.</p>
        <div className="mt-5">
          {latest ? (
            <button type="button" onClick={() => onPick(latest)} className="px-4 py-2 rounded-md bg-navy-900 text-white text-[13.5px] font-medium">Check {latest.name.length > 40 ? `${latest.name.slice(0, 40)}…` : latest.name}</button>
          ) : canUpload ? (
            <button type="button" onClick={onUpload} className="px-4 py-2 rounded-md bg-navy-900 text-white text-[13.5px] font-medium">Upload a schedule</button>
          ) : (
            <p className="text-[12.5px] text-warm-600">Ask a scheduler on your team to upload one.</p>
          )}
        </div>
      </MoodTile>
    </div>
  )
}

function QualityGuide({ g, check, onDecide, disposition, reviewer, onDispose, startOpen }: { startOpen: boolean; g: Quality['guidance'][number]; check: DcmaReport['checks'][number]; onDecide: (id: number, r: 'intentional' | 'will_fix', note: string) => void; disposition: ItemDisposition | null; reviewer: boolean; onDispose: Dispose }) {
  // Only the first open item starts expanded, so the list reads as a short to-do list.
  const [open, setOpen] = useState(startOpen)
  const [note, setNote] = useState('')
  return (
    <div className={`border rounded-lg ${g.decision ? 'bg-warm-50 border-warm-200' : 'bg-warm-100 border-status-attention/50'}`}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 px-5 py-3 text-left">
        <span className={`text-[10.5px] font-bold uppercase ${check.result === 'fail' ? 'text-status-at-risk' : 'text-status-attention'}`}>#{g.id} {check.result}</span>
        <span className="text-[13.5px] font-semibold text-navy-950 flex-1">{check.name} <span className="font-normal text-warm-500">— {check.metric} (target {check.threshold})</span></span>
        {g.decision && <span className="text-[11px] font-semibold uppercase text-status-on-track">{g.decision.response === 'intentional' ? 'Accepted' : 'To fix'}</span>}
        {disposition && <span className="text-[11px] font-semibold uppercase text-warm-600">Reviewer: {FINDING_LABELS[disposition.disposition]}</span>}
        {open ? <ChevronDown size={14} className="text-warm-400" /> : <ChevronRight size={14} className="text-warm-400" />}
      </button>
      {open && (
        <div className="px-5 pb-4 space-y-2.5">
          <p className="text-[13px] text-warm-700"><span className="font-semibold text-navy-950">What it means: </span>{g.meaning}</p>
          {g.whyItMatters && <p className="text-[13px] text-warm-700"><span className="font-semibold text-navy-950">Why it matters: </span>{g.whyItMatters}</p>}
          {g.steps.length > 0 && <ol className="list-decimal ml-5 text-[13px] text-warm-700 space-y-0.5">{g.steps.map((st, i) => <li key={i}>{st}</li>)}</ol>}
          {g.actions.some(a => a.kind === 'link') && (
            <div className="flex flex-wrap gap-2">
              {g.actions.map((a, i) => a.kind === 'link' ? <Link key={i} href={a.href} className="px-3 py-1.5 rounded-md bg-navy-900 text-white text-[12.5px] font-medium">{a.label}</Link> : null)}
            </div>
          )}
          {check.offenders.length > 0 && <p className="text-[12px] text-warm-500">Activities to look at: <span className="font-mono">{check.offenders.slice(0, 20).join(', ')}</span>{check.offenders.length > 20 ? ` and ${check.offenders.length - 20} more` : ''}</p>}
          {g.decision ? (
            <p className="text-[12.5px] text-warm-600 border-l-2 border-status-on-track pl-2">{g.decision.response === 'intentional' ? 'Accepted' : 'Will fix in the source schedule'}{g.decision.note ? ` — “${g.decision.note}”` : ''}</p>
          ) : (
            <div className="flex flex-wrap gap-2 items-center">
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="Justification, if accepting as-is" className="flex-1 min-w-[220px] bg-warm-50 border border-warm-300 rounded-md px-2.5 py-1.5 text-[13px]" />
              <button disabled={note.trim().length < 10} onClick={() => onDecide(g.id, 'intentional', note)} className="px-3 py-1.5 rounded-md border border-warm-300 bg-warm-50 text-[12.5px] text-navy-950 disabled:opacity-40">Accept with justification</button>
              <button onClick={() => onDecide(g.id, 'will_fix', note)} className="px-3 py-1.5 rounded-md bg-navy-900 text-white text-[12.5px] font-medium">I&apos;ll fix it in P6 / MSP</button>
            </div>
          )}
          <ReviewControl itemId={`dcma:${g.id}`} label={`DCMA #${g.id} ${check.name}`} disposition={disposition} reviewer={reviewer} onDispose={onDispose} />
        </div>
      )}
    </div>
  )
}

/** A reviewer's disposition of one finding or data question: shown to everyone, editable by reviewers. */
function ReviewControl({ itemId, label, disposition, reviewer, onDispose }: { itemId: string; label: string; disposition: ItemDisposition | null; reviewer: boolean; onDispose: Dispose }) {
  const [choice, setChoice] = useState<FindingDisposition>(disposition?.disposition ?? 'accepted')
  const [text, setText] = useState(disposition?.justification ?? '')
  const [editing, setEditing] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  if (!reviewer && !disposition) return null
  const save = async () => {
    setBusy(true); setErr('')
    const e = await onDispose(itemId, choice, text)
    setBusy(false)
    if (e) setErr(e); else setEditing(false)
  }
  return (
    <div className="mt-2.5 pt-2.5 border-t border-warm-200">
      {disposition && !editing ? (
        <p className="text-[12.5px] text-warm-700">
          <span className="font-semibold text-navy-950">Reviewer disposition: {FINDING_LABELS[disposition.disposition]}</span>
          {disposition.justification ? ` — “${disposition.justification}”` : ''}
          <span className="text-warm-500"> · {disposition.reviewer ?? 'reviewer'}, {fmtDate(disposition.createdAt)}</span>
          {reviewer && <button type="button" onClick={() => setEditing(true)} className="ml-2 underline text-navy-950">Change</button>}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-warm-500">Reviewer</span>
          <select aria-label={`Disposition for ${label}`} value={choice} onChange={e => setChoice(e.target.value as FindingDisposition)} className="bg-warm-50 border border-warm-300 rounded-md px-2 py-1 text-[12.5px] text-navy-950">
            {FINDING_DISPOSITIONS.map(d => <option key={d} value={d}>{FINDING_LABELS[d]}</option>)}
          </select>
          <input aria-label={`Justification for ${label}`} value={text} onChange={e => setText(e.target.value)} placeholder={choice === 'exception' ? 'Justification (required)' : 'Comment (optional)'} className="flex-1 min-w-[200px] bg-warm-50 border border-warm-300 rounded-md px-2.5 py-1 text-[12.5px]" />
          <button type="button" disabled={busy} onClick={save} className="px-3 py-1 rounded-md bg-navy-900 text-white text-[12.5px] font-medium disabled:opacity-60">Save</button>
          {err && <span role="alert" className="text-[12px] text-status-at-risk w-full">{err}</span>}
        </div>
      )}
    </div>
  )
}

/** The overall disposition of the submission (approved / approved as noted / revise and resubmit). */
function SubmissionPanel({ review, reviewer, onSave }: { review: ReviewState; reviewer: boolean; onSave: (d: SubmissionDisposition, comments: string) => Promise<string | null> }) {
  const s = review.submission
  const [choice, setChoice] = useState<SubmissionDisposition>(s?.disposition ?? 'approved')
  const [comments, setComments] = useState(s?.comments ?? '')
  const [editing, setEditing] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  if (!reviewer && !s) return null
  const counts = FINDING_DISPOSITIONS.map(d => `${review.items.filter(x => x.disposition === d).length} ${FINDING_LABELS[d].toLowerCase()}`).join(' · ')
  const save = async () => {
    setBusy(true); setErr('')
    const e = await onSave(choice, comments)
    setBusy(false)
    if (e) setErr(e); else setEditing(false)
  }
  return (
    <section aria-labelledby="submission-h" className="bg-warm-100 border border-warm-200 rounded-lg p-5">
      <h2 id="submission-h" className="text-[11px] font-semibold uppercase tracking-wider text-warm-500 mb-2">Submission review</h2>
      {s && !editing ? (
        <div className="text-[13.5px] text-warm-700 space-y-1">
          <p><span className="font-semibold text-navy-950">{SUBMISSION_LABELS[s.disposition]}</span> <span className="text-warm-500">· {s.reviewer ?? 'reviewer'}, {fmtDate(s.createdAt)}</span>
            {reviewer && <button type="button" onClick={() => setEditing(true)} className="ml-2 underline text-navy-950 text-[12.5px]">Change</button>}</p>
          {s.comments && <p className="whitespace-pre-wrap">{s.comments}</p>}
          <p className="text-[12px] text-warm-500">Findings and questions dispositioned: {counts}</p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2 items-center">
            <select aria-label="Submission disposition" value={choice} onChange={e => setChoice(e.target.value as SubmissionDisposition)} className="bg-warm-50 border border-warm-300 rounded-md px-2 py-1.5 text-[13px] text-navy-950">
              {SUBMISSION_DISPOSITIONS.map(d => <option key={d} value={d}>{SUBMISSION_LABELS[d]}</option>)}
            </select>
            <span className="text-[12px] text-warm-500">{counts}</span>
          </div>
          <textarea aria-label="Review comments" value={comments} onChange={e => setComments(e.target.value)} rows={3} placeholder={choice === 'approved' ? 'Comments (optional)' : 'Comments (required): what to note or revise'} className="w-full bg-warm-50 border border-warm-300 rounded-md px-2.5 py-1.5 text-[13px]" />
          <div className="flex items-center gap-2">
            <button type="button" disabled={busy} onClick={save} className="px-3 py-1.5 rounded-md bg-navy-900 text-white text-[12.5px] font-medium disabled:opacity-60">Record disposition</button>
            {editing && <button type="button" onClick={() => setEditing(false)} className="px-3 py-1.5 rounded-md border border-warm-300 text-[12.5px] text-navy-950">Cancel</button>}
            {err && <span role="alert" className="text-[12px] text-status-at-risk">{err}</span>}
          </div>
        </div>
      )}
    </section>
  )
}

type QualityTab = 'checks' | 'standards'
const QUALITY_TABS: { id: QualityTab; label: string }[] = [{ id: 'checks', label: 'Checks & data questions' }, { id: 'standards', label: 'Standards' }]

/** Tabs between the DCMA / data-question view and the standards (framework) view; arrow keys move between them. */
function QualityTabs({ tab, onChange }: { tab: QualityTab; onChange: (t: QualityTab) => void }) {
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const i = QUALITY_TABS.findIndex(t => t.id === tab)
    const next = QUALITY_TABS[(i + (e.key === 'ArrowRight' ? 1 : QUALITY_TABS.length - 1)) % QUALITY_TABS.length]
    onChange(next.id)
    requestAnimationFrame(() => document.getElementById(`quality-tab-${next.id}`)?.focus())
  }
  return (
    <div role="tablist" aria-label="Quality views" className="flex gap-1 mt-2" onKeyDown={onKey}>
      {QUALITY_TABS.map(t => (
        <button key={t.id} id={`quality-tab-${t.id}`} role="tab" type="button" aria-selected={tab === t.id} aria-controls={tab === t.id ? `quality-panel-${t.id}` : undefined} tabIndex={tab === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          className={`px-3 py-1.5 rounded-md text-[12.5px] font-medium border ${tab === t.id ? 'bg-navy-900 text-white border-navy-900' : 'bg-warm-50 text-navy-950 border-warm-300 hover:border-navy-900'}`}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

function Card({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-warm-100 border border-warm-200 rounded-lg p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400">{label}</div>
      <div className="text-[20px] font-semibold text-navy-950 tabular-nums mt-1">{value}</div>
      <div className="text-[11px] text-warm-400 mt-0.5">{sub}</div>
    </div>
  )
}
