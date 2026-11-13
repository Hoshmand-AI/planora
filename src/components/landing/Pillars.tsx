// "Build. Check. Forecast." — three rows, each beside a screenshot of the page that does it,
// taken from the sample data center project (public/landing).

import { Reveal } from './motion'
import { Shot } from './Sections'

const PILLARS = [
  { key: 'build', title: 'Build.', lead: 'A baseline from a conversation.', text: 'RunF9 interviews you like a senior scheduler (scope, permits, long-lead equipment, site and calendar) and builds a CPM schedule with a written basis for every duration and link.',
    points: ['Questions are ranked by how far each answer can move your finish date.', 'Or upload a P6, MS Project, Excel or PDF schedule you already have.'],
    shot: 'interview', label: 'RunF9 · Interview · sample medical office', alt: 'The interview in RunF9 for a sample project: answered questions such as the state, drawing completeness, delivery method, work week and the daily cost of late completion.' },
  { key: 'check', title: 'Check.', lead: 'All 14 DCMA checks, every time.', text: 'Upload a P6 or MS Project file. Each failing check lists the activities involved and a suggested fix, with the published thresholds or your organization’s own.',
    points: ['Critical path and float from forward and backward CPM passes, with calendars, lags and constraints.', 'Checks that need data the file does not have are reported as not applicable, never as passed.'],
    shot: 'quality', height: 701, label: 'RunF9 · Quality', alt: 'The Quality page in RunF9 for the sample data center: the failing DCMA checks listed first (negative float, missed tasks, CPLI), with the activities behind each one.' },
  { key: 'forecast', title: 'Forecast.', lead: 'Know the finish before it moves.', text: 'Monte Carlo risk analysis over the full network gives P50 and P80 finish dates. When a date slips, recovery options are re-scheduled and priced from your labor cost.',
    points: ['Every open change and reported delay is run against the real network as a what-if.', 'What-ifs change nothing in the schedule until a person approves an edit.'],
    shot: 'risk', label: 'RunF9 · Schedule risk analysis', alt: 'Schedule risk analysis in RunF9 for the sample data center: Monte Carlo P50 08/31/2027 and P80 09/10/2027 against a deterministic forecast of 08/17/2027, with the chance of meeting each constrained milestone and the biggest drivers.' },
]

export default function Pillars() {
  return (
    <div className="space-y-20 md:space-y-32">
      {PILLARS.map((p, i) => (
        <Reveal key={p.key} className={`grid grid-cols-1 ${i % 2 === 1 ? 'lg:grid-cols-[3fr_2fr]' : 'lg:grid-cols-[2fr_3fr]'} gap-10 lg:gap-16 items-center`}>
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
          <Shot name={p.shot} height={'height' in p ? p.height : 1200} alt={p.alt} label={p.label} className={i % 2 === 1 ? 'lg:order-1' : ''} />
        </Reveal>
      ))}
    </div>
  )
}
