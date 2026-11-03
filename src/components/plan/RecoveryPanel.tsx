'use client'

// "The plan finishes after the required date — what now?" Leads with a worried status mark and one
// sentence, highlights the option that does the most, and keeps every number one click away:
// the full explanation sits under "Why is it late?", and each option's trade-off, resources and
// costs sit under its own "Details" toggle.

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { RecoveryOption, RecoveryPlan } from '@/lib/planning/recovery'
import { fmtDate, fmtDates } from '@/lib/format'
import { Disclosure } from '@/components/Disclosure'
import { Robot } from '@/components/Robot'

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

/** The option to suggest first: meets the date if any does, then saves the most days, then costs the least. */
export function bestOption(options: RecoveryOption[]): RecoveryOption | null {
  const useful = options.filter(o => o.id !== 'move_date' && o.daysSaved > 0)
  if (!useful.length) return null
  const cost = (o: RecoveryOption) => o.impact?.cost?.high ?? Number.POSITIVE_INFINITY
  return [...useful].sort((a, b) => Number(b.meetsDate) - Number(a.meetsDate) || b.daysSaved - a.daysSaved || cost(a) - cost(b))[0]
}

function Chip({ o }: { o: RecoveryOption }) {
  if (o.id === 'move_date') return null
  const [text, style] = o.meetsDate ? ['Meets date', 'bg-status-on-track-bg text-status-on-track'] : o.daysSaved > 0 ? [`Saves ${o.daysSaved}d`, 'bg-status-attention-bg text-status-attention'] : ['No gain', 'bg-warm-100 text-warm-500']
  return <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap ${style}`}>{text}</span>
}

function OptionCard({ o, best, busy, onRecover, onInterview }: { o: RecoveryOption; best: boolean; busy: string | null; onRecover: (id: string) => void; onInterview: () => void }) {
  return (
    <li className={`rounded-2xl bg-white px-4 pt-4 flex flex-col ${best ? 'border-2 border-navy-900/70 shadow-[0_8px_24px_-14px_rgba(10,22,40,0.35)]' : 'border border-warm-200'}`}>
      {best && <div className="text-[11.5px] font-semibold text-accent-600 mb-1">Suggested first step</div>}
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-[14px] font-semibold text-navy-950 leading-snug">{o.title}</h4>
        <Chip o={o} />
      </div>
      {best && <p className="text-[13px] text-warm-600 mt-1">{o.description}</p>}
      <div className="flex items-center justify-between gap-3 mt-3">
        <span className="text-[12.5px] text-warm-500">New finish <span className="font-semibold text-navy-950 tabular-nums">{fmtDate(o.newFinish)}</span></span>
        {o.apply.type === 'navigate'
          ? <button onClick={onInterview} className="pressable bg-navy-900 hover:bg-navy-950 text-white px-3.5 py-1.5 rounded-full text-[12.5px] font-medium">Answer questions</button>
          : <button disabled={!!busy} onClick={() => { if (confirm(`Apply “${o.title}”? You can override or undo any change afterwards.`)) onRecover(o.id) }} className="pressable bg-navy-900 hover:bg-navy-950 text-white px-4 py-1.5 rounded-full text-[12.5px] font-medium disabled:opacity-40">{busy === 'recover' ? <Loader2 size={12} className="animate-spin" aria-label="Applying" /> : 'Apply'}</button>}
      </div>
      <div className="mt-3">
        <Disclosure title="Details" meta={o.impact?.cost ? (o.impact.cost.high === 0 ? '$0 added' : `${usd(o.impact.cost.low)}–${usd(o.impact.cost.high)}`) : undefined}>
          {!best && <p className="text-[12.5px] text-warm-600">{o.description}</p>}
          <p className="text-[12.5px] text-warm-600 mt-1.5"><span className="font-medium text-warm-700">Trade-off:</span> {o.tradeoff}</p>
          {o.impact && (
            <ul className="text-[12.5px] text-warm-600 mt-2 space-y-1">
              <li><span className="font-medium text-warm-700">Resources: </span>{o.impact.resources}</li>
              <li>
                <span className="font-medium text-warm-700">Added cost: </span>
                {o.impact.cost ? <span className="font-semibold text-navy-950 tabular-nums">{o.impact.cost.high === 0 ? '$0' : `${usd(o.impact.cost.low)}–${usd(o.impact.cost.high)}`}</span> : 'not priced'}
                <span className="text-warm-500"> · {o.impact.costBasis}</span>
              </li>
              {o.impact.delaySavings != null && <li><span className="font-medium text-warm-700">Delay cost avoided: </span><span className="font-semibold text-status-on-track tabular-nums">{usd(o.impact.delaySavings)}</span></li>}
            </ul>
          )}
        </Disclosure>
      </div>
    </li>
  )
}

export function RecoveryPanel({ r, busy, onRecover, onInterview }: { r: RecoveryPlan; busy: string | null; onRecover: (id: string) => void; onInterview: () => void }) {
  const [open, setOpen] = useState(true)
  const best = bestOption(r.options)
  const rest = r.options.filter(o => o !== best)
  const meeting = r.options.filter(o => o.id !== 'move_date' && o.meetsDate).length
  return (
    <section id="recovery" aria-labelledby="recovery-title" data-mood="worried" className="mood-tile rounded-2xl border p-4 md:p-6 mb-5">
      <div className="flex items-start gap-4">
        <Robot mood="worried" size={52} className="flex-shrink-0 -ml-1" />
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-semibold text-status-at-risk">Finish is {r.gapDays} days after the required date</div>
          <h3 id="recovery-title" className="text-[17px] md:text-[18px] font-semibold text-navy-950 tracking-[-0.01em] mt-0.5">Forecast {fmtDate(r.finish)} vs required {fmtDate(r.required)}</h3>
          <p className="text-[13.5px] text-warm-700 mt-1">
            {best
              ? <>{best.meetsDate ? 'Good news: ' : ''}<span className="font-medium text-navy-950">{best.title}</span> would finish {fmtDate(best.newFinish)}{best.meetsDate ? ', in time for the required date.' : `, ${best.daysSaved} days sooner.`}{meeting > 1 ? ` ${meeting} options meet the date on their own.` : ''}</>
              : 'None of the modeled levers saves time on its own. See why below, and what you can change.'}
          </p>
        </div>
        <button onClick={() => setOpen(o => !o)} aria-expanded={open} className="text-[12.5px] text-warm-600 hover:text-navy-950 underline-offset-2 hover:underline flex-shrink-0">{open ? 'Hide options' : 'Show options'}</button>
      </div>
      {open && (
        <div className="mt-4">
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start" aria-label="Your options, each re-scheduled on the real network">
            {best && <OptionCard o={best} best busy={busy} onRecover={onRecover} onInterview={onInterview} />}
            {rest.map(o => <OptionCard key={o.id} o={o} best={false} busy={busy} onRecover={onRecover} onInterview={onInterview} />)}
          </ul>
          <p className="text-[12px] text-warm-500 mt-2">Each option is re-scheduled on the real network before you see it.</p>
          {r.combined && <p className="text-[12.5px] text-warm-600 mt-2">Combining the modeled levers would finish <span className="font-semibold text-navy-950">{fmtDate(r.combined.newFinish)}</span> — {r.combined.meetsDate ? 'enough to meet the date.' : 'still after the required date.'} Apply them one at a time to see each effect.</p>}
          <div className="mt-3">
            <Disclosure title="Why is it late?">
              <div className="space-y-1.5">{r.explanation.map((e, i) => <p key={i} className="text-[13px] text-warm-700">{fmtDates(e)}</p>)}</div>
            </Disclosure>
          </div>
        </div>
      )}
    </section>
  )
}
