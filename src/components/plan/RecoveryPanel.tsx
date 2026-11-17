'use client'

// "The plan finishes after the required date — what now?" The page header already says how late it is,
// so this panel does not repeat it: it names the one step to take first, with the only filled button,
// and lists the other options as single lines. Each option's trade-off, resources and cost open on
// request, and the full explanation sits under "Why is it late?".

import { useState } from 'react'
import { ChevronRight, Loader2 } from 'lucide-react'
import type { RecoveryOption, RecoveryPlan } from '@/lib/planning/recovery'
import { fmtDate, fmtDates } from '@/lib/format'
import { Disclosure } from '@/components/Disclosure'

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`

/** The option to suggest first: meets the date if any does, then saves the most days, then costs the least. */
export function bestOption(options: RecoveryOption[]): RecoveryOption | null {
  const useful = options.filter(o => o.id !== 'move_date' && o.daysSaved > 0)
  if (!useful.length) return null
  const cost = (o: RecoveryOption) => o.impact?.cost?.high ?? Number.POSITIVE_INFINITY
  return [...useful].sort((a, b) => Number(b.meetsDate) - Number(a.meetsDate) || b.daysSaved - a.daysSaved || cost(a) - cost(b))[0]
}

/** What the option buys, in words: the only colored one is the one that meets the date. */
function Gain({ o }: { o: RecoveryOption }) {
  if (o.id === 'move_date') return null
  return o.meetsDate
    ? <span className="rounded-full bg-status-on-track-bg px-2 py-0.5 text-[12px] font-semibold text-status-on-track whitespace-nowrap">Meets the date</span>
    : <span className="text-[13px] text-warm-700 whitespace-nowrap">Saves {days(o.daysSaved)}</span>
}

const costOf = (o: RecoveryOption) => o.impact?.cost ? (o.impact.cost.high === 0 ? '$0 added' : `${usd(o.impact.cost.low)}–${usd(o.impact.cost.high)}`) : undefined

function Details({ o, describe }: { o: RecoveryOption; describe: boolean }) {
  return (
    <div className="text-[13px] text-warm-700 space-y-1.5">
      {describe && <p>{o.description}</p>}
      <p><span className="font-medium text-ink">Trade-off: </span>{o.tradeoff}</p>
      {o.impact && (
        <>
          <p><span className="font-medium text-ink">Resources: </span>{o.impact.resources}</p>
          <p>
            <span className="font-medium text-ink">Added cost: </span>
            {o.impact.cost ? <span className="font-semibold text-ink tabular-nums">{o.impact.cost.high === 0 ? '$0' : `${usd(o.impact.cost.low)}–${usd(o.impact.cost.high)}`}</span> : 'not priced'}
            <span className="text-warm-600"> · {o.impact.costBasis}</span>
          </p>
          {o.impact.delaySavings != null && <p><span className="font-medium text-ink">Delay cost avoided: </span><span className="font-semibold text-ink tabular-nums">{usd(o.impact.delaySavings)}</span></p>}
        </>
      )}
    </div>
  )
}

function Act({ o, primary, busy, onRecover, onInterview }: { o: RecoveryOption; primary: boolean; busy: string | null; onRecover: (id: string) => void; onInterview: () => void }) {
  const look = primary
    ? 'pressable inline-flex items-center justify-center min-w-[88px] h-9 px-4 rounded-lg bg-accent-600 hover:bg-accent-700 text-white text-[13px] font-semibold disabled:opacity-50'
    : 'pressable inline-flex items-center justify-center min-w-[88px] h-9 px-3.5 rounded-lg border border-warm-300 bg-white hover:bg-warm-100 text-ink text-[13px] font-medium disabled:opacity-50'
  return o.apply.type === 'navigate'
    ? <button type="button" onClick={onInterview} className={look}>Answer questions</button>
    : <button type="button" disabled={!!busy} aria-label={`Apply: ${o.title}`} onClick={() => { if (confirm(`Apply “${o.title}”? You can override or undo any change afterwards.`)) onRecover(o.id) }} className={look}>{busy === 'recover' ? <Loader2 size={12} className="animate-spin" aria-label="Applying" /> : 'Apply'}</button>
}

/** Another option: one line, its detail on request. */
function OptionRow({ o, busy, onRecover, onInterview }: { o: RecoveryOption; busy: string | null; onRecover: (id: string) => void; onInterview: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="button" aria-expanded={open} onClick={() => setOpen(v => !v)} className="group flex-1 min-w-[240px] flex items-start gap-2 text-left">
          <ChevronRight size={15} aria-hidden="true" className={`mt-0.5 flex-shrink-0 text-warm-600 transition-transform ${open ? 'rotate-90' : ''}`} />
          <span className="text-[14px] font-medium text-ink group-hover:underline">{o.title}</span>
        </button>
        <Gain o={o} />
        <span className="text-[13px] text-warm-600 whitespace-nowrap">Finish <span className="font-semibold text-ink tabular-nums">{fmtDate(o.newFinish)}</span></span>
        <Act o={o} primary={false} busy={busy} onRecover={onRecover} onInterview={onInterview} />
      </div>
      {open && <div className="pl-[23px] pt-2 pb-1 max-w-3xl"><Details o={o} describe /></div>}
    </li>
  )
}

export function RecoveryPanel({ r, busy, onRecover, onInterview }: { r: RecoveryPlan; busy: string | null; onRecover: (id: string) => void; onInterview: () => void }) {
  const best = bestOption(r.options)
  // Options that gain nothing are named under "Why is it late?", not offered as a step.
  const rest = r.options.filter(o => o !== best && (o.id === 'move_date' || o.daysSaved > 0))
  const noGain = r.options.filter(o => o.id !== 'move_date' && o.daysSaved <= 0)
  return (
    <section id="recovery" aria-labelledby="recovery-title" className="rounded-[14px] border border-warm-200 bg-white p-5 md:p-6 mb-5 scroll-mt-48">
      <h3 id="recovery-title" className="text-[16px] font-semibold text-ink">Ways to recover the {days(r.gapDays)}</h3>

      {best ? (
        <div className="mt-3 rounded-xl bg-warm-100 px-4 py-4 md:px-5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex-1 min-w-[240px]">
              <p className="text-[12px] font-semibold text-warm-600">Suggested first step</p>
              <p className="mt-0.5 text-[16px] font-semibold text-ink leading-snug">{best.title}</p>
              <p className="mt-1 text-[13px] text-warm-700 max-w-2xl">{best.description}</p>
            </div>
            <div>
              <p className="text-[12px] text-warm-600">New finish</p>
              <p className="text-[18px] font-semibold text-ink tabular-nums leading-tight">{fmtDate(best.newFinish)}</p>
              <p className="mt-1"><Gain o={best} /></p>
            </div>
            <Act o={best} primary busy={busy} onRecover={onRecover} onInterview={onInterview} />
          </div>
          <div className="mt-3">
            <Disclosure title="Trade-off and cost" meta={costOf(best)}><Details o={best} describe={false} /></Disclosure>
          </div>
        </div>
      ) : <p className="mt-2 text-[13px] text-warm-700">None of the modeled levers saves time on its own. See why below, and what you can change.</p>}

      {rest.length > 0 && (
        <ul className="mt-3 divide-y divide-warm-200" aria-label={best ? 'Other options, each re-scheduled on the real network' : 'Your options, each re-scheduled on the real network'}>
          {rest.map(o => <OptionRow key={o.id} o={o} busy={busy} onRecover={onRecover} onInterview={onInterview} />)}
        </ul>
      )}

      <div className="mt-2">
        <Disclosure title="Why is it late?">
          <div className="space-y-1.5 text-[13px] text-warm-700 max-w-3xl">
            {r.explanation.map((e, i) => <p key={i}>{fmtDates(e)}</p>)}
            {r.combined && <p>Combining the modeled levers would finish <span className="font-semibold text-ink">{fmtDate(r.combined.newFinish)}</span>: {r.combined.meetsDate ? 'enough to meet the date.' : 'still after the required date.'} Apply them one at a time to see each effect.</p>}
            {noGain.length > 0 && <p>Also modeled, with no gain: {noGain.map(o => o.title).join('; ')}.</p>}
            <p className="text-warm-600">Each option is re-scheduled on the real network before you see it.</p>
          </div>
        </Disclosure>
      </div>
    </section>
  )
}
