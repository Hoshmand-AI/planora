'use client'

// The hero's interactive illustration: a small sample schedule that "runs" like pressing F9 in P6.
// The bars draw left to right (forward pass), the critical path lights up (backward pass), then the
// finish date lands. Press the key (or F9 on the keyboard) to run it again. Purely illustrative:
// the numbers are a fixed sample, not a calculation.

import { useCallback, useEffect, useRef, useState } from 'react'
import { prefersReducedMotion, useInView } from './motion'

type Act = { name: string; es: number; dur: number; crit: boolean; float?: number }
const SPAN = 104
const ACTS: Act[] = [
  { name: 'Excavation', es: 0, dur: 14, crit: true },
  { name: 'Foundations', es: 14, dur: 16, crit: true },
  { name: 'Steel erection', es: 30, dur: 28, crit: true },
  { name: 'MEP rough-in', es: 40, dur: 30, crit: false, float: 10 },
  { name: 'Enclosure', es: 58, dur: 22, crit: true },
  { name: 'Finishes', es: 80, dur: 24, crit: true },
]
const STATUS = ['Ready to run', 'Forward pass: early dates…', 'Backward pass: critical path found', '5 critical activities · finish 09/24/2027']

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
      <figure className="rounded-[28px] bg-white border border-warm-200 shadow-[0_40px_80px_-40px_rgba(10,22,40,0.35)] p-5 md:p-7">
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="text-[12px] font-medium text-warm-600">Sample schedule</div>
            <div className="text-[15px] font-semibold text-navy-950">Two-story office · CPM</div>
          </div>
          <div className={`text-[12.5px] font-semibold rounded-full px-3 py-1 transition-all duration-500 ${phase === 3 ? 'bg-accent-100 text-accent-600 opacity-100' : 'bg-warm-100 text-warm-600'}`}>
            {phase === 3 ? 'Finish 09/24/2027' : 'Finish —'}
          </div>
        </div>

        <div className="space-y-2.5" aria-hidden="true">
          {ACTS.map((a, i) => {
            const shown = phase >= 1
            const lit = phase >= 2 && a.crit
            return (
              <div key={a.name} className="grid grid-cols-[96px_1fr] md:grid-cols-[120px_1fr] items-center gap-3">
                <div className="text-[12px] md:text-[12.5px] text-warm-700 truncate">{a.name}</div>
                <div className="relative h-[18px] rounded-full bg-warm-100">
                  <div
                    className="absolute top-0 h-full rounded-full"
                    style={{
                      left: `${(a.es / SPAN) * 100}%`,
                      width: shown ? `${(a.dur / SPAN) * 100}%` : '0%',
                      background: lit ? '#2563eb' : '#CCD0CF',
                      transition: shown ? `width 700ms cubic-bezier(0.22,1,0.36,1) ${i * 140}ms, background-color 500ms ease ${a.crit ? i * 90 : 0}ms` : 'none',
                    }}
                  />
                  {a.float ? (
                    <div
                      className="absolute top-[3px] h-[12px] rounded-full border border-dashed border-[#9BA8AB]"
                      style={{
                        left: `${((a.es + a.dur) / SPAN) * 100}%`,
                        width: `${(a.float / SPAN) * 100}%`,
                        opacity: phase >= 2 ? 1 : 0,
                        transition: phase >= 2 ? 'opacity 500ms ease 200ms' : 'none',
                      }}
                    />
                  ) : null}
                </div>
              </div>
            )
          })}
          <div className="grid grid-cols-[96px_1fr] md:grid-cols-[120px_1fr] items-center gap-3 pt-1">
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
          <span className="text-[12px] text-warm-600 hidden sm:inline">Illustrative · <span className="inline-block w-2.5 h-2.5 rounded-full bg-accent-600 align-middle" /> critical path</span>
        </figcaption>
      </figure>

      <button
        type="button"
        onClick={run}
        aria-label="Press F9 to run the sample schedule"
        className="group mx-auto mt-10 flex flex-col items-center select-none"
      >
        <span
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
