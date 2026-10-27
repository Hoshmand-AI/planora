'use client'

// Glanceable tiles in the spirit of home-screen widgets: a progress ring and a big counter,
// each on a tinted status tile. Every value is also written out as text.

import { MoodTile, type RobotMood } from '@/components/Robot'

const RING: Record<RobotMood, string> = { working: '#2563eb', waiting: '#B86E1A', done: '#2F7358', worried: '#A64848', idle: '#736A60' }

/** A share as a ring with the percentage in the middle; the label says what it is a share of. */
export function RingTile({ mood, percent, label, sub }: { mood: RobotMood; percent: number; label: string; sub?: React.ReactNode }) {
  const p = Math.max(0, Math.min(100, Math.round(percent)))
  const r = 26, c = 2 * Math.PI * r
  return (
    <MoodTile mood={mood} className="flex items-center gap-4">
      <svg viewBox="0 0 64 64" width="64" height="64" className="flex-shrink-0 -rotate-90" role="img" aria-label={`${p}% ${label}`}>
        <circle cx="32" cy="32" r={r} fill="none" stroke="#E2DDD5" strokeWidth="7" />
        {p > 0 && <circle cx="32" cy="32" r={r} fill="none" stroke={RING[mood]} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${(p / 100) * c} ${c}`} className="meter-fill" />}
      </svg>
      <div className="min-w-0">
        <div className="text-[26px] font-bold text-navy-950 tabular-nums leading-none" aria-hidden="true">{p}%</div>
        <div className="text-[13px] text-warm-700 mt-1">{label}</div>
        {sub && <div className="text-[12px] text-warm-600 mt-0.5">{sub}</div>}
      </div>
    </MoodTile>
  )
}

/** One big number with a short caption. */
export function CounterTile({ mood, value, label, sub }: { mood: RobotMood; value: React.ReactNode; label: string; sub?: React.ReactNode }) {
  return (
    <MoodTile mood={mood} className="flex flex-col justify-center">
      <div className="text-[34px] font-bold text-navy-950 tabular-nums leading-none">{value}</div>
      <div className="text-[13px] text-warm-700 mt-1.5">{label}</div>
      {sub && <div className="text-[12px] text-warm-600 mt-0.5">{sub}</div>}
    </MoodTile>
  )
}
