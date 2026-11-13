// "Every update. Every delay.": the monthly-update comparison and the Time Impact Analysis, which a
// scheduler uses every month after the baseline. Every line here is backed by a test listed in
// docs/marketing/CLAIMS-REGISTER.md (compare.test.ts, windows.test.ts, tia.test.ts).

import { GitCompareArrows, Timer } from 'lucide-react'
import { Reveal } from './motion'

const CARDS = [
  {
    id: 'compare',
    icon: GitCompareArrows,
    title: 'What changed this month',
    lead: 'Upload this month’s P6 or MS Project update. RunF9 pairs it with the last one, activity by activity.',
    points: [
      'How far the finish moved, and which driving-path activities moved it',
      'Critical path changes and float erosion',
      'Logic, duration, lag, constraint and calendar edits',
      'Actual dates that were rewritten since the last update',
    ],
    foot: 'Every difference is listed with its activity ID, and exports to Excel.',
  },
  {
    id: 'tia',
    icon: Timer,
    title: 'Time Impact Analysis',
    lead: 'Model a delay event as a fragnet, insert it into the status-date schedule and recalculate.',
    points: [
      'Finish and milestone dates before and after, and the days of impact',
      'The driving path before and after, and float absorbed off the critical path',
      'Potential concurrent delay flagged for the analyst',
      'Inputs and results hashed: the same inputs reproduce the same answer',
    ],
    foot: 'A schedule calculation, not an opinion on entitlement. The report (PDF, Excel) says so.',
  },
]

export function UpdatesAndDelays() {
  return (
    <section id="updates" className="bg-accent-100 border-y border-warm-200 scroll-mt-12">
      <div className="max-w-6xl mx-auto px-6 py-24 md:py-32">
      <Reveal className="max-w-[760px]">
        <h2 className="text-[32px] md:text-[48px] font-semibold tracking-[-0.04em] text-navy-950 leading-[1.05]">Every update. Every delay.</h2>
        <p className="text-[17px] md:text-[19px] text-warm-600 mt-4 leading-snug">The baseline is the first week. RunF9 keeps working every month after it: what changed, why the finish moved, and what a delay does to the dates.</p>
      </Reveal>
      <div className="grid md:grid-cols-2 gap-5 mt-12">
        {CARDS.map(({ id, icon: Icon, title, lead, points, foot }, i) => (
          <Reveal key={id} delay={i * 90} className="rounded-[22px] border border-warm-200 bg-white p-6 md:p-8 shadow-[0_1px_2px_rgb(6_20_27/0.06),0_14px_32px_-24px_rgb(6_20_27/0.16)]">
            <div id={`updates-${id}`} className="flex items-center gap-3">
              <span className="grid place-items-center w-10 h-10 rounded-xl bg-accent-100 text-accent-700"><Icon size={20} aria-hidden /></span>
              <h3 className="text-[20px] font-semibold text-navy-950 tracking-[-0.01em]">{title}</h3>
            </div>
            <p className="text-[16px] text-warm-700 leading-relaxed mt-4">{lead}</p>
            <ul className="mt-4 space-y-2.5">
              {points.map(p => (
                <li key={p} className="flex gap-2.5 text-[16px] text-warm-700 leading-snug">
                  <span aria-hidden className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-600" />{p}
                </li>
              ))}
            </ul>
            <p className="text-[14.5px] text-warm-700 mt-5 pt-4 border-t border-warm-200">{foot}</p>
          </Reveal>
        ))}
      </div>
      </div>
    </section>
  )
}
