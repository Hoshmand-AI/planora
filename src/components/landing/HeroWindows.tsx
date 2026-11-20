// The five windows of the first screen (src/components/landing/Hero.tsx): one small drawing of the product
// for each thing RunF9 does with a schedule. They are drawn in HTML, not screenshots.
//
// Analyze and Explain show RunF9's own results for its built-in sample data center, read from
// src/lib/marketing/sample-schedule.ts, sample-brief.ts and sample-report.ts (do not retype those figures).
// Build, Compare and Maintain need figures the sample cannot supply (an interview-built plan, an earlier
// update, a program of several projects), so they are marked "Illustration" and their numbers are examples
// that agree with each other. Every statement is listed in docs/marketing/CLAIMS-REGISTER.md.

import { ArrowRight, Check } from 'lucide-react'
import { fmtDate } from '@/lib/format'
import { SAMPLE_SCHEDULE as SCH } from '@/lib/marketing/sample-schedule'
import { SAMPLE_BRIEF as BRIEF } from '@/lib/marketing/sample-brief'
import { SAMPLE_REPORT_MD } from '@/lib/marketing/sample-report'

const SAMPLE = 'Sample data center'
const ILLUSTRATION = 'Illustration'

/** The frame every window shares: what RunF9 does there, the drawing, and the answer on the navy panel. */
function Frame({ name, tag, caption, children, answer }: { name: string; tag: string; caption: string; children: React.ReactNode; answer: React.ReactNode }) {
  return (
    <article className="h-full flex flex-col rounded-[20px] md:rounded-[24px] border border-warm-200 bg-white shadow-[0_40px_80px_-48px_rgba(29,33,37,0.55)] overflow-hidden text-left">
      <div className="px-5 pt-5 md:px-6 md:pt-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-small font-semibold text-accent-700">{name}</p>
          <p className="text-fine font-medium text-warm-700 rounded-full bg-warm-100 px-2.5 py-0.5 whitespace-nowrap">{tag}</p>
        </div>
        <h2 className="text-copy font-semibold text-ink tracking-[-0.01em] leading-snug mt-2.5 lg:min-h-[66px] xl:min-h-[44px]">{caption}</h2>
      </div>
      <div className="flex-1 px-5 md:px-6 pt-4 pb-5 md:pb-6">{children}</div>
      <div className="bg-navy-950 text-white px-5 md:px-6 py-5 min-h-[132px] flex flex-col justify-center">{answer}</div>
    </article>
  )
}

const label = 'text-fine font-semibold text-warm-600'
const figure = 'text-h2 font-semibold tracking-[-0.02em] leading-none tabular-nums'

// ── Build ────────────────────────────────────────────────────────────────────────────────────────

// An example plan: three activities of a 120,000 sf warehouse, each duration with its written basis in the
// wording the plan builder uses (src/lib/planning/generator.ts). Work days; the bars are drawn on a 40-day span.
const BUILD = [
  { name: 'Foundations and slab on grade', days: 18, start: 0, critical: true, basis: 'base 6 + 0.1/1,000 sf × 120' },
  { name: 'Underground utilities', days: 15, start: 0, critical: false, basis: 'base 9 + 0.05/1,000 sf × 120' },
  { name: 'Structural steel erection', days: 22, start: 18, critical: true, basis: 'base 10 + 0.1/1,000 sf × 120' },
]
const BUILD_SPAN = 40
const FORMATS = ['P6', 'MS Project', 'Excel', 'PDF', 'Word', 'PowerPoint']

function Build() {
  return (
    <Frame name="Build" tag={ILLUSTRATION} caption="Builds a schedule from a short interview, or reads the one you already have."
      answer={<>
        <p className="text-fine text-navy-200">Or upload the schedule you keep in</p>
        <ul className="mt-2.5 flex flex-wrap gap-1.5">
          {FORMATS.map(f => <li key={f} className="rounded-full border border-navy-800 bg-navy-900 px-2.5 py-1 text-fine font-medium text-white">{f}</li>)}
        </ul>
      </>}>
      <p className={label}>From the interview · 120,000 sf warehouse</p>
      <ul className="mt-1 divide-y divide-warm-200">
        {BUILD.map(a => (
          <li key={a.name} className="py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-small font-semibold text-ink truncate">{a.name}</span>
              <span className="text-small font-semibold text-ink tabular-nums whitespace-nowrap">{a.days} wd</span>
            </div>
            <div className="relative mt-1.5 h-1.5 rounded-full bg-warm-100" aria-hidden="true">
              <span className={`absolute inset-y-0 rounded-full ${a.critical ? 'bg-bar-critical' : 'bg-bar-todo'}`} style={{ left: `${(a.start / BUILD_SPAN) * 100}%`, width: `${(a.days / BUILD_SPAN) * 100}%` }} />
            </div>
            <p className="text-fine text-warm-600 mt-1.5 leading-snug">Basis: warehouse template, {a.basis}.</p>
          </li>
        ))}
      </ul>
    </Frame>
  )
}

// ── Analyze ──────────────────────────────────────────────────────────────────────────────────────

// The checks that fail on the sample, with the engine's own value for each, read from the report RunF9 wrote
// for it ("## 7. Issues to resolve": "- DCMA #7 Negative float (14): …").
const FAILED = [...SAMPLE_REPORT_MD.matchAll(/^- DCMA #(\d+) ([^(]+) \(([^)]+)\):/gm)].map(m => ({ n: Number(m[1]), name: m[2].trim(), value: m[3] }))
const failedNumbers = new Set(FAILED.map(f => f.n))

function Analyze() {
  return (
    <Frame name="Analyze" tag={SAMPLE} caption="Runs all 14 DCMA checks and forecasts the finish against the required date."
      answer={<>
        <p className={figure}>{SCH.finish}</p>
        <p className="text-fine text-navy-200 mt-1.5">Forecast finish</p>
        <p className="mt-2.5 self-start rounded-full bg-status-at-risk-bg text-status-at-risk text-fine font-semibold px-3 py-1">{SCH.daysLate} days after the required {SCH.required}</p>
      </>}>
      <div className="flex items-baseline justify-between gap-3">
        <p className={label}>DCMA 14-Point Assessment</p>
        <p className="text-small font-semibold text-ink whitespace-nowrap">{SCH.checksPassed} of {SCH.checksApplicable} pass</p>
      </div>
      <div role="img" className="mt-3 grid grid-cols-7 gap-1.5" aria-label={`Checks 1 to ${SCH.checksApplicable}: ${FAILED.map(f => f.n).join(', ')} fail, the others pass`}>
        {Array.from({ length: SCH.checksApplicable }, (_, i) => i + 1).map(n => (
          <span key={n} className={`grid place-items-center h-8 rounded-lg text-fine font-semibold tabular-nums ${failedNumbers.has(n) ? 'bg-status-at-risk text-white' : 'bg-status-on-track-bg text-status-on-track'}`}>
            {failedNumbers.has(n) ? n : <Check size={15} strokeWidth={2.5} aria-hidden />}
          </span>
        ))}
      </div>
      <ul className="mt-3.5 divide-y divide-warm-200 border-t border-warm-200">
        {FAILED.map(f => (
          <li key={f.n} className="flex items-baseline justify-between gap-3 py-2 text-small">
            <span className="text-warm-700 truncate"><span className="font-semibold text-status-at-risk tabular-nums">#{f.n}</span> {f.name}</span>
            <span className="font-semibold text-ink tabular-nums whitespace-nowrap">{f.value}</span>
          </li>
        ))}
      </ul>
    </Frame>
  )
}

// ── Compare ──────────────────────────────────────────────────────────────────────────────────────

// An example pair of updates. The "now" dates are the sample's; the "before" dates and the counts are examples
// (the sample project has one upload, so RunF9 has nothing earlier to compare it with).
const MOVED = [
  { code: 'P1030', name: 'Procure Medium-Voltage Switchgear', was: '2026-11-17', now: '2026-12-08' },
  { code: 'E4020', name: 'Set Medium-Voltage Switchgear', was: '2026-12-15', now: '2027-01-05' },
  { code: 'T8040', name: 'Substantial Completion', was: '2027-07-27', now: '2027-08-17' },
]
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
const EDITS: [string, string][] = [['2', 'activities added'], ['1', 'removed'], ['3', 'logic edits']]

function Compare() {
  const finish = MOVED[MOVED.length - 1]
  return (
    <Frame name="Compare" tag={ILLUSTRATION} caption="Pairs each update with the last one and lists what moved, and by how many days."
      answer={<>
        <p className={figure}>+{daysBetween(finish.was, finish.now)} days</p>
        <p className="text-fine text-navy-200 mt-1.5">The finish moved since the previous update</p>
        <p className="mt-2.5 flex items-center gap-2 text-small font-semibold tabular-nums">{fmtDate(finish.was)}<ArrowRight size={14} aria-hidden className="text-accent-400" /><span className="sr-only">to</span>{fmtDate(finish.now)}</p>
      </>}>
      <p className={label}>October update <span aria-hidden="true">→</span><span className="sr-only">to</span> November update</p>
      <ul className="mt-1 divide-y divide-warm-200">
        {MOVED.map(m => (
          <li key={m.code} className="py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-small text-ink truncate"><span className="font-semibold tabular-nums">{m.code}</span> {m.name}</span>
              <span className="rounded-full bg-status-at-risk-bg text-status-at-risk text-fine font-semibold px-2 py-0.5 whitespace-nowrap tabular-nums">+{daysBetween(m.was, m.now)} d</span>
            </div>
            <p className="text-fine text-warm-600 mt-1 tabular-nums">Finish {fmtDate(m.was)} <span aria-hidden="true">→</span><span className="sr-only">to</span> <span className="font-semibold text-ink">{fmtDate(m.now)}</span></p>
          </li>
        ))}
      </ul>
      <dl className="mt-1 grid grid-cols-3 gap-3 border-t border-warm-200 pt-3">
        {EDITS.map(([n, what]) => (
          <div key={what} className="flex flex-col-reverse">
            <dt className="text-fine text-warm-600 leading-snug">{what}</dt>
            <dd className="text-copy font-semibold text-ink tabular-nums">{n}</dd>
          </div>
        ))}
      </dl>
    </Frame>
  )
}

// ── Maintain ─────────────────────────────────────────────────────────────────────────────────────

// An example program, in the words of the master schedule (src/components/MasterSchedule.tsx): each date is
// read from the contractor's newest upload, and contractor data is "Current" until its data date is more than
// 45 days old, then "Stale" (STALE_AFTER_DAYS in src/lib/analysis/master-schedule.ts). Read on 11/13/2026.
const PROGRAM_READ = '2026-11-13'
const PROGRAM = [
  { name: 'Data Hall A', contractor: 'Contractor A', dataDate: '2026-11-06', date: '2027-08-17' },
  { name: 'Data Hall B', contractor: 'Contractor A', dataDate: '2026-10-30', date: '2027-11-09' },
  { name: 'Substation', contractor: 'Contractor B', dataDate: '2026-09-25', date: '2027-03-15' },
  { name: 'Office and security', contractor: 'Contractor C', dataDate: '2026-11-02', date: '2027-05-24' },
].map(p => { const age = daysBetween(p.dataDate, PROGRAM_READ); return { ...p, age, stale: age > 45 } })
const currentCount = PROGRAM.filter(p => !p.stale).length

function Maintain() {
  return (
    <Frame name="Maintain" tag={ILLUSTRATION} caption="Keeps a master schedule current from each contractor’s newest upload."
      answer={<>
        <p className={figure}>{currentCount} of {PROGRAM.length}</p>
        <p className="text-fine text-navy-200 mt-1.5">projects with current contractor data</p>
        <p className="text-small text-white mt-2.5">Master schedule, read {fmtDate(PROGRAM_READ)}.</p>
      </>}>
      <div className="flex items-baseline justify-between gap-3">
        <p className={label}>Project</p>
        <p className={label}>Substantial completion</p>
      </div>
      <ul className="mt-1 divide-y divide-warm-200">
        {PROGRAM.map(p => (
          <li key={p.name} className="py-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 items-baseline">
            <span className="text-small font-semibold text-ink truncate">{p.name}</span>
            <span className="text-small text-ink tabular-nums text-right">{fmtDate(p.date)}</span>
            <span className="text-fine text-warm-600 truncate">{p.contractor} · {p.age} days old</span>
            <span className={`justify-self-end rounded-lg px-2 py-0.5 text-fine font-semibold ${p.stale ? 'text-status-attention bg-status-attention-bg' : 'text-status-on-track bg-status-on-track-bg'}`}>{p.stale ? 'Stale' : 'Current'}</span>
          </li>
        ))}
      </ul>
    </Frame>
  )
}

// ── Explain ──────────────────────────────────────────────────────────────────────────────────────

// Sentences of the brief RunF9 computed for the sample, word for word.
const line = (list: readonly string[], start: string) => list.find(t => t.startsWith(start)) ?? ''
const DRIVING = line(BRIEF.audiences.pm, 'Driving the finish today')
const TODAY = [line(BRIEF.audiences.field, 'Starting today'), line(BRIEF.audiences.field, 'Must finish today')].filter(Boolean)

function Explain() {
  return (
    <Frame name="Explain" tag={SAMPLE} caption="Writes a Daily Brief in plain English: the finish, what drives it, what to do today."
      answer={<>
        <p className="text-fine font-semibold text-accent-400">What to do today</p>
        <ul className="mt-2 space-y-1.5">
          {TODAY.map(t => <li key={t} className="text-small text-white leading-snug">{t}</li>)}
        </ul>
      </>}>
      <p className={label}>Daily Brief · <span className="tabular-nums">{BRIEF.asOf}</span></p>
      <p className="text-small text-warm-600 mt-3">Are we meeting the deadline?</p>
      <p className="text-h3 font-semibold tracking-[-0.01em] text-status-at-risk leading-tight mt-0.5">No. {BRIEF.headline.daysBehind} days behind.</p>
      <dl className="mt-3.5 grid grid-cols-2 gap-3 border-y border-warm-200 py-2.5">
        {[[SCH.finish, 'Forecast finish'], [SCH.required, 'Required']].map(([v, k]) => (
          <div key={k} className="flex flex-col-reverse">
            <dt className="text-fine text-warm-600">{k}</dt>
            <dd className="text-small font-semibold text-ink tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <p className={`${label} mt-3.5`}>What is driving it</p>
      <p className="text-small text-warm-700 leading-snug mt-1">{DRIVING}</p>
    </Frame>
  )
}

export const WINDOWS = [
  { id: 'build', verb: 'built', name: 'Build', Window: Build },
  { id: 'analyze', verb: 'analyzed', name: 'Analyze', Window: Analyze },
  { id: 'compare', verb: 'compared', name: 'Compare', Window: Compare },
  { id: 'maintain', verb: 'maintained', name: 'Maintain', Window: Maintain },
  { id: 'explain', verb: 'explained', name: 'Explain', Window: Explain },
] as const
