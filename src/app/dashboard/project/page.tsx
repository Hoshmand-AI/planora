'use client'

import { useApp } from '../layout'
import { type RobotMood } from '@/components/Robot'
import { FinishHero } from '@/components/FinishHero'
import { RingTile, CounterTile } from '@/components/Glance'
import { Disclosure } from '@/components/Disclosure'
import { fmtDate, fmtDates } from '@/lib/format'
import type { CriticalPathStatus } from '@/lib/analysis/critical-status'
import Link from 'next/link'
import { EmptyState } from '@/components/EmptyState'
import { ProjectBrief } from '@/components/ProjectBrief'
import { DataCenterSampleButton } from '@/components/DataCenterSample'
import type { DailyBrief } from '@/lib/analysis/daily-brief'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

/** One project: the selected schedule's overview. Home (/dashboard) lists every project. */
export default function ProjectPage() {
  const { selectedSchedule, metrics, metricsError, refreshMetrics, can, openUpload } = useApp()
  // Earned value and the analysis tools used to be tabs of this page; links that still point at them move on.
  const router = useRouter()
  useEffect(() => {
    const go = () => {
      const h = window.location.hash, q = window.location.search
      if (h === '#earned-value') router.replace(`/dashboard/earned-value${q}`)
      else if (h === '#tools' || h === '#compare' || h === '#recovery') router.replace(`/dashboard/tools${q}${h === '#tools' ? '' : h}`)
    }
    go()
    window.addEventListener('hashchange', go)
    return () => window.removeEventListener('hashchange', go)
  }, [router])
  // The deadline position from the daily brief (the contract milestone and its required date), so the finish answer
  // and the attention list below it never disagree. undefined while it loads.
  const [headline, setHeadline] = useState<DailyBrief['headline'] | null | undefined>(undefined)
  useEffect(() => { setHeadline(undefined) }, [selectedSchedule?.id])
  // DCMA pass count for the Quality tile (the Quality tab has the detail).
  const [quality, setQuality] = useState<{ passed: number; applicable: number; failing: number } | null>(null)
  useEffect(() => {
    setQuality(null)
    if (!selectedSchedule || selectedSchedule.sourceType === 'generated') return
    let live = true
    fetch(`/api/schedules/${selectedSchedule.id}/quality`).then(r => r.ok ? r.json() : null).then(d => {
      if (live && d?.dcma) setQuality({ passed: d.dcma.passed, applicable: d.dcma.applicable, failing: d.dcma.checks.filter((c: { result: string }) => c.result === 'fail').length })
    }).catch(() => {})
    return () => { live = false }
  }, [selectedSchedule])

  if (!selectedSchedule) {
    return (<>
      <EmptyState title="No project open"
        action={can('schedule.write') ? { label: 'Upload a schedule', onClick: openUpload } : { label: 'Go to your projects', href: '/dashboard' }}
        secondary={can('schedule.write') ? { label: 'Or choose one from your projects', href: '/dashboard' } : undefined}>
        Open a project to see its finish date, critical path and what needs attention.
      </EmptyState>
      <DataCenterSampleButton className="-mt-10 pb-12 text-center" />
    </>    )
  }

  const m = metrics as Record<string, number | unknown[]> | null

  const mx = (m as Record<string, unknown> | null) ?? {}
  // Status and variance come from RunF9's recalculation (src/lib/analysis/schedule-analysis.ts).
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

  const criticalCount = Number(m?.criticalCount ?? 0)
  // Whether a critical path exists at all (src/lib/analysis/critical-status.ts): never a confident 0 without logic.
  const criticalPath = (mx.criticalPath as CriticalPathStatus | undefined) ?? null
  const totalActivities = Number(m?.totalActivities ?? 0)
  const percentComplete = Number(m?.percentComplete ?? 0)
  const brief = ((m as Record<string, unknown> | null)?.brief as unknown as { summary: string; facts: { label: string; value: string }[]; nextMilestones: { name: string; date: string; critical: boolean; basis?: 'scheduled' | 'logic'; scheduled?: string }[] } | null) ?? null
  const allWarnings = ((m as Record<string, unknown> | null)?.warnings as string[]) ?? []
  // A file built for import (no start, data date or activity dates) is scheduled from the day it was calculated:
  // say so next to the forecast, so a far-off finish isn't read as the file's own date.
  const undatedStart = allWarnings.map(w => /scheduled from (\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}).*calendar dates are not/i.exec(w)?.[1]).find(Boolean)
  const undatedNote = undatedStart ? `The file has no dates, so RunF9 scheduled it from ${fmtDates(undatedStart)}. The durations, logic and float are the file's; the calendar dates are not.` : null
  const isBaselineUpload = /baseline/i.test(selectedSchedule.version || '')
  const warnings = [...new Set((((m as Record<string, unknown> | null)?.warnings as string[]) ?? []).filter(w => /calculat|relationships/i.test(w)))]

  // Whether "Why this status" has anything to explain.
  const hasWhy = statusReasons.length > 0 || twoFinishes || (reportedFinish && forecastFinish && reportedFinish !== forecastFinish) || !!baselineHeader || !!varianceBasis
  const varianceTone: RobotMood = varianceDays == null ? 'idle' : varianceDays > 14 ? 'worried' : varianceDays > 0 ? 'waiting' : 'done'

  return (
    <div className="max-w-6xl mx-auto px-5 md:px-8 py-6 space-y-6">

      <div className="space-y-6">

      {/* The first answer: will we finish on time? Then four numbers that explain it. */}
      <section aria-label="Schedule health" className="space-y-4">
        {!m && metricsError && (
          <p role="alert" className="rounded-md border border-status-at-risk bg-status-at-risk-bg px-3 py-2 text-body text-status-at-risk">
            RunF9 could not load this schedule&apos;s numbers. <button type="button" onClick={() => { refreshMetrics() }} className="underline font-medium">Try again</button>
          </p>
        )}
        <FinishHero status={status} forecastFinish={forecastFinish}
          mustFinishBy={(mx.mustFinishBy as string) || null} baselineFinish={(mx.baselineFinish as string) || null}
          projectStart={(mx.projectStart as string) || null} dataDate={selectedSchedule.dataDate ?? null}
          deadline={headline?.required ? { required: headline.required, daysBehind: headline.daysBehind, text: headline.text } : null} pending={headline === undefined}
          reason={!m ? (metricsError ? 'The numbers for this schedule could not be loaded.' : 'Reading this schedule…') : statusReasons[0] ? null
            : status === 'no_baseline' && !headline?.required ? (isBaselineUpload
              ? 'This upload is the baseline. Upload a status update of the same project and RunF9 measures variance against it.'
              : 'There is no baseline or required finish to measure this forecast against. Mark an upload of this project as Baseline to track variance.')
            : null}
          note={undatedNote} />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Until the numbers arrive the tiles show a dash, never a made-up 0 */}
          {m ? <RingTile mood={percentComplete >= 100 ? 'done' : 'working'} percent={percentComplete} label="complete" sub="by duration" />
            : <CounterTile mood="idle" value="—" label="complete" sub="by duration" />}
          <CounterTile mood={varianceTone}
            value={!m ? '—' : varianceDays == null ? <span className="text-warm-600">{isBaselineUpload ? 'This is the baseline' : 'No baseline'}</span> : varianceDays !== 0 ? `${varianceDays > 0 ? '+' : ''}${varianceDays}d` : '0d'}
            label="Variance vs baseline"
            sub={!m ? (metricsError ? 'not available' : 'loading…') : varianceDays == null ? (isBaselineUpload ? 'measured from the next update' : 'mark an upload as Baseline to measure it') : 'calendar days'} />
          <CounterTile mood={criticalPath && !criticalPath.determined ? 'waiting' : 'idle'}
            value={!m || (criticalPath && !criticalPath.determined) ? '—' : String(criticalCount)} label="Critical activities"
            sub={!m ? (metricsError ? 'not available' : 'loading…') : criticalPath && (!criticalPath.determined || criticalCount === 0) ? criticalPath.label : totalActivities > 0 ? `of ${totalActivities} total` : 'total activities'} />
          <Link href={`/dashboard/quality?schedule=${selectedSchedule.id}`} className="block rounded-2xl card-lift h-full">
            <CounterTile mood={!quality ? 'idle' : quality.failing ? 'worried' : 'done'}
              value={quality ? `${quality.passed}/${quality.applicable}` : '—'} label="Quality checks pass"
              sub={!quality ? 'DCMA 14-point' : quality.failing ? `${quality.failing} to fix · open Quality` : 'all applicable checks pass'} />
          </Link>
        </div>
        {criticalPath?.detail && (
          <p role="note" className="text-body text-warm-700 bg-white/70 border border-warm-200 rounded-xl px-4 py-2.5">
            <span className="font-semibold text-ink">Critical path: </span>{fmtDates(criticalPath.detail)}
          </p>
        )}
        {hasWhy && (
          <Disclosure tone="card" title="Why this status" meta={statusReasons.length ? `${statusReasons.length} ${statusReasons.length === 1 ? 'reason' : 'reasons'}` : undefined}>
            <div className="text-body text-warm-700 space-y-1.5">
              {statusReasons.map((r, i) => <p key={i}>{fmtDates(r)}</p>)}
              {twoFinishes && (
                <p className="text-warm-700">Forecast (as scheduled, constraints honoured): <span className="tabular-nums font-medium">{fmtDate(scheduledFinish)}</span> · Logic-driven (mandatory constraints relaxed): <span className="tabular-nums font-medium">{fmtDate(logicFinish)}</span></p>
              )}
              {reportedFinish && forecastFinish && reportedFinish !== forecastFinish && (
                <p className="text-warm-600">RunF9&apos;s recalculated forecast finish is {fmtDate(forecastFinish)}{twoFinishes ? ' (logic-driven)' : ''}; the file&apos;s header says {fmtDate(reportedFinish)}.</p>
              )}
              {(baselineHeader || varianceBasis) && (
                <p className="text-caption text-warm-600 pt-1"><span className="font-medium text-ink">How variance is measured: </span>{varianceNote(baselineHeader, varianceBasis)}</p>
              )}
            </div>
          </Disclosure>
        )}
      </section>

      {/* What needs attention, then the detail behind it in folded cards (one page, where Today and Overview used to be two). */}
      <ProjectBrief onHeadline={setHeadline} />

      {/* Only what the forecast and the tiles above do not already say: the next milestones, with the project type and length. Folded. */}
      {brief && (brief.nextMilestones.length > 0 || warnings.length > 0) && (
        <Disclosure tone="card" title="Next milestones" meta={brief.nextMilestones[0] ? `${brief.nextMilestones[0].name} ${brief.nextMilestones[0].date}` : undefined}>
          {brief.nextMilestones.length > 0 && (
            <ul className="divide-y divide-warm-200 text-body">
              {brief.nextMilestones.map((ms, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-3 py-1.5">
                  <span className="flex-1 min-w-[180px] text-ink">{ms.name}{ms.critical ? <span className="text-warm-600"> · critical</span> : null}</span>
                  {ms.basis === 'logic' && <span className="text-caption text-warm-600" title={`Logic-driven date; ${ms.scheduled ?? ''} as scheduled, held by a mandatory constraint`}>logic-driven; {ms.scheduled} as scheduled</span>}
                  <span className="tabular-nums font-medium text-ink">{ms.date}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-caption text-warm-600">{brief.facts.filter(f => /^(type|duration)$/i.test(f.label)).map(f => `${f.label}: ${f.value}`).join(' · ')}</p>
          {warnings.slice(0, 2).map((w, i) => <p key={i} className="mt-1.5 text-caption text-warm-600 border-l-2 border-status-info pl-2">{fmtDates(w)}</p>)}
        </Disclosure>
      )}

      </div>

    </div>
  )
}

/* ─── Variance note ──────────────────────────────── */
/** The baseline header and the variance basis, without repeating the reason both carry or doubling a period. */
function varianceNote(header: string, basis: string) {
  const h = header ? header.replace(/\.?$/, '.') : ''
  const reason = header.replace(/^Baseline:[^.]*\.\s*/, '').trim()
  const b = reason && basis.startsWith(reason) ? basis.slice(reason.length).trim() : basis
  return [h, b].filter(Boolean).join(' ')
}
