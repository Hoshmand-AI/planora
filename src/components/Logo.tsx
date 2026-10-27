/**
 * RunF9 logo: "Run" in custom monoline letterforms + the F9 key cap (F9 runs the CPM calculation
 * in P6, MS Project and Excel). The line under the key legend is a critical path whose last node
 * is the finish. Drawn as shapes, not text, so it looks the same everywhere; the files under
 * public/brand/ are the same artwork for social media and print.
 */

interface LogoProps {
  /** 'light' = white text (dark backgrounds), 'dark' = navy text (light backgrounds) */
  variant?: 'light' | 'dark'
  /** Tailwind text size class, e.g. 'text-xl'; the logo is 1.5em tall */
  size?: string
}

export function Logo({ variant = 'light', size = 'text-[18px]' }: LogoProps) {
  const word = variant === 'light' ? '#FFFFFF' : '#06141B'
  return (
    <span className={`inline-flex items-center leading-none select-none ${size}`}>
      <svg viewBox="10 34 1182 394" role="img" aria-label="RunF9" className="h-[1.5em] w-auto">
        <title>RunF9</title>
        <g transform="translate(20 52)" fill="none" stroke={word} strokeWidth="64" strokeLinecap="round" strokeLinejoin="round">
          <path d="M32 32 V332 M32 32 H128 A84 84 0 0 1 128 200 H32 M120 200 L210 332" />
          <path d="M290 132 V258 A74 74 0 0 0 438 258 V132 M438 258 V332" />
          <path d="M530 332 V206 A74 74 0 0 1 678 206 V332 M530 206 V132" />
        </g>
        <g transform="translate(760 -6) scale(0.9)">
          <rect x="48" y="56" width="416" height="416" rx="96" fill="#11212D" stroke="#60a5fa" strokeWidth="10" />
          <rect x="84" y="80" width="344" height="316" rx="64" fill="#24477F" />
          <g fill="none" stroke="#FFFFFF" strokeWidth="34" strokeLinecap="round" strokeLinejoin="round">
            <path d="M150 158 V310 M150 158 H226 M150 230 H210" />
            <circle cx="308" cy="203" r="45" />
            <path d="M353 203 V250 C353 292 330 310 290 310" />
          </g>
          <path d="M150 352 H358" stroke="#60a5fa" strokeWidth="10" strokeLinecap="round" />
          <circle cx="150" cy="352" r="12" fill="#60a5fa" />
          <circle cx="254" cy="352" r="12" fill="#60a5fa" />
          <circle cx="358" cy="352" r="17" fill="#FFFFFF" stroke="#60a5fa" strokeWidth="8" />
        </g>
      </svg>
    </span>
  )
}
