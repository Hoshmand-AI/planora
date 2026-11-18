'use client'

import Link from 'next/link'
import { ArrowRight, CheckCircle, Menu, X, ChevronDown } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Logo } from '@/components/Logo'
import HeroSchedule from '@/components/landing/HeroSchedule'
import Pillars from '@/components/landing/Pillars'
import Deployment from '@/components/landing/Deployment'
import { UpdatesAndDelays } from '@/components/landing/UpdatesAndDelays'
import { CountUp, Reveal } from '@/components/landing/motion'
import { DailyBrief, Proof, Audiences, Integrations, Security, Faq, Shot } from '@/components/landing/Sections'

/** A call to action: a mailto link (request access) or an in-app link. */
function Cta({ href, className, children }: { href: string; className: string; children: React.ReactNode }) {
  return href.startsWith('mailto:') ? <a href={href} className={className}>{children}</a> : <Link href={href} className={className}>{children}</Link>
}

const footLink = 'block text-small text-warm-600 py-1.5 hover:text-ink transition-colors'
const primaryBtn = 'pressable inline-flex items-center justify-center rounded-full bg-accent-600 text-white font-semibold hover:bg-accent-700 transition-colors'
const secondaryBtn = 'pressable inline-flex items-center justify-center rounded-full text-accent-600 font-semibold hover:bg-accent-100 transition-colors'

/**
 * Marketing page. While RunF9 is in private beta (RUNF9_SIGNUP not "open") the sign-up calls to
 * action become "Request access" / "Sign in" and the page says access is by invitation.
 */

export default function Landing({ inviteOnly, accessRequestEmail }: { inviteOnly: boolean; accessRequestEmail: string | null }) {
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])
  const [scrolled, setScrolled] = useState(false)
  // The evidence list is folded under the numbers; a link to #evidence from anywhere on the page opens it.
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  useEffect(() => {
    const sync = () => { if (window.location.hash === '#evidence') setEvidenceOpen(true) }
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])
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
  const questionHref = `mailto:${accessRequestEmail || 'support@hoshmand.ai'}?subject=${encodeURIComponent('RunF9 question')}`
  const demoHref = `mailto:${accessRequestEmail || 'support@hoshmand.ai'}?subject=${encodeURIComponent('RunF9 demo request')}`
  const contactHref = `mailto:${accessRequestEmail || 'support@hoshmand.ai'}?subject=${encodeURIComponent('RunF9 security documents')}`

  return (
    <div className="min-h-screen bg-warm-50 text-warm-600">
      {/* Navbar: translucent, quiet, the logo carries it */}
      <nav className={`sticky top-0 z-50 transition-[background-color,border-color] duration-300 border-b ${scrolled || menuOpen ? 'bg-white border-warm-200' : 'bg-warm-50 border-transparent'}`}>
        <div className="max-w-[1240px] mx-auto px-6 h-[76px] md:h-[84px] flex items-center justify-between">
          <Link href="/" aria-label="RunF9 home" className="flex items-center">
            <Logo variant="dark" size="h-[36px]" />
          </Link>
          <div className="hidden lg:flex items-center gap-7 xl:gap-9 whitespace-nowrap">
            {nav.map(([href, label]) => <a key={href} href={href} className="text-small font-medium text-ink hover:text-accent-700 transition-colors">{label}</a>)}
          </div>
          <div className="hidden lg:flex items-center gap-2 whitespace-nowrap">
            <Link href="/auth" className={`${secondaryBtn} px-4 py-2.5 text-small`}>Sign in</Link>
            <Cta href={primaryHref} className={`${primaryBtn} gap-1.5 px-5 py-2.5 text-small`}>{primaryLabel}<ArrowRight size={16} aria-hidden /></Cta>
          </div>
          <button className="lg:hidden text-ink p-2 -mr-2" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen}>
            {menuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
        {menuOpen && (
          <div className="lg:hidden px-6 pb-6 pt-2">
            {nav.map(([href, label]) => <a key={href} href={href} className="block py-3 text-copy text-ink border-b border-warm-200" onClick={() => setMenuOpen(false)}>{label}</a>)}
            <Link href="/auth" className="block py-3 text-copy text-ink border-b border-warm-200">Sign in</Link>
            <Cta href={primaryHref} className={`${primaryBtn} w-full mt-5 py-3 text-copy`}>{primaryLabel}</Cta>
          </div>
        )}
      </nav>

      {/* Hero: one large statement on the left, the reason and one action on the right, then the product itself */}
      <header className="relative pt-8 md:pt-10 pb-20 md:pb-28 overflow-hidden">
        {/* A soft wash of the accent behind the headline; decorative */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[720px] bg-[radial-gradient(ellipse_60%_55%_at_20%_0%,rgba(37,99,235,0.10),transparent_70%)]" />
        <div className="relative max-w-[1240px] mx-auto px-6">
          <h1 className="hero-rise text-h1 leading-[1.05] md:text-display md:leading-[1.02] font-bold tracking-[-0.03em] md:tracking-[-0.04em] text-ink max-w-[1150px]">
            Construction schedules, analyzed and explained.
          </h1>
          <div className="hero-rise [animation-delay:140ms] mt-7 md:mt-9">
            <span aria-hidden className="block h-[3px] w-24 rounded-full bg-accent-600 mb-5" />
            <p className="text-lead leading-[1.45] text-warm-700 tracking-[-0.01em] max-w-[760px]">
              Upload a schedule from P6 or MS Project, or one kept in Excel, PDF, Word or PowerPoint, or build one from a short interview. RunF9 checks it, compares every update, models delays and briefs your team every morning.
            </p>
          </div>
        </div>
        <div className="relative hero-rise [animation-delay:320ms] max-w-[1240px] mx-auto px-6 mt-10 md:mt-12">
          <HeroSchedule />
        </div>
      </header>

      {/* Facts: each figure is backed by an automated test or the product's own limits (see "Where these numbers come from") */}
      <section aria-label="RunF9 in numbers" className="border-y border-warm-200 bg-white">
        <div className="max-w-[1240px] mx-auto px-6 py-16 grid grid-cols-2 md:grid-cols-4 gap-y-12 gap-x-6 text-center">
          {[
            [<>4 check sets</>, 'all 14 DCMA 14-Point checks on every schedule, and checks drawn from the GAO guide, USACE UFGS 01 32 01.00 10 and the PMI scheduling standard in the Standards view'],
            [<CountUp key="n" value={100000} />, 'activities scheduled by our CPM engine in automated tests'],
            [<>0 days</>, 'of drift after a P6 or MS Project round trip, in our test set'],
            inviteOnly ? [<>2,300+</>, 'automated tests run on every change to RunF9'] : [<>$0</>, 'to start. No credit card'],
          ].map(([value, label], i) => (
            <Reveal key={String(label)} delay={i * 90}>
              <div className="text-h2 font-semibold tracking-[-0.02em] text-ink tabular-nums leading-none">{value}</div>
              <div className="text-small text-warm-700 mt-2 leading-snug max-w-[220px] mx-auto">{label}</div>
            </Reveal>
          ))}
        </div>
        {/* How each figure can be checked: folded under the figures it explains (it was a section of its own near the foot of the page). */}
        <div id="evidence" className="max-w-[860px] mx-auto px-6 pb-10 -mt-4 scroll-mt-24">
          <div className="text-center">
            <button type="button" aria-expanded={evidenceOpen} aria-controls="evidence-panel" onClick={() => setEvidenceOpen(v => !v)}
              className="pressable inline-flex items-center gap-1.5 text-small font-medium text-accent-700 underline underline-offset-4">
              Where these numbers come from<ChevronDown size={16} aria-hidden className={`transition-transform duration-300 ${evidenceOpen ? 'rotate-180' : ''}`} />
            </button>
          </div>
          <div id="evidence-panel" hidden={!evidenceOpen} className="mt-6 text-left">
            <p className="text-copy text-warm-700 mb-6 text-center">Every figure on this page is reproducible. Customers and auditors can ask us to run the tests below in front of them.</p>
            <div className="border-t border-warm-200">
              {[
                ['DCMA, GAO, USACE and PMI checks', 'Every schedule is run through all fourteen metrics of the DCMA 14-Point Assessment when it is uploaded, and the Standards view adds checks drawn from the ten best practices of the GAO Schedule Assessment Guide (GAO-16-89G). It can also run, each on its own, a set of checks drawn from the U.S. Army Corps of Engineers guide specification UFGS 01 32 01.00 10 (Project Schedule) and a set drawn from section 3.4 of the PMI Practice Standard for Scheduling; these cover part of each document, not all of it. Each finding names its source and the limit it was measured against, and each check has a unit test that makes it pass and fail. A check that needs data the file does not have (a baseline, for example) is reported as not applicable, never as passed. Time impact analysis follows AACE International Recommended Practice 52R-06, and the earned value checks are oriented to ANSI/EIA-748. Results are indicators for a scheduler’s review, not a determination of contract compliance. RunF9 is not affiliated with or endorsed by DCMA, GAO, the U.S. Army Corps of Engineers, PMI, AACE International or any other body named here.'],
                ['100,000 activities', 'An automated performance test schedules synthetic networks of 10,000, 50,000 and 100,000 activities, with mixed relationship types, lags and two calendars, on every code change. It measures the CPM calculation, not file upload.'],
                ['0 days after a round trip', 'Five test schedules (different calendars, delivery methods and a required finish) are exported to P6 XER and MS Project XML, imported back and re-scheduled from scratch. Every activity’s early start, early finish and total float must match exactly. This proves RunF9’s files keep the logic intact; a side-by-side comparison with P6 and MS Project calculating the same reference projects is planned and will be published here.'],
                inviteOnly
                  ? ['2,300+ automated tests', 'RunF9 has more than 2,300 automated tests, covering the scheduling engine, the checks, the file formats, security and tenant separation. They all run on every code change, together with end-to-end suites against a live server, and a change that fails any of them is not released.']
                  : ['$0 to start', 'Signing up is open on this deployment and asks for no payment details. A new organization starts free, with no time limit: up to 3 uploaded schedules, unlimited interview-built schedules, the Executive Summary report, 10 AI requests a day and export to P6, MS Project and CSV. The other reports, PDF and Excel export, Monte Carlo risk analysis, API keys and single sign-on come with a license. The server enforces these limits.'],
              ].map(([term, def], i) => (
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
      </section>

      <Proof />

      {/* The Daily Brief, shown as product */}
      <DailyBrief />

      {/* Build. Check. Forecast. */}
      <section id="features" className="max-w-[1240px] mx-auto px-6 py-16 md:py-24 scroll-mt-12">
        <Reveal className="text-center max-w-[760px] mx-auto mb-20 md:mb-28">
          <h2 className="text-h2 md:text-h1 font-bold tracking-[-0.02em] md:tracking-[-0.03em] text-ink leading-[1.1]">Everything a scheduler does. Shown, not hidden.</h2>
          <p className="text-lead text-warm-600 mt-4 leading-snug">RunF9 does the repetitive parts of scheduling and shows its work, so you can review and defend the result.</p>
        </Reveal>
        <Pillars />
      </section>

      {/* After the baseline: monthly update comparison and Time Impact Analysis */}
      <UpdatesAndDelays />

      {/* Who it is for */}
      <Audiences />

      {/* Reports */}
      <section id="reports" className="bg-white border-y border-warm-200 scroll-mt-12">
        <div className="max-w-[1240px] mx-auto px-6 py-16 md:py-24 grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-10 lg:gap-16 items-center">
          <Reveal>
            <h2 className="text-h2 md:text-h1 font-semibold tracking-[-0.02em] md:tracking-[-0.03em] text-ink leading-[1.1]">Reports, written from your numbers.</h2>
            <p className="text-lead text-warm-600 leading-snug mt-4">Each report is built from the schedule’s calculated figures and says where every number came from. With AI off, RunF9 writes it by rule; with AI on, the model drafts the wording and the figures stay the engine’s.</p>
            <ul className="mt-6 space-y-3">
              {[
                ['Executive Schedule Summary', 'status, key dates, findings and recommendations'],
                ['Critical & Near-Critical Paths', 'driving activities, float and low-float paths'],
                ['Baseline vs Current Variance', 'current dates against the baseline in your file'],
                ['Schedule QA/QC Audit', 'the DCMA 14-Point results, with issues and fixes'],
                ['Time Impact Analysis', 'the delay event, its fragnet and the impact on each milestone'],
              ].map(([t, d]) => (
                <li key={t} className="flex gap-2.5 text-copy text-warm-700 leading-snug">
                  <span aria-hidden className="mt-[9px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-600" />
                  <span><span className="font-semibold text-ink">{t}:</span> {d}.</span>
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal><Shot name="report" label="RunF9 · Reports · Executive Schedule Summary" alt="An Executive Schedule Summary in RunF9 for the sample data center, with a provenance table: the schedule, the source file, its SHA-256 hash and the data date." /></Reveal>
        </div>
      </section>

      {/* What it connects to */}
      <Integrations />

      {/* Choose the cloud: RunF9 Cloud, the firm's own AWS / Azure / Google account, a different cloud per client, or air-gapped */}
      <Deployment primaryHref={primaryHref} primaryLabel={primaryLabel} />

      <Security contactHref={contactHref} />

      {/* Pricing: licensed per organization, quoted after a demo on the firm's own schedule */}
      <section id="pricing" className="max-w-[1240px] mx-auto px-6 py-16 md:py-24 scroll-mt-12">
        <Reveal className="text-center mb-12 md:mb-14">
          <h2 className="text-h2 md:text-h1 font-bold tracking-[-0.02em] md:tracking-[-0.03em] text-ink leading-[1.1]">Priced for your organization.</h2>
          <p className="text-lead text-warm-600 mt-4 max-w-[760px] mx-auto leading-snug">RunF9 is licensed per organization. The price depends on how many projects and people use it and on where it runs: our cloud, your cloud account, or air-gapped.{!inviteOnly && ' You can start free with up to 3 uploaded schedules; the list below is what a license can include.'}</p>
        </Reveal>
        <Reveal className="rounded-[28px] bg-navy-950 text-white p-8 md:p-12 grid lg:grid-cols-[2fr_3fr] gap-10 lg:gap-14 shadow-[0_30px_60px_-30px_rgba(29,33,37,0.55)]">
          <div>
            <h3 className="text-h3 md:text-h2 font-semibold tracking-[-0.01em] text-white leading-tight">See it on one of your own schedules</h3>
            <p className="text-copy text-navy-200 leading-relaxed mt-3">Send us a schedule, or bring one to the call. We run it through RunF9 with you, answer your security and deployment questions, and quote for your organization.</p>
            <Cta href={demoHref} className="pressable mt-7 inline-flex items-center justify-center gap-2 rounded-full bg-white text-ink font-semibold px-6 py-3 text-copy hover:bg-warm-100 transition-colors">Request a demo<ArrowRight size={18} aria-hidden /></Cta>
            <p className="text-small text-navy-200 mt-4">Or write to <a href={questionHref} className="underline text-white">the founder</a> with any question.</p>
          </div>
          <div>
            <p className="text-small font-semibold text-accent-400">What a license can include</p>
            <ul className="mt-4 grid sm:grid-cols-2 gap-x-8 gap-y-3">
              {['Unlimited schedules, updates and interview-built plans', 'Every check, report and export: P6, MS Project, PDF and Excel', 'The Daily Brief for the project manager, the field and the client', 'Delay analysis, what-ifs and Monte Carlo schedule risk', 'Site captures and the site map on any phone', 'Single sign-on (SAML, OpenID Connect) and SCIM', 'Roles, 2-step verification, approval policies and the audit log', 'Your cloud account (AWS, Azure, Google Cloud) or air-gapped', 'Data export, retention and deletion controls', 'Support by email from the founder'].map(f => (
                <li key={f} className="flex items-start gap-2.5 text-small text-white"><CheckCircle size={17} className="text-accent-400 flex-shrink-0 mt-0.5" aria-hidden />{f}</li>
              ))}
            </ul>
            <p className="text-small text-navy-200 mt-5">Your quote sets which of these are switched on for your organization.</p>
          </div>
        </Reveal>
      </section>

      <Faq />

      {/* Closing call to action */}
      <section className="px-6 pb-16 md:pb-24">
        <Reveal className="max-w-[1240px] mx-auto rounded-[36px] bg-navy-950 px-8 py-20 md:py-28 text-center relative overflow-hidden">
          <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(59,130,246,0.28),transparent_60%)]" />
          <div className="relative">
            <h2 className="text-h2 md:text-h1 font-bold tracking-[-0.02em] md:tracking-[-0.03em] text-white leading-[1.1]">Use RunF9 on your next schedule</h2>
            <p className="text-lead text-navy-200 mt-4 max-w-[620px] mx-auto">Start with the interview, or upload a schedule and see the DCMA 14-Point results in seconds.</p>
            <Cta href={primaryHref} className={`${primaryBtn} mt-8 px-7 py-3.5 text-copy`}>{inviteOnly ? 'Request access' : 'Get started free'}</Cta>
            <p className="text-small text-navy-200 mt-5">{inviteOnly ? <>Private beta · by invitation. Already invited? <Link href="/auth" className="underline text-white">Sign in</Link>.</> : 'No credit card required.'}</p>
          </div>
        </Reveal>
      </section>

      {/* Footer */}
      <footer className="border-t border-warm-200 bg-white">
        <div className="max-w-[1240px] mx-auto px-6 py-14 grid grid-cols-2 md:grid-cols-[1.4fr_1fr_1fr_1fr] gap-10">
          <div className="col-span-2 md:col-span-1">
            <Logo variant="dark" size="h-[30px]" />
            <p className="text-small text-warm-600 mt-4 max-w-[280px] leading-relaxed">Construction scheduling, explained. Built by Hoshmand AI, founded by a construction scheduling consultant with 13 years in the field.</p>
          </div>
          <div>
            <div className="text-small font-semibold text-ink mb-3">Product</div>
            {[['#today', 'Daily Brief'], ['#features', 'Features'], ['#updates', 'Updates & delays'], ['#reports', 'Reports'], ['#integrations', 'Integrations'], ['#pricing', 'Pricing']].map(([href, label]) => <a key={href} href={href} className={footLink}>{label}</a>)}
          </div>
          <div>
            <div className="text-small font-semibold text-ink mb-3">Trust</div>
            {[['#deployment', 'Your cloud'], ['#security', 'Security'], ['#evidence', 'Evidence'], ['#faq', 'FAQ']].map(([href, label]) => <a key={href} href={href} className={footLink}>{label}</a>)}
          </div>
          <div>
            <div className="text-small font-semibold text-ink mb-3">Company</div>
            <a href="https://www.hoshmand.ai" className={footLink}>Hoshmand AI</a>
            <a href="mailto:support@hoshmand.ai" className={footLink}>Contact</a>
            <Link href="/auth" className={footLink}>Sign in</Link>
            <div className="text-small font-semibold text-ink mb-3 mt-6">Legal</div>
            <Link href="/privacy" className={footLink}>Privacy Policy</Link>
            <Link href="/terms" className={footLink}>Terms of Service</Link>
          </div>
        </div>
        <div className="max-w-[1240px] mx-auto px-6 pb-8 text-fine text-warm-600">© 2026 RunF9. Built by Hoshmand AI. All rights reserved.</div>
      </footer>
    </div>
  )
}
