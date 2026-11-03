'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, ArrowRight, Loader2, Sparkles, Upload } from 'lucide-react'
import { fmtDate, fmtDay } from '@/lib/format'
import { WorkspaceSelect } from '@/components/WorkspaceSelect'
import { Robot } from '@/components/Robot'
import { useApp } from '../layout'

interface PlanRow {
  id: string; name: string; updatedAt: string; readiness: number
  generated: boolean; finish: string | null; activityCount: number; scheduleId: string | null
}

export default function PlansPage() {
  const router = useRouter()
  const { can, openUpload } = useApp()
  const [plans, setPlans] = useState<PlanRow[] | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    fetch('/api/plans').then(r => r.json()).then(d => setPlans(d.plans || [])).catch(() => setError('Could not load plans.'))
  }, [])

  const create = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setCreating(true); setError('')
    const workspaceId = (new FormData(e.currentTarget).get('workspaceId') as string | null) || undefined
    const res = await fetch('/api/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, workspaceId }) })
    const data = await res.json()
    setCreating(false)
    if (!res.ok) { setError(data.error || 'Could not create plan.'); return }
    router.push(`/dashboard/plan/${data.plan.id}`)
  }

  const trySample = async () => {
    setCreating(true); setError('')
    const res = await fetch('/api/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sample: true }) })
    const data = await res.json().catch(() => ({}))
    setCreating(false)
    if (!res.ok) { setError(data.error || 'Could not create the sample project.'); return }
    router.push(`/dashboard/plan/${data.plan.id}`)
  }

  return (
    <div className="px-4 md:px-6 py-6 md:py-10">
      <div className="mb-6">
        <h1 className="font-display text-[28px] md:text-[34px] text-navy-950 leading-tight">New project</h1>
        <p className="text-[15px] text-warm-600 mt-2 max-w-2xl leading-relaxed">Build a schedule with a guided interview, or bring one you already have.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4 mb-8">
        <section aria-labelledby="build-h" className="bg-white border border-warm-200 rounded-3xl p-5 md:p-6 shadow-[0_1px_2px_rgba(10,22,40,0.04),0_8px_24px_-16px_rgba(10,22,40,0.18)]">
          <h2 id="build-h" className="text-[17px] font-semibold text-navy-950 flex items-center gap-2"><Sparkles size={16} aria-hidden className="text-accent-600" /> Build with an interview</h2>
          <p className="text-[14px] text-warm-600 mt-1.5 leading-relaxed">
            RunF9 interviews you like a senior scheduler: drawings, permits for your jurisdiction, long-lead equipment and site constraints.
            It asks about what it doesn&apos;t know instead of guessing, and shows the reason for every duration and link.
          </p>
          <form onSubmit={create} className="mt-4 flex flex-col sm:flex-row gap-2">
            <input
              value={name} onChange={e => setName(e.target.value)} required maxLength={120} aria-label="Project name"
              placeholder="Project name, e.g. Riverside Medical Office Building"
              className="flex-1 min-w-0 bg-warm-50 border border-warm-200 rounded-xl px-3.5 py-2.5 text-[15px] text-warm-700 placeholder:text-warm-400"
            />
            <WorkspaceSelect labelClassName="sr-only" className="bg-warm-50 border border-warm-200 rounded-xl px-2 py-2.5 text-[14px] text-warm-700" />
            <button disabled={creating} className="pressable flex items-center justify-center gap-1.5 bg-accent-600 hover:bg-accent-700 text-white px-5 py-2.5 rounded-full text-[14px] font-semibold transition-colors disabled:opacity-50">
              {creating ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Plus size={14} aria-hidden />} Start interview
            </button>
          </form>
        </section>
        <section aria-labelledby="upload-h" className="bg-white border border-warm-200 rounded-3xl p-5 md:p-6 flex flex-col">
          <h2 id="upload-h" className="text-[17px] font-semibold text-navy-950 flex items-center gap-2"><Upload size={16} aria-hidden className="text-accent-600" /> Upload a schedule</h2>
          <p className="text-[14px] text-warm-600 mt-1.5 leading-relaxed">Primavera P6 (XER or XML), Microsoft Project XML, Excel, CSV or PDF. RunF9 checks it and opens it as a project.</p>
          {can('schedule.write') ? (
            <button type="button" onClick={openUpload} className="pressable mt-4 lg:mt-auto self-start inline-flex items-center gap-1.5 rounded-full border border-warm-300 bg-white text-navy-950 hover:border-navy-900 px-4 py-2 text-[14px] font-semibold">
              <Upload size={14} aria-hidden /> Choose a file
            </button>
          ) : (
            <p className="mt-4 text-[13px] text-warm-500">Your role can&apos;t upload schedules. Ask an admin for access.</p>
          )}
        </section>
      </div>
      {error && <div role="alert" className="border-l-2 border-status-at-risk bg-status-at-risk-bg text-status-at-risk text-[13px] px-3 py-2 rounded-md mb-4">{error}</div>}

      {plans === null ? (
        <div className="text-warm-500 text-[14px] flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden /> Loading…</div>
      ) : plans.length === 0 ? (
        <div className="mood-tile rounded-3xl border px-6 py-10 text-center" data-mood="idle">
          <Robot mood="idle" size={80} className="mx-auto mb-3" />
          <p className="text-[16px] font-semibold text-navy-950">No plans yet</p>
          <p className="text-[14px] text-warm-600 mt-1">Name your project above to start the interview, or upload a schedule.</p>
          <p className="text-[14px] text-warm-600 mt-4 max-w-md mx-auto">New to RunF9? Open a finished sample project to see the interview, quality checks, risk analysis and recovery options first.</p>
          <button onClick={trySample} disabled={creating} className="pressable mt-4 inline-flex items-center gap-1.5 rounded-full border border-warm-300 bg-white text-navy-950 hover:border-navy-900 px-4 py-2 text-[13.5px] font-medium disabled:opacity-50">
            {creating ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Sparkles size={14} aria-hidden />} Open a sample project
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-[13px] font-medium text-warm-500">Your plans</h2>
            <button onClick={trySample} disabled={creating} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-600 hover:underline disabled:opacity-50">
              <Sparkles size={13} aria-hidden /> Open a sample project
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {plans.map(p => (
              <Link key={p.id} href={`/dashboard/plan/${p.id}`} className="group card-lift block bg-white/70 border border-warm-200 rounded-2xl p-5 hover:bg-white hover:border-warm-300">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[15.5px] font-semibold text-navy-950 truncate">{p.name}</div>
                    <div className="text-[12.5px] text-warm-500 mt-0.5">Updated {fmtDay(p.updatedAt)}</div>
                  </div>
                  <ArrowRight size={15} aria-hidden className="text-warm-400 flex-shrink-0 mt-1 transition-transform duration-200 group-hover:translate-x-0.5" />
                </div>
                <div className="mt-4">
                  <div className="flex justify-between text-[12.5px] text-warm-500 mb-1.5">
                    <span>Interview questions answered</span><span className="tabular-nums font-medium text-navy-950">{p.readiness}%</span>
                  </div>
                  <div className="h-1.5 bg-warm-200 rounded-full overflow-hidden"><div className="h-full rounded-full bg-accent-500" style={{ width: `${p.readiness}%` }} /></div>
                </div>
                <div className="mt-3 text-[13px] text-warm-600">
                  {p.generated ? <>{p.activityCount} activities · finish <span className="font-medium text-navy-950 tabular-nums">{fmtDate(p.finish)}</span>{p.scheduleId ? ' · published' : ''}</> : 'Not generated yet'}
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
