'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Database, Lock } from 'lucide-react'
import { PROJECT_TYPES, PROJECT_TYPE_LABELS } from '@/lib/planning/types'
import type { CategoryStats } from '@/lib/planning/history'
import type { BacktestResult } from '@/lib/planning/evaluation'
import type { FirmSequencing } from '@/lib/logic-assist/firm-patterns'
import { useApp } from '../layout'
import { EmptyState } from '@/components/EmptyState'

interface HistoryData {
  organization: { id: string; name: string } | null
  privacy: string
  schedules: { id: string; name: string; version: string; projectType: string | null; region: string | null; grossSqft: number | null; activityCount: number; usedInHistory?: boolean; historyNote?: string | null }[]
  categories: CategoryStats[]
  overallOverrunMedian: number | null
  overallOverrunP80: number | null
  backtest: BacktestResult
  sequencing?: FirmSequencing
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const linkText = (type: string, lag: number) => `${type}${lag ? ` ${lag > 0 ? '+' : '−'}${Math.abs(lag)}d` : ''}`
const label = (c: string) => c.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase())

export default function HistoryPage() {
  const { can, openUpload } = useApp()
  const [data, setData] = useState<HistoryData | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  // Tagging a schedule changes it, so only roles that may change schedules get live controls.
  const canTag = can('schedule.write')

  const load = useCallback(async () => {
    const res = await fetch('/api/history').catch(() => null)
    const d = res ? await res.json().catch(() => ({})) : {}
    if (!res?.ok) { setError(d.error || (res ? 'Could not load firm data.' : 'Network error. Check your connection and reload the page.')); return }
    setData(d)
  }, [])
  useEffect(() => { load() }, [load])

  const tag = async (id: string, patch: Record<string, unknown>) => {
    setSaving(id)
    const s = data!.schedules.find(x => x.id === id)!
    const res = await fetch('/api/schedules', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, projectType: s.projectType, region: s.region, grossSqft: s.grossSqft, ...patch }) }).catch(() => null)
    if (!res?.ok) { const d = res ? await res.json().catch(() => ({})) : {}; setError(d.error || 'The change was not saved. Try again.') } else setError('')
    await load()
    setSaving(null)
  }

  if (!data) return <div className="px-6 py-10 text-[14px] text-warm-400 flex items-center gap-2">{error || <><Loader2 size={14} className="animate-spin" /> Loading firm data…</>}</div>
  const bt = data.backtest

  return (
    <div className="max-w-6xl mx-auto px-5 md:px-8 py-6 md:py-8 space-y-5">
      {error ? <p role="alert" className="rounded-md border border-status-at-risk bg-status-at-risk-bg px-3 py-2 text-[13px] text-status-at-risk">{error}</p> : null}
      <div>
        <h1 className="page-title">Firm insights</h1>
        <p className="text-[13.5px] text-warm-500 mt-1 max-w-3xl"><Lock size={13} className="inline mr-1.5 -mt-0.5" />{data.privacy} Workspace: <span className="font-medium text-navy-950">{data.organization?.name}</span></p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Schedules" value={String(data.schedules.length)} sub="uploaded by your firm" />
        <Card label="Work categories learned" value={String(data.categories.length)} sub="with actual durations" />
        <Card label="Typical overrun" value={data.overallOverrunMedian ? `×${data.overallOverrunMedian.toFixed(2)}` : '—'} sub={data.overallOverrunP80 ? `P80 ×${data.overallOverrunP80.toFixed(2)} (actual ÷ planned)` : 'needs baselines + actuals'} />
        <Card label="Backtest error" value={bt.mape !== null ? `${bt.mape}%` : '—'} sub={bt.biasPct !== null ? `bias ${bt.biasPct > 0 ? '+' : ''}${bt.biasPct}% · ${bt.projects.length} projects` : 'needs tagged, completed projects'} />
      </div>

      <div className="bg-warm-100 border border-warm-200 rounded-lg p-5">
        <div className="text-[12px] font-semibold uppercase tracking-wider text-warm-400 mb-1">Your schedules</div>
        <p className="text-[12px] text-warm-500 mb-3">Tag each with facility type, state and area so RunF9 can compare like with like. A new firm with no history starts from reference templates; accuracy improves as you add completed projects.</p>
        {data.schedules.length === 0 ? (
          <EmptyState inline heading="h2" title="No schedules yet" action={can('schedule.write') ? { label: 'Upload a past schedule', onClick: openUpload } : undefined}>
            <Database size={14} className="inline mr-1 -mt-0.5" aria-hidden="true" />Upload past P6 / MS Project / Excel schedules with actual dates.
          </EmptyState>
        ) : (
          <div tabIndex={0} role="region" aria-label="Past schedules" className="overflow-x-auto">
            <table className="w-full text-[12.5px] min-w-[640px]">
              <thead><tr className="text-left text-[12px] uppercase tracking-wider text-warm-400"><th className="py-1.5">Schedule</th><th className="py-1.5">Facility type</th><th className="py-1.5">State</th><th className="py-1.5">Gross sf</th><th className="py-1.5 text-right">Activities</th></tr></thead>
              <tbody>
                {data.schedules.map(s => (
                  <tr key={s.id} className="border-t border-warm-200">
                    <td className="py-2 pr-2 text-navy-950">{s.name} <span className="text-warm-500">{s.version}</span>{saving === s.id && <Loader2 size={11} className="inline ml-1 animate-spin" />}
                      <span className="block text-[12px] text-warm-600">{s.usedInHistory ? 'Used in firm history' : s.historyNote ?? 'Not used in firm history'}</span></td>
                    <td className="py-2 pr-2">
                      <select disabled={!canTag} aria-label={`Facility type for ${s.name}`} value={s.projectType || ''} onChange={e => tag(s.id, { projectType: e.target.value || null })} className="bg-warm-50 border border-warm-300 rounded-md px-1.5 py-1 text-[12px]">
                        <option value="">—</option>{PROJECT_TYPES.map(t => <option key={t} value={t}>{PROJECT_TYPE_LABELS[t]}</option>)}
                      </select>
                    </td>
                    <td className="py-2 pr-2"><input disabled={!canTag} aria-label={`State for ${s.name}`} defaultValue={s.region || ''} maxLength={2} onBlur={e => e.target.value !== (s.region || '') && tag(s.id, { region: e.target.value })} className="w-12 bg-warm-50 border border-warm-300 rounded-md px-1.5 py-1 text-[12px] uppercase" /></td>
                    <td className="py-2 pr-2"><input type="number" disabled={!canTag} aria-label={`Gross square feet for ${s.name}`} defaultValue={s.grossSqft ?? ''} onBlur={e => Number(e.target.value) !== (s.grossSqft ?? 0) && tag(s.id, { grossSqft: Number(e.target.value) || null })} className="w-28 bg-warm-50 border border-warm-300 rounded-md px-1.5 py-1 text-[12px]" /></td>
                    <td className="py-2 text-right tabular-nums text-warm-600">{s.activityCount.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data.sequencing && <SequencingCard seq={data.sequencing} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-warm-100 border border-warm-200 rounded-lg p-5">
          <div className="text-[12px] font-semibold uppercase tracking-wider text-warm-400 mb-2">What your projects actually took</div>
          {data.categories.length === 0 ? <p className="text-[13px] text-warm-500">No activities with actual start and finish dates yet.</p> : (
            <table className="w-full text-[12.5px]">
              <thead><tr className="text-left text-[12px] uppercase tracking-wider text-warm-400"><th className="py-1">Work</th><th className="py-1 text-right">Projects</th><th className="py-1 text-right">P20 / median / P80 days</th><th className="py-1 text-right">Overrun</th></tr></thead>
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
          <p className="text-[12px] text-warm-400 mt-2">Durations normalized to 100,000 sf where area is tagged. Overrun = actual ÷ planned (baseline).</p>
        </div>

        <div className="bg-warm-100 border border-warm-200 rounded-lg p-5">
          <div className="text-[12px] font-semibold uppercase tracking-wider text-warm-400 mb-2">Backtest: would RunF9 have predicted your real projects?</div>
          <p className="text-[12px] text-warm-500 mb-2">For each completed project, RunF9 rebuilds the construction schedule from its facility type and size using only your <em>other</em> projects (leave-one-out), then compares to what actually happened.</p>
          {bt.projects.length === 0 ? <p className="text-[13px] text-warm-500">Not enough tagged, completed projects yet.</p> : (
            <table className="w-full text-[12.5px]">
              <thead><tr className="text-left text-[12px] uppercase tracking-wider text-warm-400"><th className="py-1">Project</th><th className="py-1 text-right">Actual</th><th className="py-1 text-right">Predicted</th><th className="py-1 text-right">Error</th></tr></thead>
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
          {bt.skipped.length > 0 && <div className="mt-2 space-y-0.5">{bt.skipped.slice(0, 6).map((s, i) => <p key={i} className="text-[12px] text-warm-400">Skipped {s.name}: {s.reason}</p>)}</div>}
        </div>
      </div>
    </div>
  )
}

function Card({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-warm-100 border border-warm-200 rounded-lg p-4">
      <div className="text-[12px] font-semibold uppercase tracking-wider text-warm-400">{label}</div>
      <div className="text-[20px] font-semibold text-navy-950 tabular-nums mt-1">{value}</div>
      <div className="text-[12px] text-warm-400 mt-0.5">{sub}</div>
    </div>
  )
}

/** How the firm sequences work, learned from its own past schedules (the same ones firm history uses). */
function SequencingCard({ seq }: { seq: FirmSequencing }) {
  const own = seq.patterns.filter(p => !p.usual || p.type !== 'FS' || p.lag)
  return (
    <section aria-labelledby="seq-h" className="bg-warm-100 border border-warm-200 rounded-lg p-5">
      <h2 id="seq-h" className="text-[12px] font-semibold uppercase tracking-wider text-warm-600 mb-1">How your firm sequences work</h2>
      <p className="text-[12.5px] text-warm-600 mb-3 max-w-3xl">Learned from the logic of {seq.projectCount} past project{seq.projectCount === 1 ? '' : 's'}: which kinds of work your schedules tie together, and how. Logic suggestions on new schedules favour these ties and use your link type and lag.{seq.overlapShare != null ? ` ${Math.round(seq.overlapShare * 100)}% of your ties between trades overlap the work (start-to-start or finish-to-finish).` : ''}</p>
      {seq.patterns.length === 0 ? <p className="text-[13px] text-warm-600">{seq.projectCount < 2 ? 'Needs at least two past projects with logic to learn from.' : 'No tie appears in at least two of your projects yet.'}</p> : (
        <>
          {own.length > 0 && <p className="text-[12.5px] text-navy-950 mb-2"><span className="font-semibold">Your own habits</span> (differ from the general trade order): {own.slice(0, 4).map(p => `${p.fromLabel} → ${p.toLabel} ${linkText(p.type, p.lag)}`).join('; ')}.</p>}
          <div tabIndex={0} role="region" aria-label="Sequencing patterns" className="overflow-x-auto">
            <table className="w-full text-[12.5px] min-w-[520px]">
              <thead><tr className="text-left text-[12px] uppercase tracking-wider text-warm-600"><th className="py-1">From</th><th className="py-1">To</th><th className="py-1">Usually</th><th className="py-1 text-right">Projects</th></tr></thead>
              <tbody>
                {seq.patterns.slice(0, 25).map(p => (
                  <tr key={`${p.from}>${p.to}`} className="border-t border-warm-200">
                    <td className="py-1.5 text-navy-950">{cap(p.fromLabel)}</td>
                    <td className="py-1.5 text-navy-950">{cap(p.toLabel)}</td>
                    <td className="py-1.5 tabular-nums">{linkText(p.type, p.lag)}{p.typeProjects < p.projects && <span className="text-warm-600"> ({p.typeProjects} of {p.projects})</span>}{!p.usual && <span className="ml-1.5 text-[12px] font-semibold uppercase text-accent-600">your habit</span>}</td>
                    <td className="py-1.5 text-right tabular-nums">{p.projects} of {p.of}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
