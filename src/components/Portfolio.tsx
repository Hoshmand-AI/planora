'use client'

// Organization-wide view: every plan and uploaded schedule with its alerts, most urgent first.
// It opens with a glance row (Nora's mood for the whole portfolio, the share on track, open alerts),
// then "Waiting for you": one row per project that needs something, with its single next action.
// Every reason line and project fact is kept, under each project's "Details".

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowRight, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react'
import { useApp } from '@/app/dashboard/layout'
import { fmtDate, fmtDay } from '@/lib/format'
import type { Portfolio as PortfolioData, PortfolioAlert, PortfolioRow } from '@/lib/planning/portfolio'
import { MoodTile, Robot, type RobotMood } from '@/components/Robot'
import { RingTile, CounterTile } from '@/components/Glance'
import { Disclosure } from '@/components/Disclosure'
import { EmptyState } from '@/components/EmptyState'

const STATUS: Record<PortfolioRow['status'], { label: string; cls: string }> = {
  at_risk: { label: 'At risk', cls: 'text-status-at-risk bg-status-at-risk-bg' },
  attention: { label: 'Attention', cls: 'text-status-attention bg-status-attention-bg' },
  on_track: { label: 'On track', cls: 'text-status-on-track bg-status-on-track-bg' },
  not_started: { label: 'In interview', cls: 'text-warm-600 bg-warm-100' },
  complete: { label: 'Complete', cls: 'text-status-on-track bg-status-on-track-bg' },
}
// An uploaded schedule without a stored analysis has no status until it is opened.
const statusLabel = (r: PortfolioRow) => r.kind === 'schedule' && r.status === 'not_started' ? 'Not analyzed' : STATUS[r.status].label
const ICON = { error: XCircle, warning: AlertTriangle, info: Info }
const ICON_CLS = { error: 'text-status-at-risk', warning: 'text-status-attention', info: 'text-warm-500' }
const SEVERITY_RANK = { error: 0, warning: 1, info: 2 }

/** The alert that matters most for a project: errors, then warnings, then notes. */
const topAlert = (r: PortfolioRow): PortfolioAlert | null =>
  [...r.alerts].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])[0] ?? null

/** Plain-language next step for an alert (where it leads is the project itself, or the upload dialog). */
const NEXT_STEP: Record<string, string> = {
  late: 'See recovery options', milestone_late: 'Check milestones', near_critical: 'Check low-float work',
  review_rejected: 'See requested changes', review_stale: 'Ask for a fresh review', review_none: 'Request a review',
  unpublished: 'Publish the baseline', not_generated: 'Finish the interview', date_conflict: 'Fix date conflicts',
  low_readiness: 'Answer more questions', stale: 'Update the plan', stale_status: 'Upload a status update',
  not_analyzed: 'Open to analyze', import_warnings: 'Review import warnings', negative_float: 'Open the schedule',
  constraint_overrules_logic: 'Open the schedule', behind: 'Open the schedule', finish_passed: 'Open the schedule', analysis: 'Open the schedule',
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function Portfolio({ compact = false }: { compact?: boolean }) {
  const router = useRouter()
  const { schedules, setSelectedSchedule, openUpload, can } = useApp()
  const [data, setData] = useState<PortfolioData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/portfolio').then(async r => {
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not load the portfolio.')
      setData(d)
    }).catch(e => setError(e.message))
  }, [])

  if (error) return <p role="alert" className="text-[13px] text-status-at-risk">{error}</p>
  if (!data) return <p className="text-[13px] text-warm-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading portfolio…</p>
  if (!data.rows.length) return (
    <EmptyState heading="h2" title="No projects yet" action={{ label: 'Build a schedule', href: '/dashboard/plan' }}
      secondary={can('schedule.write') && !compact ? { label: 'Or upload one you already have', onClick: openUpload } : undefined}>
      Nora is ready when you are. Answer a short interview, or upload a schedule, and it shows up here.
    </EmptyState>
  )

  const open = (r: PortfolioRow) => {
    if (r.kind === 'plan') return router.push(r.href)
    const s = schedules.find(x => x.id === r.id)
    if (s) setSelectedSchedule(s)
    router.push(r.href)
  }
  const act = (r: PortfolioRow, a: PortfolioAlert | null) => {
    if (a?.code === 'stale_status' && can('schedule.write')) return openUpload()
    open(r)
  }

  const rows = compact ? data.rows.slice(0, 5) : data.rows
  const t = data.totals
  const urgent = (r: PortfolioRow) => r.alerts.some(a => a.severity !== 'info')
  const waiting = rows.filter(urgent)
  const nextSteps = rows.filter(r => !urgent(r) && r.alerts.length > 0)
  const calm = rows.filter(r => r.alerts.length === 0)
  const waitingAll = data.rows.filter(urgent).length
  const good = data.rows.filter(r => r.status === 'on_track' || r.status === 'complete').length

  const mood: RobotMood = t.atRisk > 0 ? 'worried' : waitingAll > 0 || t.attention > 0 ? 'waiting' : 'done'
  const headline = mood === 'worried' ? `${plural(t.atRisk, 'project is', 'projects are')} at risk`
    : mood === 'waiting' ? `${plural(waitingAll, 'project needs', 'projects need')} you`
    : 'All calm'
  const subline = mood === 'worried' ? `${plural(waitingAll, 'project needs', 'projects need')} you. The most urgent is at the top.`
    : mood === 'waiting' ? 'Nothing is on fire. Start at the top.'
    : data.rows.some(r => r.alerts.length) ? 'Nothing urgent. A few next steps are below.' : 'Every project is on track.'

  return (
    <div className="space-y-6">
      {/* Glance row */}
      <div className="grid grid-cols-2 lg:grid-cols-[1.35fr_1fr_1fr] gap-3" role="group" aria-label="Portfolio totals">
        <MoodTile mood={mood} className="flex items-center gap-4 col-span-2 lg:col-span-1">
          <Robot mood={mood} size={72} />
          <div className="min-w-0">
            <div className="text-[18px] font-semibold text-navy-950 leading-tight tracking-[-0.01em]" role="status">{headline}</div>
            <div className="text-[13px] text-warm-600 mt-1">{subline}</div>
          </div>
        </MoodTile>
        <RingTile mood={good === t.projects ? 'done' : 'working'} percent={t.projects ? (good / t.projects) * 100 : 0}
          label="on track" sub={`${good} of ${plural(t.projects, 'project', 'projects')}${good !== t.onTrack ? ` (${good - t.onTrack} complete)` : ''}`} />
        <CounterTile mood={t.alerts ? 'idle' : 'done'} value={t.alerts} label="open alerts"
          sub={<>Projects: <span className="text-status-at-risk font-medium">{t.atRisk} at risk</span> · <span className="text-status-attention font-medium">{t.attention} need attention</span> · {t.onTrack} on track</>} />
      </div>

      {waiting.length > 0 && (
        <section aria-labelledby="waiting-h">
          <h2 id="waiting-h" className="text-[15px] font-semibold text-navy-950 mb-2.5">Waiting for you</h2>
          <ul className="space-y-2.5">{waiting.map(r => <ProjectRow key={`${r.kind}:${r.id}`} r={r} onOpen={open} onAct={act} />)}</ul>
        </section>
      )}
      {nextSteps.length > 0 && (
        <section aria-labelledby="next-h">
          <h2 id="next-h" className="text-[15px] font-semibold text-navy-950 mb-2.5">Next steps</h2>
          <ul className="space-y-2.5">{nextSteps.map(r => <ProjectRow key={`${r.kind}:${r.id}`} r={r} onOpen={open} onAct={act} />)}</ul>
        </section>
      )}
      {calm.length > 0 && (
        <section aria-labelledby="calm-h">
          <h2 id="calm-h" className="text-[15px] font-semibold text-navy-950 mb-2.5">All good</h2>
          <ul className="space-y-2.5">{calm.map(r => <ProjectRow key={`${r.kind}:${r.id}`} r={r} onOpen={open} onAct={act} />)}</ul>
        </section>
      )}
      {compact && data.rows.length > rows.length && <Link href="/dashboard/portfolio" className="inline-block text-[13px] font-medium text-accent-600 hover:underline">See all {data.rows.length} projects →</Link>}
    </div>
  )
}

function ProjectRow({ r, onOpen, onAct }: { r: PortfolioRow; onOpen: (r: PortfolioRow) => void; onAct: (r: PortfolioRow, a: PortfolioAlert | null) => void }) {
  const top = topAlert(r)
  const TopIcon = top ? ICON[top.severity] : CheckCircle2
  return (
    <li className="bg-white/80 border border-warm-200 rounded-2xl px-4 pt-3.5 pb-1">
      <div className="flex flex-col sm:flex-row sm:items-start gap-x-3 gap-y-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => onOpen(r)} className="text-[14.5px] font-semibold text-navy-950 hover:underline text-left">{r.name}</button>
            <span className={`text-[11.5px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS[r.status].cls}`}>{statusLabel(r)}</span>
          </div>
          <p className="mt-1 flex items-start gap-1.5 text-[13px] text-warm-700">
            <TopIcon size={14} aria-hidden className={`mt-0.5 flex-shrink-0 ${top ? ICON_CLS[top.severity] : 'text-status-on-track'}`} />
            <span>{top ? <><span className="sr-only">{top.severity}: </span>{top.text}</> : 'No alerts.'}</span>
          </p>
        </div>
        {top && (
          <button type="button" onClick={() => onAct(r, top)}
            className="pressable self-start inline-flex items-center gap-1.5 rounded-full bg-navy-900 hover:bg-navy-800 text-white px-3.5 py-1.5 text-[12.5px] font-semibold whitespace-nowrap">
            {NEXT_STEP[top.code] ?? 'Open'} <ArrowRight size={13} aria-hidden />
            <span className="sr-only">: {r.name}</span>
          </button>
        )}
      </div>
      <div className="mt-2">
        <Disclosure title="Details" meta={r.alerts.length > 1 ? `${r.alerts.length} notes` : undefined}>
          <div className="text-[12px] text-warm-600">
            {r.kind === 'plan' ? 'Planora plan' : r.updates && r.updates > 1 ? `Uploaded schedule · latest of ${r.updates} updates` : 'Uploaded schedule'}
            {r.dataDate && <> · data date <span className="tabular-nums text-warm-700">{fmtDate(r.dataDate)}</span></>}
            {r.finish && <> · finish <span className="tabular-nums text-warm-700">{fmtDate(r.finish)}</span></>}
            {r.required && <> · required <span className="tabular-nums text-warm-700">{fmtDate(r.required)}</span></>}
            {r.readiness != null && <> · interview {r.readiness}%</>}
            {r.kind === 'schedule' && r.gapDays != null && <> · variance <span className="tabular-nums text-warm-700">{r.gapDays > 0 ? '+' : ''}{r.gapDays}d</span></>}
            {' · '}updated {fmtDay(r.updatedAt)}
          </div>
          {r.varianceBasis && <p className="mt-1 text-[12px] text-warm-600">{r.varianceBasis}</p>}
          {r.alerts.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {r.alerts.map(a => {
                const Icon = ICON[a.severity]
                return <li key={a.code} className="flex items-start gap-1.5 text-[12.5px] text-warm-700"><Icon size={13} aria-hidden className={`mt-0.5 flex-shrink-0 ${ICON_CLS[a.severity]}`} /><span><span className="sr-only">{a.severity}: </span>{a.text}</span></li>
              })}
            </ul>
          ) : <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-warm-600"><CheckCircle2 size={13} aria-hidden className="text-status-on-track" /> No alerts.</p>}
        </Disclosure>
      </div>
    </li>
  )
}
