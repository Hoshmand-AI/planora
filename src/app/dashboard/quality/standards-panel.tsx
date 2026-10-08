'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleSlash, Loader2, Scale, XCircle } from 'lucide-react'
import { fmtDateTime } from '@/lib/format'
import {
  FRAMEWORK_LABELS, RULE_KIND_LABELS,
  type Framework, type FrameworkResult, type RuleResult, type RuleResultStatus, type StandardsRunOutput,
} from '@/lib/standards/types'
import type { StoredRun, StoredRunSummary } from '@/lib/standards/store'

type Choice = 'PLANORA_COMPOSITE' | 'GAO_SCHEDULE_GUIDE' | 'DCMA_14' | 'multiple'
const CHOICES: { value: Choice; label: string; hint: string }[] = [
  { value: 'PLANORA_COMPOSITE', label: 'Planora Composite (recommended)', hint: 'GAO screening checks and DCMA 14-point side by side, with any threshold conflicts listed.' },
  { value: 'GAO_SCHEDULE_GUIDE', label: 'GAO Schedule Assessment Guide', hint: 'The ten best practices, grouped under the four characteristics.' },
  { value: 'DCMA_14', label: 'DCMA 14-point', hint: 'The 14 DCMA assessment metrics.' },
  { value: 'multiple', label: 'Several frameworks', hint: 'Choose two or more to run separately.' },
]
const SINGLE: Framework[] = ['PLANORA_COMPOSITE', 'GAO_SCHEDULE_GUIDE', 'DCMA_14']

const RESULT_UI: Record<RuleResultStatus, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  pass: { label: 'Pass', cls: 'text-status-on-track', Icon: CheckCircle2 },
  warning: { label: 'Warning', cls: 'text-status-attention', Icon: AlertTriangle },
  fail: { label: 'Fail', cls: 'text-status-at-risk', Icon: XCircle },
  not_assessable: { label: 'Not assessable', cls: 'text-warm-600', Icon: CircleSlash },
}
const SOURCE_LABEL = { published: 'published value', planora_default: 'Planora screening default', org_configured: 'set by your organization' } as const

/** Standards view: pick framework(s), see results by characteristic with evidence and sources, record a run. */
export function StandardsPanel({ endpoint, canRecord }: { endpoint: string; canRecord: boolean }) {
  const [choice, setChoice] = useState<Choice | null>(null)
  const [multi, setMulti] = useState<Framework[]>(['GAO_SCHEDULE_GUIDE', 'DCMA_14'])
  const [result, setResult] = useState<StandardsRunOutput | null>(null)
  const [runs, setRuns] = useState<StoredRunSummary[]>([])
  const [viewing, setViewing] = useState<StoredRun | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const fromDefaults = useRef(false)

  const frameworks: Framework[] | null = choice === null ? null : choice === 'multiple' ? multi : [choice]

  const load = useCallback(async (fws: Framework[] | null) => {
    setLoading(true); setError('')
    const q = fws ? `?frameworks=${encodeURIComponent(fws.join(','))}` : ''
    const res = await fetch(`${endpoint}${q}`)
    const d = await res.json().catch(() => ({}))
    setLoading(false)
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
    if (!frameworks?.length) return
    setStatus(''); setError('')
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ frameworks }) })
    const d = await res.json().catch(() => ({}))
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
      <section aria-labelledby="fw-picker-h" className="bg-warm-100 border border-warm-200 rounded-lg p-5">
        <h2 id="fw-picker-h" className="text-[11px] font-semibold uppercase tracking-wider text-warm-500 mb-3">Framework</h2>
        <fieldset>
          <legend className="sr-only">Framework to run</legend>
          <div className="grid sm:grid-cols-2 gap-2">
            {CHOICES.map(c => (
              <label key={c.value} className={`flex items-start gap-2.5 rounded-md border px-3 py-2 cursor-pointer ${choice === c.value ? 'border-navy-900 bg-warm-50' : 'border-warm-300 bg-warm-50'}`}>
                <input type="radio" name="framework" value={c.value} checked={choice === c.value} onChange={() => setChoice(c.value)} className="mt-1 accent-accent-500" />
                <span><span className="block text-[13.5px] font-medium text-navy-950">{c.label}</span><span className="block text-[12px] text-warm-600">{c.hint}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        {choice === 'multiple' && (
          <fieldset className="mt-3">
            <legend className="text-[12.5px] font-medium text-navy-950 mb-1">Frameworks to run</legend>
            <div className="flex flex-wrap gap-4">
              {SINGLE.map(fw => (
                <label key={fw} className="flex items-center gap-2 text-[13px] text-navy-950 cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 accent-accent-500" checked={multi.includes(fw)}
                    onChange={e => setMulti(m => e.target.checked ? [...m.filter(x => x !== fw), fw] : m.filter(x => x !== fw))} />
                  {FRAMEWORK_LABELS[fw]}
                </label>
              ))}
            </div>
            {multi.length === 0 && <p className="text-[12px] text-status-at-risk mt-1" role="alert">Choose at least one framework.</p>}
          </fieldset>
        )}
        <div className="flex flex-wrap items-center gap-3 mt-4">
          {canRecord && <button type="button" onClick={record} disabled={loading || !frameworks?.length} className="px-3 py-1.5 rounded-md bg-navy-900 text-white text-[12.5px] font-medium disabled:opacity-60">Record this assessment</button>}
          <span className="text-[12px] text-warm-600">Recording keeps the results, rules version and thresholds so this assessment can be reproduced later.</span>
        </div>
        <div aria-live="polite" className="text-[12.5px] mt-2">
          {status && <span className="text-status-on-track">{status}</span>}
          {error && <span role="alert" className="text-status-at-risk">{error}</span>}
        </div>
      </section>

      {viewing && (
        <div role="status" className="bg-status-info-bg border-l-2 border-status-info rounded-md px-4 py-3 text-[13px] text-warm-700 flex flex-wrap items-center gap-2">
          <span>Showing the assessment recorded {fmtDateTime(viewing.createdAt)}{viewing.createdByName ? ` by ${viewing.createdByName}` : ''} (rules version {viewing.rulesVersion}).</span>
          <button type="button" onClick={() => setViewing(null)} className="underline text-navy-950">Back to the current results</button>
        </div>
      )}

      {loading && !shown && <div className="text-[14px] text-warm-600 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Running rules…</div>}
      {shown && (
        <>
          <p role="note" className="text-[12.5px] text-warm-700 bg-warm-100 border border-warm-200 rounded-md px-4 py-3">
            <Scale size={14} className="inline mr-1.5 -mt-0.5 text-warm-600" aria-hidden />{shown.disclaimer}
          </p>
          {shown.frameworks.map(f => <FrameworkView key={f.framework} f={f} />)}
          <p className="text-[11.5px] text-warm-600">Engine {shown.engineVersion} · rules version {shown.rulesVersion}</p>
        </>
      )}

      <section aria-labelledby="runs-h" className="bg-warm-100 border border-warm-200 rounded-lg p-5">
        <h2 id="runs-h" className="text-[11px] font-semibold uppercase tracking-wider text-warm-500 mb-2">Recorded assessments</h2>
        {runs.length === 0 ? <p className="text-[12.5px] text-warm-600">None recorded yet.</p> : (
          <ul className="divide-y divide-warm-200">
            {runs.map(r => (
              <li key={r.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
                <span className="text-navy-950 font-medium">{fmtDateTime(r.createdAt)}</span>
                <span className="text-warm-600">{r.frameworks.map(f => FRAMEWORK_LABELS[f] ?? f).join(', ')}</span>
                <span className="text-warm-600">{r.createdByName ?? ''}</span>
                <span className="text-warm-600 font-mono">rules {r.rulesVersion}</span>
                <button type="button" onClick={() => view(r.id)} className="ml-auto underline text-navy-950">View</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Counts({ c }: { c: Record<RuleResultStatus, number> }) {
  return (
    <span className="text-[12px] text-warm-600">
      {c.pass} pass · {c.warning} warning · {c.fail} fail · {c.not_assessable} not assessable
    </span>
  )
}

function FrameworkView({ f }: { f: FrameworkResult }) {
  return (
    <section aria-label={f.label} className="bg-warm-100 border border-warm-200 rounded-lg p-5 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-display text-[19px] text-navy-950 leading-tight">{f.label}</h2>
          <p className="text-[12px] text-warm-600">{f.frameworkVersion}</p>
        </div>
        <div className="text-right">
          <div className="text-[20px] font-semibold text-navy-950 tabular-nums">{f.score === null ? '—' : `${f.score}`}<span className="text-[12px] font-normal text-warm-600"> / 100 screening score</span></div>
          <Counts c={f.counts} />
        </div>
      </div>
      <p className="text-[12px] text-warm-700">{f.disclaimer}</p>
      {f.conflicts.length > 0 && (
        <div className="bg-status-attention-bg border-l-2 border-status-attention rounded-md px-4 py-3">
          <h3 className="text-[13px] font-semibold text-navy-950 mb-1">Threshold conflicts between sources ({f.conflicts.length})</h3>
          <ul className="space-y-1.5 text-[12.5px] text-warm-700">
            {f.conflicts.map(c => (
              <li key={c.metricKey}>
                <span className="font-mono text-[11.5px] text-warm-600">{c.metricKey}</span> — {c.sides.map(s => `${s.ruleId} ${s.threshold.display} (${SOURCE_LABEL[s.threshold.source]}): ${RESULT_UI[s.result].label.toLowerCase()}`).join('; ')}
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-warm-700 mt-1.5">{f.conflicts[0].resolution}</p>
        </div>
      )}
      {f.groups.map(g => (
        <div key={g.key}>
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-warm-300 pb-1 mb-2">
            <h3 className="text-[14px] font-semibold text-navy-950">{g.label}</h3>
            <span className="text-[12px] text-warm-600">{g.score === null ? 'not assessable' : `score ${g.score}`} · <Counts c={g.counts} /></span>
          </div>
          <ul className="space-y-2">{g.rules.map(r => <RuleRow key={r.ruleId} r={r} />)}</ul>
        </div>
      ))}
    </section>
  )
}

function RuleRow({ r }: { r: RuleResult }) {
  const ui = RESULT_UI[r.result]
  return (
    <li>
      <details className="bg-warm-50 border border-warm-200 rounded-md">
        <summary className="cursor-pointer px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase ${ui.cls}`}><ui.Icon size={13} aria-hidden />{ui.label}</span>
          <span className="font-mono text-[11.5px] text-warm-600">{r.ruleId}</span>
          <span className="text-[13px] text-navy-950 flex-1 min-w-[180px]">{r.title}</span>
          <span className="text-[12px] text-warm-600">{r.metric}</span>
        </summary>
        <div className="px-3 pb-3 pt-1 space-y-1.5 text-[12.5px] text-warm-700">
          <p>{r.message}</p>
          {r.reason && <p><span className="font-semibold text-navy-950">{r.result === 'not_assessable' ? 'Why not assessable: ' : 'Detail: '}</span>{r.reason}</p>}
          {r.threshold && <p><span className="font-semibold text-navy-950">Threshold: </span>{r.threshold.display} ({SOURCE_LABEL[r.threshold.source]}){r.parameters.map(p => `; ${p.metricKey.split('.').pop()?.replace(/_/g, ' ')} ${p.display} (${SOURCE_LABEL[p.source]})`).join('')}</p>}
          {r.evidence.length > 0 && <p><span className="font-semibold text-navy-950">Evidence: </span><span className="font-mono text-[11.5px]">{r.evidence.slice(0, 25).join(', ')}</span>{r.evidenceTotal > 25 ? ` and ${r.evidenceTotal - 25} more` : ''}</p>}
          {r.recommendation && r.result !== 'pass' && <p><span className="font-semibold text-navy-950">Recommendation: </span>{r.recommendation}</p>}
          <p className="text-[11.5px] text-warm-600">Source: {r.sourceReference} · {RULE_KIND_LABELS[r.kind]} · {FRAMEWORK_LABELS[r.framework]} · rule v{r.version} · {r.calculation}</p>
        </div>
      </details>
    </li>
  )
}
