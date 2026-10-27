import Link from 'next/link'

export const metadata = { title: 'Page not found — RunF9', robots: { index: false } }

export default function NotFound() {
  return (
    <main className="min-h-screen bg-warm-50 flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <p className="text-[13px] font-semibold uppercase tracking-widest text-accent-600 mb-3">404</p>
        <h1 className="font-display text-[30px] text-navy-950 mb-3">This page could not be found.</h1>
        <p className="text-[15px] text-warm-600 mb-8">The link may be out of date, or the page may have moved.</p>
        <div className="flex gap-3 justify-center flex-wrap">
          <Link href="/" className="bg-accent-500 text-navy-950 px-6 py-2.5 rounded-full text-[14px] font-semibold hover:bg-accent-400 transition-colors">Go to the home page</Link>
          <Link href="/auth" className="border border-warm-300 text-navy-950 px-6 py-2.5 rounded-full text-[14px] font-medium hover:bg-warm-100 transition-colors">Sign in</Link>
        </div>
      </div>
    </main>
  )
}
