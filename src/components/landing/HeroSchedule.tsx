'use client'

// The first screen's centrepiece: the sample data center's schedule, drawn the way pressing F9 in P6
// recalculates one, beside the answer a project team wants first. The bars draw left to right (forward
// pass), the work areas on the critical path light up (backward pass), then the finish lands against
// the required date. Press the key (or F9 on the keyboard) to run it again.
//
// Every date and count is RunF9's own calculation for its built-in sample project
// (src/lib/marketing/sample-schedule.ts). Only the drawing animation is for show. The server sends the
// finished chart, so it reads without JavaScript and for people who ask for reduced motion.

import { useCallback, useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from './motion'
import { SAMPLE_SCHEDULE as SCH } from '@/lib/marketing/sample-schedule'

const SPAN = SCH.spanDays
const ROWS = SCH.rows.map(r => ({ name: r.name, es: r.start, dur: r.days, crit: r.critical > 0 }))
const STATUS = ['Recalculating…', 'Forward pass: early dates…', 'Backward pass: critical path found', `${SCH.critical} of ${SCH.activities} activities are critical. Finish ${SCH.finish}.`]
const ease = 'cubic-bezier(0.22,1,0.36,1)'

export default function HeroSchedule() {
  const [phase, setPhase] = useState(3)
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
      window.setTimeout(() => setPhase(1), 140),
      window.setTimeout(() => setPhase(2), 140 + 1500),
      window.setTimeout(() => setPhase(3), 140 + 2300),
    )
  }, [])

  // Recalculate once when the page opens, as if someone had just pressed the key.
  useEffect(() => {
    const t = window.setTimeout(run, 700)
    return () => { window.clearTimeout(t); timers.current.forEach(x => window.clearTimeout(x)) }
  }, [run])

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

  const done = phase === 3
  const tiles: [string, string][] = [
    [`${SCH.percentComplete}%`, 'complete, by duration'],
    [`${SCH.critical}`, 'critical activities'],
    [`${SCH.checksPassed} of ${SCH.checksApplicable}`, 'checks pass on this sample'],
  ]

  return (
    <div className="rounded-[20px] md:rounded-[26px] border border-warm-200 bg-white shadow-[0_50px_100px_-45px_rgba(6,20,27,0.5)] overflow-hidden text-left">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px]">
        {/* The schedule */}
        <figure className="p-5 md:p-8 min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 mb-5">
            <div>
              <div className="text-[13.5px] text-warm-600">Sample data center · {SCH.activities} activities in {SCH.rows.length} work areas</div>
              <div className="text-[18px] font-semibold text-navy-950 tracking-[-0.01em]">Schedule calculated by RunF9</div>
            </div>
            <div className="text-[13px] text-warm-700 flex items-center gap-4" aria-hidden="true">
              <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-accent-600 align-middle" /> critical</span>
              <span><span className="inline-block w-0 h-3.5 border-l border-dashed border-navy-700 align-middle" /> data date</span>
              <span><span className="inline-block w-0 h-3.5 border-l-2 border-status-at-risk align-middle" /> required</span>
            </div>
          </div>

          <div className="relative space-y-[7px]" aria-hidden="true">
            <div className="pointer-events-none absolute inset-y-0 right-0 left-[calc(124px+0.75rem)] md:left-[calc(312px+0.75rem)]">
              <div className="absolute inset-y-0 border-l border-dashed border-navy-700" style={{ left: `${(SCH.dataDay / SPAN) * 100}%` }} />
              <div className="absolute inset-y-0 border-l-2 border-status-at-risk" style={{ left: `${(SCH.requiredDay / SPAN) * 100}%`, opacity: done ? 1 : 0, transition: 'opacity 500ms ease' }} />
            </div>
            {ROWS.map((a, i) => {
              const shown = phase >= 1
              const lit = phase >= 2 && a.crit
              return (
                <div key={a.name} className="grid grid-cols-[124px_1fr] md:grid-cols-[312px_1fr] items-center gap-3">
                  <div className="text-[13px] md:text-[14px] text-warm-700 truncate">{a.name}</div>
                  <div className="relative h-[16px] md:h-[18px] rounded-full bg-warm-100">
                    <div
                      className="absolute top-0 h-full rounded-full"
                      style={{
                        left: `${(a.es / SPAN) * 100}%`,
                        width: shown ? `${(a.dur / SPAN) * 100}%` : '0%',
                        background: lit ? '#2563eb' : '#9BA8AB',
                        transition: shown ? `width 700ms ${ease} ${i * 110}ms, background-color 500ms ease ${a.crit ? i * 70 : 0}ms` : 'none',
                      }}
                    />
                  </div>
                </div>
              )
            })}
            <div className="grid grid-cols-[124px_1fr] md:grid-cols-[312px_1fr] items-center gap-3 pt-0.5">
              <div className="text-[13px] md:text-[14px] font-semibold text-navy-950">Substantial completion</div>
              <div className="relative h-[18px]">
                <div
                  className="absolute top-1/2 w-3.5 h-3.5 bg-navy-950"
                  style={{ left: 'calc(100% - 10px)', transform: `translateY(-50%) rotate(45deg) scale(${done ? 1 : 0})`, transition: done ? 'transform 500ms cubic-bezier(0.34,1.56,0.64,1)' : 'none' }}
                />
              </div>
            </div>
          </div>

          <figcaption className="mt-5 border-t border-warm-200 pt-4 text-[14px] text-warm-700" aria-live="polite">{STATUS[phase]}</figcaption>
        </figure>

        {/* The answer */}
        <div className="bg-navy-950 text-white p-5 md:p-7 flex flex-col">
          <p className="text-[13.5px] text-navy-200">Will we finish on time?</p>
          <p className="text-[38px] md:text-[42px] font-semibold tracking-[-0.03em] leading-none mt-1.5 tabular-nums">{SCH.finish}</p>
          <p className="mt-3 self-start rounded-full bg-status-at-risk-bg text-status-at-risk text-[14px] font-semibold px-3 py-1">{SCH.daysLate} days after the required {SCH.required}</p>
          <dl className="mt-4 grid grid-cols-3 lg:grid-cols-1 gap-2">
            {tiles.map(([value, label]) => (
              <div key={label} className="rounded-xl bg-navy-900 border border-navy-800 px-4 py-2.5">
                <dt className="sr-only">{label}</dt>
                <dd className="flex flex-col lg:flex-row lg:items-baseline lg:gap-2.5">
                  <span className="text-[22px] md:text-[24px] font-semibold tracking-[-0.02em] tabular-nums whitespace-nowrap">{value}</span>
                  <span className="text-[13.5px] text-navy-200 leading-snug">{label}</span>
                </dd>
              </div>
            ))}
          </dl>
          <button type="button" onClick={run} className="group mt-5 lg:mt-auto pt-1 flex items-center gap-4 select-none text-left">
            <span
              aria-hidden="true"
              className="flex-shrink-0 flex items-center justify-center w-[58px] h-[58px] rounded-[15px] bg-navy-900 border-2 border-accent-400 text-white font-bold text-[20px] tracking-tight transition-transform duration-150"
              style={{ transform: pressed ? 'translateY(4px)' : 'none', boxShadow: pressed ? '0 1px 0 #06141B' : '0 5px 0 #06141B, 0 18px 30px -10px rgba(59,130,246,0.6)' }}
            >F9</span>
            <span className="text-[14.5px] text-navy-200 group-hover:text-white transition-colors leading-snug">Press F9 to recalculate.<br />Arithmetic, not AI.</span>
          </button>
        </div>
      </div>
    </div>
  )
}
