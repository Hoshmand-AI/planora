'use client'

/**
 * RunF9 logo (2026 identity): one integrated "R" that holds two schedule activity bars and a
 * milestone diamond, followed by a lowered lowercase "un" set flush against it, then "F9" (F9 runs
 * the CPM calculation in P6, MS Project and Excel). One R only; no house or roof motif.
 *
 * The letters are DM Sans outlines (the site font), so the wordmark looks the same on every device.
 */

import { useId } from 'react'

interface LogoProps {
  /** 'light' = white letters (dark backgrounds), 'dark' = navy letters (light backgrounds) */
  variant?: 'light' | 'dark'
  /** Tailwind text size class, e.g. 'text-xl'; the logo is 1.5em tall */
  size?: string
  /** The R mark alone (collapsed sidebar, small spaces) */
  mark?: boolean
}

/**
 * "unF9" as outlines: DM Sans (the site font) at weight 800 ("un") and 850 ("F9"), 104 units, slanted,
 * "un" flush with the R and 8 units below "F9". Outlines, not text, so the letters look the same
 * everywhere and the logo's accessible name stays "RunF9".
 */
const WORD = 'M173.2 109.25Q166.77 109.25 162.91 106.59Q159.05 103.93 158.01 98.7Q156.98 93.48 158.85 85.99L166.45 55.58H180.94L173.71 84.52Q172.19 90.58 173.95 93.79Q175.71 97.01 181.08 97.01Q184.51 97.01 187.61 95.41Q190.71 93.81 192.97 90.88Q195.22 87.95 196.3 83.66L203.32 55.58H217.88L204.77 108H191.98L192.98 99.52Q189.55 103.94 184.47 106.59Q179.4 109.25 173.2 109.25Z M213.46 108 226.57 55.58H239.36L238.25 64.07Q241.79 59.65 246.85 56.99Q251.9 54.34 258.1 54.34Q264.64 54.34 268.42 57.08Q272.21 59.83 273.27 65.03Q274.33 70.24 272.43 77.83L264.89 108H250.4L257.6 79.17Q259.11 73.14 257.35 69.86Q255.59 66.58 250.12 66.58Q246.75 66.58 243.69 68.17Q240.63 69.77 238.36 72.74Q236.1 75.7 235.02 80.02L228.02 108Z M275.34 100 293.54 27.2H341.57L338.53 39.33H305.59L301.02 57.63H327.12L324.17 69.44H298.06L290.42 100Z M355.08 101.25Q347.34 101.25 342.72 98.27Q338.1 95.29 336.42 90.44Q334.74 85.58 335.57 80.03H349.59Q349.41 84.32 351.62 86.62Q353.84 88.92 358.34 88.92Q362.61 88.92 366.3 86.39Q369.99 83.86 373.03 78.84Q376.06 73.81 378.1 66.3Q378.18 65.99 378.25 65.71Q378.32 65.44 378.4 65.12Q376.23 67.84 372.94 69.95Q369.65 72.07 365.99 73.22Q362.32 74.38 358.68 74.38Q352.76 74.38 348.24 71.5Q343.72 68.62 341.85 63.3Q339.99 57.97 341.81 50.68Q343.51 43.89 348.18 38.28Q352.86 32.66 359.46 29.31Q366.06 25.95 373.46 25.95Q381.77 25.95 386.7 29.03Q391.64 32.1 393.8 37.15Q395.96 42.2 395.86 48.55Q395.77 54.9 394.15 61.34Q391.11 73.52 385.48 82.49Q379.85 91.46 372.08 96.36Q364.31 101.25 355.08 101.25ZM365.52 61.68Q368.92 61.68 372.03 60.26Q375.14 58.84 377.36 56.26Q379.58 53.69 380.41 50.38Q381.28 46.91 380.34 44.33Q379.41 41.75 376.98 40.29Q374.56 38.83 371.09 38.83Q367.69 38.83 364.62 40.3Q361.55 41.78 359.35 44.32Q357.15 46.87 356.31 50.19Q355.46 53.62 356.38 56.21Q357.29 58.79 359.67 60.23Q362.05 61.68 365.52 61.68Z'

/** The integrated R in its 142 × 116 master coordinates. */
function RMark({ id, onDark }: { id: string; onDark: boolean }) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}r`} x1="10" y1="85" x2="125" y2="12" gradientUnits="userSpaceOnUse">
          <stop stopColor={onDark ? '#3B6CF6' : '#1D4ED8'} />
          {/* On a navy background the near-black middle of the master gradient would vanish into it. */}
          <stop offset=".42" stopColor={onDark ? '#2337B8' : '#06141B'} />
          <stop offset=".78" stopColor="#344DFF" />
          <stop offset="1" stopColor="#8B5CF6" />
        </linearGradient>
        <linearGradient id={`${id}b1`} x1="40" y1="40" x2="96" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#79DAFF" />
          <stop offset="1" stopColor="#2563EB" />
        </linearGradient>
        <linearGradient id={`${id}b2`} x1="48" y1="56" x2="89" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#AFD6FF" />
          <stop offset="1" stopColor="#7D65F8" />
        </linearGradient>
      </defs>
      <path d="M18 88 L43 17 H91 C116 17 128 34 125 52 C123 68 111 77 91 77 H73 L103 104 H73 L52 80 L43 104 H16 L35 43" fill={`url(#${id}r)`} />
      <path d="M43 17 H91 C114 17 127 31 125 50" fill="none" stroke="#7D65F8" strokeWidth="3" opacity=".55" />
      <rect x="41" y="36" width="55" height="8" rx="4" fill={`url(#${id}b1)`} />
      <rect x="48" y="52" width="41" height="8" rx="4" fill={`url(#${id}b2)`} />
      <path d="M102 40 L110 48 L102 56 L94 48 Z" fill="#C1B4FF" />
    </>
  )
}

export function Logo({ variant = 'light', size = 'text-[18px]', mark = false }: LogoProps) {
  const id = `rf9${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const onDark = variant === 'light'
  const word = onDark ? '#FFFFFF' : '#07172D'
  return (
    <span className={`inline-flex items-center leading-none select-none ${size}`}>
      {mark ? (
        <svg viewBox="14 14 114 92" role="img" aria-label="RunF9" className="h-[1.5em] w-auto">
          <title>RunF9</title>
          <RMark id={id} onDark={onDark} />
        </svg>
      ) : (
        // Master lockup: R at translate(10 18) scale(1.12), then the "unF9" outlines.
        <svg viewBox="22 24 372 110" role="img" aria-label="RunF9" className="h-[1.5em] w-auto overflow-visible">
          <title>RunF9</title>
          <g transform="translate(10 18) scale(1.12)"><RMark id={id} onDark={onDark} /></g>
          <path d={WORD} fill={word} />
        </svg>
      )}
    </span>
  )
}
