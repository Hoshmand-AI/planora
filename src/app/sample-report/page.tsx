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
        <Link href="/" className="text-[14px] font-medium text-accent-700 hover:underline">Back to RunF9</Link>
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
        <p className="text-[15px] text-warm-700 mt-8">Want this for your own schedule? <Link href="/#pricing" className="font-medium text-accent-700 underline">See plans and request access</Link>.</p>
      </main>
    </div>
  )
}
