/**
 * RunF9 wordmark — text-only, no icon mark.
 * "Run" in DM Sans weight 700 + "F9" set like a keyboard key (F9 runs the CPM calculation in P6)
 * Creates a refined typographic identity without any icon dependency.
 */

interface LogoProps {
  /** 'light' = white text (dark backgrounds), 'dark' = navy text (light backgrounds) */
  variant?: 'light' | 'dark'
  /** Tailwind text size class, e.g. 'text-xl' */
  size?: string
}

export function Logo({ variant = 'light', size = 'text-[18px]' }: LogoProps) {
  const sansColor   = variant === 'light' ? 'text-white'        : 'text-navy-950'
  const keyColor    = variant === 'light' ? 'text-accent-400 border-accent-400/70' : 'text-accent-600 border-accent-600/70'

  return (
    <span className={`inline-flex items-center gap-[0.22em] whitespace-nowrap tracking-[-0.02em] leading-none select-none ${size}`}>
      <span className={`font-sans font-bold ${sansColor}`}>Run</span>
      <span className={`font-sans font-bold ${keyColor} border-[1.5px] rounded-[0.22em] px-[0.22em] py-[0.08em] text-[0.82em]`}>F9</span>
    </span>
  )
}
