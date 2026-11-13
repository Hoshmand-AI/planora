// "Build. Check. Forecast." — three rows, each beside a screenshot of the page that does it,
// taken from the sample data center project (public/landing).

import { Reveal } from './motion'
import { Shot } from './Sections'

const PILLARS = [
  { key: 'build', title: 'Build.', lead: 'A baseline from a conversation.', text: 'RunF9 interviews you like a senior scheduler (scope, permits, long-lead equipment, site and calendar) and builds a CPM schedule with a written basis for every duration and link.',
    points: ['Questions are ranked by how far each answer can move your finish date.', 'Or upload a P6, MS Project, Excel or PDF schedule you already have.'],
    shot: 'interview', label: 'RunF9 · New project', alt: 'The New project page in RunF9: build a schedule with a guided interview, or upload a P6, MS Project, Excel or PDF file.' },
  { key: 'check', title: 'Check.', lead: 'All 14 DCMA checks, every time.', text: 'Upload a P6 or MS Project file. Each failing check lists the activities involved and a suggested fix, with the published thresholds or your organization’s own.',
    points: ['Critical path and float from forward and backward CPM passes, with calendars, lags and constraints.', 'Checks that need data the file does not have are reported as not applicable, never as passed.'],
    shot: 'quality', label: 'RunF9 · Quality', alt: 'The Quality page in RunF9 for the sample data center: 10 of 14 DCMA checks pass, with negative float, missed tasks and CPLI listed to fix first.' },
  { key: 'forecast', title: 'Forecast.', lead: 'Know the finish before it moves.', text: 'Every open change and reported delay is run against the real network. When a date slips, recovery options are re-scheduled and priced from your labor cost.',
    points: ['Monte Carlo risk analysis over the full network gives P50 and P80 finish dates.', 'What-ifs change nothing in the schedule until a person approves an edit.'],
    shot: 'whatif', label: 'RunF9 · Today · What-if', alt: 'What-if results in RunF9: a change order adds 5 work days with no effect on the finish, a utility delay moves the finish, and a recovery option pulls it back.' },
]

export default function Pillars() {
  return (
    <div className="space-y-20 md:space-y-32">
      {PILLARS.map((p, i) => (
        <Reveal key={p.key} className={`grid ${i % 2 === 1 ? 'lg:grid-cols-[3fr_2fr]' : 'lg:grid-cols-[2fr_3fr]'} gap-10 lg:gap-16 items-center`}>
          <div className={i % 2 === 1 ? 'lg:order-2' : ''}>
            <h3 className="text-[44px] md:text-[56px] font-semibold tracking-[-0.035em] text-navy-950 leading-none">{p.title}</h3>
            <p className="text-[21px] md:text-[24px] font-semibold tracking-[-0.015em] text-navy-950 mt-4">{p.lead}</p>
            <p className="text-[16px] md:text-[17px] text-warm-700 leading-relaxed mt-3">{p.text}</p>
            <ul className="mt-5 space-y-2.5">
              {p.points.map(x => (
                <li key={x} className="flex gap-2.5 text-[16px] text-warm-700 leading-snug">
                  <span aria-hidden className="mt-[9px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-600" />{x}
                </li>
              ))}
            </ul>
          </div>
          <Shot name={p.shot} alt={p.alt} label={p.label} className={i % 2 === 1 ? 'lg:order-1' : ''} />
        </Reveal>
      ))}
    </div>
  )
}
