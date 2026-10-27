'use client'

// Small motion kit for the marketing page: elements fade up as they scroll into view, numbers count
// up once, and nothing moves for people who ask for reduced motion. Server HTML is fully visible;
// hiding only happens after mount for content that is still below the fold, so the page never
// depends on JavaScript to be readable.

import { useEffect, useRef, useState } from 'react'

export function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Calls back once when the element first comes into view (immediately if it already is). */
export function useInView<T extends Element>(threshold = 0.25) {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') { setInView(true); return }
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setInView(true); io.disconnect() }
    }, { threshold, rootMargin: '0px 0px -8% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [threshold])
  return { ref, inView }
}

/** Fades and lifts its children into place the first time they scroll into view. */
export function Reveal({ children, delay = 0, className = '', as: Tag = 'div' }: {
  children: React.ReactNode
  delay?: number
  className?: string
  as?: 'div' | 'section' | 'li' | 'article'
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'static' | 'hidden' | 'shown'>('static')
  useEffect(() => {
    const el = ref.current
    if (!el || prefersReducedMotion() || typeof IntersectionObserver === 'undefined') return
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return // already on screen: leave it be
    setState('hidden')
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setState('shown'); io.disconnect() }
    }, { threshold: 0.15, rootMargin: '0px 0px -6% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  const Comp = Tag as 'div'
  return (
    <Comp ref={ref} className={`${state === 'static' ? '' : 'reveal'} ${state === 'shown' ? 'is-in' : ''} ${className}`} style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </Comp>
  )
}

/** Counts a whole number up to its value once it is on screen; renders the final value on the server. */
export function CountUp({ value, duration = 1400 }: { value: number; duration?: number }) {
  const { ref, inView } = useInView<HTMLSpanElement>(0.6)
  const [n, setN] = useState(value)
  const started = useRef(false)
  useEffect(() => {
    if (!inView || started.current || prefersReducedMotion()) return
    started.current = true
    const t0 = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration)
      setN(Math.round(value * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    setN(0)
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [inView, value, duration])
  return <span ref={ref}>{n.toLocaleString('en-US')}</span>
}
