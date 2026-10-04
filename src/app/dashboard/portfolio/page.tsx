'use client'

import { Portfolio } from '@/components/Portfolio'

export default function PortfolioPage() {
  return (
    <div className="px-4 md:px-6 py-6 md:py-8">
      <h1 className="font-display text-[28px] md:text-[32px] text-navy-950 leading-tight">Portfolio</h1>
      <p className="text-[14px] text-warm-500 mt-1 mb-5 max-w-2xl">Every plan and uploaded schedule in your organization, most urgent first: late against the required date, missed milestone targets, date conflicts, reviews and overdue status updates.</p>
      <Portfolio />
    </div>
  )
}
