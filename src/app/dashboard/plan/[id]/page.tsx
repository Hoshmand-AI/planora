'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Loader2, Lock, Play, Download, Send, ChevronDown, ChevronRight,
  AlertTriangle, CheckCircle2, Trash2, Link2, X,
} from 'lucide-react'
import type {
  Answer, ElicitationResult, GeneratedSchedule, PlanActivity, PlanLink, SourceRef,
} from '@/lib/planning/types'
import type { Evaluation } from '@/lib/planning/evaluation'
import type { EditImpact } from '@/lib/planning/overrides'
import type { RecoveryPlan } from '@/lib/planning/recovery'
import type { CheckGuidance } from '@/lib/analysis/dcma-guidance'
import { fmtDate, fmtDates, fmtDateTime } from '@/lib/format'
import { useApp } from '../../layout'
import type { AdaptiveInterview } from '@/lib/planning/adaptive'
import { SmartInterview } from '@/components/interview/SmartInterview'

interface Review { id: string; reviewer: string; verdict: string; comment: string; at: string }
interface Plan {
  id: string; name: string; answers: Record<string, Answer>; generated: GeneratedSchedule | null
  reviews: Review[]; audit: { at: string; by: string; action: string; detail?: string }[]; scheduleId: string | null
  version: number
}
interface View {
  plan: Plan; elicitation: ElicitationResult; adaptive: AdaptiveInterview; evaluation: Evaluation | null
  llm: { mode: 'cloud' | 'local' | 'offline'; airgapped: boolean; model: string | null; error?: string; cuiWarning?: string }
  history: { projectCount: number; similarCount: number } | null
  answered: { id: string; prompt: string; section: string; label: string; status: string; value: Answer['value'] | null; note: string | null; custom: boolean }[]
  recovery: RecoveryPlan | null
  guidance: (CheckGuidance & { decision: { decision: 'accept' | 'fix'; note: string; by: string; at: string } | null })[]
}

type Tab = 'interview' | 'schedule' | 'evaluation' | 'audit'

const SOURCE_LABEL: Record<SourceRef['kind'], string> = {
  user: 'Your answer', file: 'Uploaded file', catalog: 'Regional catalog', firm_history: 'Firm history', template: 'Template',
  model: 'AI suggestion', override: 'Override', assumption: 'Assumption',
}
const CONF_STYLE: Record<string, string> = {
  high: 'border-status-on-track text-status-on-track', medium: 'border-status-info text-status-info', low: 'border-status-attention text-status-attention',
}

export default function PlanPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [view, setView] = useState<View | null>(null)
  const [tab, setTab] = useState<Tab>('interview')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dateAlerts, setDateAlerts] = useState<string[]>([])
  const [focusCodes, setFocusCodes] = useState<string[] | null>(null)
  const [conflict, setConflict] = useState(false)
  // Monte Carlo result for the plan version on screen; when present it is THE forecast shown everywhere.
  const [sra, setSra] = useState<Sra | null>(null)
  const planVersion = view?.plan.version
  useEffect(() => { setSra(null) }, [planVersion])
  const { can } = useApp()
  const stickyRef = useRef<HTMLDivElement>(null)
  const [stickyTop, setStickyTop] = useState(0)
  useEffect(() => {
    // Sit directly under the app's navigation bar, whatever its height on this screen size.
    const measure = () => setStickyTop(document.querySelector('header')?.getBoundingClientRect().height ?? 0)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const load = useCallback(async () => {
    const res = await fetch(`/api/plans/${id}`)
    const data = await res.json()
    if (!res.ok) { setError(data.error || 'Could not load plan.'); return }
    setView(data)
  }, [id])
  useEffect(() => { load() }, [load])

  const call = async (key: string, url: string, init: RequestInit): Promise<Record<string, unknown> | null> => {
    setBusy(key); setError(''); setConflict(false)
    try {
      // Send the version this screen is showing; the server refuses the write if someone else changed the plan since.
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (view?.plan.version) headers['x-plan-version'] = String(view.plan.version)
      const res = await fetch(url, { headers, ...init })
      const data = await res.json()
      if (res.status === 409 && data.code === 'conflict') { setConflict(true); return null }
      if (!res.ok) { setError(data.error || 'Request failed.'); return null }
      if (data.plan) setView(data as View)
      return data
    } catch {
      setError('Network error.')
      return null
    } finally {
      setBusy(null)
    }
  }

  const recover = async (optionId: string) => {
    const data = await call('recover', `/api/plans/${id}/recover`, { method: 'POST', body: JSON.stringify({ optionId }) })
    if (data) setNotice(`Applied: ${data.applied}. New finish ${(data.plan as Plan).generated?.cpm?.projectFinish}. Every change is in the audit trail and can be overridden.`)
  }
  const decide = async (key: string, decision: 'accept' | 'fix' | null, note: string) => {
    const data = await call('decide', `/api/plans/${id}/decide`, { method: 'POST', body: JSON.stringify({ key, decision, note }) })
    if (data) setNotice(decision === 'accept' ? 'Recorded as accepted with your justification (it appears in the Basis of Schedule).' : decision === 'fix' ? 'Marked to fix.' : 'Decision cleared.')
    return !!data
  }
  const showCodes = (codes: string[]) => { setFocusCodes(codes); setTab('schedule'); window.scrollTo({ top: 0 }) }
  const addNote = async (text: string) => {
    const data = await call('note', `/api/plans/${id}`, { method: 'PATCH', body: JSON.stringify({ addNote: text }) })
    if (data) setNotice(view?.plan.generated ? 'Added. Click Regenerate to include it in the Basis of Schedule; add it as an activity on the Schedule tab if it is work.' : 'Added to the project brief.')
    return !!data
  }
  const saveAnswers = async (answers: Record<string, Partial<Answer> | null>, key = 'answer:batch') => {
    const data = await call(key, `/api/plans/${id}`, { method: 'PATCH', body: JSON.stringify({ answers }) })
    const errs = data?.errors as Record<string, string> | undefined
    if (errs && Object.keys(errs).length) setError(Object.values(errs)[0])
    const issues = (data?.newDateIssues as { text: string }[] | undefined) || []
    if (issues.length) setDateAlerts(issues.map(i => i.text))
  }
  const saveAnswer = (qid: string, a: Partial<Answer> | null) => saveAnswers({ [qid]: a }, `answer:${qid}`)
  const generate = async (fresh = false) => {
    const hadSchedule = !!view?.plan.generated
    const data = await call('generate', `/api/plans/${id}/generate`, { method: 'POST', body: JSON.stringify({ fresh }) })
    if (data) { setTab('schedule'); setNotice(fresh ? 'Rebuilt from scratch (overrides discarded).' : hadSchedule ? 'Schedule regenerated from the latest answers. Your overrides were kept.' : 'Schedule generated. Open any activity to see why it is there, or override it.') }
  }
  const publish = async () => {
    const data = await call('publish', `/api/plans/${id}/publish`, { method: 'POST', body: '{}' })
    if (data) setNotice('Published. Overview, Quality, Timeline and Ask AI now work on this schedule; it is also the baseline for progress updates.')
  }
  const suggest = async () => {
    const data = await call('suggest', `/api/plans/${id}/suggest`, { method: 'POST', body: '{}' })
    if (data) setNotice(`${data.added} follow-up question(s) added by the AI model.`)
  }
  const remove = async () => {
    if (!confirm('Delete this plan? This cannot be undone.')) return
    const res = await fetch(`/api/plans/${id}`, { method: 'DELETE' })
    if (res.ok) router.push('/dashboard/plan')
  }

  if (!view) {
    return <div className="px-6 py-10 text-warm-400 text-[14px] flex items-center gap-2">{error || <><Loader2 size={14} className="animate-spin" /> Loading plan…</>}</div>
  }
  const { plan, elicitation: el, evaluation: ev, llm } = view
  const g = plan.generated

  const lateDays = g?.mustFinishBy && g.cpm && g.cpm.projectFinish > g.mustFinishBy
    ? Math.round((Date.parse(g.cpm.projectFinish) - Date.parse(g.mustFinishBy)) / 86_400_000) : 0
  const failing = ev ? ev.dcma.checks.filter(c => c.result === 'fail').length : 0
  const fc = headline(ev, sra)
  const goEvaluation = () => { setTab('evaluation'); window.scrollTo({ top: 0 }) }

  return (
    <div className="px-4 md:px-6 pb-8">
      {/* Frozen summary: what this plan is, where it stands, and the tabs — stays visible while scrolling */}
      <div ref={stickyRef} style={{ top: stickyTop }} className="sticky z-30 -mx-4 md:-mx-6 px-4 md:px-6 pt-4 pb-3 bg-warm-50/95 backdrop-blur border-b border-warm-200 mb-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="min-w-0">
            <Link href="/dashboard/plan" className="inline-flex items-center gap-1 text-[12px] text-warm-500 hover:text-navy-950"><ArrowLeft size={12} /> All plans</Link>
            <h1 className="font-display text-[22px] md:text-[26px] text-navy-950 leading-tight truncate">{plan.name}</h1>
          </div>
          <div className="flex flex-wrap gap-2 flex-shrink-0">
            {can('plan.write') && <button onClick={() => generate(false)} disabled={!!busy} className="pressable flex items-center gap-1.5 bg-navy-950 hover:bg-navy-900 text-white px-4 py-2 rounded-full text-[13px] font-semibold disabled:opacity-50">
              {busy === 'generate' ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} {g ? 'Regenerate' : 'Generate schedule'}
            </button>}
            {g && (
              <>
                {can('plan.publish') && <button onClick={publish} disabled={!!busy} className="pressable flex items-center gap-1.5 border border-warm-300 bg-white hover:border-navy-900 text-navy-950 px-4 py-2 rounded-full text-[13px] font-medium disabled:opacity-50">
                  {busy === 'publish' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Publish
                </button>}
                <ExportMenu id={plan.id} />
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-2 text-[13px] text-warm-600">
          <HeaderStat label="Questions that matter" value={view.adaptive.enoughToBuild ? 'none left' : String(view.adaptive.remainingThatMatter)} onClick={() => setTab('interview')} />
          {g?.cpm && <HeaderStat label="Finish" value={fmtDate(g.cpm.projectFinish)} onClick={() => setTab('schedule')} />}
          {fc && <HeaderStat label={`P80 (${fc.short})`} value={fmtDate(fc.p80)} onClick={goEvaluation} />}
          {ev && <HeaderStat label="Quality" value={`${ev.grade} · ${ev.score}`} onClick={goEvaluation} />}
          {ev && <HeaderStat label="DCMA" value={`${ev.dcma.passed}/${ev.dcma.applicable}`} tone={failing ? 'warn' : undefined} onClick={goEvaluation} />}
          {lateDays > 0 && (
            <button onClick={() => { setTab('schedule'); setTimeout(() => document.getElementById('recovery')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50) }}
              className="pressable rounded-full bg-status-at-risk-bg text-status-at-risk px-2.5 py-0.5 text-[12.5px] font-semibold">{lateDays} days late</button>
          )}
          <span className="text-[12px] text-warm-500 inline-flex items-center gap-1">{llm.airgapped && <Lock size={10} aria-hidden />}{llm.mode === 'cloud' ? 'Cloud AI' : llm.mode === 'local' ? 'On-prem AI' : 'Rules only'}</span>
        </div>
        <div role="tablist" aria-label="Plan sections" className="mt-3 inline-flex max-w-full overflow-x-auto rounded-full bg-warm-200/70 p-1 gap-0.5">
          {(['interview', 'schedule', 'evaluation', 'audit'] as Tab[]).map(t => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} disabled={t !== 'interview' && t !== 'audit' && !g}
              className={`pressable px-3.5 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap disabled:opacity-40 ${tab === t ? 'bg-white text-navy-950 shadow-[0_1px_3px_rgba(10,22,40,0.12)]' : 'text-warm-600 hover:text-navy-950'}`}>
              {t === 'interview' ? 'Interview' : t === 'schedule' ? 'Schedule' : t === 'evaluation' ? `Evaluation${failing ? ` · ${failing} to fix` : ''}` : 'Audit trail'}
            </button>
          ))}
        </div>
      </div>

      {conflict && (
        <Banner kind="warn" onClose={() => setConflict(false)}>
          Someone else changed this plan since you opened it, so your last change was not saved (nothing was overwritten).{' '}
          <button onClick={() => { setConflict(false); load() }} className="underline font-semibold">Load the latest version</button>, then make your change again.
        </Banner>
      )}
      {!can('plan.write') && (
        <Banner kind="warn">
          You have read-only access to plans{can('plan.review') ? ' (you can record expert reviews on the Evaluation tab)' : ''}. Ask an admin of your organization if you need to make changes.
        </Banner>
      )}
      {notice && <Banner kind="ok" onClose={() => setNotice('')}>{fmtDates(notice)}</Banner>}
      {error && <Banner kind="error" onClose={() => setError('')}>{error}</Banner>}
      {dateAlerts.length > 0 && (
        <Banner kind="warn" onClose={() => setDateAlerts([])}>
          <span className="font-semibold">These dates don&apos;t fit together:</span>
          <ul className="list-disc ml-5 mt-1 space-y-0.5">{dateAlerts.map((t, i) => <li key={i}>{fmtDates(t)}</li>)}</ul>
        </Banner>
      )}

      {g && tab !== 'interview' && tab !== 'audit' && view.adaptive.ask.length > 0 && (
        <div className="border-l-2 border-accent-500 bg-accent-100 text-[13px] text-warm-700 px-3 py-2.5 rounded-md mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="flex-1 min-w-[240px]">{view.adaptive.enoughToBuild ? <>The open questions can&apos;t move your finish materially. Answer them to refine the basis of schedule.</> : <><span className="font-semibold text-navy-950">{view.adaptive.remainingThatMatter} open question{view.adaptive.remainingThatMatter === 1 ? '' : 's'}</span> could still move this finish. Answer them, then rebuild; your overrides are kept.</>}</span>
          <button onClick={() => setTab('interview')} className="bg-navy-900 text-white px-3 py-1.5 rounded-md text-[12.5px] font-medium">Answer remaining questions</button>
        </div>
      )}

      {tab === 'interview' && (<>
        {llm.cuiWarning && ['cui', 'classified'].includes(String(plan.answers['security.classification']?.value ?? (plan.answers['security.classification']?.status === 'withheld' ? 'classified' : ''))) && (
          <p role="alert" className="mb-3 border-l-2 border-status-at-risk pl-3 text-[13px] text-warm-700"><strong className="font-semibold text-navy-950">CUI or classified project.</strong> {llm.cuiWarning} Planora will not send this plan to a cloud AI model.</p>
        )}
        <SmartInterview el={el} adaptive={view.adaptive} answered={view.answered} hasSchedule={!!g} canWrite={can('plan.write')} busy={busy} llm={llm} history={view.history}
          onAnswer={saveAnswer} onAnswerMany={saveAnswers} onSuggest={suggest} onGenerate={() => generate(false)} onAddNote={addNote} />
      </>)}
      {tab === 'schedule' && g && <ScheduleTab plan={plan} onEdit={async (edit) => {
        const data = await call('edit', `/api/plans/${id}/edit`, { method: 'POST', body: JSON.stringify({ edit }) })
        if (data?.impact) {
          const im = data.impact as EditImpact
          setNotice(`${data.summary}. Finish ${im.finishBefore} → ${im.finishAfter} (${im.finishDeltaDays >= 0 ? '+' : ''}${im.finishDeltaDays} days)${im.criticalAdded.length ? `; now critical: ${im.criticalAdded.slice(0, 6).join(', ')}` : ''}${im.criticalRemoved.length ? `; no longer critical: ${im.criticalRemoved.slice(0, 6).join(', ')}` : ''}.`)
          return true
        }
        return false
      }} onRegenerateFresh={() => generate(true)} busy={busy} recovery={view.recovery} onRecover={recover} onInterview={() => setTab('interview')} focusCodes={focusCodes} onClearFocus={() => setFocusCodes(null)} />}
      {tab === 'evaluation' && g && ev && <EvaluationTab ev={ev} plan={plan} sra={sra} onSra={setSra} busy={busy} guidance={view.guidance} recovery={view.recovery} onRecover={recover} onDecide={decide} onShowCodes={showCodes} onInterview={() => setTab('interview')} onReview={async (body) => { const d = await call('review', `/api/plans/${id}/review`, { method: 'POST', body: JSON.stringify(body) }); if (d) setNotice('Review recorded.'); return !!d }} />}
      {tab === 'audit' && <AuditTab plan={plan} onDelete={can('plan.write') ? remove : undefined} fullLog={can('audit.read')} />}
    </div>
  )
}

/* ─── Shared bits ────────────────────────────────────── */

/**
 * The one P50/P80 forecast this page shows: Monte Carlo once it has run for this version, otherwise
 * the rule-based estimate, labeled as such (mirrors headlineForecast() in lib/planning/evaluation).
 */
function headline(ev: Evaluation | null, sra: Sra | null) {
  if (!ev) return null
  if (sra) {
    const required = sra.required?.date ?? ev.forecast.requiredFinish
    return { method: 'monte_carlo' as const, short: 'Monte Carlo', label: 'Monte Carlo', p50: sra.percentiles.p50, p80: sra.percentiles.p80, required, meets: required ? sra.percentiles.p80 <= required : undefined }
  }
  return { method: 'rule_based' as const, short: 'rule-based', label: 'Rule-based estimate', p50: ev.forecast.p50, p80: ev.forecast.p80, required: ev.forecast.requiredFinish, meets: ev.forecast.p80MeetsRequired }
}

function HeaderStat({ label, value, onClick, tone }: { label: string; value: string; onClick?: () => void; tone?: 'warn' }) {
  return (
    <button onClick={onClick} className="inline-flex items-baseline gap-1.5 hover:text-navy-950">
      <span>{label}</span><span className={`font-semibold tabular-nums ${tone === 'warn' ? 'text-status-attention' : 'text-navy-950'}`}>{value}</span>
    </button>
  )
}

function Banner({ kind, children, onClose }: { kind: 'ok' | 'error' | 'warn'; children: React.ReactNode; onClose?: () => void }) {
  const style = kind === 'ok' ? 'border-status-on-track bg-status-on-track-bg' : kind === 'error' ? 'border-status-at-risk bg-status-at-risk-bg' : 'border-status-attention bg-status-attention-bg'
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`border-l-2 ${style} text-[13px] text-warm-700 px-3 py-2 rounded-md mb-4 flex items-start gap-2`}>
      <div className="flex-1">{children}</div>
      {onClose && <button onClick={onClose} aria-label="Dismiss" className="text-warm-400 hover:text-warm-600"><X size={14} aria-hidden="true" /></button>}
    </div>
  )
}

function Sources({ sources }: { sources: SourceRef[] }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {sources.map((s, i) => (
        <span key={i} title={s.detail} className="text-[11px] text-warm-600 bg-warm-50 border border-warm-200 rounded-md px-1.5 py-0.5">
          <span className="font-semibold">{SOURCE_LABEL[s.kind]}:</span> {s.label}
        </span>
      ))}
    </div>
  )
}

function ExportMenu({ id }: { id: string }) {
  const [open, setOpen] = useState(false)
  const item = (format: string, label: string, sub: string) => (
    <a key={format} href={`/api/plans/${id}/export?format=${format}`} onClick={() => setOpen(false)} className="block px-3 py-2 hover:bg-warm-100">
      <div className="text-navy-950">{label}</div><div className="text-[11.5px] text-warm-400">{sub}</div>
    </a>
  )
  const group = (title: string) => <div className="px-3 pt-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-warm-400">{title}</div>
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} aria-expanded={open} className="pressable flex items-center gap-1.5 border border-warm-300 bg-white hover:border-navy-900 text-navy-950 px-4 py-2 rounded-full text-[13px] font-medium">
        <Download size={13} /> Export <ChevronDown size={12} />
      </button>
      {open && <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />}
      {open && (
        <div className="absolute right-0 mt-1 w-80 bg-warm-50 border border-warm-200 rounded-md shadow-lg z-20 py-1 text-[13px]">
          {group('Scheduling software')}
          {item('xer', 'Primavera P6 (.xer)', 'Native P6 file: WBS, calendars, logic, constraints')}
          {item('xml', 'MS Project (.xml)', 'Opens in MS Project; P6 can import it too')}
          {group('Excel')}
          {item('xlsx-p6', 'Excel — P6-style layout', 'WBS bands, colors, indentation, Gantt bars')}
          {item('xlsx-import', 'Excel — for import into P6 / MS Project', 'Import-ready sheets and instructions')}
          {item('csv', 'CSV activity table', 'Flat table with rationale and sources')}
          {group('Documents')}
          {item('pdf', 'PDF schedule report', 'Summary page + P6-style Gantt, 11×17')}
          {item('md', 'Basis of Schedule narrative (.md)', 'Assumptions, sources, overrides, review')}
        </div>
      )}
    </div>
  )
}

/* ─── Schedule (explainable + overridable) ───────────── */

type EditBody = Record<string, unknown>

function ScheduleTab({ plan, onEdit, onRegenerateFresh, busy, recovery, onRecover, onInterview, focusCodes, onClearFocus }: {
  plan: Plan; onEdit: (e: EditBody) => Promise<boolean>; onRegenerateFresh: () => void; busy: string | null
  recovery: RecoveryPlan | null; onRecover: (id: string) => void; onInterview: () => void
  focusCodes: string[] | null; onClearFocus: () => void
}) {
  const g = plan.generated!
  const t = g.cpm?.times || {}
  const [open, setOpen] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'critical' | 'low' | 'overridden'>('all')
  const byId = useMemo(() => new Map(g.activities.map(a => [a.id, a])), [g])
  const start = Date.parse(g.projectStart)
  const span = Math.max(1, Date.parse(g.cpm?.projectFinish || g.projectStart) - start)
  const rows = g.activities
    .filter(a => !focusCodes || focusCodes.includes(a.code))
    .filter(a => filter === 'all' || (filter === 'critical' && t[a.id]?.critical) || (filter === 'low' && a.rationale.confidence === 'low') || (filter === 'overridden' && a.overrides?.length))
    .sort((a, b) => (t[a.id]?.earlyStart || '').localeCompare(t[b.id]?.earlyStart || '') || a.code.localeCompare(b.code))
  const criticalCount = g.activities.filter(a => t[a.id]?.critical).length
  const overrides = g.activities.filter(a => a.overrides?.length).length + g.links.filter(l => l.overrides?.length).length + (g.removed?.length || 0)

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[['Start', fmtDate(g.projectStart)], ['Finish', fmtDate(g.cpm?.projectFinish)], ['Activities', `${g.activities.length} (${criticalCount} critical)`], ['Your overrides', String(overrides)]].map(([k, v]) => (
          <div key={k} className="bg-warm-100 border border-warm-200 rounded-lg p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400">{k}</div>
            <div className="text-[16px] font-semibold text-navy-950 tabular-nums mt-1">{v}</div>
          </div>
        ))}
      </div>
      {recovery && <RecoveryPanel r={recovery} busy={busy} onRecover={onRecover} onInterview={onInterview} />}
      {focusCodes && (
        <div className="border-l-2 border-accent-500 bg-accent-100 text-[13px] text-warm-700 px-3 py-2 rounded-md mb-3 flex items-center gap-3">
          <span className="flex-1">Showing the {focusCodes.length} activities flagged by the quality check. Open one to see why it is there and override it.</span>
          <button onClick={onClearFocus} className="text-[12.5px] font-medium text-navy-950 underline">Show all</button>
        </div>
      )}
      {(g.cpm?.warnings?.length ?? 0) > 0 && <Banner kind="warn">{g.cpm!.warnings.slice(0, 3).join(' · ')}</Banner>}
      {(g.notes || []).map((n, i) => <p key={i} className="text-[12px] text-warm-500 mb-2">{fmtDates(n)}</p>)}

      <AddActivity activities={g.activities.slice().sort((a, b) => (t[a.id]?.earlyStart || '').localeCompare(t[b.id]?.earlyStart || ''))} onEdit={onEdit} busy={busy} />

      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {(['all', 'critical', 'low', 'overridden'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} className={`px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors ${filter === f ? 'bg-navy-900 text-white' : 'bg-warm-100 border border-warm-200 text-warm-600'}`}>
            {f === 'all' ? 'All' : f === 'critical' ? 'Critical path' : f === 'low' ? 'Low confidence' : 'Overridden'}
          </button>
        ))}
        <span className="flex-1" />
        <button onClick={() => { if (confirm('Rebuild from the interview and discard all overrides?')) onRegenerateFresh() }} disabled={!!busy} className="text-[12px] text-warm-500 hover:text-status-at-risk">Discard overrides & rebuild</button>
      </div>

      <div className="bg-warm-100 border border-warm-200 rounded-lg overflow-x-auto">
        <table className="w-full text-[12.5px] min-w-[760px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-wider text-warm-400 border-b border-warm-200">
              <th className="px-3 py-2 w-6" /><th className="px-2 py-2">ID</th><th className="px-2 py-2">Activity</th><th className="px-2 py-2 text-right">Dur</th>
              <th className="px-2 py-2">Start</th><th className="px-2 py-2">Finish</th><th className="px-2 py-2 text-right">TF</th><th className="px-2 py-2">Why</th><th className="px-3 py-2 w-[22%]">Timeline</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(a => {
              const tm = t[a.id]
              const left = tm ? ((Date.parse(tm.earlyStart) - start) / span) * 100 : 0
              const width = tm ? Math.max(0.6, ((Date.parse(tm.earlyFinish) - Date.parse(tm.earlyStart) + 86_400_000) / span) * 100) : 0
              return (
                <ActivityRows key={a.id} a={a} tm={tm} left={left} width={width} open={open === a.id} onToggle={() => setOpen(o => o === a.id ? null : a.id)}
                  links={g.links} byId={byId} onEdit={onEdit} busy={busy} />
              )
            })}
          </tbody>
        </table>
      </div>

      {(g.removed?.length ?? 0) > 0 && (
        <div className="mt-4 text-[12.5px] text-warm-500">
          <div className="font-semibold text-warm-600 mb-1">Removed by scheduler</div>
          {g.removed!.map(r => <div key={r.id}>· {r.name} — {r.override.reason} ({r.override.by})</div>)}
        </div>
      )}
    </div>
  )
}

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

function RecoveryPanel({ r, busy, onRecover, onInterview }: { r: RecoveryPlan; busy: string | null; onRecover: (id: string) => void; onInterview: () => void }) {
  const [open, setOpen] = useState(true)
  return (
    <div id="recovery" className="border border-status-at-risk/40 bg-status-at-risk-bg rounded-lg p-5 mb-4 scroll-mt-64">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-start justify-between gap-3 text-left">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-status-at-risk">Finish is {r.gapDays} days after the required date</div>
          <div className="text-[15px] font-semibold text-navy-950 mt-0.5">Forecast {fmtDate(r.finish)} vs required {fmtDate(r.required)} — here is what it means and how to recover</div>
        </div>
        {open ? <ChevronDown size={16} className="text-warm-500 mt-1" /> : <ChevronRight size={16} className="text-warm-500 mt-1" />}
      </button>
      {open && (
        <>
          <div className="mt-3 space-y-1.5">{r.explanation.map((e, i) => <p key={i} className="text-[13px] text-warm-700">{fmtDates(e)}</p>)}</div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-500 mt-4 mb-2">Your options (each re-scheduled on the real network)</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {r.options.map(o => (
              <div key={o.id} className="bg-warm-50 border border-warm-200 rounded-lg p-4 flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[13.5px] font-semibold text-navy-950">{o.title}</div>
                  {o.id !== 'move_date' && <span className={`text-[11px] font-semibold uppercase whitespace-nowrap ${o.meetsDate ? 'text-status-on-track' : o.daysSaved > 0 ? 'text-status-attention' : 'text-warm-400'}`}>{o.meetsDate ? 'Meets date' : o.daysSaved > 0 ? `Saves ${o.daysSaved}d` : 'No gain'}</span>}
                </div>
                <p className="text-[12.5px] text-warm-600 mt-1">{o.description}</p>
                <p className="text-[12px] text-warm-500 mt-1"><span className="font-medium">Trade-off:</span> {o.tradeoff}</p>
                {o.impact && (
                  <dl className="text-[12px] text-warm-600 mt-2 border-t border-warm-200 pt-2 space-y-1">
                    <div><dt className="inline font-medium text-warm-700">Resources: </dt><dd className="inline">{o.impact.resources}</dd></div>
                    <div>
                      <dt className="inline font-medium text-warm-700">Added cost: </dt>
                      <dd className="inline">
                        {o.impact.cost ? <span className="font-semibold text-navy-950 tabular-nums">{o.impact.cost.high === 0 ? '$0' : `${usd(o.impact.cost.low)}–${usd(o.impact.cost.high)}`}</span> : 'not priced'}
                        <span className="text-warm-500"> · {o.impact.costBasis}</span>
                      </dd>
                    </div>
                    {o.impact.delaySavings != null && <div><dt className="inline font-medium text-warm-700">Delay cost avoided: </dt><dd className="inline font-semibold text-status-on-track tabular-nums">{usd(o.impact.delaySavings)}</dd></div>}
                  </dl>
                )}
                <div className="flex items-center justify-between mt-auto pt-3">
                  <span className="text-[12px] text-warm-500">New finish <span className="font-semibold text-navy-950 tabular-nums">{fmtDate(o.newFinish)}</span></span>
                  {o.apply.type === 'navigate'
                    ? <button onClick={onInterview} className="bg-navy-900 text-white px-3 py-1.5 rounded-md text-[12.5px] font-medium">Answer questions</button>
                    : <button disabled={!!busy} onClick={() => { if (confirm(`Apply “${o.title}”? You can override or undo any change afterwards.`)) onRecover(o.id) }} className="bg-navy-900 text-white px-3 py-1.5 rounded-md text-[12.5px] font-medium disabled:opacity-40">{busy === 'recover' ? <Loader2 size={12} className="animate-spin" /> : 'Apply'}</button>}
                </div>
              </div>
            ))}
          </div>
          {r.combined && <p className="text-[12.5px] text-warm-600 mt-3">Combining the modeled levers would finish <span className="font-semibold text-navy-950">{fmtDate(r.combined.newFinish)}</span> — {r.combined.meetsDate ? 'enough to meet the date.' : 'still after the required date.'} Apply them one at a time to see each effect.</p>}
        </>
      )}
    </div>
  )
}

function AddActivity({ activities, onEdit, busy }: { activities: PlanActivity[]; onEdit: (e: EditBody) => Promise<boolean>; busy: string | null }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [dur, setDur] = useState('10')
  const [after, setAfter] = useState('')
  const [before, setBefore] = useState('')
  const [reason, setReason] = useState('')
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mb-3 text-[13px] font-medium text-accent-600 hover:underline">+ Add an activity the tool doesn&apos;t know about</button>
    )
  }
  const opt = (a: PlanActivity) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>
  return (
    <div className="bg-warm-100 border border-warm-200 rounded-lg p-4 mb-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-2">Add an activity</div>
      <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Activity name, e.g. Owner kitchen equipment install" maxLength={200} className="md:col-span-4 bg-warm-50 border border-warm-300 rounded-md px-2.5 py-1.5 text-[13px]" />
        <div className="md:col-span-2 flex items-center gap-2">
          <input type="number" min={0} value={dur} onChange={e => setDur(e.target.value)} className="w-20 bg-warm-50 border border-warm-300 rounded-md px-2.5 py-1.5 text-[13px]" />
          <span className="text-[12px] text-warm-500">work days (0 = milestone)</span>
        </div>
        <select value={after} onChange={e => setAfter(e.target.value)} className="md:col-span-3 bg-warm-50 border border-warm-300 rounded-md px-2 py-1.5 text-[12.5px]">
          <option value="">Starts after…</option>{activities.map(opt)}
        </select>
        <select value={before} onChange={e => setBefore(e.target.value)} className="md:col-span-3 bg-warm-50 border border-warm-300 rounded-md px-2 py-1.5 text-[12.5px]">
          <option value="">Must finish before… (default: substantial completion)</option>{activities.map(opt)}
        </select>
        <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (required, kept in the audit trail)" className="md:col-span-4 bg-warm-50 border border-warm-300 rounded-md px-2.5 py-1.5 text-[13px]" />
        <div className="md:col-span-2 flex gap-2">
          <button disabled={!!busy || !name.trim() || !after || !reason.trim()} onClick={async () => {
            if (await onEdit({ kind: 'add_activity', name, duration: Number(dur) || 0, after, before: before || undefined, reason })) { setName(''); setReason(''); setOpen(false) }
          }} className="flex-1 bg-navy-900 text-white rounded-md text-[13px] font-medium py-1.5 disabled:opacity-40">Add</button>
          <button onClick={() => setOpen(false)} className="px-3 border border-warm-300 rounded-md text-[13px] text-warm-600">Cancel</button>
        </div>
      </div>
    </div>
  )
}

function ActivityRows({ a, tm, left, width, open, onToggle, links, byId, onEdit, busy }: {
  a: PlanActivity; tm?: { earlyStart: string; earlyFinish: string; lateStart: string; lateFinish: string; totalFloat: number; freeFloat: number; critical: boolean }
  left: number; width: number; open: boolean; onToggle: () => void
  links: PlanLink[]; byId: Map<string, PlanActivity>; onEdit: (e: EditBody) => Promise<boolean>; busy: string | null
}) {
  const preds = links.filter(l => l.to === a.id)
  const succs = links.filter(l => l.from === a.id)
  const [dur, setDur] = useState(String(a.duration))
  const [reason, setReason] = useState('')
  const [linkTarget, setLinkTarget] = useState('')
  const [linkType, setLinkType] = useState('FS')
  const [linkLag, setLinkLag] = useState('0')

  return (
    <>
      <tr onClick={onToggle} className={`border-b border-warm-200 cursor-pointer hover:bg-warm-50 ${a.placeholder ? 'bg-warm-200/40' : ''}`}>
        <td className="px-3 py-2 text-warm-400">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</td>
        <td className="px-2 py-2 font-mono text-[11.5px] text-warm-500">{a.code}</td>
        <td className="px-2 py-2 text-navy-950">
          <div className="flex items-center gap-1.5">
            {a.placeholder && <Lock size={11} className="text-warm-500 flex-shrink-0" />}
            <span className={tm?.critical ? 'font-semibold' : ''}>{a.name}</span>
            {a.overrides?.length ? <span className="text-[10px] text-accent-600 font-semibold uppercase">edited</span> : null}
          </div>
        </td>
        <td className="px-2 py-2 text-right tabular-nums">{a.type === 'milestone' ? '◆' : a.duration}{a.calendarId === 'cal-7d' && a.type !== 'milestone' ? <span className="text-warm-400">cd</span> : ''}</td>
        <td className="px-2 py-2 tabular-nums text-warm-600 whitespace-nowrap">{fmtDate(tm?.earlyStart)}</td>
        <td className="px-2 py-2 tabular-nums text-warm-600 whitespace-nowrap">{fmtDate(tm?.earlyFinish)}</td>
        <td className={`px-2 py-2 text-right tabular-nums ${tm && tm.totalFloat < 0 ? 'text-status-at-risk font-semibold' : tm?.critical ? 'text-status-attention font-semibold' : 'text-warm-600'}`}>{tm?.totalFloat}</td>
        <td className="px-2 py-2"><span className={`text-[10.5px] font-semibold uppercase border-l-2 pl-1 ${CONF_STYLE[a.rationale.confidence]}`}>{a.rationale.confidence}</span></td>
        <td className="px-3 py-2">
          <div className="relative h-2.5 bg-warm-200/60 rounded-sm">
            <div className={`absolute top-0 h-full rounded-sm ${tm?.critical ? 'bg-status-attention' : a.placeholder ? 'bg-warm-400' : 'bg-accent-500'}`} style={{ left: `${left}%`, width: `${width}%` }} />
          </div>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-warm-200 bg-warm-50">
          <td />
          <td colSpan={8} className="px-2 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-1">Why this duration</div>
                <p className="text-[13px] text-warm-700">{fmtDates(a.rationale.summary)}</p>
                <Sources sources={a.rationale.sources} />
                {a.rationale.assumptions?.map((x, i) => <p key={i} className="text-[12px] text-warm-500 mt-1.5">Assumes: {fmtDates(x)}</p>)}
                {tm && <p className="text-[12px] text-warm-500 mt-2 tabular-nums">Late start {fmtDate(tm.lateStart)} · late finish {fmtDate(tm.lateFinish)} · free float {tm.freeFloat}d</p>}

                <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400 mt-4 mb-1">Why it is sequenced here</div>
                {preds.length === 0 && <p className="text-[12.5px] text-warm-500">No predecessors (project start).</p>}
                {preds.map(l => <LinkRow key={l.id} l={l} other={byId.get(l.from)} dir="after" onEdit={onEdit} busy={busy} />)}
                {succs.map(l => <LinkRow key={l.id} l={l} other={byId.get(l.to)} dir="before" onEdit={onEdit} busy={busy} />)}
              </div>

              <div className="space-y-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400">Override (your call wins)</div>
                <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (required, kept in the audit trail)"
                  className="w-full bg-warm-100 border border-warm-300 rounded-md px-2.5 py-1.5 text-[13px] text-warm-700" />
                {a.type !== 'milestone' && (
                  <div className="flex gap-2 items-center">
                    <input type="number" min={0} value={dur} onChange={e => setDur(e.target.value)} className="w-24 bg-warm-100 border border-warm-300 rounded-md px-2.5 py-1.5 text-[13px]" />
                    <span className="text-[12px] text-warm-500">work days</span>
                    <button disabled={!!busy || !reason.trim() || Number(dur) === a.duration} onClick={async () => { if (await onEdit({ kind: 'duration', activityId: a.id, value: Number(dur), reason })) setReason('') }}
                      className="bg-navy-900 text-white px-3 py-1.5 rounded-md text-[12.5px] font-medium disabled:opacity-40">Set duration</button>
                  </div>
                )}
                <div className="flex flex-wrap gap-2 items-center">
                  <Link2 size={13} className="text-warm-400" />
                  <select value={linkTarget} onChange={e => setLinkTarget(e.target.value)} className="flex-1 min-w-[160px] bg-warm-100 border border-warm-300 rounded-md px-2 py-1.5 text-[12.5px]">
                    <option value="">Add successor…</option>
                    {[...byId.values()].filter(x => x.id !== a.id).map(x => <option key={x.id} value={x.id}>{x.code} {x.name}</option>)}
                  </select>
                  <select value={linkType} onChange={e => setLinkType(e.target.value)} className="bg-warm-100 border border-warm-300 rounded-md px-2 py-1.5 text-[12.5px]">
                    {['FS', 'SS', 'FF', 'SF'].map(x => <option key={x}>{x}</option>)}
                  </select>
                  <input type="number" value={linkLag} onChange={e => setLinkLag(e.target.value)} title="Lag (work days)" className="w-16 bg-warm-100 border border-warm-300 rounded-md px-2 py-1.5 text-[12.5px]" />
                  <button disabled={!!busy || !reason.trim() || !linkTarget} onClick={async () => { if (await onEdit({ kind: 'add_link', from: a.id, to: linkTarget, type: linkType, lag: Number(linkLag) || 0, reason })) { setReason(''); setLinkTarget('') } }}
                    className="bg-navy-900 text-white px-3 py-1.5 rounded-md text-[12.5px] font-medium disabled:opacity-40">Link</button>
                </div>
                {!['ntp', 'substantial_completion', 'final_completion'].includes(a.category) && (
                  <button disabled={!!busy || !reason.trim()} onClick={async () => { if (confirm(`Remove ${a.code}? Its predecessors will be linked to its successors.`)) await onEdit({ kind: 'remove_activity', activityId: a.id, reason }) }}
                    className="flex items-center gap-1 text-[12.5px] text-status-at-risk disabled:opacity-40"><Trash2 size={12} /> Remove activity</button>
                )}
                {a.overrides?.map((o, i) => (
                  <p key={i} className="text-[12px] text-warm-500">{fmtDateTime(o.at)} — {o.by}: {o.field} {o.from !== undefined ? `${String(o.from)} → ` : ''}{String(o.to ?? '')} · “{o.reason}”</p>
                ))}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function LinkRow({ l, other, dir, onEdit, busy }: { l: PlanLink; other?: PlanActivity; dir: 'after' | 'before'; onEdit: (e: EditBody) => Promise<boolean>; busy: string | null }) {
  const remove = async () => {
    const reason = prompt('Why remove this relationship? (kept in the audit trail)')
    if (reason && reason.trim()) await onEdit({ kind: 'remove_link', linkId: l.id, reason })
  }
  return (
    <div className="text-[12.5px] text-warm-600 py-1 flex gap-2 items-start">
      <span className="font-mono text-[11px] text-warm-500 flex-shrink-0 mt-0.5">{dir === 'after' ? '←' : '→'} {l.type}{l.lag ? `${l.lag > 0 ? '+' : ''}${l.lag}` : ''}</span>
      <span className="flex-1"><span className="font-medium text-navy-950">{other?.code} {other?.name}</span> — {fmtDates(l.rationale.summary)}</span>
      <button disabled={!!busy} onClick={remove} title="Remove relationship" className="text-warm-400 hover:text-status-at-risk flex-shrink-0"><X size={12} /></button>
    </div>
  )
}

/* ─── Evaluation & expert review ─────────────────────── */

type Guide = View['guidance'][number]

function EvaluationTab({ ev, plan, sra, onSra, busy, onReview, guidance, recovery, onRecover, onDecide, onShowCodes, onInterview }: {
  ev: Evaluation; plan: Plan; sra: Sra | null; onSra: (r: Sra | null) => void; busy: string | null; onReview: (b: Record<string, string>) => Promise<boolean>
  guidance: Guide[]; recovery: RecoveryPlan | null; onRecover: (id: string) => void
  onDecide: (key: string, decision: 'accept' | 'fix' | null, note: string) => Promise<boolean>
  onShowCodes: (codes: string[]) => void; onInterview: () => void
}) {
  const [verdict, setVerdict] = useState('approve')
  const [comment, setComment] = useState('')
  const [reviewer, setReviewer] = useState('')
  const fc = headline(ev, sra)!
  const resultStyle = (r: string) => r === 'pass' ? 'text-status-on-track' : r === 'fail' ? 'text-status-at-risk' : r === 'warn' ? 'text-status-attention' : 'text-warm-400'

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Overall" value={`${ev.grade} · ${ev.score}`} sub="DCMA 35% · readiness 20% · realism 20% · coverage 15% · review 10%" />
        <Stat label="DCMA 14-point" value={`${ev.dcma.passed}/${ev.dcma.applicable}`} sub="applicable checks passing" />
        <Stat label={`P50 · ${fc.label}`} value={fmtDate(fc.p50)} sub={`deterministic ${fmtDate(ev.forecast.deterministic)}`} />
        <Stat label={`P80 · ${fc.label}`} value={fmtDate(fc.p80)} sub={fc.required ? `required ${fmtDate(fc.required)}${fc.meets ? ' ✓' : ' ✗'}` : 'risk-adjusted'} />
      </div>
      <p className="text-[12px] text-warm-500 -mt-2">
        {fc.method === 'monte_carlo'
          ? 'P50 and P80 come from the Monte Carlo simulation below.'
          : <>P50 and P80 are a quick rule-based estimate, not a simulation, until the Monte Carlo analysis below has run. Basis: {ev.forecast.basis}</>}
      </p>

      <RiskPanel planId={plan.id} r={sra} onResult={onSra} />

      {recovery && <RecoveryPanel r={recovery} busy={busy} onRecover={onRecover} onInterview={onInterview} />}

      {guidance.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-2">What needs your decision — {guidance.filter(g => !g.decision).length} of {guidance.length} open</div>
          <div className="space-y-3">
            {guidance.map(g => <GuideCard key={g.id} g={g} check={ev.dcma.checks.find(c => c.id === g.id)!} busy={busy} onDecide={onDecide} onShowCodes={onShowCodes} onInterview={onInterview} />)}
          </div>
        </div>
      )}

      {ev.dateChecks.length > 0 && (
        <div className="bg-warm-100 border border-warm-200 rounded-lg p-5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-2">Your dates vs. what the logic can achieve</div>
          <ul className="space-y-1.5">
            {ev.dateChecks.map((c, i) => (
              <li key={i} className="text-[13px] text-warm-700 flex gap-2">
                {c.severity === 'info' ? <CheckCircle2 size={13} className="text-status-on-track flex-shrink-0 mt-0.5" /> : <AlertTriangle size={13} className={`${c.severity === 'error' ? 'text-status-at-risk' : 'text-status-attention'} flex-shrink-0 mt-0.5`} />}
                <span>{fmtDates(c.text)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {ev.findings.length > 0 && (
        <div className="bg-warm-100 border border-warm-200 rounded-lg p-5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-2">Findings</div>
          <ul className="space-y-1.5">{ev.findings.map((f, i) => <li key={i} className="text-[13px] text-warm-700 flex gap-2"><AlertTriangle size={13} className="text-status-attention flex-shrink-0 mt-0.5" />{fmtDates(f)}</li>)}</ul>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-warm-100 border border-warm-200 rounded-lg p-5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-2">DCMA 14-point assessment</div>
          <table className="w-full text-[12.5px]">
            <tbody>
              {ev.dcma.checks.map(c => (
                <tr key={c.id} className="border-b border-warm-200 last:border-0" title={c.explanation}>
                  <td className="py-1.5 pr-2 text-warm-400 tabular-nums">{c.id}</td>
                  <td className="py-1.5 pr-2 text-navy-950">{c.name}</td>
                  <td className="py-1.5 pr-2 text-warm-600 tabular-nums">{c.metric}</td>
                  <td className="py-1.5 pr-2 text-warm-400">{c.threshold}</td>
                  <td className={`py-1.5 font-semibold uppercase text-[11px] ${resultStyle(c.result)}`}>{c.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-5">
          <div className="bg-warm-100 border border-warm-200 rounded-lg p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-2">Against how your projects actually went</div>
            <p className="text-[12px] text-warm-500 mb-2">{ev.benchmark.basis}</p>
            {ev.benchmark.rows.length === 0 ? <p className="text-[13px] text-warm-500">No comparable activities yet.</p> : (
              <table className="w-full text-[12.5px]">
                <thead><tr className="text-left text-[10.5px] uppercase tracking-wider text-warm-400"><th className="py-1">Activity</th><th className="py-1 text-right">Plan</th><th className="py-1 text-right">Firm P20–P80</th><th className="py-1 pl-2">Verdict</th></tr></thead>
                <tbody>
                  {ev.benchmark.rows.map(r => (
                    <tr key={r.activityId} className="border-t border-warm-200">
                      <td className="py-1.5 text-navy-950">{r.code} {r.name}</td>
                      <td className="py-1.5 text-right tabular-nums">{r.planned}</td>
                      <td className="py-1.5 text-right tabular-nums text-warm-600">{r.firmP20}–{r.firmP80}</td>
                      <td className={`py-1.5 pl-2 text-[11px] font-semibold uppercase ${r.verdict === 'optimistic' ? 'text-status-at-risk' : r.verdict === 'conservative' ? 'text-status-info' : 'text-status-on-track'}`}>{r.verdict.replace('_', ' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="bg-warm-100 border border-warm-200 rounded-lg p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-2">Coverage of grounded requirements</div>
            {ev.coverage.length === 0 && <p className="text-[13px] text-warm-500">No permits or long-lead items apply yet — answer facility type and state.</p>}
            <ul className="space-y-1">
              {ev.coverage.map((c, i) => (
                <li key={i} className="text-[12.5px] flex gap-2">
                  <span className={`font-semibold uppercase text-[10.5px] w-20 flex-shrink-0 ${c.status === 'missing' ? 'text-status-at-risk' : c.status === 'scheduled' ? 'text-status-on-track' : 'text-warm-500'}`}>{c.status}</span>
                  <span className="text-navy-950">{c.item}</span><span className="text-warm-400">— {c.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="bg-warm-100 border border-warm-200 rounded-lg p-5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-2">Expert review {ev.review.status !== 'none' && <span className="normal-case tracking-normal font-normal">— {ev.review.status.replace('_', ' ')}</span>}</div>
        {plan.reviews.map(r => (
          <div key={r.id} className="text-[13px] text-warm-700 border-l-2 border-warm-300 pl-3 mb-2">
            <span className="font-semibold text-navy-950">{r.reviewer}</span> · {fmtDateTime(r.at)} · <span className="uppercase text-[11px] font-semibold">{r.verdict.replace(/_/g, ' ')}</span>
            {r.comment && <div className="text-warm-600 mt-0.5">{r.comment}</div>}
          </div>
        ))}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3">
          <select value={verdict} onChange={e => setVerdict(e.target.value)} className="bg-warm-50 border border-warm-300 rounded-md px-2.5 py-2 text-[13px]">
            <option value="approve">Approve</option><option value="approve_with_comments">Approve with comments</option><option value="reject">Changes required</option>
          </select>
          <input value={reviewer} onChange={e => setReviewer(e.target.value)} placeholder="Reviewer name (if not you)" className="bg-warm-50 border border-warm-300 rounded-md px-2.5 py-2 text-[13px]" />
          <button disabled={!!busy} onClick={async () => { if (await onReview({ verdict, comment, reviewer })) setComment('') }} className="bg-navy-900 text-white rounded-md text-[13px] font-medium py-2 disabled:opacity-50">Record review</button>
          <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="Comments — logic, durations, missing scope…" rows={3} className="md:col-span-3 bg-warm-50 border border-warm-300 rounded-md px-2.5 py-2 text-[13px]" />
        </div>
      </div>
    </div>
  )
}

function GuideCard({ g, check, busy, onDecide, onShowCodes, onInterview }: {
  g: Guide; check: Evaluation['dcma']['checks'][number]; busy: string | null
  onDecide: (key: string, decision: 'accept' | 'fix' | null, note: string) => Promise<boolean>
  onShowCodes: (codes: string[]) => void; onInterview: () => void
}) {
  const [open, setOpen] = useState(!g.decision)
  const accept = g.actions.find(a => a.kind === 'accept') as Extract<Guide['actions'][number], { kind: 'accept' }> | undefined
  const [note, setNote] = useState(accept?.suggestedNote || '')
  const [accepting, setAccepting] = useState(false)
  const key = `dcma:${g.id}`
  return (
    <div className={`border rounded-lg ${g.decision ? 'bg-warm-50 border-warm-200' : 'bg-warm-100 border-status-attention/50'}`}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 px-5 py-3 text-left">
        <span className={`text-[10.5px] font-bold uppercase ${check.result === 'fail' ? 'text-status-at-risk' : 'text-status-attention'}`}>#{g.id} {check.result}</span>
        <span className="text-[13.5px] font-semibold text-navy-950 flex-1">{check.name} <span className="font-normal text-warm-500">— {check.metric} (target {check.threshold})</span></span>
        {g.decision && <span className="text-[11px] font-semibold uppercase text-status-on-track">{g.decision.decision === 'accept' ? 'Accepted' : 'To fix'}</span>}
        {open ? <ChevronDown size={14} className="text-warm-400" /> : <ChevronRight size={14} className="text-warm-400" />}
      </button>
      {open && (
        <div className="px-5 pb-4 space-y-2.5">
          <p className="text-[13px] text-warm-700"><span className="font-semibold text-navy-950">What it means: </span>{g.meaning}</p>
          {g.whyItMatters && <p className="text-[13px] text-warm-700"><span className="font-semibold text-navy-950">Why it matters: </span>{g.whyItMatters}</p>}
          {g.steps.length > 0 && (
            <div>
              <div className="text-[12.5px] font-semibold text-navy-950">How to fix it</div>
              <ol className="list-decimal ml-5 text-[13px] text-warm-700 space-y-0.5 mt-0.5">{g.steps.map((st, i) => <li key={i}>{st}</li>)}</ol>
            </div>
          )}
          {check.offenders.length > 0 && <p className="text-[12px] text-warm-500">Flagged: {check.offenders.slice(0, 12).join(', ')}{check.offenders.length > 12 ? ` and ${check.offenders.length - 12} more` : ''}</p>}
          {g.decision && (
            <p className="text-[12.5px] text-warm-600 border-l-2 border-status-on-track pl-2">
              {g.decision.decision === 'accept' ? 'Accepted' : 'Marked to fix'} by {g.decision.by} on {fmtDateTime(g.decision.at)}{g.decision.note ? ` — “${g.decision.note}”` : ''}
              <button onClick={() => onDecide(key, null, '')} className="ml-2 underline text-warm-500">Undo</button>
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            {g.actions.map((a, i) => a.kind === 'filter'
              ? <button key={i} onClick={() => onShowCodes(a.codes)} className="px-3 py-1.5 rounded-md border border-warm-300 bg-warm-50 text-[12.5px] text-navy-950 hover:border-navy-900">{a.label}</button>
              : a.kind === 'recovery'
                ? <button key={i} onClick={() => document.getElementById('recovery')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="px-3 py-1.5 rounded-md bg-navy-900 text-white text-[12.5px] font-medium">{a.label}</button>
                : a.kind === 'interview'
                  ? <button key={i} onClick={onInterview} className="px-3 py-1.5 rounded-md border border-warm-300 bg-warm-50 text-[12.5px] text-navy-950 hover:border-navy-900">{a.label}</button>
                  : !g.decision && <button key={i} onClick={() => setAccepting(x => !x)} className="px-3 py-1.5 rounded-md border border-warm-300 bg-warm-50 text-[12.5px] text-navy-950 hover:border-navy-900">{a.label}…</button>)}
            {!g.decision && !accept && (
              <button onClick={() => setAccepting(x => !x)} className="px-3 py-1.5 rounded-md border border-dashed border-warm-400 text-[12.5px] text-warm-600 hover:border-navy-900">Accept with justification…</button>
            )}
            {!g.decision && <button disabled={!!busy} onClick={() => onDecide(key, 'fix', '')} className="px-3 py-1.5 rounded-md border border-warm-300 bg-warm-50 text-[12.5px] text-navy-950 hover:border-navy-900">I&apos;ll fix it</button>}
          </div>
          {accepting && !g.decision && (
            <div className="flex flex-col gap-2">
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Why this is acceptable for this project (goes into the Basis of Schedule)" className="bg-warm-50 border border-warm-300 rounded-md px-2.5 py-2 text-[13px]" />
              <button disabled={!!busy || note.trim().length < 10} onClick={async () => { if (await onDecide(key, 'accept', note)) setAccepting(false) }} className="self-start bg-navy-900 text-white px-3 py-1.5 rounded-md text-[12.5px] font-medium disabled:opacity-40">Record decision</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-warm-100 border border-warm-200 rounded-lg p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400">{label}</div>
      <div className="text-[18px] font-semibold text-navy-950 tabular-nums mt-1">{value}</div>
      {sub && <div className="text-[11px] text-warm-400 mt-0.5">{sub}</div>}
    </div>
  )
}

/* ─── Monte Carlo schedule risk analysis ─────────────── */

interface Sra {
  method: string; iterations: number; deterministic: string
  percentiles: { p10: string; p50: string; p80: string; p90: string; mean: string }
  required?: { date: string; probability: number }
  histogram: { from: string; to: string; count: number }[]
  criticality: { id: string; code: string; name: string; index: number }[]
  sensitivity: { id: string; code: string; name: string; correlation: number; criticality: number; basis: string }[]
  assumptions: string[]
}

function RiskPanel({ planId, r, onResult }: { planId: string; r: Sra | null; onResult: (r: Sra | null) => void }) {
  const [state, setState] = useState<'idle' | 'running' | 'error'>('idle')
  const run = useCallback(async () => {
    setState('running')
    try {
      const res = await fetch(`/api/plans/${planId}/risk`)
      if (!res.ok) throw new Error()
      onResult(await res.json()); setState('idle')
    } catch { setState('error') }
  }, [planId, onResult])
  // Run once when the evaluation opens, so the forecast shown is the simulation rather than the quick estimate.
  // (Also after an edit, which clears the result; a failed run waits for the button.)
  useEffect(() => { if (!r && state === 'idle') run() }, [r, state, run])
  const max = r ? Math.max(...r.histogram.map(h => h.count)) : 1
  const pct = (x: number) => `${Math.round(x * 100)}%`
  return (
    <section aria-labelledby="sra-title" className="border border-warm-200 rounded-lg p-4 bg-warm-50">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h3 id="sra-title" className="text-[14px] font-semibold text-navy-950">Schedule risk analysis (Monte Carlo)</h3>
        <button onClick={run} disabled={state === 'running'} className="flex items-center gap-1.5 bg-navy-900 text-white px-3 py-1.5 rounded-md text-[12.5px] font-medium disabled:opacity-50">
          {state === 'running' && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}{r ? 'Run again' : 'Run simulation'}
        </button>
      </div>
      {!r && state !== 'running' && <p className="text-[12.5px] text-warm-500">Simulates the whole network hundreds of times with realistic ranges for every activity, to show how likely each finish date is and which activities drive the risk.</p>}
      {state === 'error' && <p role="alert" className="text-[12.5px] text-status-at-risk">The simulation could not run. Try again.</p>}
      {r && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {([['P10', r.percentiles.p10], ['P50', r.percentiles.p50], ['P80', r.percentiles.p80], ['P90', r.percentiles.p90], ['Deterministic', r.deterministic]] as const).map(([l, d]) => (
              <div key={l} className="bg-warm-100 border border-warm-200 rounded-md px-3 py-2">
                <div className="text-[10.5px] uppercase tracking-wider text-warm-500 font-semibold">{l}</div>
                <div className="text-[15px] font-semibold text-navy-950 tabular-nums">{fmtDate(d)}</div>
              </div>
            ))}
          </div>
          {r.required && (
            <p className="text-[13px] text-warm-700">
              Chance of finishing by the required {fmtDate(r.required.date)}: <span className={`font-semibold ${r.required.probability >= 0.8 ? 'text-status-on-track' : r.required.probability >= 0.5 ? 'text-status-attention' : 'text-status-at-risk'}`}>{pct(r.required.probability)}</span>
              {r.required.probability < 0.8 && ' — below the usual 80% confidence target; see the recovery options and the drivers below.'}
            </p>
          )}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-500 mb-1">Finish date distribution ({r.iterations.toLocaleString()} runs)</div>
            <div className="flex items-end gap-0.5 h-24" role="img" aria-label={`Histogram of simulated finish dates from ${fmtDate(r.histogram[0]?.from)} to ${fmtDate(r.histogram[r.histogram.length - 1]?.to)}; median ${fmtDate(r.percentiles.p50)}.`}>
              {r.histogram.map((h, i) => (
                <div key={i} title={`${fmtDate(h.from)}–${fmtDate(h.to)}: ${h.count} runs`} className={`flex-1 rounded-t ${r.required && h.to <= r.required.date ? 'bg-status-on-track/70' : 'bg-accent-500/70'}`} style={{ height: `${Math.max(2, (h.count / max) * 100)}%` }} />
              ))}
            </div>
            <div className="flex justify-between text-[11px] text-warm-500 mt-1"><span>{fmtDate(r.histogram[0]?.from)}</span><span>{fmtDate(r.histogram[r.histogram.length - 1]?.to)}</span></div>
          </div>
          {r.sensitivity.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-500 mb-1">What drives the risk</div>
              <table className="w-full text-[12.5px]">
                <caption className="sr-only">Activities whose uncertainty moves the finish date most</caption>
                <thead><tr className="text-left text-[10.5px] uppercase tracking-wider text-warm-500"><th scope="col" className="py-1">Activity</th><th scope="col" className="py-1 text-right">Sensitivity</th><th scope="col" className="py-1 text-right">Critical in</th><th scope="col" className="py-1 pl-3 hidden md:table-cell">Range used</th></tr></thead>
                <tbody>
                  {r.sensitivity.map(s => (
                    <tr key={s.id} className="border-t border-warm-200">
                      <td className="py-1.5"><span className="font-mono text-warm-500 mr-1.5">{s.code}</span>{s.name}</td>
                      <td className="py-1.5 text-right tabular-nums">{s.correlation.toFixed(2)}</td>
                      <td className="py-1.5 text-right tabular-nums">{pct(s.criticality)}</td>
                      <td className="py-1.5 pl-3 text-warm-500 hidden md:table-cell">{s.basis}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[11.5px] text-warm-500 mt-1">Sensitivity is the rank correlation between the activity&apos;s duration and the finish date across runs (1.00 = moves the finish one-for-one). &quot;Critical in&quot; is the share of runs in which the activity was on the critical path.</p>
            </div>
          )}
          <details className="text-[12px] text-warm-600">
            <summary className="cursor-pointer text-warm-700 font-medium">Method and assumptions</summary>
            <p className="mt-1.5">{r.method}</p>
            <ul className="list-disc ml-5 mt-1 space-y-0.5">{r.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
          </details>
        </div>
      )}
    </section>
  )
}

/* ─── Audit ──────────────────────────────────────────── */

interface AuditRecord { seq: number; at: string; actorEmail: string | null; action: string; detail: Record<string, unknown>; ip: string | null; hash: string }

function AuditTab({ plan, onDelete, fullLog }: { plan: Plan; onDelete?: () => void; fullLog: boolean }) {
  // Reviewers/admins see the complete, tamper-evident record (who, when, from where, hash);
  // others see the plan's own change history.
  const [records, setRecords] = useState<AuditRecord[] | null>(null)
  useEffect(() => {
    if (!fullLog) return
    fetch(`/api/audit?targetType=plan&targetId=${plan.id}&limit=1000`).then(r => r.ok ? r.json() : null).then(d => d && setRecords(d.events)).catch(() => {})
  }, [fullLog, plan.id, plan.version])
  return (
    <div>
      {records ? (
        <>
          <p className="text-[12.5px] text-warm-500 mb-2">Complete record from the organization audit log ({records.length} entries). Each entry is hash-chained; verify integrity or download the full log under Organization.</p>
          <div className="bg-warm-100 border border-warm-200 rounded-lg divide-y divide-warm-200">
            {records.length === 0 && <p className="p-5 text-[13px] text-warm-500">Nothing recorded yet.</p>}
            {records.map(e => (
              <div key={e.seq} className="px-4 py-2.5 text-[12.5px] flex flex-col sm:flex-row gap-1 sm:gap-3">
                <span className="text-warm-500 tabular-nums sm:w-36 flex-shrink-0">{fmtDateTime(e.at)}</span>
                <span className="text-navy-950 sm:w-44 flex-shrink-0 truncate" title={e.ip ? `from ${e.ip}` : undefined}>{e.actorEmail || 'system'}</span>
                <span className="text-warm-600 min-w-0"><span className="font-medium">{e.action.replace(/^plan\./, '')}</span>{e.detail?.detail ? ` — ${fmtDates(String(e.detail.detail))}` : e.detail?.format ? ` — ${String(e.detail.format)}` : ''}</span>
                <span className="sm:ml-auto font-mono text-[10.5px] text-warm-400 flex-shrink-0" title={`hash ${e.hash}`}>#{e.seq} · {e.hash.slice(0, 8)}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="bg-warm-100 border border-warm-200 rounded-lg divide-y divide-warm-200">
          {plan.audit.length === 0 && <p className="p-5 text-[13px] text-warm-500">Nothing recorded yet.</p>}
          {[...plan.audit].reverse().map((e, i) => (
            <div key={i} className="px-4 py-2.5 text-[12.5px] flex gap-3">
              <span className="text-warm-500 tabular-nums w-36 flex-shrink-0">{fmtDateTime(e.at)}</span>
              <span className="text-navy-950 w-28 flex-shrink-0 truncate">{e.by}</span>
              <span className="text-warm-600"><span className="font-medium">{e.action}</span>{e.detail ? ` — ${fmtDates(e.detail)}` : ''}</span>
            </div>
          ))}
        </div>
      )}
      {onDelete && <button onClick={onDelete} className="mt-4 flex items-center gap-1 text-[12.5px] text-status-at-risk"><Trash2 size={12} aria-hidden="true" /> Delete plan</button>}
    </div>
  )
}
