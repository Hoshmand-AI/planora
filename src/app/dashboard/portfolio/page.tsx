'use client'

import { Portfolio } from '@/components/Portfolio'
import { Disclosure } from '@/components/Disclosure'

export default function PortfolioPage() {
  return (
    <div className="px-4 md:px-6 py-6 md:py-8">
      <h1 className="font-display text-[28px] md:text-[32px] text-navy-950 leading-tight">Portfolio</h1>
      <p className="text-[14px] text-warm-600 mt-1">Every plan and uploaded schedule in your organization, most urgent first.</p>
      <div className="max-w-2xl mb-5">
        <Disclosure title="What RunF9 looks for">
          <p className="text-[13px] text-warm-600">Late against the required date, missed milestone targets, date conflicts, reviews and overdue status updates.</p>
        </Disclosure>
      </div>
      <Portfolio />
    </div>
  )
}
