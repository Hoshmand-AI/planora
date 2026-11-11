'use client'

/** Shown inside the app when one page fails to render: the sidebar and project tabs stay, with a way to retry. */
export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="px-6 py-16 max-w-md mx-auto text-center">
      <h1 className="page-title">Something went wrong.</h1>
      <p className="text-[14.5px] text-warm-600 mt-2">This page could not be shown. Your data is safe. Try again, or go back to your projects.</p>
      <div className="mt-6 flex gap-3 justify-center flex-wrap">
        <button type="button" onClick={() => reset()} className="bg-accent-600 text-white px-5 py-2 rounded-full text-[14px] font-semibold hover:bg-accent-700 transition-colors pressable shadow-sm">Try again</button>
        <a href="/dashboard" className="border border-warm-300 text-navy-950 px-5 py-2 rounded-full text-[14px] font-medium hover:bg-warm-100 transition-colors">Go to your projects</a>
      </div>
    </div>
  )
}
