'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ProjectsDashboard } from '@/components/ProjectsDashboard'

/** Home: every project; the user opens one. Old deep links (/dashboard?schedule=<id>) go to that project. */
export default function HomePage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (/[?&](schedule|id)=/.test(window.location.search)) router.replace(`/dashboard/project${window.location.search}${window.location.hash}`)
    else setReady(true)
  }, [router])
  return ready ? <ProjectsDashboard /> : null
}
