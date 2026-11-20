'use client'

// The landing page below the first screen: the figures, the Daily Brief shown as product, who RunF9 is for,
// reports, what it connects to, security, pricing, the questions buyers ask, and the foot of the page.
// Every claim here is listed with its evidence in docs/marketing/CLAIMS-REGISTER.md. The product pictures are
// drawn in HTML from sample data, or are screenshots of the built-in sample projects, and say so.
//
// One rhythm for the whole page (redesigned 11/20/2026): every section has the same vertical padding (PAD) and
// the same head (a small label, the headline, the paragraph beside it); lists are divided by hairlines instead
// of being boxed; and the layout changes from one section to the next so the page does not read as a stack of
// centred blocks.

import Link from 'next/link'
import { useRef, useState } from 'react'
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Mail, GitPullRequestArrow, ScrollText, SearchCheck, KeyRound, Users, Building2, EyeOff, Database } from 'lucide-react'
import { CountUp, Reveal } from './motion'
import { SAMPLE_BRIEF } from '@/lib/marketing/sample-brief'
import { SAMPLE_SCHEDULE } from '@/lib/marketing/sample-schedule'
import { Logo } from '@/components/Logo'

export const WRAP = 'max-w-[1240px] mx-auto px-6'
export const PAD = 'py-20 md:py-28'
/** A section reached from the navigation stops just under the sticky bar. */
export const ANCHOR = 'scroll-mt-[76px] md:scroll-mt-[84px]'
export const H2 = 'text-h2 md:text-h1 font-bold tracking-[-0.02em] md:tracking-[-0.03em] leading-[1.1]'
export const primaryBtn = 'pressable inline-flex items-center justify-center rounded-full bg-accent-600 text-white font-semibold hover:bg-accent-700 transition-colors'
const textLink = 'pressable inline-flex items-center gap-1.5 text-small font-semibold text-accent-700 underline-offset-4 hover:underline'

/** A call to action: a mailto link (request access) or an in-app link. */
export function Cta({ href, className, children }: { href: string; className: string; children: React.ReactNode }) {
  return href.startsWith('mailto:') ? <a href={href} className={className}>{children}</a> : <Link href={href} className={className}>{children}</Link>
}

/** The small label over a section's headline. */
export function Eyebrow({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <p className={`flex items-center gap-3 text-small font-semibold ${dark ? 'text-accent-400' : 'text-accent-700'}`}>
      <span aria-hidden className={`h-px w-8 ${dark ? 'bg-accent-400' : 'bg-accent-600'}`} />{children}
    </p>
  )
}

/** A section's head: label and headline on the left, the paragraph on the right (stacked on a phone). */
export function SectionHead({ id, eyebrow, title, lead, dark = false, stacked = false, className = '' }: { id?: string; eyebrow: string; title: string; lead?: React.ReactNode; dark?: boolean; stacked?: boolean; className?: string }) {
  return (
    <Reveal className={`${stacked ? '' : 'grid lg:grid-cols-2 gap-x-16 items-end'} ${className}`}>
      <div>
        <Eyebrow dark={dark}>{eyebrow}</Eyebrow>
        <h2 id={id} className={`${H2} ${dark ? 'text-white' : 'text-ink'} mt-4 max-w-[640px]`}>{title}</h2>
      </div>
      {lead && <p className={`text-lead leading-relaxed mt-5 max-w-[560px] ${stacked ? '' : 'lg:mt-0 lg:justify-self-end'} ${dark ? 'text-navy-200' : 'text-warm-700'}`}>{lead}</p>}
    </Reveal>
  )
}

/** Accessible tabs: arrow keys, Home and End move between them (WAI-ARIA tabs pattern). */
function useTabs(count: number) {
  const [active, setActive] = useState(0)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const select = (i: number) => { const n = (i + count) % count; setActive(n); refs.current[n]?.focus() }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); select(active + 1) }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); select(active - 1) }
    else if (e.key === 'Home') { e.preventDefault(); select(0) }
    else if (e.key === 'End') { e.preventDefault(); select(count - 1) }
  }
  return { active, setActive, refs, onKeyDown }
}

function TabList({ label, items, prefix, panel, tabs, className = '' }: { label: string; items: { id: string; tab: string }[]; prefix: string; panel: string; tabs: ReturnType<typeof useTabs>; className?: string }) {
  return (
    <div role="tablist" aria-label={label} onKeyDown={tabs.onKeyDown} className={`flex gap-1 overflow-x-auto p-1 rounded-full bg-warm-100 border border-warm-200 w-fit max-w-full ${className}`}>
      {items.map((x, i) => (
        <button
          key={x.id} ref={el => { tabs.refs.current[i] = el }} type="button" role="tab" id={`${prefix}-tab-${x.id}`}
          aria-selected={i === tabs.active} aria-controls={panel} tabIndex={i === tabs.active ? 0 : -1}
          onClick={() => tabs.setActive(i)}
          className={`whitespace-nowrap rounded-full px-4 py-2 text-small font-medium transition-colors ${i === tabs.active ? 'bg-white text-ink shadow-sm' : 'text-warm-600 hover:text-ink'}`}
        >{x.tab}</button>
      ))}
    </div>
  )
}

// ── A real screenshot in a window frame ─────────────────────────────────────────────────────────

/** A screenshot of the product (public/landing/*.webp, 1600 wide, taken from the built-in sample projects). */
export function Shot({ name, alt, label, eager = false, height = 1200, className = '' }: { name: string; alt: string; label: string; eager?: boolean; height?: number; className?: string }) {
  return (
    <figure className={`rounded-[18px] md:rounded-[22px] border border-warm-200 bg-white shadow-[0_40px_80px_-40px_rgba(29,33,37,0.45)] overflow-hidden ${className}`}>
      <div className="flex items-center gap-2 px-4 h-9 md:h-10 bg-navy-900" aria-hidden="true">
        <span className="w-2.5 h-2.5 rounded-full bg-navy-700" /><span className="w-2.5 h-2.5 rounded-full bg-navy-700" /><span className="w-2.5 h-2.5 rounded-full bg-navy-700" />
        <span className="ml-3 text-caption text-navy-200 truncate">{label}</span>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {/* On a phone the picture is shown larger and cropped to its top-left, so its text stays readable */}
      <div className="aspect-[4/3] overflow-hidden sm:aspect-auto">
        <img src={`/landing/${name}.webp`} alt={alt} width={1600} height={height} loading={eager ? 'eager' : 'lazy'} decoding="async" className="block w-[175%] max-w-none sm:w-full h-auto" />
      </div>
    </figure>
  )
}

// ── RunF9 in numbers ─────────────────────────────────────────────────────────────────────────────

/**
 * Four figures, each backed by an automated test or the product's own limits. How each one can be checked is
 * folded under them; a link to #evidence from anywhere on the page opens it (Landing.tsx owns that state).
 */
export function Figures({ inviteOnly, evidenceOpen, onToggleEvidence }: { inviteOnly: boolean; evidenceOpen: boolean; onToggleEvidence: () => void }) {
  const figures: { value: React.ReactNode; unit?: string; label: string }[] = [
    { value: '4', unit: 'check sets', label: 'all 14 DCMA 14-Point checks on every schedule, and checks drawn from the GAO guide, USACE UFGS 01 32 01.00 10 and the PMI scheduling standard in the Standards view' },
    { value: <CountUp value={100000} />, label: 'activities scheduled by our CPM engine in automated tests' },
    { value: '0', unit: 'days', label: 'of drift after a P6 or MS Project round trip, in our test set' },
    inviteOnly ? { value: '2,300+', label: 'automated tests run on every change to RunF9' } : { value: '$0', label: 'to start. No credit card' },
  ]
  const evidence: [string, string][] = [
    ['DCMA, GAO, USACE and PMI checks', 'Every schedule is run through all fourteen metrics of the DCMA 14-Point Assessment when it is uploaded, and the Standards view adds checks drawn from the ten best practices of the GAO Schedule Assessment Guide (GAO-16-89G). It can also run, each on its own, a set of checks drawn from the U.S. Army Corps of Engineers guide specification UFGS 01 32 01.00 10 (Project Schedule) and a set drawn from section 3.4 of the PMI Practice Standard for Scheduling; these cover part of each document, not all of it. Each finding names its source and the limit it was measured against, and each check has a unit test that makes it pass and fail. A check that needs data the file does not have (a baseline, for example) is reported as not applicable, never as passed. Time impact analysis follows AACE International Recommended Practice 52R-06, and the earned value checks are oriented to ANSI/EIA-748. Results are indicators for a scheduler’s review, not a determination of contract compliance. RunF9 is not affiliated with or endorsed by DCMA, GAO, the U.S. Army Corps of Engineers, PMI, AACE International or any other body named here.'],
    ['100,000 activities', 'An automated performance test schedules synthetic networks of 10,000, 50,000 and 100,000 activities, with mixed relationship types, lags and two calendars, on every code change. It measures the CPM calculation, not file upload.'],
    ['0 days after a round trip', 'Five test schedules (different calendars, delivery methods and a required finish) are exported to P6 XER and MS Project XML, imported back and re-scheduled from scratch. Every activity’s early start, early finish and total float must match exactly. This proves RunF9’s files keep the logic intact; a side-by-side comparison with P6 and MS Project calculating the same reference projects is planned and will be published here.'],
    inviteOnly
      ? ['2,300+ automated tests', 'RunF9 has more than 2,300 automated tests, covering the scheduling engine, the checks, the file formats, security and tenant separation. They all run on every code change, together with end-to-end suites against a live server, and a change that fails any of them is not released.']
      : ['$0 to start', 'Signing up is open on this deployment and asks for no payment details. A new organization starts free, with no time limit: up to 3 uploaded schedules, unlimited interview-built schedules, the Executive Summary report, 10 AI requests a day and export to P6, MS Project and CSV. The other reports, PDF and Excel export, Monte Carlo risk analysis, API keys and single sign-on come with a license. The server enforces these limits.'],
  ]
  return (
    <section aria-label="RunF9 in numbers" className="bg-white border-t border-warm-200">
      <div className={`${WRAP} pt-20 md:pt-28`}>
        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 md:gap-x-10 gap-y-12">
          {figures.map(({ value, unit, label }, i) => (
            <Reveal key={label} delay={i * 90} className="flex flex-col-reverse justify-end border-t-2 border-ink pt-5 md:pt-6">
              <dt className="text-small text-warm-700 leading-relaxed mt-3 max-w-[260px]">{label}</dt>
              <dd className="flex flex-wrap items-baseline gap-x-2.5 text-ink">
                <span className="text-h1 md:text-display lg:text-h1 xl:text-display font-bold tracking-[-0.04em] leading-none tabular-nums">{value}</span>
                {unit && <span className="text-h3 font-semibold tracking-[-0.01em]">{unit}</span>}
              </dd>
            </Reveal>
          ))}
        </dl>

        {/* How each figure can be checked: folded under the figures it explains. */}
        <div id="evidence" className="mt-12 md:mt-16 border-t border-warm-200 scroll-mt-24">
          <button type="button" aria-expanded={evidenceOpen} aria-controls="evidence-panel" onClick={onToggleEvidence}
            className="pressable w-full flex items-center justify-between gap-4 py-5 text-left text-copy font-semibold text-ink hover:text-accent-700">
            Where these numbers come from
            <ChevronDown size={20} aria-hidden className={`flex-shrink-0 text-warm-600 transition-transform duration-300 ${evidenceOpen ? 'rotate-180' : ''}`} />
          </button>
          <div id="evidence-panel" hidden={!evidenceOpen} className={`pb-6 lg:grid-cols-[2fr_3fr] gap-x-16 gap-y-6 ${evidenceOpen ? 'grid' : 'hidden'}`}>
            <p className="text-lead text-warm-700 leading-relaxed max-w-[420px]">Every figure on this page is reproducible. Customers and auditors can ask us to run the tests below in front of them.</p>
            <div className="border-t border-warm-200">
              {evidence.map(([term, def], i) => (
                <details key={term} open={i === 0} className="group border-b border-warm-200">
                  <summary className="flex items-center justify-between gap-4 py-4 cursor-pointer list-none text-copy font-semibold text-ink">
                    {term}
                    <ChevronDown size={20} className="text-warm-600 transition-transform duration-300 group-open:rotate-180 flex-shrink-0" aria-hidden />
                  </summary>
                  <p className="text-copy text-warm-700 leading-relaxed pb-5 -mt-1">{def}</p>
                </details>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ── Check it yourself ────────────────────────────────────────────────────────────────────────────

/**
 * Proof a visitor can check without taking our word for it: a real report, and who built it. The headline on
 * the left, the two things to open on the right, divided by hairlines. How each figure is tested is folded under
 * the figures just above, so it is not said again here.
 */
export function Proof() {
  const items: { title: string; text: string; href: string; cta: string }[] = [
    { title: 'Read a real report', text: 'The Executive Schedule Summary RunF9 wrote for its sample data center, shown exactly as generated, with the file hash and settings it used.', href: '/sample-report', cta: 'Open the sample report' },
    { title: 'Built by a scheduler', text: 'RunF9 is built by Hoshmand AI, founded by a construction scheduling consultant with 13 years in the field. You talk to the person who built it.', href: 'mailto:support@hoshmand.ai', cta: 'Write to the founder' },
  ]
  return (
    <section aria-labelledby="proof-h" className="bg-white border-b border-warm-200">
      <div className={`${WRAP} ${PAD} grid lg:grid-cols-[2fr_3fr] gap-x-16 gap-y-10`}>
        <Reveal>
          <Eyebrow>Evidence</Eyebrow>
          <h2 id="proof-h" className={`${H2} text-ink mt-4 max-w-[460px]`}>Don’t take our word for it. Check the work.</h2>
        </Reveal>
        <div className="border-t border-warm-200">
          {items.map(({ title, text, href, cta }, i) => (
            <Reveal key={title} delay={i * 90} className="grid sm:grid-cols-[200px_1fr] gap-x-8 gap-y-2 border-b border-warm-200 py-7">
              <h3 className="text-h3 font-semibold text-ink tracking-[-0.01em]">{title}</h3>
              <div>
                <p className="text-copy text-warm-700 leading-relaxed">{text}</p>
                <Cta href={href} className={`${textLink} mt-3`}>{cta}<ArrowRight size={16} aria-hidden /></Cta>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── The Daily Brief ──────────────────────────────────────────────────────────────────────────────

type BriefTab = { id: string; tab: string }
const BRIEF_TABS: BriefTab[] = [
  { id: 'pm', tab: 'Project manager' },
  { id: 'field', tab: 'Field' },
  { id: 'client', tab: 'Client' },
  { id: 'signals', tab: 'Email and meetings' },
  { id: 'whatif', tab: 'What-ifs' },
]
const SIGNAL_TONE: Record<string, string> = { delay: 'bg-status-at-risk-bg text-status-at-risk', change: 'bg-accent-100 text-accent-700', risk: 'bg-warm-100 text-warm-700' }

/** The brief RunF9 computed for its sample project, as text a visitor can read and switch between readers. */
function LiveBrief() {
  const tabs = useTabs(BRIEF_TABS.length)
  const id = BRIEF_TABS[tabs.active].id
  const b = SAMPLE_BRIEF
  // The headline above already carries the first line of the project manager's version, so it is not shown twice.
  const all = id === 'pm' ? b.audiences.pm : id === 'field' ? b.audiences.field : id === 'client' ? b.audiences.client : null
  const lines = all ? all.filter(t => t !== b.headline.text) : null
  return (
    <div className="rounded-[20px] md:rounded-[24px] bg-white shadow-[0_50px_100px_-40px_rgba(0,0,0,0.6)] overflow-hidden">
      <div className="flex items-center justify-between gap-4 px-5 md:px-8 h-14 md:h-16 bg-navy-900">
        <Logo variant="light" size="h-[22px] md:h-[26px]" />
        <p className="text-fine md:text-small text-navy-200 text-right leading-tight"><span className="font-semibold text-white">Daily Brief</span> <span className="tabular-nums whitespace-nowrap">{b.asOf}</span></p>
      </div>
      <div className="p-5 md:p-8">
        <p className="text-small text-warm-600">{b.project}</p>
        <p className="mt-4 text-small font-semibold text-warm-600">Are we meeting the deadline?</p>
        <p className="text-h3 md:text-h2 font-semibold tracking-[-0.01em] md:tracking-[-0.02em] text-status-at-risk leading-tight mt-1">No. {b.headline.daysBehind} days behind.</p>
        <p className="text-small text-warm-700 leading-relaxed mt-2 max-w-[560px]">{b.headline.text}</p>
        {/* The four figures a reader looks for first, value over caption */}
        <dl className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4 border-y border-warm-200 py-4">
          {[[SAMPLE_SCHEDULE.finish, 'Forecast finish'], [SAMPLE_SCHEDULE.required, 'Required'], [`${SAMPLE_SCHEDULE.percentComplete}%`, 'Complete, by duration'], [`${b.alerts.filter(a => a.level === 'act').length} of ${b.alerts.length}`, 'Alerts to act on today']].map(([v, k]) => (
            <div key={k} className="flex flex-col-reverse">
              <dt className="text-fine text-warm-600 mt-0.5">{k}</dt>
              <dd className="text-copy font-semibold text-ink tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>

        <TabList label="Who the brief is for, and what it read" items={BRIEF_TABS} prefix="brief" panel="brief-panel" tabs={tabs} className="mt-6" />
        <div id="brief-panel" role="tabpanel" aria-labelledby={`brief-tab-${id}`} className="mt-4 min-h-[300px]">
          <div key={id} className="rise-in">
            {lines && (
              <ul className="divide-y divide-warm-200">
                {lines.map(t => <li key={t} className="py-3 text-small text-warm-700 leading-relaxed">{t}</li>)}
              </ul>
            )}
            {id === 'signals' && (
              <ul className="divide-y divide-warm-200">
                {b.signals.map(g => (
                  <li key={g.quote} className="py-3.5">
                    <span className={`inline-block text-caption font-semibold capitalize rounded-full px-2.5 py-0.5 ${SIGNAL_TONE[g.kind] || SIGNAL_TONE.risk}`}>{g.kind}</span>
                    <p className="text-small text-ink leading-relaxed mt-2">&ldquo;{g.quote}&rdquo;</p>
                    <p className="text-fine text-warm-600 mt-1.5">{g.source}{g.activity ? ` · about ${g.activity}` : ''}{g.days ? ` · ${g.days} work days` : ''}</p>
                  </li>
                ))}
              </ul>
            )}
            {id === 'whatif' && (
              <ul className="divide-y divide-warm-200">
                {b.whatIfs.map(w => (
                  <li key={w.title} className="py-3.5">
                    <p className="text-small font-semibold text-ink leading-snug">{w.title}</p>
                    <p className="text-small text-warm-700 leading-relaxed mt-1">{w.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const BRIEF_POINTS = [
  { icon: ScrollText, title: 'Calculated, not generated', text: 'Computed from the schedule, the project register and your documents. No AI model writes it, so the same inputs always give the same brief.' },
  { icon: Mail, title: 'Reads what your project writes', text: 'Emails, meeting minutes and transcripts, drawings, daily reports and site notes are read for delays, changes and risks. Each is quoted with its source and the activity it names.' },
  { icon: GitPullRequestArrow, title: 'A what-if for every open change', text: 'Risks, issues, PCOs and change orders live in one register. Each open change is run against the schedule for its effect on the finish.' },
  { icon: SearchCheck, title: 'Contract and scope watch', text: 'Notice periods and liquidated damages in your contract are tracked against the dates, and scope no activity covers is listed.' },
]

export function DailyBrief() {
  return (
    <section id="today" aria-labelledby="today-h" className={`bg-navy-950 ${ANCHOR}`}>
      <div className={`${WRAP} ${PAD}`}>
        <SectionHead dark id="today-h" eyebrow="The Daily Brief" title="Every morning, what changed and what to do about it."
          lead="RunF9 recalculates the schedule, reads what came in overnight and writes one brief for the project manager, one for the field and one for the client." />

        <div className="mt-14 md:mt-20 grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-x-14 gap-y-12 items-start">
          <Reveal>
            <LiveBrief />
            <p className="text-small text-navy-200 mt-5 max-w-[640px] leading-relaxed">This is the brief RunF9 computed for its sample data center project on {SAMPLE_BRIEF.asOf}, word for word. No AI model wrote it. Switch the reader to see what each one is told.</p>
          </Reveal>
          <Reveal delay={120}>
            <h3 className="text-h3 font-semibold text-white tracking-[-0.01em]">Needs attention today</h3>
            <ul className="mt-5 border-t border-navy-800">
              {SAMPLE_BRIEF.alerts.slice(0, 5).map(a => (
                <li key={a.text} className="flex gap-4 border-b border-navy-800 py-4">
                  <span className={`self-start flex-shrink-0 w-[58px] text-center text-caption font-semibold rounded-full py-0.5 ${a.level === 'act' ? 'bg-status-at-risk-bg text-status-at-risk' : 'bg-accent-100 text-accent-700'}`}>{a.level === 'act' ? 'Act' : 'Watch'}</span>
                  <span className="text-small text-navy-200 leading-relaxed">{a.text}</span>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>

        <ul className="mt-20 md:mt-28 grid sm:grid-cols-2 lg:grid-cols-4 gap-x-10 gap-y-12">
          {BRIEF_POINTS.map(({ icon: Icon, title, text }, i) => (
            <Reveal as="li" key={title} delay={i * 80} className="border-t border-navy-800 pt-6">
              <Icon size={22} strokeWidth={1.6} className="text-accent-400" aria-hidden />
              <h3 className="text-h3 font-semibold text-white mt-5 tracking-[-0.01em]">{title}</h3>
              <p className="text-copy text-navy-200 leading-relaxed mt-2.5">{text}</p>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  )
}

// ── Who it is for ────────────────────────────────────────────────────────────────────────────────

const AUDIENCES = [
  { id: 'gc', tab: 'General contractors', title: 'Know which open item will cost you days.', shot: 'whatif', label: 'RunF9 · Overview · What-if', alt: 'What-if results on the Overview page in RunF9: a pending change order, a utility delay, a delay reported in meeting minutes and the best recovery option, each with the days it moves the finish.',
    points: ['A brief every morning: what drives the finish, what is overdue and what starts today.', 'Each open change is run against the schedule before you price it or send notice.', 'When a date slips, recovery options are re-scheduled on the real network and priced from your labor cost.'] },
  { id: 'owner', tab: 'Owners and owner’s reps', title: 'Review a contractor’s schedule in minutes.', shot: 'checks', label: 'RunF9 · Health · What to fix', alt: 'A failed DCMA check in RunF9 for the sample data center: negative float, with what it means, why it matters, how to fix it and the activities to look at.',
    points: ['Upload each monthly update: logic, duration and calendar edits and rewritten actual dates are listed by activity.', 'All 14 DCMA checks on every submission, GAO checks in the Standards view, with the activities behind each finding.', 'A client version of the brief reports progress and decisions needed in plain language.'] },
  { id: 'consultant', tab: 'Schedule consultants', title: 'Spend your hours on judgment, not on formatting.', shot: 'schedule', label: 'RunF9 · Gantt chart', alt: 'The Gantt chart in RunF9 for the sample data center: work areas and their activities, with completed work in blue, remaining work in green, the critical path in red, and the baseline and the data date marked.',
    points: ['Reads and writes P6 and MS Project files, so your client’s tools do not change.', 'Time Impact Analysis with hashed inputs and results: the same inputs reproduce the same answer.', 'Each client’s projects sit in their own workspace, and each client’s files can stay in that client’s cloud.'] },
  { id: 'federal', tab: 'Federal and defense work', title: 'Built for projects that cannot leave your boundary.', shot: 'earned-value', label: 'RunF9 · Earned value', alt: 'The Earned value page in RunF9: SPI, CPI, schedule and cost variance, estimate at completion and the cumulative cost curve.',
    points: ['Projects marked CUI or classified are never sent to an AI model and have no inbox or mailbox connection.', 'Runs air-gapped on your own servers; every release is checked to send nothing outside your network.', 'Earned value and an IPMDAR schedule export, with a NIST SP 800-171 control mapping for your security review.'] },
]

export function Audiences() {
  const tabs = useTabs(AUDIENCES.length)
  const a = AUDIENCES[tabs.active]
  return (
    <section id="who" aria-labelledby="who-h" className={ANCHOR}>
      <div className={`${WRAP} ${PAD}`}>
        <Reveal className="flex flex-wrap items-end justify-between gap-x-10 gap-y-8">
          <div>
            <Eyebrow>Who it is for</Eyebrow>
            <h2 id="who-h" className={`${H2} text-ink mt-4`}>Built for the way you work.</h2>
          </div>
          <TabList label="Who RunF9 is for" items={AUDIENCES} prefix="who" panel="who-panel" tabs={tabs} />
        </Reveal>
        <Reveal className="mt-12 md:mt-16">
          <div id="who-panel" role="tabpanel" aria-labelledby={`who-tab-${a.id}`}>
            <div key={a.id} className="rise-in grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-x-16 gap-y-10 items-center">
              <Shot name={a.shot} alt={a.alt} label={a.label} className="lg:order-first order-last" />
              <div>
                <h3 className="text-h3 md:text-h2 font-semibold tracking-[-0.01em] md:tracking-[-0.02em] text-ink leading-tight">{a.title}</h3>
                <ul className="mt-7 border-t border-warm-200">
                  {a.points.map(p => <li key={p} className="border-b border-warm-200 py-4 text-copy text-warm-700 leading-relaxed">{p}</li>)}
                </ul>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

// ── Reports ──────────────────────────────────────────────────────────────────────────────────────

const REPORTS: [string, string][] = [
  ['Executive Schedule Summary', 'status, key dates, findings and recommendations'],
  ['Critical & Near-Critical Paths', 'driving activities, float and low-float paths'],
  ['Baseline vs Current Variance', 'current dates against the baseline in your file'],
  ['Schedule QA/QC Audit', 'the DCMA 14-Point results, with issues and fixes'],
  ['Time Impact Analysis', 'the delay event, its fragnet and the impact on each milestone'],
]

export function Reports() {
  return (
    <section id="reports" aria-labelledby="reports-h" className={`bg-white border-y border-warm-200 ${ANCHOR}`}>
      <div className={`${WRAP} ${PAD} grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-x-16 gap-y-12 items-center`}>
        <div>
          <SectionHead stacked id="reports-h" eyebrow="Reports" title="Reports, written from your numbers."
            lead="Each report is built from the schedule’s calculated figures and says where every number came from. With AI off, RunF9 writes it by rule; with AI on, the model drafts the wording and the figures stay the engine’s." />
          <Reveal>
            <dl className="mt-8 border-t border-warm-200">
              {REPORTS.map(([t, d]) => (
                <div key={t} className="border-b border-warm-200 py-3.5">
                  <dt className="text-copy font-semibold text-ink">{t}</dt>
                  <dd className="text-small text-warm-700 leading-relaxed mt-0.5 first-letter:uppercase">{d}.</dd>
                </div>
              ))}
            </dl>
          </Reveal>
        </div>
        <Reveal><Shot name="report" label="RunF9 · Reports · Executive Schedule Summary" alt="An Executive Schedule Summary in RunF9 for the sample data center, with a provenance table: the schedule, the source file, its SHA-256 hash and the data date." /></Reveal>
      </div>
    </section>
  )
}

// ── What it connects to ──────────────────────────────────────────────────────────────────────────

const FILES: [string, string, string][] = [
  ['.xer', 'Primavera P6', 'Import and export with logic, lags, constraints and calendars.'],
  ['.xml', 'Microsoft Project', 'Import and export in the same detail.'],
  ['.xlsx', 'Excel', 'Read activities and dates in; send schedules and reports out.'],
  ['.pdf', 'PDF', 'Read a schedule printout; export reports ready to send.'],
]
const ALSO: [string, string][] = [
  ['Microsoft 365 mail', 'One mail folder per project, read every morning, where your admin has set up Microsoft sign-in.'],
  ['Project inbox', 'Email, meeting transcripts and daily reports forwarded from Power Automate, Zapier or a mail rule.'],
  ['Cloud storage', 'Amazon S3, Azure Blob Storage and Google Cloud Storage for schedules and documents.'],
  ['API, webhooks and sign-on', 'API keys and signed webhooks; SAML and OpenID Connect sign-on with SCIM provisioning.'],
]

export function Integrations() {
  return (
    <section id="integrations" aria-labelledby="integrations-h" className={ANCHOR}>
      <div className={`${WRAP} ${PAD} grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-x-16 gap-y-12 items-start`}>
        <SectionHead stacked id="integrations-h" eyebrow="Integrations" title="Works with the tools you already use." className="lg:sticky lg:top-32"
          lead="RunF9 does not replace your scheduling tool or your project record. It reads them, does the analysis and hands the result back." />
        <div>
          <ul className="border-t border-warm-200">
            {FILES.map(([ext, name, text], i) => (
              <Reveal as="li" key={name} delay={i * 60} className="grid grid-cols-[72px_1fr] sm:grid-cols-[88px_190px_1fr] items-center gap-x-5 gap-y-1 border-b border-warm-200 py-5">
                <span aria-hidden className="row-span-2 sm:row-span-1 inline-flex items-center justify-center h-11 rounded-xl bg-navy-950 text-white font-mono text-small font-semibold">{ext}</span>
                <h3 className="text-h3 font-semibold text-ink tracking-[-0.01em]">{name}</h3>
                <p className="col-start-2 sm:col-start-3 text-copy text-warm-700 leading-relaxed">{text}</p>
              </Reveal>
            ))}
          </ul>
          <ul className="mt-12 grid sm:grid-cols-2 gap-x-12 gap-y-9">
            {ALSO.map(([name, text], i) => (
              <Reveal as="li" key={name} delay={(i % 2) * 80}>
                <h3 className="text-copy font-semibold text-ink">{name}</h3>
                <p className="text-small text-warm-700 leading-relaxed mt-1.5">{text}</p>
              </Reveal>
            ))}
          </ul>
          <div className="mt-12 border-t border-warm-200 pt-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-small text-warm-700">
            <span className="font-semibold text-ink">Coming soon:</span>
            {['Procore', 'Kahua'].map(n => <span key={n} className="rounded-full border border-warm-300 bg-white px-3.5 py-1 font-medium text-ink">{n}</span>)}
            <span>Not available yet. Until then, their notifications reach RunF9 through the project inbox or a mail folder.</span>
          </div>
        </div>
      </div>
    </section>
  )
}

// ── Security ─────────────────────────────────────────────────────────────────────────────────────

const SECURITY = [
  { icon: Building2, title: 'Your firm’s data stays yours', text: 'Every record is scoped to your organization, and an automated suite tries to reach another firm’s data on every code change.' },
  { icon: KeyRound, title: 'Sign-in your IT team controls', text: 'Single sign-on with SAML or OpenID Connect, SCIM provisioning, and two-step verification that an admin can require.' },
  { icon: Users, title: 'Roles and workspaces', text: 'Five roles from Owner to Viewer. Workspaces wall off projects from members who are not assigned to them.' },
  { icon: ScrollText, title: 'An audit log you can check', text: 'Material actions are recorded in a hash-chained log, so a removed or altered entry can be detected.' },
  { icon: EyeOff, title: 'AI is off until you turn it on', text: 'An admin switches AI on for the organization. Projects marked CUI or classified are never sent to a model.' },
  { icon: Database, title: 'Export and delete on your terms', text: 'Export your organization’s data, set how long records are kept and delete them. Connections are encrypted with TLS.' },
]

export function Security({ contactHref }: { contactHref: string }) {
  return (
    <section id="security" aria-labelledby="security-h" className={`bg-navy-950 ${ANCHOR}`}>
      <div className={`${WRAP} ${PAD}`}>
        <SectionHead dark id="security-h" eyebrow="Security" title="Security you can check for yourself."
          lead="Each control below is enforced in code and tested on every change. We will run the tests in front of your security team." />
        <ul className="mt-14 md:mt-20 grid sm:grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-12">
          {SECURITY.map(({ icon: Icon, title, text }, i) => (
            <Reveal as="li" key={title} delay={(i % 3) * 80} className="border-t border-navy-800 pt-6">
              <Icon size={22} strokeWidth={1.6} className="text-accent-400" aria-hidden />
              <h3 className="text-h3 font-semibold text-white mt-5 tracking-[-0.01em]">{title}</h3>
              <p className="text-copy text-navy-200 leading-relaxed mt-2.5">{text}</p>
            </Reveal>
          ))}
        </ul>
        <Reveal className="mt-16 md:mt-20 rounded-[24px] bg-navy-900 grid md:grid-cols-2 md:divide-x divide-navy-800">
          <div className="p-7 md:p-10">
            <h3 className="text-h3 font-semibold tracking-[-0.01em] text-white">What we do not have yet</h3>
            <p className="text-copy text-navy-200 leading-relaxed mt-2.5">RunF9 has not completed a SOC 2 audit and is not FedRAMP authorized. For work that needs either, run RunF9 inside your own boundary.</p>
          </div>
          <div className="p-7 md:p-10 border-t border-navy-800 md:border-t-0">
            <h3 className="text-h3 font-semibold tracking-[-0.01em] text-white">Documents for your review</h3>
            <p className="text-copy text-navy-200 leading-relaxed mt-2.5">Our security overview, control matrix and NIST SP 800-171 mapping are available: <a href={contactHref} className="text-white underline underline-offset-4">ask us for them</a>.</p>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

// ── Pricing ──────────────────────────────────────────────────────────────────────────────────────

const LICENSE = ['Unlimited schedules, updates and interview-built plans', 'Every check, report and export: P6, MS Project, PDF and Excel', 'The Daily Brief for the project manager, the field and the client', 'Delay analysis, what-ifs and Monte Carlo schedule risk', 'Site captures and the site map on any phone', 'Single sign-on (SAML, OpenID Connect) and SCIM', 'Roles, 2-step verification, approval policies and the audit log', 'Your cloud account (AWS, Azure, Google Cloud) or air-gapped', 'Data export, retention and deletion controls', 'Support by email from the founder']

/** Licensed per organization, quoted after a demo on the firm's own schedule. No plans or prices are shown. */
export function Pricing({ inviteOnly, demoHref, questionHref }: { inviteOnly: boolean; demoHref: string; questionHref: string }) {
  return (
    <section id="pricing" aria-labelledby="pricing-h" className={ANCHOR}>
      <div className={`${WRAP} ${PAD} grid grid-cols-1 lg:grid-cols-[5fr_7fr] gap-x-16 gap-y-12 items-start`}>
        <div>
          <SectionHead stacked id="pricing-h" eyebrow="Pricing" title="Priced for your organization."
            lead={<>RunF9 is licensed per organization. The price depends on how many projects and people use it and on where it runs: our cloud, your cloud account, or air-gapped.{!inviteOnly && ' You can start free with up to 3 uploaded schedules; the list beside this is what a license can include.'}</>} />
          <Reveal className="mt-10 border-t border-warm-200 pt-8">
            <h3 className="text-h3 font-semibold tracking-[-0.01em] text-ink leading-tight">See it on one of your own schedules</h3>
            <p className="text-copy text-warm-700 leading-relaxed mt-2.5 max-w-[480px]">Send us a schedule, or bring one to the call. We run it through RunF9 with you, answer your security and deployment questions, and quote for your organization.</p>
            <Cta href={demoHref} className={`${primaryBtn} mt-7 gap-2 px-6 py-3 text-copy`}>Request a demo<ArrowRight size={18} aria-hidden /></Cta>
            <p className="text-small text-warm-700 mt-5">Or write to <a href={questionHref} className="font-semibold text-accent-700 underline underline-offset-4">the founder</a> with any question.</p>
          </Reveal>
        </div>
        <Reveal className="rounded-[28px] bg-white border border-warm-200 p-7 md:p-10 shadow-[0_30px_60px_-40px_rgba(29,33,37,0.35)]">
          <h3 className="text-h3 font-semibold tracking-[-0.01em] text-ink">What a license can include</h3>
          <ul className="mt-5 grid sm:grid-cols-2 gap-x-10 border-t border-warm-200">
            {LICENSE.map(f => (
              <li key={f} className="flex items-start gap-3 border-b border-warm-200 py-3.5 text-small text-warm-700 leading-relaxed"><Check size={17} strokeWidth={2.4} className="text-accent-600 flex-shrink-0 mt-0.5" aria-hidden />{f}</li>
            ))}
          </ul>
          <p className="text-small text-warm-600 mt-6">Your quote sets which of these are switched on for your organization.</p>
        </Reveal>
      </div>
    </section>
  )
}

// ── Questions ────────────────────────────────────────────────────────────────────────────────────

const FAQ: [string, string][] = [
  ['Does RunF9 replace Primavera P6 or Microsoft Project?', 'No. RunF9 reads and writes their files. Keep your schedule in the tool your contract requires, and use RunF9 to check it, compare updates, model delays and brief the team. You can also build a new baseline in RunF9 and export it to either format.'],
  ['Is the critical path calculated by AI?', 'No. Dates, float, the critical path, the DCMA checks, risk analysis and what-if results come from RunF9’s scheduling engine, which is ordinary arithmetic and gives the same answer every time. AI is used only for language: answering questions with citations, explaining a contract clause and drafting report text.'],
  ['Can we use RunF9 with AI switched off?', 'Yes. AI is off for a new organization until an admin turns it on, and the Daily Brief, the checks, update comparison and Time Impact Analysis all work without it.'],
  ['Where is our data stored?', 'On RunF9 Cloud, in the United States. You can keep original files in your own Amazon S3, Azure or Google Cloud storage, run all of RunF9 in your own cloud account, or install it on your own servers with no outside connection.'],
  ['Can we use it on projects with controlled unclassified information?', 'Mark the project CUI and RunF9 never sends it to an AI model and gives it no inbox or mailbox connection. RunF9 Cloud is not FedRAMP authorized, so for CUI most firms run RunF9 inside their own boundary. Your security officer decides what your contract allows.'],
  ['Do you have a SOC 2 report?', 'Not yet. We share our security overview, control matrix and NIST SP 800-171 mapping, and we will run our security tests in front of your team. An independent penetration test is planned.'],
  ['Does it work on a phone or tablet?', 'Yes. Every page is tested at phone, tablet and desktop sizes, so a superintendent can read the brief in the field.'],
  ['How do we get access?', 'RunF9 is in private beta and firms join by invitation. Request access and we will set up your organization and walk you through your first schedule.'],
]

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-h" className={`bg-white border-t border-warm-200 ${ANCHOR}`}>
      <div className={`${WRAP} ${PAD} grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-x-16 gap-y-10 items-start`}>
        <SectionHead stacked id="faq-h" eyebrow="FAQ" title="Questions, answered plainly." className="lg:sticky lg:top-32" />
        <Reveal className="border-t border-warm-200">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group border-b border-warm-200">
              <summary className="flex items-center justify-between gap-6 py-5 cursor-pointer list-none text-copy md:text-lead font-semibold text-ink tracking-[-0.01em] hover:text-accent-700">
                {q}
                <ChevronDown size={20} className="text-warm-600 transition-transform duration-300 group-open:rotate-180 flex-shrink-0" aria-hidden />
              </summary>
              <p className="text-copy text-warm-700 leading-relaxed pb-6 -mt-1 max-w-[680px]">{a}</p>
            </details>
          ))}
        </Reveal>
      </div>
    </section>
  )
}

// ── The foot of the page ─────────────────────────────────────────────────────────────────────────

/** The closing call to action and the footer, as one navy block. */
export function Closing({ inviteOnly, primaryHref }: { inviteOnly: boolean; primaryHref: string }) {
  return (
    <section aria-labelledby="closing-h" className="relative bg-navy-950 overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_90%_at_50%_0%,rgba(74,130,214,0.28),transparent_65%)]" />
      <Reveal className={`relative ${WRAP} py-24 md:py-36 text-center`}>
        <h2 id="closing-h" className={`${H2} text-white max-w-[760px] mx-auto`}>Use RunF9 on your next schedule</h2>
        <p className="text-lead text-navy-200 leading-relaxed mt-5 max-w-[620px] mx-auto">Start with the interview, or upload a schedule and see the DCMA 14-Point results in seconds.</p>
        <Cta href={primaryHref} className="pressable mt-9 inline-flex items-center justify-center gap-2 rounded-full bg-white text-ink font-semibold px-7 py-3.5 text-copy hover:bg-warm-100 transition-colors">{inviteOnly ? 'Request access' : 'Get started free'}<ArrowRight size={18} aria-hidden /></Cta>
        <p className="text-small text-navy-200 mt-6">{inviteOnly ? <>Private beta · by invitation. Already invited? <Link href="/auth" className="underline underline-offset-4 text-white">Sign in</Link>.</> : 'No credit card required.'}</p>
      </Reveal>
    </section>
  )
}

const footLink = 'block w-fit text-small text-navy-200 py-1.5 hover:text-white transition-colors'
const footHead = 'text-small font-semibold text-white mb-3'

export function Footer() {
  return (
    <footer className="bg-navy-950 border-t border-navy-800">
      <div className={`${WRAP} pt-16 pb-12 grid grid-cols-2 md:grid-cols-[1.6fr_1fr_1fr_1fr] gap-x-10 gap-y-12`}>
        <div className="col-span-2 md:col-span-1">
          <Logo variant="light" size="h-[30px]" />
          <p className="text-small text-navy-200 mt-5 max-w-[300px] leading-relaxed">Construction scheduling, explained. Built by Hoshmand AI, founded by a construction scheduling consultant with 13 years in the field.</p>
        </div>
        <nav aria-label="Product">
          <p className={footHead}>Product</p>
          {[['#today', 'Daily Brief'], ['#features', 'Features'], ['#updates', 'Updates & delays'], ['#reports', 'Reports'], ['#integrations', 'Integrations'], ['#pricing', 'Pricing']].map(([href, label]) => <a key={href} href={href} className={footLink}>{label}</a>)}
        </nav>
        <nav aria-label="Trust">
          <p className={footHead}>Trust</p>
          {[['#deployment', 'Your cloud'], ['#security', 'Security'], ['#evidence', 'Evidence'], ['#faq', 'FAQ']].map(([href, label]) => <a key={href} href={href} className={footLink}>{label}</a>)}
        </nav>
        <nav aria-label="Company and legal">
          <p className={footHead}>Company</p>
          <a href="https://www.hoshmand.ai" className={footLink}>Hoshmand AI<ArrowUpRight size={13} aria-hidden className="inline ml-1 -mt-0.5" /></a>
          <a href="mailto:support@hoshmand.ai" className={footLink}>Contact</a>
          <Link href="/auth" className={footLink}>Sign in</Link>
          <p className={`${footHead} mt-7`}>Legal</p>
          <Link href="/privacy" className={footLink}>Privacy Policy</Link>
          <Link href="/terms" className={footLink}>Terms of Service</Link>
        </nav>
      </div>
      <div className={WRAP}><p className="border-t border-navy-800 py-6 text-fine text-navy-200">© 2026 RunF9. Built by Hoshmand AI. All rights reserved.</p></div>
    </footer>
  )
}
