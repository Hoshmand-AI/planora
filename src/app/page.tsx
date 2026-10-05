'use client'

import Link from 'next/link'
import { FileText, MessageSquare, BarChart3, Activity, CheckCircle, Shield, Menu, X } from 'lucide-react'
import { useState } from 'react'
import { Logo } from '@/components/Logo'

export default function HomePage() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="min-h-screen bg-warm-50">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 bg-navy-900 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center">
            <Logo variant="light" size="text-[20px]" />
          </Link>

          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-white/65 text-[13px] font-medium hover:text-white/90 transition-colors">Features</a>
            <a href="#how-it-works" className="text-white/65 text-[13px] font-medium hover:text-white/90 transition-colors">How It Works</a>
            <a href="#reports" className="text-white/65 text-[13px] font-medium hover:text-white/90 transition-colors">Reports</a>
            <a href="#pricing" className="text-white/65 text-[13px] font-medium hover:text-white/90 transition-colors">Pricing</a>
          </div>

          <div className="hidden md:flex items-center gap-5">
            <Link href="/auth" className="text-white/65 text-[13px] font-medium hover:text-white transition-colors">Sign In</Link>
            <Link href="/auth?mode=signup" className="bg-accent-500 text-navy-950 px-4 py-2 rounded-md text-[13px] font-semibold hover:bg-accent-400 transition-colors">Get Started</Link>
          </div>

          <button className="md:hidden text-white" onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>

        {menuOpen && (
          <div className="md:hidden bg-navy-900 border-t border-white/5 px-6 py-4">
            <a href="#features" className="block py-3 text-white/70 text-[14px] font-medium" onClick={() => setMenuOpen(false)}>Features</a>
            <a href="#how-it-works" className="block py-3 text-white/70 text-[14px] font-medium" onClick={() => setMenuOpen(false)}>How It Works</a>
            <a href="#pricing" className="block py-3 text-white/70 text-[14px] font-medium" onClick={() => setMenuOpen(false)}>Pricing</a>
            <Link href="/auth" className="block py-3 text-white/70 text-[14px] font-medium">Sign In</Link>
            <Link href="/auth?mode=signup" className="block mt-3 bg-accent-500 text-navy-950 text-center py-2.5 rounded-md text-[14px] font-semibold">Get Started</Link>
          </div>
        )}
      </nav>

      {/* Hero */}
      <section className="px-6 pt-20 pb-16 text-center">
        <div className="inline-block text-[11px] font-semibold uppercase tracking-widest text-accent-600 bg-accent-100 px-3 py-1 rounded-md mb-6">
          Construction scheduling, explained
        </div>
        <h1 className="font-display text-[40px] md:text-[50px] text-navy-950 max-w-[760px] mx-auto leading-[1.1] mb-5">
          Build and check construction schedules. Every number explained.
        </h1>
        <p className="text-[17px] text-warm-500 max-w-[600px] mx-auto mb-9 leading-relaxed">
          Planora interviews you like a senior scheduler, builds a CPM schedule with a written basis for every duration and link,
          runs the DCMA 14-Point Assessment, and exports native Primavera P6 and MS Project files. Already have a schedule? Upload it to check it.
        </p>
        <div className="flex gap-3 justify-center flex-wrap">
          <Link href="/auth?mode=signup" className="bg-accent-500 text-navy-950 px-8 py-3.5 rounded-md text-[15px] font-semibold hover:bg-accent-400 transition-colors">
            Start Free
          </Link>
          <a href="#how-it-works" className="border border-warm-300 text-navy-950 px-8 py-3.5 rounded-md text-[15px] font-medium hover:bg-warm-100 transition-colors">
            See How It Works
          </a>
        </div>

        {/* Facts row: each figure is backed by an automated test or the product's own limits (see "Where these numbers come from") */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-8 mt-14 pt-10 border-t border-warm-200 max-w-[820px] mx-auto">
          {[
            ['14 of 14', 'DCMA 14-Point checks, run automatically'],
            ['100,000', 'activities scheduled by our CPM engine in automated tests'],
            ['0 days', 'difference in dates and float after a P6 or MS Project round trip, in our test set'],
            ['$0', 'to start. No credit card'],
          ].map(([value, label]) => (
            <div key={label} className="text-center">
              <div className="text-[28px] font-bold text-navy-950 tabular-nums">{value}</div>
              <div className="text-[12px] text-warm-500 mt-1 leading-snug max-w-[180px] mx-auto">{label}</div>
            </div>
          ))}
        </div>
        <a href="#evidence" className="inline-block mt-6 text-[12.5px] text-accent-600 hover:underline">Where these numbers come from</a>
      </section>

      {/* Proof Bar */}
      <div className="bg-warm-100 border-y border-warm-200 py-4 text-center px-6">
        <p className="text-[13px] text-warm-500 font-medium">
          Built by <span className="text-warm-700 font-semibold">Hoshmand AI</span>, founded by a construction scheduling consultant with{' '}
          <span className="text-warm-700 font-semibold">13 years</span> in the field and a degree in architecture.
        </p>
      </div>

      {/* Problem / Solution */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-14">
          <h2 className="font-display text-[30px] text-navy-950 mb-3">Less time building and checking. More time managing.</h2>
          <p className="text-warm-600 max-w-[580px] mx-auto text-[15px]">Planora does the repetitive parts of scheduling and shows its work, so you can review and defend the result.</p>
        </div>
        <div className="grid md:grid-cols-2 gap-5">
          <div className="bg-warm-100 border border-warm-200 rounded-lg p-8">
            <span className="inline-block text-[11px] font-bold uppercase tracking-wider text-warm-600 bg-warm-200 px-3 py-1 rounded-md mb-5">The usual way</span>
            <ul className="space-y-3">
              {['Baselines are built activity by activity in P6 or MS Project', 'Quality checks are a separate step, often run just before submittal', 'The reason behind a duration lives in the scheduler’s head', 'When the date slips, recovery options are worked out by hand'].map(item => (
                <li key={item} className="flex items-start gap-3 text-[13.5px] text-warm-700 border-b border-warm-200 pb-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-warm-400 flex-shrink-0 mt-2" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-warm-100 border border-warm-200 rounded-lg p-8">
            <span className="inline-block text-[11px] font-bold uppercase tracking-wider text-status-on-track bg-status-on-track-bg px-3 py-1 rounded-md border-l-2 border-status-on-track mb-5">With Planora</span>
            <ul className="space-y-3">
              {['An interview builds the first schedule; you review and adjust it', 'DCMA 14-Point checks run on every change', 'Each duration and link shows its source and assumptions', 'Recovery options are re-scheduled on the real network and priced from your labor cost'].map(item => (
                <li key={item} className="flex items-start gap-3 text-[13.5px] text-warm-700 border-b border-warm-200 pb-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-status-on-track flex-shrink-0 mt-2" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="max-w-6xl mx-auto px-6 pb-20">
        <h2 className="font-display text-[30px] text-navy-950 mb-10">Built by a scheduler, for everyone on the project</h2>
        <div className="grid md:grid-cols-2 gap-8 gap-x-14">
          {[
            { icon: FileText,      title: 'Native P6 and MS Project files', desc: 'Import .xer and .xml with activities, logic, lags, constraints and calendars, and export the same formats. Excel and PDF imports read activities and dates; a PDF carries no logic.' },
            { icon: MessageSquare, title: 'A schedule built from an interview', desc: 'Planora asks what a senior scheduler would ask: scope, permits, long-lead equipment, site and calendar. Questions are ranked by how far each answer can move your finish date.' },
            { icon: CheckCircle,   title: 'DCMA 14-Point Assessment', desc: 'All 14 checks, with the published thresholds by default or your organization’s own. Each failing check lists the activities involved and a suggested fix.' },
            { icon: Activity,      title: 'Critical path and float', desc: 'Forward and backward CPM passes with calendars, holidays, lags and constraints. Total and free float for every activity.' },
            { icon: BarChart3,     title: 'Schedule risk and recovery', desc: 'Monte Carlo risk analysis (200 to 1,000 iterations of the full network) gives P50 and P80 finish dates. When a date is missed, recovery options are modeled on the network and priced from your labor cost.' },
            { icon: Shield,        title: 'Ask AI, with limits', desc: 'Ask questions in plain English and draft narrative reports with a version-pinned OpenAI model (GPT-4o by default). Calculated figures such as DCMA results come from the engine, not the model. AI can be switched off.' },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex gap-4">
              <div className="w-9 h-9 bg-navy-900 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5">
                <Icon size={16} className="text-accent-600" />
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-navy-950 mb-1">{title}</h3>
                <p className="text-[13.5px] text-warm-500 leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="bg-warm-100 border-y border-warm-200 py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <h2 className="font-display text-[30px] text-navy-950 mb-12 text-center">How it works</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {[
              { num: '01', title: 'Start',     desc: 'Answer the interview, or upload a P6 (.xer), MS Project (.xml), Excel or PDF schedule.' },
              { num: '02', title: 'Calculate', desc: 'The CPM engine computes dates, float and the critical path. This is arithmetic, not AI.' },
              { num: '03', title: 'Check',     desc: 'DCMA 14-Point checks, date logic and risk analysis, with the reason for every finding.' },
              { num: '04', title: 'Deliver',   desc: 'Export to P6, MS Project, Excel or PDF, with a Basis of Schedule narrative.' },
            ].map(({ num, title, desc }) => (
              <div key={num} className="text-center">
                <div className="text-[30px] font-bold text-accent-600 mb-3 tabular-nums font-display">{num}</div>
                <div className="text-[15px] font-semibold text-navy-950 mb-2">{title}</div>
                <div className="text-[13px] text-warm-500 leading-relaxed max-w-[210px] mx-auto">{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Reports */}
      <section id="reports" className="max-w-6xl mx-auto px-6 py-20">
        <h2 className="font-display text-[30px] text-navy-950 mb-3">Narrative reports, drafted from your data</h2>
        <p className="text-warm-600 mb-10 max-w-[600px] text-[15px]">Four report types, drafted by AI from your schedule’s calculated figures. Review them before you send them; the figures they quote come from the schedule, and the wording comes from the model.</p>
        <div className="grid md:grid-cols-2 gap-4">
          {[
            { icon: BarChart3,     title: 'Executive Schedule Summary',     desc: 'Status, key dates, findings and recommendations in plain language.' },
            { icon: Activity,      title: 'Critical Path Report',           desc: 'Driving activities, float and low-float paths from the CPM calculation.' },
            { icon: FileText,      title: 'Baseline vs Current Variance',   desc: 'Compares current dates with the baseline stored in your P6 or MS Project file.' },
            { icon: CheckCircle,   title: 'Schedule QA/QC Report',          desc: 'The DCMA 14-Point results, with the issues and suggested fixes.' },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="bg-warm-100 border border-warm-200 rounded-lg p-5 hover:border-warm-300 transition-colors">
              <div className="w-9 h-9 bg-navy-900 rounded-md flex items-center justify-center mb-4">
                <Icon size={16} className="text-accent-600" />
              </div>
              <h3 className="text-[15px] font-semibold text-navy-950 mb-1.5">{title}</h3>
              <p className="text-[13.5px] text-warm-600 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="bg-warm-100 border-y border-warm-200 py-20 px-6">
        <div className="max-w-[1000px] mx-auto">
          <h2 className="font-display text-[30px] text-navy-950 text-center mb-3">Simple, transparent pricing</h2>
          <p className="text-center text-warm-500 mb-10 text-[15px]">Start free. Upgrade when you need more.</p>
          <div className="grid md:grid-cols-3 gap-4">

            <div className="bg-warm-50 border border-warm-200 rounded-lg p-7">
              <div className="text-[11px] font-bold uppercase tracking-wider text-warm-400 mb-2">Free</div>
              <div className="text-[36px] font-bold text-navy-950">$0<span className="text-[15px] font-medium text-warm-400">/month</span></div>
              <p className="text-[13.5px] text-warm-600 mt-1 mb-5">For trying Planora on real projects.</p>
              <ul className="space-y-2.5 mb-6">
                {['Up to 3 uploaded schedules', 'Unlimited interview-built schedules', 'Executive Summary report', '10 AI requests/day', 'Export to P6, MS Project & CSV', 'Roles, 2-step verification & audit log'].map(f => (
                  <li key={f} className="flex items-center gap-2 text-[13.5px] text-warm-700">
                    <span className="text-status-on-track font-bold text-[12px]">✓</span>{f}
                  </li>
                ))}
                {['Critical Path, Variance & QA/QC reports', 'Export to PDF & Excel', 'API keys & webhooks'].map(f => (
                  <li key={f} className="flex items-center gap-2 text-[13.5px] text-warm-500">
                    <span aria-hidden="true">—</span><span className="line-through decoration-warm-300">{f}</span><span className="sr-only">(not included)</span>
                  </li>
                ))}
              </ul>
              <Link href="/auth?mode=signup" className="block text-center border border-warm-300 text-navy-950 py-2.5 rounded-md text-[13.5px] font-semibold hover:bg-warm-100 transition-colors">
                Start Free
              </Link>
            </div>

            <div className="bg-warm-50 border-2 border-accent-500 rounded-lg p-7 relative">
              <div className="text-[11px] font-bold uppercase tracking-wider text-warm-400 mb-2">Pro</div>
              <div className="text-[36px] font-bold text-navy-950">$49<span className="text-[15px] font-medium text-warm-400">/month</span></div>
              <p className="text-[13.5px] text-warm-600 mt-1 mb-5">For schedulers and consultants who need every report and export.</p>
              <ul className="space-y-2.5 mb-6">
                {['Unlimited uploaded schedules', 'All 4 report types', 'Up to 1,000 AI requests/day', 'Export to P6, MS Project, PDF & Excel', 'Monte Carlo schedule risk analysis', 'API keys & signed webhooks', 'Roles, 2-step verification & audit log'].map(f => (
                  <li key={f} className="flex items-center gap-2 text-[13.5px] text-warm-700">
                    <span className="text-status-on-track font-bold text-[12px]">✓</span>{f}
                  </li>
                ))}
              </ul>
              <Link href="/auth?mode=signup" className="block text-center bg-accent-500 text-navy-950 py-2.5 rounded-md text-[13.5px] font-semibold hover:bg-accent-400 transition-colors">
                Start free, then upgrade
              </Link>
            </div>

            <div className="bg-warm-50 border border-warm-200 rounded-lg p-7">
              <div className="text-[11px] font-bold uppercase tracking-wider text-warm-400 mb-2">Enterprise</div>
              <div className="text-[36px] font-bold text-navy-950">Custom</div>
              <p className="text-[13.5px] text-warm-600 mt-1 mb-5">For organizations deploying across teams.</p>
              <ul className="space-y-2.5 mb-6">
                {['Everything in Pro', 'Single sign-on (OpenID Connect)', 'Enforced 2-step & approval policies', 'On-premises / air-gapped deployment', 'Data export, retention & deletion controls', 'Support by email from the founder'].map(f => (
                  <li key={f} className="flex items-center gap-2 text-[13.5px] text-warm-700">
                    <span className="text-status-on-track font-bold text-[12px]">✓</span>{f}
                  </li>
                ))}
              </ul>
              <a href="mailto:support@hoshmand.ai" className="block text-center border border-warm-300 text-navy-950 py-2.5 rounded-md text-[13.5px] font-semibold hover:bg-warm-100 transition-colors">
                Contact Sales
              </a>
            </div>

          </div>
        </div>
      </section>

      {/* Evidence: how each figure on this page can be checked */}
      <section id="evidence" className="max-w-[860px] mx-auto px-6 pt-16">
        <h2 className="font-display text-[26px] text-navy-950 mb-3">Where these numbers come from</h2>
        <p className="text-[14px] text-warm-600 mb-5">Every figure on this page is reproducible. Customers and auditors can ask us to run the tests below in front of them.</p>
        <dl className="divide-y divide-warm-200 border-y border-warm-200 text-[13.5px]">
          {[
            ['14 of 14 DCMA checks', 'All fourteen checks of the DCMA 14-Point Assessment are implemented, each with a unit test that makes it pass and fail. Checks that need data a file doesn’t have (for example baselines) are reported as not applicable, never as passed.'],
            ['100,000 activities', 'An automated performance test schedules synthetic networks of 10,000, 50,000 and 100,000 activities, with mixed relationship types, lags and two calendars, on every code change. It measures the CPM calculation, not file upload.'],
            ['0 days after a round trip', 'Five test schedules (different calendars, delivery methods and a required finish) are exported to P6 XER and MS Project XML, imported back and re-scheduled from scratch. Every activity’s early start, early finish and total float must match exactly. This proves Planora’s files keep the logic intact; a side-by-side comparison with P6 and MS Project calculating the same reference projects is planned and will be published here.'],
            ['$0 to start', 'The Free plan has no time limit and asks for no payment details. Plan limits are listed in the pricing table and enforced by the server.'],
          ].map(([term, def]) => (
            <div key={term} className="py-3.5 grid md:grid-cols-[200px_1fr] gap-1 md:gap-6">
              <dt className="font-semibold text-navy-950">{term}</dt>
              <dd className="text-warm-600">{def}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* CTA */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="bg-navy-900 rounded-lg px-8 py-16 text-center">
          <h2 className="font-display text-[30px] text-white mb-4">Build or check your next schedule today.</h2>
          <p className="text-white/70 mb-8 text-[15px]">Start with the interview, or upload a P6 or MS Project file and see the DCMA 14-Point results in seconds.</p>
          <Link href="/auth?mode=signup" className="inline-block bg-accent-500 text-navy-950 px-10 py-3.5 rounded-md text-[15px] font-semibold hover:bg-accent-400 transition-colors">
            Get Started Free
          </Link>
          <p className="text-white/60 text-[12px] mt-4">No credit card required.</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-navy-900 border-t border-white/5 px-6 pt-12 pb-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
            <div className="col-span-2 md:col-span-1">
              <div className="mb-3">
                <Logo variant="light" size="text-[18px]" />
              </div>
              <p className="text-white/70 text-[13px] leading-relaxed max-w-[240px]">Construction scheduling, explained. Built by Hoshmand AI.</p>
            </div>
            <div>
              <div className="text-white text-[11px] font-bold uppercase tracking-wider mb-3">Product</div>
              <a href="#features" className="block text-white/70 text-[13px] py-1.5 hover:text-white/80 transition-colors">Features</a>
              <a href="#pricing" className="block text-white/70 text-[13px] py-1.5 hover:text-white/80 transition-colors">Pricing</a>
              <a href="#how-it-works" className="block text-white/70 text-[13px] py-1.5 hover:text-white/80 transition-colors">How It Works</a>
            </div>
            <div>
              <div className="text-white text-[11px] font-bold uppercase tracking-wider mb-3">Company</div>
              <a href="https://www.hoshmand.ai" className="block text-white/70 text-[13px] py-1.5 hover:text-white/80 transition-colors">Hoshmand AI</a>
              <a href="mailto:support@hoshmand.ai" className="block text-white/70 text-[13px] py-1.5 hover:text-white/80 transition-colors">Contact</a>
            </div>
            <div>
              <div className="text-white text-[11px] font-bold uppercase tracking-wider mb-3">Legal</div>
              <Link href="/privacy" className="block text-white/70 text-[13px] py-1.5 hover:text-white/80 transition-colors">Privacy Policy</Link>
              <Link href="/terms" className="block text-white/70 text-[13px] py-1.5 hover:text-white/80 transition-colors">Terms of Service</Link>
            </div>
          </div>
          <div className="border-t border-white/5 pt-5 flex flex-col md:flex-row items-center justify-between gap-2">
            <span className="text-white/60 text-[12px]">© 2026 Planora. Built by Hoshmand AI. All rights reserved.</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
