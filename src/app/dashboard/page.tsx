'use client'

import { useApp } from './layout'
import { StickyBar } from '@/components/StickyBar'
import { Upload } from 'lucide-react'
import { MoodTile, Robot, type RobotMood } from '@/components/Robot'
import { RingTile, CounterTile } from '@/components/Glance'
import { Disclosure } from '@/components/Disclosure'
import { fmtDate, fmtDates, fmtDay } from '@/lib/format'
import type { NearTermOutlook, NearTermRow } from '@/lib/analysis/near-term'
import type { CriticalPathStatus } from '@/lib/analysis/critical-status'
import Link from 'next/link'
import { Portfolio } from '@/components/Portfolio'
import { ScheduleTools } from '@/components/ScheduleTools'
import { EarnedValue } from '@/components/EarnedValue'
import { useEffect, useState } from 'react'

export default function DashboardPage() {
  const { selectedSchedule, metrics, refreshMetrics, refreshSchedules, can, user, openUpload } = useApp()
  // Tabs: the overview, and earned value (uploaded schedules; #earned-value links to it).
  const [tab, setTab] = useState<'overview' | 'evm'>('overview')
  useEffect(() => { setTab(typeof window !== 'undefined' && window.location.hash === '#earned-value' ? 'evm' : 'overview') }, [selectedSchedule?.id])

  if (!selectedSchedule) {
    return (
      <div className="px-5 md:px-6 py-6 md:py-8 space-y-6">
        <section aria-labelledby="portfolio-h">
          <h1 id="portfolio-h" className="font-display text-[28px] md:text-[32px] text-navy-950 leading-tight">{greeting(user?.name)}</h1>
          <p className="text-[14px] text-warm-600 mt-1 mb-5">Here is how your portfolio is doing today.</p>
          <Portfolio compact />
        </section>
        <section aria-labelledby="upload-h" className="flex flex-col sm:flex-row sm:items-center gap-4 bg-white/70 border border-warm-200 rounded-2xl p-5">
          <div className="w-11 h-11 bg-accent-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <Upload size={19} className="text-accent-600" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="upload-h" className="text-[15px] font-semibold text-navy-950">Upload a schedule to get started</h2>
            <p className="text-[13.5px] text-warm-600 mt-0.5">Upload a Primavera P6 (.xer), MS Project (.xml), or PDF file to see your project dashboard.</p>
          </div>
          <button type="button" onClick={openUpload} className="pressable self-start sm:self-center border border-warm-300 bg-warm-50 hover:bg-warm-100 text-navy-950 px-4 py-2 rounded-full text-[13.5px] font-semibold">
            {can('schedule.write') ? 'Upload a schedule' : 'Build a schedule'}
          </button>
        </section>
      </div>
    )
  }

  const m = metrics as Record<string, number | unknown[]> | null

  const mx = (m as Record<string, unknown> | null) ?? {}
  // Status and variance come from Planora's recalculation (src/lib/analysis/schedule-analysis.ts).
  const varianceDays: number | null = mx.varianceDays == null ? null : Number(mx.varianceDays)
  const varianceBasis = (mx.varianceBasis as string) || ''
  // The one baseline variance, BEI, missed tasks and reports measure against (src/lib/analysis/baseline.ts)
  const baselineHeader = (mx.baseline as string) || ''
  const status = (mx.status as 'on_track' | 'attention' | 'at_risk' | 'complete' | 'no_baseline' | undefined) ?? (varianceDays != null && varianceDays > 14 ? 'at_risk' : varianceDays != null && varianceDays > 0 ? 'attention' : varianceDays == null ? 'no_baseline' : 'on_track')
  const statusReasons = (mx.statusReasons as string[]) ?? []
  const forecastFinish = (mx.forecastFinish as string) || null
  const reportedFinish = (mx.reportedFinish as string) || null
  // Both finish bases, labelled, when an overruled mandatory constraint separates them.
  const scheduledFinish = (mx.scheduledFinish as string) || null
  const logicFinish = (mx.logicFinish as string) || null
  const twoFinishes = mx.forecastBasis === 'logic' && !!scheduledFinish && !!logicFinish && scheduledFinish !== logicFinish
  const STATUS_LABEL = { on_track: 'On Track', attention: 'Attention', at_risk: 'At Risk', complete: 'Complete', no_baseline: 'No Baseline Yet' } as const

  const criticalCount = Number(m?.criticalCount ?? 0)
  // Whether a critical path exists at all (src/lib/analysis/critical-status.ts): never a confident 0 without logic.
  const criticalPath = (mx.criticalPath as CriticalPathStatus | undefined) ?? null
  const totalActivities = Number(m?.totalActivities ?? 0)
  const percentComplete = Number(m?.percentComplete ?? 0)
  const nearTerm = (mx.nearTerm as NearTermOutlook | undefined) ?? null
  const drivingTasks  = (m?.drivingTasks as ActivityRow[])  ?? []
  // Activities changed by edits made in Planora (shown with an "Edited" tag)
  const editedIds = new Set((mx.editedActivityIds as string[] | undefined) ?? [])
  const editsCount = Number(mx.editsCount ?? 0)
  const brief = ((m as Record<string, unknown> | null)?.brief as unknown as { summary: string; facts: { label: string; value: string }[]; nextMilestones: { name: string; date: string; critical: boolean; basis?: 'scheduled' | 'logic'; scheduled?: string }[] } | null) ?? null
  const warnings = [...new Set((((m as Record<string, unknown> | null)?.warnings as string[]) ?? []).filter(w => /calculat|relationships/i.test(w)))]

  // Nora's one-sentence read of the schedule's health (same status and variance as the badge).
  const MOOD: Record<typeof status, RobotMood> = { on_track: 'done', complete: 'done', attention: 'waiting', at_risk: 'worried', no_baseline: 'idle' }
  const mood: RobotMood = m ? MOOD[status] : 'working'
  const behind = varianceDays != null && varianceDays > 0 ? ` ${varianceDays} ${varianceDays === 1 ? 'day' : 'days'} behind the baseline.` : ''
  const finishNote = forecastFinish ? ` Forecast finish ${fmtDate(forecastFinish)}.` : ''
  const healthLine = !m ? 'Nora is reading this schedule…'
    : status === 'complete' ? 'This project is complete.'
    : status === 'on_track' ? `On track.${finishNote}`
    : status === 'no_baseline' ? `No baseline yet.${finishNote}`
    : status === 'attention' ? `Needs a look.${behind || finishNote}`
    : `At risk.${behind || finishNote}`
  const hasWhy = statusReasons.length > 0 || twoFinishes || (reportedFinish && forecastFinish && reportedFinish !== forecastFinish) || !!baselineHeader || !!varianceBasis
  const varianceTone: RobotMood = varianceDays == null ? 'idle' : varianceDays > 14 ? 'worried' : varianceDays > 0 ? 'waiting' : 'done'

  return (
    <div className="p-5 md:p-6 space-y-6">

      {/* Schedule summary strip — frozen while scrolling */}
      <StickyBar className="-mx-5 md:-mx-6 -mt-5 md:-mt-6 px-5 md:px-6 py-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[17px] font-semibold text-navy-950">{selectedSchedule.name}</div>
          <div className="text-[12px] text-warm-400 mt-0.5">
            {selectedSchedule.version} · {selectedSchedule.activityCount} activities · uploaded {fmtDay(selectedSchedule.uploadedAt)}
            {selectedSchedule.dataDate && ` · data date ${fmtDate(selectedSchedule.dataDate)}`}
          </div>
        </div>
        <span title={statusReasons.join(' ')} className={`text-[12px] font-semibold px-3 py-1 rounded-full whitespace-nowrap ${
          status === 'at_risk'
            ? 'text-status-at-risk bg-status-at-risk-bg'
            : status === 'attention'
            ? 'text-status-attention bg-status-attention-bg'
            : status === 'no_baseline'
            ? 'text-warm-700 bg-warm-100'
            : 'text-status-on-track bg-status-on-track-bg'
        }`}>
          {STATUS_LABEL[status]}
        </span>
      </div>
      </StickyBar>
      <Link href="/dashboard/portfolio" className="inline-block text-[13px] font-medium text-accent-600 hover:underline">All projects and alerts (portfolio) →</Link>

      {selectedSchedule.sourceType !== 'generated' && <ScheduleTabs tab={tab} onChange={setTab} />}
      {selectedSchedule.sourceType !== 'generated' && (
        <div role="tabpanel" id="tabpanel-evm" aria-labelledby="tab-evm" hidden={tab !== 'evm'}>{tab === 'evm' && <EarnedValue scheduleId={selectedSchedule.id} />}</div>
      )}
      <div role={selectedSchedule.sourceType !== 'generated' ? 'tabpanel' : undefined} id="tabpanel-overview" aria-labelledby={selectedSchedule.sourceType !== 'generated' ? 'tab-overview' : undefined}
        hidden={tab !== 'overview' && selectedSchedule.sourceType !== 'generated'} className="space-y-6">

      {/* Glance: Nora's one-line read, then four big numbers */}
      <section aria-label="Schedule health" className="space-y-3">
        <MoodTile mood={mood} className="flex items-center gap-4">
          <Robot mood={mood} size={72} />
          <div className="min-w-0">
            <div role="status" className="text-[18px] font-semibold text-navy-950 leading-snug tracking-[-0.01em]">{healthLine}</div>
            {statusReasons[0] && <p className="text-[13px] text-warm-600 mt-1">{fmtDates(statusReasons[0])}{statusReasons.length > 1 ? ` (+${statusReasons.length - 1} more below)` : ''}</p>}
            {!statusReasons[0] && status === 'no_baseline' && <p className="text-[13px] text-warm-600 mt-1">There is no baseline or required finish to measure this forecast against. Mark an upload of this project as Baseline to track variance.</p>}
          </div>
        </MoodTile>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <RingTile mood={percentComplete >= 100 ? 'done' : 'working'} percent={percentComplete} label="complete" sub="Progress (by duration)" />
          <CounterTile mood={varianceTone}
            value={varianceDays == null ? 'n/a' : varianceDays !== 0 ? `${varianceDays > 0 ? '+' : ''}${varianceDays}d` : '0d'}
            label="Schedule variance"
            sub={varianceDays == null ? 'no usable baseline' : baselineHeader ? `calendar days vs ${baselineHeader.replace(/^Baseline:\s*/, '').replace(/\s+(uploaded|\().*$/, '')}` : 'calendar days vs baseline'} />
          <CounterTile mood="idle" value={String(nearTerm?.startingCount ?? 0)} label="Near-term starts"
            sub={nearTerm && mx.hasForecastDates !== false ? `starting by ${fmtDate(nearTerm.windowEnd)} · ${nearTerm.inProgressCount} in progress` : 'no forecast dates'} />
          <CounterTile mood={criticalPath && !criticalPath.determined ? 'waiting' : 'idle'}
            value={criticalPath && !criticalPath.determined ? '—' : String(criticalCount)} label="Critical activities"
            sub={criticalPath && (!criticalPath.determined || criticalCount === 0) ? criticalPath.label : totalActivities > 0 ? `of ${totalActivities} total` : 'total activities'} />
        </div>
        {criticalPath?.detail && (
          <p role="note" className="text-[13px] text-warm-700 bg-white/70 border border-warm-200 rounded-xl px-4 py-2.5">
            <span className="font-semibold text-navy-950">Critical path: </span>{fmtDates(criticalPath.detail)}
          </p>
        )}
        {hasWhy && (
          <Disclosure tone="card" title="Why this status" meta={statusReasons.length ? `${statusReasons.length} ${statusReasons.length === 1 ? 'reason' : 'reasons'}` : undefined}>
            <div className="text-[13px] text-warm-700 space-y-1.5">
              {statusReasons.map((r, i) => <p key={i}>{fmtDates(r)}</p>)}
              {twoFinishes && (
                <p className="text-warm-700">Forecast (as scheduled, constraints honoured): <span className="tabular-nums font-medium">{fmtDate(scheduledFinish)}</span> · Logic-driven (mandatory constraints relaxed): <span className="tabular-nums font-medium">{fmtDate(logicFinish)}</span></p>
              )}
              {reportedFinish && forecastFinish && reportedFinish !== forecastFinish && (
                <p className="text-warm-600">Planora&apos;s recalculated forecast finish is {fmtDate(forecastFinish)}{twoFinishes ? ' (logic-driven)' : ''}; the file&apos;s header says {fmtDate(reportedFinish)}.</p>
              )}
              {(baselineHeader || varianceBasis) && (
                <p className="text-[12.5px] text-warm-600 pt-1"><span className="font-medium text-navy-950">How variance is measured: </span>{[baselineHeader && `${baselineHeader}.`, varianceBasis].filter(Boolean).join(' ')}</p>
              )}
            </div>
          </Disclosure>
        )}
      </section>

      {/* About this project — what, where, when, what must be achieved */}
      {brief && (
        <div className="bg-white/70 border border-warm-200 rounded-2xl p-5">
          <h2 className="text-[15px] font-semibold text-navy-950 mb-1.5">About this project</h2>
          <p className="text-[14px] text-warm-700 leading-relaxed">{brief.summary}</p>
          <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3">
            {brief.facts.map(f => (
              <div key={f.label} className="text-[12px]"><span className="text-warm-400">{f.label}:</span> <span className="text-navy-950 font-medium">{f.value}</span></div>
            ))}
          </div>
          {brief.nextMilestones.length > 0 && (
            <div className="mt-3 text-[12.5px] text-warm-600">
              <span className="font-semibold text-navy-950">Next milestones: </span>
              {brief.nextMilestones.map((ms, i) => <span key={i}>{i ? ' · ' : ''}{ms.name} <span className="tabular-nums">{ms.date}</span>{ms.basis === 'logic' ? <span className="text-warm-600" title={`Logic-driven date; ${ms.scheduled ?? ''} as scheduled, held by a mandatory constraint`}> (logic-driven; {ms.scheduled} as scheduled)</span> : null}{ms.critical ? <span className="text-status-attention"> (critical)</span> : null}</span>)}
            </div>
          )}
          {warnings.length > 0 && (
            <div className="mt-3">
              <Disclosure title="Calculation notes" meta={String(Math.min(warnings.length, 2))}>
                {warnings.slice(0, 2).map((w, i) => <p key={i} className="mt-1.5 first:mt-0 text-[12px] text-warm-600 border-l-2 border-status-info pl-2">{fmtDates(w)}</p>)}
              </Disclosure>
            </div>
          )}
        </div>
      )}



      {/* Two-column data section */}
      <div className="grid md:grid-cols-2 gap-5">

        {nearTerm && (nearTerm.inProgress.length > 0 || nearTerm.starting.length > 0) && (
          <section aria-labelledby="near-term-h">
            <h2 id="near-term-h" className="font-display text-[18px] text-navy-950 mb-1">Near-Term Outlook</h2>
            <p className="text-[12px] text-warm-500 mb-3">
              {nearTerm.basis === 'data_date' ? 'Data date' : 'Today'} {fmtDate(nearTerm.windowStart)} to {fmtDate(nearTerm.windowEnd)} (14 days). Durations are remaining work days.
            </p>
            {nearTerm.inProgress.length > 0 && (
              <NearTermList title={`In progress (${nearTerm.inProgressCount})`} rows={nearTerm.inProgress.slice(0, 5)} inProgress />
            )}
            {nearTerm.starting.length > 0 && (
              <NearTermList title={`Starting by ${fmtDate(nearTerm.windowEnd)} (${nearTerm.startingCount})`} rows={nearTerm.starting.slice(0, 8)} />
            )}
          </section>
        )}

        {drivingTasks.length > 0 && (
          <section>
            <h2 className="font-display text-[18px] text-navy-950 mb-3">Driving Tasks</h2>
            <div className="bg-warm-50 border border-warm-200 rounded-lg overflow-hidden">
              {drivingTasks.slice(0, 8).map((task, i) => (
                <div key={i} className={`flex items-center justify-between px-4 py-3 ${i < drivingTasks.slice(0, 8).length - 1 ? 'border-b border-warm-200' : ''}`}>
                  <div className="min-w-0 pr-3">
                    <div className="text-[13.5px] font-medium text-warm-700 truncate">{task.name}{editedIds.has(task.id) && <EditedTag />}</div>
                    <div className="text-[11px] text-warm-400 mt-0.5">
                      Float: {task.totalFloat}d
                      {task.earlyStart && ` · ${fmtDate(task.earlyStart)}`}
                      {task.earlyFinish && ` → ${fmtDate(task.earlyFinish)}`}
                      {task.dateBasis === 'logic' && ` (logic-driven; ${fmtDate(task.scheduledFinish)} as scheduled)`}
                    </div>
                    {task.drivingConstraint && (
                      <div className="text-[11px] text-status-attention mt-0.5">
                        {task.drivingConstraint.effect === 'start' ? 'Path starts at its' : 'Held by its'} {task.drivingConstraint.type} {fmtDate(task.drivingConstraint.date)} constraint{task.drivingConstraint.effect === 'later' ? ' (later than logic)' : task.drivingConstraint.effect === 'earlier' ? ' (earlier than logic)' : ''}
                      </div>
                    )}
                  </div>
                  <div className="text-[13px] font-semibold text-navy-950 tabular-nums flex-shrink-0">{task.duration}d</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {!nearTerm?.inProgress.length && !nearTerm?.starting.length && drivingTasks.length === 0 && (
          <div className="col-span-2 text-center py-12 text-warm-400 text-[14px]">
            No task data available for this schedule.
          </div>
        )}
      </div>

      {selectedSchedule.sourceType !== 'generated' && (
        <ScheduleTools scheduleId={selectedSchedule.id}
          progressMode={(selectedSchedule.analysis?.progressMode as 'retained' | 'override') || 'retained'}
          inHistory={selectedSchedule.inHistory ?? true}
          canEdit={can('schedule.write')} editsCount={editsCount}
          version={selectedSchedule.version} classification={selectedSchedule.classification ?? null}
          origin={selectedSchedule.uploadOrigin ?? null} historyOverride={selectedSchedule.historyOverride ?? false}
          onChanged={() => { refreshSchedules(); refreshMetrics() }} />
      )}
      </div>

    </div>
  )
}

/* ─── Tabs ───────────────────────────────────────── */
const TABS = [{ id: 'overview', label: 'Overview' }, { id: 'evm', label: 'Earned value' }] as const
function ScheduleTabs({ tab, onChange }: { tab: 'overview' | 'evm'; onChange: (t: 'overview' | 'evm') => void }) {
  const select = (t: 'overview' | 'evm') => {
    onChange(t)
    if (typeof window !== 'undefined') history.replaceState(null, '', t === 'evm' ? '#earned-value' : window.location.pathname + window.location.search)
  }
  return (
    <div role="tablist" aria-label="Schedule views" className="flex gap-1 border-b border-warm-200"
      onKeyDown={e => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
        const i = TABS.findIndex(x => x.id === tab)
        const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length].id
        select(next)
        document.getElementById(`tab-${next}`)?.focus()
      }}>
      {TABS.map(t => (
        <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`tabpanel-${t.id}`} tabIndex={tab === t.id ? 0 : -1}
          onClick={() => select(t.id)}
          className={`px-3 py-2 text-[13.5px] font-medium -mb-px border-b-2 ${tab === t.id ? 'border-accent-600 text-navy-950' : 'border-transparent text-warm-600 hover:text-navy-950'}`}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

/* ─── Types ─────────────────────────────────────── */
interface ActivityRow {
  id: string
  name: string
  activityId: string
  duration: number
  totalFloat: number
  earlyStart: string
  earlyFinish?: string
  isCritical: boolean
  status: string
  /** 'logic' when earlyStart/earlyFinish are logic-driven dates (an overruled mandatory constraint holds the scheduled ones) */
  dateBasis?: 'logic'
  scheduledFinish?: string
  /** A constraint the driving path is traced through or starts at */
  drivingConstraint?: { type: string; date: string; effect: 'later' | 'earlier' | 'start' }
}

/* ─── Edited tag ─────────────────────────────────── */
function EditedTag() {
  return <span title="Changed by an edit made in Planora (see Edits made in Planora below)" className="ml-2 align-middle text-[10px] font-bold uppercase tracking-wider text-accent-600 bg-accent-100 px-1.5 py-0.5 rounded border-l-2 border-accent-500">Edited</span>
}

/* ─── Near-term list ─────────────────────────────── */
function NearTermList({ title, rows, inProgress = false }: { title: string; rows: NearTermRow[]; inProgress?: boolean }) {
  return (
    <div className="mb-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-warm-500 mb-1.5">{title}</h3>
      <ul className="bg-warm-50 border border-warm-200 rounded-lg overflow-hidden">
        {rows.map((task, i) => (
          <li key={task.activityId + i} className={`flex items-center justify-between px-4 py-3 ${i < rows.length - 1 ? 'border-b border-warm-200' : ''}`}>
            <div className="min-w-0 pr-3">
              <div className="text-[13.5px] font-medium text-warm-700 truncate">{task.name}</div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[11px] text-warm-500">
                  {inProgress
                    ? `Started ${fmtDate(task.actualStart || task.earlyStart)} · finishes ${fmtDate(task.earlyFinish)}`
                    : task.startOverdue
                    ? `Should have started ${fmtDate(task.earlyStart)} (not started)`
                    : `Starts ${fmtDate(task.earlyStart)}`}
                </span>
                {task.isCritical && (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-status-attention bg-status-attention-bg px-1.5 py-0.5 rounded border-l-2 border-status-attention">
                    Critical
                  </span>
                )}
              </div>
            </div>
            <div className="text-[13px] font-semibold text-navy-950 tabular-nums flex-shrink-0" title="Remaining duration (work days)">{task.remainingDuration}d left</div>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ─── Greeting ───────────────────────────────────── */
function greeting(name?: string | null) {
  const first = (name || '').trim().split(/\s+/)[0]
  return first ? `Hi ${first}, welcome back` : 'Welcome back'
}
