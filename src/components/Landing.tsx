'use client'

import Link from 'next/link'
import { FileText, MessageSquare, CheckCircle, Activity, BarChart3, Shield, Menu, X, ChevronDown } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Logo } from '@/components/Logo'
import F9Demo from '@/components/landing/F9Demo'
import Pillars from '@/components/landing/Pillars'
import { CountUp, Reveal } from '@/components/landing/motion'

/** A call to action: a mailto link (request access) or an in-app link. */
function Cta({ href, className, children }: { href: string; className: string; children: React.ReactNode }) {
  return href.startsWith('mailto:') ? <a href={href} className={className}>{children}</a> : <Link href={href} className={className}>{children}</Link>
}

const primaryBtn = 'pressable inline-flex items-center justify-center rounded-full bg-accent-600 text-white font-semibold hover:bg-[#1d4ed8] transition-colors'
const secondaryBtn = 'pressable inline-flex items-center justify-center rounded-full text-accent-600 font-semibold hover:bg-accent-100 transition-colors'

/**
 * Marketing page. While RunF9 is in private beta (PLANORA_SIGNUP not "open") the sign-up calls to
 * action become "Request access" / "Sign in" and the page says access is by invitation.
 */
export default function Landing({ inviteOnly, accessRequestEmail }: { inviteOnly: boolean; accessRequestEmail: string | null }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  // Request access: email the beta team (PLANORA_ACCESS_REQUEST_EMAIL, else the support address this page
  // already lists). Never the sign-up page: without an invitation it is a dead end for a prospect.
  const requestHref = `mailto:${accessRequestEmail || 'support@hoshmand.ai'}?subject=${encodeURIComponent('RunF9 private beta: access request')}`
  const primaryHref = inviteOnly ? requestHref : '/auth?mode=signup'
  const primaryLabel = inviteOnly ? 'Request access' : 'Get started'

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const nav = [['#features', 'Features'], ['#how-it-works', 'How it works'], ['#pricing', 'Pricing']]

  return (
    <div className="min-h-screen bg-[#FBFBFD] text-warm-600">
      {/* Navbar: translucent, quiet, the logo carries it */}
      <nav className={`sticky top-0 z-50 transition-[background-color,border-color] duration-300 border-b ${scrolled || menuOpen ? 'bg-white/80 backdrop-blur-xl border-warm-200' : 'bg-[#FBFBFD] border-transparent'}`}>
        <div className="max-w-6xl mx-auto px-6 h-[72px] flex items-center justify-between">
          <Link href="/" aria-label="RunF9 home" className="flex items-center">
            <Logo variant="dark" size="text-[26px]" />
          </Link>
          <div className="hidden md:flex items-center gap-9">
            {nav.map(([href, label]) => <a key={href} href={href} className="text-[14px] text-warm-700 hover:text-navy-950 transition-colors">{label}</a>)}
          </div>
          <div className="hidden md:flex items-center gap-2">
            <Link href="/auth" className={`${secondaryBtn} px-4 py-2 text-[14px]`}>Sign in</Link>
            <Cta href={primaryHref} className={`${primaryBtn} px-5 py-2 text-[14px]`}>{primaryLabel}</Cta>
          </div>
          <button className="md:hidden text-navy-950 p-2 -mr-2" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen}>
            {menuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
        {menuOpen && (
          <div className="md:hidden px-6 pb-6 pt-2">
            {nav.map(([href, label]) => <a key={href} href={href} className="block py-3 text-[17px] text-navy-950 border-b border-warm-200" onClick={() => setMenuOpen(false)}>{label}</a>)}
            <Link href="/auth" className="block py-3 text-[17px] text-navy-950 border-b border-warm-200">Sign in</Link>
            <Cta href={primaryHref} className={`${primaryBtn} w-full mt-5 py-3 text-[16px]`}>{primaryLabel}</Cta>
          </div>
        )}
      </nav>

      {/* Hero */}
      <header className="px-6 pt-16 md:pt-24 pb-24 md:pb-32 overflow-hidden">
        <div className="max-w-6xl mx-auto text-center">
          <h1 className="hero-rise text-[44px] leading-[1.04] md:text-[80px] font-semibold tracking-[-0.045em] text-navy-950 max-w-[900px] mx-auto">
            Construction schedules, calculated and explained.
          </h1>
          <p className="hero-rise [animation-delay:120ms] text-[19px] md:text-[23px] leading-snug text-warm-600 max-w-[660px] mx-auto mt-6 tracking-[-0.01em]">
            Answer a few questions and RunF9 builds the schedule with you. Already have one? Upload it and RunF9 checks it.
          </p>
          <div className="hero-rise [animation-delay:220ms] flex gap-3 justify-center flex-wrap mt-9">
            <Cta href={primaryHref} className={`${primaryBtn} px-7 py-3.5 text-[16px]`}>{primaryLabel}</Cta>
            {inviteOnly
              ? <Link href="/auth" className={`${secondaryBtn} px-7 py-3.5 text-[16px]`}>Sign in</Link>
              : <a href="#how-it-works" className={`${secondaryBtn} px-7 py-3.5 text-[16px]`}>See how it works</a>}
          </div>
        </div>
        <div className="hero-rise [animation-delay:340ms] max-w-[760px] mx-auto mt-16 md:mt-20 px-2 md:px-0">
          <F9Demo />
        </div>
      </header>

      {/* Facts: each figure is backed by an automated test or the product's own limits (see "Where these numbers come from") */}
      <section aria-label="RunF9 in numbers" className="border-y border-warm-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-16 grid grid-cols-2 md:grid-cols-4 gap-y-12 gap-x-6 text-center">
          {[
            [<>14 of 14</>, 'DCMA 14-Point checks, run automatically'],
            [<CountUp key="n" value={100000} />, 'activities scheduled by our CPM engine in automated tests'],
            [<>0 days</>, 'difference in dates and float when our P6 and MS Project exports are re-imported, in our test set'],
            inviteOnly ? [<>Beta</>, 'Private beta · by invitation'] : [<>$0</>, 'to start. No credit card'],
          ].map(([value, label], i) => (
            <Reveal key={String(label)} delay={i * 90}>
              <div className="text-[40px] md:text-[48px] font-semibold tracking-[-0.04em] text-navy-950 tabular-nums leading-none">{value}</div>
              <div className="text-[13.5px] text-warm-600 mt-3 leading-snug max-w-[200px] mx-auto">{label}</div>
            </Reveal>
          ))}
        </div>
        <div className="text-center pb-10 -mt-4"><a href="#evidence" className="text-[14px] text-accent-600 hover:underline">Where these numbers come from</a></div>
      </section>

      {/* Build. Check. Forecast. */}
      <section id="features" className="max-w-6xl mx-auto px-6 py-24 md:py-36">
        <Reveal className="text-center max-w-[760px] mx-auto mb-20 md:mb-28">
          <h2 className="text-[36px] md:text-[56px] font-semibold tracking-[-0.04em] text-navy-950 leading-[1.05]">Everything a scheduler does. Shown, not hidden.</h2>
          <p className="text-[18px] md:text-[20px] text-warm-600 mt-5 leading-snug">RunF9 does the repetitive parts of scheduling and shows its work, so you can review and defend the result.</p>
        </Reveal>
        <Pillars />
      </section>

      {/* The rest of the toolkit, without the noise */}
      <section className="bg-white border-y border-warm-200">
        <div className="max-w-6xl mx-auto px-6 py-24 md:py-32">
          <Reveal><h2 className="text-[32px] md:text-[44px] font-semibold tracking-[-0.035em] text-navy-950 leading-tight max-w-[640px]">Built by a scheduler, for everyone on the project.</h2></Reveal>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-12 mt-16">
            {[
              { icon: FileText, title: 'Native P6 and MS Project files', desc: 'Import .xer and .xml with activities, logic, lags, constraints and calendars, and export the same formats. Excel and PDF imports read activities and dates; a PDF carries no logic.' },
              { icon: Activity, title: 'Critical path and float', desc: 'Forward and backward CPM passes with calendars, holidays, lags and constraints. Total and free float for every activity.' },
              { icon: CheckCircle, title: 'DCMA 14-Point Assessment', desc: 'All 14 checks, with the published thresholds by default or your organization’s own.' },
              { icon: MessageSquare, title: 'An interview, not a blank page', desc: 'Questions are ranked by how far each answer can move your finish date.' },
              { icon: BarChart3, title: 'Risk and recovery', desc: 'Monte Carlo analysis (200 to 1,000 iterations of the full network) gives P50 and P80 finish dates; recovery options are priced from your labor cost.' },
              { icon: Shield, title: 'Ask AI, with limits', desc: 'Plain-English questions and narrative drafts with a version-pinned model (Anthropic Claude by default, OpenAI as an approved alternate) or one inside your own network. Calculated figures such as DCMA results come from the engine, not the model. AI can be switched off.' },
            ].map(({ icon: Icon, title, desc }, i) => (
              <Reveal key={title} delay={(i % 3) * 90}>
                <Icon size={26} strokeWidth={1.6} className="text-accent-600" aria-hidden />
                <h3 className="text-[18px] font-semibold text-navy-950 mt-4 tracking-[-0.01em]">{title}</h3>
                <p className="text-[15px] text-warm-600 leading-relaxed mt-2">{desc}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* How it works: four steps on one line that draws itself */}
      <section id="how-it-works" className="max-w-6xl mx-auto px-6 py-24 md:py-36">
        <Reveal className="text-center mb-16 md:mb-20">
          <h2 className="text-[36px] md:text-[56px] font-semibold tracking-[-0.04em] text-navy-950 leading-[1.05]">Four steps. One finish date you can defend.</h2>
        </Reveal>
        <Reveal className="steps relative">
          <div className="hidden md:block absolute left-[12.5%] right-[12.5%] top-[22px] h-[2px] bg-warm-200 overflow-hidden"><div className="steps-line h-full bg-accent-600" /></div>
          <ol className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-12 md:gap-8 relative">
            {[
              { title: 'Start', desc: 'Answer the interview, or upload a P6 (.xer), MS Project (.xml), Excel or PDF schedule.' },
              { title: 'Calculate', desc: 'The CPM engine computes dates, float and the critical path. This is arithmetic, not AI.' },
              { title: 'Check', desc: 'DCMA 14-Point checks, date logic and risk analysis, with the reason for every finding.' },
              { title: 'Deliver', desc: 'Export to P6, MS Project, Excel or PDF, with a Basis of Schedule narrative.' },
            ].map(({ title, desc }, i) => (
              <li key={title} className="text-center">
                <div className="step-dot mx-auto w-11 h-11 rounded-full bg-white border-2 border-accent-600 text-accent-600 font-semibold text-[16px] flex items-center justify-center" style={{ transitionDelay: `${300 + i * 250}ms` }}>{i + 1}</div>
                <div className="text-[19px] font-semibold text-navy-950 mt-5 tracking-[-0.01em]">{title}</div>
                <p className="text-[15px] text-warm-600 leading-relaxed mt-2 max-w-[240px] mx-auto">{desc}</p>
              </li>
            ))}
          </ol>
        </Reveal>
      </section>

      {/* Reports */}
      <section id="reports" className="bg-white border-y border-warm-200">
        <div className="max-w-6xl mx-auto px-6 py-24 md:py-28 grid md:grid-cols-[1fr_1.2fr] gap-12 md:gap-20 items-start">
          <Reveal>
            <h2 className="text-[32px] md:text-[44px] font-semibold tracking-[-0.035em] text-navy-950 leading-tight">Reports, drafted from your numbers.</h2>
            <p className="text-[16px] md:text-[17px] text-warm-600 leading-relaxed mt-4">Drafted by AI from your schedule’s calculated figures. Review them before you send them: the figures come from the schedule, the wording from the model.</p>
          </Reveal>
          <ul className="divide-y divide-warm-200 border-y border-warm-200">
            {[
              ['Executive Schedule Summary', 'Status, key dates, findings and recommendations in plain language.'],
              ['Critical Path Report', 'Driving activities, float and low-float paths from the CPM calculation.'],
              ['Baseline vs Current Variance', 'Compares current dates with the baseline stored in your P6 or MS Project file.'],
              ['Schedule QA/QC Report', 'The DCMA 14-Point results, with the issues and suggested fixes.'],
            ].map(([t, d], i) => (
              <Reveal as="li" key={t} delay={i * 80} className="py-5">
                <div className="text-[17px] font-semibold text-navy-950">{t}</div>
                <div className="text-[15px] text-warm-600 mt-1">{d}</div>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-6xl mx-auto px-6 py-24 md:py-36">
        <Reveal className="text-center mb-14 md:mb-16">
          <h2 className="text-[36px] md:text-[56px] font-semibold tracking-[-0.04em] text-navy-950 leading-[1.05]">Simple, transparent pricing.</h2>
          <p className="text-[17px] md:text-[19px] text-warm-600 mt-4">{inviteOnly ? 'RunF9 is in private beta: firms join by invitation. These are the plans we will offer.' : 'Start free. Upgrade when you need more.'}</p>
        </Reveal>
        <div className="grid md:grid-cols-3 gap-5 max-w-[1040px] mx-auto">
          {[
            { name: 'Free', price: '$0', per: '/month', blurb: 'For trying RunF9 on real projects.', yes: ['Up to 3 uploaded schedules', 'Unlimited interview-built schedules', 'Executive Summary report', '10 AI requests/day', 'Export to P6, MS Project & CSV', 'Roles, 2-step verification & audit log'], no: ['Critical Path, Variance & QA/QC reports', 'Export to PDF & Excel', 'API keys & webhooks'], cta: inviteOnly ? 'Request access' : 'Start free', href: primaryHref, featured: false },
            { name: 'Pro', price: '$49', per: '/month', blurb: 'For schedulers and consultants who need every report and export.', yes: ['Unlimited uploaded schedules', 'All 4 report types', 'Up to 1,000 AI requests/day', 'Export to P6, MS Project, PDF & Excel', 'Monte Carlo schedule risk analysis', 'API keys & signed webhooks', 'Roles, 2-step verification & audit log'], no: [], cta: inviteOnly ? 'Request access' : 'Start free, then upgrade', href: primaryHref, featured: true },
            { name: 'Enterprise', price: 'Custom', per: '', blurb: 'For organizations deploying across teams.', yes: ['Everything in Pro', 'Single sign-on (OpenID Connect)', 'Enforced 2-step & approval policies', 'On-premises / air-gapped deployment', 'Data export, retention & deletion controls', 'Support by email from the founder'], no: [], cta: 'Contact sales', href: 'mailto:support@hoshmand.ai', featured: false },
          ].map((p, i) => (
            <Reveal key={p.name} delay={i * 100} className={`rounded-[28px] p-8 bg-white border flex flex-col ${p.featured ? 'border-accent-600 shadow-[0_30px_60px_-30px_rgba(37,99,235,0.35)]' : 'border-warm-200'}`}>
              <div className="text-[15px] font-semibold text-navy-950">{p.name}</div>
              <div className="mt-3 text-[44px] font-semibold tracking-[-0.04em] text-navy-950 leading-none">{p.price}<span className="text-[16px] font-medium tracking-normal text-warm-600">{p.per}</span></div>
              <p className="text-[15px] text-warm-600 mt-3 mb-6">{p.blurb}</p>
              <ul className="space-y-3 mb-8 flex-1">
                {p.yes.map(f => <li key={f} className="flex items-start gap-2.5 text-[14.5px] text-warm-700"><CheckCircle size={17} className="text-accent-600 flex-shrink-0 mt-0.5" aria-hidden />{f}</li>)}
                {p.no.map(f => <li key={f} className="flex items-start gap-2.5 text-[14.5px] text-warm-600"><span aria-hidden="true" className="w-[17px] text-center">—</span><span className="line-through decoration-warm-300">{f}</span><span className="sr-only">(not included)</span></li>)}
              </ul>
              <Cta href={p.href} className={p.featured ? `${primaryBtn} py-3 text-[15px]` : `pressable inline-flex items-center justify-center rounded-full border border-warm-300 text-navy-950 font-semibold py-3 text-[15px] hover:bg-warm-100 transition-colors`}>{p.cta}</Cta>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Evidence: how each figure on this page can be checked */}
      <section id="evidence" className="max-w-[860px] mx-auto px-6 pb-24 md:pb-32">
        <Reveal>
          <h2 className="text-[28px] md:text-[36px] font-semibold tracking-[-0.03em] text-navy-950">Where these numbers come from</h2>
          <p className="text-[16px] text-warm-600 mt-3 mb-8">Every figure on this page is reproducible. Customers and auditors can ask us to run the tests below in front of them.</p>
        </Reveal>
        <div className="border-t border-warm-200">
          {[
            ['14 of 14 DCMA checks', 'All fourteen checks of the DCMA 14-Point Assessment are implemented, each with a unit test that makes it pass and fail. Checks that need data a file doesn’t have (for example baselines) are reported as not applicable, never as passed.'],
            ['100,000 activities', 'An automated performance test schedules synthetic networks of 10,000, 50,000 and 100,000 activities, with mixed relationship types, lags and two calendars, on every code change. It measures the CPM calculation, not file upload.'],
            ['0 days after a round trip', 'Five test schedules (different calendars, delivery methods and a required finish) are exported to P6 XER and MS Project XML, imported back and re-scheduled from scratch. Every activity’s early start, early finish and total float must match exactly. This proves RunF9’s files keep the logic intact; a side-by-side comparison with P6 and MS Project calculating the same reference projects is planned and will be published here.'],
            inviteOnly
              ? ['Private beta', 'RunF9 is in a private beta. New firms join with an invitation, and members join through their organization’s admin. Plan limits are listed in the pricing table and enforced by the server.']
              : ['$0 to start', 'The Free plan has no time limit and asks for no payment details. Plan limits are listed in the pricing table and enforced by the server.'],
          ].map(([term, def]) => (
            <details key={term} className="group border-b border-warm-200">
              <summary className="flex items-center justify-between gap-4 py-5 cursor-pointer list-none text-[17px] font-semibold text-navy-950">
                {term}
                <ChevronDown size={20} className="text-warm-600 transition-transform duration-300 group-open:rotate-180 flex-shrink-0" aria-hidden />
              </summary>
              <p className="text-[15px] text-warm-600 leading-relaxed pb-6 -mt-1">{def}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Closing call to action */}
      <section className="px-6 pb-24 md:pb-32">
        <Reveal className="max-w-6xl mx-auto rounded-[36px] bg-navy-950 px-8 py-20 md:py-28 text-center relative overflow-hidden">
          <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(59,130,246,0.28),transparent_60%)]" />
          <div className="relative">
            <h2 className="text-[36px] md:text-[60px] font-semibold tracking-[-0.045em] text-white leading-[1.04]">Use RunF9 in Your Next Schedule</h2>
            <p className="text-[17px] md:text-[20px] text-[#C7D2E3] mt-5 max-w-[620px] mx-auto">Start with the interview, or upload a P6 or MS Project file and see the DCMA 14-Point results in seconds.</p>
            <Cta href={primaryHref} className={`${primaryBtn} mt-10 px-8 py-4 text-[17px]`}>{inviteOnly ? 'Request access' : 'Get started free'}</Cta>
            <p className="text-[14px] text-[#C7D2E3] mt-5">{inviteOnly ? <>Private beta · by invitation. Already invited? <Link href="/auth" className="underline text-white">Sign in</Link>.</> : 'No credit card required.'}</p>
          </div>
        </Reveal>
      </section>

      {/* Footer */}
      <footer className="border-t border-warm-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-14 grid grid-cols-2 md:grid-cols-[1.4fr_1fr_1fr_1fr] gap-10">
          <div className="col-span-2 md:col-span-1">
            <Logo variant="dark" size="text-[22px]" />
            <p className="text-[14px] text-warm-600 mt-4 max-w-[280px] leading-relaxed">Construction scheduling, explained. Built by Hoshmand AI, founded by a construction scheduling consultant with 13 years in the field.</p>
          </div>
          <div>
            <div className="text-[13px] font-semibold text-navy-950 mb-3">Product</div>
            {nav.map(([href, label]) => <a key={href} href={href} className="block text-[14px] text-warm-600 py-1.5 hover:text-navy-950 transition-colors">{label}</a>)}
          </div>
          <div>
            <div className="text-[13px] font-semibold text-navy-950 mb-3">Company</div>
            <a href="https://www.hoshmand.ai" className="block text-[14px] text-warm-600 py-1.5 hover:text-navy-950 transition-colors">Hoshmand AI</a>
            <a href="mailto:support@hoshmand.ai" className="block text-[14px] text-warm-600 py-1.5 hover:text-navy-950 transition-colors">Contact</a>
          </div>
          <div>
            <div className="text-[13px] font-semibold text-navy-950 mb-3">Legal</div>
            <Link href="/privacy" className="block text-[14px] text-warm-600 py-1.5 hover:text-navy-950 transition-colors">Privacy Policy</Link>
            <Link href="/terms" className="block text-[14px] text-warm-600 py-1.5 hover:text-navy-950 transition-colors">Terms of Service</Link>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-6 pb-8 text-[13px] text-warm-600">© 2026 RunF9. Built by Hoshmand AI. All rights reserved.</div>
      </footer>
    </div>
  )
}
