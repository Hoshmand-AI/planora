'use client'

// Organization-wide view: every plan and uploaded schedule with its alerts, most urgent first.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react'
import { useApp } from '@/app/dashboard/layout'
import { fmtDate, fmtDay } from '@/lib/format'
import type { Portfolio as PortfolioData, PortfolioRow } from '@/lib/planning/portfolio'

const STATUS: Record<PortfolioRow['status'], { label: string; cls: string }> = {
  at_risk: { label: 'At risk', cls: 'text-status-at-risk bg-status-at-risk-bg border-status-at-risk' },
  attention: { label: 'Attention', cls: 'text-status-attention bg-status-attention-bg border-status-attention' },
  on_track: { label: 'On track', cls: 'text-status-on-track bg-status-on-track-bg border-status-on-track' },
  not_started: { label: 'In interview', cls: 'text-warm-600 bg-warm-100 border-warm-300' },
  complete: { label: 'Complete', cls: 'text-status-on-track bg-status-on-track-bg border-status-on-track' },
}
// An uploaded schedule without a stored analysis has no status until it is opened.
const statusLabel = (r: PortfolioRow) => r.kind === 'schedule' && r.status === 'not_started' ? 'Not analyzed' : STATUS[r.status].label
const ICON = { error: XCircle, warning: AlertTriangle, info: Info }
const ICON_CLS = { error: 'text-status-at-risk', warning: 'text-status-attention', info: 'text-warm-500' }

export function Portfolio({ compact = false }: { compact?: boolean }) {
  const router = useRouter()
  const { schedules, setSelectedSchedule } = useApp()
  const [data, setData] = useState<PortfolioData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/portfolio').then(async r => {
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not load the portfolio.')
      setData(d)
    }).catch(e => setError(e.message))
  }, [])

  if (error) return <p role="alert" className="text-[13px] text-status-at-risk">{error}</p>
  if (!data) return <p className="text-[13px] text-warm-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading portfolio…</p>
  if (!data.rows.length) return (
    <p className="text-[13px] text-warm-500">No projects yet. <Link href="/dashboard/plan" className="text-accent-600 hover:underline">Build a schedule</Link> or upload one to see it here.</p>
  )

  const open = (r: PortfolioRow) => {
    if (r.kind === 'plan') return router.push(r.href)
    const s = schedules.find(x => x.id === r.id)
    if (s) setSelectedSchedule(s)
    router.push(r.href)
  }
  const rows = compact ? data.rows.slice(0, 5) : data.rows
  const t = data.totals

  return (
    <div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-warm-600 mb-3" aria-label="Portfolio totals">
        <span><span className="font-semibold text-navy-950 tabular-nums">{t.projects}</span> projects</span>
        <span><span className="font-semibold text-status-at-risk tabular-nums">{t.atRisk}</span> at risk</span>
        <span><span className="font-semibold text-status-attention tabular-nums">{t.attention}</span> need attention</span>
        <span><span className="font-semibold text-status-on-track tabular-nums">{t.onTrack}</span> on track</span>
        <span><span className="font-semibold text-navy-950 tabular-nums">{t.alerts}</span> open alerts</span>
      </div>
      <ul className="space-y-2">
        {rows.map(r => (
          <li key={`${r.kind}:${r.id}`} className="bg-warm-50 border border-warm-200 rounded-lg p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <button onClick={() => open(r)} className="text-[14px] font-semibold text-navy-950 hover:underline text-left">{r.name}</button>
                <div className="text-[12px] text-warm-500 mt-0.5">
                  {r.kind === 'plan' ? 'Planora plan' : r.updates && r.updates > 1 ? `Uploaded schedule · latest of ${r.updates} updates` : 'Uploaded schedule'}
                  {r.dataDate && <> · data date <span className="tabular-nums text-warm-700">{fmtDate(r.dataDate)}</span></>}
                  {r.finish && <> · finish <span className="tabular-nums text-warm-700">{fmtDate(r.finish)}</span></>}
                  {r.required && <> · required <span className="tabular-nums text-warm-700">{fmtDate(r.required)}</span></>}
                  {r.readiness != null && <> · interview {r.readiness}%</>}
                  {r.kind === 'schedule' && r.gapDays != null && <> · variance <span className="tabular-nums text-warm-700">{r.gapDays > 0 ? '+' : ''}{r.gapDays}d</span></>}
                  {' · '}updated {fmtDay(r.updatedAt)}
                </div>
              </div>
              <span className={`text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md border-l-2 whitespace-nowrap ${STATUS[r.status].cls}`}>{statusLabel(r)}</span>
            </div>
            {r.alerts.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {r.alerts.map(a => {
                  const Icon = ICON[a.severity]
                  return <li key={a.code} className="flex items-start gap-1.5 text-[12.5px] text-warm-700"><Icon size={13} aria-hidden className={`mt-0.5 flex-shrink-0 ${ICON_CLS[a.severity]}`} /><span><span className="sr-only">{a.severity}: </span>{a.text}</span></li>
                })}
              </ul>
            ) : <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-warm-600"><CheckCircle2 size={13} aria-hidden className="text-status-on-track" /> No alerts.</p>}
          </li>
        ))}
      </ul>
      {compact && data.rows.length > rows.length && <Link href="/dashboard/portfolio" className="inline-block mt-3 text-[13px] font-medium text-accent-600 hover:underline">See all {data.rows.length} projects →</Link>}
    </div>
  )
}
