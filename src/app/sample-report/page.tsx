import type { Metadata } from 'next'
import Link from 'next/link'
import { Logo } from '@/components/Logo'
import { Markdown } from '@/components/Markdown'
import { SAMPLE_REPORT_MD } from '@/lib/marketing/sample-report'

export const metadata: Metadata = {
  title: 'Sample report — RunF9',
  description: 'An Executive Schedule Summary written by RunF9 for its sample data center project, shown exactly as generated.',
}

// A public, unedited example of what RunF9 produces, so a visitor can judge the output before asking for access.
export default function SampleReportPage() {
  return (
    <div className="min-h-screen bg-warm-50">
      <nav className="h-16 flex items-center justify-between px-6 border-b border-warm-200 bg-white/80 backdrop-blur-xl">
        <Link href="/" aria-label="RunF9 home"><Logo variant="dark" size="text-[22px]" /></Link>
        <div className="flex items-center gap-4">
          <Link href="/" className="hidden sm:inline text-[14px] font-medium text-warm-700 hover:text-navy-950">Back to RunF9</Link>
          <Link href="/#pricing" className="pressable inline-flex items-center justify-center rounded-full bg-accent-600 px-4 py-2 text-[14px] font-semibold text-white hover:bg-accent-700">See plans</Link>
        </div>
      </nav>
      <main className="max-w-[920px] mx-auto px-6 py-10 md:py-14">
        <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-accent-700">Sample report</p>
        <h1 className="text-[30px] md:text-[40px] font-semibold tracking-[-0.03em] text-navy-950 leading-tight mt-2">What RunF9 writes from a schedule</h1>
        <p className="text-[16px] md:text-[17px] text-warm-700 leading-relaxed mt-4 max-w-[720px]">
          This is the Executive Schedule Summary RunF9 produced for the sample data center project that every account can open. It was written with AI switched off, from the schedule file alone, and is shown exactly as generated. The project is a sample, not a customer&rsquo;s.
        </p>
        <div className="mt-8 rounded-[20px] border border-warm-200 bg-white p-5 md:p-9 overflow-x-auto">
          <Markdown text={SAMPLE_REPORT_MD} />
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link href="/#pricing" className="pressable inline-flex items-center justify-center rounded-full bg-accent-600 px-6 py-3 text-[15px] font-semibold text-white hover:bg-accent-700">See plans and request access</Link>
          <p className="text-[15px] text-warm-700">RunF9 writes this for your own schedule in seconds.</p>
        </div>
      </main>
    </div>
  )
}
