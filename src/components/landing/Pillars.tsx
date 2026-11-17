'use client'

// "Build. Check. Forecast.": three large tabs, each showing its explanation beside a screenshot of the page
// that does it, taken from the built-in sample projects (public/landing; retaken 11/17/2026 after the redesign).

import { useState } from 'react'
import { Shot } from './Sections'

const PILLARS = [
  { key: 'build', title: 'Build.', lead: 'A baseline from a conversation.', text: 'RunF9 interviews you like a senior scheduler (scope, permits, long-lead equipment, site and calendar) and builds a CPM schedule with a written basis for every duration and link.',
    points: ['Questions are ranked by how far each answer can move your finish date.', 'Or upload a P6, MS Project, Excel or PDF schedule you already have.'],
    shot: 'interview', label: 'RunF9 · Interview · sample medical office', alt: 'The interview in RunF9 for a sample project: the brief is ready to build, above the answered questions, such as the jurisdiction, the type of project, the state and how complete the drawings are.' },
  { key: 'check', title: 'Check.', lead: 'All 14 DCMA checks, every time.', text: 'Upload a P6 or MS Project file. Each failing check lists the activities involved and a suggested fix, with the published thresholds or your organization’s own.',
    points: ['Critical path and float from forward and backward CPM passes, with calendars, lags and constraints.', 'Checks that need data the file does not have are reported as not applicable, never as passed.'],
    shot: 'quality', height: 1124, label: 'RunF9 · Health', alt: 'The Health page in RunF9 for the sample data center: 10 of 14 DCMA checks pass, and the four that fail are listed first (negative float, missed tasks, CPLI and BEI), each with a link to the activities behind it.' },
  { key: 'forecast', title: 'Forecast.', lead: 'Know the finish before it moves.', text: 'Monte Carlo risk analysis over the full network gives P50 and P80 finish dates. When a date slips, recovery options are re-scheduled and priced from your labor cost.',
    points: ['Every open change and reported delay is run against the real network as a what-if.', 'What-ifs change nothing in the schedule until a person approves an edit.'],
    shot: 'risk', label: 'RunF9 · Schedule risk analysis', alt: 'Schedule risk analysis in RunF9 for the sample data center: Monte Carlo P50 and P80 finish dates against a deterministic forecast of 08/17/2027, the spread of the simulated finish dates, the chance of meeting each constrained milestone and the biggest drivers.' },
]

export default function Pillars() {
  // One pillar at a time: the three sit behind three large tabs, so the section is one screen and not three.
  const [at, setAt] = useState(0)
  return (
    <div>
      <div role="tablist" aria-label="What RunF9 does" className="grid grid-cols-3 gap-2 md:gap-4"
        onKeyDown={e => {
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
          const next = (at + (e.key === 'ArrowRight' ? 1 : PILLARS.length - 1)) % PILLARS.length
          setAt(next); document.getElementById(`pillar-tab-${PILLARS[next].key}`)?.focus()
        }}>
        {PILLARS.map((p, i) => (
          <button key={p.key} type="button" role="tab" id={`pillar-tab-${p.key}`} aria-selected={at === i} aria-controls={`pillar-panel-${p.key}`} tabIndex={at === i ? 0 : -1} onClick={() => setAt(i)}
            className={`pressable text-left rounded-2xl md:rounded-3xl px-4 py-3 md:px-6 md:py-4 transition-colors md:flex md:items-baseline md:gap-3 ${at === i ? 'bg-navy-950 text-white' : 'bg-white text-ink border border-warm-200 hover:border-navy-900'}`}>
            <span className="block text-h3 md:text-h2 font-bold tracking-[-0.02em] leading-none">{p.title}</span>
            <span className={`hidden lg:block text-small ${at === i ? 'text-navy-200' : 'text-warm-700'}`}>{p.lead}</span>
          </button>
        ))}
      </div>
      {PILLARS.map((p, i) => (
        <div key={p.key} role="tabpanel" id={`pillar-panel-${p.key}`} aria-labelledby={`pillar-tab-${p.key}`} hidden={at !== i}
          className={`${at === i ? 'grid' : 'hidden'} mt-10 md:mt-14 grid-cols-1 lg:grid-cols-[2fr_3fr] gap-10 lg:gap-16 items-start`}>
          <div>
            <h3 className="text-h3 md:text-h2 font-bold tracking-[-0.02em] text-ink leading-tight">{p.lead}</h3>
            <p className="text-copy text-warm-700 leading-relaxed mt-3">{p.text}</p>
            <ul className="mt-5 space-y-2.5">
              {p.points.map(x => (
                <li key={x} className="flex gap-2.5 text-copy text-warm-700 leading-snug">
                  <span aria-hidden className="mt-[9px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-600" />{x}
                </li>
              ))}
            </ul>
          </div>
          <Shot name={p.shot} height={'height' in p ? p.height : 1200} alt={p.alt} label={p.label} />
        </div>
      ))}
    </div>
  )
}
