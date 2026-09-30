'use client'

import { useState, useEffect, createContext, useContext, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import {
  LayoutDashboard, MessageSquare, FileText, Clock,
  Upload, LogOut, X, ChevronDown, ClipboardList, ShieldCheck, Database, Lock,
} from 'lucide-react'
import { PROJECT_TYPES, PROJECT_TYPE_LABELS } from '@/lib/planning/types'
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
// Build → Analyze → Monitor, plus the firm's private knowledge base.
const TABS = [
  { href: '/dashboard/plan',     icon: ClipboardList,   label: 'Build'    },
  { href: '/dashboard',          icon: LayoutDashboard, label: 'Overview' },
  { href: '/dashboard/quality',  icon: ShieldCheck,     label: 'Quality'  },
  { href: '/dashboard/ask',      icon: MessageSquare,   label: 'Ask AI'   },
  { href: '/dashboard/reports',  icon: FileText,        label: 'Reports'  },
  { href: '/dashboard/timeline', icon: Clock,           label: 'Timeline' },
  { href: '/dashboard/history',  icon: Database,        label: 'Firm data' },
]

const isActive = (pathname: string, href: string) => href === '/dashboard' ? pathname === href : pathname.startsWith(href)

interface LlmStatus { mode: 'cloud' | 'local' | 'offline'; airgapped: boolean; model: string | null; host: string | null; error?: string }
const aiLabel = (l: LlmStatus | null) => !l ? '' : l.mode === 'cloud' ? 'Cloud AI' : l.mode === 'local' ? 'On-prem AI' : 'AI offline'

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
  const [uploadSummary,    setUploadSummary]    = useState<{ activitiesImported: number; relationshipsImported: number; calendarsImported: number; classifiedPct: number; dataQuestions: number; warnings: string[] } | null>(null)
  const [llm,              setLlm]              = useState<LlmStatus | null>(null)

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
    setMetrics(data.metrics ? { ...data.metrics, brief: data.brief ?? null, warnings: data.schedule?.warnings ?? [] } : null)
  }, [selectedSchedule])

  useEffect(() => { if (user) refreshSchedules() }, [user, refreshSchedules])
  useEffect(() => { if (user) fetch('/api/system').then(r => r.json()).then(d => setLlm(d.llm || null)).catch(() => {}) }, [user])
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
      setUploadSummary(data.summary)
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

  const sourceLabel = (t: string) => ({ p6_xer: 'P6', ms_xml: 'MS Project', pdf: 'PDF', excel: 'Excel', csv: 'CSV', generated: 'Built in Planora' } as Record<string, string>)[t] || t

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
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${selectedSchedule ? 'bg-accent-500' : 'bg-warm-500'}`} />
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
                <div className={`w-1.5 h-1.5 rounded-full ${selectedSchedule ? 'bg-accent-500' : 'bg-warm-500'}`} />
                <span className="text-white/60 text-[11px] font-medium max-w-[100px] truncate">
                  {selectedSchedule ? selectedSchedule.name : 'No schedule'}
                </span>
              </button>

              {llm && (
                <span title={llm.error || (llm.model ? `${llm.model} @ ${llm.host}` : 'Deterministic analysis only')}
                  className="hidden sm:flex items-center gap-1 text-[11px] font-medium text-white/55 border border-white/10 rounded-md px-2 py-1">
                  {llm.airgapped && <Lock size={10} />}{aiLabel(llm)}{llm.airgapped ? ' · air-gapped' : ''}
                </span>
              )}
              <button
                onClick={() => { setUploadSummary(null); setUploadError(''); setShowUpload(true) }}
                className="flex items-center gap-1.5 bg-accent-500 hover:bg-accent-400 text-navy-950 px-3 py-1.5 rounded-md text-[12px] font-semibold transition-colors"
              >
                <Upload size={12} />
                <span className="hidden sm:inline">Upload</span>
              </button>

              <button
                onClick={() => setShowSettings(true)}
                className="w-7 h-7 rounded-full bg-navy-800 border border-white/15 flex items-center justify-center text-[11px] font-bold text-white/70 hover:border-accent-500/40 transition-colors flex-shrink-0"
              >
                {user.name?.[0]?.toUpperCase() || 'U'}
              </button>
            </div>
          </div>

          {/* Desktop tab bar (inside header, below the main row) */}
          <div className="hidden md:flex border-t border-white/5 px-5">
            {TABS.map(tab => {
              const active = isActive(pathname, tab.href)
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`flex items-center gap-1.5 px-3.5 py-2.5 text-[13px] font-medium border-b-2 transition-colors ${
                    active
                      ? 'text-white border-accent-500'
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
        <main className="flex-1 min-w-0 overflow-x-clip pb-16 md:pb-0">
          <div className="max-w-5xl mx-auto">
            {children}
          </div>
        </main>

        {/* ── Mobile bottom tab bar ────────────────────────────── */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-navy-900 border-t border-white/8 safe-area-bottom">
          <div className="flex overflow-x-auto">
            {TABS.map(tab => {
              const active = isActive(pathname, tab.href)
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`flex-1 min-w-[64px] flex flex-col items-center gap-1 py-2.5 transition-colors ${
                    active ? 'text-accent-400' : 'text-white/35'
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
              {uploadSummary ? (
                <div className="space-y-3">
                  <div className="bg-warm-100 border border-warm-200 rounded-lg p-4 text-[13px] text-warm-600 space-y-1">
                    <div><span className="font-semibold text-navy-950">{uploadSummary.activitiesImported.toLocaleString()}</span> activities, <span className="font-semibold text-navy-950">{uploadSummary.relationshipsImported.toLocaleString()}</span> relationships, {uploadSummary.calendarsImported} calendars imported.</div>
                    <div>{uploadSummary.classifiedPct}% of activities mapped to standard work categories.</div>
                    {uploadSummary.warnings.slice(0, 4).map((w, i) => <div key={i} className="text-warm-500">· {w}</div>)}
                  </div>
                  {uploadSummary.dataQuestions > 0 && (
                    <div className="border-l-2 border-status-attention bg-status-attention-bg text-[13px] text-warm-700 px-3 py-2 rounded-md">
                      Planora has {uploadSummary.dataQuestions} question{uploadSummary.dataQuestions > 1 ? 's' : ''} about this file&apos;s data (calendars, dates, progress).
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
                  <p className="text-[11px] text-warm-400 mt-1.5">Primavera P6 (.xer), MS Project (.xml), Excel (.xlsx), CSV, or PDF</p>
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
                  <p className="text-[11px] text-warm-400 mt-1.5">Tagged schedules with actual dates teach Planora how your projects really perform. Used only for your firm.</p>
                </div>
                <div className="mb-5">
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-1.5">Version Label</label>
                  <input type="text" name="version" defaultValue="v1.0"
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
                  <div className="mt-2 inline-block text-[11px] font-bold uppercase tracking-wider text-accent-600 bg-accent-100 px-2 py-0.5 rounded-md border-l-2 border-accent-500">
                    {user.plan}
                  </div>
                </div>
                {llm && (
                  <div className="bg-warm-100 border border-warm-200 rounded-md p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-2">AI processing</div>
                    <div className="text-[13px] text-warm-700 font-medium flex items-center gap-1.5">{llm.airgapped && <Lock size={12} />}{aiLabel(llm)}{llm.airgapped ? ' — air-gapped deployment' : ''}</div>
                    <div className="text-[12px] text-warm-500 mt-1">
                      {llm.mode === 'cloud' && `Model ${llm.model} via ${llm.host}. Withheld answers are never sent.`}
                      {llm.mode === 'local' && `Model ${llm.model} on ${llm.host}. Nothing leaves your network.`}
                      {llm.mode === 'offline' && (llm.error || 'No model configured. Scheduling, CPM, quality checks and reports run fully offline.')}
                    </div>
                  </div>
                )}
                <div className="bg-warm-100 border border-warm-200 rounded-md p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-2">About</div>
                  <div className="text-[13px] text-warm-600">Planora · Version 1.0</div>
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
