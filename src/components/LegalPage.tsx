import Link from 'next/link'
import { Logo } from '@/components/Logo'

export function LegalPage({ title, effective, children }: { title: string; effective: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-warm-50">
      <nav className="bg-navy-900 h-14 flex items-center px-6">
        <Link href="/" aria-label="Planora home"><Logo variant="light" size="text-[18px]" /></Link>
      </nav>
      <main className="max-w-[760px] mx-auto px-6 py-12">
        <h1 className="font-display text-[32px] text-navy-950 mb-2">{title}</h1>
        <p className="text-[13px] text-warm-500 mb-8">Effective {effective}</p>
        <div className="text-warm-700 space-y-5 text-[15px] leading-relaxed [&_h2]:text-[18px] [&_h2]:font-semibold [&_h2]:text-navy-950 [&_h2]:mt-9 [&_h2]:mb-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_a]:text-accent-600 [&_a]:underline [&_table]:w-full [&_table]:text-[13.5px] [&_th]:text-left [&_th]:py-2 [&_th]:pr-3 [&_th]:border-b [&_th]:border-warm-300 [&_td]:py-2 [&_td]:pr-3 [&_td]:border-b [&_td]:border-warm-200 [&_td]:align-top">
          {children}
        </div>
      </main>
    </div>
  )
}
