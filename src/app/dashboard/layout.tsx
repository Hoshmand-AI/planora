'use client'

import { useState, useEffect, createContext, useContext, useCallback, useRef, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import {
  Home, MessageSquare, FileText, Clock,
  Upload, LogOut, X, ChevronDown, ClipboardList, ShieldCheck, Database, Lock, UserCog, Building2, Users, FolderOpen, KeyRound,
  MoreHorizontal, Timer, MailCheck,
} from 'lucide-react'
import { PROJECT_TYPES, PROJECT_TYPE_LABELS } from '@/lib/planning/types'
import { Logo } from '@/components/Logo'
import { WorkspaceSelect } from '@/components/WorkspaceSelect'
import { PROVIDER_LABEL, type ProviderName } from '@/lib/llm/gateway'
import { ImportExceptions } from '@/components/ImportExceptions'
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
  /** Organization the user belongs to */
  org: { id: string; name: string } | null
  /** What the user's role allows (read, plan.write, schedule.write, plan.review, …) */
  can: (permission: string) => boolean
  /** Opens the upload dialog (empty states use it as their one action); without upload rights it opens Build */
  openUpload: () => void
}

const AppContext = createContext<AppContextType>({
  user: null, schedules: [], selectedSchedule: null, setSelectedSchedule: () => {},
  refreshSchedules: async () => {}, metrics: null, refreshMetrics: async () => {},
  org: null, can: () => false, openUpload: () => {},
})

export const useApp = () => useContext(AppContext)

/* ─── Tabs ───────────────────────────────────────────── */
// Four everyday places up front; everything else is one click away under "More" (nothing removed).
const TABS = [
  { href: '/dashboard',          icon: Home,            label: 'Home'     },
  { href: '/dashboard/plan',     icon: ClipboardList,   label: 'Build'    },
  { href: '/dashboard/quality',  icon: ShieldCheck,     label: 'Quality'  },
  { href: '/dashboard/ask',      icon: MessageSquare,   label: 'Ask AI'   },
]
const MORE_TABS = [
  { href: '/dashboard/reports',     icon: FileText,   label: 'Reports',     hint: 'Narrative reports and exports' },
  { href: '/dashboard/documents',   icon: FolderOpen, label: 'Documents',   hint: 'Contracts and specifications' },
  { href: '/dashboard/timeline',    icon: Clock,      label: 'Timeline',    hint: 'Phases and Gantt chart' },
  { href: '/dashboard/resources',   icon: Users,      label: 'Resources',   hint: 'Loading, histograms, leveling' },
  { href: '/dashboard/time-impact', icon: Timer,      label: 'Time impact', hint: 'Delay events and fragnets' },
  { href: '/dashboard/history',     icon: Database,   label: 'Firm data',   hint: 'What your past projects teach' },
]

const isActive = (pathname: string, href: string) => href === '/dashboard' ? pathname === href || pathname.startsWith('/dashboard/portfolio') : pathname.startsWith(href)

/**
 * "More" navigation menu: a disclosure button (aria-expanded) over a list of links. Arrow keys move
 * between the links, Escape closes and returns focus to the button, a click outside closes it. The
 * button is highlighted while the current page is one of its links.
 */
function MoreMenu({ pathname, variant }: { pathname: string; variant: 'desktop' | 'mobile' }) {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const active = MORE_TABS.some(t => isActive(pathname, t.href))
  const menuId = `more-menu-${variant}`
  useEffect(() => { setOpen(false) }, [pathname])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  const links = () => Array.from(panel.current?.querySelectorAll<HTMLAnchorElement>('a') ?? [])
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); btn.current?.focus(); return }
    if (!open || !panel.current?.contains(document.activeElement)) return
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
    const list = links()
    if (!list.length) return
    e.preventDefault()
    const i = list.indexOf(document.activeElement as HTMLAnchorElement)
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length
    list[next].focus()
  }
  const onButtonKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const last = e.key === 'ArrowUp'
    setOpen(true)
    requestAnimationFrame(() => { const l = links(); l[last ? l.length - 1 : 0]?.focus() })
  }
  const desktop = variant === 'desktop'
  return (
    <div className={desktop ? 'relative' : 'flex-1 min-w-0'} onKeyDown={onKey}>
      <button ref={btn} type="button" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen(o => !o)} onKeyDown={onButtonKey}
        className={desktop
          ? `flex items-center gap-1.5 px-3.5 py-2.5 text-[13px] font-medium border-b-2 transition-colors ${active ? 'text-white border-accent-500' : 'text-white/70 border-transparent hover:text-white'}`
          : `w-full flex flex-col items-center gap-1 py-2.5 transition-colors ${active || open ? 'text-accent-400' : 'text-white/70'}`}>
        <MoreHorizontal size={desktop ? 13 : 18} aria-hidden="true" />
        <span className={desktop ? '' : 'text-[10px] font-medium'}>More</span>
        {desktop && <ChevronDown size={11} aria-hidden="true" className={`transition-transform ${open ? 'rotate-180' : ''}`} />}
        {active && <span className="sr-only"> (current section)</span>}
      </button>
      <div ref={panel} id={menuId} hidden={!open}
        className={desktop
          ? 'absolute left-0 top-full mt-1 w-[290px] bg-warm-50 border border-warm-200 rounded-xl shadow-xl p-1.5 z-50 rise-in'
          : 'fixed left-3 right-3 bottom-[72px] bg-warm-50 border border-warm-200 rounded-2xl shadow-2xl p-2 z-50 rise-in'}>
        <ul className={desktop ? '' : 'grid grid-cols-2 gap-1'}>
          {MORE_TABS.map(t => {
            const here = isActive(pathname, t.href)
            return (
              <li key={t.href}>
                <Link href={t.href} aria-current={here ? 'page' : undefined} onClick={() => setOpen(false)}
                  className={`flex items-start gap-2.5 rounded-lg px-3 py-2.5 transition-colors ${here ? 'bg-accent-100' : 'hover:bg-warm-100'}`}>
                  <t.icon size={15} aria-hidden="true" className={`mt-0.5 flex-shrink-0 ${here ? 'text-accent-600' : 'text-warm-500'}`} />
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-medium text-navy-950">{t.label}</span>
                    <span className="block text-[11.5px] text-warm-500 leading-snug">{t.hint}</span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

interface LlmStatus { mode: 'cloud' | 'local' | 'offline'; airgapped: boolean; provider?: ProviderName | null; model: string | null; certified?: boolean; host: string | null; error?: string }
/** "claude-opus-5-5 (Anthropic (Claude))", plus a note when the model is an approved alternate rather than certified. */
const modelLine = (l: LlmStatus) => `${l.model}${l.provider ? ` · ${PROVIDER_LABEL[l.provider]}` : ''}${l.certified === false ? ' · approved alternate (not certified; quality may differ)' : ''}`
const aiLabel = (l: LlmStatus | null) => !l ? '' : l.mode === 'cloud' ? 'Cloud AI' : l.mode === 'local' ? 'On-prem AI' : 'AI offline'

/** Schedule id a deep link asks for: /dashboard?schedule=<id> (portfolio links) or /dashboard?id=<id>. */
function deepLinkedScheduleId(pathname: string, params: { get(name: string): string | null }): string | null {
  if (pathname !== '/dashboard') return null
  return params.get('schedule') || params.get('id') || null
}

/** Opens the schedule a deep link names once the list is loaded (and again whenever the link changes). */
function ScheduleDeepLink({ schedules, select }: { schedules: Schedule[]; select: (s: Schedule) => void }) {
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
  return null
}

/* ─── Layout ─────────────────────────────────────────── */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter()
  const pathname = usePathname()

  const [user,             setUser]             = useState<User | null>(null)
  const [schedules,        setSchedules]        = useState<Schedule[]>([])
  const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(null)
  const [metrics,          setMetrics]          = useState<Record<string, unknown> | null>(null)

  const [showUpload,       setShowUpload]       = useState(false)
  const [showScheduleList, setShowScheduleList] = useState(false)
  const [showSettings,     setShowSettings]     = useState(false)
  const [uploading,        setUploading]        = useState(false)
  const [uploadError,      setUploadError]      = useState('')
  const [uploadSummary,    setUploadSummary]    = useState<{ activitiesImported: number; relationshipsImported: number; calendarsImported: number; classifiedPct: number; dataQuestions: number; warnings: string[]; importExceptions?: ExceptionReport | null } | null>(null)
  const [llm,              setLlm]              = useState<LlmStatus | null>(null)
  const [org,              setOrg]              = useState<{ id: string; name: string } | null>(null)
  const [permissions,      setPermissions]      = useState<string[]>([])
  const [mfaSetupRequired, setMfaSetupRequired] = useState(false)
  const [emailUnconfirmed, setEmailUnconfirmed] = useState(false)
  const [platformAdmin,    setPlatformAdmin]    = useState(false)
  const [emailWhy,         setEmailWhy]         = useState(false)
  const [resend,           setResend]           = useState<{ busy: boolean; note: string; ok: boolean }>({ busy: false, note: '', ok: false })
  const can = useCallback((p: string) => permissions.includes(p), [permissions])

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
    })
  }, [router])

  // The organization requires two-step verification: everything else waits until it's set up.
  useEffect(() => {
    if (mfaSetupRequired && pathname !== '/dashboard/account') router.push('/dashboard/account?setup=mfa')
  }, [mfaSetupRequired, pathname, router])

  /* ── Data ── */
  const refreshSchedules = useCallback(async () => {
    const res  = await fetch('/api/schedules')
    const data = await res.json()
    const list: Schedule[] = data.schedules || []
    setSchedules(list)
    if (!selectedSchedule && list.length > 0) {
      // Honor a deep link on first load instead of flashing the newest schedule.
      const wanted = typeof window === 'undefined' ? null : deepLinkedScheduleId(window.location.pathname, new URLSearchParams(window.location.search))
      setSelectedSchedule(list.find(s => s.id === wanted) ?? list[0])
    }
  }, [selectedSchedule])

  // Only the latest selection's metrics may land (a slower earlier request must not overwrite them).
  const metricsFor = useRef<string | null>(null)
  const refreshMetrics = useCallback(async () => {
    metricsFor.current = selectedSchedule?.id ?? null
    if (!selectedSchedule) { setMetrics(null); return }
    const id = selectedSchedule.id
    const res  = await fetch(`/api/schedules?id=${id}`)
    const data = await res.json()
    if (metricsFor.current !== id) return
    setMetrics(data.metrics ? { ...data.metrics, brief: data.brief ?? null, warnings: data.schedule?.warnings ?? [] } : null)
  }, [selectedSchedule])

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
      <div className="min-h-screen bg-warm-50 flex items-center justify-center">
        <div className="text-warm-400 text-[14px]">Loading…</div>
      </div>
    )
  }

  const openUpload = () => { setUploadSummary(null); setUploadError(''); setShowUpload(true) }
  const sourceLabel = (t: string) => ({ p6_xer: 'P6', p6_xml: 'P6 XML', ms_xml: 'MS Project', pdf: 'PDF', excel: 'Excel', csv: 'CSV', generated: 'Built in RunF9' } as Record<string, string>)[t] || t

  return (
    <AppContext.Provider value={{ user, schedules, selectedSchedule, setSelectedSchedule, refreshSchedules, metrics, refreshMetrics, org, can, openUpload: can('schedule.write') ? openUpload : () => router.push('/dashboard/plan') }}>
      <Suspense fallback={null}><ScheduleDeepLink schedules={schedules} select={setSelectedSchedule} /></Suspense>
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
      <div className="min-h-screen bg-warm-50 flex flex-col">
        <a href="#main" className="skip-link">Skip to content</a>

        {/* ── Top Header ──────────────────────────────────────── */}
        <header className="bg-navy-900 flex-shrink-0 sticky top-0 z-40 border-b border-white/5">
          <div className="h-14 flex items-center justify-between px-4 md:px-5">

            {/* Left: logo */}
            <Link href="/" className="flex-shrink-0">
              <Logo variant="light" size="text-[22px]" />
            </Link>

            {/* Center (desktop): schedule selector */}
            <button
              onClick={() => setShowScheduleList(true)}
              className="hidden md:flex items-center gap-2 bg-navy-800 hover:bg-navy-700 border border-white/10 rounded-md px-3 py-1.5 transition-colors max-w-[260px]"
            >
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${selectedSchedule ? 'bg-accent-500' : 'bg-warm-500'}`} />
              <span className="text-white/65 text-[12px] font-medium truncate">
                {selectedSchedule ? selectedSchedule.name : 'No schedule selected'}
              </span>
              <ChevronDown size={11} className="text-white/60 flex-shrink-0" />
            </button>

            {/* Right: actions */}
            <div className="flex items-center gap-2.5">
              {/* Mobile: schedule pill (compact) */}
              <button
                onClick={() => setShowScheduleList(true)}
                className="md:hidden flex items-center gap-1.5 bg-navy-800 border border-white/10 rounded-md px-2.5 py-1.5"
              >
                <div className={`w-1.5 h-1.5 rounded-full ${selectedSchedule ? 'bg-accent-500' : 'bg-warm-500'}`} />
                <span className="text-white/60 text-[11px] font-medium max-w-[100px] truncate">
                  {selectedSchedule ? selectedSchedule.name : 'No schedule'}
                </span>
              </button>

              {llm && (
                <span title={llm.error || (llm.model ? `${modelLine(llm)} @ ${llm.host}` : 'Deterministic analysis only: scheduling, CPM, quality checks and reports still work')}
                  className="hidden sm:flex items-center gap-1.5 text-[11px] font-medium text-white/70 px-1.5 py-1">
                  {llm.airgapped ? <Lock size={10} aria-hidden="true" /> : <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${llm.mode === 'offline' ? 'bg-warm-300' : 'bg-emerald-400'}`} />}
                  {aiLabel(llm)}{llm.airgapped ? ' · air-gapped' : ''}
                </span>
              )}
              {can('schedule.write') && (
              <button
                onClick={openUpload}
                className="flex items-center gap-1.5 bg-accent-500 hover:bg-accent-400 text-navy-950 px-3 py-1.5 rounded-md text-[12px] font-semibold transition-colors"
              >
                <Upload size={12} aria-hidden="true" />
                <span className="hidden sm:inline">Upload</span>
                <span className="sr-only sm:hidden">Upload schedule</span>
              </button>
              )}

              <button
                onClick={() => setShowSettings(true)}
                aria-label={`Account menu for ${user.name}`}
                className="w-7 h-7 rounded-full bg-navy-800 border border-white/15 flex items-center justify-center text-[11px] font-bold text-white/70 hover:border-accent-500/40 transition-colors flex-shrink-0"
              >
                {user.name?.[0]?.toUpperCase() || 'U'}
              </button>
            </div>
          </div>

          {/* Desktop tab bar (inside header, below the main row) */}
          <nav aria-label="Main" className="hidden md:flex border-t border-white/5 px-5">
            {TABS.map(tab => {
              const active = isActive(pathname, tab.href)
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-1.5 px-3.5 py-2.5 text-[13px] font-medium border-b-2 transition-colors ${
                    active
                      ? 'text-white border-accent-500'
                      : 'text-white/70 border-transparent hover:text-white'
                  }`}
                >
                  <tab.icon size={13} aria-hidden="true" />
                  {tab.label}
                </Link>
              )
            })}
            <MoreMenu pathname={pathname} variant="desktop" />
          </nav>
        </header>

        {/* ── Main content ────────────────────────────────────── */}
        {/* pb-16 on mobile = space for bottom tab bar */}
        <main id="main" tabIndex={-1} className="flex-1 min-w-0 overflow-x-clip pb-16 md:pb-0 focus:outline-none">
          {emailUnconfirmed && pathname !== '/dashboard/account' && (
            <div role="region" aria-label="Email confirmation" className="bg-warm-100 border-b border-warm-200 px-4 md:px-6 py-2 text-[13px] text-warm-700">
              <div className="max-w-5xl mx-auto flex flex-wrap items-center gap-x-3 gap-y-1">
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
          <div className="max-w-5xl mx-auto">
            {children}
          </div>
        </main>

        {/* ── Mobile bottom tab bar ────────────────────────────── */}
        <nav aria-label="Main (mobile)" className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-navy-900 border-t border-white/8 safe-area-bottom">
          <div className="flex">
            {TABS.map(tab => {
              const active = isActive(pathname, tab.href)
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex-1 min-w-0 flex flex-col items-center gap-1 py-2.5 transition-colors ${
                    active ? 'text-accent-400' : 'text-white/70'
                  }`}
                >
                  <tab.icon size={18} strokeWidth={active ? 2 : 1.5} aria-hidden="true" />
                  <span className="text-[10px] font-medium">{tab.label}</span>
                </Link>
              )
            })}
            <MoreMenu pathname={pathname} variant="mobile" />
          </div>
        </nav>

        {/* ── Upload Modal ──────────────────────────────────────── */}
        {showUpload && (
          <div className="fixed inset-0 bg-black/55 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
            <div className="bg-warm-50 border border-warm-200 rounded-t-xl md:rounded-lg w-full md:max-w-md p-6 shadow-xl">
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-display text-[20px] text-navy-950">Upload Schedule</h2>
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
                    <Link href="/dashboard/quality" onClick={() => setShowUpload(false)} className="flex-1 text-center bg-accent-500 text-navy-950 py-2.5 rounded-md text-[13.5px] font-semibold hover:bg-accent-400 transition-colors">Review data questions</Link>
                    <button onClick={() => setShowUpload(false)} className="flex-1 border border-warm-300 text-navy-950 py-2.5 rounded-md text-[13.5px] font-medium hover:bg-warm-100 transition-colors">Done</button>
                  </div>
                </div>
              ) : (
              <form onSubmit={handleUpload}>
                <div className="mb-4">
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-1.5">Schedule File</label>
                  <input
                    type="file" name="file" accept=".xer,.xml,.pdf,.xlsx,.csv" required
                    className="w-full border border-warm-300 bg-warm-100 rounded-md px-3 py-2 text-[13.5px] text-warm-700 file:mr-3 file:bg-navy-900 file:text-white file:border-0 file:rounded file:px-3 file:py-1 file:text-[12px] file:font-medium"
                  />
                  <p className="text-[11px] text-warm-400 mt-1.5">Primavera P6 (.xer or P6 XML), MS Project (.xml), Excel (.xlsx), CSV, or PDF</p>
                </div>
                <div className="mb-4">
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-1.5">Tag for firm history <span className="normal-case font-normal tracking-normal">(optional)</span></label>
                  <div className="grid grid-cols-3 gap-2">
                    <select name="projectType" defaultValue="" className="col-span-3 bg-warm-100 border border-warm-300 rounded-md px-2 py-2 text-[13px] text-warm-700">
                      <option value="">Facility type…</option>
                      {PROJECT_TYPES.map(t => <option key={t} value={t}>{PROJECT_TYPE_LABELS[t]}</option>)}
                    </select>
                    <input name="region" placeholder="State (e.g. CA)" maxLength={2} className="bg-warm-100 border border-warm-300 rounded-md px-2 py-2 text-[13px] text-warm-700 uppercase" />
                    <input name="grossSqft" type="number" min={0} placeholder="Gross sf" className="col-span-2 bg-warm-100 border border-warm-300 rounded-md px-2 py-2 text-[13px] text-warm-700" />
                  </div>
                  <p className="text-[11px] text-warm-400 mt-1.5">Tagged schedules with actual dates teach RunF9 how your projects really perform. Used only for your firm.</p>
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
                  <p className="col-span-2 text-[11px] text-warm-500">Third-party schedules and RunF9 re-imports never calibrate firm history. CUI schedules are never sent to a cloud AI model and their exports carry CUI markings.</p>
                </div>
                <div className="mb-5">
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-1.5">Version Label</label>
                  <input type="text" name="version" defaultValue="" maxLength={40} placeholder="Automatic: Baseline, then Update 1, 2…"
                    className="w-full bg-warm-100 border border-warm-300 rounded-md px-3 py-2 text-[13.5px] text-warm-700" />
                </div>
                <button type="submit" disabled={uploading}
                  className="w-full bg-accent-500 text-navy-950 py-3 rounded-md text-[14px] font-semibold hover:bg-accent-400 disabled:opacity-50 transition-colors">
                  {uploading ? 'Parsing schedule…' : 'Upload & Parse'}
                </button>
              </form>
              )}
            </div>
          </div>
        )}

        {/* ── Schedule List Modal ───────────────────────────────── */}
        {showScheduleList && (
          <div className="fixed inset-0 bg-black/55 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
            <div className="bg-warm-50 border border-warm-200 rounded-t-xl md:rounded-lg w-full md:max-w-md p-6 shadow-xl max-h-[80vh] overflow-auto">
              <div className="md:hidden w-10 h-1 bg-warm-300 rounded-full mx-auto mb-5" />
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-display text-[20px] text-navy-950">Select Schedule</h2>
                <button onClick={() => setShowScheduleList(false)} aria-label="Close" className="text-warm-400 hover:text-warm-600"><X size={18} /></button>
              </div>
              {schedules.length === 0 ? (
                <p className="text-center text-warm-400 py-8 text-[14px]">No schedules yet. Upload one to get started.</p>
              ) : (
                <div className="space-y-2">
                  {schedules.map(s => (
                    <button
                      key={s.id}
                      onClick={() => { setSelectedSchedule(s); setShowScheduleList(false) }}
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
                + Upload New Schedule
              </button>
              )}
            </div>
          </div>
        )}

        {/* ── Settings Modal ────────────────────────────────────── */}
        {showSettings && (
          <div className="fixed inset-0 bg-black/55 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
            <div className="bg-warm-50 border border-warm-200 rounded-t-xl md:rounded-lg w-full md:max-w-md p-6 shadow-xl">
              <div className="md:hidden w-10 h-1 bg-warm-300 rounded-full mx-auto mb-5" />
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-display text-[20px] text-navy-950">Account</h2>
                <button onClick={() => setShowSettings(false)} aria-label="Close" className="text-warm-400 hover:text-warm-600"><X size={18} /></button>
              </div>
              <div className="space-y-3">
                <div className="bg-warm-100 border border-warm-200 rounded-md p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-2">Profile</div>
                  <div className="text-[15px] font-semibold text-navy-950">{user.name}</div>
                  <div className="text-[13px] text-warm-500">{user.email}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {user.role && <span className="inline-block text-[11px] font-bold uppercase tracking-wider text-accent-600 bg-accent-100 px-2 py-0.5 rounded-md border-l-2 border-accent-500">{user.role}</span>}
                    {org && <span className="inline-block text-[11px] font-medium text-warm-600 bg-warm-200/60 px-2 py-0.5 rounded-md">{org.name}</span>}
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
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-2">AI processing</div>
                    <div className="text-[13px] text-warm-700 font-medium flex items-center gap-1.5">{llm.airgapped && <Lock size={12} />}{aiLabel(llm)}{llm.airgapped ? ' — air-gapped deployment' : ''}</div>
                    <div className="text-[12px] text-warm-500 mt-1">
                      {llm.mode === 'cloud' && `Model ${modelLine(llm)} via ${llm.host}. Request content for AI features is sent to ${llm.provider ? PROVIDER_LABEL[llm.provider] : 'the cloud AI provider'}; withheld answers and CUI / classified projects are never sent.`}
                      {llm.mode === 'local' && `Model ${modelLine(llm)} on ${llm.host}. Nothing leaves your network.`}
                      {llm.mode === 'offline' && (llm.error || 'No model configured. Scheduling, CPM, quality checks and reports run fully offline.')}
                    </div>
                  </div>
                )}
                <div className="bg-warm-100 border border-warm-200 rounded-md p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-2">About</div>
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
            </div>
          </div>
        )}

      </div>
    </AppContext.Provider>
  )
}
