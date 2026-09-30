'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, ShieldCheck, AlertTriangle, Info, XCircle, CheckCircle2 } from 'lucide-react'
import { useApp } from '../layout'
import type { DataQuestion, DcmaReport, WorkCalendar } from '@/lib/planning/types'
import { fmtDates } from '@/lib/format'

interface QuestionRow extends DataQuestion { response: { response: string; note: string | null } | null }
interface Quality {
  schedule: { id: string; name: string; version: string; sourceType: string; calendars: WorkCalendar[]; warnings: string[] }
  dcma: DcmaReport
  dataQuestions: QuestionRow[]
  classification: { counts: Record<string, number>; classifiedPct: number }
}

const SEV_ICON = { error: XCircle, warning: AlertTriangle, info: Info }
const SEV_STYLE = { error: 'border-status-at-risk', warning: 'border-status-attention', info: 'border-status-info' }
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function QualityPage() {
  const { selectedSchedule } = useApp()
  const [data, setData] = useState<Quality | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [hideAnswered, setHideAnswered] = useState(true)

  const load = useCallback(async () => {
    if (!selectedSchedule) return
    setLoading(true); setError('')
    const res = await fetch(`/api/schedules/${selectedSchedule.id}/quality`)
    const d = await res.json()
    setLoading(false)
    if (!res.ok) { setError(d.error || 'Could not analyze schedule.'); return }
    setData(d)
  }, [selectedSchedule])
  useEffect(() => { load() }, [load])

  const respond = async (q: QuestionRow, response: string) => {
    const note = response === 'intentional' ? prompt('Optional note (e.g. "weekend pour approved by owner"):') ?? '' : ''
    const res = await fetch(`/api/schedules/${data!.schedule.id}/quality`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questionId: q.id, response, note }) })
    if (res.ok) setData(d => d && ({ ...d, dataQuestions: d.dataQuestions.map(x => x.id === q.id ? { ...x, response: { response, note } } : x) }))
  }

  if (!selectedSchedule) {
    return <div className="px-6 py-16 text-center text-[14px] text-warm-500"><ShieldCheck size={22} className="mx-auto mb-2 text-warm-400" />Upload or select a schedule to run quality checks.</div>
  }
  if (loading || !data) {
    return <div className="px-6 py-10 text-[14px] text-warm-400 flex items-center gap-2">{error || <><Loader2 size={14} className="animate-spin" /> Checking logic, calendars and dates…</>}</div>
  }

  const open = data.dataQuestions.filter(q => !q.response)
  const shown = hideAnswered ? open : data.dataQuestions
  const resultStyle = (r: string) => r === 'pass' ? 'text-status-on-track' : r === 'fail' ? 'text-status-at-risk' : r === 'warn' ? 'text-status-attention' : 'text-warm-400'

  return (
    <div className="px-4 md:px-6 py-6 md:py-8 space-y-5">
      <div>
        <h1 className="font-display text-[26px] md:text-[30px] text-navy-950 leading-tight">Schedule quality</h1>
        <p className="text-[13.5px] text-warm-500 mt-1">{data.schedule.name} · {data.schedule.version}. Planora checks the logic (DCMA 14-point) and questions its own inputs before trusting them.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="DCMA score" value={`${data.dcma.score}`} sub={`${data.dcma.passed}/${data.dcma.applicable} checks pass`} />
        <Card label="Questions about the data" value={String(open.length)} sub={`${data.dataQuestions.length - open.length} answered`} />
        <Card label="Calendars" value={String(data.schedule.calendars.length)} sub="imported and normalized" />
        <Card label="Activities understood" value={`${data.classification.classifiedPct}%`} sub="mapped to standard work categories" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400">Planora&apos;s questions about this file</div>
            <label className="text-[12px] text-warm-500 flex items-center gap-1.5"><input type="checkbox" checked={hideAnswered} onChange={e => setHideAnswered(e.target.checked)} /> Hide answered</label>
          </div>
          {shown.length === 0 && <div className="bg-warm-100 border border-warm-200 rounded-lg p-5 text-[13.5px] text-warm-600"><CheckCircle2 size={15} className="inline mr-1.5 text-status-on-track" />No open questions about the data.</div>}
          {shown.map(q => {
            const Icon = SEV_ICON[q.severity]
            return (
              <div key={q.id} className={`bg-warm-100 border border-warm-200 border-l-2 ${SEV_STYLE[q.severity]} rounded-lg p-4`}>
                <div className="flex gap-2">
                  <Icon size={15} className="flex-shrink-0 mt-0.5 text-warm-500" />
                  <div className="flex-1">
                    <div className="text-[13.5px] text-navy-950">{fmtDates(q.question)}</div>
                    <div className="text-[12px] text-warm-500 mt-1">{fmtDates(q.detail)}</div>
                    {q.response ? (
                      <div className="text-[12px] text-status-on-track mt-2 font-medium">Answered: {q.response.response.replace(/_/g, ' ')}{q.response.note ? ` — ${q.response.note}` : ''}</div>
                    ) : (
                      <div className="flex flex-wrap gap-2 mt-2.5">
                        <button onClick={() => respond(q, 'intentional')} className="px-2.5 py-1 rounded-md border border-warm-300 bg-warm-50 hover:border-navy-900 text-[12px] text-navy-950 transition-colors">Yes, intentional</button>
                        <button onClick={() => respond(q, 'will_fix')} className="px-2.5 py-1 rounded-md border border-warm-300 bg-warm-50 hover:border-navy-900 text-[12px] text-navy-950 transition-colors">No — will fix in source</button>
                        <button onClick={() => respond(q, 'not_an_issue')} className="px-2.5 py-1 rounded-md border border-warm-300 bg-warm-50 hover:border-navy-900 text-[12px] text-navy-950 transition-colors">Not an issue</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="lg:col-span-2 space-y-5">
          <div className="bg-warm-100 border border-warm-200 rounded-lg p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-2">DCMA 14-point</div>
            <table className="w-full text-[12.5px]">
              <tbody>
                {data.dcma.checks.map(c => (
                  <tr key={c.id} className="border-b border-warm-200 last:border-0" title={`${c.explanation}${c.offenders.length ? ' e.g. ' + c.offenders.slice(0, 6).join(', ') : ''}`}>
                    <td className="py-1.5 pr-2 text-warm-400 tabular-nums">{c.id}</td>
                    <td className="py-1.5 pr-2 text-navy-950">{c.name}</td>
                    <td className="py-1.5 pr-2 text-warm-600 tabular-nums">{c.metric}</td>
                    <td className={`py-1.5 font-semibold uppercase text-[11px] ${resultStyle(c.result)}`}>{c.result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-warm-100 border border-warm-200 rounded-lg p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-2">Calendars — as labeled vs. as understood</div>
            {data.schedule.calendars.length === 0 && <p className="text-[12.5px] text-warm-500">This file has no calendar data{data.schedule.sourceType === 'pdf' ? ' (PDF)' : ''}.</p>}
            <ul className="space-y-2">
              {data.schedule.calendars.map(c => (
                <li key={c.id} className="text-[12.5px]">
                  <div className="text-navy-950 font-medium">“{c.sourceName || c.name}”</div>
                  <div className="text-warm-500">{c.canonical || `${c.workDays.map(d => DAYS[d]).join(', ')} × ${c.hoursPerDay}h`} · {c.holidays.length} holidays</div>
                </li>
              ))}
            </ul>
            {data.schedule.warnings.length > 0 && (
              <div className="mt-3 pt-3 border-t border-warm-200 space-y-1">
                {data.schedule.warnings.slice(0, 8).map((w, i) => <p key={i} className="text-[12px] text-warm-500">· {w}</p>)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Card({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-warm-100 border border-warm-200 rounded-lg p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400">{label}</div>
      <div className="text-[20px] font-semibold text-navy-950 tabular-nums mt-1">{value}</div>
      <div className="text-[11px] text-warm-400 mt-0.5">{sub}</div>
    </div>
  )
}
