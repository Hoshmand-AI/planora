'use client'

// The project overview's first answer: will we finish on time? The forecast finish, how it compares with the
// required date (or the baseline when there is none), and a ribbon from the start to the forecast.

import { fmtDate } from '@/lib/format'

type Status = 'on_track' | 'attention' | 'at_risk' | 'complete' | 'no_baseline'

// Light status tones that keep AA contrast on the navy panel.
const TONE: Record<Status, string> = { at_risk: '#F4A6A6', attention: '#F2C77B', on_track: '#8FD4B4', complete: '#8FD4B4', no_baseline: '#CCD0CF' }

const day = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000
const plural = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`

export function FinishHero({ status, forecastFinish, mustFinishBy, baselineFinish, projectStart, dataDate, reason, note }: {
  status: Status
  forecastFinish: string | null
  mustFinishBy: string | null
  baselineFinish: string | null
  projectStart: string | null
  dataDate: string | null
  reason?: string | null
  note?: string | null
}) {
  const target = mustFinishBy ? { label: 'Required', date: mustFinishBy.slice(0, 10) } : baselineFinish ? { label: 'Baseline', date: baselineFinish.slice(0, 10) } : null
  const forecast = forecastFinish?.slice(0, 10) ?? null
  const diff = target && forecast ? day(forecast) - day(target.date) : null
  const what = target?.label === 'Required' ? 'the required' : 'the baseline finish'
  const verdict = status === 'complete' ? 'The project is complete.'
    : diff == null ? (forecast ? 'No required date or baseline to compare with yet.' : 'No forecast finish yet.')
    : diff > 0 ? `${plural(diff)} after ${what} ${fmtDate(target!.date)}`
    : diff < 0 ? `${plural(-diff)} ahead of ${what} ${fmtDate(target!.date)}`
    : `On ${what} ${fmtDate(target!.date)}`
  const tone = diff == null && status !== 'complete' ? TONE.no_baseline : TONE[status]

  // Ribbon: start to the latest of forecast, target and data date.
  const start = projectStart?.slice(0, 10) ?? null
  const dd = dataDate?.slice(0, 10) ?? null
  const ends = [forecast, target?.date, dd].filter((d): d is string => !!d).map(day)
  const lo = start ? day(start) : null
  const hi = ends.length ? Math.max(...ends) : null
  const span = lo != null && hi != null && hi > lo ? hi - lo : null
  const at = (iso: string) => span ? Math.max(0, Math.min(100, ((day(iso) - lo!) / span) * 100)) : 0
  const late = target && forecast && diff != null && diff > 0

  return (
    <section aria-label="Finish forecast" className="rise-in rounded-3xl bg-navy-900 text-white p-6 md:p-8 shadow-[0_24px_48px_-28px_rgba(6,20,27,0.6)]">
      <p className="text-[14px] text-warm-200">Will we finish on time?</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-[40px] md:text-[48px] font-bold tracking-[-0.03em] tabular-nums leading-none">{forecast ? fmtDate(forecast) : '—'}</span>
        <span role="status" className="text-[16px] font-semibold" style={{ color: tone }}>{verdict}</span>
      </div>
      {reason && <p className="mt-3 text-[14px] text-warm-200 leading-relaxed max-w-3xl">{reason}</p>}
      {note && <p className="mt-2 text-[13px] text-warm-200 leading-relaxed max-w-3xl">{note}</p>}

      {span != null && (
        <div className="mt-6">
          <div className="relative h-2.5 rounded-full bg-navy-800" aria-hidden="true">
            {dd && <div className="grow-x absolute inset-y-0 left-0 rounded-full bg-accent-600" style={{ width: `${at(dd)}%` }} />}
            {late && <div className="absolute inset-y-0 rounded-r-full" style={{ left: `${at(target!.date)}%`, right: `${100 - at(forecast!)}%`, background: '#A64848' }} />}
            {dd && <Tick left={at(dd)} color="#FFFFFF" />}
            {target && <Tick left={at(target.date)} color="#FFFFFF" />}
            {forecast && <Tick left={at(forecast)} color={tone} />}
          </div>
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-[13px]">
            {start && <Item label="Start" date={start} />}
            {dd && <Item label="Data date" date={dd} dot="#2563EB" />}
            {target && <Item label={target.label} date={target.date} dot="#FFFFFF" />}
            {forecast && <Item label="Forecast" date={forecast} dot={tone} />}
          </dl>
        </div>
      )}
    </section>
  )
}

function Tick({ left, color }: { left: number; color: string }) {
  return <span className="absolute -top-1 h-[18px] w-[3px] -translate-x-1/2 rounded-full" style={{ left: `${left}%`, background: color }} />
}

function Item({ label, date, dot }: { label: string; date: string; dot?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {dot && <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: dot }} />}
      <dt className="text-warm-200">{label}</dt>
      <dd className="font-semibold tabular-nums">{fmtDate(date)}</dd>
    </div>
  )
}
