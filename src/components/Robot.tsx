// Status mark: a quiet, abstract ring that says what state something is in before any number
// does: working (blue, a slow sweep), needs you (amber), all good (green, a check), behind (rose),
// idle (grey). It replaced the old robot face; the exports keep their names so call sites stay put.
// Motion is CSS-only and stops under prefers-reduced-motion. The mark is decorative: always pair
// it with a text status (or pass `label`).

export type RobotMood = 'working' | 'waiting' | 'done' | 'worried' | 'idle'

const COLOR: Record<RobotMood, string> = {
  working: '#2563eb',
  waiting: '#B86E1A',
  done: '#2F7358',
  worried: '#A64848',
  idle: '#56656F',
}

export function Robot({ mood = 'working', size = 64, label, className = '', still = false }: {
  mood?: RobotMood
  size?: number
  /** Accessible name; omit when a visible status sits next to the mark */
  label?: string
  className?: string
  /** No animation (e.g. in dense lists) */
  still?: boolean
}) {
  const c = COLOR[mood]
  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const }
  const s = Math.round(size * 0.72)
  return (
    <svg viewBox="0 0 48 48" width={s} height={s} className={`status-mark ${className}`} data-mood={mood} {...a11y}>
      <circle cx="24" cy="24" r="20" fill="none" stroke={c} strokeOpacity="0.16" strokeWidth="4" />
      {mood === 'working' ? (
        <circle cx="24" cy="24" r="20" fill="none" stroke={c} strokeWidth="4" strokeLinecap="round" strokeDasharray="34 92" className={still ? '' : 'status-sweep'} />
      ) : (
        <circle cx="24" cy="24" r="20" fill="none" stroke={c} strokeWidth="4" strokeDasharray={mood === 'idle' ? '2 8' : undefined} />
      )}
      {mood === 'done' && <path d="M16 24.5 l5.5 5.5 L32.5 18.5" fill="none" stroke={c} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />}
      {(mood === 'waiting' || mood === 'worried') && <>
        <rect x="22" y="13" width="4" height="14" rx="2" fill={c} />
        <circle cx="24" cy="33.5" r="2.6" fill={c} />
      </>}
      {mood === 'working' && <circle cx="24" cy="24" r="5" fill={c} className={still ? '' : 'status-pulse'} />}
      {mood === 'idle' && <circle cx="24" cy="24" r="4" fill={c} />}
    </svg>
  )
}

/** A soft, rounded tile tinted by status, for glanceable state. */
export function MoodTile({ mood, children, className = '', as: Tag = 'div' }: {
  mood: RobotMood
  children: React.ReactNode
  className?: string
  as?: 'div' | 'section' | 'li'
}) {
  return <Tag className={`mood-tile rounded-2xl border p-4 ${className}`} data-mood={mood}>{children}</Tag>
}
