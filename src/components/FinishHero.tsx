'use client'

// The project overview's first answer: will we finish on time? The forecast finish, how it compares with the
// required date (or the baseline when there is none), and a ribbon from the start to the forecast.

import { fmtDate } from '@/lib/format'

type Status = 'on_track' | 'attention' | 'at_risk' | 'complete' | 'no_baseline'

// The verdict is a pill in the palette's status colors (status text on its tint, AA contrast);
// with nothing to compare against it is plain light text on the navy panel.
const PILL: Record<Status, string> = {
  at_risk: 'bg-status-at-risk-bg text-status-at-risk', attention: 'bg-status-attention-bg text-status-attention',
  on_track: 'bg-status-on-track-bg text-status-on-track', complete: 'bg-status-complete-bg text-status-complete', no_baseline: 'text-navy-200',
}
// Ribbon marks (palette): progress to the data date in blue with a white tick, target light steel, forecast sky blue.
const FORECAST = '#60A5FA', TARGET = '#CCD0CF', DATA_DATE = '#2563EB'

const day = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000
const plural = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`

export function FinishHero({ status, forecastFinish, mustFinishBy, baselineFinish, projectStart, dataDate, reason, note, deadline, pending }: {
  status: Status
  forecastFinish: string | null
  mustFinishBy: string | null
  baselineFinish: string | null
  projectStart: string | null
  dataDate: string | null
  reason?: string | null
  note?: string | null
  /** The contract milestone's required date and how far behind it the project is (from the daily brief). When given, it is the target. */
  deadline?: { required: string; daysBehind: number | null; text: string } | null
  /** The deadline position is still loading: no verdict yet, so the page never shows one answer and then another */
  pending?: boolean
}) {
  const target = deadline ? { label: 'Required', date: deadline.required.slice(0, 10) } : mustFinishBy ? { label: 'Required', date: mustFinishBy.slice(0, 10) } : baselineFinish ? { label: 'Baseline', date: baselineFinish.slice(0, 10) } : null
  const forecast = forecastFinish?.slice(0, 10) ?? null
  const byDates = target && forecast ? day(forecast) - day(target.date) : null
  const diff = deadline?.daysBehind ?? byDates
  const what = target?.label === 'Required' ? 'the required' : 'the baseline finish'
  // A required date that has passed with the work unfinished: the file still shows the old date, so the days are counted to today.
  const overdue = !!deadline && diff != null && diff > 0 && byDates != null && byDates <= 0
  const verdict = status === 'complete' ? 'The project is complete.'
    : pending ? ''
    : diff == null ? (forecast ? 'No required date or baseline to compare with yet.' : 'No forecast finish yet.')
    : overdue ? `Required ${fmtDate(target!.date)}, not finished`
    : diff > 0 ? `${plural(diff)} after ${what} ${fmtDate(target!.date)}`
    : diff < 0 ? `${plural(-diff)} ahead of ${what} ${fmtDate(target!.date)}`
    : `On ${what} ${fmtDate(target!.date)}`
  const pill = diff == null && status !== 'complete' ? PILL.no_baseline : deadline && status !== 'complete' ? (diff! > 0 ? PILL.at_risk : PILL.on_track) : PILL[status]

  // A required date that has passed is measured to today, so today is on the ribbon too.
  const now = new Date()
  const today = overdue ? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` : null
  // Ribbon: start to the latest of forecast, target and data date (and today, when the required date has passed).
  const start = projectStart?.slice(0, 10) ?? null
  const dd = dataDate?.slice(0, 10) ?? null
  const ends = [forecast, target?.date, dd, today].filter((d): d is string => !!d).map(day)
  const lo = start ? day(start) : null
  const hi = ends.length ? Math.max(...ends) : null
  const span = lo != null && hi != null && hi > lo ? hi - lo : null
  const at = (iso: string) => span ? Math.max(0, Math.min(100, ((day(iso) - lo!) / span) * 100)) : 0
  const late = target && forecast && diff != null && diff > 0

  return (
    <section aria-label="Finish forecast" className="rise-in rounded-[14px] bg-navy-900 text-white p-6 md:p-8 shadow-[0_24px_48px_-28px_rgba(6,20,27,0.6)]">
      <p className="text-[14px] text-warm-200">Will we finish on time?</p>
      {/* The largest figure is the answer. A date that has already passed is not one, so then it is how late the work is. */}
      <p className="mt-1 text-[40px] md:text-[48px] font-bold tracking-[-0.03em] tabular-nums leading-none">{overdue ? `${plural(diff!)} overdue` : forecast ? fmtDate(forecast) : '—'}</p>
      {/* The verdict sits on its own line under the date: beside it, it competed with the date and wrapped into a block on a phone. */}
      {verdict && <p role="status" className={`mt-3 inline-block text-[14px] md:text-[15px] font-semibold leading-snug ${pill === PILL.no_baseline ? '' : 'rounded-lg px-2.5 py-1'} ${pill}`}>{verdict}</p>}
      {/* One line of explanation; the rest is under "Why this status". */}
      {overdue ? <p className="mt-3 text-[14px] text-warm-200 leading-relaxed max-w-3xl">The schedule still shows {fmtDate(forecast!)}, a date that has passed. Upload an update or record progress to get a real forecast.</p>
        : reason && <p className="mt-3 text-[14px] text-warm-200 leading-relaxed max-w-3xl">{reason}</p>}
      {note && <p className="mt-2 text-[13px] text-warm-200 leading-relaxed max-w-3xl">{note}</p>}

      {span != null && (
        <div className="mt-6">
          <div className="relative h-2.5 rounded-full bg-navy-800" aria-hidden="true">
            {dd && <div className="grow-x absolute inset-y-0 left-0 rounded-full bg-accent-600" style={{ width: `${at(dd)}%` }} />}
            {late && <div className="absolute inset-y-0 rounded-r-lg" style={{ left: `${at(target!.date)}%`, right: `${100 - at(today ?? forecast!)}%`, background: '#A64848' }} />}
            {dd && <Tick left={at(dd)} color="#FFFFFF" />}
            {target && <Tick left={at(target.date)} color={TARGET} />}
            {forecast && !today && <Tick left={at(forecast)} color={FORECAST} />}
            {today && <Tick left={at(today)} color="#FFFFFF" />}
          </div>
          <dl className="mt-3 grid grid-cols-2 sm:flex sm:flex-wrap gap-x-6 gap-y-2 text-[13px]">
            {start && <Item label="Start" date={start} dot="#9BA8AB" />}
            {dd && <Item label="Data date" date={dd} dot={DATA_DATE} />}
            {target && <Item label={target.label} date={target.date} dot={TARGET} />}
            {forecast && !today && <Item label="Forecast" date={forecast} dot={FORECAST} />}
            {today && <Item label="Today" date={today} dot="#A64848" />}
          </dl>
        </div>
      )}
    </section>
  )
}

function Tick({ left, color }: { left: number; color: string }) {
  return <span className="absolute -top-1 h-[18px] w-[3px] -translate-x-1/2 rounded-full" style={{ left: `${left}%`, background: color }} />
}

function Item({ label, date, dot }: { label: string; date: string; dot: string }) {
  // On a phone the label sits above its date, so four items make an even two-by-two grid; on a wide screen they run in a line.
  return (
    <div className="grid grid-cols-[8px_1fr] items-center gap-x-1.5 sm:flex">
      <span aria-hidden="true" className="h-2 w-2 rounded-full max-sm:row-span-2" style={{ background: dot }} />
      <dt className="text-warm-200 whitespace-nowrap">{label}</dt>
      <dd className="font-semibold tabular-nums whitespace-nowrap max-sm:col-start-2">{fmtDate(date)}</dd>
    </div>
  )
}
