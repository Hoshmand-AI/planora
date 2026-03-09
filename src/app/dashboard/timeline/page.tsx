'use client'

import { useState, useEffect } from 'react'
import { useApp } from '../layout'
import { Upload } from 'lucide-react'

interface ActivityData {
  name: string; activityId: string; duration: number; remainingDuration: number
  totalFloat: number; percentComplete: number; earlyStart: string | null; earlyFinish: string | null
  isCritical: boolean; status: string; activityType: string; wbs: string
}

export default function TimelinePage() {
  const { selectedSchedule } = useApp()
  const [view, setView]           = useState<'phases' | 'gantt'>('phases')
  const [activities, setActivities] = useState<ActivityData[]>([])

  useEffect(() => {
    if (!selectedSchedule) return
    fetch(`/api/schedules?id=${selectedSchedule.id}`)
      .then(r => r.json())
      .then(data => setActivities(data.activities || []))
  }, [selectedSchedule])

  if (!selectedSchedule) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center px-6">
        <div className="w-12 h-12 bg-warm-100 border border-warm-200 rounded-lg flex items-center justify-center mb-4">
          <Upload size={20} className="text-warm-400" />
        </div>
        <div className="text-[17px] font-semibold text-navy-950 mb-2">Upload a schedule to see the timeline</div>
        <p className="text-[14px] text-warm-500 max-w-[340px]">View phases and Gantt chart from your schedule data.</p>
      </div>
    )
  }

  // Group by WBS for phases view
  const wbsGroups: Record<string, ActivityData[]> = {}
  activities
    .filter(a => a.activityType === 'task' || a.activityType === 'milestone')
    .forEach(a => {
      const wbs = a.wbs?.split('.').slice(0, 2).join('.') || 'Ungrouped'
      if (!wbsGroups[wbs]) wbsGroups[wbs] = []
      wbsGroups[wbs].push(a)
    })

  const phases = Object.entries(wbsGroups).map(([wbs, acts]) => {
    const totalDuration     = acts.reduce((s, a) => s + a.duration, 0)
    const completedDuration = acts.reduce((s, a) => s + (a.duration * a.percentComplete / 100), 0)
    const pct               = totalDuration > 0 ? Math.round((completedDuration / totalDuration) * 100) : 0
    const starts   = acts.map(a => a.earlyStart).filter(Boolean).sort()
    const finishes = acts.map(a => a.earlyFinish).filter(Boolean).sort()
    return {
      name:            wbs === 'Ungrouped' ? 'General Activities' : `Phase ${wbs}`,
      activityCount:   acts.length,
      percentComplete: pct,
      start:           starts[0] || null,
      finish:          finishes[finishes.length - 1] || null,
      hasCritical:     acts.some(a => a.isCritical),
      allComplete:     acts.every(a => a.status === 'complete'),
    }
  }).slice(0, 20)

  // Gantt data
  const ganttActivities = activities
    .filter(a => a.activityType === 'task' && a.earlyStart && a.duration > 0)
    .sort((a, b) => (a.earlyStart || '').localeCompare(b.earlyStart || ''))
    .slice(0, 30)

  const allStarts   = ganttActivities.map(a => new Date(a.earlyStart!).getTime())
  const allFinishes = ganttActivities.map(a => new Date(a.earlyStart!).getTime() + a.duration * 86400000)
  const ganttStart  = allStarts.length   > 0 ? Math.min(...allStarts)   : Date.now()
  const ganttEnd    = allFinishes.length > 0 ? Math.max(...allFinishes) : Date.now() + 180 * 86400000
  const ganttRange  = ganttEnd - ganttStart || 1

  return (
    <div className="p-5 md:p-6">
      {/* View toggle */}
      <div className="flex gap-2 mb-5">
        {(['phases', 'gantt'] as const).map(v => (
          <button key={v} onClick={() => setView(v)}
            className={`px-4 py-2 rounded-md text-[13px] font-semibold transition-colors ${
              view === v
                ? 'bg-navy-900 text-white'
                : 'bg-transparent border border-warm-300 text-warm-600 hover:bg-warm-100'
            }`}>
            {v === 'phases' ? 'Phases' : 'Gantt'}
          </button>
        ))}
      </div>

      {/* Phases */}
      {view === 'phases' && (
        <div className="space-y-3">
          {phases.map((phase, i) => (
            <div key={i} className="bg-warm-100 border border-warm-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[14px] font-semibold text-navy-950">{phase.name}</div>
                {phase.allComplete ? (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-status-complete bg-status-complete-bg px-2 py-0.5 rounded-md border-l-2 border-status-complete">Complete</span>
                ) : phase.hasCritical ? (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-status-attention bg-status-attention-bg px-2 py-0.5 rounded-md border-l-2 border-status-attention">Attention</span>
                ) : (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-status-info bg-status-info-bg px-2 py-0.5 rounded-md border-l-2 border-status-info">In Progress</span>
                )}
              </div>
              <div className="text-[12px] text-warm-400 mb-3">
                {phase.activityCount} activities
                {phase.start  && ` · ${new Date(phase.start).toLocaleDateString()}`}
                {phase.finish && ` — ${new Date(phase.finish).toLocaleDateString()}`}
              </div>
              <div className="h-1.5 bg-warm-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${phase.allComplete ? 'bg-status-complete' : phase.hasCritical ? 'bg-status-attention' : 'bg-gold-500'}`}
                  style={{ width: `${phase.percentComplete}%` }}
                />
              </div>
              <div className="text-[11px] font-semibold text-warm-400 mt-1.5">{phase.percentComplete}%</div>
            </div>
          ))}
          {phases.length === 0 && <p className="text-center text-warm-400 py-8 text-[14px]">No phase data available.</p>}
        </div>
      )}

      {/* Gantt */}
      {view === 'gantt' && (
        <div className="overflow-x-auto">
          <div className="min-w-[700px]">
            <div className="flex items-center h-8 bg-warm-200 rounded-t-md px-3 text-[11px] font-semibold uppercase tracking-wider text-warm-500">
              <div className="w-[200px] flex-shrink-0">Activity</div>
              <div className="flex-1 text-center text-[10px]">
                {new Date(ganttStart).toLocaleDateString()} — {new Date(ganttEnd).toLocaleDateString()}
              </div>
            </div>
            <div className="border border-warm-200 border-t-0 rounded-b-md overflow-hidden">
              {ganttActivities.map((act, i) => {
                const actStart  = new Date(act.earlyStart!).getTime()
                const actEnd    = actStart + act.duration * 86400000
                const left      = ((actStart - ganttStart) / ganttRange) * 100
                const width     = ((actEnd - actStart)   / ganttRange) * 100
                return (
                  <div key={i} className={`flex items-center h-8 px-3 border-b border-warm-200 last:border-0 ${i % 2 === 0 ? 'bg-warm-50' : 'bg-white'}`}>
                    <div className="w-[200px] flex-shrink-0 text-[12px] text-warm-700 truncate pr-2">{act.name}</div>
                    <div className="flex-1 relative h-5">
                      <div
                        className={`absolute h-3 top-1 rounded-sm ${act.isCritical ? 'bg-status-attention' : act.status === 'complete' ? 'bg-status-complete' : 'bg-gold-400'}`}
                        style={{ left: `${Math.max(0, left)}%`, width: `${Math.max(0.5, Math.min(width, 100 - left))}%` }}
                      >
                        {act.percentComplete > 0 && (
                          <div
                            className={`h-full rounded-sm ${act.isCritical ? 'bg-status-attention' : 'bg-gold-600'}`}
                            style={{ width: `${act.percentComplete}%` }}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
              {ganttActivities.length === 0 && (
                <div className="p-6 text-center text-warm-400 text-[14px]">No Gantt data available.</div>
              )}
            </div>
            <div className="flex gap-5 mt-3 text-[11px] text-warm-400">
              <span className="flex items-center gap-1.5"><span className="w-3 h-2 bg-gold-400 rounded-sm inline-block" /> Normal</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-2 bg-status-attention rounded-sm inline-block" /> Priority</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-2 bg-status-complete rounded-sm inline-block" /> Complete</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
