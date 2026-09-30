'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Loader2, HelpCircle, Lock, Sparkles, Play, Download, Send, ChevronDown, ChevronRight,
  AlertTriangle, CheckCircle2, Trash2, Link2, X,
} from 'lucide-react'
import type {
  Answer, Assumption, ElicitationResult, GeneratedSchedule, PlanActivity, PlanLink, Question, SourceRef,
} from '@/lib/planning/types'
import type { Evaluation } from '@/lib/planning/evaluation'
import type { EditImpact } from '@/lib/planning/overrides'

interface Review { id: string; reviewer: string; verdict: string; comment: string; at: string }
interface Plan {
  id: string; name: string; answers: Record<string, Answer>; generated: GeneratedSchedule | null
  reviews: Review[]; audit: { at: string; by: string; action: string; detail?: string }[]; scheduleId: string | null
}
interface View {
  plan: Plan; elicitation: ElicitationResult; evaluation: Evaluation | null
  llm: { mode: 'cloud' | 'local' | 'offline'; airgapped: boolean; model: string | null; error?: string }
  history: { projectCount: number; similarCount: number } | null
  answered: { id: string; prompt: string; section: string; label: string; status: string }[]
}

type Tab = 'interview' | 'schedule' | 'evaluation' | 'audit'

const SECTION_LABEL: Record<string, string> = {
  project: 'Project', design: 'Design', permits: 'Permits', procurement: 'Long-lead', site: 'Site',
  regulatory: 'Regulatory', calendar: 'Calendar', security: 'Security', history: 'Firm history',
}
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

  const load = useCallback(async () => {
    const res = await fetch(`/api/plans/${id}`)
    const data = await res.json()
    if (!res.ok) { setError(data.error || 'Could not load plan.'); return }
    setView(data)
  }, [id])
  useEffect(() => { load() }, [load])

  const call = async (key: string, url: string, init: RequestInit): Promise<Record<string, unknown> | null> => {
    setBusy(key); setError('')
    try {
      const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init })
      const data = await res.json()
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

  const saveAnswer = async (qid: string, a: Partial<Answer>) => {
    const data = await call(`answer:${qid}`, `/api/plans/${id}`, { method: 'PATCH', body: JSON.stringify({ answers: { [qid]: a } }) })
    const errs = data?.errors as Record<string, string> | undefined
    if (errs && errs[qid]) setError(errs[qid])
  }
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

  return (
    <div className="px-4 md:px-6 py-6 md:py-8">
      <Link href="/dashboard/plan" className="inline-flex items-center gap-1 text-[12.5px] text-warm-500 hover:text-navy-950 mb-3"><ArrowLeft size={13} /> All plans</Link>
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-5">
        <div className="min-w-0">
          <h1 className="font-display text-[26px] md:text-[30px] text-navy-950 leading-tight truncate">{plan.name}</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-[12.5px] text-warm-500">
            <span>Readiness <span className="font-semibold text-navy-950 tabular-nums">{el.readiness}%</span></span>
            <span>{el.questions.length} open question{el.questions.length === 1 ? '' : 's'}</span>
            {g?.cpm && <span>Finish <span className="font-semibold text-navy-950 tabular-nums">{g.cpm.projectFinish}</span></span>}
            {ev && <span>Quality <span className="font-semibold text-navy-950">{ev.grade}</span> ({ev.score})</span>}
            <span className="flex items-center gap-1">{llm.airgapped && <Lock size={11} />}{llm.mode === 'cloud' ? 'Cloud AI' : llm.mode === 'local' ? 'On-prem AI' : 'AI offline — rules only'}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => generate(false)} disabled={!!busy} className="flex items-center gap-1.5 bg-accent-500 hover:bg-accent-400 text-navy-950 px-3.5 py-2 rounded-md text-[13px] font-semibold transition-colors disabled:opacity-50">
            {busy === 'generate' ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} {g ? 'Regenerate' : 'Generate schedule'}
          </button>
          {g && (
            <>
              <button onClick={publish} disabled={!!busy} className="flex items-center gap-1.5 border border-warm-300 bg-warm-50 hover:bg-warm-100 text-navy-950 px-3.5 py-2 rounded-md text-[13px] font-medium transition-colors disabled:opacity-50">
                {busy === 'publish' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Publish
              </button>
              <ExportMenu id={plan.id} />
            </>
          )}
        </div>
      </div>

      {notice && <Banner kind="ok" onClose={() => setNotice('')}>{notice}</Banner>}
      {error && <Banner kind="error" onClose={() => setError('')}>{error}</Banner>}

      <div className="flex gap-1.5 mb-5 overflow-x-auto">
        {(['interview', 'schedule', 'evaluation', 'audit'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)} disabled={t !== 'interview' && t !== 'audit' && !g}
            className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors whitespace-nowrap disabled:opacity-40 ${tab === t ? 'bg-navy-900 text-white' : 'bg-warm-100 border border-warm-200 text-warm-600 hover:border-warm-300'}`}>
            {t === 'interview' ? `Interview (${el.questions.length})` : t === 'schedule' ? 'Schedule' : t === 'evaluation' ? 'Evaluation & review' : 'Audit trail'}
          </button>
        ))}
      </div>

      {tab === 'interview' && <InterviewTab view={view} busy={busy} onAnswer={saveAnswer} onSuggest={suggest} onGenerate={() => generate(false)} />}
      {tab === 'schedule' && g && <ScheduleTab plan={plan} onEdit={async (edit) => {
        const data = await call('edit', `/api/plans/${id}/edit`, { method: 'POST', body: JSON.stringify({ edit }) })
        if (data?.impact) {
          const im = data.impact as EditImpact
          setNotice(`${data.summary}. Finish ${im.finishBefore} → ${im.finishAfter} (${im.finishDeltaDays >= 0 ? '+' : ''}${im.finishDeltaDays} days)${im.criticalAdded.length ? `; now critical: ${im.criticalAdded.slice(0, 6).join(', ')}` : ''}${im.criticalRemoved.length ? `; no longer critical: ${im.criticalRemoved.slice(0, 6).join(', ')}` : ''}.`)
          return true
        }
        return false
      }} onRegenerateFresh={() => generate(true)} busy={busy} />}
      {tab === 'evaluation' && g && ev && <EvaluationTab ev={ev} plan={plan} busy={busy} onReview={async (body) => { const d = await call('review', `/api/plans/${id}/review`, { method: 'POST', body: JSON.stringify(body) }); if (d) setNotice('Review recorded.'); return !!d }} />}
      {tab === 'audit' && <AuditTab plan={plan} onDelete={remove} />}
    </div>
  )
}

/* ─── Shared bits ────────────────────────────────────── */

function Banner({ kind, children, onClose }: { kind: 'ok' | 'error' | 'warn'; children: React.ReactNode; onClose?: () => void }) {
  const style = kind === 'ok' ? 'border-status-on-track bg-status-on-track-bg' : kind === 'error' ? 'border-status-at-risk bg-status-at-risk-bg' : 'border-status-attention bg-status-attention-bg'
  return (
    <div className={`border-l-2 ${style} text-[13px] text-warm-700 px-3 py-2 rounded-md mb-4 flex items-start gap-2`}>
      <div className="flex-1">{children}</div>
      {onClose && <button onClick={onClose} className="text-warm-400 hover:text-warm-600"><X size={14} /></button>}
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
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 border border-warm-300 bg-warm-50 hover:bg-warm-100 text-navy-950 px-3.5 py-2 rounded-md text-[13px] font-medium transition-colors">
        <Download size={13} /> Export <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-64 bg-warm-50 border border-warm-200 rounded-md shadow-lg z-20 py-1 text-[13px]">
          <a href={`/api/plans/${id}/export?format=md`} className="block px-3 py-2 hover:bg-warm-100">Basis of Schedule narrative (.md)</a>
          <a href={`/api/plans/${id}/export?format=xml`} className="block px-3 py-2 hover:bg-warm-100">MS Project XML (P6 can import)</a>
          <a href={`/api/plans/${id}/export?format=csv`} className="block px-3 py-2 hover:bg-warm-100">Activity table (.csv / Excel)</a>
        </div>
      )}
    </div>
  )
}

/* ─── Interview ──────────────────────────────────────── */

function InterviewTab({ view, busy, onAnswer, onSuggest, onGenerate }: {
  view: View; busy: string | null
  onAnswer: (qid: string, a: Partial<Answer>) => Promise<void>
  onSuggest: () => void; onGenerate: () => void
}) {
  const { elicitation: el, plan, llm, history } = view
  const [showAll, setShowAll] = useState(false)
  const [showAnswered, setShowAnswered] = useState(false)
  const visible = showAll ? el.questions : el.questions.slice(0, 6)
  const answered = view.answered

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2 space-y-3">
        {el.conflicts.map((c, i) => <Banner key={i} kind="warn"><span className="font-semibold">Check this: </span>{c}</Banner>)}

        {el.questions.length === 0 ? (
          <div className="bg-warm-100 border border-warm-200 rounded-lg p-5 text-[14px] text-warm-600">
            <CheckCircle2 size={16} className="inline text-status-on-track mr-1.5" />
            Every question is answered or deliberately left open. Generate the schedule when ready.
            <button onClick={onGenerate} className="block mt-3 bg-accent-500 hover:bg-accent-400 text-navy-950 px-3.5 py-2 rounded-md text-[13px] font-semibold transition-colors">Generate schedule</button>
          </div>
        ) : (
          <>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400">What I still need to know — highest schedule impact first</div>
            {visible.map(q => <QuestionCard key={q.id} q={q} busy={busy === `answer:${q.id}`} onAnswer={onAnswer} />)}
            {el.questions.length > 6 && (
              <button onClick={() => setShowAll(s => !s)} className="text-[13px] text-accent-600 hover:underline">
                {showAll ? 'Show fewer' : `Show all ${el.questions.length} open questions`}
              </button>
            )}
          </>
        )}

        {answered.length > 0 && (
          <div className="pt-2">
            <button onClick={() => setShowAnswered(s => !s)} className="flex items-center gap-1 text-[13px] font-medium text-warm-600 hover:text-navy-950">
              {showAnswered ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Answered ({answered.length})
            </button>
            {showAnswered && (
              <div className="mt-2 bg-warm-100 border border-warm-200 rounded-lg divide-y divide-warm-200">
                {answered.map(a => (
                  <div key={a.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-[13px]">
                    <span className="text-warm-600 min-w-0"><span className="text-[10.5px] font-bold uppercase tracking-wider text-warm-400 mr-2">{SECTION_LABEL[a.section] || a.section}</span>{a.prompt}</span>
                    <span className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-navy-950 font-medium flex items-center gap-1">{a.status === 'withheld' && <Lock size={11} />}{a.label}</span>
                      <button onClick={() => onAnswer(a.id, null as unknown as Partial<Answer>)} title="Clear and ask again" className="text-warm-400 hover:text-status-at-risk"><X size={13} /></button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="bg-warm-100 border border-warm-200 rounded-lg p-5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-2">Brief readiness</div>
          <div className="text-[32px] font-display text-navy-950 tabular-nums leading-none">{el.readiness}%</div>
          <div className="h-1.5 bg-warm-200 rounded-sm overflow-hidden mt-3"><div className="h-full bg-accent-500" style={{ width: `${el.readiness}%` }} /></div>
          <p className="text-[12px] text-warm-500 mt-3">Weighted by how much each answer can move the finish date. You can generate at any point; gaps become explicit assumptions and contingency.</p>
        </div>

        <div className="bg-warm-100 border border-warm-200 rounded-lg p-5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-2">Grounding</div>
          <ul className="text-[12.5px] text-warm-600 space-y-1.5">
            <li>Permits &amp; regulations for {el.profile.state || 'your region (state not set)'}{el.profile.projectType ? `, ${el.profile.projectType.replace(/_/g, ' ')}` : ''}</li>
            <li>Long-lead equipment lead times (2024–25 market ranges)</li>
            <li>{history ? `${history.projectCount} of your firm's schedules (${history.similarCount} similar) — private to your firm` : 'No firm history yet — upload past schedules to ground durations in your actuals'}</li>
          </ul>
        </div>

        {llm.mode !== 'offline' ? (
          <button onClick={onSuggest} disabled={!!busy} className="w-full flex items-center justify-center gap-1.5 border border-warm-300 bg-warm-50 hover:bg-warm-100 text-navy-950 px-3 py-2.5 rounded-md text-[13px] font-medium transition-colors disabled:opacity-50">
            {busy === 'suggest' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Ask AI for project-specific follow-ups
          </button>
        ) : (
          <p className="text-[12px] text-warm-400">AI follow-up questions are off ({llm.error || 'offline mode'}). The rule-based interview covers the core schedule drivers.</p>
        )}

        {el.assumptions.length > 0 && (
          <div className="bg-warm-100 border border-warm-200 rounded-lg p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-2">Assumptions ({el.assumptions.length})</div>
            <ul className="space-y-2">
              {el.assumptions.slice(0, 12).map((a: Assumption) => (
                <li key={a.questionId} className="text-[12px] text-warm-600">
                  {a.kind === 'withheld' && <Lock size={10} className="inline mr-1" />}{a.text}{a.bufferDays ? <span className="text-warm-400"> (+{a.bufferDays}d)</span> : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

function QuestionCard({ q, busy, onAnswer }: { q: Question; busy: boolean; onAnswer: (qid: string, a: Partial<Answer>) => Promise<void> }) {
  const [value, setValue] = useState<string>('')
  const submit = (v: unknown) => onAnswer(q.id, { status: 'known', value: v as Answer['value'] })

  return (
    <div className="bg-warm-100 border border-warm-200 rounded-lg p-5">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10.5px] font-bold uppercase tracking-wider text-warm-500 border-l-2 border-accent-500 pl-1.5">{SECTION_LABEL[q.section] || q.section}</span>
        {q.id.startsWith('ai.') && <span className="text-[10.5px] text-warm-400 flex items-center gap-0.5"><Sparkles size={10} /> AI follow-up</span>}
      </div>
      <div className="text-[15px] font-semibold text-navy-950">{q.prompt}</div>
      <div className="text-[12.5px] text-warm-500 mt-1 flex gap-1.5"><HelpCircle size={13} className="flex-shrink-0 mt-0.5" /><span><span className="font-medium text-warm-600">Why I ask:</span> {q.why}</span></div>
      {q.groundedBy && <Sources sources={q.groundedBy} />}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {q.kind === 'choice' && q.options && (
          q.options.length <= 5 ? q.options.map(o => (
            <button key={o.value} disabled={busy} onClick={() => submit(o.value)} className="px-3 py-1.5 rounded-md border border-warm-300 bg-warm-50 hover:border-navy-900 text-[13px] text-navy-950 transition-colors disabled:opacity-50">{o.label}</button>
          )) : (
            <>
              <select value={value} onChange={e => setValue(e.target.value)} className="bg-warm-50 border border-warm-300 rounded-md px-2.5 py-1.5 text-[13px] text-warm-700 min-w-[200px]">
                <option value="">Choose…</option>
                {q.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <button disabled={busy || !value} onClick={() => submit(value)} className="bg-navy-900 text-white px-3 py-1.5 rounded-md text-[13px] font-medium disabled:opacity-40">Save</button>
            </>
          )
        )}
        {q.kind === 'boolean' && (
          <>
            <button disabled={busy} onClick={() => submit(true)} className="px-4 py-1.5 rounded-md border border-warm-300 bg-warm-50 hover:border-navy-900 text-[13px] text-navy-950 transition-colors">Yes</button>
            <button disabled={busy} onClick={() => submit(false)} className="px-4 py-1.5 rounded-md border border-warm-300 bg-warm-50 hover:border-navy-900 text-[13px] text-navy-950 transition-colors">No</button>
          </>
        )}
        {(q.kind === 'number' || q.kind === 'date' || q.kind === 'text') && (
          <form onSubmit={e => { e.preventDefault(); if (value.trim()) submit(q.kind === 'number' ? Number(value) : value.trim()) }} className="flex gap-2 flex-wrap">
            <input
              type={q.kind === 'number' ? 'number' : q.kind === 'date' ? 'date' : 'text'} value={value} onChange={e => setValue(e.target.value)}
              min={q.kind === 'number' ? 0 : undefined} max={q.unit === '%' ? 100 : undefined}
              placeholder={q.unit ? q.unit : 'Your answer'}
              className={`bg-warm-50 border border-warm-300 rounded-md px-2.5 py-1.5 text-[13px] text-warm-700 ${q.kind === 'text' ? 'w-72 max-w-full' : 'w-40'}`}
            />
            <button disabled={busy || !value.trim()} className="bg-navy-900 text-white px-3 py-1.5 rounded-md text-[13px] font-medium disabled:opacity-40">{busy ? <Loader2 size={13} className="animate-spin" /> : 'Save'}</button>
          </form>
        )}
        <span className="flex-1" />
        <button disabled={busy} onClick={() => onAnswer(q.id, { status: 'unknown' })} className="text-[12.5px] text-warm-500 hover:text-navy-950">Don&apos;t know</button>
        {q.allowWithheld && (
          <button disabled={busy} onClick={() => onAnswer(q.id, { status: 'withheld' })} title="Plan around it without sharing the detail" className="text-[12.5px] text-warm-500 hover:text-navy-950 flex items-center gap-1"><Lock size={11} /> Can&apos;t share</button>
        )}
      </div>
      {q.fallback && <div className="text-[11.5px] text-warm-400 mt-2">If unknown: {q.fallback.explanation}</div>}
    </div>
  )
}

/* ─── Schedule (explainable + overridable) ───────────── */

type EditBody = Record<string, unknown>

function ScheduleTab({ plan, onEdit, onRegenerateFresh, busy }: { plan: Plan; onEdit: (e: EditBody) => Promise<boolean>; onRegenerateFresh: () => void; busy: string | null }) {
  const g = plan.generated!
  const t = g.cpm?.times || {}
  const [open, setOpen] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'critical' | 'low' | 'overridden'>('all')
  const byId = useMemo(() => new Map(g.activities.map(a => [a.id, a])), [g])
  const start = Date.parse(g.projectStart)
  const span = Math.max(1, Date.parse(g.cpm?.projectFinish || g.projectStart) - start)
  const rows = g.activities
    .filter(a => filter === 'all' || (filter === 'critical' && t[a.id]?.critical) || (filter === 'low' && a.rationale.confidence === 'low') || (filter === 'overridden' && a.overrides?.length))
    .sort((a, b) => (t[a.id]?.earlyStart || '').localeCompare(t[b.id]?.earlyStart || '') || a.code.localeCompare(b.code))
  const criticalCount = g.activities.filter(a => t[a.id]?.critical).length
  const overrides = g.activities.filter(a => a.overrides?.length).length + g.links.filter(l => l.overrides?.length).length + (g.removed?.length || 0)

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[['Start', g.projectStart], ['Finish', g.cpm?.projectFinish || '—'], ['Activities', `${g.activities.length} (${criticalCount} critical)`], ['Your overrides', String(overrides)]].map(([k, v]) => (
          <div key={k} className="bg-warm-100 border border-warm-200 rounded-lg p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400">{k}</div>
            <div className="text-[16px] font-semibold text-navy-950 tabular-nums mt-1">{v}</div>
          </div>
        ))}
      </div>
      {g.mustFinishBy && g.cpm && g.cpm.projectFinish > g.mustFinishBy && (
        <Banner kind="warn">The plan finishes {g.cpm.projectFinish}, after the required {g.mustFinishBy}. Critical activities show negative float.</Banner>
      )}
      {(g.cpm?.warnings?.length ?? 0) > 0 && <Banner kind="warn">{g.cpm!.warnings.slice(0, 3).join(' · ')}</Banner>}
      {(g.notes || []).map((n, i) => <p key={i} className="text-[12px] text-warm-500 mb-2">{n}</p>)}

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
        <td className="px-2 py-2 tabular-nums text-warm-600 whitespace-nowrap">{tm?.earlyStart}</td>
        <td className="px-2 py-2 tabular-nums text-warm-600 whitespace-nowrap">{tm?.earlyFinish}</td>
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
                <p className="text-[13px] text-warm-700">{a.rationale.summary}</p>
                <Sources sources={a.rationale.sources} />
                {a.rationale.assumptions?.map((x, i) => <p key={i} className="text-[12px] text-warm-500 mt-1.5">Assumes: {x}</p>)}
                {tm && <p className="text-[12px] text-warm-500 mt-2 tabular-nums">Late start {tm.lateStart} · late finish {tm.lateFinish} · free float {tm.freeFloat}d</p>}

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
                  <p key={i} className="text-[12px] text-warm-500">{new Date(o.at).toLocaleString()} — {o.by}: {o.field} {o.from !== undefined ? `${String(o.from)} → ` : ''}{String(o.to ?? '')} · “{o.reason}”</p>
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
      <span className="flex-1"><span className="font-medium text-navy-950">{other?.code} {other?.name}</span> — {l.rationale.summary}</span>
      <button disabled={!!busy} onClick={remove} title="Remove relationship" className="text-warm-400 hover:text-status-at-risk flex-shrink-0"><X size={12} /></button>
    </div>
  )
}

/* ─── Evaluation & expert review ─────────────────────── */

function EvaluationTab({ ev, plan, busy, onReview }: { ev: Evaluation; plan: Plan; busy: string | null; onReview: (b: Record<string, string>) => Promise<boolean> }) {
  const [verdict, setVerdict] = useState('approve')
  const [comment, setComment] = useState('')
  const [reviewer, setReviewer] = useState('')
  const resultStyle = (r: string) => r === 'pass' ? 'text-status-on-track' : r === 'fail' ? 'text-status-at-risk' : r === 'warn' ? 'text-status-attention' : 'text-warm-400'

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Overall" value={`${ev.grade} · ${ev.score}`} sub="DCMA 35% · readiness 20% · realism 20% · coverage 15% · review 10%" />
        <Stat label="DCMA 14-point" value={`${ev.dcma.passed}/${ev.dcma.applicable}`} sub="applicable checks passing" />
        <Stat label="P50 finish" value={ev.forecast.p50} sub={`deterministic ${ev.forecast.deterministic}`} />
        <Stat label="P80 finish" value={ev.forecast.p80} sub={ev.forecast.requiredFinish ? `required ${ev.forecast.requiredFinish}${ev.forecast.p80MeetsRequired ? ' ✓' : ' ✗'}` : 'risk-adjusted'} />
      </div>
      <p className="text-[12px] text-warm-500 -mt-2">Risk basis: {ev.forecast.basis}</p>

      {ev.findings.length > 0 && (
        <div className="bg-warm-100 border border-warm-200 rounded-lg p-5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-2">Findings</div>
          <ul className="space-y-1.5">{ev.findings.map((f, i) => <li key={i} className="text-[13px] text-warm-700 flex gap-2"><AlertTriangle size={13} className="text-status-attention flex-shrink-0 mt-0.5" />{f}</li>)}</ul>
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
            <span className="font-semibold text-navy-950">{r.reviewer}</span> · {new Date(r.at).toLocaleString()} · <span className="uppercase text-[11px] font-semibold">{r.verdict.replace(/_/g, ' ')}</span>
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

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-warm-100 border border-warm-200 rounded-lg p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400">{label}</div>
      <div className="text-[18px] font-semibold text-navy-950 tabular-nums mt-1">{value}</div>
      {sub && <div className="text-[11px] text-warm-400 mt-0.5">{sub}</div>}
    </div>
  )
}

/* ─── Audit ──────────────────────────────────────────── */

function AuditTab({ plan, onDelete }: { plan: Plan; onDelete: () => void }) {
  return (
    <div>
      <div className="bg-warm-100 border border-warm-200 rounded-lg divide-y divide-warm-200">
        {plan.audit.length === 0 && <p className="p-5 text-[13px] text-warm-500">Nothing recorded yet.</p>}
        {[...plan.audit].reverse().map((e, i) => (
          <div key={i} className="px-4 py-2.5 text-[12.5px] flex gap-3">
            <span className="text-warm-400 tabular-nums w-36 flex-shrink-0">{new Date(e.at).toLocaleString()}</span>
            <span className="text-navy-950 w-28 flex-shrink-0 truncate">{e.by}</span>
            <span className="text-warm-600"><span className="font-medium">{e.action}</span>{e.detail ? ` — ${e.detail}` : ''}</span>
          </div>
        ))}
      </div>
      <button onClick={onDelete} className="mt-4 flex items-center gap-1 text-[12.5px] text-status-at-risk"><Trash2 size={12} /> Delete plan</button>
    </div>
  )
}
