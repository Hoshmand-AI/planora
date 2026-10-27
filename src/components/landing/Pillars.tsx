'use client'

// "Build. Check. Forecast." — three panels, each with a small drawing that animates once when it
// scrolls into view. Decorative only: the text beside each one says everything it shows.

import { useInView } from './motion'

const ease = 'cubic-bezier(0.22,1,0.36,1)'

function BuildArt({ on }: { on: boolean }) {
  const qs = ['Building type and size?', 'Long-lead equipment?', 'Permits and inspections?']
  const bars = [[0, 30], [18, 34], [40, 38], [62, 30]]
  return (
    <div className="h-[200px] flex flex-col justify-between" aria-hidden="true">
      <div className="space-y-2">
        {qs.map((q, i) => (
          <div key={q} className="w-fit rounded-2xl rounded-bl-md bg-warm-100 px-3 py-1.5 text-[12.5px] text-warm-700"
            style={{ opacity: on ? 1 : 0, transform: on ? 'none' : 'translateY(8px)', transition: `opacity 600ms ${ease} ${i * 220}ms, transform 600ms ${ease} ${i * 220}ms` }}>{q}</div>
        ))}
      </div>
      <div className="space-y-1.5">
        {bars.map(([l, w], i) => (
          <div key={i} className="h-2.5 rounded-full bg-accent-600"
            style={{ marginLeft: `${l}%`, width: on ? `${w}%` : '0%', transition: `width 700ms ${ease} ${900 + i * 160}ms` }} />
        ))}
      </div>
    </div>
  )
}

function CheckArt({ on }: { on: boolean }) {
  return (
    <div className="h-[200px] flex items-center" aria-hidden="true">
      <div className="grid grid-cols-7 gap-2.5 w-full">
        {Array.from({ length: 14 }, (_, i) => (
          <div key={i} className="aspect-square rounded-xl flex items-center justify-center"
            style={{ background: on ? (i === 9 ? '#FFF1E0' : '#E6F4EC') : '#EBEEEE', transition: `background-color 400ms ease ${i * 90}ms` }}>
            <svg viewBox="0 0 24 24" width="60%" height="60%">
              {i === 9
                ? <path d="M12 6 V13 M12 17.5 V18" stroke="#B86E1A" strokeWidth="3" strokeLinecap="round" fill="none" style={{ opacity: on ? 1 : 0, transition: `opacity 300ms ease ${i * 90 + 200}ms` }} />
                : <path d="M6 12.5 l4 4 l8 -9" stroke="#2F7358" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none"
                    strokeDasharray="22" strokeDashoffset={on ? 0 : 22} style={{ transition: `stroke-dashoffset 400ms ${ease} ${i * 90 + 150}ms` }} />}
            </svg>
          </div>
        ))}
      </div>
    </div>
  )
}

function ForecastArt({ on }: { on: boolean }) {
  const h = [6, 12, 22, 38, 58, 76, 88, 80, 62, 44, 28, 16, 9, 5]
  return (
    <div className="h-[200px] relative flex items-end gap-1.5 pb-6" aria-hidden="true">
      {h.map((v, i) => (
        <div key={i} className="flex-1 rounded-t-md" style={{ height: on ? `${v}%` : '0%', background: i < 7 ? '#CCD0CF' : '#2563eb', opacity: i < 7 ? 1 : 0.85, transition: `height 700ms ${ease} ${i * 60}ms` }} />
      ))}
      {[['P50', 50], ['P80', 71]].map(([label, x]) => (
        <div key={label} className="absolute bottom-0 top-0 flex flex-col items-center" style={{ left: `${x}%`, opacity: on ? 1 : 0, transition: `opacity 500ms ease ${label === 'P50' ? 1000 : 1250}ms` }}>
          <div className="flex-1 border-l-2 border-dashed border-navy-950/60" />
          <div className="text-[11px] font-semibold text-navy-950 mt-1">{label}</div>
        </div>
      ))}
    </div>
  )
}

const PILLARS = [
  { key: 'build', title: 'Build.', lead: 'A baseline from a conversation.', text: 'RunF9 interviews you like a senior scheduler (scope, permits, long-lead equipment, site and calendar) and builds a CPM schedule with a written basis for every duration and link.', Art: BuildArt },
  { key: 'check', title: 'Check.', lead: 'All 14 DCMA checks, every time.', text: 'Upload a P6 or MS Project file. Each failing check lists the activities involved and a suggested fix, with the published thresholds or your organization’s own.', Art: CheckArt },
  { key: 'forecast', title: 'Forecast.', lead: 'Know the finish before it moves.', text: 'Monte Carlo risk analysis over the full network gives P50 and P80 finish dates. When a date slips, recovery options are re-scheduled and priced from your labor cost.', Art: ForecastArt },
]

function Pillar({ p, flip }: { p: typeof PILLARS[number]; flip: boolean }) {
  const { ref, inView } = useInView<HTMLDivElement>(0.35)
  const { Art } = p
  return (
    <div ref={ref} className="grid md:grid-cols-2 gap-10 md:gap-20 items-center">
      <div className={flip ? 'md:order-2' : ''}>
        <h3 className="text-[44px] md:text-[56px] font-semibold tracking-[-0.035em] text-navy-950 leading-none">{p.title}</h3>
        <p className="text-[21px] md:text-[24px] font-semibold tracking-[-0.015em] text-navy-950 mt-4">{p.lead}</p>
        <p className="text-[16px] md:text-[17px] text-warm-600 leading-relaxed mt-3 max-w-[460px]">{p.text}</p>
      </div>
      <div className={`rounded-[28px] bg-white border border-warm-200 p-6 md:p-8 shadow-[0_30px_60px_-40px_rgba(10,22,40,0.3)] ${flip ? 'md:order-1' : ''}`}>
        <Art on={inView} />
      </div>
    </div>
  )
}

export default function Pillars() {
  return (
    <div className="space-y-24 md:space-y-36">
      {PILLARS.map((p, i) => <Pillar key={p.key} p={p} flip={i % 2 === 1} />)}
    </div>
  )
}
