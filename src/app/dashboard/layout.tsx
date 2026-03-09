'use client'

import { useState, useEffect, createContext, useContext, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import {
  LayoutDashboard, MessageSquare, FileText, Clock,
  Upload, LogOut, X, ChevronDown, Settings,
} from 'lucide-react'
import { Logo } from '@/components/Logo'

/* ─── Types ─────────────────────────────────────────── */
interface User     { id: string; email: string; name: string; plan: string }
interface Schedule {
  id: string; name: string; version: string; activityCount: number
  uploadedAt: string; varianceDays: number | null; criticalCount: number
  percentComplete: number; sourceType: string
  projectStart: string | null; projectFinish: string | null; dataDate: string | null
}

interface AppContextType {
  user: User | null
  schedules: Schedule[]
  selectedSchedule: Schedule | null
  setSelectedSchedule: (s: Schedule | null) => void
  refreshSchedules: () => Promise<void>
  metrics: Record<string, unknown> | null
  refreshMetrics: () => Promise<void>
}

const AppContext = createContext<AppContextType>({
  user: null, schedules: [], selectedSchedule: null, setSelectedSchedule: () => {},
  refreshSchedules: async () => {}, metrics: null, refreshMetrics: async () => {},
})

export const useApp = () => useContext(AppContext)

/* ─── Tabs ───────────────────────────────────────────── */
const TABS = [
  { href: '/dashboard',          icon: LayoutDashboard, label: 'Overview' },
  { href: '/dashboard/ask',      icon: MessageSquare,   label: 'Ask AI'   },
  { href: '/dashboard/reports',  icon: FileText,        label: 'Reports'  },
  { href: '/dashboard/timeline', icon: Clock,           label: 'Timeline' },
]

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

  /* ── Auth ── */
  useEffect(() => {
    fetch('/api/auth').then(r => r.json()).then(data => {
      if (!data.user) router.push('/auth')
      else setUser(data.user)
    })
  }, [router])

  /* ── Data ── */
  const refreshSchedules = useCallback(async () => {
    const res  = await fetch('/api/schedules')
    const data = await res.json()
    setSchedules(data.schedules || [])
    if (!selectedSchedule && data.schedules?.length > 0) {
      setSelectedSchedule(data.schedules[0])
    }
  }, [selectedSchedule])

  const refreshMetrics = useCallback(async () => {
    if (!selectedSchedule) { setMetrics(null); return }
    const res  = await fetch(`/api/schedules?id=${selectedSchedule.id}`)
    const data = await res.json()
    setMetrics(data.metrics || null)
  }, [selectedSchedule])

  useEffect(() => { if (user) refreshSchedules() }, [user, refreshSchedules])
  useEffect(() => { if (selectedSchedule) refreshMetrics() }, [selectedSchedule, refreshMetrics])

  /* ── Upload ── */
  const handleUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setUploading(true)
    setUploadError('')
    const form = new FormData(e.currentTarget)
    try {
      const res  = await fetch('/api/schedules', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) { setUploadError(data.error); return }
      await refreshSchedules()
      setSelectedSchedule(data.schedule)
      setShowUpload(false)
    } catch {
      setUploadError('Upload failed. Please try again.')
    } finally {
      setUploading(false)
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

  const sourceLabel = (t: string) => t === 'p6_xer' ? 'P6' : t === 'ms_xml' ? 'MS Project' : 'PDF'

  return (
    <AppContext.Provider value={{ user, schedules, selectedSchedule, setSelectedSchedule, refreshSchedules, metrics, refreshMetrics }}>
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

        {/* ── Top Header ──────────────────────────────────────── */}
        <header className="bg-navy-900 flex-shrink-0 sticky top-0 z-40 border-b border-white/5">
          <div className="h-12 flex items-center justify-between px-4 md:px-5">

            {/* Left: logo */}
            <Link href="/" className="flex-shrink-0">
              <Logo variant="light" size="text-[17px]" />
            </Link>

            {/* Center (desktop): schedule selector */}
            <button
              onClick={() => setShowScheduleList(true)}
              className="hidden md:flex items-center gap-2 bg-navy-800 hover:bg-navy-700 border border-white/10 rounded-md px-3 py-1.5 transition-colors max-w-[260px]"
            >
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${selectedSchedule ? 'bg-gold-500' : 'bg-warm-500'}`} />
              <span className="text-white/65 text-[12px] font-medium truncate">
                {selectedSchedule ? selectedSchedule.name : 'No schedule selected'}
              </span>
              <ChevronDown size={11} className="text-white/35 flex-shrink-0" />
            </button>

            {/* Right: actions */}
            <div className="flex items-center gap-2.5">
              {/* Mobile: schedule pill (compact) */}
              <button
                onClick={() => setShowScheduleList(true)}
                className="md:hidden flex items-center gap-1.5 bg-navy-800 border border-white/10 rounded-md px-2.5 py-1.5"
              >
                <div className={`w-1.5 h-1.5 rounded-full ${selectedSchedule ? 'bg-gold-500' : 'bg-warm-500'}`} />
                <span className="text-white/60 text-[11px] font-medium max-w-[100px] truncate">
                  {selectedSchedule ? selectedSchedule.name : 'No schedule'}
                </span>
              </button>

              <button
                onClick={() => setShowUpload(true)}
                className="flex items-center gap-1.5 bg-gold-500 hover:bg-gold-400 text-navy-950 px-3 py-1.5 rounded-md text-[12px] font-semibold transition-colors"
              >
                <Upload size={12} />
                <span className="hidden sm:inline">Upload</span>
              </button>

              <button
                onClick={() => setShowSettings(true)}
                className="w-7 h-7 rounded-full bg-navy-800 border border-white/15 flex items-center justify-center text-[11px] font-bold text-white/70 hover:border-gold-500/40 transition-colors flex-shrink-0"
              >
                {user.name?.[0]?.toUpperCase() || 'U'}
              </button>
            </div>
          </div>

          {/* Desktop tab bar (inside header, below the main row) */}
          <div className="hidden md:flex border-t border-white/5 px-5">
            {TABS.map(tab => {
              const active = pathname === tab.href
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors ${
                    active
                      ? 'text-white border-gold-500'
                      : 'text-white/40 border-transparent hover:text-white/70'
                  }`}
                >
                  <tab.icon size={13} />
                  {tab.label}
                </Link>
              )
            })}
          </div>
        </header>

        {/* ── Main content ────────────────────────────────────── */}
        {/* pb-16 on mobile = space for bottom tab bar */}
        <main className="flex-1 overflow-auto pb-16 md:pb-0">
          <div className="max-w-5xl mx-auto">
            {children}
          </div>
        </main>

        {/* ── Mobile bottom tab bar ────────────────────────────── */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-navy-900 border-t border-white/8 safe-area-bottom">
          <div className="flex">
            {TABS.map(tab => {
              const active = pathname === tab.href
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`flex-1 flex flex-col items-center gap-1 py-2.5 transition-colors ${
                    active ? 'text-gold-400' : 'text-white/35'
                  }`}
                >
                  <tab.icon size={18} strokeWidth={active ? 2 : 1.5} />
                  <span className="text-[10px] font-medium">{tab.label}</span>
                </Link>
              )
            })}
          </div>
        </nav>

        {/* ── Upload Modal ──────────────────────────────────────── */}
        {showUpload && (
          <div className="fixed inset-0 bg-black/55 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
            <div className="bg-warm-50 border border-warm-200 rounded-t-xl md:rounded-lg w-full md:max-w-md p-6 shadow-xl">
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-display text-[20px] text-navy-950">Upload Schedule</h2>
                <button onClick={() => setShowUpload(false)} className="text-warm-400 hover:text-warm-600"><X size={18} /></button>
              </div>

              {/* Mobile drag handle */}
              <div className="md:hidden w-10 h-1 bg-warm-300 rounded-full mx-auto mb-5 -mt-1" />

              {uploadError && (
                <div className="bg-status-at-risk-bg border-l-2 border-status-at-risk text-status-at-risk text-[13px] px-3 py-2 rounded-md mb-4">
                  {uploadError}
                </div>
              )}
              <form onSubmit={handleUpload}>
                <div className="mb-4">
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-1.5">Schedule File</label>
                  <input
                    type="file" name="file" accept=".xer,.xml,.pdf" required
                    className="w-full border border-warm-300 bg-warm-100 rounded-md px-3 py-2 text-[13.5px] text-warm-700 file:mr-3 file:bg-navy-900 file:text-white file:border-0 file:rounded file:px-3 file:py-1 file:text-[12px] file:font-medium"
                  />
                  <p className="text-[11px] text-warm-400 mt-1.5">Supports .xer (P6), .xml (MS Project), .pdf</p>
                </div>
                <div className="mb-5">
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-1.5">Version Label</label>
                  <input type="text" name="version" defaultValue="v1.0"
                    className="w-full bg-warm-100 border border-warm-300 rounded-md px-3 py-2 text-[13.5px] text-warm-700" />
                </div>
                <button type="submit" disabled={uploading}
                  className="w-full bg-gold-500 text-navy-950 py-3 rounded-md text-[14px] font-semibold hover:bg-gold-400 disabled:opacity-50 transition-colors">
                  {uploading ? 'Parsing schedule…' : 'Upload & Parse'}
                </button>
              </form>
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
                <button onClick={() => setShowScheduleList(false)} className="text-warm-400 hover:text-warm-600"><X size={18} /></button>
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
                          ? 'border-gold-500 bg-gold-100'
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
              <button
                onClick={() => { setShowScheduleList(false); setShowUpload(true) }}
                className="w-full mt-4 border border-warm-300 text-navy-950 py-2.5 rounded-md text-[13.5px] font-medium hover:bg-warm-100 transition-colors"
              >
                + Upload New Schedule
              </button>
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
                <button onClick={() => setShowSettings(false)} className="text-warm-400 hover:text-warm-600"><X size={18} /></button>
              </div>
              <div className="space-y-3">
                <div className="bg-warm-100 border border-warm-200 rounded-md p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-2">Profile</div>
                  <div className="text-[15px] font-semibold text-navy-950">{user.name}</div>
                  <div className="text-[13px] text-warm-500">{user.email}</div>
                  <div className="mt-2 inline-block text-[11px] font-bold uppercase tracking-wider text-gold-600 bg-gold-100 px-2 py-0.5 rounded-md border-l-2 border-gold-500">
                    {user.plan}
                  </div>
                </div>
                <div className="bg-warm-100 border border-warm-200 rounded-md p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-2">About</div>
                  <div className="text-[13px] text-warm-600">Planora · Version 1.0</div>
                  <div className="text-[13px] text-warm-400">Built by Hoshmand AI</div>
                  <div className="flex gap-4 mt-2">
                    <Link href="/privacy" className="text-[13px] text-gold-600 hover:underline">Privacy</Link>
                    <Link href="/terms" className="text-[13px] text-gold-600 hover:underline">Terms</Link>
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
