'use client'

// A calm zero state: Nora (resting, or another mood), one short line, and one clear action.
// Nora is decorative here; the heading says what is going on.

import Link from 'next/link'
import { Robot, type RobotMood } from '@/components/Robot'

type Action = { label: string; href: string } | { label: string; onClick: () => void }

export function EmptyState({ title, children, action, secondary, mood = 'idle', heading = 'h1', inline = false, className = '' }: {
  title: string
  /** One or two short sentences */
  children?: React.ReactNode
  /** The single primary action */
  action?: Action
  /** An optional quiet link under the action */
  secondary?: Action
  mood?: RobotMood
  /** Use 'h2' / 'h3' when the page already has an h1 */
  heading?: 'h1' | 'h2' | 'h3' | 'div'
  /** Smaller, for a zero state inside a card */
  inline?: boolean
  className?: string
}) {
  const H = heading
  return (
    <div className={`flex flex-col items-center justify-center text-center ${inline ? 'px-4 py-6' : 'px-6 py-16 md:py-20'} ${className}`}>
      <div className={`mood-tile grain border ${inline ? 'rounded-2xl px-4 pt-3 pb-2 mb-3' : 'rounded-[28px] px-6 pt-5 pb-3 mb-5'}`} data-mood={mood}>
        <Robot mood={mood} size={inline ? 56 : 84} />
      </div>
      <H className={`${inline ? 'text-[15px]' : 'text-[18px]'} font-semibold text-navy-950 tracking-[-0.01em] mb-1.5`}>{title}</H>
      {children && <div className="text-[14px] text-warm-600 max-w-[400px] leading-relaxed">{children}</div>}
      {action && <div className={inline ? 'mt-4' : 'mt-5'}><ActionEl a={action} primary /></div>}
      {secondary && <div className="mt-3"><ActionEl a={secondary} /></div>}
    </div>
  )
}

const PRIMARY = 'inline-flex items-center gap-1.5 bg-accent-500 hover:bg-accent-400 text-navy-950 px-5 py-2.5 rounded-full text-[14px] font-semibold transition-colors pressable'
const QUIET = 'text-[13px] font-medium text-accent-600 hover:underline'

function ActionEl({ a, primary = false }: { a: Action; primary?: boolean }) {
  const cls = primary ? PRIMARY : QUIET
  return 'href' in a
    ? <Link href={a.href} className={cls}>{a.label}</Link>
    : <button type="button" onClick={a.onClick} className={cls}>{a.label}</button>
}
