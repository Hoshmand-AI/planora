'use client'

// The first screen: one sentence saying what RunF9 does with a schedule, and five windows that show it.
// The five verbs of the headline are the carousel's index: the verb of the leading (left-most) window is
// marked, and pressing a verb brings its window to the front.
//
// The row shows three windows on a desktop, two on a tablet and one on a phone. Every five seconds it
// slides one window to the left and the next one comes in from the right, in a loop. It stops while the
// pointer is over it, while the keyboard is inside it, while the tab is hidden or the row is off screen,
// when the pause button is pressed, and it never starts for people who ask for reduced motion (WCAG 2.2.2).
// The five windows are laid in a ring: each has its own position, and the one that wraps from one end to
// the other does so unseen, so there are no cloned slides and nothing jumps.

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react'
import { prefersReducedMotion } from './motion'
import { WINDOWS } from './HeroWindows'

const N = WINDOWS.length
/** The headline, as one sentence: what a screen reader announces for the heading (its verbs are also buttons). */
const SENTENCE = `Construction schedules, ${WINDOWS.slice(0, -1).map(w => w.verb).join(", ")} and ${WINDOWS[WINDOWS.length - 1].verb}.`
const INTERVAL = 5000
const SLIDE_MS = 700
const STEP_MS = 420 // a verb two windows away is reached in two quicker steps
const mod = (n: number) => ((n % N) + N) % N
/** Where window i sits when `lead` is the left-most one: 0, 1, 2 … to the right, and -1 for the one that just left. */
const posOf = (i: number, lead: number) => { const p = mod(i - lead); return p === N - 1 ? -1 : p }

const ctl = 'pressable grid place-items-center w-10 h-10 rounded-full border border-warm-300 bg-white text-ink hover:border-navy-900 hover:bg-warm-100'

export default function Hero() {
  // The leading window, and the one before the last move (to tell which window wrapped round the ring).
  const [ring, setRing] = useState({ lead: 0, prev: 0 })
  const lead = ring.lead
  const move = useCallback((by: number) => setRing(r => ({ lead: r.lead + by, prev: r.lead })), [])
  const [visible, setVisible] = useState(3)
  const [playing, setPlaying] = useState(true)
  const [reduced, setReduced] = useState(false)
  const [hover, setHover] = useState(false)
  const [focusIn, setFocusIn] = useState(false)
  const [inView, setInView] = useState(true)
  const [tabShown, setTabShown] = useState(true)
  const [quick, setQuick] = useState(false)
  const region = useRef<HTMLDivElement>(null)
  const stepTimer = useRef<number | null>(null)
  const swipe = useRef<{ x: number; y: number } | null>(null)

  // How many windows fit: the layout itself is CSS (--v), this copy only decides which windows are inert.
  useEffect(() => {
    const lg = window.matchMedia('(min-width: 1024px)')
    const md = window.matchMedia('(min-width: 768px)')
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => { setVisible(lg.matches ? 3 : md.matches ? 2 : 1); setReduced(prefersReducedMotion()) }
    sync()
    for (const m of [lg, md, motion]) m.addEventListener('change', sync)
    const onVis = () => setTabShown(!document.hidden)
    onVis()
    document.addEventListener('visibilitychange', onVis)
    return () => { for (const m of [lg, md, motion]) m.removeEventListener('change', sync); document.removeEventListener('visibilitychange', onVis) }
  }, [])

  useEffect(() => {
    const el = region.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(entries => setInView(entries[entries.length - 1].isIntersecting), { threshold: 0.2 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => () => { if (stepTimer.current) window.clearTimeout(stepTimer.current) }, [])

  const step = useCallback((by: number) => {
    if (stepTimer.current) { window.clearTimeout(stepTimer.current); stepTimer.current = null }
    setQuick(false)
    move(by)
  }, [move])

  /** Bring window i to the front by the shorter way round, one window at a time. */
  const goTo = useCallback((i: number) => {
    let d = mod(i - lead)
    if (d > N / 2) d -= N
    if (!d) return
    if (stepTimer.current) window.clearTimeout(stepTimer.current)
    const dir = Math.sign(d)
    setQuick(Math.abs(d) > 1)
    move(dir)
    if (Math.abs(d) > 1) stepTimer.current = window.setTimeout(() => { stepTimer.current = null; move(dir) }, prefersReducedMotion() ? 0 : STEP_MS)
  }, [lead, move])

  const running = playing && !reduced && !hover && !focusIn && inView && tabShown
  useEffect(() => {
    if (!running) return
    const t = window.setTimeout(() => { setQuick(false); move(1) }, INTERVAL)
    return () => window.clearTimeout(t)
  }, [running, lead, move])

  const at = mod(lead)
  const ms = quick ? STEP_MS : SLIDE_MS

  return (
    <header className="relative -mt-[76px] md:-mt-[84px] pt-[108px] md:pt-[132px] pb-20 md:pb-28 overflow-hidden">
      {/* A soft wash of the accent behind the headline; decorative */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[720px] bg-[radial-gradient(ellipse_60%_55%_at_20%_0%,rgba(43,99,193,0.10),transparent_70%)]" />
      <div className="relative max-w-[1240px] mx-auto px-6">
        <h1 aria-label={SENTENCE} className="hero-rise font-bold text-ink">
          <span className="block text-h1 leading-[1.05] tracking-[-0.03em] md:text-display md:leading-[1.02] md:tracking-[-0.04em]">Construction schedules,{' '}</span>
          <span className="block mt-3 md:mt-5 text-h2 leading-[1.35] tracking-[-0.02em] xl:text-h1 xl:leading-[1.3] xl:tracking-[-0.03em]">
            {WINDOWS.map((w, i) => (
              <Fragment key={w.id}>
                {/* The verb keeps its comma or full stop on its own line */}
                <span className="whitespace-nowrap"><button
                  type="button" data-compact aria-controls="hero-windows" aria-current={at === i ? 'true' : undefined} onClick={() => goTo(i)}
                  className={`relative inline pb-1.5 transition-colors duration-300 ${at === i ? 'text-accent-600' : 'text-ink hover:text-accent-700'}`}
                >
                  {w.verb}
                  <span aria-hidden className={`absolute inset-x-0 bottom-0 h-[3px] rounded-full overflow-hidden ${at === i ? 'bg-accent-400' : 'bg-warm-300'}`}>
                    {at === i && <span key={`${lead}-${running}`} className={`block h-full rounded-full bg-accent-600 ${running ? 'verb-progress' : ''}`} />}
                  </span>
                </button>
                {i < N - 2 ? ',' : i === N - 1 ? '.' : ''}</span>{i < N - 2 ? ' ' : i === N - 2 ? ' and ' : ''}
              </Fragment>
            ))}
          </span>
        </h1>
      </div>

      <div
        ref={region} id="hero-windows" role="region" aria-roledescription="carousel" aria-label="What RunF9 does with a schedule"
        className="relative hero-rise [animation-delay:200ms] max-w-[1240px] mx-auto px-6 mt-9 md:mt-12 [--v:1] [--gap:16px] md:[--v:2] md:[--gap:24px] lg:[--v:3]"
        onFocus={e => { if ((e.target as HTMLElement).matches(':focus-visible')) setFocusIn(true) }}
        onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusIn(false) }}
      >
        <div
          className="grid touch-pan-y"
          aria-live={running ? 'off' : 'polite'}
          onPointerEnter={e => { if (e.pointerType === 'mouse') setHover(true) }}
          onPointerLeave={() => setHover(false)}
          onTouchStart={e => { swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }}
          onTouchEnd={e => {
            const s = swipe.current
            swipe.current = null
            if (!s) return
            const dx = e.changedTouches[0].clientX - s.x
            const dy = e.changedTouches[0].clientY - s.y
            if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1)
          }}
        >
          {WINDOWS.map((w, i) => {
            const pos = posOf(i, lead)
            const shown = pos >= 0 && pos < visible
            // The window that wraps from one end of the ring to the other does it in one frame, unseen.
            const wraps = Math.abs(pos - posOf(i, ring.prev)) > 1
            return (
              <div
                key={w.id} role="group" aria-roledescription="slide" aria-label={`${w.name}: ${i + 1} of ${N}`} aria-hidden={!shown} inert={!shown}
                className="[grid-area:1/1] min-w-0 will-change-transform"
                style={{
                  width: 'calc((100% - (var(--v) - 1) * var(--gap)) / var(--v))',
                  transform: `translate3d(calc(${pos} * (100% + var(--gap))), 0, 0)`,
                  opacity: shown ? 1 : 0,
                  transition: wraps ? 'none' : `transform ${ms}ms cubic-bezier(0.5, 0, 0.15, 1), opacity ${ms}ms ease`,
                }}
              >
                <w.Window />
              </div>
            )
          })}
        </div>

        <div className="mt-6 md:mt-8 flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
          <p className="text-fine text-warm-600 max-w-[620px] leading-relaxed">Figures are RunF9’s own calculation for its built-in sample data center. A window marked “Illustration” uses example figures.</p>
          <div className="flex items-center gap-2">
            {!reduced && (
              <button type="button" className={ctl} onClick={() => setPlaying(p => !p)} aria-label={playing ? 'Pause the slideshow' : 'Play the slideshow'}>
                {playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
              </button>
            )}
            <button type="button" className={ctl} onClick={() => step(-1)} aria-label="Previous window"><ChevronLeft size={18} aria-hidden /></button>
            <button type="button" className={ctl} onClick={() => step(1)} aria-label="Next window"><ChevronRight size={18} aria-hidden /></button>
          </div>
        </div>
      </div>
    </header>
  )
}
