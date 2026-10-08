'use client'

import { useApp } from '../layout'
import { Users } from 'lucide-react'
import { ResourcesPanel } from '@/components/ResourcesPanel'

export default function ResourcesPage() {
  const { selectedSchedule, can } = useApp()
  if (!selectedSchedule) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center px-6">
        <div className="w-12 h-12 bg-warm-100 border border-warm-200 rounded-lg flex items-center justify-center mb-4">
          <Users size={20} className="text-warm-500" aria-hidden />
        </div>
        <h1 className="text-[17px] font-semibold text-navy-950 mb-2">Select a schedule to see its resources</h1>
        <p className="text-[14px] text-warm-600 max-w-[380px]">Resource loading, histograms, over-allocations and leveling use the resources and assignments in the uploaded file.</p>
      </div>
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
