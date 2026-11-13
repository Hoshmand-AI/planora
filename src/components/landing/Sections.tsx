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

// ── The Daily Brief ──────────────────────────────────────────────────────────────────────────────

type Tone = 'risk' | 'info' | 'ok' | 'plain'
const TONE: Record<Tone, string> = {
  risk: 'bg-status-at-risk-bg text-status-at-risk',
  info: 'bg-accent-100 text-accent-700',
  ok: 'bg-status-on-track-bg text-status-on-track',
  plain: 'bg-warm-100 text-warm-700',
}

const BRIEFS: { id: string; tab: string; headline: string; lines: { tag: string; tone: Tone; text: string; source?: string }[] }[] = [
  {
    id: 'pm', tab: 'Project manager',
    headline: 'Substantial completion is now forecast for 03/18/2027, 6 work days later than the last update.',
    lines: [
      { tag: 'Driving', tone: 'risk', text: 'Switchgear delivery (A2140) drives the finish today. It has 0 days of float.' },
      { tag: 'Change', tone: 'info', text: 'PCO-014, added generator pad: the finish moves 9 work days if it is approved as written.' },
      { tag: 'Email', tone: 'plain', text: '“The switchgear ship date has slipped two weeks.”', source: 'Supplier email, 11/10/2026 · matched to A2140' },
      { tag: 'Contract', tone: 'risk', text: 'Notice of delay is due within 7 days of the event. 4 days remain.', source: 'General Conditions, clause 8.3' },
    ],
  },
  {
    id: 'field', tab: 'Field',
    headline: '3 activities start today. 1 is overdue and on the driving path.',
    lines: [
      { tag: 'Start today', tone: 'ok', text: 'Level 2 conduit rough-in (A3310), electrical yard duct bank (A2210), roof steel detailing (A1480).' },
      { tag: 'Overdue', tone: 'risk', text: 'Roof curb inspection (A1520) was planned to finish 11/07/2026 and is still open.' },
      { tag: 'Field report', tone: 'info', text: 'Yesterday’s report says slab pour B is complete. The schedule still shows it open.', source: 'Daily report, 11/11/2026' },
      { tag: 'Look ahead', tone: 'plain', text: '5 activities have 3 days of float or less in the next two weeks.' },
    ],
  },
  {
    id: 'client', tab: 'Client',
    headline: 'The project is 41% complete. Substantial completion is forecast for 03/18/2027.',
    lines: [
      { tag: 'Completed', tone: 'ok', text: 'Foundations and underground utilities finished last week.' },
      { tag: 'Next milestone', tone: 'plain', text: 'Building dry-in, 12/15/2026.' },
      { tag: 'In progress', tone: 'plain', text: 'Structural steel, electrical yard and Level 1 mechanical rough-in.' },
      { tag: 'Decision needed', tone: 'info', text: 'PCO-014, added generator pad, is waiting for approval.' },
    ],
  },
]

const BRIEF_POINTS = [
  { icon: ScrollText, title: 'Calculated, not generated', text: 'The brief is computed from the schedule, the project register and your documents. No AI model writes it, so the same inputs always give the same brief.' },
  { icon: Mail, title: 'Reads your email and meetings', text: 'Emails, minutes and daily reports filed with the project are read for delays, changes and risks. Each one is quoted with its source and the activity it names.' },
  { icon: GitPullRequestArrow, title: 'A what-if for every open change', text: 'Risks, issues, PCOs and change orders live in one register. Each open change is run against the schedule, and the brief gives the days it would move the finish.' },
  { icon: SearchCheck, title: 'Contract and scope watch', text: 'Notice periods and liquidated damages found in your contract are tracked against the dates, and specification scope that no activity covers is listed with the sentence.' },
]

export function DailyBrief() {
  const tabs = useTabs(BRIEFS.length)
  const b = BRIEFS[tabs.active]
  return (
    <section id="today" aria-labelledby="today-h" className="max-w-6xl mx-auto px-6 py-24 md:py-36 scroll-mt-20">
      <Reveal className="text-center max-w-[800px] mx-auto">
        <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-accent-700">The Daily Brief</p>
        <h2 id="today-h" className={`${H2} mt-3`}>Every morning, what changed and what to do about it.</h2>
        <p className={LEAD}>RunF9 recalculates the schedule, reads what came in overnight and writes one brief for the project manager, one for the field and one for the client.</p>
      </Reveal>

      <div className="mt-14 md:mt-20 grid lg:grid-cols-[1fr_1.25fr] gap-12 lg:gap-16 items-start">
        <ul className="space-y-8 lg:pt-4">
          {BRIEF_POINTS.map(({ icon: Icon, title, text }, i) => (
            <Reveal as="li" key={title} delay={i * 80} className="flex gap-4">
              <span className="flex-shrink-0 w-10 h-10 rounded-xl bg-accent-100 text-accent-700 flex items-center justify-center"><Icon size={20} strokeWidth={1.8} aria-hidden /></span>
              <div>
                <h3 className="text-[18px] font-semibold text-navy-950 tracking-[-0.01em]">{title}</h3>
                <p className="text-[15px] text-warm-600 leading-relaxed mt-1.5">{text}</p>
              </div>
            </Reveal>
          ))}
        </ul>

        <Reveal>
          {/* A drawing of the Today page from sample data; the tabs switch the reader, as in the product */}
          <div className="rounded-[24px] border border-warm-200 bg-white shadow-[0_40px_80px_-40px_rgba(6,20,27,0.35)] overflow-hidden">
            <div className="flex items-center gap-2 px-5 h-11 bg-navy-900" aria-hidden="true">
              <span className="w-2.5 h-2.5 rounded-full bg-navy-700" /><span className="w-2.5 h-2.5 rounded-full bg-navy-700" /><span className="w-2.5 h-2.5 rounded-full bg-navy-700" />
              <span className="ml-3 text-[12.5px] text-navy-200">RunF9 · Today</span>
            </div>
            <div className="p-5 md:p-7">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[12.5px] text-warm-600">Sample project · Data center, Phase 1</div>
                  <div className="text-[19px] font-semibold text-navy-950 tracking-[-0.02em]">Brief for 11/12/2026</div>
                </div>
                <TabList label="Who the brief is for" items={BRIEFS} prefix="brief" panel="brief-panel" tabs={tabs} />
              </div>
              <div id="brief-panel" role="tabpanel" aria-labelledby={`brief-tab-${b.id}`} className="mt-5">
                <div key={b.id} className="rise-in">
                  <p className="text-[17px] md:text-[19px] font-semibold text-navy-950 leading-snug tracking-[-0.01em]">{b.headline}</p>
                  <ul className="mt-4 divide-y divide-warm-200 border-t border-warm-200">
                    {b.lines.map(l => (
                      <li key={l.text} className="py-3.5 flex flex-col sm:flex-row gap-1.5 sm:gap-4">
                        <span className={`self-start flex-shrink-0 sm:w-[108px] text-center text-[12px] font-semibold rounded-full px-2.5 py-1 ${TONE[l.tone]}`}>{l.tag}</span>
                        <span className="min-w-0">
                          <span className="block text-[14.5px] text-warm-700 leading-relaxed">{l.text}</span>
                          {l.source && <span className="block text-[12.5px] text-warm-600 mt-0.5">{l.source}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
          <p className="text-[13px] text-warm-600 mt-4 text-center">Illustrative sample. In the product every line links to its activity, register item or quoted passage.</p>
        </Reveal>
      </div>
    </section>
  )
}

// ── Who it is for ────────────────────────────────────────────────────────────────────────────────

const AUDIENCES = [
  { id: 'gc', tab: 'General contractors', title: 'Know which open item will cost you days.',
    points: ['A brief every morning: what drives the finish, what is overdue and what starts today.', 'Each open change is run against the schedule before you price it or send notice.', 'When a date slips, recovery options are re-scheduled on the real network and priced from your labor cost.'] },
  { id: 'owner', tab: 'Owners and owner’s reps', title: 'Review a contractor’s schedule in minutes.',
    points: ['Upload each monthly update: logic, duration and calendar edits and rewritten actual dates are listed by activity.', 'All 14 DCMA checks on every submission, with the activities behind each finding.', 'A client version of the brief reports progress and decisions needed in plain language.'] },
  { id: 'consultant', tab: 'Schedule consultants', title: 'Spend your hours on judgment, not on formatting.',
    points: ['Reads and writes P6 and MS Project files, so your client’s tools do not change.', 'Time Impact Analysis with hashed inputs and results: the same inputs reproduce the same answer.', 'Each client’s projects sit in their own workspace, and each client’s files can stay in that client’s cloud.'] },
  { id: 'federal', tab: 'Federal and defense work', title: 'Built for projects that cannot leave your boundary.',
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
          <div id="who-panel" role="tabpanel" aria-labelledby={`who-tab-${a.id}`} className="mt-8 max-w-[880px] mx-auto rounded-[28px] bg-warm-50 border border-warm-200 p-7 md:p-12">
            <div key={a.id} className="rise-in">
              <h3 className="text-[24px] md:text-[32px] font-semibold tracking-[-0.03em] text-navy-950 leading-tight">{a.title}</h3>
              <ul className="mt-6 space-y-4">
                {a.points.map(p => (
                  <li key={p} className="flex items-start gap-3 text-[16px] text-warm-700 leading-relaxed">
                    <ListChecks size={20} className="text-accent-600 flex-shrink-0 mt-1" aria-hidden />{p}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

// ── What it connects to ──────────────────────────────────────────────────────────────────────────

const CONNECTIONS: [string, string][] = [
  ['Primavera P6', 'Import and export .xer with logic, lags, constraints and calendars.'],
  ['Microsoft Project', 'Import and export .xml in the same detail.'],
  ['Excel and PDF', 'Read activities and dates in; send reports and schedules out.'],
  ['Microsoft 365 mail', 'Read one mail folder per project every morning, where your admin has set up Microsoft sign-in.'],
  ['Project inbox', 'Forward email, meeting transcripts and daily reports from Power Automate, Zapier or a mail rule.'],
  ['Cloud storage', 'Amazon S3, Azure Blob Storage and Google Cloud Storage for schedules and documents.'],
  ['API and webhooks', 'API keys and signed webhooks on Pro and Enterprise.'],
  ['Single sign-on', 'SAML 2.0 and OpenID Connect (Entra ID, Okta, Google Workspace), with SCIM provisioning.'],
]

export function Integrations() {
  return (
    <section id="integrations" aria-labelledby="integrations-h" className="max-w-6xl mx-auto px-6 py-24 md:py-36 scroll-mt-20">
      <Reveal className="text-center max-w-[760px] mx-auto">
        <h2 id="integrations-h" className={H2}>Works with the tools you already use.</h2>
        <p className={LEAD}>RunF9 does not replace your scheduling tool or your project record. It reads them, does the analysis and hands the result back.</p>
      </Reveal>
      <ul className="mt-14 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {CONNECTIONS.map(([name, text], i) => (
          <Reveal as="li" key={name} delay={(i % 4) * 70} className="rounded-2xl bg-white border border-warm-200 p-6">
            <h3 className="text-[16.5px] font-semibold text-navy-950 tracking-[-0.01em]">{name}</h3>
            <p className="text-[14.5px] text-warm-600 leading-relaxed mt-2">{text}</p>
          </Reveal>
        ))}
      </ul>
      <p className="text-[14.5px] text-warm-600 text-center mt-8 max-w-[680px] mx-auto">Connectors for Procore and Kahua are planned and not yet available. Until then, their RFI, submittal and change notifications reach RunF9 through the project inbox or a mail folder.</p>
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
              <p className="text-[15px] text-navy-200 leading-relaxed mt-2">{text}</p>
            </Reveal>
          ))}
        </ul>
        <p className="text-[14.5px] text-navy-200 mt-14 max-w-[760px] leading-relaxed">
          Our security overview, control matrix and NIST SP 800-171 mapping are available for your review: <a href={contactHref} className="text-white underline">ask us for them</a>. RunF9 has not yet completed a SOC 2 audit and is not FedRAMP authorized; for work that needs those, run RunF9 inside your own boundary.
        </p>
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
      <Reveal>
        <h2 id="faq-h" className="text-[32px] md:text-[44px] font-semibold tracking-[-0.035em] text-navy-950 leading-tight">Questions, answered plainly.</h2>
      </Reveal>
      <div className="border-t border-warm-200 mt-10">
        {FAQ.map(([q, a]) => (
          <details key={q} className="group border-b border-warm-200">
            <summary className="flex items-center justify-between gap-4 py-5 cursor-pointer list-none text-[17px] font-semibold text-navy-950">
              {q}
              <ChevronDown size={20} className="text-warm-600 transition-transform duration-300 group-open:rotate-180 flex-shrink-0" aria-hidden />
            </summary>
            <p className="text-[15.5px] text-warm-600 leading-relaxed pb-6 -mt-1 max-w-[720px]">{a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
