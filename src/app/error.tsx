'use client'

/** Shown when a page fails to render: a plain message and a way back, instead of the bare framework error page. */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="min-h-screen bg-warm-50 flex items-center justify-center px-6">
      <div role="alert" className="max-w-md text-center">
        <h1 className="font-display text-[26px] text-navy-950 mb-3">Something went wrong.</h1>
        <p className="text-[15px] text-warm-600 mb-8">This page could not be shown. Your data is safe. Try again, or go back to the start.</p>
        <div className="flex gap-3 justify-center flex-wrap">
          <button type="button" onClick={() => reset()} className="bg-accent-600 text-white px-6 py-2.5 rounded-full text-[14px] font-semibold hover:bg-accent-700 transition-colors pressable shadow-sm">Try again</button>
          <a href="/" className="border border-warm-300 text-navy-950 px-6 py-2.5 rounded-full text-[14px] font-medium hover:bg-warm-100 transition-colors">Go to the home page</a>
        </div>
      </div>
    </main>
  )
}
