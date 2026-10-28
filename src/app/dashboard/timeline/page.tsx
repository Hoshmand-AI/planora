'use client'

import { useState, useEffect, useMemo } from 'react'
import { ChevronRight, Search, X } from 'lucide-react'
import { useApp } from '../layout'
import { EmptyState } from '@/components/EmptyState'
import { fmtDate } from '@/lib/format'

interface ActivityData {
  id: string; name: string; activityId: string; duration: number; remainingDuration: number
  totalFloat: number | null; percentComplete: number; earlyStart: string | null; earlyFinish: string | null
  isCritical: boolean; status: string; activityType: string; wbs: string
  actualStart?: string | null; actualFinish?: string | null
  baselineStart?: string | null; baselineFinish?: string | null
  constraintType?: string | null; constraintDate?: string | null
}

type Progress = 'not_started' | 'in_progress' | 'complete'
type Filter = 'all' | 'critical' | 'near' | 'active'

/** Progress comes from recorded actuals only — never from planned dates relative to today. */
function progressOf(a: Pick<ActivityData, 'actualStart' | 'actualFinish'>): Progress {
  if (a.actualFinish) return 'complete'
  if (a.actualStart) return 'in_progress'
  return 'not_started'
}

// Near-critical: open work with a little float left (work days).
const NEAR_FLOAT = 10
const FILTERS: { id: Filter; label: string; test: (a: ActivityData) => boolean }[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'critical', label: 'Critical', test: a => a.isCritical && progressOf(a) !== 'complete' },
  { id: 'near', label: 'Near-critical', test: a => !a.isCritical && progressOf(a) !== 'complete' && a.totalFloat != null && a.totalFloat <= NEAR_FLOAT },
  { id: 'active', label: 'In progress', test: a => progressOf(a) === 'in_progress' },
]

const DAY = 86_400_000
const t = (iso: string) => Date.parse(iso.slice(0, 10) + 'T00:00:00Z')
const startOf = (a: ActivityData) => a.actualStart || a.earlyStart
const finishOf = (a: ActivityData) => a.actualFinish || a.earlyFinish || a.actualStart || a.earlyStart
// Rows shown per phase before "Show all"; keeps very large schedules responsive.
const PAGE = 60

export default function TimelinePage() {
  const { selectedSchedule, openUpload, can } = useApp()
  const [activities, setActivities] = useState<ActivityData[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [full, setFull] = useState<Record<string, boolean>>({})
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    setActivities(null); setSelected(null); setOpen({}); setFull({})
    if (!selectedSchedule) return
    let live = true
    fetch(`/api/schedules?id=${selectedSchedule.id}`)
      .then(r => r.json())
      .then(data => { if (live) setActivities(data.activities || []) })
      .catch(() => { if (live) setActivities([]) })
    return () => { live = false }
  }, [selectedSchedule])

  const work = useMemo(() => (activities ?? []).filter(a => a.activityType === 'task' || a.activityType === 'milestone'), [activities])

  // Timeline span across every dated activity, so filtering doesn't rescale the bars.
  const span = useMemo(() => {
    const ds = work.flatMap(a => [startOf(a), finishOf(a)]).filter((d): d is string => !!d).map(t)
    if (!ds.length) return null
    const lo = Math.min(...ds), hi = Math.max(...ds) + DAY
    // A little room on the right so the last milestone isn't clipped.
    return { lo, hi, range: Math.max((hi - lo) * 1.03, DAY) }
  }, [work])

  const counts = useMemo(() => Object.fromEntries(FILTERS.map(f => [f.id, work.filter(f.test).length])) as Record<Filter, number>, [work])

  const groups = useMemo(() => {
    const test = FILTERS.find(f => f.id === filter)!.test
    const q = query.trim().toLowerCase()
    const byWbs = new Map<string, ActivityData[]>()
    for (const a of work) {
      if (!test(a)) continue
      if (q && !a.name.toLowerCase().includes(q) && !a.activityId.toLowerCase().includes(q)) continue
      const k = a.wbs?.trim() || 'General activities'
      if (!byWbs.has(k)) byWbs.set(k, [])
      byWbs.get(k)!.push(a)
    }
    return [...byWbs.entries()].map(([name, acts]) => {
      acts.sort((x, y) => (startOf(x) || '9').localeCompare(startOf(y) || '9'))
      const starts = acts.map(startOf).filter((d): d is string => !!d).sort()
      const finishes = acts.map(finishOf).filter((d): d is string => !!d).sort()
      const total = acts.reduce((s, a) => s + a.duration, 0)
      const done = acts.reduce((s, a) => s + a.duration * (progressOf(a) === 'complete' ? 100 : a.percentComplete) / 100, 0)
      return {
        name, acts,
        start: starts[0] ?? null, finish: finishes[finishes.length - 1] ?? null,
        pct: total > 0 ? Math.round((done / total) * 100) : 0,
        critical: acts.filter(a => a.isCritical && progressOf(a) !== 'complete').length,
      }
    }).sort((x, y) => (x.start || '9').localeCompare(y.start || '9'))
  }, [work, filter, query])

  if (!selectedSchedule) {
    return (
      <EmptyState title="Upload a schedule to see the timeline" action={{ label: can('schedule.write') ? 'Upload a schedule' : 'Build a schedule', onClick: openUpload }}>
        View phases and Gantt chart from your schedule data.
      </EmptyState>
    )
  }

  const filtering = filter !== 'all' || !!query.trim()
  // Phases start open when filtering (to show the matches) or when the schedule is small; large ones start as a phase summary.
  const isOpen = (name: string) => open[name] ?? (filtering || work.length <= PAGE)
  const pos = (iso: string) => span ? ((t(iso) - span.lo) / span.range) * 100 : 0
  const dataDate = selectedSchedule.dataDate?.slice(0, 10) ?? null
  const ddLeft = dataDate && span && t(dataDate) >= span.lo && t(dataDate) <= span.hi ? pos(dataDate) : null
  const current = selected ? work.find(a => a.id === selected) ?? null : null
  const matches = groups.reduce((s, g) => s + g.acts.length, 0)

  return (
    <div className="px-4 md:px-6 py-5 md:py-6">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
          {FILTERS.map(f => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}
              className={`pressable inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-semibold border ${filter === f.id ? 'bg-navy-900 text-white border-navy-900' : 'bg-white text-navy-950 border-warm-300 hover:border-navy-900'}`}>
              {f.label} <span className={`tabular-nums font-medium ${filter === f.id ? 'text-warm-200' : 'text-warm-600'}`}>{counts[f.id] ?? 0}</span>
            </button>
          ))}
        </div>
        <label className="relative ml-auto w-full sm:w-64">
          <span className="sr-only">Find an activity</span>
          <Search size={15} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-warm-500" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find an activity"
            className="w-full rounded-full border border-warm-300 bg-white pl-9 pr-3 py-1.5 text-[13.5px] text-warm-700 placeholder:text-warm-500" />
        </label>
      </div>

      {activities === null ? (
        <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-12 rounded-xl" />)}</div>
      ) : (
        <div className="lg:flex lg:items-start lg:gap-4">
          <div className="min-w-0 flex-1 overflow-x-auto rounded-2xl border border-warm-200 bg-white">
            <div className="min-w-[720px]">
              {/* Axis */}
              <div className="flex items-center h-9 border-b border-warm-200 bg-warm-100 text-[12px] font-semibold text-warm-600">
                <div className="sticky left-0 z-10 self-stretch flex items-center bg-warm-100 w-[200px] md:w-[260px] flex-shrink-0 px-4">{filtering ? `${matches} ${matches === 1 ? 'activity' : 'activities'}` : 'Phase / activity'}</div>
                <div className="flex-1 flex justify-between pr-4 tabular-nums">
                  {span && <><span>{fmtDate(new Date(span.lo).toISOString())}</span>{dataDate && <span>Data date {fmtDate(dataDate)}</span>}<span>{fmtDate(new Date(span.hi - DAY).toISOString())}</span></>}
                </div>
              </div>

              {groups.map(g => {
                const expanded = isOpen(g.name)
                const rows = full[g.name] ? g.acts : g.acts.slice(0, PAGE)
                return (
                  <div key={g.name} className="border-b border-warm-200 last:border-0">
                    <button type="button" aria-expanded={expanded} onClick={() => setOpen(o => ({ ...o, [g.name]: !expanded }))}
                      className="group w-full flex items-center h-12 text-left hover:bg-warm-50 transition-colors">
                      <div className="sticky left-0 z-10 self-stretch bg-white group-hover:bg-warm-50 transition-colors w-[200px] md:w-[260px] flex-shrink-0 px-4 flex items-center gap-2 min-w-0">
                        <ChevronRight size={15} aria-hidden className={`disclosure-chevron flex-shrink-0 text-warm-500 ${expanded ? 'rotate-90' : ''}`} />
                        <span className="min-w-0">
                          <span className="block truncate text-[13.5px] font-semibold text-navy-950">{g.name}</span>
                          <span className="block text-[11.5px] text-warm-600">{g.acts.length} · {g.pct}% done{g.critical ? <span className="text-status-at-risk"> · {g.critical} critical</span> : null}</span>
                        </span>
                      </div>
                      <div className="flex-1 relative h-full pr-4">
                        {g.start && g.finish && span && (
                          <span className="absolute top-1/2 -translate-y-1/2 h-2.5 rounded-full bg-navy-800/20 overflow-hidden" aria-hidden="true"
                            style={{ left: `${pos(g.start)}%`, width: `${Math.max(0.6, pos(g.finish) - pos(g.start) + (DAY / span.range) * 100)}%` }}>
                            <span className="block h-full bg-navy-800" style={{ width: `${g.pct}%` }} />
                          </span>
                        )}
                        {ddLeft != null && <DataDateLine left={ddLeft} />}
                      </div>
                    </button>
                    {expanded && (
                      <div className="rise-in">
                        {rows.map(a => <ActivityRow key={a.id} a={a} pos={pos} span={span} ddLeft={ddLeft} active={selected === a.id} onSelect={() => setSelected(selected === a.id ? null : a.id)} />)}
                        {g.acts.length > rows.length && (
                          <button type="button" onClick={() => setFull(f => ({ ...f, [g.name]: true }))} className="w-full px-4 py-2 text-left text-[13px] font-semibold text-accent-600 hover:underline">
                            Show all {g.acts.length}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
              {groups.length === 0 && <p className="px-4 py-10 text-center text-[14px] text-warm-600">{filtering ? 'No activities match.' : 'No activities with dates in this schedule.'}</p>}
            </div>
          </div>

          {current && <Detail a={current} onClose={() => setSelected(null)} />}
        </div>
      )}

      <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-[12px] text-warm-600">
        <Legend className="bg-accent-500" label="Planned" />
        <Legend className="bg-status-at-risk" label="Critical" />
        <Legend className="bg-status-on-track" label="Complete" />
        <Legend className="bg-navy-800" label="Done so far" />
        {dataDate && <span className="flex items-center gap-1.5"><span className="w-0.5 h-3 bg-accent-600 inline-block" /> Data date</span>}
      </div>
    </div>
  )
}

function ActivityRow({ a, pos, span, ddLeft, active, onSelect }: {
  a: ActivityData; pos: (iso: string) => number; span: { range: number } | null; ddLeft: number | null; active: boolean; onSelect: () => void
}) {
  const s = startOf(a), f = finishOf(a)
  const prog = progressOf(a)
  const milestone = a.activityType === 'milestone' || a.duration === 0
  const color = prog === 'complete' ? 'bg-status-on-track' : a.isCritical ? 'bg-status-at-risk' : 'bg-accent-500'
  const left = s ? pos(s) : 0
  const width = s && f && span ? Math.max(0.5, pos(f) - left + (DAY / span.range) * 100) : 0
  return (
    <button type="button" onClick={onSelect} aria-pressed={active}
      className={`group w-full flex items-center h-10 text-left border-t border-warm-100 transition-colors ${active ? 'bg-accent-100' : 'hover:bg-warm-50'}`}>
      <div className={`sticky left-0 z-10 self-stretch flex flex-col justify-center transition-colors w-[200px] md:w-[260px] flex-shrink-0 pl-10 pr-3 min-w-0 ${active ? 'bg-accent-100' : 'bg-white group-hover:bg-warm-50'}`}>
        <span className="block truncate text-[13px] text-navy-950">{a.name}</span>
        <span className="block text-[11px] text-warm-600 tabular-nums">{a.activityId}{a.totalFloat != null && prog !== 'complete' ? ` · float ${a.totalFloat}d` : ''}</span>
      </div>
      <div className="flex-1 relative h-full pr-4" aria-hidden="true">
        {s && (milestone
          ? <span className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 ${color}`} style={{ left: `${left}%` }} />
          : <span className={`absolute top-1/2 -translate-y-1/2 h-3 rounded-full overflow-hidden ${color}`} style={{ left: `${left}%`, width: `${width}%` }}>
              {prog === 'in_progress' && a.percentComplete > 0 && <span className="block h-full bg-navy-800" style={{ width: `${a.percentComplete}%` }} />}
            </span>)}
        {ddLeft != null && <DataDateLine left={ddLeft} />}
      </div>
    </button>
  )
}

function DataDateLine({ left }: { left: number }) {
  return <span aria-hidden="true" className="absolute inset-y-0 w-0.5 bg-accent-600/70" style={{ left: `${left}%` }} />
}

function Legend({ className, label }: { className: string; label: string }) {
  return <span className="flex items-center gap-1.5"><span className={`w-3 h-2 rounded-sm inline-block ${className}`} /> {label}</span>
}

/** The selected activity: dates, float and progress. A side panel on wide screens, a sheet on phones. */
function Detail({ a, onClose }: { a: ActivityData; onClose: () => void }) {
  const prog = progressOf(a)
  const rows: [string, string][] = [
    ['Status', prog === 'complete' ? 'Complete' : prog === 'in_progress' ? `In progress · ${a.percentComplete}%` : 'Not started'],
    ['Start', `${fmtDate(startOf(a))}${a.actualStart ? ' (actual)' : ''}`],
    ['Finish', `${fmtDate(finishOf(a))}${a.actualFinish ? ' (actual)' : ''}`],
    ['Duration', `${a.duration} work days${prog === 'in_progress' ? ` · ${a.remainingDuration} left` : ''}`],
    ['Total float', a.totalFloat == null ? '—' : `${a.totalFloat} work days`],
  ]
  if (a.baselineFinish) rows.push(['Baseline finish', fmtDate(a.baselineFinish)])
  if (a.constraintType) rows.push(['Constraint', `${a.constraintType}${a.constraintDate ? ` ${fmtDate(a.constraintDate)}` : ''}`])
  return (
    <aside aria-label={`Activity ${a.activityId}`}
      className="rise-in fixed inset-x-0 bottom-0 z-40 max-h-[70vh] overflow-y-auto rounded-t-3xl border-t border-warm-200 bg-white p-5 shadow-[0_-16px_40px_-20px_rgba(6,20,27,0.35)] lg:static lg:z-auto lg:max-h-none lg:w-[320px] lg:flex-shrink-0 lg:rounded-2xl lg:border lg:shadow-none lg:sticky lg:top-4 mb-16 md:mb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-warm-600 tabular-nums">{a.activityId}{a.wbs ? ` · ${a.wbs}` : ''}</div>
          <h2 className="text-[17px] font-semibold text-navy-950 leading-snug mt-0.5">{a.name}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close activity details" className="flex-shrink-0 text-warm-500 hover:text-navy-950"><X size={18} /></button>
      </div>
      {a.isCritical && prog !== 'complete' && (
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-status-at-risk-bg px-2.5 py-1 text-[12px] font-semibold text-status-at-risk">On the critical path</p>
      )}
      <dl className="mt-3 divide-y divide-warm-200">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 py-2 text-[13px]">
            <dt className="text-warm-600">{k}</dt>
            <dd className="font-medium text-navy-950 tabular-nums text-right">{v}</dd>
          </div>
        ))}
      </dl>
    </aside>
  )
}
