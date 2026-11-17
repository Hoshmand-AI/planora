'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CheckGuidance } from '@/lib/analysis/dcma-guidance'
import { Loader2, ShieldCheck, AlertTriangle, Info, XCircle, CheckCircle2, ChevronRight } from 'lucide-react'
import { askText } from '@/components/AskText'
import { useApp } from '../layout'
import type { DataQuestion, DcmaReport, WorkCalendar } from '@/lib/planning/types'
import { fmtDay, fmtDates } from '@/lib/format'
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
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function QualityPage() {
  const { selectedSchedule, setSelectedSchedule, schedules, can, openUpload } = useApp()
  const [data, setData] = useState<Quality | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [hideAnswered, setHideAnswered] = useState(true)
  const [tab, setTab] = useState<QualityTab>('checks')
  const [selected, setSelected] = useState<number | null>(null)
  // The checks grid opens on the ones that need work; the passing and not-applicable ones are one click away.
  const [allChecks, setAllChecks] = useState(false)

  const loadingFor = useRef<string | null>(null)
  const saving = useRef(false)
  const load = useCallback(async () => {
    if (!selectedSchedule) return
    setLoading(true); setError('')
    const id = selectedSchedule.id
    loadingFor.current = id
    // Never keep one project's report on screen (or post answers to it) after another project is opened.
    setData(d => (d && d.schedule.id === id ? d : null))
    try {
      const res = await fetch(`/api/schedules/${id}/quality`)
      const d = await res.json().catch(() => ({}))
      if (loadingFor.current !== id) return
      setLoading(false)
      if (!res.ok) { setError(d.error || 'Could not analyze schedule.'); return }
      setData(d)
    } catch { if (loadingFor.current === id) { setLoading(false); setError('Network error. Check your connection and try again.') } }
  }, [selectedSchedule])
  useEffect(() => { load() }, [load])

  const respond = async (q: QuestionRow, response: string) => {
    let note = ''
    if (response === 'intentional') {
      const answer = await askText({ title: 'Marked as intentional', label: 'Note (optional)', placeholder: 'e.g. weekend pour approved by owner' })
      if (answer === null) return
      note = answer
    }
    // One save at a time: a double click must not send the answer twice.
    if (saving.current) return
    saving.current = true
    try {
      const res = await fetch(`/api/schedules/${data!.schedule.id}/quality`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questionId: q.id, response, note }) })
      if (res.ok) setData(d => d && ({ ...d, dataQuestions: d.dataQuestions.map(x => x.id === q.id ? { ...x, response: { response, note } } : x) }))
      else setError((await res.json().catch(() => ({}))).error || 'Your answer was not saved.')
    } catch { setError('Network error. Your answer was not saved.') } finally { saving.current = false }
  }

  const decide = async (id: number, response: 'intentional' | 'will_fix', note: string) => {
    if (saving.current) return
    saving.current = true
    try {
      const res = await fetch(`/api/schedules/${data!.schedule.id}/quality`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questionId: `dcma:${id}`, response, note }) })
      if (res.ok) setData(d => d && ({ ...d, guidance: d.guidance.map(g => g.id === id ? { ...g, decision: { response, note } } : g) }))
      else setError((await res.json().catch(() => ({}))).error || 'Your decision was not saved.')
    } catch { setError('Network error. Your decision was not saved.') } finally { saving.current = false }
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

  if (!selectedSchedule) {
    return <EmptyState schedules={schedules} onPick={setSelectedSchedule} canUpload={can('schedule.write')} onUpload={openUpload} />
  }
  if (tab === 'standards') {
    return (
      <div className="max-w-6xl mx-auto px-5 md:px-8 pt-4 pb-8 space-y-5">
        <QualityTabs tab={tab} onChange={setTab} />
        <div role="tabpanel" id="quality-panel-standards" aria-labelledby="quality-tab-standards">
          <StandardsPanel key={selectedSchedule.id} endpoint={`/api/schedules/${encodeURIComponent(selectedSchedule.id)}/standards`} canRecord={can('schedule.write')} />
        </div>
      </div>
    )
  }
  if (loading || !data) {
    return (
      <div className="max-w-6xl mx-auto px-5 md:px-8 py-8">
        <MoodTile mood={error ? 'worried' : 'working'} className="flex items-center gap-3">
          <Robot mood={error ? 'worried' : 'working'} size={48} />
          <p role={error ? 'alert' : undefined} className="text-[14px] text-warm-700 flex items-center gap-2">{error || <><Loader2 size={14} className="animate-spin" aria-hidden /> Checking logic, calendars and dates…</>}</p>
        </MoodTile>
      </div>
    )
  }

  const open = data.dataQuestions.filter(q => !q.response)
  const shown = hideAnswered ? open : data.dataQuestions

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
  const selectedCheck = selected == null ? null : data.dcma.checks.find(c => c.id === selected) ?? null
  const openCheck = (id: number) => {
    setSelected(id)
    requestAnimationFrame(() => document.getElementById('dcma-detail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
  }
  const grade = gradeOf(data.dcma, open.length)
  const importNotes = data.schedule.warnings.length + (data.schedule.importExceptions ? 1 : 0)
  return (
    <div className="max-w-6xl mx-auto px-5 md:px-8 pb-8">
      <div className="pt-4"><QualityTabs tab={tab} onChange={setTab} /></div>
      {error && <p role="alert" className="mt-3 rounded-md border border-status-at-risk bg-status-at-risk-bg px-3 py-2 text-[13px] text-status-at-risk">{error}</p>}

      <div className="space-y-6 mt-5">
        {/* Three short tabs, not nine stacked sections: the checks, what to fix, then the review and the data questions. */}
        <div role="tabpanel" id="quality-panel-checks" aria-labelledby="quality-tab-checks" hidden={tab !== 'checks'} className="space-y-6">
        {/* The score beside the checks to fix. Each fact is said once: the checks that need work are listed here, not again as cards below. */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-4 items-start">
          <section aria-label="Quality score" className="rise-in bg-white border border-warm-200 rounded-[14px] p-6">
            <div className="flex max-sm:flex-col items-center gap-5">
              <ScoreRing passed={data.dcma.passed} applicable={data.dcma.applicable} />
              <div className="min-w-0">
                <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-ink leading-snug">{grade.short}</h2>
                {/* Each outcome counted on its own: a check that could not run is never shown as passed */}
              <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                {([['pass', 'Pass', 'text-status-on-track'], ['fail', 'Fail', 'text-status-at-risk'], ['warn', 'Warning', 'text-status-attention'], ['n/a', 'Not applicable', 'text-warm-600']] as const)
                  .map(([r, label, cls]) => ({ label, cls, n: data.dcma.checks.filter(c => c.result === r).length }))
                  .filter(x => x.n > 0 || x.label !== 'Warning')
                  .map(x => (
                    <div key={x.label} className="flex items-baseline gap-1.5">
                      <dt className="text-warm-600">{x.label}</dt>
                      <dd className={`order-first text-[14px] font-semibold tabular-nums ${x.cls}`}>{x.n}</dd>
                    </div>
                  ))}
              </dl>
              </div>
            </div>
            {/* The two things still waiting on a person, each a way into its view. */}
            <ul className="mt-5 border-t border-warm-200 divide-y divide-warm-200 text-[13px]">
              <li><button type="button" onClick={() => setTab('review')} className="group w-full flex items-center gap-3 py-2.5 text-left"><span className="flex-1 text-ink group-hover:underline">Questions about the data</span><span className="tabular-nums text-warm-600">{open.length ? `${open.length} open` : 'none open'}</span><ChevronRight size={14} aria-hidden="true" className="text-warm-600" /></button></li>
              {guidance.length > 0 && <li><button type="button" onClick={() => setTab('fix')} className="group w-full flex items-center gap-3 py-2.5 text-left"><span className="flex-1 text-ink group-hover:underline">Findings decided</span><span className="tabular-nums text-warm-600">{guidance.filter(g => g.decision).length} of {guidance.length}</span><ChevronRight size={14} aria-hidden="true" className="text-warm-600" /></button></li>}
            </ul>
          </section>
          <section aria-labelledby="fix-first-h" className="rise-in bg-white border border-warm-200 rounded-[14px] p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="fix-first-h" className="text-[16px] font-semibold text-ink">{flagged.length ? `Checks to fix (${flagged.length})` : 'Checks to fix'}</h2>
              {guidance.length > 0 && <button type="button" onClick={() => setTab('fix')} className="pressable rounded-lg bg-accent-600 hover:bg-accent-700 text-white px-4 h-9 text-[13px] font-semibold">See how to fix {guidance.length === 1 ? 'it' : `all ${guidance.length}`}</button>}
            </div>
            {flagged.length === 0 ? (
              <p className="text-[14px] text-warm-600 mt-2"><CheckCircle2 size={15} className="inline mr-1.5 -mt-0.5 text-status-on-track" aria-hidden />Nothing to fix: every applicable check passes.</p>
            ) : (
              <ol className="mt-2 divide-y divide-warm-200">
                {flagged.map(c => (
                  <li key={c.id} className="py-3">
                    <div className="flex items-start gap-3">
                      <span className={`flex-shrink-0 mt-0.5 px-2 py-0.5 rounded-full text-[12px] font-semibold ${c.result === 'fail' ? 'bg-status-at-risk-bg text-status-at-risk' : 'bg-status-attention-bg text-status-attention'}`}>{c.result === 'fail' ? 'Fails' : 'Warning'}</span>
                      <div className="min-w-0 flex-1 text-[14px] font-semibold text-ink">{c.name}: {c.metric} <span className="font-normal text-warm-600">(target {c.threshold})</span></div>
                      <button type="button" aria-expanded={!allChecks && selected === c.id} onClick={() => { setAllChecks(false); setSelected(selected === c.id && !allChecks ? null : c.id) }} className="flex-shrink-0 text-[13px] font-semibold text-accent-600 hover:underline whitespace-nowrap">{c.offenders.length ? `Show ${c.offenders.length}` : 'Details'}</button>
                    </div>
                    {!allChecks && selected === c.id && (
                      <div className="mt-2 pl-[58px] text-[13px] text-warm-700">
                        <p>{c.explanation}</p>
                        {c.offenders.length > 0 && <p className="text-[12px] text-warm-600 mt-2">Activities ({c.offenders.length}): <span className="font-mono">{c.offenders.slice(0, 40).join(', ')}{c.offenders.length > 40 ? ' …' : ''}</span></p>}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        {/* Everything else about the score is folded: all the checks, and what the number is and is not. */}
        <section aria-labelledby="dcma-h" className="rounded-[14px] border border-warm-200 bg-white">
          <h2 id="dcma-h">
            <button type="button" aria-expanded={allChecks} aria-controls="dcma-all" onClick={() => { setAllChecks(v => !v); setSelected(null) }} className="w-full flex items-center gap-2.5 px-5 py-4 text-left">
              <ChevronRight size={15} aria-hidden="true" className={`flex-shrink-0 text-warm-600 transition-transform ${allChecks ? 'rotate-90' : ''}`} />
              <span className="flex-1 text-[14px] font-medium text-ink">All {data.dcma.checks.length} DCMA checks</span>
              <span className="text-[12px] text-warm-600 tabular-nums">{data.dcma.passed} of {data.dcma.applicable} applicable checks pass</span>
            </button>
          </h2>
          {allChecks && (
            <div id="dcma-all" className="px-5 pb-5 space-y-3">
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
                {data.dcma.checks.map((c, i) => (
              <button key={c.id} type="button" onClick={() => openCheck(c.id)} aria-pressed={selected === c.id} aria-controls={selectedCheck ? 'dcma-detail' : undefined}
                style={{ animationDelay: `${i * 25}ms` }}
                className={`rise-in card-lift text-left flex flex-col gap-1 rounded-2xl bg-white p-3.5 ${selected === c.id ? 'ring-2 ring-accent-600 ' : ''}border border-warm-200`}>
                <span className="text-[12px] font-semibold text-warm-500 tabular-nums">{c.id}</span>
                <span className="text-[13px] font-semibold text-ink leading-tight min-h-[2.4em]">{c.name}</span>
                <span className={`${String(c.metric).length > 12 && c.result !== 'n/a' ? 'text-[13px] leading-snug' : 'text-[18px] tracking-[-0.02em]'} font-semibold tabular-nums inline-flex items-center gap-2 ${c.result === 'n/a' ? 'text-warm-400' : 'text-ink'}`}>{c.result !== 'n/a' && <span aria-hidden="true" className={`h-2 w-2 flex-shrink-0 rounded-full ${c.result === 'pass' ? 'bg-status-on-track' : c.result === 'fail' ? 'bg-status-at-risk' : 'bg-status-attention'}`} />}{c.result === 'n/a' ? 'n/a' : c.metric}</span>
                <span className="text-[12px] text-warm-600">{c.basis && c.result !== 'n/a' ? <>{c.basis} · </> : null}target {c.threshold}</span>
              </button>
                ))}
              </div>
              {selectedCheck && (
                <div id="dcma-detail" role="region" aria-label={`Check ${selectedCheck.id}: ${selectedCheck.name}`} className="rise-in border-t border-warm-200 pt-4">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-[14px]">
                    <span className="text-ink font-semibold">#{selectedCheck.id} {selectedCheck.name}</span>
                    <span className="text-warm-600 tabular-nums">{selectedCheck.result === 'n/a' ? 'not applicable' : selectedCheck.result} · {selectedCheck.metric} (target {selectedCheck.threshold})</span>
                  </div>
                  <p className="text-[13px] text-warm-700 mt-1.5">{selectedCheck.explanation}</p>
                  {selectedCheck.offenders.length > 0 && (
                    <p className="text-[12px] text-warm-600 mt-2">Activities ({selectedCheck.offenders.length}): <span className="font-mono">{selectedCheck.offenders.slice(0, 40).join(', ')}{selectedCheck.offenders.length > 40 ? ' …' : ''}</span></p>
                  )}
                  {guidance.some(g => g.id === selectedCheck.id) && <a href="#what-to-fix-h" onClick={() => setTab('fix')} className="inline-block mt-2 text-[13px] font-semibold text-accent-600 hover:underline">How to fix it</a>}
                </div>
              )}
            </div>
          )}
        </section>
        <Disclosure tone="card" title="What this score means">
          <ul className="space-y-1.5 text-[13px] text-warm-700 list-disc pl-5">
            <li>It counts the DCMA 14-Point checks that <strong>apply</strong> to this schedule and pass. Checks marked “Not applicable” are left out of the count, never counted as passes; a check that needs data the file doesn&apos;t have says so instead of passing.</li>
            <li>Thresholds are the DCMA defaults, as adjusted by an admin under Organization → “Quality check thresholds (DCMA 14-point)”.</li>
            <li>A high score is not an approval. Each finding still needs a decision (accept with a reason, or mark to fix), and the submission review records the reviewer&apos;s verdict.</li>
            <li>Unless you choose the “With RunF9 edits” scenario, the score is for the file as submitted; edits made in RunF9 don&apos;t change it.</li>
            <li>This file: {data.schedule.calendars.length} calendar{data.schedule.calendars.length === 1 ? '' : 's'} imported and normalized; {data.classification.classifiedPct}% of activities mapped to standard work categories.</li>
          </ul>
        </Disclosure>
        </div>


        <div role="tabpanel" id="quality-panel-fix" aria-labelledby="quality-tab-fix" hidden={tab !== 'fix'} className="space-y-6">
        {guidance.length === 0 && <p className="text-[14px] text-warm-700">Nothing to fix: every applicable check passes.</p>}
        {guidance.length > 0 && (
          <section aria-labelledby="what-to-fix-h">
            <h2 id="what-to-fix-h" className="text-[16px] font-semibold text-ink mb-3">What to fix <span className="ml-1 text-[13px] font-normal text-warm-600">{guidance.filter(g => !g.decision).length} of {guidance.length} open</span></h2>
            <div className="space-y-3">
              {guidance.map((g, i) => <QualityGuide key={g.id} startOpen={i === guidance.findIndex(x => !x.decision)} g={g} check={data.dcma.checks.find(c => c.id === g.id)!} onDecide={decide} canDecide={can('schedule.write')} disposition={dispositionOf(`dcma:${g.id}`)} reviewer={reviewer} onDispose={dispose} />)}
            </div>
          </section>
        )}

        <NoraLogicPanel key={data.schedule.id} scheduleId={data.schedule.id} canEdit={can('schedule.write')} />
        </div>

        <div role="tabpanel" id="quality-panel-review" aria-labelledby="quality-tab-review" hidden={tab !== 'review'} className="space-y-6">
        <SubmissionPanel review={review} reviewer={reviewer} onSave={(disposition, comments) => postReview({ submission: disposition, comments })} />

        <section aria-labelledby="data-questions-h" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="data-questions-h" className="text-[16px] font-semibold text-ink">Questions about this file <span className="ml-1 text-[13px] font-normal text-warm-600">{open.length} open</span></h2>
            <label className="text-[12px] text-warm-600 flex items-center gap-1.5"><input type="checkbox" checked={hideAnswered} onChange={e => setHideAnswered(e.target.checked)} /> Hide answered</label>
          </div>
          {shown.length === 0 && <div className="bg-white border border-warm-200 rounded-[14px] p-5 text-[13px] text-warm-600"><CheckCircle2 size={15} className="inline mr-1.5 text-status-on-track" />No open questions about the data.</div>}
          {shown.map(q => {
            const Icon = SEV_ICON[q.severity]
            return (
              <div key={q.id} className="bg-white border border-warm-200 rounded-[14px] p-4">
                <div className="flex gap-2">
                  <Icon size={15} aria-hidden="true" className={`flex-shrink-0 mt-0.5 ${q.severity === 'error' ? 'text-status-at-risk' : 'text-warm-600'}`} />
                  <div className="flex-1">
                    <div className="text-[13px] text-ink">{fmtDates(q.question)}</div>
                    <div className="text-[12px] text-warm-600 mt-1">{fmtDates(q.detail)}</div>
                    {q.response ? (
                      <div className="text-[12px] text-status-on-track mt-2 font-medium">Answered: {q.response.response.replace(/_/g, ' ')}{q.response.note ? ` — ${q.response.note}` : ''}</div>
                    ) : !can('schedule.write') ? null : (
                      <div className="flex flex-wrap gap-2 mt-2.5">
                        <button onClick={() => respond(q, 'intentional')} className="px-2.5 py-1 rounded-lg border border-warm-300 bg-white hover:bg-warm-100 text-[13px] text-ink transition-colors">Yes, intentional</button>
                        <button onClick={() => respond(q, 'will_fix')} className="px-2.5 py-1 rounded-lg border border-warm-300 bg-white hover:bg-warm-100 text-[13px] text-ink transition-colors">No — will fix in source</button>
                        <button onClick={() => respond(q, 'not_an_issue')} className="px-2.5 py-1 rounded-lg border border-warm-300 bg-white hover:bg-warm-100 text-[13px] text-ink transition-colors">Not an issue</button>
                      </div>
                    )}
                    <ReviewControl itemId={q.id} label={q.question} disposition={dispositionOf(q.id)} reviewer={reviewer} onDispose={dispose} />
                  </div>
                </div>
              </div>
            )
          })}
        </section>

        <Disclosure tone="card" title="Calendars — as labeled vs. as understood" meta={`${data.schedule.calendars.length} calendar${data.schedule.calendars.length === 1 ? '' : 's'}${importNotes ? ` · ${importNotes} import note${importNotes === 1 ? '' : 's'}` : ''}`}>
          {data.schedule.calendars.length === 0 && <p className="text-[12px] text-warm-500">This file has no calendar data{data.schedule.sourceType === 'pdf' ? ' (PDF)' : ''}.</p>}
          <ul className="space-y-2">
            {data.schedule.calendars.map(c => (
              <li key={c.id} className="text-[12px]">
                <div className="text-ink font-medium">“{c.sourceName || c.name}”</div>
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
    </div>
  )
}

/** A one-sentence read of the DCMA grade: all good, a few things to fix, or needs work. */
function gradeOf(dcma: DcmaReport, openQuestions: number): { mood: RobotMood; short: string; title: string; sub: string } {
  const fail = dcma.checks.filter(c => c.result === 'fail').length
  const warn = dcma.checks.filter(c => c.result === 'warn').length
  const questions = openQuestions ? `${openQuestions} question${openQuestions === 1 ? '' : 's'} about the data ${openQuestions === 1 ? 'is' : 'are'} waiting for you.` : 'No open questions about the data.'
  if (fail === 0 && warn === 0) return { mood: 'done', short: 'In good shape', title: `In good shape: all ${dcma.applicable} applicable DCMA checks pass.`, sub: questions }
  if (fail <= 3 && dcma.passed >= 0.7 * dcma.applicable) {
    const n = fail + warn
    return { mood: 'waiting', short: `Good, with ${n} to fix`, title: `A few things to fix: ${n} of ${dcma.applicable} checks need${n === 1 ? 's' : ''} attention.`, sub: `Start with the first item under “What to fix”. ${questions}` }
  }
  return { mood: 'worried', short: 'Needs work', title: `This schedule needs work: ${fail} of ${dcma.applicable} checks fail.`, sub: `Start with “What to fix”. ${questions}` }
}

/** No schedule yet: an idle status and one clear next step. */
function EmptyState<S extends { id: string; name: string }>({ schedules, onPick, canUpload, onUpload }: { schedules: S[]; onPick: (s: S) => void; canUpload: boolean; onUpload: () => void }) {
  const latest = schedules[0]
  return (
    <div className="max-w-6xl mx-auto px-5 md:px-8 py-12 flex justify-center">
      <MoodTile mood="idle" as="section" className="max-w-md w-full text-center px-6 py-8">
        <Robot mood="idle" size={80} className="mx-auto" />
        <h2 className="tab-title mt-3">Schedule quality</h2>
        <p className="text-[14px] text-warm-600 mt-1"><ShieldCheck size={15} className="inline mr-1 -mt-0.5 text-warm-500" aria-hidden />Upload or select a schedule to run quality checks.</p>
        <p className="text-[12px] text-warm-600 mt-1">RunF9 checks the logic, calendars and dates, and points out the few things worth fixing first.</p>
        <div className="mt-5">
          {latest ? (
            <button type="button" onClick={() => onPick(latest)} className="px-4 py-2 rounded-lg bg-accent-600 hover:bg-accent-700 text-white text-[13px] font-semibold">Check {latest.name.length > 40 ? `${latest.name.slice(0, 40)}…` : latest.name}</button>
          ) : canUpload ? (
            <button type="button" onClick={onUpload} className="px-4 py-2 rounded-lg bg-accent-600 hover:bg-accent-700 text-white text-[13px] font-semibold">Upload a schedule</button>
          ) : (
            <p className="text-[12px] text-warm-600">Ask a scheduler on your team to upload one.</p>
          )}
        </div>
      </MoodTile>
    </div>
  )
}

function QualityGuide({ g, check, onDecide, canDecide, disposition, reviewer, onDispose, startOpen }: { startOpen: boolean; canDecide: boolean; g: Quality['guidance'][number]; check: DcmaReport['checks'][number]; onDecide: (id: number, r: 'intentional' | 'will_fix', note: string) => void; disposition: ItemDisposition | null; reviewer: boolean; onDispose: Dispose }) {
  // Only the first open item starts expanded, so the list reads as a short to-do list.
  const [open, setOpen] = useState(startOpen)
  const [note, setNote] = useState('')
  // The justification field opens when someone chooses to accept the finding, not before.
  const [accepting, setAccepting] = useState(false)
  const quiet = 'pressable px-3.5 py-1.5 rounded-lg border border-warm-300 bg-white hover:bg-warm-100 text-[13px] text-ink disabled:opacity-50'
  return (
    <div className={`border border-warm-200 rounded-[14px] ${g.decision ? 'bg-warm-50' : 'bg-white'}`}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 px-5 py-3 text-left">
        <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[12px] font-semibold ${check.result === 'fail' ? 'bg-status-at-risk-bg text-status-at-risk' : 'bg-status-attention-bg text-status-attention'}`}>{check.result === 'fail' ? 'Fails' : 'Warning'}</span>
        <span className="text-[14px] font-semibold text-ink flex-1">{check.name} <span className="font-normal text-warm-600">— {check.metric} (target {check.threshold})</span></span>
        {g.decision && <span className="text-[12px] text-warm-600">{g.decision.response === 'intentional' ? 'Accepted' : 'To fix'}</span>}
        {disposition && <span className="text-[12px] text-warm-600">Reviewer: {FINDING_LABELS[disposition.disposition].toLowerCase()}</span>}
        <ChevronRight size={15} aria-hidden="true" className={`flex-shrink-0 text-warm-600 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="px-5 pb-4 space-y-2.5">
          <p className="text-[13px] text-warm-700"><span className="font-semibold text-ink">What it means: </span>{g.meaning}</p>
          {g.whyItMatters && <p className="text-[13px] text-warm-700"><span className="font-semibold text-ink">Why it matters: </span>{g.whyItMatters}</p>}
          {g.steps.length > 0 && <ol className="list-decimal ml-5 text-[13px] text-warm-700 space-y-0.5">{g.steps.map((st, i) => <li key={i}>{st}</li>)}</ol>}
          {check.offenders.length > 0 && <p className="text-[12px] text-warm-600">Activities to look at: <span className="font-mono">{check.offenders.slice(0, 20).join(', ')}</span>{check.offenders.length > 20 ? ` and ${check.offenders.length - 20} more` : ''}</p>}
          {g.decision && <p className="text-[12px] text-warm-600 border-l-2 border-status-on-track pl-2">{g.decision.response === 'intentional' ? 'Accepted' : 'Will fix in the source schedule'}{g.decision.note ? ` — “${g.decision.note}”` : ''}</p>}
          {/* One filled button, the way to the fix; the two decisions sit beside it, outlined. */}
          {(g.actions.some(a => a.kind === 'link') || (!g.decision && canDecide)) && (
            <div className="flex flex-wrap gap-2 items-center pt-1">
              {g.actions.map((a, i) => a.kind === 'link' ? <Link key={i} href={a.href} className="pressable px-3.5 py-1.5 rounded-lg bg-accent-600 hover:bg-accent-700 text-white text-[13px] font-semibold">{a.label}</Link> : null)}
              {!g.decision && canDecide && <button type="button" onClick={() => onDecide(g.id, 'will_fix', note)} className={quiet}>I&apos;ll fix it in P6 / MSP</button>}
              {!g.decision && canDecide && <button type="button" aria-expanded={accepting} onClick={() => setAccepting(v => !v)} className={quiet}>Accept with justification…</button>}
            </div>
          )}
          {accepting && !g.decision && canDecide && (
            <div className="flex flex-wrap gap-2 items-center">
              <input value={note} onChange={e => setNote(e.target.value)} aria-label={`Justification for accepting check ${g.id} as it is`} placeholder="Why this is acceptable as it is (at least 10 characters)" className="flex-1 min-w-[220px] bg-white border border-warm-300 rounded-lg px-2.5 py-1.5 text-[13px]" />
              <button type="button" disabled={note.trim().length < 10} onClick={() => onDecide(g.id, 'intentional', note)} className={quiet}>Record acceptance</button>
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
  const [choice, setChoice] = useState<FindingDisposition | ''>(disposition?.disposition ?? '')
  const [text, setText] = useState(disposition?.justification ?? '')
  const [editing, setEditing] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  if (!reviewer && !disposition) return null
  // Nothing recorded yet: one quiet link, so a list of findings is not a list of open forms.
  if (!disposition && !editing) return <button type="button" onClick={() => setEditing(true)} className="mt-1 text-[12px] font-semibold text-accent-600 hover:underline">Add a reviewer disposition</button>
  const save = async () => {
    if (!choice) return
    setBusy(true); setErr('')
    const e = await onDispose(itemId, choice, text)
    setBusy(false)
    if (e) setErr(e); else setEditing(false)
  }
  return (
    <div className="mt-2.5 pt-2.5 border-t border-warm-200">
      {disposition && !editing ? (
        <p className="text-[12px] text-warm-700">
          <span className="font-semibold text-ink">Reviewer disposition: {FINDING_LABELS[disposition.disposition]}</span>
          {disposition.justification ? ` — “${disposition.justification}”` : ''}
          <span className="text-warm-600"> · {disposition.reviewer ?? 'reviewer'}, {fmtDay(disposition.createdAt)}</span>
          {reviewer && <button type="button" onClick={() => setEditing(true)} className="ml-2 underline text-ink">Change</button>}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[12px] font-medium text-ink">Reviewer</span>
          <select aria-label={`Disposition for ${label}`} value={choice} onChange={e => setChoice(e.target.value as FindingDisposition)} className="bg-warm-50 border border-warm-300 rounded-lg px-2 py-1 text-[12px] text-ink">
            <option value="" disabled>Choose…</option>
            {FINDING_DISPOSITIONS.map(d => <option key={d} value={d}>{FINDING_LABELS[d]}</option>)}
          </select>
          <input aria-label={`Justification for ${label}`} value={text} onChange={e => setText(e.target.value)} placeholder={choice === 'exception' ? 'Justification (required)' : 'Comment (optional)'} className="flex-1 min-w-[200px] bg-warm-50 border border-warm-300 rounded-lg px-2.5 py-1 text-[12px]" />
          <button type="button" disabled={busy || !choice} onClick={save} className="pressable px-3.5 py-1.5 rounded-lg border border-warm-300 bg-white hover:bg-warm-100 text-[13px] text-ink disabled:opacity-50">Save</button>
          {!disposition && <button type="button" onClick={() => setEditing(false)} className="text-[12px] text-warm-600 hover:underline">Cancel</button>}
          {err && <span role="alert" className="text-[12px] text-status-at-risk w-full">{err}</span>}
        </div>
      )}
    </div>
  )
}

/** The overall disposition of the submission (approved / approved as noted / revise and resubmit). */
function SubmissionPanel({ review, reviewer, onSave }: { review: ReviewState; reviewer: boolean; onSave: (d: SubmissionDisposition, comments: string) => Promise<string | null> }) {
  const s = review.submission
  const [choice, setChoice] = useState<SubmissionDisposition | ''>(s?.disposition ?? '')
  const [comments, setComments] = useState(s?.comments ?? '')
  const [editing, setEditing] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  if (!reviewer && !s) return null
  const counts = FINDING_DISPOSITIONS.map(d => `${review.items.filter(x => x.disposition === d).length} ${FINDING_LABELS[d].toLowerCase()}`).join(' · ')
  const save = async () => {
    if (!choice) return
    setBusy(true); setErr('')
    const e = await onSave(choice, comments)
    setBusy(false)
    if (e) setErr(e); else setEditing(false)
  }
  return (
    <section aria-labelledby="submission-h" className="bg-white border border-warm-200 rounded-[14px] p-5">
      <h2 id="submission-h" className="text-[16px] font-semibold text-ink mb-2">Submission review</h2>
      {s && !editing ? (
        <div className="text-[13px] text-warm-700 space-y-1">
          <p><span className="font-semibold text-ink">{SUBMISSION_LABELS[s.disposition]}</span> <span className="text-warm-600">· {s.reviewer ?? 'reviewer'}, {fmtDay(s.createdAt)}</span>
            {reviewer && <button type="button" onClick={() => setEditing(true)} className="ml-2 underline text-ink text-[12px]">Change</button>}</p>
          {s.comments && <p className="whitespace-pre-wrap">{s.comments}</p>}
          <p className="text-[12px] text-warm-600">Findings and questions dispositioned: {counts}</p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2 items-center">
            <select aria-label="Submission disposition" value={choice} onChange={e => setChoice(e.target.value as SubmissionDisposition)} className="bg-white border border-warm-300 rounded-lg px-2 py-1.5 text-[13px] text-ink">
              {/* No decision is pre-selected: a reviewer picks one, so a default never reads as a recorded approval. */}
              <option value="" disabled>Choose a disposition…</option>
              {SUBMISSION_DISPOSITIONS.map(d => <option key={d} value={d}>{SUBMISSION_LABELS[d]}</option>)}
            </select>
            <span className="text-[12px] text-warm-600">{counts}</span>
          </div>
          {choice && <textarea aria-label="Review comments" value={comments} onChange={e => setComments(e.target.value)} rows={3} placeholder={choice === 'approved' ? 'Comments (optional)' : 'Comments (required): what to note or revise'} className="w-full bg-white border border-warm-300 rounded-lg px-2.5 py-1.5 text-[13px]" />}
          <div className={`items-center gap-2 ${choice || editing ? 'flex' : 'hidden'}`}>
            <button type="button" disabled={busy || !choice} onClick={save} className="pressable px-3.5 py-1.5 rounded-lg bg-accent-600 hover:bg-accent-700 text-white text-[13px] font-semibold disabled:opacity-50">Record disposition</button>
            {editing && <button type="button" onClick={() => setEditing(false)} className="px-3.5 py-1.5 rounded-lg border border-warm-300 text-[13px] text-ink">Cancel</button>}
            {err && <span role="alert" className="text-[12px] text-status-at-risk">{err}</span>}
          </div>
        </div>
      )}
    </section>
  )
}

type QualityTab = 'checks' | 'fix' | 'review' | 'standards'
const QUALITY_TABS: { id: QualityTab; label: string }[] = [{ id: 'checks', label: 'Checks' }, { id: 'fix', label: 'What to fix' }, { id: 'review', label: 'Review and data questions' }, { id: 'standards', label: 'Standards' }]

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
    <div role="tablist" aria-label="Quality views" className="flex gap-1.5 mt-1 overflow-x-auto whitespace-nowrap [&>button]:flex-shrink-0 max-md:[mask-image:linear-gradient(to_right,#000_calc(100%-32px),transparent)]" onKeyDown={onKey}>
      {QUALITY_TABS.map(t => (
        <button key={t.id} id={`quality-tab-${t.id}`} role="tab" type="button" aria-selected={tab === t.id} aria-controls={tab === t.id ? `quality-panel-${t.id}` : undefined} tabIndex={tab === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          className={`pressable rounded-lg px-3 min-h-[32px] text-[13px] font-semibold border ${tab === t.id ? 'border-navy-950 bg-navy-950 text-white' : 'border-warm-300 bg-white text-warm-700 hover:text-ink'}`}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

/** Checks passing as a ring that fills on load. The passing share is always green and the failing share
 *  red, so the colour says what the arc counts (it used to take the page's mood, which drew passes in red). */
function ScoreRing({ passed, applicable }: { passed: number; applicable: number }) {
  const r = 48, c = 2 * Math.PI * r
  const share = applicable ? passed / applicable : 0
  return (
    <svg width="112" height="112" viewBox="0 0 112 112" className="flex-shrink-0" role="img" aria-label={`${passed} of ${applicable} checks pass (green), ${applicable - passed} fail (red)`}>
      <circle cx="56" cy="56" r={r} fill="none" stroke={applicable && passed < applicable ? '#A64848' : '#E8EAEC'} strokeWidth="10" />
      <circle cx="56" cy="56" r={r} fill="none" stroke="#2F7358" strokeWidth="10" strokeLinecap="round" transform="rotate(-90 56 56)"
        strokeDasharray={c} strokeDashoffset={c * (1 - share)} className="ring-draw" style={{ ['--ring-c' as string]: c }} />
      <text x="56" y="62" textAnchor="middle" fontSize="24" fontWeight="700" fill="#1D2125">{passed}/{applicable}</text>
    </svg>
  )
}

