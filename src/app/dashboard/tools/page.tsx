'use client'

// Analysis tools for the open project (compare updates, edits made in RunF9, what-if and recovery, risk analysis).
// Reached from the project's "More" menu: they are used occasionally, so they do not take a tab.

import { useApp } from '../layout'
import { ScheduleTools } from '@/components/ScheduleTools'
import { EmptyState } from '@/components/EmptyState'

export default function ToolsPage() {
  const { selectedSchedule, metrics, can, openUpload, refreshSchedules, refreshMetrics } = useApp()
  if (!selectedSchedule || selectedSchedule.sourceType === 'generated') {
    return (
      <EmptyState title={selectedSchedule ? 'Analysis tools need an uploaded schedule' : 'Select a project to use the analysis tools'}
        action={can('schedule.write') ? { label: 'Upload a schedule', onClick: openUpload } : { label: 'Go to your projects', href: '/dashboard' }}>
        Compare updates, review edits made in RunF9, run what-if and recovery options and a schedule risk analysis.
      </EmptyState>
    )
  }
  return (
    <div className="max-w-6xl mx-auto px-5 md:px-8 py-6">
      <ScheduleTools key={selectedSchedule.id} scheduleId={selectedSchedule.id}
        progressMode={(selectedSchedule.analysis?.progressMode as 'retained' | 'override') || 'retained'}
        inHistory={selectedSchedule.inHistory ?? true}
        canEdit={can('schedule.write')} editsCount={Number((metrics as Record<string, unknown> | null)?.editsCount ?? 0)}
        version={selectedSchedule.version} classification={selectedSchedule.classification ?? null}
        origin={selectedSchedule.uploadOrigin ?? null} historyOverride={selectedSchedule.historyOverride ?? false}
        onChanged={() => { refreshSchedules(); refreshMetrics() }} />
    </div>
  )
}
