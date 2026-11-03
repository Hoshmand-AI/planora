// Display formatting. Data is stored and exchanged as ISO yyyy-mm-dd; people see MM/DD/YYYY by
// default, or DD/MM/YYYY where a caller passes that preference (e.g. a project outside the US).

const ISO = /\b(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+Z?)?\b/g

/** Display order for dates: MM/DD/YYYY (default) or DD/MM/YYYY. */
export type DateOrder = 'MDY' | 'DMY'
export const DEFAULT_DATE_ORDER: DateOrder = 'MDY'
/** Any stored preference → a valid order (anything but "DMY" is the default MM/DD/YYYY). */
export const dateOrderOf = (v: unknown): DateOrder => (v === 'DMY' ? 'DMY' : DEFAULT_DATE_ORDER)
const dmy = (y: string, m: string, d: string, order: DateOrder) => (order === 'DMY' ? `${d}/${m}/${y}` : `${m}/${d}/${y}`)
const locale = (order: DateOrder) => (order === 'DMY' ? 'en-GB' : 'en-US')

/** "2026-10-31" → "10/31/2026" (or "31/10/2026" for DMY). Non-dates pass through unchanged; null/empty → "—". */
export function fmtDate(v: string | null | undefined, order: DateOrder = DEFAULT_DATE_ORDER): string {
  if (!v) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  return m ? dmy(m[1], m[2], m[3], order) : v
}

/** Rewrites every ISO date inside free text (rationales, findings, questions) to MM/DD/YYYY (or DD/MM/YYYY). */
export function fmtDates(text: string | null | undefined, order: DateOrder = DEFAULT_DATE_ORDER): string {
  return text ? text.replace(ISO, (_, y, m, d) => dmy(y, m, d, order)) : ''
}

/** Timestamp → "10/31/2026 2:05 PM" (or "31/10/2026 14:05") in the viewer's time zone. */
export function fmtDateTime(iso: string, order: DateOrder = DEFAULT_DATE_ORDER): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString(locale(order), { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** Timestamp → "10/31/2026" (or "31/10/2026") in the viewer's time zone. */
export function fmtDay(iso: string | null | undefined, order: DateOrder = DEFAULT_DATE_ORDER): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString(locale(order), { month: '2-digit', day: '2-digit', year: 'numeric' })
}

/** Lower-case words for use mid-sentence while keeping acronyms and units intact ("UPS systems", "MEP", "kV"). */
export function midSentence(text: string): string {
  return text.split(/(\s+|\/|\(|\))/).map(w => (/^[A-Z][a-z]+(-[a-z]+)*$/.test(w) ? w.toLowerCase() : w)).join('')
}
