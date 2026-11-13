'use client'

import Link from 'next/link'
import { CheckCircle, Menu, X, ChevronDown } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Logo } from '@/components/Logo'
import F9Demo from '@/components/landing/F9Demo'
import Pillars from '@/components/landing/Pillars'
import Deployment from '@/components/landing/Deployment'
import { UpdatesAndDelays } from '@/components/landing/UpdatesAndDelays'
import { CountUp, Reveal } from '@/components/landing/motion'
import { DailyBrief, Audiences, Integrations, Security, Faq, Shot } from '@/components/landing/Sections'

/** A call to action: a mailto link (request access) or an in-app link. */
function Cta({ href, className, children }: { href: string; className: string; children: React.ReactNode }) {
  return href.startsWith('mailto:') ? <a href={href} className={className}>{children}</a> : <Link href={href} className={className}>{children}</Link>
}

const footLink = 'block text-[14px] text-warm-600 py-1.5 hover:text-navy-950 transition-colors'
const primaryBtn = 'pressable inline-flex items-center justify-center rounded-full bg-accent-600 text-white font-semibold hover:bg-accent-700 transition-colors'
const secondaryBtn = 'pressable inline-flex items-center justify-center rounded-full text-accent-600 font-semibold hover:bg-accent-100 transition-colors'

/**
 * Marketing page. While RunF9 is in private beta (RUNF9_SIGNUP not "open") the sign-up calls to
 * action become "Request access" / "Sign in" and the page says access is by invitation.
 */
// Hero chips: id matches an option in src/components/landing/Deployment.tsx.
const DEPLOY_CHIPS: [string, string][] = [['cloud', 'RunF9 Cloud'], ['aws', 'AWS'], ['azure', 'Microsoft Azure'], ['gcp', 'Google Cloud'], ['mixed', 'A different cloud per client'], ['onprem', 'Your servers']]

export default function Landing({ inviteOnly, accessRequestEmail }: { inviteOnly: boolean; accessRequestEmail: string | null }) {
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])
  const [scrolled, setScrolled] = useState(false)
  // Request access: email the beta team (RUNF9_ACCESS_REQUEST_EMAIL, else the support address this page
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

  const nav = [['#today', 'Daily Brief'], ['#features', 'Features'], ['#deployment', 'Your cloud'], ['#security', 'Security'], ['#pricing', 'Pricing'], ['#faq', 'FAQ']]
  const contactHref = `mailto:${accessRequestEmail || 'support@hoshmand.ai'}?subject=${encodeURIComponent('RunF9 security documents')}`

  return (
    <div className="min-h-screen bg-warm-50 text-warm-600">
      {/* Navbar: translucent, quiet, the logo carries it */}
      <nav className={`sticky top-0 z-50 transition-[background-color,border-color] duration-300 border-b ${scrolled || menuOpen ? 'bg-white/80 backdrop-blur-xl border-warm-200' : 'bg-warm-50 border-transparent'}`}>
        <div className="max-w-6xl mx-auto px-6 h-[72px] flex items-center justify-between">
          <Link href="/" aria-label="RunF9 home" className="flex items-center">
            <Logo variant="dark" size="text-[26px]" />
          </Link>
          <div className="hidden lg:flex items-center gap-7 xl:gap-9 whitespace-nowrap">
            {nav.map(([href, label]) => <a key={href} href={href} className="text-[14px] text-warm-700 hover:text-navy-950 transition-colors">{label}</a>)}
          </div>
          <div className="hidden lg:flex items-center gap-2 whitespace-nowrap">
            <Link href="/auth" className={`${secondaryBtn} px-4 py-2 text-[14px]`}>Sign in</Link>
            <Cta href={primaryHref} className={`${primaryBtn} px-5 py-2 text-[14px]`}>{primaryLabel}</Cta>
          </div>
          <button className="lg:hidden text-navy-950 p-2 -mr-2" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen}>
            {menuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
        {menuOpen && (
          <div className="lg:hidden px-6 pb-6 pt-2">
            {nav.map(([href, label]) => <a key={href} href={href} className="block py-3 text-[17px] text-navy-950 border-b border-warm-200" onClick={() => setMenuOpen(false)}>{label}</a>)}
            <Link href="/auth" className="block py-3 text-[17px] text-navy-950 border-b border-warm-200">Sign in</Link>
            <Cta href={primaryHref} className={`${primaryBtn} w-full mt-5 py-3 text-[16px]`}>{primaryLabel}</Cta>
          </div>
        )}
      </nav>

      {/* Hero */}
      <header className="relative px-6 pt-8 md:pt-10 pb-20 md:pb-28 overflow-hidden">
        {/* A soft wash of the accent behind the headline; decorative */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[620px] bg-[radial-gradient(ellipse_70%_60%_at_50%_0%,rgba(37,99,235,0.12),transparent_70%)]" />
        <div className="relative max-w-6xl mx-auto text-center">
          <a href={inviteOnly ? '#pricing' : '#today'} className="hero-rise pressable inline-flex items-center gap-2 rounded-full border border-warm-300 bg-white px-3.5 py-1.5 text-[13.5px] font-medium text-navy-950 hover:border-navy-900 mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-600" aria-hidden />
            {inviteOnly ? 'Private beta · by invitation' : 'New: the Daily Brief'}
          </a>
          <h1 className="hero-rise text-[42px] leading-[1.05] md:text-[66px] font-semibold tracking-[-0.045em] text-navy-950 max-w-[900px] mx-auto">
            Construction schedules, calculated and explained.
          </h1>
          <p className="hero-rise [animation-delay:120ms] text-[18px] md:text-[21px] leading-snug text-warm-700 max-w-[820px] mx-auto mt-4 tracking-[-0.01em]">
            Upload a P6 or MS Project schedule, or build one from a short interview. RunF9 checks it, compares every update, models delays and briefs your team every morning.
          </p>
          <div className="hero-rise [animation-delay:220ms] flex gap-3 justify-center flex-wrap mt-6">
            <Cta href={primaryHref} className={`${primaryBtn} px-7 py-3.5 text-[16px]`}>{primaryLabel}</Cta>
            <a href="#today" className={`${secondaryBtn} px-7 py-3.5 text-[16px]`}>See the Daily Brief</a>
          </div>
        </div>
        <div className="relative hero-rise [animation-delay:320ms] max-w-[1100px] mx-auto mt-9 md:mt-10">
          <Shot eager name="overview" label="RunF9 · Overview" alt="The Overview page in RunF9 for a sample 60 MW data center: the finish is forecast 40 days after the required date, the project is 81% complete, 14 activities are critical and 10 of 14 quality checks pass." />
        </div>
        {/* Where it runs: each name opens that option in "Run it where your data lives" */}
        <nav aria-label="Where RunF9 runs" className="relative mt-8 flex flex-wrap items-center justify-center gap-x-2 gap-y-2 text-[14.5px] text-warm-700">
          <span className="mr-1">Runs where your data lives:</span>
          {DEPLOY_CHIPS.map(([id, label]) => (
            <a key={id} href={`#deployment-${id}`} className="pressable rounded-full border border-warm-300 bg-white px-3.5 py-1.5 font-medium text-navy-950 hover:border-navy-900">{label}</a>
          ))}
        </nav>
      </header>

      {/* Facts: each figure is backed by an automated test or the product's own limits (see "Where these numbers come from") */}
      <section aria-label="RunF9 in numbers" className="border-y border-warm-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-16 grid grid-cols-2 md:grid-cols-4 gap-y-12 gap-x-6 text-center">
          {[
            [<>14 of 14</>, 'DCMA 14-Point checks, run automatically'],
            [<CountUp key="n" value={100000} />, 'activities scheduled by our CPM engine in automated tests'],
            [<>0 days</>, 'of drift in dates and float when our P6 and MS Project exports are re-imported, in our test set'],
            inviteOnly ? [<>3 briefs</>, 'every morning: project manager, field and client'] : [<>$0</>, 'to start. No credit card'],
          ].map(([value, label], i) => (
            <Reveal key={String(label)} delay={i * 90}>
              <div className="text-[32px] min-[360px]:text-[40px] md:text-[48px] font-semibold tracking-[-0.04em] text-navy-950 tabular-nums leading-none">{value}</div>
              <div className="text-[15px] text-warm-700 mt-3 leading-snug max-w-[220px] mx-auto">{label}</div>
            </Reveal>
          ))}
        </div>
        <div className="text-center pb-10 -mt-4"><a href="#evidence" className="text-[15px] font-medium text-accent-700 underline underline-offset-4">Where these numbers come from</a></div>
      </section>

      {/* The Daily Brief, shown as product */}
      <DailyBrief />

      {/* Build. Check. Forecast. */}
      <section id="features" className="max-w-6xl mx-auto px-6 py-24 md:py-36 scroll-mt-12">
        <Reveal className="text-center max-w-[760px] mx-auto mb-20 md:mb-28">
          <h2 className="text-[36px] md:text-[56px] font-semibold tracking-[-0.04em] text-navy-950 leading-[1.05]">Everything a scheduler does. Shown, not hidden.</h2>
          <p className="text-[18px] md:text-[20px] text-warm-600 mt-5 leading-snug">RunF9 does the repetitive parts of scheduling and shows its work, so you can review and defend the result.</p>
        </Reveal>
        <Pillars />
      </section>

      {/* After the baseline: monthly update comparison and Time Impact Analysis */}
      <UpdatesAndDelays />

      {/* Who it is for */}
      <Audiences />

      {/* How it works: the four steps beside the F9 demo */}
      <section id="how-it-works" className="max-w-6xl mx-auto px-6 py-24 md:py-36 scroll-mt-12">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <Reveal>
            <h2 className="text-[36px] md:text-[52px] font-semibold tracking-[-0.04em] text-navy-950 leading-[1.05]">Press F9. Get a finish date you can defend.</h2>
            <ol className="mt-8 space-y-6">
              {[
                { title: 'Start', desc: 'Answer the interview, or upload a P6 (.xer), MS Project (.xml), Excel or PDF schedule.' },
                { title: 'Calculate', desc: 'The CPM engine computes dates, float and the critical path. This is arithmetic, not AI.' },
                { title: 'Check', desc: 'DCMA 14-Point checks, date logic and risk analysis, with the reason for every finding.' },
                { title: 'Deliver', desc: 'Export to P6, MS Project, Excel or PDF, with a Basis of Schedule narrative. Then compare each update and model delays.' },
              ].map(({ title, desc }, i) => (
                <li key={title} className="flex gap-4">
                  <span aria-hidden className="flex-shrink-0 w-9 h-9 rounded-full bg-accent-600 text-white font-semibold text-[15px] flex items-center justify-center">{i + 1}</span>
                  <div>
                    <div className="text-[18px] font-semibold text-navy-950 tracking-[-0.01em]">{title}</div>
                    <p className="text-[16px] text-warm-700 leading-relaxed mt-1">{desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Reveal>
          <Reveal><F9Demo /></Reveal>
        </div>
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
              ['Critical & Near-Critical Paths', 'Driving activities, float and low-float paths from the CPM calculation.'],
              ['Baseline vs Current Variance', 'Compares current dates with the baseline stored in your P6 or MS Project file.'],
              ['Schedule QA/QC Audit', 'The DCMA 14-Point results, with the issues and suggested fixes.'],
              ['Time Impact Analysis', 'The delay event, its fragnet, the impact on each milestone and the driving path before and after, with input and result hashes.'],
            ].map(([t, d], i) => (
              <Reveal as="li" key={t} delay={i * 80} className="py-5">
                <div className="text-[17px] font-semibold text-navy-950">{t}</div>
                <div className="text-[15px] text-warm-600 mt-1">{d}</div>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      {/* What it connects to */}
      <Integrations />

      {/* Choose the cloud: RunF9 Cloud, the firm's own AWS / Azure / Google account, a different cloud per client, or air-gapped */}
      <Deployment primaryHref={primaryHref} primaryLabel={primaryLabel} />

      <Security contactHref={contactHref} />

      {/* Pricing */}
      <section id="pricing" className="max-w-6xl mx-auto px-6 py-24 md:py-36 scroll-mt-12">
        <Reveal className="text-center mb-14 md:mb-16">
          <h2 className="text-[36px] md:text-[56px] font-semibold tracking-[-0.04em] text-navy-950 leading-[1.05]">Simple, transparent pricing.</h2>
          <p className="text-[17px] md:text-[19px] text-warm-600 mt-4">{inviteOnly ? 'RunF9 is in private beta: firms join by invitation. These are the plans we will offer.' : 'Start free. Upgrade when you need more.'}</p>
        </Reveal>
        <div className="grid md:grid-cols-3 gap-5 max-w-[1040px] mx-auto">
          {[
            { name: 'Free', price: '$0', per: '/month', blurb: 'For trying RunF9 on real projects.', yes: ['Up to 3 uploaded schedules', 'Unlimited interview-built schedules', 'Executive Summary report', '10 AI requests/day', 'Export to P6, MS Project & CSV', 'Roles, 2-step verification & audit log'], no: ['Critical Path, Variance & QA/QC reports', 'Export to PDF & Excel', 'API keys & webhooks'], cta: inviteOnly ? 'Request access' : 'Start free', href: primaryHref, featured: false },
            { name: 'Pro', price: '$49', per: '/month', blurb: 'For schedulers and consultants who need every report and export.', yes: ['Unlimited uploaded schedules', 'All report types', 'Up to 1,000 AI requests/day', 'Export to P6, MS Project, PDF & Excel', 'Monte Carlo schedule risk analysis', 'API keys & signed webhooks', 'Roles, 2-step verification & audit log'], no: [], cta: inviteOnly ? 'Request access' : 'Start free, then upgrade', href: primaryHref, featured: true },
            { name: 'Enterprise', price: 'Custom', per: '', blurb: 'For organizations deploying across teams.', yes: ['Everything in Pro', 'Single sign-on (SAML, OpenID Connect) and SCIM', 'Enforced 2-step & approval policies', 'Deploy in your AWS, Azure or Google Cloud account, or air-gapped', 'Data export, retention & deletion controls', 'Support by email from the founder'], no: [], cta: 'Contact sales', href: 'mailto:support@hoshmand.ai', featured: false },
          ].map((p, i) => (
            <Reveal key={p.name} delay={i * 100} className={`rounded-[28px] p-8 bg-white border flex flex-col ${p.featured ? 'border-accent-600 shadow-[0_30px_60px_-30px_rgba(37,99,235,0.35)]' : 'border-warm-200'}`}>
              <div className="text-[15px] font-semibold text-navy-950">{p.name}</div>
              <div className="mt-3 text-[44px] font-semibold tracking-[-0.04em] text-navy-950 leading-none">{p.price}<span className="text-[16px] font-medium tracking-normal text-warm-600">{p.per}</span></div>
              <p className="text-[15px] text-warm-600 mt-3 mb-6">{p.blurb}</p>
              <ul className="space-y-3 mb-8 flex-1">
                {p.yes.map(f => <li key={f} className="flex items-start gap-2.5 text-[15.5px] text-warm-700"><CheckCircle size={17} className="text-accent-600 flex-shrink-0 mt-0.5" aria-hidden />{f}</li>)}
                {p.no.length > 0 && <li className="pt-3 text-[13px] font-semibold uppercase tracking-wider text-warm-600">Not included</li>}
                {p.no.map(f => <li key={f} className="flex items-start gap-2.5 text-[15.5px] text-warm-600"><X size={17} className="flex-shrink-0 mt-0.5" aria-hidden />{f}</li>)}
              </ul>
              <Cta href={p.href} className={p.featured ? `${primaryBtn} px-4 py-3 text-[15px] text-center` : `pressable inline-flex items-center justify-center rounded-full border border-warm-300 text-navy-950 font-semibold px-4 py-3 text-[15px] text-center hover:bg-warm-100 transition-colors`}>{p.cta}</Cta>
            </Reveal>
          ))}
        </div>
      </section>

      <Faq />

      {/* Evidence: how each figure on this page can be checked */}
      <section id="evidence" className="max-w-[860px] mx-auto px-6 pb-24 md:pb-32 scroll-mt-24">
        <Reveal className="text-center">
          <h2 className="text-[28px] md:text-[36px] font-semibold tracking-[-0.03em] text-navy-950">Where these numbers come from</h2>
          <p className="text-[16px] text-warm-700 mt-3 mb-8">Every figure on this page is reproducible. Customers and auditors can ask us to run the tests below in front of them.</p>
        </Reveal>
        <div className="border-t border-warm-200">
          {[
            ['14 of 14 DCMA checks', 'All fourteen checks of the DCMA 14-Point Assessment are implemented, each with a unit test that makes it pass and fail. Checks that need data a file doesn’t have (for example baselines) are reported as not applicable, never as passed.'],
            ['100,000 activities', 'An automated performance test schedules synthetic networks of 10,000, 50,000 and 100,000 activities, with mixed relationship types, lags and two calendars, on every code change. It measures the CPM calculation, not file upload.'],
            ['0 days after a round trip', 'Five test schedules (different calendars, delivery methods and a required finish) are exported to P6 XER and MS Project XML, imported back and re-scheduled from scratch. Every activity’s early start, early finish and total float must match exactly. This proves RunF9’s files keep the logic intact; a side-by-side comparison with P6 and MS Project calculating the same reference projects is planned and will be published here.'],
            inviteOnly
              ? ['3 briefs every morning', 'The Daily Brief is written three ways from the same calculation: for the project manager, for the field and for the client. The client version leaves out internal risk wording. An automated test checks all three on every code change.']
              : ['$0 to start', 'The Free plan has no time limit and asks for no payment details. Plan limits are listed in the pricing table and enforced by the server.'],
          ].map(([term, def]) => (
            <details key={term} className="group border-b border-warm-200">
              <summary className="flex items-center justify-between gap-4 py-5 cursor-pointer list-none text-[17px] font-semibold text-navy-950">
                {term}
                <ChevronDown size={20} className="text-warm-600 transition-transform duration-300 group-open:rotate-180 flex-shrink-0" aria-hidden />
              </summary>
              <p className="text-[16px] text-warm-700 leading-relaxed pb-6 -mt-1">{def}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Closing call to action */}
      <section className="px-6 pb-24 md:pb-32">
        <Reveal className="max-w-6xl mx-auto rounded-[36px] bg-navy-950 px-8 py-20 md:py-28 text-center relative overflow-hidden">
          <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(59,130,246,0.28),transparent_60%)]" />
          <div className="relative">
            <h2 className="text-[36px] md:text-[60px] font-semibold tracking-[-0.045em] text-white leading-[1.04]">Use RunF9 on your next schedule</h2>
            <p className="text-[17px] md:text-[20px] text-navy-200 mt-5 max-w-[620px] mx-auto">Start with the interview, or upload a P6 or MS Project file and see the DCMA 14-Point results in seconds.</p>
            <Cta href={primaryHref} className={`${primaryBtn} mt-10 px-8 py-4 text-[17px]`}>{inviteOnly ? 'Request access' : 'Get started free'}</Cta>
            <p className="text-[14px] text-navy-200 mt-5">{inviteOnly ? <>Private beta · by invitation. Already invited? <Link href="/auth" className="underline text-white">Sign in</Link>.</> : 'No credit card required.'}</p>
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
            {[['#today', 'Daily Brief'], ['#features', 'Features'], ['#updates', 'Updates & delays'], ['#how-it-works', 'How it works'], ['#reports', 'Reports'], ['#integrations', 'Integrations'], ['#pricing', 'Pricing']].map(([href, label]) => <a key={href} href={href} className={footLink}>{label}</a>)}
          </div>
          <div>
            <div className="text-[13px] font-semibold text-navy-950 mb-3">Trust</div>
            {[['#deployment', 'Your cloud'], ['#security', 'Security'], ['#evidence', 'Evidence'], ['#faq', 'FAQ']].map(([href, label]) => <a key={href} href={href} className={footLink}>{label}</a>)}
          </div>
          <div>
            <div className="text-[13px] font-semibold text-navy-950 mb-3">Company</div>
            <a href="https://www.hoshmand.ai" className={footLink}>Hoshmand AI</a>
            <a href="mailto:support@hoshmand.ai" className={footLink}>Contact</a>
            <Link href="/auth" className={footLink}>Sign in</Link>
            <div className="text-[13px] font-semibold text-navy-950 mb-3 mt-6">Legal</div>
            <Link href="/privacy" className={footLink}>Privacy Policy</Link>
            <Link href="/terms" className={footLink}>Terms of Service</Link>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-6 pb-8 text-[13px] text-warm-600">© 2026 RunF9. Built by Hoshmand AI. All rights reserved.</div>
      </footer>
    </div>
  )
}
