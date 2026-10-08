'use client'

// "Import exceptions": what the uploaded file carried that Planora did not map, and what it converted
// or defaulted on the way (src/lib/parsers/exceptions.ts). Counts by entity and by disposition, then
// every record with its message and example ids behind an expandable row.

import { Disclosure } from './Disclosure'
import { fmtDates } from '@/lib/format'
import {
  DISPOSITION_LABEL, EXCEPTION_DISPOSITIONS, EXCEPTION_ENTITIES, summarizeExceptions,
  type ExceptionReport, type ExceptionSeverity,
} from '@/lib/parsers/exceptions'

const ENTITY_LABEL: Record<string, string> = {
  activity: 'Activities', relationship: 'Relationships', calendar: 'Calendars', constraint: 'Constraints', resource: 'Resources',
  assignment: 'Assignments', code: 'Codes', udf: 'UDFs', baseline: 'Baselines', project: 'Project', other: 'Other',
}
const SEVERITY_CLASS: Record<ExceptionSeverity, string> = {
  loss: 'text-status-at-risk', warning: 'text-status-attention', info: 'text-warm-500',
}
const SEVERITY_LABEL: Record<ExceptionSeverity, string> = { loss: 'Data loss', warning: 'Check', info: 'Info' }

export function ImportExceptions({ report, title = 'Import exceptions', defaultOpen = false }: { report: ExceptionReport | null | undefined; title?: string; defaultOpen?: boolean }) {
  if (!report) return null
  const sum = summarizeExceptions(report)
  const records = report.records
  return (
    <section aria-label={title} className="space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400">{title}</div>
      {records.length === 0 ? (
        <p className="text-[12px] text-warm-500">Everything in the file was mapped; nothing was dropped, converted or defaulted.</p>
      ) : (
        <>
          <p className="text-[12px] text-warm-600">
            {records.length} item{records.length === 1 ? '' : 's'} ({sum.total.toLocaleString()} occurrence{sum.total === 1 ? '' : 's'})
            {sum.losses > 0 && <> · <span className="text-status-at-risk font-medium">{sum.losses.toLocaleString()} lost</span></>}
          </p>
          <dl className="flex flex-wrap gap-1.5 text-[11.5px]" aria-label="Counts by entity">
            {EXCEPTION_ENTITIES.filter(e => sum.byEntity[e]).map(e => (
              <div key={e} className="flex gap-1 bg-warm-200 rounded px-1.5 py-0.5">
                <dt className="text-warm-600">{ENTITY_LABEL[e]}</dt><dd className="text-navy-950 font-medium tabular-nums">{sum.byEntity[e]!.toLocaleString()}</dd>
              </div>
            ))}
          </dl>
          <dl className="flex flex-wrap gap-1.5 text-[11.5px]" aria-label="Counts by disposition">
            {EXCEPTION_DISPOSITIONS.filter(d => sum.byDisposition[d]).map(d => (
              <div key={d} className="flex gap-1 border border-warm-300 rounded px-1.5 py-0.5">
                <dt className="text-warm-600">{DISPOSITION_LABEL[d]}</dt><dd className="text-navy-950 font-medium tabular-nums">{sum.byDisposition[d]!.toLocaleString()}</dd>
              </div>
            ))}
          </dl>
          <Disclosure title={`Details (${records.length})`} defaultOpen={defaultOpen}>
            <ul className="space-y-1">
              {records.map((r, i) => (
                <li key={`${r.entity}|${r.field}|${r.disposition}|${i}`} className="text-[12px]">
                  <details>
                    <summary className="cursor-pointer text-warm-700">
                      <span className={`${SEVERITY_CLASS[r.severity]} font-medium`}>{SEVERITY_LABEL[r.severity]}</span>
                      {' · '}{DISPOSITION_LABEL[r.disposition]} · {ENTITY_LABEL[r.entity] ?? r.entity} · <span className="font-mono text-[11px]">{r.field}</span> · <span className="tabular-nums">{r.count.toLocaleString()}</span>
                    </summary>
                    <div className="pl-4 pt-1 space-y-0.5">
                      <p className="text-warm-600">{fmtDates(r.message)}</p>
                      {r.examples.length > 0 && <p className="text-warm-500">Examples: {fmtDates(r.examples.join(', '))}{r.count > r.examples.length ? ', …' : ''}</p>}
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </Disclosure>
        </>
      )}
    </section>
  )
}
