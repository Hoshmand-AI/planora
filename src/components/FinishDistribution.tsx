'use client'

// How the simulated finish dates spread: one bar per date range. The runs that finish by the required date
// are drawn in green; the figure beside the chart ("chance of meeting …") says the same in a number.
// Used by the plan's risk panel and by the risk analysis of an uploaded schedule.

import { fmtDate } from '@/lib/format'

export function FinishDistribution({ histogram, iterations, required, median }: {
  histogram: { from: string; to: string; count: number }[]
  iterations?: number
  /** The date to meet, when there is one */
  required?: string | null
  median: string
}) {
  if (!histogram.length) return null
  const max = Math.max(1, ...histogram.map(h => h.count))
  const first = histogram[0], last = histogram[histogram.length - 1]
  return (
    <div>
      <div className="text-[12px] text-warm-600 mb-1">Finish date distribution{iterations ? ` (${iterations.toLocaleString()} runs)` : ''}</div>
      <div className="flex items-end gap-0.5 h-24" role="img" aria-label={`Histogram of simulated finish dates from ${fmtDate(first.from)} to ${fmtDate(last.to)}; median ${fmtDate(median)}.`}>
        {histogram.map((h, i) => (
          <div key={i} title={`${fmtDate(h.from)}–${fmtDate(h.to)}: ${h.count} runs`} className={`flex-1 rounded-t ${required && h.to <= required ? 'bg-status-on-track/70' : 'bg-accent-500/70'}`} style={{ height: `${Math.max(2, (h.count / max) * 100)}%` }} />
        ))}
      </div>
      <div className="flex justify-between text-[12px] text-warm-600 mt-1 tabular-nums"><span>{fmtDate(first.from)}</span><span>{fmtDate(last.to)}</span></div>
    </div>
  )
}
