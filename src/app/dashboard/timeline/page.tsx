'use client'

import { useState, useEffect, useMemo } from 'react'
import { ChevronRight, Minus, Plus, Search, X } from 'lucide-react'
import { useApp } from '../layout'
import { EmptyState } from '@/components/EmptyState'
import { fmtDate, fmtDates } from '@/lib/format'
import { axisTicks } from '@/lib/timeline-axis'

interface Impact { windowDays: number; changed: { id: string; code: string; name: string; what: string; before: string; after: string }[]; moved: { id: string; finishDays: number; startDays: number }[]; movedCount: number; finishMovedDays: number | null }

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
// Explicit zoom steps (chart width relative to the panel). Zoom only widens the chart; the time span stays the same.
const ZOOMS = [1, 1.5, 2, 3, 4]

export default function TimelinePage() {
  const { selectedSchedule, openUpload, can } = useApp()
  const [activities, setActivities] = useState<ActivityData[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [full, setFull] = useState<Record<string, boolean>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    setActivities(null); setSelected(null); setOpen({}); setFull({}); setLoadError(false)
    if (!selectedSchedule) return
    let live = true
    fetch(`/api/schedules?id=${selectedSchedule.id}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('load'))))
      .then(data => { if (live) setActivities(data.activities || []) })
      // A failed load is not an empty schedule: say so instead of "No activities".
      .catch(() => { if (live) { setActivities([]); setLoadError(true) } })
    return () => { live = false }
  }, [selectedSchedule])

  // Recent changes made in RunF9 and what they moved: highlighted for 7 days so they are easy to follow.
  const [impact, setImpact] = useState<Impact | null>(null)
  const [onlyChanged, setOnlyChanged] = useState(false)
  useEffect(() => {
    setImpact(null); setOnlyChanged(false)
    if (!selectedSchedule) return
    let live = true
    fetch(`/api/schedules/${selectedSchedule.id}/changes`).then(r => (r.ok ? r.json() : null)).then(d => { if (live) setImpact(d) }).catch(() => {})
    return () => { live = false }
  }, [selectedSchedule])
  const marks = useMemo(() => {
    const m = new Map<string, { changed?: boolean; days?: number }>()
    for (const c of impact?.changed ?? []) m.set(c.id, { changed: true })
    for (const x of impact?.moved ?? []) m.set(x.id, { ...m.get(x.id), days: x.finishDays || x.startDays })
    return m
  }, [impact])

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
      if (onlyChanged && !marks.has(a.id)) continue
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
  }, [work, filter, query, onlyChanged, marks])

  if (!selectedSchedule) {
    return (
      <EmptyState title="Upload a schedule to see the timeline" action={{ label: can('schedule.write') ? 'Upload a schedule' : 'Build a schedule', onClick: openUpload }}>
        View phases and Gantt chart from your schedule data.
      </EmptyState>
    )
  }

  const filtering = filter !== 'all' || !!query.trim() || onlyChanged
  // Phases start open when filtering (to show the matches) or when the schedule is small; large ones start as a phase summary.
  const isOpen = (name: string) => open[name] ?? (filtering || work.length <= PAGE)
  const pos = (iso: string) => span ? ((t(iso) - span.lo) / span.range) * 100 : 0
  const dataDate = selectedSchedule.dataDate?.slice(0, 10) ?? null
  const ddLeft = dataDate && span && t(dataDate) >= span.lo && t(dataDate) <= span.hi ? pos(dataDate) : null
  const current = selected ? work.find(a => a.id === selected) ?? null : null
  const ruler = (() => {
    if (!span) return []
    const ticks = axisTicks(span.lo, span.lo + span.range, zoom).ticks.filter(x => x.t < span.lo + span.range)
    // Drop the leading partial-period label when the first boundary is too close for both to fit.
    const firstBoundary = ticks.find(x => !x.lead)
    return ticks[0]?.lead && firstBoundary && ((firstBoundary.t - span.lo) / span.range) * zoom < 0.08 ? ticks.slice(1) : ticks
  })()
  const zi = ZOOMS.indexOf(zoom)
  const matches = groups.reduce((s, g) => s + g.acts.length, 0)

  return (
    <div className="px-5 md:px-8 py-5 md:py-6">
      {impact && impact.changed.length > 0 && (
        <div role="status" className="mb-4 rounded-[14px] border border-accent-500 bg-accent-100 px-4 py-3 text-[13.5px] text-warm-700">
          <p><strong className="text-navy-950">{impact.changed.length} {impact.changed.length === 1 ? 'activity was' : 'activities were'} changed in RunF9 in the last {impact.windowDays} days.</strong>{' '}
            {impact.movedCount > 0 ? `${impact.movedCount} open ${impact.movedCount === 1 ? 'activity moves' : 'activities move'} because of it` : 'No other activity moves because of it'}
            {impact.finishMovedDays ? `, and the finish is ${Math.abs(impact.finishMovedDays)} day${Math.abs(impact.finishMovedDays) === 1 ? '' : 's'} ${impact.finishMovedDays > 0 ? 'later' : 'earlier'}` : impact.finishMovedDays === 0 ? ', and the finish does not move' : ''}.
            {' '}{impact.changed.length + impact.movedCount === 1 ? 'It is marked below until the change is' : 'They are marked below until the changes are'} {impact.windowDays} days old. The bars show the schedule as submitted; a mark such as +5d is the move with the edits.</p>
          <ul className="mt-1.5 space-y-0.5 text-[12.5px]">{impact.changed.slice(0, 4).map(c => <li key={c.id}>{fmtDates(c.what)}: {fmtDates(c.before)} → {fmtDates(c.after)}</li>)}</ul>
          <button type="button" aria-pressed={onlyChanged} onClick={() => setOnlyChanged(v => !v)} className="mt-2 pressable rounded-full border border-navy-900 bg-white px-3 py-1 text-[12.5px] font-semibold text-navy-950">{onlyChanged ? 'Show all activities' : 'Show only changed and moved'}</button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div role="group" aria-label="Show" className="flex gap-1.5 max-md:w-full max-md:overflow-x-auto max-md:whitespace-nowrap [&>button]:flex-shrink-0 md:flex-wrap max-md:[mask-image:linear-gradient(to_right,#000_calc(100%-32px),transparent)]">
          {FILTERS.map(f => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}
              className={`pressable inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-semibold border ${filter === f.id ? 'bg-navy-900 text-white border-navy-900' : 'bg-white text-navy-950 border-warm-300 hover:border-navy-900'}`}>
              {f.label} <span className={`tabular-nums font-medium ${filter === f.id ? 'text-warm-200' : 'text-warm-600'}`}>{counts[f.id] ?? 0}</span>
            </button>
          ))}
        </div>
        <div role="group" aria-label="Zoom the timeline" className="ml-auto hidden md:flex items-center rounded-full border border-warm-300 bg-white">
          <button type="button" onClick={() => setZoom(ZOOMS[zi - 1])} disabled={zi <= 0} aria-label="Zoom out"
            className="pressable grid place-items-center w-9 h-9 rounded-l-full text-navy-950 hover:bg-warm-100 disabled:text-warm-300 disabled:hover:bg-transparent"><Minus size={15} aria-hidden /></button>
          <button type="button" onClick={() => setZoom(1)} disabled={zoom === 1} title="Fit the whole schedule"
            className="px-2 h-9 text-[12.5px] font-semibold tabular-nums text-warm-700 hover:text-navy-950 disabled:hover:text-warm-700 border-x border-warm-200">{zoom === 1 ? <><span className="sr-only">Whole schedule shown, zoom </span>1×</> : <><span className="sr-only">Zoomed {zoom}×. </span>Fit</>}</button>
          <button type="button" onClick={() => setZoom(ZOOMS[zi + 1])} disabled={zi >= ZOOMS.length - 1} aria-label="Zoom in"
            className="pressable grid place-items-center w-9 h-9 rounded-r-full text-navy-950 hover:bg-warm-100 disabled:text-warm-300 disabled:hover:bg-transparent"><Plus size={15} aria-hidden /></button>
        </div>
        <label className="relative w-full sm:w-64">
          <span className="sr-only">Find an activity</span>
          <Search size={15} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-warm-500" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find an activity"
            className="w-full rounded-full border border-warm-300 bg-white pl-9 pr-3 py-1.5 text-[13.5px] text-warm-700 placeholder:text-warm-500" />
        </label>
      </div>

      {/* The key sits above the chart, where it is read before the bars, not below a long scroll. */}
      <div className="flex flex-wrap gap-x-5 gap-y-1 -mt-1 mb-3 text-[12.5px] text-warm-700">
        <Legend className="bg-accent-500" label="Planned" />
        <Legend className="bg-status-at-risk" label="Critical" />
        <Legend className="bg-status-on-track" label="Complete" />
        {/* The chart-only entries are dropped on a phone, where the schedule is a list. */}
        <span className="hidden md:contents">
        <Legend className="bg-navy-800" label="Done so far" />
        {activities?.some(a => a.baselineStart && a.baselineFinish) && <span className="flex items-center gap-1.5"><span className="w-3 h-[3px] rounded-full bg-warm-400 inline-block" /> Baseline</span>}
        {dataDate && <span className="flex items-center gap-1.5"><span className="w-0.5 h-3 bg-accent-600 inline-block" /> Data date</span>}
        </span>
      </div>

      {activities === null ? (
        <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-12 rounded-xl" />)}</div>
      ) : loadError ? (
        <p role="alert" className="rounded-md border border-status-at-risk bg-status-at-risk-bg px-3 py-2 text-[13.5px] text-status-at-risk">The schedule could not be loaded. Check your connection and reload the page.</p>
      ) : (
        <div className="lg:flex lg:items-start lg:gap-4">
          <div className="min-w-0 flex-1 overflow-x-auto rounded-2xl border border-warm-200 bg-white">
            <div className="md:min-w-[720px]" style={zoom > 1 ? { width: `${zoom * 100}%` } : undefined}>
              {/* Time ruler: calendar-aligned periods, then the data date */}
              <div className="flex h-14 border-b border-warm-200 bg-warm-100 text-[12px] font-semibold text-warm-600">
                <div className="sticky left-0 z-10 self-stretch flex items-center gap-2 bg-warm-100 max-md:flex-1 md:w-[260px] xl:w-[620px] flex-shrink-0 px-4"><span className="hidden xl:block flex-shrink-0 w-[64px]">ID</span><span className="flex-1 min-w-0">{filtering ? `${matches} ${matches === 1 ? 'activity' : 'activities'}` : 'Phase / activity'}</span><span className="hidden xl:block flex-shrink-0 tabular-nums text-[12.5px] w-[88px]">Start</span><span className="hidden xl:block flex-shrink-0 tabular-nums text-[12.5px] w-[88px]">Finish</span><span className="hidden xl:block flex-shrink-0 tabular-nums text-[12.5px] w-[60px] text-right">Float</span></div>
                <div className="max-md:hidden flex-1 relative tabular-nums">
                  {span && ruler.map((x, i) => (
                    <span key={x.t} className={`absolute top-2 pl-1.5 whitespace-nowrap leading-4 ${x.lead ? '' : 'border-l border-warm-300'}`} style={{ left: `${pos(new Date(x.t).toISOString())}%` }}>{/^Q\d \d{4}$/.test(x.label) ? (i > 0 && !x.label.startsWith('Q1') ? x.label.slice(0, 2) : x.label.replace(/ 20(\d\d)$/, ' ’$1')) : x.label}</span>
                  ))}
                  {ddLeft != null && dataDate && (
                    <span className="absolute bottom-1.5 whitespace-nowrap rounded-full bg-accent-600 px-2 py-px text-[12px] font-semibold text-white"
                      style={{ left: `${ddLeft}%`, transform: `translateX(${ddLeft > 85 ? '-100%' : ddLeft < 12 ? '0' : '-50%'})` }}>Data date {fmtDate(dataDate)}</span>
                  )}
                </div>
              </div>

              <div className="relative">
              {/* Period gridlines and the data date, drawn once behind the bars */}
              <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 max-md:hidden md:left-[260px] xl:left-[620px] right-0">
                {span && ruler.filter(x => !x.lead).map(x => <span key={x.t} className="absolute inset-y-0 w-px bg-warm-200/70" style={{ left: `${pos(new Date(x.t).toISOString())}%` }} />)}
                {ddLeft != null && <DataDateLine left={ddLeft} />}
              </div>

              {groups.map(g => {
                const expanded = isOpen(g.name)
                const rows = full[g.name] ? g.acts : g.acts.slice(0, PAGE)
                return (
                  <div key={g.name} className="border-b border-warm-200 last:border-0">
                    <button type="button" aria-expanded={expanded} onClick={() => setOpen(o => ({ ...o, [g.name]: !expanded }))}
                      className="group w-full flex items-center h-12 text-left hover:bg-warm-50 transition-colors focus-visible:outline-offset-[-2px]">
                      <div className="sticky left-0 z-10 self-stretch bg-white group-hover:bg-warm-50 transition-colors max-md:flex-1 md:w-[260px] xl:w-[620px] flex-shrink-0 px-4 flex items-center gap-2 min-w-0">
                        <ChevronRight size={15} aria-hidden className={`disclosure-chevron flex-shrink-0 text-warm-500 ${expanded ? 'rotate-90' : ''}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-semibold text-navy-950">{g.name}</span>
                          <span className="block truncate text-[12px] text-warm-600">{g.acts.length} · {g.pct}% done{g.critical ? <span className="text-status-at-risk"> · {g.critical} critical</span> : null}</span>
                        </span>
                        <span className="hidden xl:block flex-shrink-0 tabular-nums text-[12.5px] w-[88px] font-semibold text-navy-950">{g.start ? fmtDate(g.start) : ''}</span>
                        <span className="hidden xl:block flex-shrink-0 tabular-nums text-[12.5px] w-[88px] font-semibold text-navy-950">{g.finish ? fmtDate(g.finish) : ''}</span>
                        <span className="hidden xl:block flex-shrink-0 w-[60px]" />
                      </div>
                      <div className="max-md:hidden flex-1 relative h-full pr-4">
                        {g.start && g.finish && span && (
                          <span className="absolute top-1/2 -translate-y-1/2 h-2.5 rounded-full bg-navy-800/20 overflow-hidden" aria-hidden="true"
                            style={{ left: `${pos(g.start)}%`, width: `${Math.max(0.6, pos(g.finish) - pos(g.start) + (DAY / span.range) * 100)}%` }}>
                            <span className="block h-full bg-navy-800" style={{ width: `${g.pct}%` }} />
                          </span>
                        )}
                      </div>
                    </button>
                    {expanded && (
                      <div className="rise-in">
                        {rows.map(a => <ActivityRow key={a.id} a={a} mark={marks.get(a.id)} pos={pos} span={span} active={selected === a.id} onSelect={() => setSelected(selected === a.id ? null : a.id)} />)}
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
              {groups.length === 0 && <p className="sticky left-0 w-screen max-w-full px-4 py-10 text-center text-[14px] text-warm-600">{filtering ? 'No activities match.' : 'No activities with dates in this schedule.'}</p>}
              </div>
            </div>
          </div>

          {current && <Detail a={current} onClose={() => setSelected(null)} />}
        </div>
      )}
    </div>
  )
}

function ActivityRow({ a, mark, pos, span, active, onSelect }: {
  a: ActivityData; mark?: { changed?: boolean; days?: number }; pos: (iso: string) => number; span: { range: number } | null; active: boolean; onSelect: () => void
}) {
  const s = startOf(a), f = finishOf(a)
  const prog = progressOf(a)
  const milestone = a.activityType === 'milestone' || a.duration === 0
  const color = prog === 'complete' ? 'bg-status-on-track' : a.isCritical ? 'bg-status-at-risk' : 'bg-accent-500'
  const left = s ? pos(s) : 0
  const width = s && f && span ? Math.max(0.5, pos(f) - left + (DAY / span.range) * 100) : 0
  return (
    <button type="button" onClick={onSelect} aria-pressed={active}
      className={`group w-full flex items-center h-[48px] md:h-[42px] xl:h-[32px] text-left focus-visible:outline-offset-[-2px] border-t border-warm-100 transition-colors ${active ? 'bg-accent-100' : 'hover:bg-warm-50'}`}>
      <div className={`sticky left-0 z-10 self-stretch flex items-center gap-2 transition-colors max-md:flex-1 md:w-[260px] xl:w-[620px] flex-shrink-0 pl-4 md:pl-10 xl:pl-4 pr-4 min-w-0 ${active ? 'bg-accent-100' : 'bg-white group-hover:bg-warm-50'}`}>
        <span className="hidden xl:block flex-shrink-0 w-[64px] tabular-nums text-[12.5px] text-warm-600">{a.activityId}</span>
        <span className="flex-1 min-w-0">
        <span className="block truncate text-[13px] text-navy-950">{mark && <span className="mr-1.5 inline-block rounded bg-accent-600 px-1 py-px align-[1px] text-[12px] font-bold uppercase tracking-wide text-white">{mark.changed ? 'Changed' : `${mark.days! > 0 ? '+' : ''}${mark.days}d`}</span>}{a.name}</span>
        <span className="block xl:hidden text-[12px] text-warm-600 tabular-nums truncate"><span aria-hidden="true" className={`md:hidden inline-block w-2 h-2 rounded-full mr-1.5 ${color}`} />{a.activityId}<span className="md:hidden">{s ? ` · ${fmtDate(s)}${f && !milestone ? ` to ${fmtDate(f)}` : ''}` : ''}</span>{a.totalFloat != null && prog !== 'complete' ? <span className={`xl:hidden ${a.totalFloat < 0 ? 'max-md:text-status-at-risk max-md:font-semibold' : ''}`}>{` · float ${a.totalFloat}d`}</span> : null}</span>
        {/* The bar's meaning in words, so its length and color are not the only signal */}
        <span className="sr-only">{`, ${s ? `${milestone ? 'on' : 'from'} ${fmtDate(s)}` : 'no dates'}${s && f && !milestone ? ` to ${fmtDate(f)}` : ''}${prog === 'complete' ? ', complete' : a.isCritical ? ', critical' : ''}`}</span>
        </span>
        {/* On wide screens the dates and float are columns, as in P6, so they are read without opening the activity. */}
        <span aria-hidden="true" className="hidden xl:block flex-shrink-0 tabular-nums text-[12.5px] w-[88px] text-warm-700">{s ? fmtDate(s) : ''}</span>
        <span aria-hidden="true" className="hidden xl:block flex-shrink-0 tabular-nums text-[12.5px] w-[88px] text-warm-700">{f ? fmtDate(f) : ''}</span>
        <span aria-hidden="true" className={`hidden xl:block flex-shrink-0 tabular-nums text-[12.5px] w-[60px] text-right ${a.totalFloat != null && a.totalFloat < 0 && prog !== 'complete' ? 'font-semibold text-status-at-risk' : 'text-warm-700'}`}>{a.totalFloat != null && prog !== 'complete' ? `${a.totalFloat}d` : ''}</span>
      </div>
      <div className="max-md:hidden flex-1 relative h-full pr-4" aria-hidden="true">
        {!milestone && a.baselineStart && a.baselineFinish && span && (
          <span className="absolute bottom-[7px] h-[3px] rounded-full bg-warm-400" style={{ left: `${pos(a.baselineStart)}%`, width: `${Math.max(0.5, pos(a.baselineFinish) - pos(a.baselineStart) + (DAY / span.range) * 100)}%` }} />
        )}
        {s && (milestone
          ? <span className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 ${color}`} style={{ left: `${left}%` }} />
          : <span className={`absolute top-1/2 -translate-y-1/2 h-3 rounded-full overflow-hidden ${color}`} style={{ left: `${left}%`, width: `${width}%` }}>
              {prog === 'in_progress' && a.percentComplete > 0 && <span className="block h-full bg-navy-800" style={{ width: `${a.percentComplete}%` }} />}
            </span>)}
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
