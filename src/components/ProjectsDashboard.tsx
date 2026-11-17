'use client'

// Home: every project of the organization on one calm screen, and the user decides which to open.
// One entry per project: an upload series (baseline + status updates of the same project) is one
// card showing its latest update; plans built in RunF9 sit alongside with a quiet "Built in RunF9"
// label. Five facts per card at most. The summary strip doubles as filters; search, sort, the
// card/table view and pinned projects are remembered in this browser.
// Research behind the choices: docs/strategy/HOME-DASHBOARD-RESEARCH.md.

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Check, Search, Star, LayoutGrid, Rows3, Plus, Cloud, ChevronDown, ArrowUpDown, ArrowUp, ArrowDown, X, Folder, TriangleAlert, ShieldAlert, Clock, TrendingUp, MessageCircleQuestion, GitBranch, ShieldCheck, type LucideIcon } from 'lucide-react'
import { useApp } from '@/app/dashboard/layout'
import { fmtDate, fmtDay, fmtDates } from '@/lib/format'
import type { Portfolio as PortfolioData, PortfolioRow } from '@/lib/planning/portfolio'
import { EmptyState } from '@/components/EmptyState'
import { DataCenterSampleButton } from '@/components/DataCenterSample'
import type { DataLocation } from '@/lib/server/data-location'

type Filter = 'all' | 'at_risk' | 'attention' | 'stale' | 'on_track'
type Sort = 'attention' | 'recent' | 'finish' | 'name'
type View = 'cards' | 'table'
type Col = 'name' | 'status' | 'finish' | 'variance' | 'dataDate' | 'start' | 'progress' | 'uploads'

const STATUS: Record<PortfolioRow['status'], { label: string; cls: string; dot: string }> = {
  at_risk: { label: 'At risk', cls: 'text-status-at-risk bg-status-at-risk-bg', dot: 'bg-status-at-risk' },
  attention: { label: 'Watch', cls: 'text-status-attention bg-status-attention-bg', dot: 'bg-status-attention' },
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
  // With a handful of projects everything is on screen: search and sort appear once there is something to find.
  const few = rows.length < 6

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

  if (error) return <div className="px-5 md:px-6 py-8"><p role="alert" className="text-[14px] text-status-at-risk">{error}</p></div>

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="page-title">Projects</h1>
        {org?.dataLocation && <DataLocationPicker loc={org.dataLocation} />}
      </div>
      <Link href="/dashboard/plan" className="pressable inline-flex items-center gap-1.5 rounded-lg bg-accent-600 hover:bg-accent-700 text-white px-4 py-2 text-[13px] font-semibold shadow-sm">
        <Plus size={15} aria-hidden /> New project
      </Link>
    </div>
  )

  if (!data) return (
    <div className="px-5 md:px-6 py-6 md:py-8 space-y-6" aria-busy="true">
      {header}
      <p className="sr-only" role="status">Loading your projects…</p>
      <div className="grid gap-2 grid-cols-3 md:grid-cols-5">{Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton h-[74px] rounded-[14px]" />)}</div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <div key={i} className="skeleton h-[188px] rounded-[14px]" />)}</div>
    </div>
  )

  if (!rows.length) return (
    <div className="px-5 md:px-6 py-6 md:py-8 space-y-6">
      {header}
<>
      <EmptyState heading="h2" title="Add your first project" action={{ label: 'Build with the interview', href: '/dashboard/plan' }}
        secondary={can('schedule.write') ? { label: 'Or upload a P6 or MS Project schedule', onClick: openUpload } : undefined}>
        Every project you upload or build shows up here, with its status and forecast finish.
      </EmptyState>
      {can('schedule.write') && <div className="-mt-10 pb-12 text-center">
        <p className="text-[13px] text-warm-600 mb-2">Or see a live project first: a data center in construction, with late switchgear, meeting minutes and a risk register.</p>
        <DataCenterSampleButton />
      </div>}
      </>
      {/* First run (design package step 7): how RunF9 works, in three steps that match the real flow. */}
      <section aria-labelledby="first-run-h" className="max-w-4xl mx-auto">
        <h2 id="first-run-h" className="text-[16px] font-semibold text-ink text-center">Better schedules start with better questions</h2>
        <ol className="mt-4 grid gap-3 md:grid-cols-3">
          {([
            [MessageCircleQuestion, 'Ask what matters', 'The interview asks about your facility, permits, calendars and long-lead items. "Don\u2019t know" and "Can\u2019t share" are real answers; each becomes a visible assumption.'],
            [GitBranch, 'Build reliable logic', 'RunF9 builds the CPM schedule with a written reason for every duration and link, from your answers, regional data and your firm\u2019s own past projects.'],
            [ShieldCheck, 'Verify before publishing', 'Check the draft against the DCMA 14-point assessment, answer RunF9\u2019s questions about the data, and record a reviewer\u2019s verdict (your organization can require one) before you publish the baseline.'],
          ] as const).map(([Icon, title, text], i) => (
            <li key={title} className="rounded-[14px] border border-warm-200 bg-white p-4">
              <span aria-hidden className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-accent-100 text-accent-600"><Icon size={16} /></span>
              <h3 className="mt-2 text-[14px] font-semibold text-ink"><span className="sr-only">Step {i + 1}: </span>{title}</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-warm-600">{text}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )

  const FILTERS: { id: Filter; label: string; tone: string; icon: LucideIcon }[] = [
    { id: 'all', label: 'All projects', tone: 'text-ink', icon: Folder },
    { id: 'at_risk', label: 'At risk', tone: 'text-status-at-risk', icon: TriangleAlert },
    { id: 'attention', label: 'Watch', tone: 'text-status-attention', icon: ShieldAlert },
    { id: 'stale', label: 'Needs an update', tone: 'text-status-attention', icon: Clock },
    { id: 'on_track', label: 'On track', tone: 'text-status-on-track', icon: TrendingUp },
  ]
  const grouped = view === 'cards' && filter === 'all' && !q && sort === 'attention' && !col
  const urgent = grouped ? shown.filter(r => needsYou(r) && !pins.includes(key(r))) : []
  const pinned = grouped ? shown.filter(r => pins.includes(key(r))) : []
  const rest = grouped ? shown.filter(r => !needsYou(r) && !pins.includes(key(r))) : shown

  const viewSwitch = (
        <div role="group" aria-label="View" className="hidden md:inline-flex rounded-lg border border-warm-300 bg-white p-0.5">
          {([['cards', LayoutGrid, 'Cards'], ['table', Rows3, 'Table']] as const).map(([id, Icon, label]) => (
            <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)} title={label}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-medium ${view === id ? 'bg-accent-100 text-accent-700' : 'text-warm-600 hover:text-ink'}`}>
              <Icon size={15} aria-hidden /><span className="hidden sm:inline">{label}</span><span className="sm:hidden sr-only">{label}</span>
            </button>
          ))}
        </div>
  )

  return (
    <div className="px-5 md:px-6 py-6 md:py-8 space-y-6">
      {header}

      {/* Summary strip: each number is a filter */}
      {/* With a handful of projects the five big counters are mostly zeros, so the filters are a row of chips instead. */}
      {counts.all < 6 ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div role="group" aria-label="Filter projects by status" className="flex flex-wrap gap-1.5">
          {FILTERS.filter(f => f.id === 'all' || counts[f.id] > 0).map(f => {
            const on = filter === f.id
            return (
              <button key={f.id} type="button" aria-pressed={on} onClick={() => setFilter(on && f.id !== 'all' ? 'all' : f.id)}
                className={`pressable inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold border ${on ? 'bg-accent-100 text-accent-700 border-accent-500' : 'bg-white text-ink border-warm-300 hover:border-navy-900'}`}>
                {on && <Check size={14} aria-hidden="true" />}{f.label} <span className={`tabular-nums font-medium ${on ? 'text-accent-700' : 'text-warm-600'}`}>{counts[f.id]}</span>
              </button>
            )
          })}
        </div>
        {viewSwitch}
        </div>
      ) : (
      <div role="group" aria-label="Filter projects by status" title={counts.stale > 0 ? 'A project that needs an update is also counted under its status, so the groups can add up to more than the total.' : undefined} className="grid grid-cols-3 gap-2 md:grid-cols-5 md:gap-2.5">
        {FILTERS.map(f => {
          const on = filter === f.id
          const n = counts[f.id]
          return (
            <button key={f.id} type="button" aria-pressed={on} onClick={() => setFilter(on && f.id !== 'all' ? 'all' : f.id)}
              className={`card-lift min-w-0 text-left rounded-[14px] border px-3 py-2.5 md:px-4 md:py-3 ${on ? 'border-navy-950 bg-white shadow-sm' : 'border-warm-200 bg-white/70 hover:bg-white'}`}>
              <span aria-hidden className="hidden md:inline-flex items-center justify-center w-7 h-7 rounded-lg bg-accent-100 text-accent-600 mb-2"><f.icon size={15} /></span>
              <div className={`text-[20px] md:text-[24px] font-semibold tracking-[-0.02em] tabular-nums leading-none ${n === 0 && f.id !== 'all' ? 'text-warm-500' : f.tone}`}>{n}</div>
              <div className="text-[12px] md:text-[12px] font-medium text-warm-600 mt-1 md:mt-1.5 leading-tight">{f.label}</div>
            </button>
          )
        })}
      </div>
      )}

      {/* Toolbar: search, sort and the view switch, once there are enough projects to need them. */}
      <div className={`flex flex-wrap items-center gap-2.5 ${few ? 'hidden' : ''}`}>
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} aria-hidden className="absolute left-3.5 top-1/2 -translate-y-1/2 text-warm-500" />
          <label htmlFor="project-search" className="sr-only">Search projects</label>
          <input id="project-search" ref={searchRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Search projects  ( / )"
            className="w-full rounded-md border border-warm-300 bg-white pl-10 pr-9 py-2.5 text-[14px] text-ink placeholder:text-warm-500" />
          {q && <button type="button" onClick={() => setQ('')} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-full text-warm-600 hover:text-ink"><X size={15} /></button>}
        </div>
        <label className="sr-only" htmlFor="project-sort">Sort projects</label>
        <div className="relative">
          <ArrowUpDown size={15} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-warm-500 pointer-events-none" />
          <select id="project-sort" value={sort} onChange={e => { setSort(e.target.value as Sort); setCol(null) }}
            className="appearance-none rounded-md border border-warm-300 bg-white pl-9 pr-4 py-2.5 text-[13px] font-medium text-ink">
            <option value="attention">Most urgent first</option>
            <option value="recent">Recently updated</option>
            <option value="finish">Finish date</option>
            <option value="name">Name</option>
          </select>
        </div>
        {!few && viewSwitch}
      </div>

      <p className="sr-only" role="status" aria-live="polite">{shown.length} {shown.length === 1 ? 'project' : 'projects'} shown</p>

      {!shown.length ? (
        <div className="text-center py-16 rounded-[14px] border border-dashed border-warm-300">
          <p className="text-[14px] font-semibold text-ink">No projects match</p>
          <p className="text-[13px] text-warm-600 mt-1">Try another word, or <button type="button" className="text-accent-600 font-medium hover:underline" onClick={() => { setQ(''); setFilter('all') }}>show all projects</button>.</p>
        </div>
      ) : view === 'table' || !viewLoaded ? (
        view === 'table' ? <ProjectTable rows={shown} onOpen={open} pins={pins} onPin={togglePin} col={col} setCol={setCol} /> : null
      ) : grouped && rows.length >= 4 ? (
        <div className="space-y-8">
          {pinned.length > 0 && <Group title="Pinned" rows={pinned} onOpen={open} pins={pins} onPin={togglePin} wide={rows.length < 4} />}
          {urgent.length > 0 && <Group title="Act on these first" rows={urgent} onOpen={open} pins={pins} onPin={togglePin} wide={rows.length < 4} />}
          {rest.length > 0 && <Group title={urgent.length || pinned.length ? 'Everything else' : 'All projects'} rows={rest} onOpen={open} pins={pins} onPin={togglePin} wide={rows.length < 4} />}
        </div>
      ) : (
        <Grid rows={shown} onOpen={open} pins={pins} onPin={togglePin} wide={rows.length < 4} />
      )}
      {/* Everything that needs someone, across every project, in one list under the projects. */}
      <OpenItems rows={rows} onOpen={open} />
    </div>
  )
}

/** `wide`: one project per row on a wide screen, used when there are only a few so a lone card does not float in an empty page. */
type CardProps = { onOpen: (r: PortfolioRow) => void; pins: string[]; onPin: (r: PortfolioRow) => void; wide?: boolean }

function Group({ title, note, rows, ...p }: { title: string; note?: string; rows: PortfolioRow[] } & CardProps) {
  return (
    <section aria-label={title}>
      <div className="flex items-baseline gap-2 mb-3">
        <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
        {note && <span className="text-[12px] text-warm-600">{note}</span>}
      </div>
      <Grid rows={rows} {...p} />
    </section>
  )
}

function Grid({ rows, ...p }: { rows: PortfolioRow[] } & CardProps) {
  return <ul className={p.wide ? 'grid gap-3 sm:grid-cols-2 lg:grid-cols-1' : 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3'}>{rows.map((r, i) => <ProjectCard key={key(r)} r={r} i={i} {...p} />)}</ul>
}

/** A project's mark: its initials on one of the palette's dark tints, chosen from its name so it stays the same. */
const MONO_TINTS = ['bg-navy-950', 'bg-accent-700', 'bg-navy-800', 'bg-accent-600', 'bg-navy-700']
function Monogram({ title }: { title: string }) {
  const words = title.trim().split(/\s+/).filter(w => /[A-Za-z0-9]/.test(w))
  const letters = ((words[0]?.[0] ?? '') + (words.length > 1 ? words[1][0] : words[0]?.[1] ?? '')).toUpperCase() || 'P'
  const tint = MONO_TINTS[[...title].reduce((n, c) => n + c.charCodeAt(0), 0) % MONO_TINTS.length]
  return <span aria-hidden="true" className={`flex-shrink-0 inline-flex h-11 w-11 items-center justify-center rounded-lg text-[14px] font-semibold tracking-[0.02em] text-white ${tint}`}>{letters}</span>
}

/** The open items of every project in one list: what is late, at risk or stale, most serious first, each opening its project. */
function OpenItems({ rows, onOpen }: { rows: PortfolioRow[]; onOpen: (r: PortfolioRow) => void }) {
  const [all, setAll] = useState(false)
  const items = rows.flatMap(r => r.alerts.filter(a => a.severity !== 'info').map(a => ({ r, a })))
    .sort((x, y) => SEVERITY[x.a.severity] - SEVERITY[y.a.severity])
  if (!items.length) return null
  const shown = all ? items : items.slice(0, 6)
  return (
    <section aria-labelledby="open-items-h" className="rounded-[14px] border border-warm-200 bg-white p-5 md:p-6">
      <div className="flex items-baseline gap-2">
        <h2 id="open-items-h" className="text-[14px] font-semibold text-ink">Open items</h2>
        <span className="rounded-full border border-warm-300 px-2 text-[12px] font-semibold tabular-nums text-warm-700">{shown.length} of {items.length}</span>
      </div>
      <ul className="mt-2 divide-y divide-warm-200">
        {shown.map(({ r, a }, i) => (
          <li key={`${key(r)}-${a.code}-${i}`} className="flex items-start gap-3 py-3">
            <span className={`mt-0.5 flex-shrink-0 w-[62px] rounded-full px-2 py-0.5 text-center text-[12px] font-semibold ${a.severity === 'error' ? 'bg-status-at-risk-bg text-status-at-risk' : 'bg-status-attention-bg text-status-attention'}`}>{a.severity === 'error' ? 'Act' : 'Watch'}</span>
            <div className="min-w-0 flex-1">
              <button type="button" onClick={() => onOpen(r)} className="text-left text-[14px] font-semibold text-accent-700 hover:underline">{r.title}</button>
              <p className="text-[13px] leading-snug text-warm-700">{fmtDates(a.text)}</p>
            </div>
          </li>
        ))}
      </ul>
      {items.length > 6 && <button type="button" aria-expanded={all} onClick={() => setAll(v => !v)} className="mt-2 text-[13px] font-semibold text-accent-600 hover:underline">{all ? 'Show fewer' : `Show all ${items.length}`}</button>}
    </section>
  )
}

function PinButton({ r, pinned, onPin }: { r: PortfolioRow; pinned: boolean; onPin: (r: PortfolioRow) => void }) {
  return (
    <button type="button" onClick={e => { e.stopPropagation(); onPin(r) }} aria-pressed={pinned} aria-label={`${pinned ? 'Unpin' : 'Pin'} ${r.title}`}
      className={`relative z-10 p-1.5 -m-1.5 rounded-full ${pinned ? 'text-status-attention' : 'text-warm-400 hover:text-warm-700'}`}>
      <Star size={16} aria-hidden fill={pinned ? 'currentColor' : 'none'} />
    </button>
  )
}

function ProjectCard({ r, i, onOpen, pins, onPin, wide }: { r: PortfolioRow; i: number } & CardProps) {
  const st = statusOf(r)
  const v = variance(r)
  const draft = r.source === 'built' && r.status === 'not_started'
  const pct = r.percentComplete == null || draft ? null : Math.max(0, Math.min(100, Math.round(r.percentComplete)))
  const why = needsYou(r) ? reason(r) : null
  // A forecast finish that is already behind us, on work that is not complete, is not a forecast: say how long ago it was.
  const pastDays = (() => {
    if (draft || !r.finish || r.status === 'complete' || (pct != null && pct >= 100)) return null
    const [y, m, d] = r.finish.slice(0, 10).split('-').map(Number), now = new Date()
    const n = Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(y, m - 1, d)) / 86_400_000)
    return n > 0 ? n : null
  })()
  return (
    <li className="rise-in" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
      <div className={`card-lift group relative h-full rounded-[14px] border border-warm-200 bg-white p-5 flex flex-col hover:border-warm-300 ${wide ? 'lg:flex-row lg:items-center lg:gap-10 lg:px-7 lg:py-6' : ''}`}>
        <div className={`flex items-start justify-between gap-3 ${wide ? 'lg:w-[26%] lg:flex-shrink-0' : ''}`}>
          <div className="flex items-start gap-3.5 min-w-0">
          <Monogram title={r.title} />
          <div className="min-w-0">
            {/* The whole card opens the project; the link's box covers it */}
            <button type="button" onClick={() => onOpen(r)} className="text-left text-[16px] font-semibold tracking-[-0.01em] text-ink leading-snug after:absolute after:inset-0 after:rounded-[14px] after:content-['']">
              {r.title}
            </button>
            <div className="text-[12px] text-warm-600 mt-0.5 truncate">{sourceLine(r)}</div>
          </div>
          </div>
          <PinButton r={r} pinned={pins.includes(key(r))} onPin={onPin} />
        </div>
        <div className={wide ? 'lg:flex-1 lg:min-w-0' : ''}>
        <div className={`mt-3 ${wide ? 'lg:mt-0' : ''}`}><span className={`inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-full ${st.cls}`}><span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} aria-hidden />{st.label}</span></div>
        </div>
        {draft ? (
          <div className={`mt-4 ${wide ? 'lg:mt-0 lg:w-[200px] lg:flex-shrink-0' : ''}`}>
            <div className="text-[12px] font-medium text-warm-600">Next step</div>
            <div className="text-[14px] font-semibold text-ink mt-0.5">Finish the interview to generate the schedule</div>
          </div>
        ) : (
          <div className={`mt-4 ${wide ? 'lg:mt-0 lg:w-[200px] lg:flex-shrink-0' : ''}`}>
            <div className="text-[12px] font-medium text-warm-600">Forecast finish</div>
            <div className="flex flex-wrap items-baseline gap-x-2.5 mt-0.5">
              <span className="text-[20px] font-semibold tracking-[-0.02em] text-ink tabular-nums">{fmtDate(r.finish)}</span>
              {v && <span className={`text-[13px] font-semibold ${v.cls}`}>{v.text}</span>}
              {!v && pastDays != null && <span className="text-[13px] font-semibold text-status-at-risk">{pastDays} {pastDays === 1 ? 'day' : 'days'} ago, not finished</span>}
            </div>
          </div>
        )}
        <div className={`mt-auto pt-4 ${wide ? 'lg:mt-0 lg:pt-0 lg:w-[230px] lg:flex-shrink-0' : ''}`}>
          {pct != null && (
            <div className="mb-3">
              <div className="flex justify-between text-[12px] text-warm-600 mb-1"><span>Complete</span><span className="tabular-nums font-medium text-warm-700">{pct}%</span></div>
              <div className="h-1.5 rounded-full bg-warm-200 overflow-hidden" aria-hidden><div className="meter-fill h-full rounded-full bg-accent-600" style={{ width: `${pct}%` }} /></div>
            </div>
          )}
          <div className="flex items-center justify-between text-[12px] text-warm-600 border-t border-warm-200 pt-3">
            <span>{r.dataDate ? <>Data date <span className="tabular-nums text-warm-700 font-medium">{fmtDate(r.dataDate)}</span></> : <>No data date · saved <span className="tabular-nums text-warm-700 font-medium">{fmtDay(r.updatedAt)}</span></>}</span>
            {isStale(r) && <span className="ml-3 flex-shrink-0 rounded-full bg-status-attention-bg px-2 py-0.5 font-semibold text-status-attention">Needs an update</span>}
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
    <div className="rounded-[14px] border border-warm-200 bg-white overflow-x-auto">
      <table className="w-full text-[13px]">
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
                    className={`inline-flex items-center gap-1 hover:text-ink ${active ? 'text-ink' : ''}`}>
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
                  <button type="button" onClick={() => onOpen(r)} className="text-left font-semibold text-ink hover:underline">{r.title}</button>
                  <div className="text-[12px] text-warm-600">{sourceLine(r)}</div>
                </td>
                <td className="px-3 py-3 whitespace-nowrap"><span className="inline-flex items-center gap-1.5 text-warm-700"><span className={`w-2 h-2 rounded-full ${st.dot}`} aria-hidden />{st.label}</span></td>
                <td className="px-3 py-3 text-right tabular-nums text-ink font-medium whitespace-nowrap">{fmtDate(r.finish)}</td>
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

/**
 * Where this organization's data lives, collapsed to one chip. Opening it explains the storage and offers
 * the cloud connections (AWS, Azure, Google Cloud), so the header stays one line on every screen size.
 */
function DataLocationPicker({ loc }: { loc: DataLocation }) {
  const [open, setOpen] = useState(false)
  const pid = useId()
  return (
    <div className="mt-2">
      <button type="button" aria-expanded={open} aria-controls={pid} onClick={() => setOpen(o => !o)}
        className="pressable inline-flex max-w-full items-center gap-1.5 rounded-full border border-warm-200 bg-white px-3 py-1.5 text-[13px] text-warm-600 hover:border-warm-300 hover:text-ink">
        <Cloud size={14} aria-hidden className="flex-shrink-0" />
        <span className="sr-only">Data storage: </span>
        <span className="truncate font-semibold text-ink">{loc.label}</span>
        <ChevronDown size={14} aria-hidden className={`flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div id={pid} role="region" aria-label="Data storage" data-open={open} className="disclosure-panel" inert={!open || undefined}>
        <div className="disclosure-inner">
          <div className="mt-2 max-w-xl rounded-2xl border border-warm-200 bg-white p-4 text-[13px] leading-relaxed">
            <dl className="space-y-2">
              <div><dt className="font-semibold text-ink">Stored in</dt><dd className="text-warm-700">{loc.database}</dd></div>
              <div><dt className="font-semibold text-ink">Document search</dt><dd className="text-warm-700">{loc.documentSearch}</dd></div>
            </dl>
            <Link href="/dashboard/org#cloud-storage" className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-accent-700">
              Connect AWS, Azure or Google Cloud
            </Link>
            <p className="mt-2 text-[12px] text-warm-600">Keep schedule files and originals in your own cloud storage. Organization admins set this up.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
