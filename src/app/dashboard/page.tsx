'use client'

import { useApp } from './layout'
import { Upload } from 'lucide-react'

export default function DashboardPage() {
  const { selectedSchedule, metrics } = useApp()

  if (!selectedSchedule) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center px-6">
        <div className="w-12 h-12 bg-warm-100 border border-warm-200 rounded-lg flex items-center justify-center mb-4">
          <Upload size={20} className="text-warm-400" />
        </div>
        <div className="text-[17px] font-semibold text-navy-950 mb-2">Upload a schedule to get started</div>
        <p className="text-[14px] text-warm-500 max-w-[360px]">Upload a Primavera P6 (.xer), MS Project (.xml), or PDF file to see your project dashboard.</p>
      </div>
    )
  }

  const m = metrics as Record<string, number | unknown[]> | null

  const varianceDays  = Number(m?.varianceDays ?? 0)
  const criticalCount = Number(m?.criticalCount ?? 0)
  const totalActivities = Number(m?.totalActivities ?? 0)
  const percentComplete = Number(m?.percentComplete ?? 0)
  const nearTermTasks = (m?.nearTermTasks as ActivityRow[]) ?? []
  const drivingTasks  = (m?.drivingTasks as ActivityRow[])  ?? []

  return (
    <div className="p-5 md:p-6 space-y-6">

      {/* Schedule summary strip */}
      <div className="flex items-center justify-between border-b border-warm-200 pb-4">
        <div>
          <div className="text-[17px] font-semibold text-navy-950">{selectedSchedule.name}</div>
          <div className="text-[12px] text-warm-400 mt-0.5">
            {selectedSchedule.version} · {selectedSchedule.activityCount} activities · uploaded {new Date(selectedSchedule.uploadedAt).toLocaleDateString()}
            {selectedSchedule.dataDate && ` · data date ${new Date(selectedSchedule.dataDate).toLocaleDateString()}`}
          </div>
        </div>
        <span className={`text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md border-l-2 ${
          varianceDays > 14
            ? 'text-status-at-risk bg-status-at-risk-bg border-status-at-risk'
            : varianceDays > 0
            ? 'text-status-attention bg-status-attention-bg border-status-attention'
            : 'text-status-on-track bg-status-on-track-bg border-status-on-track'
        }`}>
          {varianceDays > 14 ? 'At Risk' : varianceDays > 0 ? 'Attention' : 'On Track'}
        </span>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="Schedule Variance"
          value={varianceDays !== 0 ? `${varianceDays > 0 ? '+' : ''}${varianceDays}d` : '0d'}
          context="from baseline"
          color={varianceDays > 14 ? 'at-risk' : varianceDays > 0 ? 'attention' : 'on-track'}
        />
        <MetricCard
          label="Critical Activities"
          value={String(criticalCount)}
          context={totalActivities > 0 ? `of ${totalActivities} total` : 'total activities'}
        />
        <MetricCard
          label="Near-Term Tasks"
          value={String(nearTermTasks.length)}
          context="starting in 14 days"
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

        {nearTermTasks.length > 0 && (
          <section>
            <h2 className="font-display text-[18px] text-navy-950 mb-3">Near-Term Outlook</h2>
            <div className="bg-warm-50 border border-warm-200 rounded-lg overflow-hidden">
              {nearTermTasks.slice(0, 8).map((task, i) => (
                <div key={i} className={`flex items-center justify-between px-4 py-3 ${i < nearTermTasks.slice(0, 8).length - 1 ? 'border-b border-warm-200' : ''}`}>
                  <div className="min-w-0 pr-3">
                    <div className="text-[13.5px] font-medium text-warm-700 truncate">{task.name}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-warm-400">
                        {task.earlyStart ? new Date(task.earlyStart).toLocaleDateString() : 'TBD'}
                      </span>
                      {task.isCritical && (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-status-attention bg-status-attention-bg px-1.5 py-0.5 rounded border-l-2 border-status-attention">
                          Priority
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-[13px] font-semibold text-navy-950 tabular-nums flex-shrink-0">{task.duration}d</div>
                </div>
              ))}
            </div>
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
                      {task.earlyStart && ` · ${new Date(task.earlyStart).toLocaleDateString()}`}
                      {task.earlyFinish && ` → ${new Date(task.earlyFinish).toLocaleDateString()}`}
                    </div>
                  </div>
                  <div className="text-[13px] font-semibold text-navy-950 tabular-nums flex-shrink-0">{task.duration}d</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {nearTermTasks.length === 0 && drivingTasks.length === 0 && (
          <div className="col-span-2 text-center py-12 text-warm-400 text-[14px]">
            No task data available for this schedule.
          </div>
        )}
      </div>

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

/* ─── Metric Card ────────────────────────────────── */
function MetricCard({
  label, value, context,
  color,
}: {
  label: string
  value: string
  context: string
  color?: 'at-risk' | 'attention' | 'on-track'
}) {
  const valueColor =
    color === 'at-risk'   ? 'text-status-at-risk'   :
    color === 'attention' ? 'text-status-attention'  :
    color === 'on-track'  ? 'text-status-on-track'   :
    'text-navy-950'

  return (
    <div className="bg-warm-50 border border-warm-200 rounded-lg p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-1.5">{label}</div>
      <div className={`text-[26px] font-bold tabular-nums leading-none ${valueColor}`}>{value}</div>
      <div className="text-[11px] text-warm-400 mt-1.5">{context}</div>
    </div>
  )
}
