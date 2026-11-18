'use client'

// The program master schedule page: several projects read together, each from its contractor's own schedule.
// The numbers come from GET /api/programs/{id} (src/lib/analysis/master-schedule.ts). Nothing on this page lets
// a person type a contractor date: a standard milestone is pointed at an activity of the contractor's schedule,
// and the date is read from the newest upload. The owner's own view goes beside it as an "owner forecast".

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowDown, ArrowUp, Download, Loader2, Plus, Printer, Trash2, X } from 'lucide-react'
import { digitsFont } from '@/app/fonts/digits'
import { EmptyState } from '@/components/EmptyState'
import { Alert, Button, Field, Hint, Section, buttonClass, inputClass, postJson } from '@/components/ui'
import { fmtDate } from '@/lib/format'
import {
  DATA_STATUS_LABEL, EXPIRED_AFTER_DAYS, NO_SECTOR, PARTY_SUGGESTIONS, STALE_AFTER_DAYS, daysBetween,
  type DataStatus, type DictMilestone, type LookAheadItem, type MappedRef, type MasterCell, type MasterReport, type MasterRow, type MasterSchedule as Master, type PartyRow,
} from '@/lib/analysis/master-schedule'

interface ProgramListItem { id: string; name: string; projects: number }
interface Available { key: string; name: string; version: string; dataDate: string | null; scheduleId: string }
interface View {
  program: { id: string; name: string; dictionary: DictMilestone[] }
  master: Master
  lookAhead: LookAheadItem[]
  projects: { id: string; key: string; scheduleId: string | null }[]
  available: Available[]
  canEdit: boolean
}
interface PickActivity { code: string; name: string; type: string; milestoneKind: 'start' | 'finish' | null; start: string | null; finish: string | null }

const TABS: { id: MasterReport | 'setup'; label: string }[] = [
  { id: 'milestones', label: 'Milestones' }, { id: 'phases', label: 'Phases' }, { id: 'sectors', label: 'Sectors' },
  { id: 'lookahead', label: 'Look-ahead' }, { id: 'parties', label: 'Other parties' }, { id: 'updates', label: 'Contractor updates' }, { id: 'setup', label: 'Set up' },
]
type TabId = (typeof TABS)[number]['id']

const STATUS_CLS: Record<DataStatus, string> = {
  current: 'text-status-on-track bg-status-on-track-bg', provisional: 'text-status-attention bg-status-attention-bg',
  stale: 'text-status-attention bg-status-attention-bg', expired: 'text-status-at-risk bg-status-at-risk-bg', none: 'text-warm-700 bg-warm-100',
}
const d = (v: string | null | undefined) => (v ? fmtDate(v) : '')
const signed = (n: number) => (n > 0 ? `+${n}` : String(n))
const th = 'px-3 py-2.5 text-left text-caption font-semibold text-warm-600 whitespace-nowrap'
const td = 'px-3 py-2.5 align-top text-body text-warm-700'
/** A table that may be wider than the page scrolls sideways; its wrapper is a focusable region so the keyboard can scroll it. */
const card = 'rounded-[14px] border border-warm-200 bg-white overflow-x-auto print:overflow-visible print:border-0'

function StatusPill({ status }: { status: DataStatus }) {
  return <span className={`inline-block rounded-lg px-2 py-0.5 text-caption font-semibold whitespace-nowrap ${STATUS_CLS[status]}`}>{DATA_STATUS_LABEL[status]}</span>
}

/** Where a row's contractor dates come from, in words. */
function sourceLine(r: MasterRow): string {
  if (!r.latest) return 'No schedule uploaded for this project.'
  const age = r.ageDays === null ? '' : r.ageDays === 0 ? ', today' : `, ${r.ageDays} day${r.ageDays === 1 ? '' : 's'} old`
  return `${r.latest.version}${r.latest.dataDate ? `, data date ${d(r.latest.dataDate)}` : ''}${age}`
}

async function send(url: string, method: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> & { error?: string } }> {
  if (method === 'DELETE') {
    const res = await fetch(url, { method }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    return { ok: !!res?.ok, data: res ? data : { error: 'Network error. Check your connection and try again.' } }
  }
  return postJson(url, body, method)
}

export function MasterSchedule() {
  const router = useRouter()
  const params = useSearchParams()
  const programId = params.get('program')
  const [programs, setPrograms] = useState<ProgramListItem[] | null>(null)
  const [canCreate, setCanCreate] = useState(false)
  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [tab, setTab] = useState<TabId>('milestones')
  const [sector, setSector] = useState('')
  const [cell, setCell] = useState<{ row: MasterRow; index: number } | null>(null)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  const loadList = useCallback(async () => {
    const res = await fetch('/api/programs').catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (!res?.ok) { setError(data.error || 'Could not load the programs. Reload the page.'); setPrograms([]); return [] as ProgramListItem[] }
    setPrograms(data.programs); setCanCreate(!!data.canEdit)
    return data.programs as ProgramListItem[]
  }, [])
  const loadView = useCallback(async (id: string) => {
    const res = await fetch(`/api/programs/${id}`).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (!res?.ok) { setError(data.error || 'Could not load the master schedule. Reload the page.'); setView(null); return }
    setError(''); setView(data as View)
  }, [])

  useEffect(() => { loadList() }, [loadList])
  // With no program in the address, open the first one.
  useEffect(() => {
    if (!programs) return
    if (!programId && programs.length) router.replace(`/dashboard/programs?program=${programs[0].id}`)
    else if (programId) loadView(programId)
    else setView(null)
  }, [programs, programId, router, loadView])

  const reload = useCallback(async () => { if (programId) await loadView(programId) }, [programId, loadView])

  const create = async () => {
    setBusy(true)
    const r = await send('/api/programs', 'POST', { name: newName })
    setBusy(false)
    if (!r.ok) { setError(r.data.error || 'The program was not created. Try again.'); return }
    setNewName(''); setError('')
    const p = r.data.program as { id: string }
    await loadList()
    setTab('setup')
    router.push(`/dashboard/programs?program=${p.id}`)
  }

  const master = view?.master ?? null
  const sectorNames = useMemo(() => (master ? master.sectors.map(s => s.sector) : []), [master])
  const rows = useMemo(() => (master ? master.rows.filter(r => !sector || (r.sector ?? NO_SECTOR) === sector) : []), [master, sector])

  if (!programs) return <div className="px-6 py-10 text-body text-warm-600 flex items-center gap-2">{error || <><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Loading…</>}</div>

  const createForm = canCreate && (
    <form onSubmit={e => { e.preventDefault(); if (newName.trim()) create() }} className="flex flex-wrap items-end gap-2 print:hidden">
      <label className="text-caption font-semibold text-warm-600">New program
        <input value={newName} onChange={e => setNewName(e.target.value)} maxLength={120} placeholder="Program name" className={`${inputClass} mt-1 block w-64 max-w-full`} />
      </label>
      <Button type="submit" variant="secondary" disabled={busy || newName.trim().length < 2}><Plus size={15} aria-hidden="true" />Create</Button>
    </form>
  )

  if (!programs.length) {
    return (
      <div className="max-w-3xl mx-auto px-5 md:px-8 py-6 md:py-8 space-y-5">
        {error ? <Alert tone="error">{error}</Alert> : null}
        <EmptyState title="Master schedule">
          A program reads several projects together. Each project&apos;s dates come from its contractor&apos;s own schedule, so the master and the contractor&apos;s schedule always show the same dates.
          {!canCreate && ' Ask a scheduler or an admin of your organization to create the first program.'}
        </EmptyState>
        {createForm && <div className="flex justify-center">{createForm}</div>}
      </div>
    )
  }

  const t = master?.totals
  const report: MasterReport = tab === 'setup' ? 'milestones' : tab
  return (
    <div className="max-w-[1400px] mx-auto px-5 md:px-8 py-6 md:py-8 space-y-4 print:p-0 print:max-w-none">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="page-title">{view ? view.program.name : 'Master schedule'}{view && tab !== 'setup' ? <span className="hidden print:inline">: {TABS.find(x => x.id === tab)?.label}{sector ? `, ${sector}` : ''}</span> : null}</h1>
          {master && t && (
            <p className="text-body text-warm-600 mt-1">
              Master schedule, read {d(master.asOf)}. Contractor data is current for <span className="font-semibold text-ink">{t.byStatus.current} of {t.projects}</span> project{t.projects === 1 ? '' : 's'}
              {t.byStatus.provisional ? `, ${t.byStatus.provisional} not accepted` : ''}{t.byStatus.stale ? `, ${t.byStatus.stale} stale` : ''}{t.byStatus.expired ? `, ${t.byStatus.expired} expired` : ''}{t.byStatus.none ? `, ${t.byStatus.none} with no schedule` : ''}.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-2 print:hidden">
          {programs.length > 1 && (
            <label className="text-caption font-semibold text-warm-600">Program
              <select value={programId ?? ''} onChange={e => { setSector(''); router.push(`/dashboard/programs?program=${e.target.value}`) }} className={`${inputClass} mt-1 block w-56`}>
                {programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
          {view && tab !== 'setup' && <>
            <a href={`/api/programs/${view.program.id}/export?report=${report}`} className={buttonClass.secondary}><Download size={15} aria-hidden="true" />Download (CSV)</a>
            <Button variant="secondary" onClick={() => window.print()}><Printer size={15} aria-hidden="true" />Print</Button>
          </>}
        </div>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <TabList tab={tab} onChange={id => { setTab(id); setNotice('') }} />
        {sectorNames.length > 1 && tab !== 'sectors' && tab !== 'setup' && (
          <label className="text-caption font-semibold text-warm-600 flex items-center gap-2">Sector
            <select value={sector} onChange={e => setSector(e.target.value)} className={`${inputClass} w-48`}>
              <option value="">All sectors</option>
              {sectorNames.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}
      </div>

      {!view || !master ? <div className="py-10 text-body text-warm-600 flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Reading the contractors&apos; schedules…</div> : (
        <div role="tabpanel" id={`master-panel-${tab}`} aria-labelledby={`master-tab-${tab}`} className="space-y-4">
          {tab !== 'setup' && master.rows.length === 0 && (
            <EmptyState heading="h2" title="No projects in this program yet" action={view.canEdit ? { label: 'Add projects', onClick: () => setTab('setup') } : undefined}>
              Add the program&apos;s projects, then point each standard milestone at the matching activity in the contractor&apos;s schedule.
            </EmptyState>
          )}
          {tab === 'milestones' && master.rows.length > 0 && <Milestones master={master} rows={rows} view={view} onCell={(row, index) => setCell({ row, index })} />}
          {tab === 'phases' && master.rows.length > 0 && <Phases master={master} rows={rows} />}
          {tab === 'sectors' && master.rows.length > 0 && <Sectors master={master} />}
          {tab === 'lookahead' && master.rows.length > 0 && <LookAhead items={view.lookAhead.filter(i => !sector || (i.sector ?? NO_SECTOR) === sector || (!i.projectId && !i.sector))} />}
          {tab === 'parties' && <Parties view={view} sector={sector} onChanged={reload} onError={setError} />}
          {tab === 'updates' && master.rows.length > 0 && <Updates master={master} rows={rows} view={view} />}
          {tab === 'setup' && <Setup view={view} onChanged={async msg => { setNotice(msg); await reload(); await loadList() }} onError={setError}
            onDeleted={async () => { setView(null); const left = await loadList(); router.replace(left.length ? `/dashboard/programs?program=${left[0].id}` : '/dashboard/programs') }} />}
          {tab === 'setup' && createForm && <Section title="Another program" description="Each program has its own projects and its own standard milestones.">{createForm}</Section>}
        </div>
      )}

      {master && tab !== 'setup' && (
        <p className="hidden print:block text-caption text-warm-600 pt-2">
          Contractor dates are read from each contractor&apos;s newest schedule upload by activity ID. &quot;Owner&quot; marks the owner&apos;s own forecast. Contractor data is stale after {STALE_AFTER_DAYS} days without an update and expired after {EXPIRED_AFTER_DAYS}. RunF9, read {d(master.asOf)}.
        </p>
      )}

      {cell && view && <CellDialog view={view} row={cell.row} index={cell.index} onClose={() => setCell(null)} onSaved={async () => { setCell(null); await reload() }} />}
    </div>
  )
}

function TabList({ tab, onChange }: { tab: TabId; onChange: (id: TabId) => void }) {
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const i = TABS.findIndex(x => x.id === tab)
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]
    onChange(next.id)
    requestAnimationFrame(() => document.getElementById(`master-tab-${next.id}`)?.focus())
  }
  return (
    <div role="tablist" aria-label="Master schedule views" onKeyDown={onKey} className="flex gap-1.5 overflow-x-auto whitespace-nowrap [&>button]:flex-shrink-0 max-w-full">
      {TABS.map(x => (
        <button key={x.id} id={`master-tab-${x.id}`} role="tab" type="button" aria-selected={tab === x.id} aria-controls={tab === x.id ? `master-panel-${x.id}` : undefined} tabIndex={tab === x.id ? 0 : -1}
          onClick={() => onChange(x.id)}
          className={`pressable rounded-lg px-3 min-h-[32px] text-body font-semibold border ${tab === x.id ? 'border-navy-950 bg-navy-950 text-white' : 'border-warm-300 bg-white text-warm-700 hover:text-ink'}`}>
          {x.label}
        </button>
      ))}
    </div>
  )
}

/** Rows grouped by sector, in the master's sector order. */
function bySector(master: Master, rows: MasterRow[]): { sector: string; rows: MasterRow[] }[] {
  return master.sectors.map(s => ({ sector: s.sector, rows: rows.filter(r => (r.sector ?? NO_SECTOR) === s.sector) })).filter(g => g.rows.length)
}

function projectLink(view: View, r: MasterRow) {
  const sid = view.projects.find(p => p.id === r.id)?.scheduleId
  return sid ? <Link href={`/dashboard/project?schedule=${sid}`} className="font-semibold text-ink hover:underline">{r.name}</Link> : <span className="font-semibold text-ink">{r.name}</span>
}

function CellText({ c }: { c: MasterCell }) {
  if (!c.mapped) return c.ownerForecast ? <span className="block text-caption text-status-attention">Owner: {d(c.ownerForecast.date)}</span> : <><span className="text-warm-400" aria-hidden="true">–</span><span className="sr-only">not mapped</span></>
  if (c.missing) return <span className="text-caption text-status-at-risk">Not in the newest upload</span>
  if (!c.date) return <span className="text-caption text-warm-600">No date in the file</span>
  return (
    <>
      <span className={`block whitespace-nowrap ${c.actual ? 'font-semibold text-bar-done' : 'text-ink'}`}>{d(c.date)}{c.actual ? <span className="font-normal text-caption text-warm-600"> actual</span> : null}</span>
      {c.varianceDays !== null && c.varianceDays !== 0 && <span className={`block text-caption ${c.varianceDays > 0 ? 'text-status-at-risk' : 'text-status-on-track'}`}>{signed(c.varianceDays)} d against baseline</span>}
      {c.ownerForecast && <span className="block text-caption text-status-attention">Owner: {d(c.ownerForecast.date)}</span>}
    </>
  )
}

function Milestones({ master, rows, view, onCell }: { master: Master; rows: MasterRow[]; view: View; onCell: (row: MasterRow, index: number) => void }) {
  return (
    <>
      <div className={card} tabIndex={0} role="region" aria-label="Milestones by project">
        <table className="w-full">
          <caption className="sr-only">Milestones by project. Each date is read from the contractor&apos;s newest schedule upload.</caption>
          <thead>
            <tr className="border-b border-warm-200">
              <th scope="col" className={`${th} md:sticky md:left-0 bg-white print:static`}>Project</th>
              <th scope="col" className={th}>Contractor data</th>
              {master.dictionary.map(m => <th key={m.key} scope="col" className={th}><span className="block font-normal">{m.phase}</span>{m.name}</th>)}
            </tr>
          </thead>
          {bySector(master, rows).map(g => (
            <tbody key={g.sector}>
              <tr className="bg-warm-100"><th scope="colgroup" colSpan={master.dictionary.length + 2} className="px-3 py-1.5 text-left text-caption font-semibold text-ink">{g.sector} <span className="font-normal text-warm-600">({g.rows.length})</span></th></tr>
              {g.rows.map(r => (
                <tr key={r.id} className="border-b border-warm-200 last:border-0">
                  <th scope="row" className={`${td} md:sticky md:left-0 bg-white text-left font-normal min-w-[150px] md:min-w-[180px] print:static`}>
                    {projectLink(view, r)}
                    {(r.contractor || r.location) && <span className="block text-caption text-warm-600">{[r.contractor, r.location].filter(Boolean).join(' · ')}</span>}
                  </th>
                  <td className={`${td} min-w-[170px]`}><StatusPill status={r.status} /><span className="block text-caption text-warm-600 mt-0.5">{sourceLine(r)}</span></td>
                  {r.cells.map((c, i) => (
                    <td key={c.key} className={`${td} min-w-[124px]`}>
                      {view.canEdit ? (
                        <button type="button" onClick={() => onCell(r, i)} className="block w-full text-left rounded-lg -mx-1 px-1 py-0.5 hover:bg-warm-100 print:hidden">
                          <span className="sr-only">{master.dictionary[i].name}, {r.name}: </span>
                          <CellText c={c} />
                          <span className="sr-only">. Change</span>
                        </button>
                      ) : null}
                      <div className={view.canEdit ? 'hidden print:block' : ''}><CellText c={c} /></div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      <Hint className="print:hidden">
        Every date comes from the contractor&apos;s newest upload, read by activity ID, so it matches the contractor&apos;s schedule. A date in blue marked &quot;actual&quot; has happened; the others are the contractor&apos;s forecast.
        &quot;Owner&quot; is what your team expects instead, kept beside the contractor&apos;s date and never in place of it.
        Contractor data is stale after {STALE_AFTER_DAYS} days without a new update and expired after {EXPIRED_AFTER_DAYS}. &quot;Not accepted&quot; means the newest upload was reviewed as revise and resubmit.
      </Hint>
    </>
  )
}

function Phases({ master, rows }: { master: Master; rows: MasterRow[] }) {
  const all = rows.flatMap(r => r.phases.flatMap(p => [p.start, p.finish, p.baselineStart, p.baselineFinish])).filter((x): x is string => !!x)
  if (!all.length) return <p className="text-body text-warm-600">No phase has a date yet. Map at least one milestone of a phase in each project.</p>
  const min = all.reduce((a, b) => (a < b ? a : b)), max = all.reduce((a, b) => (a > b ? a : b))
  const span = Math.max(1, daysBetween(min, max))
  const pct = (x: string) => Math.min(100, Math.max(0, (daysBetween(min, x) / span) * 100))
  const years: string[] = []
  for (let y = Number(min.slice(0, 4)) + 1; y <= Number(max.slice(0, 4)); y++) years.push(`${y}-01-01`)
  const todayPct = master.asOf >= min && master.asOf <= max ? pct(master.asOf) : null
  return (
    <>
      <div className={card} tabIndex={0} role="region" aria-label="Phases by project">
        <table className="w-full">
          <caption className="sr-only">Phases by project, with a timeline.</caption>
          <thead>
            <tr className="border-b border-warm-200">
              <th scope="col" className={th}>Project</th><th scope="col" className={th}>In phase</th><th scope="col" className={th}>Finish</th><th scope="col" className={th}>Against baseline</th>
              <th scope="col" className={`${th} w-[55%] min-w-[420px]`}>
                <span className="sr-only">Timeline</span>
                <span aria-hidden="true" className="relative block h-4 font-normal">
                  <span className="absolute left-0">{min.slice(0, 4)}</span>
                  {years.map(y => <span key={y} className="absolute" style={{ left: `${pct(y)}%` }}>{y.slice(0, 4)}</span>)}
                </span>
              </th>
            </tr>
          </thead>
          {bySector(master, rows).map(g => (
            <tbody key={g.sector}>
              <tr className="bg-warm-100"><th scope="colgroup" colSpan={5} className="px-3 py-1.5 text-left text-caption font-semibold text-ink">{g.sector}</th></tr>
              {g.rows.map(r => (
                <tr key={r.id} className="border-b border-warm-200 last:border-0">
                  <th scope="row" className={`${td} text-left font-semibold text-ink min-w-[170px]`}>{r.name}<span className="block mt-0.5"><StatusPill status={r.status} /></span></th>
                  <td className={td}>{r.currentPhase ?? ''}</td>
                  <td className={`${td} whitespace-nowrap`}>{d(r.finish)}</td>
                  <td className={`${td} whitespace-nowrap ${(r.finishVarianceDays ?? 0) > 0 ? 'text-status-at-risk font-semibold' : ''}`}>{r.finishVarianceDays === null ? '' : r.finishVarianceDays === 0 ? 'On baseline' : `${signed(r.finishVarianceDays)} days`}</td>
                  <td className={`${td} py-2`}>
                    <div className="relative h-9">
                      {years.map(y => <span key={y} aria-hidden="true" className="absolute top-0 bottom-0 w-px bg-warm-200" style={{ left: `${pct(y)}%` }} />)}
                      {todayPct !== null && <span aria-hidden="true" className="absolute top-0 bottom-0 w-px bg-ink" style={{ left: `${todayPct}%` }} />}
                      {r.phases.map(p => {
                        if (!p.start && !p.finish) return null
                        const s = p.start ?? p.finish!, f = p.finish ?? p.start!
                        const left = pct(s), width = Math.max(0.6, pct(f) - left)
                        const late = (p.varianceDays ?? 0) > 0
                        return (
                          <span key={p.phase}>
                            <span title={`${p.phase}: ${d(s)} to ${d(f)}`} className={`absolute top-1 h-4 rounded-sm overflow-hidden whitespace-nowrap px-1 text-caption leading-4 ${p.done ? 'bg-bar-done text-white' : late ? 'bg-bar-critical text-white' : 'bg-bar-todo text-ink'}`} style={{ left: `${left}%`, width: `${width}%` }}>
                              <span aria-hidden="true">{p.phase}</span>
                            </span>
                            {p.baselineStart && p.baselineFinish && <span aria-hidden="true" className="absolute top-6 h-1.5 rounded-sm bg-warm-400" style={{ left: `${pct(p.baselineStart)}%`, width: `${Math.max(0.6, pct(p.baselineFinish) - pct(p.baselineStart))}%` }} />}
                            <span className="sr-only">{p.phase}: {d(s)} to {d(f)}{p.done ? ', complete' : ''}{late ? `, ${p.varianceDays} days later than baseline` : ''}. </span>
                          </span>
                        )
                      })}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      <p className="text-caption text-warm-600 flex flex-wrap gap-x-4 gap-y-1">
        <span><span aria-hidden="true" className="inline-block w-3 h-3 rounded-sm bg-bar-done align-[-2px] mr-1" />Phase complete</span>
        <span><span aria-hidden="true" className="inline-block w-3 h-3 rounded-sm bg-bar-todo align-[-2px] mr-1" />Remaining</span>
        <span><span aria-hidden="true" className="inline-block w-3 h-3 rounded-sm bg-bar-critical align-[-2px] mr-1" />Finishes later than baseline</span>
        <span><span aria-hidden="true" className="inline-block w-3 h-1.5 rounded-sm bg-warm-400 align-middle mr-1" />Baseline</span>
        <span><span aria-hidden="true" className="inline-block w-px h-3 bg-ink align-[-2px] mr-1" />{d(master.asOf)}</span>
      </p>
      <Hint className="print:hidden">A phase runs from its earliest mapped milestone to its latest. Each end is the contractor&apos;s date for that milestone, so a phase with one mapped milestone shows as a single day.</Hint>
    </>
  )
}

function Sectors({ master }: { master: Master }) {
  return (
    <>
      <div className={card} tabIndex={0} role="region" aria-label="Sectors">
        <table className="w-full">
          <caption className="sr-only">Sectors: projects, data currency, dates and phases.</caption>
          <thead><tr className="border-b border-warm-200">
            <th scope="col" className={th}>Sector</th><th scope="col" className={`${th} text-right`}>Projects</th><th scope="col" className={th}>Data current</th>
            <th scope="col" className={th}>Earliest date</th><th scope="col" className={th}>Latest finish</th><th scope="col" className={`${th} text-right`}>Later than baseline</th><th scope="col" className={`${th} text-right`}>Worst</th>
            {master.phases.map(p => <th key={p} scope="col" className={`${th} text-right`}>In {p}</th>)}
          </tr></thead>
          <tbody>
            {master.sectors.map(s => (
              <tr key={s.sector} className="border-b border-warm-200 last:border-0">
                <th scope="row" className={`${td} text-left font-semibold text-ink`}>{s.sector}</th>
                <td className={`${td} text-right`}>{s.projects}</td>
                <td className={td}>{s.byStatus.current} of {s.projects}</td>
                <td className={`${td} whitespace-nowrap`}>{d(s.start)}</td><td className={`${td} whitespace-nowrap`}>{d(s.finish)}</td>
                <td className={`${td} text-right ${s.late ? 'text-status-at-risk font-semibold' : ''}`}>{s.late}</td>
                <td className={`${td} text-right whitespace-nowrap`}>{s.worstVarianceDays === null ? '' : `${signed(s.worstVarianceDays)} d`}</td>
                {master.phases.map(p => <td key={p} className={`${td} text-right`}>{s.inPhase[p] || ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2 className="text-heading font-semibold text-ink pt-2">Milestones reached</h2>
      <div className={card} tabIndex={0} role="region" aria-label="Milestones reached by sector">
        <table className="w-full">
          <caption className="sr-only">Milestones reached by sector, of the projects that mapped the milestone.</caption>
          <thead><tr className="border-b border-warm-200"><th scope="col" className={th}>Sector</th>{master.dictionary.map(m => <th key={m.key} scope="col" className={th}>{m.name}</th>)}</tr></thead>
          <tbody>
            {master.sectors.map(s => (
              <tr key={s.sector} className="border-b border-warm-200 last:border-0">
                <th scope="row" className={`${td} text-left font-semibold text-ink`}>{s.sector}</th>
                {s.milestones.map(m => <td key={m.key} className={td}>{m.mapped ? <>{m.achieved} of {m.mapped}{m.latest && m.achieved < m.mapped ? <span className="block text-caption text-warm-600">last {d(m.latest)}</span> : null}</> : ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function LookAhead({ items }: { items: LookAheadItem[] }) {
  if (!items.length) return <p className="text-body text-warm-600">Nothing is due in the next 90 days.</p>
  return (
    <div className={card} tabIndex={0} role="region" aria-label="Look-ahead">
      <table className="w-full">
        <caption className="sr-only">What is due in the next 90 days: contractor milestones and other parties&apos; items.</caption>
        <thead><tr className="border-b border-warm-200"><th scope="col" className={th}>Date</th><th scope="col" className={th}>When</th><th scope="col" className={th}>Project</th><th scope="col" className={th}>What</th><th scope="col" className={th}>Who or source</th></tr></thead>
        <tbody>
          {items.map((i, n) => (
            <tr key={n} className="border-b border-warm-200 last:border-0">
              <td className={`${td} whitespace-nowrap font-semibold text-ink`}>{d(i.date)}</td>
              <td className={`${td} whitespace-nowrap ${i.daysOut < 0 ? 'text-status-at-risk font-semibold' : ''}`}>{i.daysOut < 0 ? `${-i.daysOut} days ago, not reached` : i.daysOut === 0 ? 'Today' : `In ${i.daysOut} days`}</td>
              <td className={td}>{i.project}{i.sector ? <span className="block text-caption text-warm-600">{i.sector}</span> : null}</td>
              <td className={td}>{i.what}</td><td className={td}>{i.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Updates({ master, rows, view }: { master: Master; rows: MasterRow[]; view: View }) {
  return (
    <>
      <div className={card} tabIndex={0} role="region" aria-label="Contractor updates">
        <table className="w-full">
          <caption className="sr-only">Contractor updates: how current each project&apos;s data is.</caption>
          <thead><tr className="border-b border-warm-200">
            <th scope="col" className={th}>Project</th><th scope="col" className={th}>Contractor</th><th scope="col" className={th}>Newest upload</th><th scope="col" className={th}>Data date</th>
            <th scope="col" className={`${th} text-right`}>Days old</th><th scope="col" className={th}>Status</th><th scope="col" className={th}>Baseline</th><th scope="col" className={th}>Milestones mapped</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-b border-warm-200 last:border-0">
                <th scope="row" className={`${td} text-left font-normal`}>{projectLink(view, r)}{r.sector ? <span className="block text-caption text-warm-600">{r.sector}</span> : null}</th>
                <td className={td}>{r.contractor ?? ''}</td><td className={td}>{r.latest?.version ?? ''}</td><td className={`${td} whitespace-nowrap`}>{d(r.latest?.dataDate)}</td>
                <td className={`${td} text-right`}>{r.ageDays ?? ''}</td><td className={td}><StatusPill status={r.status} /></td><td className={td}>{r.baseline?.version ?? <span className="text-warm-600">The file&apos;s own targets</span>}</td>
                <td className={td}>{r.mappedCount} of {master.dictionary.length}{r.missingCount ? <span className="block text-caption text-status-at-risk">{r.missingCount} not in the newest upload</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Hint className="print:hidden">A project is current while its newest upload&apos;s data date is no more than {STALE_AFTER_DAYS} days old, stale up to {EXPIRED_AFTER_DAYS} days and expired after that. Upload the contractor&apos;s next update to the project and the master picks it up.</Hint>
    </>
  )
}

/* ─── Other parties ───────────────── */

const PARTY_STATE: Record<PartyRow['status'], { label: string; cls: string }> = {
  done: { label: 'Done', cls: 'text-status-on-track bg-status-on-track-bg' }, late: { label: 'Late', cls: 'text-status-at-risk bg-status-at-risk-bg' },
  due_soon: { label: 'Due soon', cls: 'text-status-attention bg-status-attention-bg' }, open: { label: 'Open', cls: 'text-warm-700 bg-warm-100' },
}
const BLANK = { party: '', title: '', projectId: '', milestoneKey: '', needDate: '', forecastDate: '', actualDate: '', note: '' }

function Parties({ view, sector, onChanged, onError }: { view: View; sector: string; onChanged: () => Promise<void>; onError: (m: string) => void }) {
  const [form, setForm] = useState<typeof BLANK & { id?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const listId = useId()
  const base = `/api/programs/${view.program.id}/items`
  const items = view.master.parties.filter(p => !sector || (p.sector ?? (p.projectId ? NO_SECTOR : '')) === sector || !p.projectId)
  const save = async () => {
    if (!form) return
    setBusy(true)
    const body = { party: form.party, title: form.title, projectId: form.projectId || null, milestoneKey: form.milestoneKey || null, needDate: form.needDate || null, forecastDate: form.forecastDate || null, actualDate: form.actualDate || null, note: form.note }
    const r = form.id ? await send(`${base}?itemId=${form.id}`, 'PATCH', body) : await send(base, 'POST', body)
    setBusy(false)
    if (!r.ok) { onError(r.data.error || 'The item was not saved. Try again.'); return }
    onError(''); setForm(null); await onChanged()
  }
  const remove = async (p: PartyRow) => {
    if (!window.confirm(`Delete "${p.title}"?`)) return
    const r = await send(`${base}?itemId=${p.id}`, 'DELETE')
    if (!r.ok) { onError(r.data.error || 'The item was not deleted. Try again.'); return }
    await onChanged()
  }
  const set = (k: keyof typeof BLANK) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(f => (f ? { ...f, [k]: e.target.value } : f))
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body text-warm-600 max-w-3xl">What the program needs from parties other than the contractor: funding, permits, utility work, design reviews, owner purchases and move-in. Each item can name the contractor milestone it is needed for.</p>
        {view.canEdit && !form && <Button onClick={() => setForm({ ...BLANK })} className="print:hidden"><Plus size={15} aria-hidden="true" />Add an item</Button>}
      </div>
      {form && (
        <form onSubmit={e => { e.preventDefault(); save() }} className="rounded-[14px] border border-warm-200 bg-white p-4 grid gap-3 md:grid-cols-4 print:hidden">
          <Field label="Who owes it">{p => <><input {...p} list={listId} value={form.party} onChange={set('party')} maxLength={60} required className={inputClass} /><datalist id={listId}>{PARTY_SUGGESTIONS.map(s => <option key={s} value={s} />)}</datalist></>}</Field>
          <div className="md:col-span-3"><Field label="Item">{p => <input {...p} value={form.title} onChange={set('title')} maxLength={200} required minLength={3} placeholder="For example: funds obligated for the school" className={inputClass} />}</Field></div>
          <Field label="Project">{p => <select {...p} value={form.projectId} onChange={set('projectId')} className={inputClass}><option value="">Whole program</option>{view.master.rows.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select>}</Field>
          <Field label="Needed for">{p => <select {...p} value={form.milestoneKey} onChange={set('milestoneKey')} className={inputClass}><option value="">No milestone</option>{view.master.dictionary.map(m => <option key={m.key} value={m.key}>{m.name}</option>)}</select>}</Field>
          <Field label="Needed by">{p => <input {...p} type="date" value={form.needDate} onChange={set('needDate')} className={inputClass} />}</Field>
          <Field label="Forecast">{p => <input {...p} type="date" value={form.forecastDate} onChange={set('forecastDate')} className={inputClass} />}</Field>
          <Field label="Actual">{p => <input {...p} type="date" value={form.actualDate} onChange={set('actualDate')} className={inputClass} />}</Field>
          <div className="md:col-span-3"><Field label="Note">{p => <input {...p} value={form.note} onChange={set('note')} maxLength={500} className={inputClass} />}</Field></div>
          <div className="md:col-span-4 flex gap-2"><Button type="submit" disabled={busy}>{form.id ? 'Save' : 'Add'}</Button><Button type="button" variant="secondary" onClick={() => setForm(null)}>Cancel</Button></div>
        </form>
      )}
      {items.length === 0 ? <p className="text-body text-warm-600">No items yet.</p> : (
        <div className={card} tabIndex={0} role="region" aria-label="Other parties">
          <table className="w-full">
            <caption className="sr-only">What other parties owe the program.</caption>
            <thead><tr className="border-b border-warm-200">
              <th scope="col" className={th}>Who</th><th scope="col" className={th}>Item</th><th scope="col" className={th}>Project</th><th scope="col" className={th}>Needed by</th><th scope="col" className={th}>Forecast</th>
              <th scope="col" className={th}>Actual</th><th scope="col" className={th}>State</th><th scope="col" className={th}>Needed for</th>{view.canEdit && <th scope="col" className={`${th} print:hidden`}><span className="sr-only">Actions</span></th>}
            </tr></thead>
            <tbody>
              {items.map(p => (
                <tr key={p.id} className="border-b border-warm-200 last:border-0">
                  <td className={`${td} font-semibold text-ink`}>{p.party}</td>
                  <td className={td}>{p.title}{p.note ? <span className="block text-caption text-warm-600">{p.note}</span> : null}</td>
                  <td className={td}>{p.project ?? 'Whole program'}</td>
                  <td className={`${td} whitespace-nowrap`}>{d(p.needDate)}</td><td className={`${td} whitespace-nowrap`}>{d(p.forecastDate)}</td><td className={`${td} whitespace-nowrap`}>{d(p.actualDate)}</td>
                  <td className={td}><span className={`inline-block rounded-lg px-2 py-0.5 text-caption font-semibold whitespace-nowrap ${PARTY_STATE[p.status].cls}`}>{PARTY_STATE[p.status].label}{p.status === 'late' && p.lateDays ? `, ${p.lateDays} d` : ''}</span></td>
                  <td className={td}>{p.neededFor ? <>{p.neededFor.name}{p.neededFor.date ? <span className="block text-caption text-warm-600">contractor date {d(p.neededFor.date)}</span> : null}</> : ''}</td>
                  {view.canEdit && <td className={`${td} whitespace-nowrap print:hidden`}>
                    <Button variant="ghost" onClick={() => setForm({ id: p.id, party: p.party, title: p.title, projectId: p.projectId ?? '', milestoneKey: p.milestoneKey ?? '', needDate: p.needDate ?? '', forecastDate: p.forecastDate ?? '', actualDate: p.actualDate ?? '', note: p.note ?? '' })} aria-label={`Change ${p.title}`}>Change</Button>
                    <button type="button" onClick={() => remove(p)} aria-label={`Delete ${p.title}`} className="ml-2 inline-flex items-center justify-center w-8 h-8 rounded-lg text-warm-600 hover:bg-warm-100 hover:text-status-at-risk align-middle"><Trash2 size={15} aria-hidden="true" /></button>
                  </td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

/* ─── One milestone of one project: which contractor activity it reads, and the owner's forecast ───────────────── */

function CellDialog({ view, row, index, onClose, onSaved }: { view: View; row: MasterRow; index: number; onClose: () => void; onSaved: () => Promise<void> }) {
  const m = view.master.dictionary[index]
  const c = row.cells[index]
  const base = `/api/programs/${view.program.id}/projects/${row.id}`
  const [q, setQ] = useState('')
  const [acts, setActs] = useState<PickActivity[] | null>(null)
  const [pick, setPick] = useState<MappedRef | null>(c.mapped)
  const [pickName, setPickName] = useState(c.activityName ?? '')
  const [ofDate, setOfDate] = useState(c.ownerForecast?.date ?? '')
  const [ofNote, setOfNote] = useState(c.ownerForecast?.note ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => { closeRef.current?.focus() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => {
    if (!row.latest) return
    const h = setTimeout(async () => {
      const res = await fetch(`${base}/activities?q=${encodeURIComponent(q)}`).catch(() => null)
      const data = res ? await res.json().catch(() => ({})) : {}
      setActs(res?.ok ? (data.activities as PickActivity[]) : [])
    }, 200)
    return () => clearTimeout(h)
  }, [q, base, row.latest])

  const save = async () => {
    setBusy(true)
    const changedMap = JSON.stringify(pick) !== JSON.stringify(c.mapped)
    const body: Record<string, unknown> = {}
    if (changedMap) body.mapping = { [m.key]: pick }
    const hadOf = c.ownerForecast
    if (ofDate) { if (!hadOf || hadOf.date !== ofDate || (hadOf.note ?? '') !== ofNote) body.ownerForecasts = { [m.key]: { date: ofDate, note: ofNote } } }
    else if (hadOf) body.ownerForecasts = { [m.key]: null }
    if (!Object.keys(body).length) { onClose(); return }
    const r = await send(base, 'PATCH', body)
    setBusy(false)
    if (!r.ok) { setError(r.data.error || 'The change was not saved. Try again.'); return }
    await onSaved()
  }

  return createPortal(
    <div className={`${digitsFont.variable} font-sans fixed inset-0 z-50 overflow-y-auto bg-navy-950/45 p-3 md:p-8 flex justify-center items-start`} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="cell-h" className="relative w-full max-w-2xl rounded-2xl bg-warm-50 border border-warm-200 p-5 md:p-6 space-y-4 shadow-[0_24px_60px_-20px_rgb(29_33_37/0.45)]">
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 inline-flex items-center justify-center w-10 h-10 rounded-lg text-ink hover:bg-warm-200"><X size={18} aria-hidden="true" /></button>
        <div className="pr-10">
          <h2 id="cell-h" className="text-heading font-semibold text-ink">{m.name}</h2>
          <p className="text-body text-warm-600">{row.name}. {sourceLine(row)}</p>
        </div>
        {error ? <Alert tone="error">{error}</Alert> : null}

        <div className="rounded-[14px] border border-warm-200 bg-white p-4 space-y-3">
          <h3 className="text-subhead font-semibold text-ink">Contractor&apos;s activity</h3>
          {pick ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body text-warm-700">
              <span><span className="font-semibold text-ink">{pick.code}</span> {pickName}</span>
              <label className="flex items-center gap-1.5 whitespace-nowrap">Reads its
                <select value={pick.use} onChange={e => setPick({ ...pick, use: e.target.value === 'start' ? 'start' : 'finish' })} className={`${inputClass} w-28`} aria-label="Which date of the activity">
                  <option value="finish">finish</option><option value="start">start</option>
                </select>
              </label>
              <Button variant="ghost" onClick={() => { setPick(null); setPickName('') }}>Remove</Button>
            </div>
          ) : <p className="text-body text-warm-600">Not mapped. Choose the activity in the contractor&apos;s schedule that is this milestone.</p>}
          {c.mapped && !c.missing && JSON.stringify(pick) === JSON.stringify(c.mapped) && (
            <dl className="grid grid-cols-3 gap-2 text-body">
              <div><dt className="text-caption text-warm-600">Contractor date</dt><dd className="font-semibold text-ink">{d(c.date) || 'None'}{c.actual ? ' (actual)' : ''}</dd></div>
              <div><dt className="text-caption text-warm-600">Baseline</dt><dd className="text-ink">{d(c.baseline) || 'None'}</dd></div>
              <div><dt className="text-caption text-warm-600">Previous update</dt><dd className="text-ink">{d(c.previous) || 'None'}{c.movedDays ? ` (${signed(c.movedDays)} d since)` : ''}</dd></div>
            </dl>
          )}
          {c.missing && <Alert tone="warning">Activity {c.mapped?.code} is not in the newest upload. Choose the activity that replaced it.</Alert>}
          {row.latest ? (
            <>
              <Field label="Find an activity" hint="By name or activity ID. Milestone activities are listed first.">{p => <input {...p} value={q} onChange={e => setQ(e.target.value)} placeholder="For example: substantial completion" className={inputClass} />}</Field>
              <ul className="max-h-56 overflow-y-auto rounded-lg border border-warm-200 divide-y divide-warm-200 bg-white" aria-label="Activities in the newest upload">
                {acts === null ? <li className="px-3 py-2 text-body text-warm-600">Loading…</li> : acts.length === 0 ? <li className="px-3 py-2 text-body text-warm-600">No activity matches.</li> : acts.map(a => (
                  <li key={a.code}>
                    <button type="button" onClick={() => { setPick({ code: a.code, use: a.milestoneKind === 'start' ? 'start' : 'finish' }); setPickName(a.name) }} aria-pressed={pick?.code === a.code}
                      className={`w-full text-left px-3 py-2 text-body hover:bg-warm-100 ${pick?.code === a.code ? 'bg-accent-100' : ''}`}>
                      <span className="font-semibold text-ink">{a.code}</span> <span className="text-warm-700">{a.name}</span>
                      <span className="block text-caption text-warm-600">{a.type === 'milestone' ? 'Milestone' : 'Activity'}{a.start || a.finish ? `, ${a.type === 'milestone' ? d(a.finish ?? a.start) : `${d(a.start)} to ${d(a.finish)}`}` : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : <p className="text-body text-warm-600">This project has no schedule uploaded yet.</p>}
        </div>

        <div className="rounded-[14px] border border-warm-200 bg-white p-4 space-y-3">
          <h3 className="text-subhead font-semibold text-ink">Owner forecast</h3>
          <p className="text-body text-warm-600">What your team expects when it differs from the contractor&apos;s date, for example from a meeting or a site visit while an update is late. It is shown beside the contractor&apos;s date and labelled as the owner&apos;s.</p>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Date">{p => <input {...p} type="date" value={ofDate} onChange={e => setOfDate(e.target.value)} className={inputClass} />}</Field>
            <div className="md:col-span-2"><Field label="Where it comes from">{p => <input {...p} value={ofNote} onChange={e => setOfNote(e.target.value)} maxLength={300} placeholder="For example: progress meeting, 11/12" className={inputClass} />}</Field></div>
          </div>
        </div>
        <div className="flex gap-2"><Button onClick={save} disabled={busy}>Save</Button><Button variant="secondary" onClick={onClose}>Cancel</Button></div>
      </div>
    </div>, document.body)
}

/* ─── Set up: the program's name, its standard milestones and its projects ───────────────── */

function Setup({ view, onChanged, onError, onDeleted }: { view: View; onChanged: (msg: string) => Promise<void>; onError: (m: string) => void; onDeleted: () => Promise<void> }) {
  const { program, master } = view
  const base = `/api/programs/${program.id}`
  const [name, setName] = useState(program.name)
  const [dict, setDict] = useState<{ key?: string; name: string; phase: string }[]>(program.dictionary)
  const [add, setAdd] = useState({ scheduleId: '', sector: '', location: '', contractor: '' })
  const [edit, setEdit] = useState<Record<string, { sector: string; location: string; contractor: string }>>({})
  const [suggest, setSuggest] = useState<{ id: string; found: Record<string, MappedRef & { name: string }> } | null>(null)
  const [busy, setBusy] = useState(false)
  const sectorList = useId()
  useEffect(() => { setName(program.name); setDict(program.dictionary) }, [program])

  const run = async (fn: () => Promise<{ ok: boolean; data: { error?: string } }>, done: string) => {
    setBusy(true)
    const r = await fn()
    setBusy(false)
    if (!r.ok) { onError(r.data.error || 'The change was not saved. Try again.'); return false }
    onError(''); await onChanged(done); return true
  }
  const move = (i: number, by: number) => setDict(list => { const n = [...list]; const j = i + by; if (j < 0 || j >= n.length) return list; [n[i], n[j]] = [n[j], n[i]]; return n })
  const dirty = JSON.stringify(dict) !== JSON.stringify(program.dictionary)
  const sectors = [...new Set(master.rows.map(r => r.sector).filter((s): s is string => !!s))]

  if (!view.canEdit) return <p className="text-body text-warm-600">Your role can read this program. A scheduler or an admin can change its projects and milestones.</p>
  return (
    <div className="space-y-5">
      <Section title="Projects in this program" description="The program follows each project, so every new upload of a project is read as soon as it arrives.">
        {master.rows.length > 0 && (
          <div className={card} tabIndex={0} role="region" aria-label="Projects in this program">
            <table className="w-full">
              <caption className="sr-only">Projects in this program.</caption>
              <thead><tr className="border-b border-warm-200"><th scope="col" className={th}>Project</th><th scope="col" className={th}>Sector</th><th scope="col" className={th}>Location</th><th scope="col" className={th}>Contractor</th><th scope="col" className={th}>Milestones mapped</th><th scope="col" className={th}><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {master.rows.map(r => {
                  const e = edit[r.id]
                  return (
                    <tr key={r.id} className="border-b border-warm-200 last:border-0">
                      <th scope="row" className={`${td} text-left font-semibold text-ink`}>{r.name}</th>
                      {e ? (<>
                        <td className={td}><input aria-label={`Sector of ${r.name}`} list={sectorList} value={e.sector} onChange={ev => setEdit(x => ({ ...x, [r.id]: { ...e, sector: ev.target.value } }))} maxLength={60} className={inputClass} /></td>
                        <td className={td}><input aria-label={`Location of ${r.name}`} value={e.location} onChange={ev => setEdit(x => ({ ...x, [r.id]: { ...e, location: ev.target.value } }))} maxLength={80} className={inputClass} /></td>
                        <td className={td}><input aria-label={`Contractor of ${r.name}`} value={e.contractor} onChange={ev => setEdit(x => ({ ...x, [r.id]: { ...e, contractor: ev.target.value } }))} maxLength={120} className={inputClass} /></td>
                      </>) : (<><td className={td}>{r.sector ?? ''}</td><td className={td}>{r.location ?? ''}</td><td className={td}>{r.contractor ?? ''}</td></>)}
                      <td className={td}>{r.mappedCount} of {master.dictionary.length}</td>
                      <td className={`${td} whitespace-nowrap`}>
                        {e ? (<>
                          <Button variant="ghost" disabled={busy} onClick={async () => { if (await run(() => send(`${base}/projects/${r.id}`, 'PATCH', e), 'Saved.')) setEdit(x => { const n = { ...x }; delete n[r.id]; return n }) }}>Save</Button>
                          <Button variant="ghost" className="ml-2" onClick={() => setEdit(x => { const n = { ...x }; delete n[r.id]; return n })}>Cancel</Button>
                        </>) : (<>
                          <Button variant="ghost" onClick={() => setEdit(x => ({ ...x, [r.id]: { sector: r.sector ?? '', location: r.location ?? '', contractor: r.contractor ?? '' } }))} aria-label={`Change ${r.name}`}>Change</Button>
                          {r.latest && r.mappedCount < master.dictionary.length && <Button variant="ghost" className="ml-2" disabled={busy} aria-label={`Suggest milestones for ${r.name}`} onClick={async () => {
                            const res = await fetch(`${base}/projects/${r.id}`).catch(() => null)
                            const data = res ? await res.json().catch(() => ({})) : {}
                            if (!res?.ok) { onError(data.error || 'Could not read the schedule.'); return }
                            setSuggest({ id: r.id, found: data.suggestions })
                          }}>Suggest milestones</Button>}
                          <button type="button" aria-label={`Take ${r.name} out of the program`} disabled={busy} className="ml-2 inline-flex items-center justify-center w-8 h-8 rounded-lg text-warm-600 hover:bg-warm-100 hover:text-status-at-risk align-middle"
                            onClick={() => { if (window.confirm(`Take "${r.name}" out of this program? Its schedules stay; its milestone mapping, owner forecasts and items filed under it here are removed.`)) run(() => send(`${base}/projects/${r.id}`, 'DELETE'), 'Removed from the program.') }}><Trash2 size={15} aria-hidden="true" /></button>
                        </>)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {suggest && (() => {
          const r = master.rows.find(x => x.id === suggest.id)
          const found = Object.entries(suggest.found)
          return (
            <div className="rounded-[14px] border border-warm-200 bg-white p-4 space-y-2">
              <h3 className="text-subhead font-semibold text-ink">Suggested for {r?.name}</h3>
              {found.length === 0 ? <p className="text-body text-warm-600">No milestone activity in the newest upload has a name close to an unmapped milestone. Map them one by one from the Milestones view.</p> : (
                <ul className="text-body text-warm-700 space-y-1">{found.map(([k, v]) => <li key={k}><span className="font-semibold text-ink">{master.dictionary.find(m => m.key === k)?.name}</span> reads {v.code} {v.name} ({v.use})</li>)}</ul>
              )}
              <div className="flex gap-2">
                {found.length > 0 && <Button disabled={busy} onClick={async () => { if (await run(() => send(`${base}/projects/${suggest.id}`, 'PATCH', { mapping: Object.fromEntries(found.map(([k, v]) => [k, { code: v.code, use: v.use }])) }), 'Mapped. Check each one in the Milestones view.')) setSuggest(null) }}>Accept these</Button>}
                <Button variant="secondary" onClick={() => setSuggest(null)}>Close</Button>
              </div>
            </div>
          )
        })()}
        {view.available.length === 0 ? <p className="text-body text-warm-600">{master.rows.length ? 'Every project you can see is in this program.' : 'Upload a schedule first; each uploaded project can then be added here.'}</p> : (
          <form onSubmit={e => { e.preventDefault(); run(() => send(`${base}/projects`, 'POST', add), 'Added to the program.').then(ok => { if (ok) setAdd(a => ({ ...a, scheduleId: '', location: '' })) }) }} className="grid gap-3 md:grid-cols-5 items-end">
            <div className="md:col-span-2"><Field label="Add a project">{p => <select {...p} required value={add.scheduleId} onChange={e => setAdd({ ...add, scheduleId: e.target.value })} className={inputClass}><option value="">Choose a project</option>{view.available.map(a => <option key={a.key} value={a.scheduleId}>{a.name} ({a.version})</option>)}</select>}</Field></div>
            <Field label="Sector">{p => <input {...p} list={sectorList} value={add.sector} onChange={e => setAdd({ ...add, sector: e.target.value })} maxLength={60} placeholder="For example: Education" className={inputClass} />}</Field>
            <Field label="Contractor">{p => <input {...p} value={add.contractor} onChange={e => setAdd({ ...add, contractor: e.target.value })} maxLength={120} className={inputClass} />}</Field>
            <Button type="submit" disabled={busy || !add.scheduleId}><Plus size={15} aria-hidden="true" />Add</Button>
          </form>
        )}
        <datalist id={sectorList}>{sectors.map(s => <option key={s} value={s} />)}</datalist>
      </Section>

      <Section title="Standard milestones" description="The same short list for every project, so projects can be compared like for like. Each project points every milestone at one activity of its contractor's schedule.">
        <ol className="space-y-2">
          {dict.map((m, i) => (
            <li key={m.key ?? `new-${i}`} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
              <input aria-label={`Milestone ${i + 1} name`} value={m.name} onChange={e => setDict(l => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} maxLength={80} className={inputClass} />
              <input aria-label={`Milestone ${i + 1} phase`} value={m.phase} onChange={e => setDict(l => l.map((x, j) => (j === i ? { ...x, phase: e.target.value } : x)))} maxLength={40} className={inputClass} />
              <span className="flex">
                <button type="button" aria-label={`Move ${m.name || 'milestone'} up`} disabled={i === 0} onClick={() => move(i, -1)} className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-warm-600 hover:bg-warm-100 disabled:opacity-40"><ArrowUp size={15} aria-hidden="true" /></button>
                <button type="button" aria-label={`Move ${m.name || 'milestone'} down`} disabled={i === dict.length - 1} onClick={() => move(i, 1)} className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-warm-600 hover:bg-warm-100 disabled:opacity-40"><ArrowDown size={15} aria-hidden="true" /></button>
                <button type="button" aria-label={`Remove ${m.name || 'milestone'}`} onClick={() => setDict(l => l.filter((_, j) => j !== i))} className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-warm-600 hover:bg-warm-100 hover:text-status-at-risk"><Trash2 size={15} aria-hidden="true" /></button>
              </span>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setDict(l => [...l, { name: '', phase: l[l.length - 1]?.phase ?? '' }])}><Plus size={15} aria-hidden="true" />Add a milestone</Button>
          <Button disabled={busy || !dirty} onClick={() => run(() => send(base, 'PATCH', { milestones: dict }), 'Milestones saved.')}>Save milestones</Button>
        </div>
        <Hint>Left column is the milestone, right column is its phase. Milestones that share a phase name form that phase, in the order listed. Removing a milestone hides its mapping in every project.</Hint>
      </Section>

      <Section title="Program name">
        <form onSubmit={e => { e.preventDefault(); run(() => send(base, 'PATCH', { name }), 'Renamed.') }} className="flex flex-wrap items-end gap-2">
          <Field label="Name">{p => <input {...p} value={name} onChange={e => setName(e.target.value)} maxLength={120} className={`${inputClass} w-80 max-w-full`} />}</Field>
          <Button type="submit" variant="secondary" disabled={busy || name.trim() === program.name || name.trim().length < 2}>Rename</Button>
        </form>
      </Section>

      <Section title="Delete this program" tone="danger" description="Removes the program, its milestone mapping, owner forecasts and other parties' items. The projects and their schedules are not touched.">
        <Button variant="danger" disabled={busy} onClick={async () => {
          if (!window.confirm(`Delete the program "${program.name}"? This cannot be undone.`)) return
          const r = await send(base, 'DELETE')
          if (!r.ok) { onError(r.data.error || 'The program was not deleted. Try again.'); return }
          await onDeleted()
        }}>Delete program</Button>
      </Section>
    </div>
  )
}
