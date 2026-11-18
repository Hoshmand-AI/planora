'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleSlash, Loader2, Scale, XCircle } from 'lucide-react'
import { Disclosure } from '@/components/Disclosure'
import { fmtDateTime } from '@/lib/format'
import {
  FRAMEWORK_LABELS, RULE_KIND_LABELS,
  type Framework, type FrameworkResult, type RuleResult, type RuleResultStatus, type StandardsRunOutput,
} from '@/lib/standards/types'
import type { StoredRun, StoredRunSummary } from '@/lib/standards/store'

type Choice = 'RUNF9_COMPOSITE' | 'GAO_SCHEDULE_GUIDE' | 'DCMA_14' | 'USACE_UFGS' | 'PMI_SCHEDULING' | 'multiple'
const CHOICES: { value: Choice; label: string; hint: string }[] = [
  { value: 'RUNF9_COMPOSITE', label: 'RunF9 Composite (recommended)', hint: 'GAO screening checks and DCMA 14-point side by side, with any threshold conflicts listed.' },
  { value: 'GAO_SCHEDULE_GUIDE', label: 'GAO Schedule Assessment Guide', hint: 'The ten best practices, grouped under the four characteristics.' },
  { value: 'DCMA_14', label: 'DCMA 14-point', hint: 'The 14 DCMA assessment metrics.' },
  { value: 'USACE_UFGS', label: FRAMEWORK_LABELS.USACE_UFGS, hint: 'Checks drawn from the Army Corps guide specification for project schedules. Your contract\'s edited specification governs.' },
  { value: 'PMI_SCHEDULING', label: FRAMEWORK_LABELS.PMI_SCHEDULING, hint: 'Checks drawn from the schedule analysis items in section 3.4. Every numeric limit is a RunF9 default.' },
  { value: 'multiple', label: 'Several frameworks', hint: 'Choose two or more to run separately.' },
]
const SINGLE: Framework[] = ['RUNF9_COMPOSITE', 'GAO_SCHEDULE_GUIDE', 'DCMA_14', 'USACE_UFGS', 'PMI_SCHEDULING']
/** Frameworks whose limits (what the checks are drawn from, who governs) are shown open, above the results. */
const DISCLAIMER_OPEN: Framework[] = ['USACE_UFGS', 'PMI_SCHEDULING']

const RESULT_UI: Record<RuleResultStatus, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  pass: { label: 'Pass', cls: 'text-status-on-track', Icon: CheckCircle2 },
  warning: { label: 'Warning', cls: 'text-status-attention', Icon: AlertTriangle },
  fail: { label: 'Fail', cls: 'text-status-at-risk', Icon: XCircle },
  not_assessable: { label: 'Not assessable', cls: 'text-warm-600', Icon: CircleSlash },
}
const METRIC_LABEL: Record<string, string> = {
  'logic.open_ends_pct': 'Activities missing a predecessor or successor',
  'logic.lags_share_pct': 'Relationships with a lag',
  'logic.leads_count': 'Relationships with a lead (negative lag)',
  'logic.fs_share_pct': 'Finish-to-start relationships',
  'float.high_share_pct': 'Activities with high float',
  'float.high_days': 'High-float limit',
  'float.negative_count': 'Activities with negative float',
  'duration.long_share_pct': 'Activities with a long duration',
  'duration.long_days': 'Long-duration limit',
  'constraints.hard_share_pct': 'Activities with a hard constraint',
  'constraints.mandatory_count': 'Activities with a mandatory or zero-float constraint',
  'logic.open_ends_count': 'Activities missing a predecessor or successor',
  'logic.sf_count': 'Start-to-finish relationships',
  'resources.loaded_pct': 'Activities with resources or cost',
  'wbs.coverage_pct': 'Activities assigned to the WBS',
  'trace.unlinked_to_finish_pct': 'Activities with no path to the finish',
  'status.invalid_dates_count': 'Invalid actual or forecast dates',
  'index.cpli': 'Critical Path Length Index (CPLI)',
  'index.bei': 'Baseline Execution Index (BEI)',
  'execution.missed_share_pct': 'Baseline tasks missed',
  'baseline.coverage_pct': 'Activities with a baseline',
}
/** A plain name for a threshold's metric (never the internal key). */
const metricLabel = (key: string) => METRIC_LABEL[key] ?? (key.split('.').pop() ?? key).replace(/_(pct|count)$/, '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())

const SOURCE_LABEL = { published: 'published value', runf9_default: 'RunF9 screening default', org_configured: 'set by your organization' } as const

/** Standards view: pick framework(s), see results by characteristic with evidence and sources, record a run. */
export function StandardsPanel({ endpoint, canRecord }: { endpoint: string; canRecord: boolean }) {
  const [choice, setChoice] = useState<Choice | null>(null)
  const [multi, setMulti] = useState<Framework[]>(['GAO_SCHEDULE_GUIDE', 'DCMA_14'])
  const [result, setResult] = useState<StandardsRunOutput | null>(null)
  const [runs, setRuns] = useState<StoredRunSummary[]>([])
  const [viewing, setViewing] = useState<StoredRun | null>(null)
  const [loading, setLoading] = useState(false)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const fromDefaults = useRef(false)

  const frameworks: Framework[] | null = choice === null ? null : choice === 'multiple' ? multi : [choice]

  const load = useCallback(async (fws: Framework[] | null) => {
    setLoading(true); setError('')
    const q = fws ? `?frameworks=${encodeURIComponent(fws.join(','))}` : ''
    const res = await fetch(`${endpoint}${q}`).catch(() => null)
    const d = res ? await res.json().catch(() => ({})) : {}
    setLoading(false)
    if (!res) { setError('Network error. Check your connection and try again.'); return }
    if (!res.ok) { setError(d.error || 'Could not run the standards check.'); return }
    setResult(d.result); setRuns(d.runs || [])
    if (!fws && Array.isArray(d.defaults)) {
      const def = d.defaults as Framework[]
      fromDefaults.current = true
      if (def.length === 1 && SINGLE.includes(def[0])) setChoice(def[0] as Choice)
      else { setMulti(def); setChoice('multiple') }
    }
  }, [endpoint])

  // First load uses the organization's default framework(s); later loads follow the picker.
  useEffect(() => { if (choice === null) load(null) }, [choice, load])
  const key = frameworks?.join(',') ?? ''
  useEffect(() => {
    if (!key) return
    if (fromDefaults.current) { fromDefaults.current = false; return } // already showing the defaults' results
    setViewing(null)
    load(key.split(',') as Framework[])
  }, [key, load])

  const record = async () => {
    if (!frameworks?.length || recording) return
    setStatus(''); setError(''); setRecording(true)
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ frameworks }) }).catch(() => null)
    const d = res ? await res.json().catch(() => ({})) : {}
    setRecording(false)
    if (!res) { setError('Network error. The assessment was not recorded.'); return }
    if (!res.ok) { setError(d.error || 'Could not record the assessment.'); return }
    setResult(d.result); setRuns(r => [d.saved, ...r]); setStatus(`Assessment recorded (rules version ${d.saved.rulesVersion}).`)
  }
  const view = async (id: string) => {
    const res = await fetch(`${endpoint}?run=${encodeURIComponent(id)}`)
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { setError(d.error || 'Could not open that run.'); return }
    setViewing(d.run)
  }

  const shown = viewing?.results ?? result
  return (
    <div className="space-y-5">
      {/* One line: which framework, and the button that records the run. Each framework's description is under its results. */}
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="fw-choice" className="text-body font-medium text-ink">Framework</label>
          <select id="fw-choice" value={choice ?? ''} onChange={e => setChoice(e.target.value as Choice)} className="bg-white border border-warm-300 rounded-lg px-3 py-1.5 text-body text-ink min-w-[240px]">
            {choice === null && <option value="" disabled>Loading…</option>}
            {CHOICES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <span className="flex-1" />
          {canRecord && <button type="button" onClick={record} disabled={loading || recording || !frameworks?.length} className="pressable px-3.5 py-1.5 rounded-lg border border-warm-300 bg-white hover:bg-warm-100 text-body font-medium text-ink disabled:opacity-50">{recording ? 'Recording…' : 'Record this assessment'}</button>}
        </div>
        {choice === 'multiple' && (
          <fieldset className="mt-3">
            <legend className="text-body font-medium text-ink mb-1">Frameworks to run</legend>
            <div className="flex flex-wrap gap-4">
              {SINGLE.map(fw => (
                <label key={fw} className="flex items-center gap-2 text-body text-ink cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 accent-accent-500" checked={multi.includes(fw)}
                    onChange={e => setMulti(m => e.target.checked ? [...m.filter(x => x !== fw), fw] : m.filter(x => x !== fw))} />
                  {FRAMEWORK_LABELS[fw]}
                </label>
              ))}
            </div>
            {multi.length === 0 && <p className="text-body text-status-at-risk mt-1" role="alert">Choose at least one framework.</p>}
          </fieldset>
        )}
        <div aria-live="polite" className="text-body mt-2 empty:hidden">
          {status && <span className="text-status-on-track">{status}</span>}
          {error && <span role="alert" className="text-status-at-risk">{error}</span>}
        </div>
      </div>

      {viewing && (
        <div role="status" className="bg-status-info-bg border-l-2 border-status-info rounded-md px-4 py-3 text-body text-warm-700 flex flex-wrap items-center gap-2">
          <span>Showing the assessment recorded {fmtDateTime(viewing.createdAt)}{viewing.createdByName ? ` by ${viewing.createdByName}` : ''} (rules version {viewing.rulesVersion}).</span>
          <button type="button" onClick={() => setViewing(null)} className="underline text-ink">Back to the current results</button>
        </div>
      )}

      {loading && !shown && <div className="text-body text-warm-600 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Running rules…</div>}
      {shown && (
        <>
          <p role="note" className="text-caption text-warm-700 border-l-2 border-warm-300 pl-3">
            <Scale size={14} className="inline mr-1.5 -mt-0.5 text-warm-600" aria-hidden />{shown.disclaimer}
          </p>
          {shown.frameworks.map(f => <FrameworkView key={f.framework} f={f} />)}
          <p className="text-caption text-warm-600">Engine {shown.engineVersion} · rules version {shown.rulesVersion}</p>
        </>
      )}

      <Disclosure tone="card" title="Recorded assessments" meta={runs.length ? runs.length : 'none yet'}>
        <p className="text-caption text-warm-600 mb-2">Recording keeps the results, rules version and thresholds so an assessment can be reproduced later.</p>
        {runs.length > 0 && (
          <ul className="divide-y divide-warm-200">
            {runs.map(r => (
              <li key={r.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption">
                <span className="text-ink font-medium">{fmtDateTime(r.createdAt)}</span>
                <span className="text-warm-600">{r.frameworks.map(f => FRAMEWORK_LABELS[f] ?? f).join(', ')}</span>
                <span className="text-warm-600">{r.createdByName ?? ''}</span>
                <span className="text-warm-600 font-mono">rules {r.rulesVersion}</span>
                <button type="button" onClick={() => view(r.id)} className="ml-auto underline text-ink">View</button>
              </li>
            ))}
          </ul>
        )}
      </Disclosure>
    </div>
  )
}

/** The counts that say something: outcomes with none are left out. */
function Counts({ c }: { c: Record<RuleResultStatus, number> }) {
  const parts = [c.fail && `${c.fail} fail`, c.warning && `${c.warning} warning`, c.not_assessable && `${c.not_assessable} not assessable`, c.pass && `${c.pass} pass`].filter(Boolean)
  return <span className="text-caption text-warm-600">{parts.join(' · ')}</span>
}

function FrameworkView({ f }: { f: FrameworkResult }) {
  const hint = CHOICES.find(c => c.value === f.framework)?.hint
  return (
    <section aria-label={f.label} className="bg-white border border-warm-200 rounded-[14px] p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-heading font-semibold text-ink leading-tight">{f.label}</h2>
          <p className="text-caption text-warm-600 mt-0.5">{hint ? `${hint} ` : ''}{f.frameworkVersion}</p>
        </div>
        <div className="text-right">
          <div className="text-heading font-semibold text-ink tabular-nums">{f.score === null ? '—' : `${f.score}`}<span className="text-caption font-normal text-warm-600"> / 100 screening score</span></div>
          <Counts c={f.counts} />
        </div>
      </div>

      {DISCLAIMER_OPEN.includes(f.framework) && (
        <p role="note" className="mt-3 text-caption text-warm-700 border-l-2 border-warm-300 pl-3 max-w-3xl">{f.disclaimer}</p>
      )}

      <div className="mt-4 space-y-5">
        {f.groups.map(g => {
          const open = g.rules.filter(r => r.result !== 'pass')
          const passing = g.rules.filter(r => r.result === 'pass')
          return (
            <div key={g.key}>
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                <h3 className="text-subhead font-semibold text-ink">{g.label}</h3>
                <span className="text-caption text-warm-600">{g.score === null ? 'not assessable' : `score ${g.score}`} · <Counts c={g.counts} /></span>
              </div>
              {open.length > 0
                ? <ul className="divide-y divide-warm-200 border-t border-warm-200">{open.map(r => <RuleRow key={r.ruleId} r={r} />)}</ul>
                : <p className="text-body text-warm-600 border-t border-warm-200 pt-2">Nothing to fix here.</p>}
              {passing.length > 0 && (
                <Disclosure title={`${passing.length} passing`}>
                  <ul className="divide-y divide-warm-200">{passing.map(r => <RuleRow key={r.ruleId} r={r} />)}</ul>
                </Disclosure>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-4">
        {f.conflicts.length > 0 && (
          <Disclosure title="Threshold conflicts between sources" meta={f.conflicts.length}>
            <ul className="space-y-1.5 text-caption text-warm-700">
              {f.conflicts.map(c => (
                <li key={c.metricKey}>
                  <span className="font-semibold text-ink">{metricLabel(c.metricKey)}</span> — {c.sides.map(s => `${s.ruleId} ${s.threshold.display} (${SOURCE_LABEL[s.threshold.source]}): ${RESULT_UI[s.result].label.toLowerCase()}`).join('; ')}
                </li>
              ))}
            </ul>
            <p className="text-caption text-warm-700 mt-1.5">{f.conflicts[0].resolution}</p>
          </Disclosure>
        )}
        {!DISCLAIMER_OPEN.includes(f.framework) && (
          <Disclosure title="About this framework">
            <p className="text-caption text-warm-700 max-w-3xl">{f.disclaimer}</p>
          </Disclosure>
        )}
      </div>
    </section>
  )
}

function RuleRow({ r }: { r: RuleResult }) {
  const ui = RESULT_UI[r.result]
  return (
    <li>
      <details className="group">
        <summary className="cursor-pointer py-2 flex flex-wrap items-center gap-x-3 gap-y-1 list-none [&::-webkit-details-marker]:hidden">
          {/* Only what needs attention carries a colored mark; a pass is plain. */}
          {r.result === 'pass'
            ? <span className="w-[64px] flex-shrink-0 text-caption text-warm-600">Pass</span>
            : <span className={`w-[64px] flex-shrink-0 inline-flex items-center gap-1 text-caption font-semibold ${ui.cls}`}><ui.Icon size={13} aria-hidden />{r.result === 'not_assessable' ? 'N/A' : ui.label}{r.result === 'not_assessable' && <span className="sr-only"> (not assessable)</span>}</span>}
          <span className="text-body text-ink flex-1 min-w-[180px] group-open:font-semibold">{r.title}</span>
          <span className="text-caption text-warm-600 text-right">{r.metric}</span>
        </summary>
        <div className="pb-3 pl-[76px] space-y-1.5 text-caption text-warm-700">
          <p>{r.message}</p>
          {r.reason && <p><span className="font-semibold text-ink">{r.result === 'not_assessable' ? 'Why not assessable: ' : 'Detail: '}</span>{r.reason}</p>}
          {r.threshold && <p><span className="font-semibold text-ink">Threshold: </span>{r.threshold.display} ({SOURCE_LABEL[r.threshold.source]}){r.parameters.map(p => `; ${metricLabel(p.metricKey).toLowerCase()} ${p.display} (${SOURCE_LABEL[p.source]})`).join('')}</p>}
          {r.evidence.length > 0 && <p><span className="font-semibold text-ink">Evidence: </span><span className="font-mono text-caption">{r.evidence.slice(0, 25).join(', ')}</span>{r.evidenceTotal > 25 ? ` and ${r.evidenceTotal - 25} more` : ''}</p>}
          {r.recommendation && r.result !== 'pass' && <p><span className="font-semibold text-ink">Recommendation: </span>{r.recommendation}</p>}
          <p className="text-caption text-warm-600"><span className="font-mono">{r.ruleId}</span> · Source: {r.sourceReference} · {RULE_KIND_LABELS[r.kind]} · {FRAMEWORK_LABELS[r.framework]} · rule v{r.version} · {r.calculation}</p>
        </div>
      </details>
    </li>
  )
}
