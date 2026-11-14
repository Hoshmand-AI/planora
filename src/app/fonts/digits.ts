// Digits for the signed-in app. DM Sans draws 0 as a circle, which reads as a capital O in activity IDs and dates
// ("P1O3O", "O8/17/2O27"). This font face covers the ten digits only (unicode-range), so letters stay DM Sans and
// numbers come from Inter, whose zero is a narrow oval. The class sets --font-digits; the font-family lists in
// tailwind.config.js and globals.css put it first and fall back to DM Sans where the class is absent (the public site).
import localFont from 'next/font/local'

export const digitsFont = localFont({
  src: './inter-latin-wght-normal.woff2',
  variable: '--font-digits',
  weight: '100 900',
  display: 'swap',
  adjustFontFallback: false,
  declarations: [{ prop: 'unicode-range', value: 'U+0030-0039' }],
})
