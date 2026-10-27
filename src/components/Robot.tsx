// Nora, Hoshmand Schedule's little scheduling robot. One face, a handful of moods, so a glance says
// what state things are in before any number does: working (blue, eyes wander), needs you
// (amber, "!"), all good (green, happy eyes), behind (rose, worried), idle (grey, sleepy).
// Motion is CSS-only (float, blink, look around) and stops under prefers-reduced-motion.
// The face is decorative: always pair it with a text status (or pass `label`).

import { useId } from 'react'

export type RobotMood = 'working' | 'waiting' | 'done' | 'worried' | 'idle'

const PALETTE: Record<RobotMood, { body: string; shade: string; glow: string; eye: string; badge?: string }> = {
  working: { body: '#F4F8FF', shade: '#C9DCFB', glow: '#3b82f6', eye: '#1E3A6A' },
  waiting: { body: '#FFF6EC', shade: '#F6D3A8', glow: '#E0902F', eye: '#5A3A12', badge: '#D9822B' },
  done:    { body: '#F1FBF5', shade: '#BFE5CD', glow: '#2F9E6A', eye: '#1F4D36', badge: '#2F9E6A' },
  worried: { body: '#FFF3F3', shade: '#F1C4C4', glow: '#C25B5B', eye: '#5C2323' },
  idle:    { body: '#F8F6F3', shade: '#E2DDD5', glow: '#9A9186', eye: '#433D36' },
}

export function Robot({ mood = 'working', size = 64, label, className = '', still = false }: {
  mood?: RobotMood
  size?: number
  /** Accessible name; omit when a visible status sits next to the face */
  label?: string
  className?: string
  /** No idle animation (e.g. in dense lists) */
  still?: boolean
}) {
  const c = PALETTE[mood]
  const gid = `nora-${mood}-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const }
  return (
    <svg viewBox="0 0 100 84" width={size} height={size * 0.84} className={`nora ${still ? '' : 'nora-float'} ${className}`} data-mood={mood} {...a11y}>
      <defs>
        <radialGradient id={`${gid}-body`} cx="45%" cy="35%" r="75%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="60%" stopColor={c.body} />
          <stop offset="100%" stopColor={c.shade} />
        </radialGradient>
        <radialGradient id={`${gid}-glow`} cx="50%" cy="55%" r="50%">
          <stop offset="0%" stopColor={c.glow} stopOpacity="0.35" />
          <stop offset="100%" stopColor={c.glow} stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="50" cy="48" rx="48" ry="36" fill={`url(#${gid}-glow)`} />
      {/* arms */}
      <ellipse cx="13" cy="50" rx="5" ry="6.5" fill={c.shade} />
      <ellipse cx="87" cy="50" rx="5" ry="6.5" fill={c.shade} />
      {/* head */}
      <rect x="16" y="16" width="68" height="56" rx="26" fill={`url(#${gid}-body)`} stroke={c.shade} strokeWidth="1.2" />
      {/* cheeks */}
      {(mood === 'done' || mood === 'working') && <>
        <ellipse cx="31" cy="54" rx="5" ry="2.6" fill="#F5A3B5" opacity="0.45" />
        <ellipse cx="69" cy="54" rx="5" ry="2.6" fill="#F5A3B5" opacity="0.45" />
      </>}
      {/* eyes */}
      <g className={still ? '' : mood === 'working' ? 'nora-look' : mood === 'idle' ? '' : 'nora-blink'} fill={c.eye} stroke={c.eye}>
        {mood === 'done' ? (
          <g fill="none" strokeWidth="3.6" strokeLinecap="round">
            <path d="M33 45 q6 -7 12 0" />
            <path d="M55 45 q6 -7 12 0" />
          </g>
        ) : mood === 'idle' ? (
          <g fill="none" strokeWidth="3.2" strokeLinecap="round">
            <path d="M34 45 h10" />
            <path d="M56 45 h10" />
          </g>
        ) : (
          <g stroke="none">
            <rect x="35" y="36" width="8" height="15" rx="4" />
            <rect x="57" y="36" width="8" height="15" rx="4" />
            <circle cx="40.5" cy="40" r="1.6" fill="#fff" />
            <circle cx="62.5" cy="40" r="1.6" fill="#fff" />
          </g>
        )}
      </g>
      {/* mouth / brows */}
      {mood === 'worried' && <g fill="none" stroke={c.eye} strokeWidth="2.4" strokeLinecap="round">
        <path d="M33 33 l9 -3" /><path d="M67 33 l-9 -3" />
        <path d="M44 61 q6 -4 12 0" />
      </g>}
      {mood === 'done' && <path d="M44 56 q6 5 12 0" fill="none" stroke={c.eye} strokeWidth="2.4" strokeLinecap="round" />}
      {mood === 'idle' && <text x="80" y="20" fontSize="12" fontWeight="700" fill={c.glow} className={still ? '' : 'nora-z'}>z</text>}
      {/* badge */}
      {mood === 'waiting' && <g>
        <circle cx="22" cy="20" r="9" fill={c.badge} stroke="#fff" strokeWidth="2" />
        <rect x="20.8" y="14" width="2.4" height="7.5" rx="1.2" fill="#fff" />
        <circle cx="22" cy="24.6" r="1.4" fill="#fff" />
      </g>}
      {mood === 'done' && <g>
        <circle cx="22" cy="20" r="9" fill={c.badge} stroke="#fff" strokeWidth="2" />
        <path d="M17.8 20.2 l3 3 l5.4 -6" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </g>}
    </svg>
  )
}

/** A soft, rounded tile with a mood-coloured glow and a fine grain, for glanceable status. */
export function MoodTile({ mood, children, className = '', as: Tag = 'div' }: {
  mood: RobotMood
  children: React.ReactNode
  className?: string
  as?: 'div' | 'section' | 'li'
}) {
  return <Tag className={`mood-tile grain rounded-2xl border p-4 ${className}`} data-mood={mood}>{children}</Tag>
}
