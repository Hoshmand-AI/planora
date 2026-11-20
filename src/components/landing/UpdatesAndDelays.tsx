// "Every update. Every delay.": the monthly-update comparison and the Time Impact Analysis, which a
// scheduler uses every month after the baseline. Every line here is backed by a test listed in
// docs/marketing/CLAIMS-REGISTER.md (compare.test.ts, windows.test.ts, tia.test.ts).
// Two columns divided by a hairline, not two boxed cards.

import { GitCompareArrows, Timer } from 'lucide-react'
import { Reveal } from './motion'
import { ANCHOR, PAD, SectionHead, WRAP } from './Sections'

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
    <section id="updates" aria-labelledby="updates-h" className={`bg-white border-y border-warm-200 ${ANCHOR}`}>
      <div className={`${WRAP} ${PAD}`}>
        <SectionHead id="updates-h" eyebrow="Updates and delays" title="Every update. Every delay."
          lead="The baseline is the first week. RunF9 keeps working every month after it: what changed, why the finish moved, and what a delay does to the dates." />
        <div className="mt-14 md:mt-20 grid md:grid-cols-2 gap-y-14 md:divide-x md:divide-warm-200">
          {CARDS.map(({ id, icon: Icon, title, lead, points, foot }, i) => (
            <Reveal key={id} delay={i * 110} className={i === 0 ? 'md:pr-12 lg:pr-16' : 'md:pl-12 lg:pl-16'}>
              <span className="grid place-items-center w-11 h-11 rounded-xl bg-accent-100 text-accent-700"><Icon size={21} aria-hidden /></span>
              <h3 id={`updates-${id}`} className="text-h3 md:text-h2 font-semibold text-ink tracking-[-0.01em] md:tracking-[-0.02em] mt-6">{title}</h3>
              <p className="text-copy text-warm-700 leading-relaxed mt-3 max-w-[480px]">{lead}</p>
              <ul className="mt-7 border-t border-warm-200">
                {points.map(p => <li key={p} className="border-b border-warm-200 py-3.5 text-copy text-warm-700 leading-snug">{p}</li>)}
              </ul>
              <p className="text-small text-warm-600 mt-5 leading-relaxed">{foot}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
