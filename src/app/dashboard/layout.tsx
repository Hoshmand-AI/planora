'use client'

import { AskTextHost } from '@/components/AskText'
import { useState, useEffect, createContext, useContext, useCallback, useRef, Suspense, Fragment } from 'react'
import type { DataLocation } from '@/lib/server/data-location'
import { FileSourcePicker } from '@/components/FileSourcePicker'
import Link from 'next/link'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import {
  LayoutGrid, Plus, BarChart3, Upload,
  LogOut, X, ChevronDown, Lock, UserCog, Building2, KeyRound, MailCheck, PanelLeftClose, PanelLeftOpen, Trash2,
} from 'lucide-react'
import { fmtDate } from '@/lib/format'
import { PROJECT_TYPES, PROJECT_TYPE_LABELS } from '@/lib/planning/types'
import { Logo } from '@/components/Logo'
import { WorkspaceSelect } from '@/components/WorkspaceSelect'
import { PROVIDER_LABEL, type ProviderName } from '@/lib/llm/gateway'
import { ImportExceptions } from '@/components/ImportExceptions'
import { MoreMenu } from '@/components/MoreMenu'
import { tooLargeMessage } from '@/lib/upload-limit'
import type { ExceptionReport } from '@/lib/parsers/exceptions'

/* ─── Types ─────────────────────────────────────────── */
interface User     { id: string; email: string; name: string; plan: string; role?: string }
interface Schedule {
  id: string; name: string; version: string; activityCount: number
  uploadedAt: string; varianceDays: number | null; criticalCount: number
  percentComplete: number; sourceType: string
  projectStart: string | null; projectFinish: string | null; dataDate: string | null
  analysis?: { progressMode?: string; status?: string } | null
  inHistory?: boolean
  classification?: string | null
  uploadOrigin?: string | null
  historyOverride?: boolean
}

interface AppContextType {
  user: User | null
  schedules: Schedule[]
  selectedSchedule: Schedule | null
  setSelectedSchedule: (s: Schedule | null) => void
  refreshSchedules: () => Promise<void>
  metrics: Record<string, unknown> | null
  refreshMetrics: () => Promise<void>
  /** The open project's numbers could not be loaded (metrics is null): pages say so instead of waiting forever */
  metricsError: boolean
  /** Organization the user belongs to */
  org: { id: string; name: string; dataLocation?: DataLocation } | null
  /** What the user's role allows (read, plan.write, schedule.write, plan.review, …) */
  can: (permission: string) => boolean
  /** Opens the upload dialog (empty states use it as their one action); without upload rights it opens Build */
  openUpload: () => void
}

const AppContext = createContext<AppContextType>({
  user: null, schedules: [], selectedSchedule: null, setSelectedSchedule: () => {},
  refreshSchedules: async () => {}, metrics: null, refreshMetrics: async () => {}, metricsError: false,
  org: null, can: () => false, openUpload: () => {},
})

export const useApp = () => useContext(AppContext)

/* ─── Navigation ─────────────────────────────────────── */
// Level 1 (sidebar): where you are in the firm. Level 2 (project tabs): what you are looking at in
// one project. Every project page names its project in the URL (?schedule=<id>).
const NAV = [
  { href: '/dashboard',         icon: LayoutGrid,    label: 'Projects' },
  { href: '/dashboard/plan',    icon: Plus,          label: 'New project' },
  { href: '/dashboard/history', icon: BarChart3,     label: 'Firm insights' },
  { href: '/dashboard/org',     icon: Building2,     label: 'Organization' },
]
/** Tabs inside one uploaded project, in the order a scheduler works. */
export const PROJECT_TABS = [
  { href: '/dashboard/today',       label: 'Today' },
  { href: '/dashboard/project',     label: 'Overview' },
  { href: '/dashboard/timeline',    label: 'Schedule' },
  { href: '/dashboard/quality',     label: 'Quality' },
  { href: '/dashboard/time-impact', label: 'Delays' },
  { href: '/dashboard/resources',   label: 'Resources' },
  { href: '/dashboard/documents',   label: 'Documents' },
  { href: '/dashboard/reports',     label: 'Reports' },
  { href: '/dashboard/ask',         label: 'Ask AI' },
]
/** Pages that work on one uploaded schedule: they show the project header and tabs. */
const SCHEDULE_PAGES = PROJECT_TABS.map(t => t.href)
const isProjectPage = (pathname: string) => SCHEDULE_PAGES.some(p => pathname.startsWith(p))

const navActive = (pathname: string, href: string) =>
  href === '/dashboard' ? pathname === '/dashboard' || pathname.startsWith('/dashboard/portfolio') || isProjectPage(pathname) || /^\/dashboard\/plan\/./.test(pathname)
  : href === '/dashboard/plan' ? pathname === '/dashboard/plan'
  : pathname.startsWith(href)

const STATUS_PILL: Record<string, { label: string; cls: string; dot: string }> = {
  at_risk: { label: 'At risk', cls: 'text-status-at-risk bg-status-at-risk-bg', dot: 'bg-status-at-risk' },
  attention: { label: 'Needs attention', cls: 'text-status-attention bg-status-attention-bg', dot: 'bg-status-attention' },
  on_track: { label: 'On track', cls: 'text-status-on-track bg-status-on-track-bg', dot: 'bg-status-on-track' },
  complete: { label: 'Complete', cls: 'text-status-on-track bg-status-on-track-bg', dot: 'bg-status-on-track' },
  no_baseline: { label: 'No baseline yet', cls: 'text-warm-700 bg-warm-100', dot: 'bg-warm-400' },
}

interface LlmStatus { mode: 'cloud' | 'local' | 'offline'; airgapped: boolean; provider?: ProviderName | null; model: string | null; certified?: boolean; host: string | null; error?: string }
/** "claude-opus-5-5 (Anthropic (Claude))", plus a note when the model is an approved alternate rather than certified. */
const modelLine = (l: LlmStatus) => `${l.model}${l.provider ? ` · ${PROVIDER_LABEL[l.provider]}` : ''}${l.certified === false ? ' · approved alternate (not certified; quality may differ)' : ''}`
const aiLabel = (l: LlmStatus | null) => !l ? '' : l.mode === 'cloud' ? 'Cloud AI' : l.mode === 'local' ? 'On-prem AI' : 'AI offline'

/** Schedule id a deep link asks for: /dashboard/project?schedule=<id> (Home links) or ?id=<id>; old /dashboard?schedule= links too. */
function deepLinkedScheduleId(pathname: string, params: { get(name: string): string | null }): string | null {
  if (pathname !== '/dashboard' && !isProjectPage(pathname)) return null
  return params.get('schedule') || params.get('id') || null
}

/** Opens the schedule a deep link names once the list is loaded (and again whenever the link changes). */
function ScheduleDeepLink({ schedules, loaded, select, onMissing }: { schedules: Schedule[]; loaded: boolean; select: (s: Schedule) => void; onMissing: (missing: boolean) => void }) {
  const pathname = usePathname()
  const params = useSearchParams()
  const wanted = deepLinkedScheduleId(pathname, params)
  const applied = useRef<string | null>(null)
  useEffect(() => {
    if (!wanted || applied.current === wanted) return
    const s = schedules.find(x => x.id === wanted)
    if (!s) return
    applied.current = wanted
    select(s)
  }, [wanted, schedules, select])
  // The link names a project that is not in this user's list (deleted, or another organization's).
  useEffect(() => { onMissing(!!wanted && loaded && !schedules.some(x => x.id === wanted)) }, [wanted, loaded, schedules, onMissing])
  return null
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** A modal dialog: named by its heading, takes focus when it opens, keeps Tab inside, closes on Escape and gives focus back. */
function Dialog({ labelledBy, onClose, className, children }: { labelledBy: string; onClose: () => void; className: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    ref.current?.focus()
    return () => { if (before && document.contains(before)) before.focus() }
  }, [])
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
    if (e.key !== 'Tab' || !ref.current) return
    const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.offsetParent !== null)
    if (!items.length) { e.preventDefault(); return }
    const first = items[0], last = items[items.length - 1], at = document.activeElement
    if (e.shiftKey && (at === first || at === ref.current)) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus() }
  }
  return (
    <div className="fixed inset-0 bg-black/55 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} onKeyDown={onKeyDown} className={`${className} focus:outline-none`}>
        {children}
      </div>
    </div>
  )
}

/* ─── Layout ─────────────────────────────────────────── */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter()
  const pathname = usePathname()

  const [user,             setUser]             = useState<User | null>(null)
  const [schedules,        setSchedules]        = useState<Schedule[]>([])
  const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(null)
  const [metrics,          setMetrics]          = useState<Record<string, unknown> | null>(null)
  const [authError,        setAuthError]        = useState(false)
  const [metricsError,     setMetricsError]     = useState(false)
  const [schedulesLoaded,  setSchedulesLoaded]  = useState(false)
  const [schedulesError,   setSchedulesError]   = useState(false)
  const [linkMissing,      setLinkMissing]      = useState(false)

  const [showUpload,       setShowUpload]       = useState(false)
  const [showScheduleList, setShowScheduleList] = useState(false)
  const [showSettings,     setShowSettings]     = useState(false)
  const [uploading,        setUploading]        = useState(false)
  const [uploadError,      setUploadError]      = useState('')
  const [uploadSummary,    setUploadSummary]    = useState<{ activitiesImported: number; relationshipsImported: number; calendarsImported: number; classifiedPct: number; dataQuestions: number; warnings: string[]; importExceptions?: ExceptionReport | null } | null>(null)
  const [llm,              setLlm]              = useState<LlmStatus | null>(null)
  const [org,              setOrg]              = useState<{ id: string; name: string; dataLocation?: DataLocation } | null>(null)
  const [permissions,      setPermissions]      = useState<string[]>([])
  const [mfaSetupRequired, setMfaSetupRequired] = useState(false)
  const [emailUnconfirmed, setEmailUnconfirmed] = useState(false)
  const [platformAdmin,    setPlatformAdmin]    = useState(false)
  const [emailWhy,         setEmailWhy]         = useState(false)
  const [resend,           setResend]           = useState<{ busy: boolean; note: string; ok: boolean }>({ busy: false, note: '', ok: false })
  const can = useCallback((p: string) => permissions.includes(p), [permissions])
  const inProject = isProjectPage(pathname)
  // Ask AI is a chat: on screens tall enough, the page is exactly one screen high and only the conversation scrolls.
  const fillScreen = pathname.startsWith('/dashboard/ask')
  // Sidebar: a full 240px panel on desktops, a 72px icon rail on tablets (iPad portrait), and the user's
  // own choice once they press the collapse/expand button (remembered in this browser).
  const [railPref, setRailPref] = useState<'open' | 'closed' | null>(null)
  const [wide, setWide] = useState(true)
  useEffect(() => {
    try { const v = localStorage.getItem('runf9.sidebar'); if (v === 'open' || v === 'closed') setRailPref(v) } catch { /* storage blocked */ }
    const mq = window.matchMedia('(min-width: 1024px)')
    const on = () => setWide(mq.matches)
    on(); mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const sidebarOpen = railPref ? railPref === 'open' : wide
  const tabsRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const nav = tabsRef.current, here = nav?.querySelector<HTMLElement>('[aria-current="page"]')
    if (nav && here && (here.offsetLeft + here.offsetWidth > nav.scrollLeft + nav.clientWidth - 40 || here.offsetLeft < nav.scrollLeft)) {
      nav.scrollTo({ left: Math.max(0, here.offsetLeft - 24) })
    }
  }, [pathname])
  const toggleSidebar = () => {
    const next = sidebarOpen ? 'closed' : 'open'
    setRailPref(next)
    try { localStorage.setItem('runf9.sidebar', next) } catch { /* storage blocked */ }
  }

  /* ── Auth ── */
  useEffect(() => {
    fetch('/api/auth').then(r => r.json()).then(data => {
      if (!data.user) { router.push('/auth'); return }
      setUser(data.user)
      setOrg(data.org ?? null)
      setPermissions(data.permissions ?? [])
      setMfaSetupRequired(!!data.security?.mfaSetupRequired)
      setEmailUnconfirmed(!!data.security?.emailDelivery && !data.security?.emailVerified)
      setPlatformAdmin(data.platformAdmin === true)
    }).catch(() => setAuthError(true))
  }, [router])

  // The organization requires two-step verification: everything else waits until it's set up.
  // Two-step verification may have just been turned on (Account page), so ask again before sending anyone back there.
  useEffect(() => {
    if (!mfaSetupRequired || pathname === '/dashboard/account') return
    let live = true
    fetch('/api/auth').then(r => (r.ok ? r.json() : null)).catch(() => null).then(data => {
      if (!live) return
      if (data?.user && data.security && !data.security.mfaSetupRequired) setMfaSetupRequired(false)
      else router.push('/dashboard/account?setup=mfa')
    })
    return () => { live = false }
  }, [mfaSetupRequired, pathname, router])

  /* ── Data ── */
  const loadSchedules = useCallback(async (honorLink: boolean) => {
    // A failed load is not "no projects": keep what is on screen and say the list could not be loaded.
    const res  = await fetch('/api/schedules').catch(() => null)
    const data = res?.ok ? await res.json().catch(() => null) : null
    if (!data || !Array.isArray(data.schedules)) { setSchedulesError(true); return }
    const list: Schedule[] = data.schedules
    setSchedulesError(false)
    setSchedulesLoaded(true)
    setSchedules(list)
    setSelectedSchedule(cur => {
      if (cur) {
        // Keep the open project, with what was just saved on it (classification, progress mode, label…).
        // The same object is kept when nothing changed, so effects keyed on it do not run again.
        const fresh = list.find(s => s.id === cur.id)
        return fresh && JSON.stringify(fresh) !== JSON.stringify(cur) ? fresh : cur
      }
      if (!list.length) return cur
      // Honor a deep link on first load instead of flashing the newest schedule.
      const wanted = !honorLink || typeof window === 'undefined' ? null : deepLinkedScheduleId(window.location.pathname, new URLSearchParams(window.location.search))
      // A link to a project that is not in the list opens nothing (the header says so), never a different project.
      if (wanted) return list.find(s => s.id === wanted) ?? null
      return list[0]
    })
  }, [])
  const refreshSchedules = useCallback(() => loadSchedules(true), [loadSchedules])

  // Only the latest selection's metrics may land (a slower earlier request must not overwrite them).
  const metricsFor = useRef<string | null>(null)
  const refreshMetrics = useCallback(async () => {
    metricsFor.current = selectedSchedule?.id ?? null
    setMetricsError(false)
    if (!selectedSchedule) { setMetrics(null); return }
    const id = selectedSchedule.id
    // Never show one project's numbers under another project's name while the new ones load.
    setMetrics(m => (m && m.scheduleId === id ? m : null))
    try {
      const res  = await fetch(`/api/schedules?id=${id}`)
      const data = await res.json()
      if (metricsFor.current !== id) return
      setMetrics(data.metrics ? { ...data.metrics, scheduleId: id, brief: data.brief ?? null, warnings: data.schedule?.warnings ?? [] } : null)
      if (!data.metrics) setMetricsError(true)
    } catch {
      if (metricsFor.current === id) { setMetrics(null); setMetricsError(true) }
    }
  }, [selectedSchedule])

  // How many things on the open project need action today (the Today tab carries the count).
  const [todayCount, setTodayCount] = useState(0)
  const onToday = pathname.startsWith('/dashboard/today')
  useEffect(() => {
    setTodayCount(0)
    if (!selectedSchedule || !user || mfaSetupRequired) return
    let live = true
    // The viewer's own date (the server's clock is UTC), and only refetched on a project switch or when the Today tab is entered or left.
    const d = new Date(), asOf = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    fetch(`/api/schedules/${encodeURIComponent(selectedSchedule.id)}/brief?asOf=${asOf}`).then(r => (r.ok ? r.json() : null))
      .then(d => { if (live && d) setTodayCount((d.alerts as { level: string }[]).filter(a => a.level === 'act').length) }).catch(() => {})
    return () => { live = false }
  }, [selectedSchedule, user, mfaSetupRequired, onToday])

  // Removes the open upload (wrong file, or one that must not be here). The server audits it.
  const deleteUpload = async () => {
    const s = selectedSchedule
    if (!s || !confirm(`Delete "${s.name} (${s.version})"?\n\nThis removes the upload, its activities, the edits made in RunF9 and its analysis for everyone in your organization. It cannot be undone.`)) return
    const res = await fetch(`/api/schedules?id=${encodeURIComponent(s.id)}`, { method: 'DELETE' }).catch(() => null)
    if (!res?.ok) { const d = res ? await res.json().catch(() => ({})) : {}; alert(d.error || 'The upload was not deleted. Try again.'); return }
    setSelectedSchedule(null); setMetrics(null)
    await loadSchedules(false) // the address still names the upload that was just deleted
    router.push('/dashboard')
  }

  useEffect(() => { if (user && !mfaSetupRequired) refreshSchedules() }, [user, mfaSetupRequired, refreshSchedules])
  useEffect(() => { if (user && !mfaSetupRequired) fetch('/api/system').then(r => r.json()).then(d => setLlm(d.llm || null)).catch(() => {}) }, [user])
  useEffect(() => { if (selectedSchedule) refreshMetrics() }, [selectedSchedule, refreshMetrics])

  /* ── Upload ── */
  const handleUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setUploading(true)
    setUploadError('')
    const form = new FormData(e.currentTarget)
    try {
      const res  = await fetch('/api/schedules', { method: 'POST', body: form })
      // The hosting platform refuses an oversized body with its own non-JSON 413 page.
      if (res.status === 413 && !res.headers.get('content-type')?.includes('application/json')) { setUploadError(tooLargeMessage('schedule')); return }
      const data = await res.json()
      if (!res.ok) { setUploadError(data.error); return }
      await refreshSchedules()
      setSelectedSchedule(data.schedule)
      setUploadSummary(data.summary)
      // Open the new upload: on its project page, or on the same tab of the project when it is an update.
      router.push(`${inProject ? pathname : '/dashboard/project'}?schedule=${data.schedule.id}`)
    } catch {
      setUploadError('Upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  const resendConfirmation = async () => {
    setResend({ busy: true, note: '', ok: false })
    try {
      const res = await fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'resend_verification' }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setResend({ busy: false, note: data.error || 'We could not send the email right now. Try again shortly.', ok: false }); return }
      if (data.alreadyVerified) { setResend({ busy: false, note: '', ok: true }); setEmailUnconfirmed(false); return }
      setResend({ busy: false, note: 'Sent — check your inbox (and spam).', ok: true })
    } catch {
      setResend({ busy: false, note: 'Network error. Please try again.', ok: false })
    }
  }

  const handleSignOut = async () => {
    await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'signout' }) })
    router.push('/')
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-warm-50 flex items-center justify-center px-6">
        {authError ? (
          <div role="alert" className="max-w-sm text-center">
            <p className="text-[15px] text-navy-950 font-semibold">RunF9 could not load.</p>
            <p className="text-[14px] text-warm-600 mt-1">Check your connection and try again.</p>
            <button type="button" onClick={() => window.location.reload()} className="mt-4 bg-accent-600 text-white px-5 py-2 rounded-full text-[14px] font-semibold hover:bg-accent-700">Try again</button>
          </div>
        ) : (
          <div className="text-warm-600 text-[14px]">Loading…</div>
        )}
      </div>
    )
  }

  const openUpload = () => { setUploadSummary(null); setUploadError(''); setShowUpload(true) }
  // Sidebar: the five most recent projects (one entry per project name, its latest upload)
  const recent = schedules.filter(s => s.sourceType !== 'generated')
    .filter((s, i, all) => all.findIndex(x => x.name === s.name) === i).slice(0, 5)
  const sourceLabel = (t: string) => ({ p6_xer: 'P6', p6_xml: 'P6 XML', ms_xml: 'MS Project', pdf: 'PDF', excel: 'Excel', csv: 'CSV', generated: 'Built in RunF9' } as Record<string, string>)[t] || t

  return (
    <AppContext.Provider value={{ user, schedules, selectedSchedule, setSelectedSchedule, refreshSchedules, metrics, refreshMetrics, metricsError, org, can, openUpload: can('schedule.write') ? openUpload : () => router.push('/dashboard/plan') }}>
      <Suspense fallback={null}><ScheduleDeepLink schedules={schedules} loaded={schedulesLoaded} select={setSelectedSchedule} onMissing={setLinkMissing} /></Suspense>
      {/*
       * LAYOUT STRATEGY
       * ─────────────────────────────────────────────────────────
       * Mobile  (< md): sticky top header + bottom tab bar
       *   - Top bar: logo + schedule pill + upload button
       *   - Bottom bar: 4 tabs with icons + labels
       *   - Content fills viewport between the two bars
       *
       * Desktop (≥ md): sticky top header with tabs inline
       *   - Single header: logo | schedule pill | upload | avatar
       *   - Tab row beneath (horizontal, text+icon)
       *   - Content area is full-width scrollable
       * ─────────────────────────────────────────────────────────
       */}
      <div className={`min-h-screen bg-warm-50 md:flex ${fillScreen ? '[@media(min-height:640px)]:min-h-0' : ''}`}>
        <a href="#main" className="skip-link">Skip to content</a>

        {/* ── Sidebar (desktop) ─────────────────────────────── */}
        <aside className={`hidden md:flex md:flex-col flex-shrink-0 bg-navy-900 text-white sticky top-0 h-screen py-5 z-30 transition-[width] duration-300 ${sidebarOpen ? 'w-[240px] px-3' : 'w-[72px] px-2.5'}`}>
          <div className={`flex items-center pb-6 flex-shrink-0 ${sidebarOpen ? 'justify-between pl-2.5' : 'flex-col gap-3'}`}>
            <Link href="/dashboard" aria-label="RunF9 projects">
              <Logo variant="light" size="text-[21px]" mark={!sidebarOpen} />
            </Link>
            <button type="button" onClick={toggleSidebar} aria-expanded={sidebarOpen} title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
              className="grid place-items-center w-9 h-9 rounded-lg text-warm-200 hover:bg-navy-800 hover:text-white transition-colors">
              {sidebarOpen ? <PanelLeftClose size={18} aria-hidden="true" /> : <PanelLeftOpen size={18} aria-hidden="true" />}
              <span className="sr-only">{sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}</span>
            </button>
          </div>
          <nav aria-label="Main" className="flex flex-col gap-1 min-h-0">
            {NAV.map(n => {
              const active = navActive(pathname, n.href)
              return (
                <div key={n.href}>
                  <Link href={n.href} aria-current={active ? 'page' : undefined} title={sidebarOpen ? undefined : n.label}
                    className={`relative flex items-center gap-3 py-2.5 rounded-xl text-[14.5px] transition-colors ${sidebarOpen ? 'px-3' : 'justify-center px-0'} ${active ? 'bg-navy-800 text-white font-semibold' : 'text-warm-200 font-medium hover:bg-navy-800/70 hover:text-white'}`}>
                    {active && <span aria-hidden="true" className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-accent-400" />}
                    <n.icon size={sidebarOpen ? 17 : 19} aria-hidden="true" className={active ? 'text-accent-400' : undefined} /><span className={sidebarOpen ? undefined : 'sr-only'}>{n.label}</span>
                  </Link>
                  {sidebarOpen && n.href === '/dashboard' && recent.length > 0 && (
                    <ul aria-label="Recent projects" className="mt-1 mb-2 ml-[38px] flex flex-col">
                      {recent.map(s => {
                        const here = inProject && selectedSchedule?.id === s.id
                        return (
                          <li key={s.id}>
                            <Link href={`/dashboard/project?schedule=${s.id}`} onClick={() => setSelectedSchedule(s)} aria-current={here ? 'page' : undefined}
                              className={`block truncate py-1.5 text-[13.5px] transition-colors ${here ? 'text-white font-semibold' : 'text-warm-200 hover:text-white'}`}>{s.name}</Link>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )
            })}
          </nav>
          <div className="mt-auto pt-4 border-t border-navy-800 flex flex-col gap-2">
            {llm && (
              <span title={llm.error || (llm.model ? `${modelLine(llm)} @ ${llm.host}` : 'Deterministic analysis only: scheduling, CPM, quality checks and reports still work')}
                className={`flex items-center gap-2 text-[12px] font-medium text-warm-200 ${sidebarOpen ? 'px-3' : 'justify-center [&>span:last-child]:sr-only'}`}>
                {llm.airgapped ? <Lock size={11} aria-hidden="true" /> : <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${llm.mode === 'offline' ? 'bg-warm-300' : 'bg-accent-400'}`} />}
                <span>{aiLabel(llm)}{llm.airgapped ? ' · air-gapped' : ''}</span>
              </span>
            )}
            {/* The accessible name includes the visible name and firm (WCAG 2.5.3 label in name). */}
            <button type="button" onClick={() => setShowSettings(true)}
              className={`flex items-center gap-3 py-2 rounded-xl text-left hover:bg-navy-800 transition-colors ${sidebarOpen ? 'px-2.5' : 'justify-center px-0'}`}>
              <span className="sr-only">Account menu: </span>
              <span aria-hidden="true" className="w-8 h-8 rounded-full bg-navy-700 flex items-center justify-center text-[13px] font-bold flex-shrink-0">{user.name?.[0]?.toUpperCase() || 'U'}</span>
              <span className={sidebarOpen ? 'min-w-0' : 'sr-only'}>
                <span className="block text-[13.5px] font-semibold truncate">{user.name}</span>
                {org && <span className="block text-[12px] text-warm-200 truncate">{org.name}</span>}
              </span>
            </button>
          </div>
        </aside>

        <div className={`flex-1 min-w-0 flex flex-col min-h-screen ${fillScreen ? '[@media(min-height:640px)]:min-h-0 [@media(min-height:640px)]:h-[100dvh]' : ''}`}>
          {/* ── Top bar (phones) ─────────────────────────────── */}
          <header className="md:hidden glass-bar sticky top-0 z-40 h-14 flex items-center justify-between px-4 border-b border-white/5">
            <Link href="/dashboard" aria-label="RunF9 projects"><Logo variant="light" size="text-[21px]" /></Link>
            <button type="button" onClick={() => setShowSettings(true)} aria-label={`Account menu for ${user.name}`}
              className="w-8 h-8 rounded-full bg-navy-800 border border-white/15 flex items-center justify-center text-[12px] font-bold text-white">{user.name?.[0]?.toUpperCase() || 'U'}</button>
          </header>

          {/* ── Project header: one project's name, status and tabs ── */}
          {inProject && (
            <div className="bg-white border-b border-warm-200 md:sticky md:top-0 z-20">
              <div className="max-w-6xl mx-auto px-5 md:px-8 pt-4 md:pt-5">
                {selectedSchedule ? (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <nav aria-label="Breadcrumb" className="text-[13px] text-warm-600">
                        <Link href="/dashboard" className="hover:text-navy-950">Projects</Link>
                        <span aria-hidden="true"> / </span>
                        <button type="button" onClick={() => setShowScheduleList(true)} className="inline-flex items-center gap-1 hover:text-navy-950" aria-label={`Switch project (current: ${selectedSchedule.name})`}>
                          Switch project <ChevronDown size={12} aria-hidden="true" />
                        </button>
                      </nav>
                      {/* On a phone the name keeps to one line, so the page under it starts sooner. */}
                      <div className="flex items-center gap-x-3 gap-y-1.5 mt-1 md:flex-wrap">
                        <h1 className="page-title min-w-0 max-md:truncate max-md:text-[20px]" title={selectedSchedule.name}>{selectedSchedule.name}</h1>
                        {(() => {
                          const st = STATUS_PILL[selectedSchedule.analysis?.status ?? '']
                          return st ? <span className={`flex-shrink-0 inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-2.5 py-1 rounded-full ${st.cls}`}><span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} aria-hidden="true" />{st.label}</span> : null
                        })()}
                      </div>
                      <p className="text-[13px] text-warm-600 mt-1 max-md:truncate">
                        {selectedSchedule.version} · {sourceLabel(selectedSchedule.sourceType)} · {selectedSchedule.activityCount.toLocaleString()} activities{selectedSchedule.dataDate ? <> · data date <span className="tabular-nums">{fmtDate(selectedSchedule.dataDate)}</span></> : null}
                      </p>
                    </div>
                    {can('schedule.write') && selectedSchedule.sourceType !== 'generated' && (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button type="button" onClick={openUpload} className="pressable hidden md:inline-flex items-center gap-1.5 rounded-full border border-warm-300 bg-white text-navy-950 px-4 min-h-[40px] text-[13.5px] font-semibold hover:bg-warm-100">
                          <Upload size={14} aria-hidden="true" /> Upload update
                        </button>
                        {/* Deleting sits in a menu, not beside the main action; on a phone the upload joins it. */}
                        <MoreMenu label="More actions for this upload" items={[
                          { label: 'Upload update', onSelect: openUpload, icon: <Upload size={15} aria-hidden="true" />, className: 'md:hidden' },
                          { label: 'Delete this upload', onSelect: deleteUpload, icon: <Trash2 size={15} aria-hidden="true" />, danger: true },
                        ]} />
                      </div>
                    )}
                  </div>
                ) : (
                  <p role={linkMissing ? 'alert' : undefined} className="text-[14px] text-warm-600 pb-2">{linkMissing && <span className="text-navy-950 font-medium">This project was not found. It may have been deleted, or you may not have access to it. </span>}<Link href="/dashboard" className="text-accent-600 font-medium hover:underline">Choose a project</Link> to see this page.</p>
                )}
                {/* Tabs scroll sideways on narrow screens: the right edge fades to show there are more, and the current tab is scrolled into view */}
                <nav ref={tabsRef} aria-label="Project" className="relative flex gap-1 overflow-x-auto -mx-1 mt-3 [mask-image:linear-gradient(to_right,#000_calc(100%-40px),transparent)] lg:[mask-image:none]">
                  {PROJECT_TABS.map(t => {
                    const here = pathname.startsWith(t.href)
                    return (
                      <Fragment key={t.href}>
                      <Link href={selectedSchedule ? `${t.href}?schedule=${selectedSchedule.id}` : t.href} aria-current={here ? 'page' : undefined}
                        className={`relative whitespace-nowrap px-3 py-3 text-[14px] transition-colors ${here ? 'text-navy-950 font-semibold' : 'text-warm-600 font-medium hover:text-navy-950'}`}>
                        {t.label}
                        <span aria-hidden="true" className={`absolute left-3 right-3 -bottom-px h-[2px] rounded-full bg-accent-600 origin-left transition-transform duration-300 ${here ? 'scale-x-100' : 'scale-x-0'}`} />
                      </Link>
                      {/* How many things need action today: beside the tab, not inside it, so the tab is still named "Today". */}
                      {t.href === '/dashboard/today' && todayCount > 0 && <span aria-hidden="true" className="self-center -ml-2 mr-1 inline-block min-w-[18px] rounded-full bg-status-at-risk px-1 text-center text-[12px] font-bold leading-[18px] text-white">{todayCount}</span>}
                      </Fragment>
                    )
                  })}
                </nav>
              </div>
            </div>
          )}

          {/* ── Main content ────────────────────────────────── */}
          {/* pb-20 on phones = space for the bottom bar */}
          <main id="main" tabIndex={-1} className={`flex-1 min-w-0 overflow-x-clip pb-20 md:pb-0 focus:outline-none ${fillScreen ? 'flex flex-col [@media(min-height:640px)]:min-h-0' : ''}`}>
            {emailUnconfirmed && pathname !== '/dashboard/account' && (
              <div role="region" aria-label="Email confirmation" className="bg-warm-100 border-b border-warm-200 px-4 md:px-8 py-2 text-[13px] text-warm-700">
                <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-x-3 gap-y-1">
                  <MailCheck size={14} aria-hidden="true" className="text-accent-600 flex-shrink-0" />
                  <span>Please confirm your email. We sent you a link.</span>
                  <button type="button" disabled={resend.busy} onClick={resendConfirmation} className="font-medium text-accent-600 hover:underline disabled:opacity-60 disabled:cursor-wait">
                    {resend.busy ? 'Sending…' : 'Resend the link'}
                  </button>
                  <button type="button" aria-expanded={emailWhy} aria-controls="email-why" onClick={() => setEmailWhy(w => !w)} className="text-warm-600 underline decoration-warm-300 underline-offset-2 hover:text-navy-950">Why?</button>
                  <span role="status" aria-live="polite" className={resend.ok ? 'text-warm-700' : 'text-status-at-risk'}>{resend.note}</span>
                  <span id="email-why" hidden={!emailWhy} className="basis-full text-[12.5px] text-warm-600">Until then, inviting people, API keys and data export are paused.</span>
                </div>
              </div>
            )}
            {schedulesError && (
              <p role="alert" className="bg-status-at-risk-bg border-b border-status-at-risk px-4 md:px-8 py-2 text-[13px] text-status-at-risk">
                Your projects could not be loaded. <button type="button" onClick={() => { refreshSchedules() }} className="underline font-medium">Try again</button>
              </p>
            )}
            <div key={pathname} className={`max-w-6xl mx-auto md:px-3 page-enter ${fillScreen ? 'w-full flex-1 flex flex-col [@media(min-height:640px)]:min-h-0' : ''}`}>
              {children}
              <AskTextHost />
            </div>
          </main>
        </div>

        {/* ── Bottom bar (phones) ──────────────────────────────── */}
        <nav aria-label="Main (mobile)" className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-navy-950 border-t border-navy-800 safe-area-bottom">
          <div className="flex">
            {NAV.map(n => {
              const active = navActive(pathname, n.href)
              return (
                <Link key={n.href} href={n.href} aria-current={active ? 'page' : undefined}
                  className={`flex-1 min-w-0 flex flex-col items-center gap-1 py-2.5 transition-colors ${active ? 'text-white' : 'text-warm-200'}`}>
                  <n.icon size={19} strokeWidth={active ? 2.2 : 1.7} aria-hidden="true" />
                  <span className={`text-[12px] ${active ? 'font-semibold' : 'font-medium'}`}>{n.label === 'New project' ? 'New' : n.label === 'Firm insights' ? 'Insights' : n.label === 'Organization' ? 'Org' : n.label}</span>
                </Link>
              )
            })}
          </div>
        </nav>

        {/* ── Upload Modal ──────────────────────────────────────── */}
        {showUpload && (
          <Dialog labelledBy="upload-dialog-h" onClose={() => setShowUpload(false)} className="bg-warm-50 border border-warm-200 rounded-t-xl md:rounded-lg w-full md:max-w-md p-6 shadow-xl">
              <div className="flex items-center justify-between mb-5">
                <h2 id="upload-dialog-h" className="text-[20px] font-bold tracking-[-0.02em] text-navy-950">Upload a schedule</h2>
                <button onClick={() => setShowUpload(false)} aria-label="Close" className="text-warm-400 hover:text-warm-600"><X size={18} /></button>
              </div>

              {/* Mobile drag handle */}
              <div className="md:hidden w-10 h-1 bg-warm-300 rounded-full mx-auto mb-5 -mt-1" />

              {uploadError && (
                <div className="bg-status-at-risk-bg border-l-2 border-status-at-risk text-status-at-risk text-[13px] px-3 py-2 rounded-md mb-4">
                  {uploadError}
                </div>
              )}
              {uploadSummary ? (
                <div className="space-y-3">
                  <div className="bg-warm-100 border border-warm-200 rounded-lg p-4 text-[13px] text-warm-600 space-y-1">
                    <div><span className="font-semibold text-navy-950">{uploadSummary.activitiesImported.toLocaleString()}</span> activities, <span className="font-semibold text-navy-950">{uploadSummary.relationshipsImported.toLocaleString()}</span> relationships, {uploadSummary.calendarsImported} calendars imported.</div>
                    <div>{uploadSummary.classifiedPct}% of activities mapped to standard work categories.</div>
                    {uploadSummary.warnings.slice(0, 4).map((w, i) => <div key={i} className="text-warm-500">· {w}</div>)}
                  </div>
                  {uploadSummary.importExceptions && (
                    <div className="bg-warm-100 border border-warm-200 rounded-lg p-4 max-h-[40vh] overflow-y-auto">
                      <ImportExceptions report={uploadSummary.importExceptions} />
                    </div>
                  )}
                  {uploadSummary.dataQuestions > 0 && (
                    <div className="border-l-2 border-status-attention bg-status-attention-bg text-[13px] text-warm-700 px-3 py-2 rounded-md">
                      RunF9 has {uploadSummary.dataQuestions} question{uploadSummary.dataQuestions > 1 ? 's' : ''} about this file&apos;s data (calendars, dates, progress).
                    </div>
                  )}
                  <div className="flex gap-2">
                    {uploadSummary.dataQuestions > 0 && (
                      <Link href={selectedSchedule ? `/dashboard/quality?schedule=${selectedSchedule.id}` : '/dashboard/quality'} onClick={() => setShowUpload(false)} className="flex-1 text-center bg-accent-600 text-white py-2.5 rounded-md text-[13.5px] font-semibold hover:bg-accent-700 transition-colors pressable shadow-sm">Review data questions</Link>
                    )}
                    <button onClick={() => setShowUpload(false)} className={`flex-1 py-2.5 rounded-md text-[13.5px] transition-colors ${uploadSummary.dataQuestions > 0 ? 'border border-warm-300 text-navy-950 font-medium hover:bg-warm-100' : 'bg-accent-600 text-white font-semibold hover:bg-accent-700 pressable shadow-sm'}`}>Done</button>
                  </div>
                </div>
              ) : (
              <form onSubmit={handleUpload}>
                <div className="mb-4">
                  <FileSourcePicker accept=".xer,.xml,.pdf,.xlsx,.csv" canManage={can('org.manage')}
                    hint="Primavera P6 (.xer or P6 XML), MS Project (.xml), Excel (.xlsx), CSV, or PDF" />
                </div>
                <div className="mb-4">
                  <div id="upload-tag-h" className="block text-[12px] font-semibold uppercase tracking-wider text-warm-400 mb-1.5">Tag for firm history <span className="normal-case font-normal tracking-normal">(optional)</span></div>
                  <div role="group" aria-labelledby="upload-tag-h" className="grid grid-cols-3 gap-2">
                    <select name="projectType" aria-label="Facility type" defaultValue="" className="col-span-3 bg-warm-100 border border-warm-300 rounded-md px-2 py-2 text-[13px] text-warm-700">
                      <option value="">Facility type…</option>
                      {PROJECT_TYPES.map(t => <option key={t} value={t}>{PROJECT_TYPE_LABELS[t]}</option>)}
                    </select>
                    <input name="region" aria-label="State" placeholder="State (e.g. CA)" maxLength={2} className="bg-warm-100 border border-warm-300 rounded-md px-2 py-2 text-[13px] text-warm-700 uppercase" />
                    <input name="grossSqft" type="number" min={0} aria-label="Gross square feet" placeholder="Gross sf" className="col-span-2 bg-warm-100 border border-warm-300 rounded-md px-2 py-2 text-[13px] text-warm-700" />
                  </div>
                  <p className="text-[12px] text-warm-400 mt-1.5">Tagged schedules with actual dates teach RunF9 how your projects really perform. Used only for your firm.</p>
                </div>
                <div className="mb-4 empty:hidden"><WorkspaceSelect /></div>
                <div className="mb-4 grid grid-cols-2 gap-2">
                  <label className="block text-[12px] text-warm-600">Whose schedule
                    <select name="origin" defaultValue="" className="mt-1 w-full bg-warm-100 border border-warm-300 rounded-md px-2 py-2 text-[13px] text-warm-700">
                      <option value="">Not stated</option>
                      <option value="own">Our own project</option>
                      <option value="third_party">Third-party (we review it)</option>
                    </select>
                  </label>
                  <label className="block text-[12px] text-warm-600">Classification
                    <select name="classification" defaultValue="unclassified" className="mt-1 w-full bg-warm-100 border border-warm-300 rounded-md px-2 py-2 text-[13px] text-warm-700">
                      <option value="unclassified">Unclassified</option>
                      <option value="cui">CUI</option>
                      <option value="classified">Classified</option>
                    </select>
                  </label>
                  <p className="col-span-2 text-[12px] text-warm-500">Third-party schedules and RunF9 re-imports never calibrate firm history. CUI schedules are never sent to a cloud AI model and their exports carry CUI markings.</p>
                </div>
                <div className="mb-5">
                  <label htmlFor="upload-version" className="block text-[12px] font-semibold uppercase tracking-wider text-warm-400 mb-1.5">Version Label</label>
                  <input id="upload-version" type="text" name="version" defaultValue="" maxLength={40} placeholder="Automatic: Baseline, then Update 1, 2…"
                    className="w-full bg-warm-100 border border-warm-300 rounded-md px-3 py-2 text-[13.5px] text-warm-700" />
                </div>
                <button type="submit" disabled={uploading}
                  className="w-full bg-accent-600 text-white py-3 rounded-md text-[14px] font-semibold hover:bg-accent-700 disabled:opacity-50 transition-colors pressable shadow-sm">
                  {uploading ? 'Parsing schedule…' : 'Upload & Parse'}
                </button>
              </form>
              )}
          </Dialog>
        )}

        {/* ── Schedule List Modal ───────────────────────────────── */}
        {showScheduleList && (
          <Dialog labelledBy="switch-dialog-h" onClose={() => setShowScheduleList(false)} className="bg-warm-50 border border-warm-200 rounded-t-xl md:rounded-lg w-full md:max-w-md p-6 shadow-xl max-h-[80vh] overflow-auto">
              <div className="md:hidden w-10 h-1 bg-warm-300 rounded-full mx-auto mb-5" />
              <div className="flex items-center justify-between mb-5">
                <h2 id="switch-dialog-h" className="text-[20px] font-bold tracking-[-0.02em] text-navy-950">Switch project</h2>
                <button onClick={() => setShowScheduleList(false)} aria-label="Close" className="text-warm-400 hover:text-warm-600"><X size={18} /></button>
              </div>
              {schedules.length === 0 ? (
                <p className="text-center text-warm-400 py-8 text-[14px]">No schedules yet. Upload one to get started.</p>
              ) : (
                <div className="space-y-2">
                  {schedules.map(s => (
                    <button
                      key={s.id}
                      onClick={() => { setSelectedSchedule(s); setShowScheduleList(false); router.push(`${inProject ? pathname : '/dashboard/project'}?schedule=${s.id}`) }}
                      className={`w-full text-left p-3.5 rounded-md border transition-colors ${
                        selectedSchedule?.id === s.id
                          ? 'border-accent-500 bg-accent-100'
                          : 'border-warm-200 hover:border-warm-300 bg-warm-100'
                      }`}
                    >
                      <div className="text-[14px] font-semibold text-navy-950">{s.name}</div>
                      <div className="text-[12px] text-warm-400 mt-0.5">
                        {s.version} · {s.activityCount.toLocaleString()} activities · {sourceLabel(s.sourceType)}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {can('schedule.write') && (
              <button
                onClick={() => { setShowScheduleList(false); setShowUpload(true) }}
                className="w-full mt-4 border border-warm-300 text-navy-950 py-2.5 rounded-md text-[13.5px] font-medium hover:bg-warm-100 transition-colors"
              >
                + Upload a new project
              </button>
              )}
          </Dialog>
        )}

        {/* ── Settings Modal ────────────────────────────────────── */}
        {showSettings && (
          <Dialog labelledBy="account-dialog-h" onClose={() => setShowSettings(false)} className="bg-warm-50 border border-warm-200 rounded-t-xl md:rounded-lg w-full md:max-w-md p-6 shadow-xl">
              <div className="md:hidden w-10 h-1 bg-warm-300 rounded-full mx-auto mb-5" />
              <div className="flex items-center justify-between mb-5">
                <h2 id="account-dialog-h" className="text-[20px] font-bold tracking-[-0.02em] text-navy-950">Account</h2>
                <button onClick={() => setShowSettings(false)} aria-label="Close" className="text-warm-400 hover:text-warm-600"><X size={18} /></button>
              </div>
              <div className="space-y-3">
                <div className="bg-warm-100 border border-warm-200 rounded-md p-4">
                  <div className="text-[12px] font-semibold uppercase tracking-wider text-warm-400 mb-2">Profile</div>
                  <div className="text-[15px] font-semibold text-navy-950">{user.name}</div>
                  <div className="text-[13px] text-warm-500">{user.email}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {user.role && <span className="inline-block text-[12px] font-bold uppercase tracking-wider text-accent-600 bg-accent-100 px-2 py-0.5 rounded-md border-l-2 border-accent-500">{user.role}</span>}
                    {org && <span className="inline-block text-[12px] font-medium text-warm-600 bg-warm-200/60 px-2 py-0.5 rounded-md">{org.name}</span>}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Link href="/dashboard/account" onClick={() => setShowSettings(false)} className="flex items-center justify-center gap-1.5 border border-warm-300 bg-warm-50 text-navy-950 py-2.5 rounded-md text-[13px] font-medium hover:bg-warm-100 transition-colors">
                    <UserCog size={14} aria-hidden="true" /> Account &amp; security
                  </Link>
                  <Link href="/dashboard/org" onClick={() => setShowSettings(false)} className="flex items-center justify-center gap-1.5 border border-warm-300 bg-warm-50 text-navy-950 py-2.5 rounded-md text-[13px] font-medium hover:bg-warm-100 transition-colors">
                    <Building2 size={14} aria-hidden="true" /> Organization
                  </Link>
                </div>
                {platformAdmin && (
                  <Link href="/dashboard/platform" onClick={() => setShowSettings(false)} className="flex items-center justify-center gap-1.5 border border-warm-300 bg-warm-50 text-navy-950 py-2.5 rounded-md text-[13px] font-medium hover:bg-warm-100 transition-colors">
                    <KeyRound size={14} aria-hidden="true" /> Beta access (platform)
                  </Link>
                )}
                {llm && (
                  <div className="bg-warm-100 border border-warm-200 rounded-md p-4">
                    <div className="text-[12px] font-semibold uppercase tracking-wider text-warm-400 mb-2">AI processing</div>
                    <div className="text-[13px] text-warm-700 font-medium flex items-center gap-1.5">{llm.airgapped && <Lock size={12} />}{aiLabel(llm)}{llm.airgapped ? ' — air-gapped deployment' : ''}</div>
                    <div className="text-[12px] text-warm-500 mt-1">
                      {llm.mode === 'cloud' && `Model ${modelLine(llm)} via ${llm.host}. Request content for AI features is sent to ${llm.provider ? PROVIDER_LABEL[llm.provider] : 'the cloud AI provider'}; withheld answers and CUI / classified projects are never sent.`}
                      {llm.mode === 'local' && `Model ${modelLine(llm)} on ${llm.host}. Nothing leaves your network.`}
                      {llm.mode === 'offline' && (llm.error || 'No model configured. Scheduling, CPM, quality checks and reports run fully offline.')}
                    </div>
                  </div>
                )}
                <div className="bg-warm-100 border border-warm-200 rounded-md p-4">
                  <div className="text-[12px] font-semibold uppercase tracking-wider text-warm-400 mb-2">About</div>
                  <div className="text-[13px] text-warm-600">RunF9 · Version 1.0</div>
                  <div className="text-[13px] text-warm-400">Built by Hoshmand AI</div>
                  <div className="flex gap-4 mt-2">
                    <Link href="/privacy" className="text-[13px] text-accent-600 hover:underline">Privacy</Link>
                    <Link href="/terms" className="text-[13px] text-accent-600 hover:underline">Terms</Link>
                  </div>
                </div>
                <button
                  onClick={handleSignOut}
                  className="w-full flex items-center justify-center gap-2 border border-warm-300 text-warm-600 py-2.5 rounded-md text-[13.5px] font-medium hover:bg-warm-100 transition-colors"
                >
                  <LogOut size={14} /> Sign Out
                </button>
              </div>
          </Dialog>
        )}

      </div>
    </AppContext.Provider>
  )
}
