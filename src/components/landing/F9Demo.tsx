'use client'

// The F9 picture: the sample data center's schedule, drawn the way pressing F9 in P6 recalculates one.
// The bars draw left to right (forward pass), the work areas on the critical path light up (backward
// pass), then the finish date lands against the required date. Press the key (or F9 on the keyboard)
// to run it again. The dates are RunF9's own calculation for the sample (src/lib/marketing/sample-schedule.ts);
// only the animation is for show.

import { useCallback, useEffect, useRef, useState } from 'react'
import { prefersReducedMotion, useInView } from './motion'
import { SAMPLE_SCHEDULE as SCH } from '@/lib/marketing/sample-schedule'

const SPAN = SCH.spanDays
const ACTS = SCH.rows.map(r => ({ name: r.name, es: r.start, dur: r.days, crit: r.critical > 0 }))
const STATUS = ['Ready to run', 'Forward pass: early dates…', 'Backward pass: critical path found', `${SCH.critical} critical activities · finish ${SCH.finish}, ${SCH.daysLate} days after the required ${SCH.required}`]

export default function F9Demo() {
  const { ref, inView } = useInView<HTMLDivElement>(0.3)
  const [phase, setPhase] = useState(0)
  const [pressed, setPressed] = useState(false)
  const timers = useRef<number[]>([])

  const run = useCallback(() => {
    timers.current.forEach(t => window.clearTimeout(t))
    timers.current = []
    if (prefersReducedMotion()) { setPhase(3); return }
    setPhase(0)
    setPressed(true)
    timers.current.push(
      window.setTimeout(() => setPressed(false), 160),
      window.setTimeout(() => setPhase(1), 120),
      window.setTimeout(() => setPhase(2), 120 + 1500),
      window.setTimeout(() => setPhase(3), 120 + 2300),
    )
  }, [])

  useEffect(() => { if (inView) run() }, [inView, run])
  useEffect(() => () => timers.current.forEach(t => window.clearTimeout(t)), [])

  // F9 on the keyboard runs it too, unless someone is typing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F9') return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return
      e.preventDefault()
      run()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [run])

  return (
    <div ref={ref} className="relative flex flex-col">
      <figure className="rounded-[28px] bg-white border border-warm-200 shadow-[0_40px_80px_-40px_rgba(6,20,27,0.35)] p-5 md:p-7">
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="text-[12.5px] font-medium text-warm-600">Sample data center · {SCH.activities} activities in {SCH.rows.length} work areas</div>
            <div className="text-[15px] font-semibold text-navy-950">Schedule calculated by RunF9</div>
          </div>
          <div className={`text-[12.5px] font-semibold rounded-full px-3 py-1 transition-all duration-500 ${phase === 3 ? 'bg-accent-100 text-accent-600 opacity-100' : 'bg-warm-100 text-warm-600'}`}>
            {phase === 3 ? `Finish ${SCH.finish}` : 'Finish —'}
          </div>
        </div>

        <div className="relative space-y-2" aria-hidden="true">
          {/* The data date and the required date, as lines across the bars */}
          <div className="pointer-events-none absolute inset-y-0 right-0 left-[calc(118px+0.75rem)] md:left-[calc(176px+0.75rem)]">
            <div className="absolute inset-y-0 border-l border-dashed border-navy-400" style={{ left: `${(SCH.dataDay / SPAN) * 100}%` }} />
            <div className="absolute inset-y-0 border-l-2 border-[#A64848]" style={{ left: `${(SCH.requiredDay / SPAN) * 100}%`, opacity: phase === 3 ? 1 : 0, transition: 'opacity 500ms ease' }} />
          </div>
          {ACTS.map((a, i) => {
            const shown = phase >= 1
            const lit = phase >= 2 && a.crit
            return (
              <div key={a.name} className="grid grid-cols-[118px_1fr] md:grid-cols-[176px_1fr] items-center gap-3">
                <div className="text-[12px] md:text-[12.5px] text-warm-700 truncate">{a.name}</div>
                <div className="relative h-[15px] rounded-full bg-warm-100">
                  <div
                    className="absolute top-0 h-full rounded-full"
                    style={{
                      left: `${(a.es / SPAN) * 100}%`,
                      width: shown ? `${(a.dur / SPAN) * 100}%` : '0%',
                      background: lit ? '#2563eb' : '#CCD0CF',
                      transition: shown ? `width 700ms cubic-bezier(0.22,1,0.36,1) ${i * 140}ms, background-color 500ms ease ${a.crit ? i * 90 : 0}ms` : 'none',
                    }}
                  />
                </div>
              </div>
            )
          })}
          <div className="grid grid-cols-[118px_1fr] md:grid-cols-[176px_1fr] items-center gap-3 pt-1">
            <div className="text-[12px] md:text-[12.5px] font-semibold text-navy-950">Finish</div>
            <div className="relative h-[18px]">
              <div
                className="absolute top-1/2 w-3.5 h-3.5 bg-navy-950 rotate-45"
                style={{
                  left: 'calc(100% - 10px)',
                  transform: `translateY(-50%) rotate(45deg) scale(${phase === 3 ? 1 : 0})`,
                  transition: phase === 3 ? 'transform 500ms cubic-bezier(0.34,1.56,0.64,1)' : 'none',
                }}
              />
            </div>
          </div>
        </div>

        <figcaption className="mt-5 flex items-center justify-between gap-4 border-t border-warm-200 pt-4">
          <span className="text-[13px] text-warm-700" aria-live="polite">{STATUS[phase]}</span>
          <span className="text-[12.5px] text-warm-600 hidden sm:flex items-center gap-3 flex-shrink-0">
            <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-accent-600 align-middle" /> critical</span>
            <span><span className="inline-block w-0 h-3 border-l border-dashed border-navy-400 align-middle" /> data date</span>
            <span><span className="inline-block w-0 h-3 border-l-2 border-[#A64848] align-middle" /> required</span>
          </span>
        </figcaption>
      </figure>

      <button
        type="button"
        onClick={run}
        className="group mx-auto mt-10 flex flex-col items-center select-none"
      >
        <span
          aria-hidden="true"
          className="block w-[84px] h-[84px] md:w-[96px] md:h-[96px] rounded-[22px] bg-navy-900 border-[3px] border-accent-400 transition-transform duration-150"
          style={{ transform: pressed ? 'translateY(6px)' : 'none', boxShadow: pressed ? '0 2px 0 #06141B' : '0 8px 0 #06141B, 0 24px 40px -12px rgba(37,99,235,0.55)' }}
        >
          <span className="flex h-full items-center justify-center">
            <span className="text-white font-bold text-[28px] md:text-[32px] tracking-tight">F9</span>
          </span>
        </span>
        <span className="block mt-4 text-center text-[13px] font-medium text-warm-700 group-hover:text-navy-950 transition-colors">Press F9 to run it again</span>
      </button>
    </div>
  )
}
