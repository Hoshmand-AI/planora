'use client'

// Earned value of the open project: a view of the Reports tab.

import { useApp } from '../layout'
import { EarnedValue } from '@/components/EarnedValue'
import { EmptyState } from '@/components/EmptyState'

export default function EarnedValuePage() {
  const { selectedSchedule, can, openUpload } = useApp()
  if (!selectedSchedule || selectedSchedule.sourceType === 'generated') {
    return (
      <EmptyState title={selectedSchedule ? 'Earned value needs an uploaded schedule' : 'Select a project to see its earned value'}
        action={can('schedule.write') ? { label: 'Upload a schedule', onClick: openUpload } : { label: 'Go to your projects', href: '/dashboard' }}>
        Earned value is measured from the costs and progress in an uploaded P6 or Microsoft Project file.
      </EmptyState>
    )
  }
  return (
    <div className="max-w-6xl mx-auto px-5 md:px-8 py-6">
      <EarnedValue key={selectedSchedule.id} scheduleId={selectedSchedule.id} />
    </div>
  )
}
