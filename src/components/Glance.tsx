'use client'

// Glanceable tiles: a progress ring and a counter on a plain surface. The value comes first, at the size of a
// section heading (never larger than the page title), with its caption under it. The figure is plain; its status
// is a small dot beside the caption, so a page of tiles is not a page of colored numbers.

import { MoodTile, type RobotMood } from '@/components/Robot'

// Palette colors only: accent for work in progress, the status colors for attention / on track / at risk.
const RING: Record<RobotMood, string> = { working: '#2B63C1', waiting: '#1F4E9E', done: '#2F7358', worried: '#A64848', idle: '#666C72' }
const DOT: Record<RobotMood, string | null> = { working: null, idle: null, waiting: 'bg-status-attention', done: 'bg-status-on-track', worried: 'bg-status-at-risk' }

/** A share as a ring with the percentage in the middle; the label says what it is a share of. */
export function RingTile({ mood, percent, label, sub }: { mood: RobotMood; percent: number; label: string; sub?: React.ReactNode }) {
  const p = Math.max(0, Math.min(100, Math.round(percent)))
  const r = 26, c = 2 * Math.PI * r
  return (
    <MoodTile mood={mood} className="flex items-center gap-3 h-full">
      <svg viewBox="0 0 64 64" width="40" height="40" className="flex-shrink-0 -rotate-90" role="img" aria-label={`${p}% ${label}`}>
        <circle cx="32" cy="32" r={r} fill="none" stroke="#D3D6D9" strokeWidth="8" />
        {p > 0 && <circle cx="32" cy="32" r={r} fill="none" stroke={RING[mood]} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${(p / 100) * c} ${c}`} className="meter-fill" />}
      </svg>
      <div className="min-w-0">
        <div className="text-heading font-semibold text-ink tabular-nums" aria-hidden="true">{p}%</div>
        <div className="text-caption text-warm-700">{label}</div>
        {sub && <div className="text-caption text-warm-600">{sub}</div>}
      </div>
    </MoodTile>
  )
}

/** One number with a short caption under it. */
export function CounterTile({ mood, value, label, sub }: { mood: RobotMood; value: React.ReactNode; label: string; sub?: React.ReactNode }) {
  return (
    <MoodTile mood={mood} className="flex flex-col justify-center h-full">
      <div className="text-heading font-semibold tabular-nums text-ink">{value}</div>
      <div className="text-caption text-warm-700 flex items-center gap-1.5">{DOT[mood] && <span aria-hidden="true" className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${DOT[mood]}`} />}{label}</div>
      {sub && <div className="text-caption text-warm-600">{sub}</div>}
    </MoodTile>
  )
}
