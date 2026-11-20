'use client'

// "Build. Check. Forecast.": three large tabs down the left with what the open one says under them, and the
// page that does it on the right: a screenshot taken from the built-in sample projects (public/landing; retaken
// 11/17/2026 after the redesign). On a phone the tabs sit in a row, then the text, then the picture.

import { useState } from 'react'
import { Shot } from './Sections'

const PILLARS = [
  { key: 'build', title: 'Build.', lead: 'A baseline from a conversation.', text: 'RunF9 interviews you like a senior scheduler (scope, permits, long-lead equipment, site and calendar) and builds a CPM schedule with a written basis for every duration and link.',
    points: ['Questions are ranked by how far each answer can move your finish date.', 'Or upload a P6, MS Project, Excel or PDF schedule you already have.'],
    shot: 'interview', label: 'RunF9 · Interview · sample medical office', alt: 'The interview in RunF9 for a sample project: the brief is ready to build, above the answered questions, such as the jurisdiction, the type of project, the state and how complete the drawings are.' },
  { key: 'check', title: 'Check.', lead: 'All 14 DCMA checks, every time. GAO checks too.', text: 'Upload a P6 or MS Project file. Each failing check lists the activities involved and a suggested fix, with the published thresholds or your organization’s own.',
    points: ['Critical path and float from forward and backward CPM passes, with calendars, lags and constraints.', 'Checks that need data the file does not have are reported as not applicable, never as passed.'],
    shot: 'quality', height: 1124, label: 'RunF9 · Health', alt: 'The Health page in RunF9 for the sample data center: 10 of 14 DCMA checks pass, and the four that fail are listed first (negative float, missed tasks, CPLI and BEI), each with a link to the activities behind it.' },
  { key: 'forecast', title: 'Forecast.', lead: 'Know the finish before it moves.', text: 'Monte Carlo risk analysis over the full network gives P50 and P80 finish dates. When a date slips, recovery options are re-scheduled and priced from your labor cost.',
    points: ['Every open change and reported delay is run against the real network as a what-if.', 'What-ifs change nothing in the schedule until a person approves an edit.'],
    shot: 'risk', label: 'RunF9 · Schedule risk analysis', alt: 'Schedule risk analysis in RunF9 for the sample data center: Monte Carlo P50 and P80 finish dates against a deterministic forecast of 08/17/2027, the spread of the simulated finish dates, the chance of meeting each constrained milestone and the biggest drivers.' },
]

export default function Pillars() {
  // One pillar at a time: the three sit behind three large tabs, so the section is one screen and not three.
  const [at, setAt] = useState(0)
  const p = PILLARS[at]
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-x-16 gap-y-10 items-start">
      <div>
        <div role="tablist" aria-label="What RunF9 does" className="grid grid-cols-3 lg:grid-cols-1 lg:border-t lg:border-warm-200"
          onKeyDown={e => {
            const fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown'
            if (!fwd && e.key !== 'ArrowLeft' && e.key !== 'ArrowUp') return
            e.preventDefault()
            const next = (at + (fwd ? 1 : PILLARS.length - 1)) % PILLARS.length
            setAt(next); document.getElementById(`pillar-tab-${PILLARS[next].key}`)?.focus()
          }}>
          {PILLARS.map((x, i) => (
            <button key={x.key} type="button" role="tab" id={`pillar-tab-${x.key}`} aria-selected={at === i} aria-controls="pillar-panel" tabIndex={at === i ? 0 : -1} onClick={() => setAt(i)}
              className={`group relative text-left py-4 lg:py-6 lg:pl-7 border-b-2 lg:border-b lg:border-warm-200 transition-colors ${at === i ? 'border-accent-600' : 'border-warm-200'}`}>
              {/* The marker of the open tab: a bar down its left edge on a desktop (the line under it on a phone) */}
              <span aria-hidden className={`hidden lg:block absolute left-0 top-0 bottom-0 w-[3px] rounded-full bg-accent-600 origin-top transition-transform duration-300 ${at === i ? 'scale-y-100' : 'scale-y-0'}`} />
              <span className={`block text-h3 md:text-h2 font-bold tracking-[-0.01em] md:tracking-[-0.02em] leading-none transition-colors ${at === i ? 'text-ink' : 'text-warm-600 group-hover:text-ink'}`}>{x.title}</span>
              <span className={`hidden lg:block text-copy mt-2 leading-snug ${at === i ? 'text-warm-700' : 'text-warm-600'}`}>{x.lead}</span>
            </button>
          ))}
        </div>
        {/* What the open tab says; its picture is beside it (under it on a phone) */}
        <div role="tabpanel" id="pillar-panel" aria-labelledby={`pillar-tab-${p.key}`} className="mt-8 lg:mt-10 lg:pl-7">
          <div key={p.key} className="rise-in">
            <h3 className="lg:hidden text-h3 font-semibold tracking-[-0.01em] text-ink leading-tight mb-2.5">{p.lead}</h3>
            <p className="text-copy text-warm-700 leading-relaxed">{p.text}</p>
            <ul className="mt-6 border-t border-warm-200">
              {p.points.map(x => <li key={x} className="border-b border-warm-200 py-3.5 text-small text-warm-700 leading-relaxed">{x}</li>)}
            </ul>
          </div>
        </div>
      </div>
      <div key={p.key} className="rise-in">
        <Shot name={p.shot} height={'height' in p ? p.height : 1200} alt={p.alt} label={p.label} />
      </div>
    </div>
  )
}
