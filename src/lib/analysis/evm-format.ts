// Display helpers for earned value (src/lib/analysis/evm.ts), safe to import in client components.

export const EVM_PRINCIPLE_NOTE = 'Integrity checks oriented to ANSI/EIA-748 earned value management principles. They test the schedule data; they are not a determination of EVMS compliance.'

const PCT_TYPE_LABEL: Record<string, string> = {
  physical: 'physical % complete', duration: 'duration % complete', units: 'units % complete',
  zero_hundred: '0/100', fifty_fifty: '50/50', file_percent: "file's % complete", loe: 'level of effort (earns PV)', complete: 'complete',
}
export const percentTypeLabel = (t: string | null | undefined) => (t ? PCT_TYPE_LABEL[t] ?? t : '—')

/** Money for text: "$1,234,567" (or with the file's currency code). */
export function fmtMoney(n: number | null | undefined, currency?: { code: string | null; symbol: string | null } | null): string {
  if (n == null || !isFinite(n)) return '—'
  const s = Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
  const sym = currency?.symbol || (currency?.code ? `${currency.code} ` : '$')
  return `${n < 0 ? '−' : ''}${sym}${s}`
}
