'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ClipboardList, Plus, ArrowRight, Loader2 } from 'lucide-react'
import { fmtDate, fmtDay } from '@/lib/format'

interface PlanRow {
  id: string; name: string; updatedAt: string; readiness: number
  generated: boolean; finish: string | null; activityCount: number; scheduleId: string | null
}

export default function PlansPage() {
  const router = useRouter()
  const [plans, setPlans] = useState<PlanRow[] | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    fetch('/api/plans').then(r => r.json()).then(d => setPlans(d.plans || [])).catch(() => setError('Could not load plans.'))
  }, [])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreating(true); setError('')
    const res = await fetch('/api/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
    const data = await res.json()
    setCreating(false)
    if (!res.ok) { setError(data.error || 'Could not create plan.'); return }
    router.push(`/dashboard/plan/${data.plan.id}`)
  }

  return (
    <div className="px-4 md:px-6 py-6 md:py-8">
      <div className="mb-6">
        <h1 className="font-display text-[28px] md:text-[32px] text-navy-950 leading-tight">Build a schedule</h1>
        <p className="text-[14px] text-warm-500 mt-1 max-w-2xl">
          Planora interviews you like a senior scheduler before it builds anything: drawings, permits for your jurisdiction, long-lead equipment, and site constraints.
          It asks about what it doesn&apos;t know instead of guessing, and shows the reason for every duration and link.
        </p>
      </div>

      <form onSubmit={create} className="bg-warm-100 border border-warm-200 rounded-lg p-5 mb-6 flex flex-col sm:flex-row gap-3">
        <input
          value={name} onChange={e => setName(e.target.value)} required maxLength={120}
          placeholder="Project name, e.g. Riverside Medical Office Building"
          className="flex-1 bg-warm-50 border border-warm-300 rounded-md px-3 py-2.5 text-[14px] text-warm-700 placeholder:text-warm-400"
        />
        <button disabled={creating} className="flex items-center justify-center gap-1.5 bg-accent-500 hover:bg-accent-400 text-navy-950 px-4 py-2.5 rounded-md text-[14px] font-semibold transition-colors disabled:opacity-50">
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Start interview
        </button>
      </form>
      {error && <div className="border-l-2 border-status-at-risk bg-status-at-risk-bg text-status-at-risk text-[13px] px-3 py-2 rounded-md mb-4">{error}</div>}

      {plans === null ? (
        <div className="text-warm-400 text-[14px] flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : plans.length === 0 ? (
        <div className="border border-dashed border-warm-300 rounded-lg p-10 text-center">
          <ClipboardList size={22} className="mx-auto text-warm-400 mb-2" />
          <p className="text-[14px] text-warm-500">No plans yet. Name your project above to start the interview.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {plans.map(p => (
            <Link key={p.id} href={`/dashboard/plan/${p.id}`} className="block bg-warm-100 border border-warm-200 rounded-lg p-5 hover:border-warm-300 hover:shadow-sm transition-[border-color,box-shadow] duration-200">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-navy-950 truncate">{p.name}</div>
                  <div className="text-[12px] text-warm-400 mt-0.5">Updated {fmtDay(p.updatedAt)}</div>
                </div>
                <ArrowRight size={15} className="text-warm-400 flex-shrink-0 mt-1" />
              </div>
              <div className="mt-4">
                <div className="flex justify-between text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-1">
                  <span>Interview readiness</span><span className="tabular-nums">{p.readiness}%</span>
                </div>
                <div className="h-1.5 bg-warm-200 rounded-sm overflow-hidden"><div className="h-full bg-accent-500" style={{ width: `${p.readiness}%` }} /></div>
              </div>
              <div className="mt-3 text-[12.5px] text-warm-600">
                {p.generated ? <>{p.activityCount} activities · finish <span className="font-medium text-navy-950 tabular-nums">{fmtDate(p.finish)}</span>{p.scheduleId ? ' · published' : ''}</> : 'Not generated yet'}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
