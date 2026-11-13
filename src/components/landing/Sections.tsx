'use client'

// Landing-page sections added 11/12/2026: the Daily Brief shown as product, who RunF9 is for, what it
// connects to, security, and the questions buyers ask. Every claim here is listed with its evidence in
// docs/marketing/CLAIMS-REGISTER.md. The product pictures are drawn in HTML from sample data and say so.

import { useRef, useState } from 'react'
import { ChevronDown, Mail, GitPullRequestArrow, ScrollText, SearchCheck, KeyRound, Users, ListChecks, Building2, EyeOff, Database, Lock } from 'lucide-react'
import { Reveal } from './motion'

const H2 = 'text-[36px] md:text-[56px] font-semibold tracking-[-0.04em] text-navy-950 leading-[1.05]'
const LEAD = 'text-[17px] md:text-[19px] text-warm-600 mt-4 leading-snug'

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
          className={`whitespace-nowrap rounded-full px-4 py-2 text-[14px] font-medium transition-colors ${i === tabs.active ? 'bg-white text-navy-950 shadow-sm' : 'text-warm-600 hover:text-navy-950'}`}
        >{x.tab}</button>
      ))}
    </div>
  )
}

// ── A real screenshot in a window frame ─────────────────────────────────────────────────────────

/** A screenshot of the product (public/landing/*.webp, 1600x1200, taken from the sample project). */
export function Shot({ name, alt, label, eager = false, className = '' }: { name: string; alt: string; label: string; eager?: boolean; className?: string }) {
  return (
    <figure className={`rounded-[18px] md:rounded-[22px] border border-warm-200 bg-white shadow-[0_40px_80px_-40px_rgba(6,20,27,0.45)] overflow-hidden ${className}`}>
      <div className="flex items-center gap-2 px-4 h-9 md:h-10 bg-navy-900" aria-hidden="true">
        <span className="w-2.5 h-2.5 rounded-full bg-navy-700" /><span className="w-2.5 h-2.5 rounded-full bg-navy-700" /><span className="w-2.5 h-2.5 rounded-full bg-navy-700" />
        <span className="ml-3 text-[12.5px] text-navy-200 truncate">{label}</span>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {/* On a phone the picture is shown larger and cropped to its top-left, so its text stays readable */}
      <div className="aspect-[4/3] overflow-hidden sm:aspect-auto">
        <img src={`/landing/${name}.webp`} alt={alt} width={1600} height={1200} loading={eager ? 'eager' : 'lazy'} decoding="async" className="block w-[175%] max-w-none sm:w-full h-auto" />
      </div>
    </figure>
  )
}

// ── The Daily Brief ──────────────────────────────────────────────────────────────────────────────

const BRIEF_VIEWS = [
  { id: 'brief', tab: 'This morning’s brief', shot: 'today', alt: 'The RunF9 Today page for a sample data center: the forecast is 40 days behind the required date, with eight items that need attention today.' },
  { id: 'signals', tab: 'Email, meetings and contract', shot: 'signals', alt: 'The Today page showing sentences quoted from meeting minutes, a field report and an email, each tagged as a change, delay or risk, and a contract notice reminder.' },
]

const BRIEF_POINTS = [
  { icon: ScrollText, title: 'Calculated, not generated', text: 'Computed from the schedule, the project register and your documents. No AI model writes it, so the same inputs always give the same brief.' },
  { icon: Mail, title: 'Reads your email and meetings', text: 'Emails, minutes and daily reports are read for delays, changes and risks. Each is quoted with its source and the activity it names.' },
  { icon: GitPullRequestArrow, title: 'A what-if for every open change', text: 'Risks, issues, PCOs and change orders live in one register. Each open change is run against the schedule for its effect on the finish.' },
  { icon: SearchCheck, title: 'Contract and scope watch', text: 'Notice periods and liquidated damages in your contract are tracked against the dates, and scope no activity covers is listed.' },
]

export function DailyBrief() {
  const tabs = useTabs(BRIEF_VIEWS.length)
  const v = BRIEF_VIEWS[tabs.active]
  return (
    <section id="today" aria-labelledby="today-h" className="bg-navy-950 scroll-mt-16">
      <div className="max-w-6xl mx-auto px-6 py-24 md:py-32">
        <Reveal className="text-center max-w-[820px] mx-auto">
          <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-accent-400">The Daily Brief</p>
          <h2 id="today-h" className="text-[36px] md:text-[56px] font-semibold tracking-[-0.04em] text-white leading-[1.05] mt-3">Every morning, what changed and what to do about it.</h2>
          <p className="text-[17px] md:text-[19px] text-navy-200 mt-4 leading-snug">RunF9 recalculates the schedule, reads what came in overnight and writes one brief for the project manager, one for the field and one for the client.</p>
        </Reveal>

        <Reveal className="mt-12 md:mt-16 max-w-[1040px] mx-auto">
          <div role="tablist" aria-label="Parts of the Today page" onKeyDown={tabs.onKeyDown} className="flex gap-1 overflow-x-auto p-1 rounded-full bg-navy-900 border border-navy-800 w-fit max-w-full mx-auto mb-6">
            {BRIEF_VIEWS.map((x, i) => (
              <button
                key={x.id} ref={el => { tabs.refs.current[i] = el }} type="button" role="tab" id={`brief-tab-${x.id}`}
                aria-selected={i === tabs.active} aria-controls="brief-panel" tabIndex={i === tabs.active ? 0 : -1}
                onClick={() => tabs.setActive(i)}
                className={`whitespace-nowrap rounded-full px-4 py-2 text-[14px] font-medium transition-colors ${i === tabs.active ? 'bg-white text-navy-950' : 'text-navy-200 hover:text-white'}`}
              >{x.tab}</button>
            ))}
          </div>
          <div id="brief-panel" role="tabpanel" aria-labelledby={`brief-tab-${v.id}`}>
            <div key={v.id} className="rise-in"><Shot name={v.shot} alt={v.alt} label="RunF9 · Today" className="border-navy-800" /></div>
          </div>
          <p className="text-[14px] text-navy-200 mt-4 text-center">The Today page in RunF9, on the sample data center project that every account can open.</p>
        </Reveal>

        <ul className="mt-16 md:mt-20 grid sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-10">
          {BRIEF_POINTS.map(({ icon: Icon, title, text }, i) => (
            <Reveal as="li" key={title} delay={i * 80}>
              <Icon size={24} strokeWidth={1.6} className="text-accent-400" aria-hidden />
              <h3 className="text-[18px] font-semibold text-white mt-4 tracking-[-0.01em]">{title}</h3>
              <p className="text-[16px] text-navy-200 leading-relaxed mt-2">{text}</p>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  )
}

// ── Who it is for ────────────────────────────────────────────────────────────────────────────────

const AUDIENCES = [
  { id: 'gc', tab: 'General contractors', title: 'Know which open item will cost you days.', shot: 'whatif', label: 'RunF9 · Today · What-if', alt: 'What-if results in RunF9: a pending change order, a utility delay and a recovery option, each with the days it moves the finish.',
    points: ['A brief every morning: what drives the finish, what is overdue and what starts today.', 'Each open change is run against the schedule before you price it or send notice.', 'When a date slips, recovery options are re-scheduled on the real network and priced from your labor cost.'] },
  { id: 'owner', tab: 'Owners and owner’s reps', title: 'Review a contractor’s schedule in minutes.', shot: 'quality', label: 'RunF9 · Quality', alt: 'The Quality page in RunF9: 10 of 14 DCMA checks pass, with the failing checks listed first.',
    points: ['Upload each monthly update: logic, duration and calendar edits and rewritten actual dates are listed by activity.', 'All 14 DCMA checks on every submission, with the activities behind each finding.', 'A client version of the brief reports progress and decisions needed in plain language.'] },
  { id: 'consultant', tab: 'Schedule consultants', title: 'Spend your hours on judgment, not on formatting.', shot: 'schedule', label: 'RunF9 · Schedule', alt: 'The Schedule page in RunF9: a Gantt chart of the sample data center with the critical path and the data date marked.',
    points: ['Reads and writes P6 and MS Project files, so your client’s tools do not change.', 'Time Impact Analysis with hashed inputs and results: the same inputs reproduce the same answer.', 'Each client’s projects sit in their own workspace, and each client’s files can stay in that client’s cloud.'] },
  { id: 'federal', tab: 'Federal and defense work', title: 'Built for projects that cannot leave your boundary.', shot: 'earned-value', label: 'RunF9 · Overview · Earned value', alt: 'The Earned value view in RunF9: SPI, CPI, schedule and cost variance, estimate at completion and the cumulative cost curve.',
    points: ['Projects marked CUI or classified are never sent to an AI model and have no inbox or mailbox connection.', 'Runs air-gapped on your own servers; every release is checked to send nothing outside your network.', 'Earned value and an IPMDAR schedule export, with a NIST SP 800-171 control mapping for your security review.'] },
]

export function Audiences() {
  const tabs = useTabs(AUDIENCES.length)
  const a = AUDIENCES[tabs.active]
  return (
    <section id="who" aria-labelledby="who-h" className="bg-white border-y border-warm-200">
      <div className="max-w-6xl mx-auto px-6 py-24 md:py-32">
        <Reveal className="text-center">
          <h2 id="who-h" className={H2}>Built for the way you work.</h2>
        </Reveal>
        <Reveal className="mt-10">
          <TabList label="Who RunF9 is for" items={AUDIENCES} prefix="who" panel="who-panel" tabs={tabs} className="mx-auto" />
          <div id="who-panel" role="tabpanel" aria-labelledby={`who-tab-${a.id}`} className="mt-10">
            <div key={a.id} className="rise-in grid lg:grid-cols-[2fr_3fr] gap-10 lg:gap-14 items-center">
              <div>
                <h3 className="text-[26px] md:text-[34px] font-semibold tracking-[-0.03em] text-navy-950 leading-tight">{a.title}</h3>
                <ul className="mt-6 space-y-4">
                  {a.points.map(p => (
                    <li key={p} className="flex items-start gap-3 text-[16px] text-warm-700 leading-relaxed">
                      <ListChecks size={20} className="text-accent-600 flex-shrink-0 mt-1" aria-hidden />{p}
                    </li>
                  ))}
                </ul>
              </div>
              <Shot name={a.shot} alt={a.alt} label={a.label} />
            </div>
          </div>
        </Reveal>
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
    <section id="integrations" aria-labelledby="integrations-h" className="max-w-6xl mx-auto px-6 py-24 md:py-36 scroll-mt-20">
      <Reveal className="text-center max-w-[760px] mx-auto">
        <h2 id="integrations-h" className={H2}>Works with the tools you already use.</h2>
        <p className={LEAD}>RunF9 does not replace your scheduling tool or your project record. It reads them, does the analysis and hands the result back.</p>
      </Reveal>
      <ul className="mt-14 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {FILES.map(([ext, name, text], i) => (
          <Reveal as="li" key={name} delay={i * 70} className="rounded-2xl bg-white border border-warm-200 p-6">
            <span aria-hidden className="inline-flex items-center justify-center h-12 min-w-[64px] px-3 rounded-xl bg-navy-950 text-white font-mono text-[15px] font-semibold">{ext}</span>
            <h3 className="text-[19px] font-semibold text-navy-950 tracking-[-0.01em] mt-5">{name}</h3>
            <p className="text-[16px] text-warm-700 leading-relaxed mt-2">{text}</p>
          </Reveal>
        ))}
      </ul>
      <ul className="mt-4 grid sm:grid-cols-2 gap-x-10 gap-y-6 rounded-2xl bg-warm-100 border border-warm-200 p-6 md:p-8">
        {ALSO.map(([name, text]) => (
          <li key={name}>
            <h3 className="text-[16.5px] font-semibold text-navy-950">{name}</h3>
            <p className="text-[15.5px] text-warm-700 leading-relaxed mt-1">{text}</p>
          </li>
        ))}
      </ul>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[15px] text-warm-700">
        <span className="font-semibold text-navy-950">Planned, not yet available:</span>
        {['Procore', 'Kahua'].map(n => <span key={n} className="rounded-full border border-warm-300 bg-white px-3.5 py-1 font-medium text-navy-950">{n}</span>)}
        <span>Until then, their notifications reach RunF9 through the project inbox or a mail folder.</span>
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
    <section id="security" aria-labelledby="security-h" className="bg-navy-950 scroll-mt-16">
      <div className="max-w-6xl mx-auto px-6 py-24 md:py-32">
        <Reveal className="max-w-[720px]">
          <p className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.14em] text-accent-400"><Lock size={15} aria-hidden />Security</p>
          <h2 id="security-h" className="text-[36px] md:text-[56px] font-semibold tracking-[-0.04em] text-white leading-[1.05] mt-3">Security you can check for yourself.</h2>
          <p className="text-[17px] md:text-[19px] text-navy-200 mt-4 leading-snug">Each control below is enforced in code and tested on every change. We will run the tests in front of your security team.</p>
        </Reveal>
        <ul className="mt-14 grid sm:grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-10">
          {SECURITY.map(({ icon: Icon, title, text }, i) => (
            <Reveal as="li" key={title} delay={(i % 3) * 80}>
              <Icon size={24} strokeWidth={1.6} className="text-accent-400" aria-hidden />
              <h3 className="text-[18px] font-semibold text-white mt-4 tracking-[-0.01em]">{title}</h3>
              <p className="text-[16px] text-navy-200 leading-relaxed mt-2">{text}</p>
            </Reveal>
          ))}
        </ul>
        <div className="mt-14 grid md:grid-cols-2 gap-5">
          <div className="rounded-2xl border border-navy-800 bg-navy-900 p-6 md:p-7">
            <h3 className="text-[17px] font-semibold text-white">What we do not have yet</h3>
            <p className="text-[16px] text-navy-200 leading-relaxed mt-2">RunF9 has not completed a SOC 2 audit and is not FedRAMP authorized. For work that needs either, run RunF9 inside your own boundary.</p>
          </div>
          <div className="rounded-2xl border border-navy-800 bg-navy-900 p-6 md:p-7">
            <h3 className="text-[17px] font-semibold text-white">Documents for your review</h3>
            <p className="text-[16px] text-navy-200 leading-relaxed mt-2">Our security overview, control matrix and NIST SP 800-171 mapping are available: <a href={contactHref} className="text-white underline">ask us for them</a>.</p>
          </div>
        </div>
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
    <section id="faq" aria-labelledby="faq-h" className="max-w-[860px] mx-auto px-6 py-24 md:py-32 scroll-mt-20">
      <Reveal className="text-center">
        <h2 id="faq-h" className={H2}>Questions, answered plainly.</h2>
      </Reveal>
      <div className="border-t border-warm-200 mt-10">
        {FAQ.map(([q, a]) => (
          <details key={q} className="group border-b border-warm-200">
            <summary className="flex items-center justify-between gap-4 py-5 cursor-pointer list-none text-[17px] font-semibold text-navy-950">
              {q}
              <ChevronDown size={20} className="text-warm-600 transition-transform duration-300 group-open:rotate-180 flex-shrink-0" aria-hidden />
            </summary>
            <p className="text-[16px] text-warm-700 leading-relaxed pb-6 -mt-1 max-w-[720px]">{a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
