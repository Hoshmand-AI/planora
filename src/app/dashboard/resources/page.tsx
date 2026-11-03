'use client'

import { useApp } from '../layout'
import { ResourcesPanel } from '@/components/ResourcesPanel'
import { EmptyState } from '@/components/EmptyState'

export default function ResourcesPage() {
  const { selectedSchedule, can, openUpload } = useApp()
  if (!selectedSchedule) {
    return (
      <EmptyState title="Select a schedule to see its resources" action={{ label: can('schedule.write') ? 'Upload a schedule' : 'Build a schedule', onClick: openUpload }}>
        Resource loading, histograms, over-allocations and leveling use the resources and assignments in the uploaded file.
      </EmptyState>
    )
  }
  return (
    <div className="p-5 md:p-6 space-y-4">
      <div>
        <h1 className="text-[17px] font-semibold text-navy-950">Resources</h1>
        <p className="text-[13px] text-warm-600">{selectedSchedule.name} · {selectedSchedule.version}</p>
      </div>
      <ResourcesPanel key={selectedSchedule.id} kind="schedule" id={selectedSchedule.id} canEdit={can('schedule.write') && selectedSchedule.sourceType !== 'generated'} />
    </div>
  )
}
