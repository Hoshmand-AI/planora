'use client'

// Home: every project of the organization in one table, and the user decides which to open.
// One row per project: an upload series (baseline + status updates of the same project) is one row
// showing its latest update; plans built in RunF9 sit alongside with a quiet "Built in RunF9" label.
// Project ID and Project stay first; every other column can be dragged (or moved from "Columns") to
// where the reader wants it. What needs someone is a column of its own, opened per project. Projects
// can be ticked and built into a master schedule. Filters, sort, column order and pins are remembered
// in this browser.
// Research behind the choices: docs/strategy/HOME-DASHBOARD-RESEARCH.md.

import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Check, Search, Star, Plus, Cloud, ChevronDown, ArrowUpDown, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, X, Folder, TriangleAlert, ShieldAlert, Clock, TrendingUp, Layers, Columns3, GripVertical, type LucideIcon } from 'lucide-react'
import { useApp } from '@/app/dashboard/layout'
import { fmtDate, fmtDay, fmtDates } from '@/lib/format'
import { digitsFont } from '@/app/fonts/digits'
import { Alert, Button, Field, inputClass, postJson } from '@/components/ui'
import type { Portfolio as PortfolioData, PortfolioRow } from '@/lib/planning/portfolio'
import { EmptyState } from '@/components/EmptyState'
import { DataCenterSampleButton } from '@/components/DataCenterSample'
import type { DataLocation } from '@/lib/server/data-location'

type Filter = 'all' | 'at_risk' | 'attention' | 'stale' | 'on_track'
type Sort = 'attention' | 'recent' | 'finish' | 'name'
type Col = 'projectId' | 'name' | 'status' | 'open' | 'finish' | 'required' | 'variance' | 'dataDate' | 'start' | 'progress' | 'uploads' | 'addedBy' | 'addedAt'

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
/** What needs someone on a project: errors first, then warnings (notes are left out). */
const openItems = (r: PortfolioRow) => r.alerts.filter(a => a.severity !== 'info').sort((x, y) => SEVERITY[x.severity] - SEVERITY[y.severity])

/** Project ID and Project are always the first two columns; the rest are in the reader's order. */
const COLS: Record<Col, { label: string; num?: boolean }> = {
  projectId: { label: 'Project ID' }, name: { label: 'Project' }, status: { label: 'Status' }, open: { label: 'Open items' },
  finish: { label: 'Forecast finish', num: true }, required: { label: 'Contract finish', num: true }, variance: { label: 'Variance', num: true },
  dataDate: { label: 'Data date', num: true }, start: { label: 'Start', num: true }, progress: { label: 'Complete', num: true }, uploads: { label: 'Uploads', num: true },
  addedBy: { label: 'Added by' }, addedAt: { label: 'Date added', num: true },
}
const LOCKED: Col[] = ['projectId', 'name']
const MOVABLE: Col[] = ['status', 'open', 'finish', 'required', 'variance', 'dataDate', 'start', 'progress', 'uploads', 'addedBy', 'addedAt']
/** A stored order with every movable column exactly once: unknown names are dropped, new columns are added at the end. */
const cleanOrder = (o: unknown): Col[] => { const seen = (Array.isArray(o) ? o : []).filter((c, i, a): c is Col => MOVABLE.includes(c) && a.indexOf(c) === i); return [...seen, ...MOVABLE.filter(c => !seen.includes(c))] }
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
  const [order, setOrder] = useStored<Col[]>('cols', MOVABLE)
  const [picked, setPicked] = useState<string[]>([])
  const [building, setBuilding] = useState(false)
  const [pins, setPins] = useStored<string[]>('pins', [])
  const [col, setCol] = useState<{ c: Col; dir: 1 | -1 } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

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
      && words.every(w => `${r.title} ${r.projectId} ${r.addedBy ?? ''} ${r.version ?? ''} ${r.source === 'built' ? 'built in runf9' : 'uploaded'}`.toLowerCase().includes(w)))
    const pinned = (r: PortfolioRow) => (pins.includes(key(r)) ? 0 : 1)
    const by: Record<Sort, (a: PortfolioRow, b: PortfolioRow) => number> = {
      attention: (a, b) => attentionRank(a) - attentionRank(b) || (b.gapDays ?? -1e9) - (a.gapDays ?? -1e9) || time(b.updatedAt) - time(a.updatedAt),
      recent: (a, b) => time(b.updatedAt) - time(a.updatedAt),
      finish: (a, b) => (time(a.finish) || Infinity) - (time(b.finish) || Infinity),
      name: (a, b) => a.title.localeCompare(b.title),
    }
    const colBy: Record<Col, (r: PortfolioRow) => number | string> = {
      projectId: r => r.projectId.toLowerCase(), name: r => r.title.toLowerCase(), status: attentionRank, open: r => -openItems(r).length,
      finish: r => time(r.finish) || Infinity, required: r => time(r.required) || Infinity, variance: r => r.gapDays ?? -Infinity,
      dataDate: r => time(r.dataDate), start: r => time(r.start) || Infinity, progress: r => r.percentComplete ?? -1, uploads: r => r.updates ?? 1,
      addedBy: r => (r.addedBy ?? '\uffff').toLowerCase(), addedAt: r => time(r.addedAt),
    }
    return [...list].sort((a, b) => {
      if (col) { const x = colBy[col.c](a), y = colBy[col.c](b); return (x < y ? -1 : x > y ? 1 : 0) * col.dir }
      return pinned(a) - pinned(b) || by[sort](a, b)
    })
  }, [rows, q, filter, sort, pins, col])

  const open = (r: PortfolioRow) => {
    if (r.kind === 'schedule') { const s = schedules.find(x => x.id === r.id); if (s) setSelectedSchedule(s) }
    router.push(r.href)
  }
  const togglePin = (r: PortfolioRow) => setPins(pins.includes(key(r)) ? pins.filter(k => k !== key(r)) : [...pins, key(r)])
  const canBuild = can('schedule.write')
  const cols = useMemo(() => cleanOrder(order), [order])
  // Only projects still on the page stay ticked.
  const pickedRows = useMemo(() => rows.filter(r => r.scheduleId && picked.includes(key(r))), [rows, picked])

  if (error) return <div className="px-5 md:px-6 py-8"><p role="alert" className="text-body text-status-at-risk">{error}</p></div>

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="page-title">Projects</h1>
        {org?.dataLocation && <DataLocationPicker loc={org.dataLocation} />}
      </div>
      {/* With no project yet, the page itself offers the ways to start: a second filled button up here would repeat one of them.
          On a phone the bar at the foot of the screen already has "New", so the button is for wider screens only. */}
      {rows.length > 0 && (
      <Link href="/dashboard/plan" className="pressable hidden md:inline-flex items-center gap-1.5 rounded-lg bg-accent-600 hover:bg-accent-700 text-white px-4 h-9 text-body font-semibold">
        <Plus size={15} aria-hidden /> New project
      </Link>
      )}
    </div>
  )

  if (!data) return (
    <div className="px-5 md:px-6 py-6 md:py-8 space-y-6" aria-busy="true">
      {header}
      <p className="sr-only" role="status">Loading your projects…</p>
      <div className="skeleton h-[260px] rounded-[14px]" />
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
      {can('schedule.write') && <div className="-mt-8 pb-12 text-center">
        <p className="text-body text-warm-600 mb-2">Or see a live project first: a data center in construction, with late switchgear, meeting minutes and a risk register.</p>
        <DataCenterSampleButton />
      </div>}
      </>
    </div>
  )

  const FILTERS: { id: Filter; label: string; tone: string; icon: LucideIcon }[] = [
    { id: 'all', label: 'All projects', tone: 'text-ink', icon: Folder },
    { id: 'at_risk', label: 'At risk', tone: 'text-status-at-risk', icon: TriangleAlert },
    { id: 'attention', label: 'Watch', tone: 'text-status-attention', icon: ShieldAlert },
    { id: 'stale', label: 'Needs an update', tone: 'text-status-attention', icon: Clock },
    { id: 'on_track', label: 'On track', tone: 'text-status-on-track', icon: TrendingUp },
  ]

  return (
    <div className="px-5 md:px-6 py-6 md:py-8 space-y-6">
      {header}

      {/* Summary strip: each number is a filter */}
      {/* With a handful of projects the five big counters are mostly zeros, so the filters are a row of chips instead. */}
      {counts.all < 6 ? (() => {
        // A filter that would show nothing, or everything, says nothing: it is not offered.
        const chips = FILTERS.filter(f => f.id === 'all' || filter === f.id || (counts[f.id] > 0 && counts[f.id] < counts.all))
        if (chips.length < 2) return null
        return (
        <div role="group" aria-label="Filter projects by status" className="flex flex-wrap gap-1.5">
          {chips.map(f => {
            const on = filter === f.id
            return (
              <button key={f.id} type="button" aria-pressed={on} onClick={() => setFilter(on && f.id !== 'all' ? 'all' : f.id)}
                className={`pressable inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-body font-semibold border ${on ? 'bg-accent-100 text-accent-700 border-accent-500' : 'bg-white text-ink border-warm-300 hover:border-navy-900'}`}>
                {on && <Check size={14} aria-hidden="true" />}{f.label} <span className={`tabular-nums font-medium ${on ? 'text-accent-700' : 'text-warm-600'}`}>{counts[f.id]}</span>
              </button>
            )
          })}
        </div>
        )
      })() : (
      <div role="group" aria-label="Filter projects by status" title={counts.stale > 0 ? 'A project that needs an update is also counted under its status, so the groups can add up to more than the total.' : undefined} className="grid grid-cols-3 gap-2 md:grid-cols-5 md:gap-2.5">
        {FILTERS.map(f => {
          const on = filter === f.id
          const n = counts[f.id]
          return (
            <button key={f.id} type="button" aria-pressed={on} onClick={() => setFilter(on && f.id !== 'all' ? 'all' : f.id)}
              className={`card-lift min-w-0 text-left rounded-[14px] border px-3 py-2.5 md:px-4 md:py-3 ${on ? 'border-navy-950 bg-white shadow-sm' : 'border-warm-200 bg-white/70 hover:bg-white'}`}>
              <span aria-hidden className="hidden md:inline-flex items-center justify-center w-7 h-7 rounded-lg bg-accent-100 text-accent-600 mb-1.5"><f.icon size={15} /></span>
              <div className={`text-heading font-semibold tabular-nums ${n === 0 && f.id !== 'all' ? 'text-warm-500' : f.tone}`}>{n}</div>
              <div className="text-caption font-medium text-warm-600 leading-tight">{f.label}</div>
            </button>
          )
        })}
      </div>
      )}

      {/* Toolbar: search and sort once there are enough projects to need them; the column order is always here. */}
      <div className="flex flex-wrap items-center gap-2.5">
        {/* Kept in the page when hidden: the field appears as projects are added, and its size is checked either way. */}
        <div className={few ? 'hidden' : 'contents'}>
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} aria-hidden className="absolute left-3.5 top-1/2 -translate-y-1/2 text-warm-500" />
          <label htmlFor="project-search" className="sr-only">Search projects</label>
          <input id="project-search" ref={searchRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Search projects  ( / )"
            className="w-full rounded-lg border border-warm-300 bg-white pl-10 pr-9 py-2.5 text-body text-ink placeholder:text-warm-500" />
          {q && <button type="button" onClick={() => setQ('')} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-full text-warm-600 hover:text-ink"><X size={15} /></button>}
        </div>
        <label className="sr-only" htmlFor="project-sort">Sort projects</label>
        <div className="relative">
          <ArrowUpDown size={15} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-warm-500 pointer-events-none" />
          <select id="project-sort" value={sort} onChange={e => { setSort(e.target.value as Sort); setCol(null) }}
            className="appearance-none rounded-lg border border-warm-300 bg-white pl-9 pr-4 py-2.5 text-body font-medium text-ink">
            <option value="attention">Most urgent first</option>
            <option value="recent">Recently updated</option>
            <option value="finish">Finish date</option>
            <option value="name">Name</option>
          </select>
        </div>
        </div>
        <div className="ml-auto"><ColumnsMenu cols={cols} onChange={setOrder} /></div>
      </div>

      {/* Ticked projects become a master schedule: nothing to set up first. */}
      {canBuild && pickedRows.length > 0 && (
        <div role="region" aria-label="Selected projects" className="flex flex-wrap items-center gap-3 rounded-[14px] border border-accent-500 bg-accent-100 px-4 py-2.5">
          <span className="text-body font-semibold text-ink">{pickedRows.length} {pickedRows.length === 1 ? 'project' : 'projects'} selected</span>
          <Button onClick={() => setBuilding(true)}><Layers size={15} aria-hidden="true" />Build a master schedule</Button>
          <Button variant="ghost" onClick={() => setPicked([])}>Clear</Button>
        </div>
      )}

      <p className="sr-only" role="status" aria-live="polite">{shown.length} {shown.length === 1 ? 'project' : 'projects'} shown</p>

      {!shown.length ? (
        <div className="text-center py-16 rounded-[14px] border border-dashed border-warm-300">
          <p className="text-subhead font-semibold text-ink">No projects match</p>
          <p className="text-body text-warm-600 mt-1">Try another word, or <button type="button" className="text-accent-600 font-medium hover:underline" onClick={() => { setQ(''); setFilter('all') }}>show all projects</button>.</p>
        </div>
      ) : (
        <ProjectTable rows={shown} cols={cols} onReorder={setOrder} onOpen={open} pins={pins} onPin={togglePin} col={col} setCol={setCol}
          picked={canBuild ? picked : null} onPick={setPicked} />
      )}
      {canBuild && <p className="text-caption text-warm-600">Tick one or more projects to build a master schedule from them. Drag a column heading, or use Columns, to arrange the table.</p>}

      {building && <BuildMasterDialog rows={pickedRows} onClose={() => setBuilding(false)} onBuilt={id => { setBuilding(false); setPicked([]); window.dispatchEvent(new Event('runf9:programs-changed')); router.push(`/dashboard/programs?program=${id}`) }} />}
    </div>
  )
}

type TableProps = { onOpen: (r: PortfolioRow) => void; pins: string[]; onPin: (r: PortfolioRow) => void }

function PinButton({ r, pinned, onPin }: { r: PortfolioRow; pinned: boolean; onPin: (r: PortfolioRow) => void }) {
  return (
    <button type="button" onClick={e => { e.stopPropagation(); onPin(r) }} aria-pressed={pinned} aria-label={`${pinned ? 'Unpin' : 'Pin'} ${r.title}`}
      className={`inline-flex items-center justify-center w-8 h-8 rounded-lg ${pinned ? 'text-status-attention' : 'text-warm-500 hover:text-warm-700'}`}>
      <Star size={16} aria-hidden fill={pinned ? 'currentColor' : 'none'} />
    </button>
  )
}

/** The order of the movable columns, changed without a mouse: each column can be moved one place left or right. */
function ColumnsMenu({ cols, onChange }: { cols: Col[]; onChange: (c: Col[]) => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away); window.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc) }
  }, [open])
  const move = (i: number, by: number) => { const j = i + by; if (j < 0 || j >= cols.length) return; const n = [...cols]; [n[i], n[j]] = [n[j], n[i]]; onChange(n) }
  const changed = cols.join() !== MOVABLE.join()
  return (
    <div ref={box} className="relative">
      <button type="button" aria-expanded={open} aria-controls="columns-menu" onClick={() => setOpen(v => !v)}
        className="pressable inline-flex items-center gap-1.5 rounded-lg border border-warm-300 bg-white px-3 min-h-[36px] text-body font-medium text-ink hover:bg-warm-100">
        <Columns3 size={15} aria-hidden="true" />Columns
      </button>
      {open && (
        <div id="columns-menu" role="group" aria-label="Column order" className="absolute right-0 z-30 mt-1.5 w-[290px] max-w-[calc(100vw-40px)] rounded-[14px] border border-warm-200 bg-white p-3 shadow-[0_18px_40px_-18px_rgb(29_33_37/0.45)]">
          <p className="text-caption text-warm-600 px-1 pb-2">Project ID and Project stay first. Move the others to where you want them.</p>
          <ol>
            {cols.map((c, i) => (
              <li key={c} className="flex items-center justify-between gap-2 rounded-lg px-1 py-0.5 hover:bg-warm-50">
                <span className="text-body text-ink">{COLS[c].label}</span>
                <span className="flex">
                  <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${COLS[c].label} left`} className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-warm-600 hover:bg-warm-100 disabled:opacity-40"><ArrowLeft size={15} aria-hidden="true" /></button>
                  <button type="button" disabled={i === cols.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${COLS[c].label} right`} className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-warm-600 hover:bg-warm-100 disabled:opacity-40"><ArrowRight size={15} aria-hidden="true" /></button>
                </span>
              </li>
            ))}
          </ol>
          {changed && <div className="pt-2 px-1"><Button variant="ghost" onClick={() => onChange(MOVABLE)}>Put the columns back</Button></div>}
        </div>
      )}
    </div>
  )
}

function ProjectTable({ rows, cols, onReorder, onOpen, pins, onPin, col, setCol, picked, onPick }: {
  rows: PortfolioRow[]; cols: Col[]; onReorder: (c: Col[]) => void
  col: { c: Col; dir: 1 | -1 } | null; setCol: (c: { c: Col; dir: 1 | -1 } | null) => void
  /** Ticked projects (null when the reader may not build a master schedule) */
  picked: string[] | null; onPick: (keys: string[]) => void
} & TableProps) {
  const [drag, setDrag] = useState<Col | null>(null)
  const [over, setOver] = useState<Col | null>(null)
  const [openFor, setOpenFor] = useState<string | null>(null)
  const drop = (target: Col) => {
    if (drag && drag !== target) {
      const n = cols.filter(c => c !== drag)
      n.splice(n.indexOf(target) + (cols.indexOf(drag) < cols.indexOf(target) ? 1 : 0), 0, drag)
      onReorder(n)
    }
    setDrag(null); setOver(null)
  }
  const all: Col[] = [...LOCKED, ...cols]
  const pickable = rows.filter(r => r.scheduleId)
  const allPicked = !!picked && pickable.length > 0 && pickable.every(r => picked.includes(key(r)))
  const span = all.length + (picked ? 2 : 1)
  const cell = (c: Col, r: PortfolioRow) => {
    const st = statusOf(r), v = variance(r), items = openItems(r)
    switch (c) {
      case 'projectId': return <td key={c} className="px-3 py-3 whitespace-nowrap tabular-nums text-warm-700">{r.projectId}</td>
      case 'name': return (
        <td key={c} className="px-3 py-3 min-w-[220px]">
          <button type="button" onClick={() => onOpen(r)} className="text-left font-semibold text-ink hover:underline">{r.title}</button>
          <div className="text-caption text-warm-600">{sourceLine(r)}</div>
        </td>
      )
      case 'status': return <td key={c} className="px-3 py-3 whitespace-nowrap"><span className="inline-flex items-center gap-1.5 text-warm-700"><span className={`w-2 h-2 rounded-full ${st.dot}`} aria-hidden />{st.label}</span></td>
      case 'open': {
        const act = items.filter(a => a.severity === 'error').length, watch = items.length - act
        return (
          <td key={c} className="px-3 py-3 whitespace-nowrap">
            {items.length === 0 ? <span className="text-warm-600">None</span> : (
              <button type="button" aria-expanded={openFor === key(r)} aria-controls={`open-${key(r)}`} onClick={() => setOpenFor(openFor === key(r) ? null : key(r))}
                className="pressable inline-flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 -mx-1.5 hover:bg-warm-100">
                {act > 0 && <span className="rounded-lg bg-status-at-risk-bg px-2 py-0.5 text-caption font-semibold text-status-at-risk">{act} to act on</span>}
                {watch > 0 && <span className="rounded-lg bg-status-attention-bg px-2 py-0.5 text-caption font-semibold text-status-attention">{watch} to watch</span>}
                <ChevronDown size={14} aria-hidden="true" className={`text-warm-600 transition-transform ${openFor === key(r) ? 'rotate-180' : ''}`} />
              </button>
            )}
          </td>
        )
      }
      case 'finish': return <td key={c} className="px-3 py-3 text-right tabular-nums text-ink font-medium whitespace-nowrap">{fmtDate(r.finish)}</td>
      case 'required': return <td key={c} className="px-3 py-3 text-right tabular-nums text-warm-700 whitespace-nowrap">{r.required ? fmtDate(r.required) : '—'}</td>
      case 'variance': return <td key={c} className={`px-3 py-3 text-right whitespace-nowrap font-medium ${v?.cls ?? 'text-warm-600'}`}>{v?.text ?? '—'}</td>
      case 'dataDate': return <td key={c} className={`px-3 py-3 text-right tabular-nums whitespace-nowrap ${isStale(r) ? 'text-status-attention font-semibold' : 'text-warm-700'}`}>{r.dataDate ? fmtDate(r.dataDate) : '—'}</td>
      case 'start': return <td key={c} className="px-3 py-3 text-right tabular-nums text-warm-700 whitespace-nowrap">{fmtDate(r.start)}</td>
      case 'progress': return <td key={c} className="px-3 py-3 text-right tabular-nums text-warm-700">{r.percentComplete == null || r.status === 'not_started' ? '—' : `${Math.round(r.percentComplete)}%`}</td>
      case 'uploads': return <td key={c} className="px-3 py-3 text-right tabular-nums text-warm-700">{r.kind === 'plan' ? '—' : r.updates ?? 1}</td>
      case 'addedBy': return <td key={c} className="px-3 py-3 whitespace-nowrap text-warm-700">{r.addedBy ?? '—'}</td>
      case 'addedAt': return <td key={c} className="px-3 py-3 text-right tabular-nums text-warm-700 whitespace-nowrap">{r.addedAt ? fmtDay(r.addedAt) : '—'}</td>
    }
  }
  return (
    <div className="rounded-[14px] border border-warm-200 bg-white overflow-x-auto" tabIndex={0} role="region" aria-label="Projects table">
      <table className="w-full text-body">
        <caption className="sr-only">Projects. Select a column heading to sort. Project ID and Project stay first; drag any other heading, or use Columns, to move it.</caption>
        <thead>
          <tr className="border-b border-warm-200 text-left">
            {picked && (
              <th scope="col" className="w-10 pl-4">
                <input type="checkbox" aria-label="Select every project that has a schedule" checked={allPicked} disabled={!pickable.length}
                  onChange={() => onPick(allPicked ? picked.filter(k => !pickable.some(r => key(r) === k)) : [...new Set([...picked, ...pickable.map(key)])])} className="h-4 w-4 accent-accent-600" />
              </th>
            )}
            <th scope="col" className="w-10 pl-2"><span className="sr-only">Pinned</span></th>
            {all.map(c => {
              const active = col?.c === c
              const Icon = active ? (col!.dir === 1 ? ArrowUp : ArrowDown) : ArrowUpDown
              const movable = !LOCKED.includes(c)
              return (
                <th key={c} scope="col" aria-sort={active ? (col!.dir === 1 ? 'ascending' : 'descending') : 'none'}
                  onDragOver={movable && drag ? e => { e.preventDefault(); setOver(c) } : undefined} onDragLeave={movable ? () => setOver(o => (o === c ? null : o)) : undefined}
                  onDrop={movable ? e => { e.preventDefault(); drop(c) } : undefined} onDragEnd={() => { setDrag(null); setOver(null) }}
                  className={`px-3 py-3 font-semibold text-warm-600 whitespace-nowrap ${COLS[c].num ? 'text-right' : ''} ${drag === c ? 'opacity-50' : ''} ${over === c && drag && drag !== c ? 'bg-accent-100' : ''}`}>
                  {/* The handle is what is dragged: the heading's text is the sort button, and a browser does not drag a button. */}
                  {movable && (
                    <span draggable data-drag={c} title={`Drag to move ${COLS[c].label}`} onDragStart={e => { setDrag(c); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c) }}
                      className="inline-flex cursor-grab items-center justify-center -ml-2 mr-0.5 h-6 w-4 align-middle text-warm-500 hover:text-ink active:cursor-grabbing"><GripVertical size={13} aria-hidden="true" /></span>
                  )}
                  <button type="button" onClick={() => setCol(active ? (col!.dir === 1 ? { c, dir: -1 } : null) : { c, dir: 1 })}
                    className={`inline-flex items-center gap-1 hover:text-ink ${active ? 'text-ink' : ''}`}>
                    {COLS[c].label}<Icon size={13} aria-hidden className={active ? '' : 'opacity-40'} />
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const k = key(r), items = openItems(r)
            return (
              <Fragment key={k}>
                <tr className="border-b border-warm-200 last:border-0 hover:bg-warm-50 transition-colors">
                  {picked && (
                    <td className="pl-4">
                      <input type="checkbox" checked={picked.includes(k)} disabled={!r.scheduleId} title={r.scheduleId ? undefined : 'This plan has no schedule yet: generate and publish it first.'}
                        aria-label={r.scheduleId ? `Select ${r.title}` : `${r.title} has no schedule yet, so it cannot be selected`}
                        onChange={() => onPick(picked.includes(k) ? picked.filter(x => x !== k) : [...picked, k])} className="h-4 w-4 accent-accent-600 disabled:opacity-40" />
                    </td>
                  )}
                  <td className="pl-2"><PinButton r={r} pinned={pins.includes(k)} onPin={onPin} /></td>
                  {all.map(c => cell(c, r))}
                </tr>
                {openFor === k && items.length > 0 && (
                  <tr id={`open-${k}`} className="border-b border-warm-200 bg-warm-50">
                    <td colSpan={span} className="px-4 py-3 md:pl-16">
                      <ul className="max-w-[900px] space-y-1.5">
                        {items.map((a, i) => (
                          <li key={`${a.code}-${i}`} className="flex items-start gap-3">
                            <span className={`mt-px flex-shrink-0 w-[62px] rounded-lg px-2 py-0.5 text-center text-caption font-semibold ${a.severity === 'error' ? 'bg-status-at-risk-bg text-status-at-risk' : 'bg-status-attention-bg text-status-attention'}`}>{a.severity === 'error' ? 'Act' : 'Watch'}</span>
                            <p className="min-w-0 flex-1 text-body leading-snug text-warm-700 pt-0.5 whitespace-normal">{fmtDates(a.text)}</p>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Builds a master schedule from the ticked projects, or adds them to one that exists. */
function BuildMasterDialog({ rows, onClose, onBuilt }: { rows: PortfolioRow[]; onClose: () => void; onBuilt: (programId: string) => void }) {
  const [programs, setPrograms] = useState<{ id: string; name: string }[]>([])
  const [target, setTarget] = useState('new')
  const [name, setName] = useState(rows.length === 1 ? `${rows[0].title} master schedule` : 'Master schedule')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => { close.current?.focus() }, [])
  useEffect(() => {
    fetch('/api/programs').then(r => (r.ok ? r.json() : { programs: [] })).then(d => setPrograms(d.programs ?? [])).catch(() => {})
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  const build = async () => {
    setBusy(true); setError('')
    const ids = rows.map(r => r.scheduleId!)
    if (target === 'new') {
      const r = await postJson('/api/programs', { name, scheduleIds: ids })
      setBusy(false)
      if (!r.ok) { setError(r.data.error || 'The master schedule was not built. Try again.'); return }
      onBuilt((r.data.program as { id: string }).id)
      return
    }
    for (const id of ids) {
      const r = await postJson(`/api/programs/${target}/projects`, { scheduleId: id })
      // A project that is already in that master schedule is left as it is.
      if (!r.ok && r.status !== 409) { setBusy(false); setError(r.data.error || 'A project was not added. Try again.'); return }
    }
    setBusy(false)
    onBuilt(target)
  }
  return createPortal(
    <div className={`${digitsFont.variable} font-sans fixed inset-0 z-50 overflow-y-auto bg-navy-950/45 p-3 md:p-8 flex justify-center items-start`} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="build-h" className="relative w-full max-w-xl rounded-2xl bg-warm-50 border border-warm-200 p-5 md:p-6 space-y-4 shadow-[0_24px_60px_-20px_rgb(29_33_37/0.45)]">
        <button ref={close} type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 inline-flex items-center justify-center w-10 h-10 rounded-lg text-ink hover:bg-warm-200"><X size={18} aria-hidden="true" /></button>
        <div className="pr-10">
          <h2 id="build-h" className="text-heading font-semibold text-ink">Build a master schedule</h2>
          <p className="text-body text-warm-600 mt-1">RunF9 reads the milestones these schedules share and keeps the master up to date: each time a new update of a project is uploaded, its dates on the master change with it.</p>
        </div>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <ul className="rounded-[14px] border border-warm-200 bg-white divide-y divide-warm-200">
          {rows.map(r => <li key={key(r)} className="px-4 py-2 text-body"><span className="font-semibold text-ink">{r.title}</span> <span className="text-warm-600">{r.projectId}</span></li>)}
        </ul>
        {programs.length > 0 && (
          <Field label="Where">{p => (
            <select {...p} value={target} onChange={e => setTarget(e.target.value)} className={inputClass}>
              <option value="new">A new master schedule</option>
              {programs.map(x => <option key={x.id} value={x.id}>Add to: {x.name}</option>)}
            </select>
          )}</Field>
        )}
        {target === 'new' && <Field label="Name">{p => <input {...p} value={name} onChange={e => setName(e.target.value)} maxLength={120} className={inputClass} />}</Field>}
        <div className="flex gap-2">
          <Button onClick={build} disabled={busy || (target === 'new' && name.trim().length < 2)}>{busy ? 'Building…' : target === 'new' ? 'Build' : 'Add'}</Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>, document.body)
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
        className="pressable inline-flex max-w-full items-center gap-1.5 rounded-lg border border-warm-200 bg-white px-3 py-1.5 text-body text-warm-600 hover:border-warm-300 hover:text-ink">
        <Cloud size={14} aria-hidden className="flex-shrink-0" />
        <span className="sr-only">Data storage: </span>
        <span className="truncate font-semibold text-ink">{loc.label}</span>
        <ChevronDown size={14} aria-hidden className={`flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div id={pid} role="region" aria-label="Data storage" data-open={open} className="disclosure-panel" inert={!open || undefined}>
        <div className="disclosure-inner">
          <div className="mt-2 max-w-xl rounded-2xl border border-warm-200 bg-white p-4 text-body leading-relaxed">
            <dl className="space-y-2">
              <div><dt className="font-semibold text-ink">Stored in</dt><dd className="text-warm-700">{loc.database}</dd></div>
              <div><dt className="font-semibold text-ink">Document search</dt><dd className="text-warm-700">{loc.documentSearch}</dd></div>
            </dl>
            <Link href="/dashboard/org#cloud-storage" className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-3.5 py-2 text-body font-semibold text-white hover:bg-accent-700">
              Connect AWS, Azure or Google Cloud
            </Link>
            <p className="mt-2 text-caption text-warm-600">Keep schedule files and originals in your own cloud storage. Organization admins set this up.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
