'use client'

import { useEffect, useState } from 'react'

/** A summary bar that stays frozen just under the app navigation while the page scrolls. */
export function StickyBar({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const [top, setTop] = useState(0)
  useEffect(() => {
    const measure = () => setTop(document.querySelector('header')?.getBoundingClientRect().height ?? 0)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  return (
    <div style={{ top }} className={`sticky z-30 bg-warm-50/95 backdrop-blur border-b border-warm-200 ${className}`}>
      {children}
    </div>
  )
}
