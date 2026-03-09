/**
 * Planora wordmark — text-only, no icon mark.
 * "Plan" in DM Sans weight 700 + "ora" in DM Serif Display weight 400
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
  const serifColor  = variant === 'light' ? 'text-gold-400'     : 'text-gold-500'

  return (
    <span className={`inline-flex items-baseline gap-0 tracking-[-0.02em] leading-none select-none ${size}`}>
      <span className={`font-sans font-bold ${sansColor}`}>Plan</span>
      <span className={`font-display font-normal ${serifColor}`}>ora</span>
    </span>
  )
}
