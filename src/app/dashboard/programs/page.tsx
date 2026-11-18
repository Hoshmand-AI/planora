'use client'

import { Suspense } from 'react'
import { MasterSchedule } from '@/components/MasterSchedule'

/** Program master schedules: several projects read together, each from its contractor's own schedule. */
export default function ProgramsPage() {
  return <Suspense fallback={null}><MasterSchedule /></Suspense>
}
