// CSV of the logic suggestions (client-safe: no server imports).

import type { LogicSuggestion } from './suggest'

export const SUGGESTION_KIND_LABEL: Record<LogicSuggestion['kind'], string> = {
  missing_predecessor: 'Missing predecessor', missing_successor: 'Missing successor', completion_only: 'Only tied to the finish',
  out_of_sequence: 'Against the usual order', redundant_link: 'Implied by other links',
}
const ACTION_LABEL: Record<LogicSuggestion['action'], string> = { add_link: 'Add link', review_link: 'Review link', remove_link: 'Optional: remove link' }

/** Quote a CSV cell; cells starting with = + - @ are prefixed with ' so spreadsheets do not run them as formulas. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function suggestionsCsv(rows: LogicSuggestion[]): string {
  const head = ['Priority', 'Issue', 'Action', 'Predecessor ID', 'Predecessor', 'Successor ID', 'Successor', 'Type', 'Lag (days)', 'Confidence %', 'Why', 'Problem', 'Predecessor read as', 'Successor read as']
  const lines = rows.map((r, i) => [
    i + 1, SUGGESTION_KIND_LABEL[r.kind], ACTION_LABEL[r.action], r.predecessor.code, r.predecessor.name, r.successor.code, r.successor.name, r.type, r.lag,
    Math.round(r.confidence * 100), r.reason, r.problem, r.basis.predecessor.join('; '), r.basis.successor.join('; '),
  ].map(csvCell).join(','))
  return [head.map(csvCell).join(','), ...lines].join('\r\n') + '\r\n'
}
