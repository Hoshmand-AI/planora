// Display formatting. Data is stored and exchanged as ISO yyyy-mm-dd; people see MM/DD/YYYY.

const ISO = /\b(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+Z?)?\b/g

/** "2026-10-31" → "10/31/2026". Non-dates pass through unchanged; null/empty → "—". */
export function fmtDate(v: string | null | undefined): string {
  if (!v) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  return m ? `${m[2]}/${m[3]}/${m[1]}` : v
}

/** Rewrites every ISO date inside free text (rationales, findings, questions) to MM/DD/YYYY. */
export function fmtDates(text: string | null | undefined): string {
  return text ? text.replace(ISO, (_, y, m, d) => `${m}/${d}/${y}`) : ''
}

/** Timestamp → "10/31/2026 2:05 PM" in the viewer's time zone. */
export function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** Timestamp → "10/31/2026" in the viewer's time zone. */
export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
}

/** Lower-case words for use mid-sentence while keeping acronyms and units intact ("UPS systems", "MEP", "kV"). */
export function midSentence(text: string): string {
  return text.split(/(\s+|\/|\(|\))/).map(w => (/^[A-Z][a-z]+(-[a-z]+)*$/.test(w) ? w.toLowerCase() : w)).join('')
}
