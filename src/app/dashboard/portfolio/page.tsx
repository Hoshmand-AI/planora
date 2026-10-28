'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** The portfolio is Home now (/dashboard); kept so old links and bookmarks still land there. */
export default function PortfolioPage() {
  const router = useRouter()
  useEffect(() => { router.replace('/dashboard') }, [router])
  return null
}
