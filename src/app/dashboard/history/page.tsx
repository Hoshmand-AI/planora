'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Database, Lock } from 'lucide-react'
import { PROJECT_TYPES, PROJECT_TYPE_LABELS } from '@/lib/planning/types'
import type { CategoryStats } from '@/lib/planning/history'
import type { BacktestResult } from '@/lib/planning/evaluation'

interface HistoryData {
  organization: { id: string; name: string } | null
  privacy: string
  schedules: { id: string; name: string; version: string; projectType: string | null; region: string | null; grossSqft: number | null; activityCount: number }[]
  categories: CategoryStats[]
  overallOverrunMedian: number | null
  overallOverrunP80: number | null
  backtest: BacktestResult
}

const label = (c: string) => c.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase())

export default function HistoryPage() {
  const [data, setData] = useState<HistoryData | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/history')
    const d = await res.json()
    if (!res.ok) { setError(d.error || 'Could not load firm data.'); return }
    setData(d)
  }, [])
  useEffect(() => { load() }, [load])

  const tag = async (id: string, patch: Record<string, unknown>) => {
    setSaving(id)
    const s = data!.schedules.find(x => x.id === id)!
    await fetch('/api/schedules', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, projectType: s.projectType, region: s.region, grossSqft: s.grossSqft, ...patch }) })
    await load()
    setSaving(null)
  }

  if (!data) return <div className="px-6 py-10 text-[14px] text-warm-400 flex items-center gap-2">{error || <><Loader2 size={14} className="animate-spin" /> Loading firm data…</>}</div>
  const bt = data.backtest

  return (
    <div className="px-4 md:px-6 py-6 md:py-8 space-y-5">
      <div>
        <h1 className="font-display text-[26px] md:text-[30px] text-navy-950 leading-tight">Firm data</h1>
        <p className="text-[13.5px] text-warm-500 mt-1 max-w-3xl"><Lock size={13} className="inline mr-1.5 -mt-0.5" />{data.privacy} Workspace: <span className="font-medium text-navy-950">{data.organization?.name}</span></p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Schedules" value={String(data.schedules.length)} sub="uploaded by your firm" />
        <Card label="Work categories learned" value={String(data.categories.length)} sub="with actual durations" />
        <Card label="Typical overrun" value={data.overallOverrunMedian ? `×${data.overallOverrunMedian.toFixed(2)}` : '—'} sub={data.overallOverrunP80 ? `P80 ×${data.overallOverrunP80.toFixed(2)} (actual ÷ planned)` : 'needs baselines + actuals'} />
        <Card label="Backtest error" value={bt.mape !== null ? `${bt.mape}%` : '—'} sub={bt.biasPct !== null ? `bias ${bt.biasPct > 0 ? '+' : ''}${bt.biasPct}% · ${bt.projects.length} projects` : 'needs tagged, completed projects'} />
      </div>

      <div className="bg-warm-100 border border-warm-200 rounded-lg p-5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-1">Your schedules</div>
        <p className="text-[12px] text-warm-500 mb-3">Tag each with facility type, state and area so Planora can compare like with like. A new firm with no history starts from reference templates; accuracy improves as you add completed projects.</p>
        {data.schedules.length === 0 ? (
          <p className="text-[13px] text-warm-500"><Database size={14} className="inline mr-1" />No schedules yet. Upload past P6 / MS Project / Excel schedules with actual dates.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px] min-w-[640px]">
              <thead><tr className="text-left text-[10.5px] uppercase tracking-wider text-warm-400"><th className="py-1.5">Schedule</th><th className="py-1.5">Facility type</th><th className="py-1.5">State</th><th className="py-1.5">Gross sf</th><th className="py-1.5 text-right">Activities</th></tr></thead>
              <tbody>
                {data.schedules.map(s => (
                  <tr key={s.id} className="border-t border-warm-200">
                    <td className="py-2 pr-2 text-navy-950">{s.name} <span className="text-warm-400">{s.version}</span>{saving === s.id && <Loader2 size={11} className="inline ml-1 animate-spin" />}</td>
                    <td className="py-2 pr-2">
                      <select value={s.projectType || ''} onChange={e => tag(s.id, { projectType: e.target.value || null })} className="bg-warm-50 border border-warm-300 rounded-md px-1.5 py-1 text-[12px]">
                        <option value="">—</option>{PROJECT_TYPES.map(t => <option key={t} value={t}>{PROJECT_TYPE_LABELS[t]}</option>)}
                      </select>
                    </td>
                    <td className="py-2 pr-2"><input defaultValue={s.region || ''} maxLength={2} onBlur={e => e.target.value !== (s.region || '') && tag(s.id, { region: e.target.value })} className="w-12 bg-warm-50 border border-warm-300 rounded-md px-1.5 py-1 text-[12px] uppercase" /></td>
                    <td className="py-2 pr-2"><input type="number" defaultValue={s.grossSqft ?? ''} onBlur={e => Number(e.target.value) !== (s.grossSqft ?? 0) && tag(s.id, { grossSqft: Number(e.target.value) || null })} className="w-28 bg-warm-50 border border-warm-300 rounded-md px-1.5 py-1 text-[12px]" /></td>
                    <td className="py-2 text-right tabular-nums text-warm-600">{s.activityCount.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-warm-100 border border-warm-200 rounded-lg p-5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-2">What your projects actually took</div>
          {data.categories.length === 0 ? <p className="text-[13px] text-warm-500">No activities with actual start and finish dates yet.</p> : (
            <table className="w-full text-[12.5px]">
              <thead><tr className="text-left text-[10.5px] uppercase tracking-wider text-warm-400"><th className="py-1">Work</th><th className="py-1 text-right">Projects</th><th className="py-1 text-right">P20 / median / P80 days</th><th className="py-1 text-right">Overrun</th></tr></thead>
              <tbody>
                {data.categories.map(c => (
                  <tr key={c.category} className="border-t border-warm-200">
                    <td className="py-1.5 text-navy-950">{label(c.category)}</td>
                    <td className="py-1.5 text-right tabular-nums">{c.projects}</td>
                    <td className="py-1.5 text-right tabular-nums text-warm-600">{Math.round(c.actualP20)} / {Math.round(c.actualMedian)} / {Math.round(c.actualP80)}</td>
                    <td className="py-1.5 text-right tabular-nums">{c.overrunMedian ? `×${c.overrunMedian.toFixed(2)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-[11px] text-warm-400 mt-2">Durations normalized to 100,000 sf where area is tagged. Overrun = actual ÷ planned (baseline).</p>
        </div>

        <div className="bg-warm-100 border border-warm-200 rounded-lg p-5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-2">Backtest: would Planora have predicted your real projects?</div>
          <p className="text-[12px] text-warm-500 mb-2">For each completed project, Planora rebuilds the construction schedule from its facility type and size using only your <em>other</em> projects (leave-one-out), then compares to what actually happened.</p>
          {bt.projects.length === 0 ? <p className="text-[13px] text-warm-500">Not enough tagged, completed projects yet.</p> : (
            <table className="w-full text-[12.5px]">
              <thead><tr className="text-left text-[10.5px] uppercase tracking-wider text-warm-400"><th className="py-1">Project</th><th className="py-1 text-right">Actual</th><th className="py-1 text-right">Predicted</th><th className="py-1 text-right">Error</th></tr></thead>
              <tbody>
                {bt.projects.map(p => (
                  <tr key={p.scheduleId} className="border-t border-warm-200">
                    <td className="py-1.5 text-navy-950">{p.name}</td>
                    <td className="py-1.5 text-right tabular-nums">{p.actualDays}d</td>
                    <td className="py-1.5 text-right tabular-nums">{p.predictedDays}d</td>
                    <td className={`py-1.5 text-right tabular-nums font-semibold ${Math.abs(p.errorPct) > 20 ? 'text-status-at-risk' : Math.abs(p.errorPct) > 10 ? 'text-status-attention' : 'text-status-on-track'}`}>{p.errorPct > 0 ? '+' : ''}{p.errorPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {bt.skipped.length > 0 && <div className="mt-2 space-y-0.5">{bt.skipped.slice(0, 6).map((s, i) => <p key={i} className="text-[11.5px] text-warm-400">Skipped {s.name}: {s.reason}</p>)}</div>}
        </div>
      </div>
    </div>
  )
}

function Card({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-warm-100 border border-warm-200 rounded-lg p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400">{label}</div>
      <div className="text-[20px] font-semibold text-navy-950 tabular-nums mt-1">{value}</div>
      <div className="text-[11px] text-warm-400 mt-0.5">{sub}</div>
    </div>
  )
}
