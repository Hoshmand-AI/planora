'use client'

import { useApp } from './layout'
import { StickyBar } from '@/components/StickyBar'
import { Upload } from 'lucide-react'
import { fmtDate, fmtDates, fmtDay } from '@/lib/format'
import type { NearTermOutlook, NearTermRow } from '@/lib/analysis/near-term'
import Link from 'next/link'
import { Portfolio } from '@/components/Portfolio'
import { ScheduleTools } from '@/components/ScheduleTools'

export default function DashboardPage() {
  const { selectedSchedule, metrics, refreshMetrics, refreshSchedules } = useApp()

  if (!selectedSchedule) {
    return (
      <div className="p-5 md:p-6 space-y-6">
        <section aria-labelledby="portfolio-h">
          <h1 id="portfolio-h" className="text-[17px] font-semibold text-navy-950 mb-3">Portfolio</h1>
          <Portfolio compact />
        </section>
      <div className="flex flex-col items-center justify-center py-12 text-center px-6">
        <div className="w-12 h-12 bg-warm-100 border border-warm-200 rounded-lg flex items-center justify-center mb-4">
          <Upload size={20} className="text-warm-400" />
        </div>
        <div className="text-[17px] font-semibold text-navy-950 mb-2">Upload a schedule to get started</div>
        <p className="text-[14px] text-warm-500 max-w-[360px]">Upload a Primavera P6 (.xer), MS Project (.xml), or PDF file to see your project dashboard.</p>
      </div>
      </div>
    )
  }

  const m = metrics as Record<string, number | unknown[]> | null

  const mx = (m as Record<string, unknown> | null) ?? {}
  // Status and variance come from Planora's recalculation (src/lib/analysis/schedule-analysis.ts).
  const varianceDays: number | null = mx.varianceDays == null ? null : Number(mx.varianceDays)
  const varianceBasis = (mx.varianceBasis as string) || ''
  const status = (mx.status as 'on_track' | 'attention' | 'at_risk' | 'complete' | undefined) ?? (varianceDays != null && varianceDays > 14 ? 'at_risk' : varianceDays != null && varianceDays > 0 ? 'attention' : 'on_track')
  const statusReasons = (mx.statusReasons as string[]) ?? []
  const forecastFinish = (mx.forecastFinish as string) || null
  const reportedFinish = (mx.reportedFinish as string) || null
  const STATUS_LABEL = { on_track: 'On Track', attention: 'Attention', at_risk: 'At Risk', complete: 'Complete' } as const
  const STATUS_TONE = { on_track: 'on-track', attention: 'attention', at_risk: 'at-risk', complete: 'on-track' } as const
  const criticalCount = Number(m?.criticalCount ?? 0)
  const totalActivities = Number(m?.totalActivities ?? 0)
  const percentComplete = Number(m?.percentComplete ?? 0)
  const nearTerm = (mx.nearTerm as NearTermOutlook | undefined) ?? null
  const drivingTasks  = (m?.drivingTasks as ActivityRow[])  ?? []
  const brief = ((m as Record<string, unknown> | null)?.brief as unknown as { summary: string; facts: { label: string; value: string }[]; nextMilestones: { name: string; date: string; critical: boolean }[] } | null) ?? null
  const warnings = [...new Set((((m as Record<string, unknown> | null)?.warnings as string[]) ?? []).filter(w => /calculat|relationships/i.test(w)))]

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
        <span title={statusReasons.join(' ')} className={`text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md border-l-2 ${
          status === 'at_risk'
            ? 'text-status-at-risk bg-status-at-risk-bg border-status-at-risk'
            : status === 'attention'
            ? 'text-status-attention bg-status-attention-bg border-status-attention'
            : 'text-status-on-track bg-status-on-track-bg border-status-on-track'
        }`}>
          {STATUS_LABEL[status]}
        </span>
      </div>
      </StickyBar>
      <Link href="/dashboard/portfolio" className="inline-block text-[13px] font-medium text-accent-600 hover:underline">All projects and alerts (portfolio) →</Link>

      {(statusReasons.length > 0 || (reportedFinish && forecastFinish && reportedFinish !== forecastFinish)) && (
        <div className={`border-l-2 pl-3 py-1 text-[13px] text-warm-700 space-y-1 ${status === 'at_risk' ? 'border-status-at-risk' : status === 'attention' ? 'border-status-attention' : 'border-status-info'}`}>
          {statusReasons.map((r, i) => <p key={i}>{r}</p>)}
          {reportedFinish && forecastFinish && reportedFinish !== forecastFinish && (
            <p className="text-warm-500">Planora&apos;s recalculated forecast finish is {fmtDate(forecastFinish)}; the file&apos;s header says {fmtDate(reportedFinish)}.</p>
          )}
        </div>
      )}

      {/* About this project — what, where, when, what must be achieved */}
      {brief && (
        <div className="bg-warm-100 border border-warm-200 rounded-lg p-5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-1.5">About this project</div>
          <p className="text-[14px] text-warm-700 leading-relaxed">{brief.summary}</p>
          <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3">
            {brief.facts.map(f => (
              <div key={f.label} className="text-[12px]"><span className="text-warm-400">{f.label}:</span> <span className="text-navy-950 font-medium">{f.value}</span></div>
            ))}
          </div>
          {brief.nextMilestones.length > 0 && (
            <div className="mt-3 text-[12.5px] text-warm-600">
              <span className="font-semibold text-navy-950">Next milestones: </span>
              {brief.nextMilestones.map((ms, i) => <span key={i}>{i ? ' · ' : ''}{ms.name} <span className="tabular-nums">{ms.date}</span>{ms.critical ? <span className="text-status-attention"> (critical)</span> : null}</span>)}
            </div>
          )}
          {warnings.slice(0, 2).map((w, i) => <p key={i} className="mt-2 text-[12px] text-warm-500 border-l-2 border-status-info pl-2">{fmtDates(w)}</p>)}
        </div>
      )}


      {/* Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="Schedule Variance"
          value={varianceDays == null ? 'n/a' : varianceDays !== 0 ? `${varianceDays > 0 ? '+' : ''}${varianceDays}d` : '0d'}
          context={varianceDays == null ? 'no usable baseline' : 'calendar days vs baseline'}
          title={varianceBasis}
          color={varianceDays == null ? undefined : STATUS_TONE[varianceDays > 14 ? 'at_risk' : varianceDays > 0 ? 'attention' : 'on_track']}
        />
        <MetricCard
          label="Critical Activities"
          value={String(criticalCount)}
          context={totalActivities > 0 ? `of ${totalActivities} total` : 'total activities'}
        />
        <MetricCard
          label="Near-Term Starts"
          value={String(nearTerm?.startingCount ?? 0)}
          context={nearTerm ? `starting by ${fmtDate(nearTerm.windowEnd)} · ${nearTerm.inProgressCount} in progress` : 'no forecast dates'}
        />
        <MetricCard
          label="Progress"
          value={`${percentComplete}%`}
          context="complete"
          color={percentComplete > 50 ? 'on-track' : undefined}
        />
      </div>

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
                    <div className="text-[13.5px] font-medium text-warm-700 truncate">{task.name}</div>
                    <div className="text-[11px] text-warm-400 mt-0.5">
                      Float: {task.totalFloat}d
                      {task.earlyStart && ` · ${fmtDate(task.earlyStart)}`}
                      {task.earlyFinish && ` → ${fmtDate(task.earlyFinish)}`}
                    </div>
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
          onChanged={() => { refreshSchedules(); refreshMetrics() }} />
      )}

    </div>
  )
}

/* ─── Types ─────────────────────────────────────── */
interface ActivityRow {
  name: string
  activityId: string
  duration: number
  totalFloat: number
  earlyStart: string
  earlyFinish?: string
  isCritical: boolean
  status: string
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

/* ─── Metric Card ────────────────────────────────── */
function MetricCard({
  label, value, context,
  color, title,
}: {
  label: string
  value: string
  context: string
  color?: 'at-risk' | 'attention' | 'on-track'
  /** Explains how the value was measured */
  title?: string
}) {
  const valueColor =
    color === 'at-risk'   ? 'text-status-at-risk'   :
    color === 'attention' ? 'text-status-attention'  :
    color === 'on-track'  ? 'text-status-on-track'   :
    'text-navy-950'

  return (
    <div className="bg-warm-50 border border-warm-200 rounded-lg p-4" title={title}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-1.5">{label}</div>
      <div className={`text-[26px] font-bold tabular-nums leading-none ${valueColor}`}>{value}</div>
      <div className="text-[11px] text-warm-400 mt-1.5">{context}</div>
      {title && <div className="text-[11px] text-warm-500 mt-1 leading-snug">{title}</div>}
    </div>
  )
}
