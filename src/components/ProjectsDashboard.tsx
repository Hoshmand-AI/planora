'use client'

// Home: every project of the organization on one calm screen, and the user decides which to open.
// One entry per project: an upload series (baseline + status updates of the same project) is one
// card showing its latest update; plans built in RunF9 sit alongside with a quiet "Built in RunF9"
// label. Five facts per card at most. The summary strip doubles as filters; search, sort, the
// card/table view and pinned projects are remembered in this browser.
// Research behind the choices: docs/strategy/HOME-DASHBOARD-RESEARCH.md.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Search, Star, LayoutGrid, Rows3, Plus, Cloud, ArrowUpDown, ArrowUp, ArrowDown, X } from 'lucide-react'
import { useApp } from '@/app/dashboard/layout'
import { fmtDate, fmtDay } from '@/lib/format'
import type { Portfolio as PortfolioData, PortfolioRow } from '@/lib/planning/portfolio'
import { EmptyState } from '@/components/EmptyState'

type Filter = 'all' | 'at_risk' | 'attention' | 'stale' | 'on_track'
type Sort = 'attention' | 'recent' | 'finish' | 'name'
type View = 'cards' | 'table'
type Col = 'name' | 'status' | 'finish' | 'variance' | 'dataDate' | 'start' | 'progress' | 'uploads'

const STATUS: Record<PortfolioRow['status'], { label: string; cls: string; dot: string }> = {
  at_risk: { label: 'At risk', cls: 'text-status-at-risk bg-status-at-risk-bg', dot: 'bg-status-at-risk' },
  attention: { label: 'Needs attention', cls: 'text-status-attention bg-status-attention-bg', dot: 'bg-status-attention' },
  on_track: { label: 'On track', cls: 'text-status-on-track bg-status-on-track-bg', dot: 'bg-status-on-track' },
  no_baseline: { label: 'No baseline yet', cls: 'text-warm-700 bg-warm-100', dot: 'bg-warm-400' },
  not_started: { label: 'Draft', cls: 'text-warm-700 bg-warm-100', dot: 'bg-warm-400' },
  complete: { label: 'Complete', cls: 'text-status-on-track bg-status-on-track-bg', dot: 'bg-status-on-track' },
}
const statusOf = (r: PortfolioRow) => r.kind === 'schedule' && r.status === 'not_started' ? { ...STATUS.not_started, label: 'Not analyzed' } : STATUS[r.status]
const SEVERITY = { error: 0, warning: 1, info: 2 } as const
/** The one reason that matters most (errors, then warnings), for projects that need someone */
const reason = (r: PortfolioRow) => [...r.alerts].filter(a => a.severity !== 'info').sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity])[0]?.text ?? null
const isStale = (r: PortfolioRow) => r.alerts.some(a => a.code === 'stale_status' || a.code === 'stale')
const RANK: Record<PortfolioRow['status'], number> = { at_risk: 0, attention: 1, on_track: 3, no_baseline: 4, not_started: 5, complete: 6 }
const attentionRank = (r: PortfolioRow) => r.status === 'at_risk' ? 0 : r.status === 'attention' ? 1 : isStale(r) ? 2 : RANK[r.status]
const needsYou = (r: PortfolioRow) => r.status === 'at_risk' || r.status === 'attention' || isStale(r)
const key = (r: PortfolioRow) => `${r.kind}:${r.id}`
const time = (v: string | null | undefined) => (v ? Date.parse(v) || 0 : 0)

/** "12 days late" / "3 days early" / "On time" against the baseline or required finish. */
function variance(r: PortfolioRow): { text: string; cls: string } | null {
  if (r.gapDays == null) return null
  const d = r.gapDays
  if (d === 0) return { text: 'On time', cls: 'text-status-on-track' }
  const n = Math.abs(d)
  return d > 0 ? { text: `${n} ${n === 1 ? 'day' : 'days'} late`, cls: d > 14 ? 'text-status-at-risk' : 'text-status-attention' }
    : { text: `${n} ${n === 1 ? 'day' : 'days'} early`, cls: 'text-status-on-track' }
}
const sourceLine = (r: PortfolioRow) => r.source === 'built'
  ? `Built in RunF9${r.readiness != null && r.status === 'not_started' ? ` · interview ${r.readiness}%` : ''}`
  : r.updates && r.updates > 1 ? `${r.updates} uploads · latest: ${r.version ?? 'update'}` : (r.version ?? 'Uploaded')

/** Remembered per browser (never required: the page works without storage). */
function useStored<T>(name: string, initial: T): [T, (v: T) => void, boolean] {
  const [v, setV] = useState<T>(initial)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    try { const s = localStorage.getItem(`runf9.home.${name}`); if (s != null) setV(JSON.parse(s)) } catch { /* storage unavailable */ }
    setLoaded(true)
  }, [name])
  const set = (x: T) => { setV(x); try { localStorage.setItem(`runf9.home.${name}`, JSON.stringify(x)) } catch { /* storage unavailable */ } }
  return [v, set, loaded]
}

export function ProjectsDashboard() {
  const router = useRouter()
  const { user, schedules, setSelectedSchedule, openUpload, can, org } = useApp()
  const [data, setData] = useState<PortfolioData | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useStored<Sort>('sort', 'attention')
  const [viewPref, setView, viewLoaded] = useStored<View | null>('view', null)
  const [pins, setPins] = useStored<string[]>('pins', [])
  const [col, setCol] = useState<{ c: Col; dir: 1 | -1 } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const sync = () => setNarrow(mq.matches)
    sync(); mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    fetch('/api/portfolio').then(async r => {
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not load your projects.')
      setData(d)
    }).catch(e => setError(e.message))
  }, [])

  // "/" focuses search, like most project tools
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      e.preventDefault(); searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const rows = useMemo(() => data?.rows ?? [], [data])
  const counts = useMemo(() => ({
    all: rows.length,
    at_risk: rows.filter(r => r.status === 'at_risk').length,
    attention: rows.filter(r => r.status === 'attention').length,
    stale: rows.filter(isStale).length,
    on_track: rows.filter(r => r.status === 'on_track' || r.status === 'complete').length,
  }), [rows])

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const list = rows.filter(r =>
      (filter === 'all' || (filter === 'stale' ? isStale(r) : filter === 'on_track' ? r.status === 'on_track' || r.status === 'complete' : r.status === filter))
      && words.every(w => `${r.title} ${r.version ?? ''} ${r.source === 'built' ? 'built in runf9' : 'uploaded'}`.toLowerCase().includes(w)))
    const pinned = (r: PortfolioRow) => (pins.includes(key(r)) ? 0 : 1)
    const by: Record<Sort, (a: PortfolioRow, b: PortfolioRow) => number> = {
      attention: (a, b) => attentionRank(a) - attentionRank(b) || (b.gapDays ?? -1e9) - (a.gapDays ?? -1e9) || time(b.updatedAt) - time(a.updatedAt),
      recent: (a, b) => time(b.updatedAt) - time(a.updatedAt),
      finish: (a, b) => (time(a.finish) || Infinity) - (time(b.finish) || Infinity),
      name: (a, b) => a.title.localeCompare(b.title),
    }
    const colBy: Record<Col, (r: PortfolioRow) => number | string> = {
      name: r => r.title.toLowerCase(), status: attentionRank, finish: r => time(r.finish) || Infinity, variance: r => r.gapDays ?? -Infinity,
      dataDate: r => time(r.dataDate), start: r => time(r.start) || Infinity, progress: r => r.percentComplete ?? -1, uploads: r => r.updates ?? 1,
    }
    return [...list].sort((a, b) => {
      if (col) { const x = colBy[col.c](a), y = colBy[col.c](b); return (x < y ? -1 : x > y ? 1 : 0) * col.dir }
      return pinned(a) - pinned(b) || by[sort](a, b)
    })
  }, [rows, q, filter, sort, pins, col])

  // Phones always get cards: a 9-column table can't be read on a narrow screen
  const view: View = narrow ? 'cards' : viewPref ?? (rows.length > 12 ? 'table' : 'cards')
  const open = (r: PortfolioRow) => {
    if (r.kind === 'schedule') { const s = schedules.find(x => x.id === r.id); if (s) setSelectedSchedule(s) }
    router.push(r.href)
  }
  const togglePin = (r: PortfolioRow) => setPins(pins.includes(key(r)) ? pins.filter(k => k !== key(r)) : [...pins, key(r)])
  const first = (user?.name || '').trim().split(/\s+/)[0]

  if (error) return <div className="px-5 md:px-6 py-8"><p role="alert" className="text-[14px] text-status-at-risk">{error}</p></div>

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-[13px] font-medium text-warm-600">{first ? `Hi ${first}` : 'Welcome'}</p>
        <h1 className="text-[30px] md:text-[34px] font-semibold tracking-[-0.03em] text-navy-950 leading-tight">Projects</h1>
        {org?.dataLocation && (
          <Link href="/dashboard/org#data-location" className="mt-1.5 inline-flex items-center gap-1.5 text-[13px] text-warm-600 hover:text-navy-950">
            <Cloud size={14} aria-hidden /> Data stored in <span className="font-semibold text-navy-950">{org.dataLocation.label}</span>
            <span className="text-accent-600 font-medium">· Other clouds</span>
          </Link>
        )}
      </div>
      <Link href="/dashboard/plan" className="pressable inline-flex items-center gap-1.5 rounded-full bg-accent-600 hover:bg-accent-700 text-white px-4 py-2 text-[13.5px] font-semibold shadow-sm">
        <Plus size={15} aria-hidden /> New project
      </Link>
    </div>
  )

  if (!data) return (
    <div className="px-5 md:px-6 py-6 md:py-8 space-y-6" aria-busy="true">
      {header}
      <p className="sr-only" role="status">Loading your projects…</p>
      <div className="grid gap-3 grid-cols-2 md:grid-cols-5">{Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton h-[74px] rounded-2xl" />)}</div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <div key={i} className="skeleton h-[188px] rounded-[22px]" />)}</div>
    </div>
  )

  if (!rows.length) return (
    <div className="px-5 md:px-6 py-6 md:py-8 space-y-6">
      {header}
      <EmptyState heading="h2" title="Add your first project" action={{ label: 'Build with the interview', href: '/dashboard/plan' }}
        secondary={can('schedule.write') ? { label: 'Or upload a P6 or MS Project schedule', onClick: openUpload } : undefined}>
        Every project you upload or build shows up here, with its status and forecast finish.
      </EmptyState>
    </div>
  )

  const FILTERS: { id: Filter; label: string; tone: string }[] = [
    { id: 'all', label: 'All projects', tone: 'text-navy-950' },
    { id: 'at_risk', label: 'At risk', tone: 'text-status-at-risk' },
    { id: 'attention', label: 'Needs attention', tone: 'text-status-attention' },
    { id: 'stale', label: 'Needs an update', tone: 'text-status-attention' },
    { id: 'on_track', label: 'On track', tone: 'text-status-on-track' },
  ]
  const grouped = view === 'cards' && filter === 'all' && !q && sort === 'attention' && !col
  const urgent = grouped ? shown.filter(r => needsYou(r) && !pins.includes(key(r))) : []
  const pinned = grouped ? shown.filter(r => pins.includes(key(r))) : []
  const rest = grouped ? shown.filter(r => !needsYou(r) && !pins.includes(key(r))) : shown

  return (
    <div className="px-5 md:px-6 py-6 md:py-8 space-y-6">
      {header}

      {/* Summary strip: each number is a filter */}
      <div role="group" aria-label="Filter projects by status" className="flex gap-2 overflow-x-auto -mx-5 px-5 pb-1 md:mx-0 md:px-0 md:pb-0 md:grid md:gap-2.5 md:grid-cols-5">
        {FILTERS.map(f => {
          const on = filter === f.id
          const n = counts[f.id]
          return (
            <button key={f.id} type="button" aria-pressed={on} onClick={() => setFilter(on && f.id !== 'all' ? 'all' : f.id)}
              className={`card-lift flex-shrink-0 text-left rounded-2xl border px-3.5 py-2.5 md:px-4 md:py-3 ${on ? 'border-navy-950 bg-white shadow-sm' : 'border-warm-200 bg-white/70 hover:bg-white'}`}>
              <div className={`text-[20px] md:text-[26px] font-semibold tracking-[-0.03em] tabular-nums leading-none ${n === 0 && f.id !== 'all' ? 'text-warm-500' : f.tone}`}>{n}</div>
              <div className="text-[12px] md:text-[12.5px] font-medium text-warm-600 mt-1 md:mt-1.5 whitespace-nowrap">{f.label}</div>
            </button>
          )
        })}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} aria-hidden className="absolute left-3.5 top-1/2 -translate-y-1/2 text-warm-500" />
          <label htmlFor="project-search" className="sr-only">Search projects</label>
          <input id="project-search" ref={searchRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Search projects  ( / )"
            className="w-full rounded-full border border-warm-300 bg-white pl-10 pr-9 py-2.5 text-[14px] text-navy-950 placeholder:text-warm-500" />
          {q && <button type="button" onClick={() => setQ('')} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-full text-warm-600 hover:text-navy-950"><X size={15} /></button>}
        </div>
        <label className="sr-only" htmlFor="project-sort">Sort projects</label>
        <div className="relative">
          <ArrowUpDown size={15} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-warm-500 pointer-events-none" />
          <select id="project-sort" value={sort} onChange={e => { setSort(e.target.value as Sort); setCol(null) }}
            className="appearance-none rounded-full border border-warm-300 bg-white pl-9 pr-4 py-2.5 text-[13.5px] font-medium text-navy-950">
            <option value="attention">Needs attention first</option>
            <option value="recent">Recently updated</option>
            <option value="finish">Finish date</option>
            <option value="name">Name</option>
          </select>
        </div>
        <div role="group" aria-label="View" className="hidden md:inline-flex rounded-full border border-warm-300 bg-white p-0.5">
          {([['cards', LayoutGrid, 'Cards'], ['table', Rows3, 'Table']] as const).map(([id, Icon, label]) => (
            <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)} title={label}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-medium ${view === id ? 'bg-navy-950 text-white' : 'text-warm-600 hover:text-navy-950'}`}>
              <Icon size={15} aria-hidden /><span className="hidden sm:inline">{label}</span><span className="sm:hidden sr-only">{label}</span>
            </button>
          ))}
        </div>
      </div>

      <p className="sr-only" role="status" aria-live="polite">{shown.length} {shown.length === 1 ? 'project' : 'projects'} shown</p>

      {!shown.length ? (
        <div className="text-center py-16 rounded-[22px] border border-dashed border-warm-300">
          <p className="text-[15px] font-semibold text-navy-950">No projects match</p>
          <p className="text-[13.5px] text-warm-600 mt-1">Try another word, or <button type="button" className="text-accent-600 font-medium hover:underline" onClick={() => { setQ(''); setFilter('all') }}>show all projects</button>.</p>
        </div>
      ) : view === 'table' || !viewLoaded ? (
        view === 'table' ? <ProjectTable rows={shown} onOpen={open} pins={pins} onPin={togglePin} col={col} setCol={setCol} /> : null
      ) : grouped ? (
        <div className="space-y-8">
          {pinned.length > 0 && <Group title="Pinned" rows={pinned} onOpen={open} pins={pins} onPin={togglePin} />}
          {urgent.length > 0 && <Group title="Needs your attention" note={`${urgent.length} ${urgent.length === 1 ? 'project' : 'projects'}, most urgent first`} rows={urgent} onOpen={open} pins={pins} onPin={togglePin} />}
          {rest.length > 0 && <Group title={urgent.length || pinned.length ? 'Everything else' : 'All projects'} rows={rest} onOpen={open} pins={pins} onPin={togglePin} />}
        </div>
      ) : (
        <Grid rows={shown} onOpen={open} pins={pins} onPin={togglePin} />
      )}
    </div>
  )
}

type CardProps = { onOpen: (r: PortfolioRow) => void; pins: string[]; onPin: (r: PortfolioRow) => void }

function Group({ title, note, rows, ...p }: { title: string; note?: string; rows: PortfolioRow[] } & CardProps) {
  return (
    <section aria-label={title}>
      <div className="flex items-baseline gap-2 mb-3">
        <h2 className="text-[15px] font-semibold text-navy-950">{title}</h2>
        {note && <span className="text-[12.5px] text-warm-600">{note}</span>}
      </div>
      <Grid rows={rows} {...p} />
    </section>
  )
}

function Grid({ rows, ...p }: { rows: PortfolioRow[] } & CardProps) {
  return <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{rows.map((r, i) => <ProjectCard key={key(r)} r={r} i={i} {...p} />)}</ul>
}

function PinButton({ r, pinned, onPin }: { r: PortfolioRow; pinned: boolean; onPin: (r: PortfolioRow) => void }) {
  return (
    <button type="button" onClick={e => { e.stopPropagation(); onPin(r) }} aria-pressed={pinned} aria-label={`${pinned ? 'Unpin' : 'Pin'} ${r.title}`}
      className={`relative z-10 p-1.5 -m-1.5 rounded-full ${pinned ? 'text-status-attention' : 'text-warm-400 hover:text-warm-700'}`}>
      <Star size={16} aria-hidden fill={pinned ? 'currentColor' : 'none'} />
    </button>
  )
}

function ProjectCard({ r, i, onOpen, pins, onPin }: { r: PortfolioRow; i: number } & CardProps) {
  const st = statusOf(r)
  const v = variance(r)
  const draft = r.source === 'built' && r.status === 'not_started'
  const pct = r.percentComplete == null || draft ? null : Math.max(0, Math.min(100, Math.round(r.percentComplete)))
  const why = needsYou(r) ? reason(r) : null
  return (
    <li className="rise-in" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
      <div className="card-lift group relative h-full rounded-[22px] border border-warm-200 bg-white p-5 flex flex-col hover:border-warm-300">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {/* The whole card opens the project; the link's box covers it */}
            <button type="button" onClick={() => onOpen(r)} className="text-left text-[16px] font-semibold tracking-[-0.01em] text-navy-950 leading-snug after:absolute after:inset-0 after:rounded-[22px] after:content-['']">
              {r.title}
            </button>
            <div className="text-[12.5px] text-warm-600 mt-0.5 truncate">{sourceLine(r)}</div>
          </div>
          <PinButton r={r} pinned={pins.includes(key(r))} onPin={onPin} />
        </div>
        <div className="mt-3"><span className={`inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-full ${st.cls}`}><span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} aria-hidden />{st.label}</span></div>
        {why && <p className="mt-2 text-[12.5px] leading-snug text-warm-700 line-clamp-2" title={why}>{why}</p>}
        {draft ? (
          <div className="mt-4">
            <div className="text-[12px] font-medium text-warm-600">Next step</div>
            <div className="text-[15px] font-semibold text-navy-950 mt-0.5">Finish the interview to generate the schedule</div>
          </div>
        ) : (
          <div className="mt-4">
            <div className="text-[12px] font-medium text-warm-600">Forecast finish</div>
            <div className="flex flex-wrap items-baseline gap-x-2.5 mt-0.5">
              <span className="text-[22px] font-semibold tracking-[-0.02em] text-navy-950 tabular-nums">{fmtDate(r.finish)}</span>
              {v && <span className={`text-[13px] font-semibold ${v.cls}`}>{v.text}</span>}
            </div>
          </div>
        )}
        <div className="mt-auto pt-4">
          {pct != null && (
            <div className="mb-3">
              <div className="flex justify-between text-[12px] text-warm-600 mb-1"><span>Complete</span><span className="tabular-nums font-medium text-warm-700">{pct}%</span></div>
              <div className="h-1.5 rounded-full bg-warm-200 overflow-hidden" aria-hidden><div className="meter-fill h-full rounded-full bg-accent-600" style={{ width: `${pct}%` }} /></div>
            </div>
          )}
          <div className="flex items-center justify-between text-[12px] text-warm-600 border-t border-warm-200 pt-3">
            <span>{r.dataDate ? <>Data date <span className="tabular-nums text-warm-700 font-medium">{fmtDate(r.dataDate)}</span></> : <>Updated <span className="tabular-nums text-warm-700 font-medium">{fmtDay(r.updatedAt)}</span></>}</span>
            {isStale(r) && <span className="font-semibold text-status-attention">Needs an update</span>}
          </div>
        </div>
      </div>
    </li>
  )
}

const COLS: { id: Col; label: string; num?: boolean }[] = [
  { id: 'name', label: 'Project' }, { id: 'status', label: 'Status' }, { id: 'finish', label: 'Forecast finish', num: true },
  { id: 'variance', label: 'Variance', num: true }, { id: 'dataDate', label: 'Data date', num: true }, { id: 'start', label: 'Start', num: true },
  { id: 'progress', label: 'Complete', num: true }, { id: 'uploads', label: 'Uploads', num: true },
]

function ProjectTable({ rows, onOpen, pins, onPin, col, setCol }: { rows: PortfolioRow[]; col: { c: Col; dir: 1 | -1 } | null; setCol: (c: { c: Col; dir: 1 | -1 } | null) => void } & CardProps) {
  return (
    <div className="rounded-[22px] border border-warm-200 bg-white overflow-x-auto">
      <table className="w-full text-[13.5px]">
        <caption className="sr-only">Projects. Select a column heading to sort.</caption>
        <thead>
          <tr className="border-b border-warm-200 text-left">
            <th scope="col" className="w-10 pl-4"><span className="sr-only">Pinned</span></th>
            {COLS.map(c => {
              const active = col?.c === c.id
              const Icon = active ? (col!.dir === 1 ? ArrowUp : ArrowDown) : ArrowUpDown
              return (
                <th key={c.id} scope="col" aria-sort={active ? (col!.dir === 1 ? 'ascending' : 'descending') : 'none'} className={`px-3 py-3 font-semibold text-warm-600 whitespace-nowrap ${c.num ? 'text-right' : ''}`}>
                  <button type="button" onClick={() => setCol(active ? (col!.dir === 1 ? { c: c.id, dir: -1 } : null) : { c: c.id, dir: 1 })}
                    className={`inline-flex items-center gap-1 hover:text-navy-950 ${active ? 'text-navy-950' : ''}`}>
                    {c.label}<Icon size={13} aria-hidden className={active ? '' : 'opacity-40'} />
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const st = statusOf(r)
            const v = variance(r)
            return (
              <tr key={key(r)} className="border-b border-warm-200 last:border-0 hover:bg-warm-50 transition-colors">
                <td className="pl-4"><PinButton r={r} pinned={pins.includes(key(r))} onPin={onPin} /></td>
                <td className="px-3 py-3 min-w-[220px]">
                  <button type="button" onClick={() => onOpen(r)} className="text-left font-semibold text-navy-950 hover:underline">{r.title}</button>
                  <div className="text-[12px] text-warm-600">{sourceLine(r)}</div>
                </td>
                <td className="px-3 py-3 whitespace-nowrap"><span className="inline-flex items-center gap-1.5 text-warm-700"><span className={`w-2 h-2 rounded-full ${st.dot}`} aria-hidden />{st.label}</span></td>
                <td className="px-3 py-3 text-right tabular-nums text-navy-950 font-medium whitespace-nowrap">{fmtDate(r.finish)}</td>
                <td className={`px-3 py-3 text-right whitespace-nowrap font-medium ${v?.cls ?? 'text-warm-600'}`}>{v?.text ?? '—'}</td>
                <td className={`px-3 py-3 text-right tabular-nums whitespace-nowrap ${isStale(r) ? 'text-status-attention font-semibold' : 'text-warm-700'}`}>{r.dataDate ? fmtDate(r.dataDate) : '—'}</td>
                <td className="px-3 py-3 text-right tabular-nums text-warm-700 whitespace-nowrap">{fmtDate(r.start)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-warm-700">{r.percentComplete == null || r.status === 'not_started' ? '—' : `${Math.round(r.percentComplete)}%`}</td>
                <td className="px-3 py-3 text-right tabular-nums text-warm-700 pr-5">{r.kind === 'plan' ? '—' : r.updates ?? 1}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
