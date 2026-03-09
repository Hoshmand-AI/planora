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
            <a href="#features" className="text-white/55 text-[13px] font-medium hover:text-white/90 transition-colors">Features</a>
            <a href="#how-it-works" className="text-white/55 text-[13px] font-medium hover:text-white/90 transition-colors">How It Works</a>
            <a href="#reports" className="text-white/55 text-[13px] font-medium hover:text-white/90 transition-colors">Reports</a>
            <a href="#pricing" className="text-white/55 text-[13px] font-medium hover:text-white/90 transition-colors">Pricing</a>
          </div>

          <div className="hidden md:flex items-center gap-5">
            <Link href="/auth" className="text-white/65 text-[13px] font-medium hover:text-white transition-colors">Sign In</Link>
            <Link href="/auth?mode=signup" className="bg-gold-500 text-navy-950 px-4 py-2 rounded-md text-[13px] font-semibold hover:bg-gold-400 transition-colors">Get Started</Link>
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
            <Link href="/auth?mode=signup" className="block mt-3 bg-gold-500 text-navy-950 text-center py-2.5 rounded-md text-[14px] font-semibold">Get Started</Link>
          </div>
        )}
      </nav>

      {/* Hero */}
      <section className="px-6 pt-20 pb-16 text-center">
        <div className="inline-block text-[11px] font-semibold uppercase tracking-widest text-gold-600 bg-gold-100 px-3 py-1 rounded-md mb-6">
          Built by Hoshmand AI
        </div>
        <h1 className="font-display text-[42px] md:text-[50px] text-navy-950 max-w-[700px] mx-auto leading-[1.1] mb-5">
          Construction schedule analysis. Instant. AI&#8209;powered.
        </h1>
        <p className="text-[17px] text-warm-500 max-w-[540px] mx-auto mb-9 leading-relaxed">
          Upload your Primavera P6 or MS Project schedule and get instant AI-powered analysis, delay insights, and executive reports.
        </p>
        <div className="flex gap-3 justify-center flex-wrap">
          <Link href="/auth?mode=signup" className="bg-gold-500 text-navy-950 px-8 py-3.5 rounded-md text-[15px] font-semibold hover:bg-gold-400 transition-colors">
            Start Free
          </Link>
          <a href="#how-it-works" className="border border-warm-300 text-navy-950 px-8 py-3.5 rounded-md text-[15px] font-medium hover:bg-warm-100 transition-colors">
            See How It Works
          </a>
        </div>

        {/* Stats Row */}
        <div className="flex justify-center gap-12 mt-14 pt-10 border-t border-warm-200 max-w-[700px] mx-auto flex-wrap">
          {[
            ['100K+', 'Activities Parsed'],
            ['$200/hr', 'Consultant Replaced'],
            ['4', 'Report Types'],
            ['Free', 'To Start'],
          ].map(([value, label]) => (
            <div key={label} className="text-center">
              <div className="text-[30px] font-bold text-navy-950 tabular-nums">{value}</div>
              <div className="text-[11px] font-medium text-warm-400 uppercase tracking-wider mt-1">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Proof Bar */}
      <div className="bg-warm-100 border-y border-warm-200 py-4 text-center px-6">
        <p className="text-[13px] text-warm-500 font-medium">
          Built by <span className="text-warm-700 font-semibold">Hoshmand AI</span> — a{' '}
          <span className="text-warm-700 font-semibold">13-year construction scheduling professional</span> who managed schedules at{' '}
          <span className="text-warm-700 font-semibold">Meta</span>,{' '}
          <span className="text-warm-700 font-semibold">USPS</span>, and{' '}
          <span className="text-warm-700 font-semibold">Applied Digital</span>
        </p>
      </div>

      {/* Problem / Solution */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-14">
          <h2 className="font-display text-[30px] text-navy-950 mb-3">The $200/hour problem</h2>
          <p className="text-warm-600 max-w-[560px] mx-auto text-[15px]">Every major construction project has a schedule. Analyzing it shouldn't require a specialist and three days of manual work.</p>
        </div>
        <div className="grid md:grid-cols-2 gap-5">
          <div className="bg-warm-100 border border-warm-200 rounded-lg p-8">
            <span className="inline-block text-[11px] font-bold uppercase tracking-wider text-status-at-risk bg-status-at-risk-bg px-3 py-1 rounded-md border-l-2 border-status-at-risk mb-5">Today</span>
            <h3 className="text-[18px] font-semibold text-navy-950 mb-3">Manual, slow, expensive</h3>
            <p className="text-[14px] text-warm-600 mb-4">Schedule analysis is done by hand using 20-year-old desktop software and expensive consultants.</p>
            <ul className="space-y-3">
              {['Senior scheduler: $150–250/hour', 'Single variance report: 2–3 days', 'No mobile access to schedule data', 'Project managers wait for answers', 'Reports are dashboards, not narratives'].map(item => (
                <li key={item} className="flex items-center gap-3 text-[13.5px] text-warm-700 border-b border-warm-200 pb-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-status-at-risk flex-shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-warm-100 border border-warm-200 rounded-lg p-8">
            <span className="inline-block text-[11px] font-bold uppercase tracking-wider text-status-on-track bg-status-on-track-bg px-3 py-1 rounded-md border-l-2 border-status-on-track mb-5">With Planora</span>
            <h3 className="text-[18px] font-semibold text-navy-950 mb-3">Instant, AI-powered, on any device</h3>
            <p className="text-[14px] text-warm-600 mb-4">Upload your schedule file and get the same analysis a consultant produces — instantly.</p>
            <ul className="space-y-3">
              {['AI analysis: seconds, not days', 'Executive narrative reports', 'Works on any device with a browser', 'Ask questions in plain English', 'Critical path, variance, QA/QC — automated'].map(item => (
                <li key={item} className="flex items-center gap-3 text-[13.5px] text-warm-700 border-b border-warm-200 pb-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-status-on-track flex-shrink-0" />
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
            { icon: FileText,      title: 'Real P6 & MS Project Parsing',  desc: 'Upload XER, XML, or PDF files. Every activity, relationship, and constraint extracted automatically.' },
            { icon: MessageSquare, title: 'AI-Powered Q&A',                 desc: 'Ask questions in plain English. Get precise answers based on your actual schedule data — powered by GPT-4o.' },
            { icon: BarChart3,     title: 'Executive Reports',              desc: 'Generate professional narrative reports with findings and recommendations. The same deliverable a consultant produces.' },
            { icon: Activity,      title: 'Critical Path Analysis',         desc: 'Instantly identify driving activities, float consumption, and near-critical paths across your entire schedule.' },
            { icon: CheckCircle,   title: 'Variance Tracking',              desc: 'Compare baseline vs. current with milestone-by-milestone variance breakdown and cause categorization.' },
            { icon: Shield,        title: 'Schedule QA/QC',                 desc: 'Automated quality checks against DCMA 14-point standards. Find logic issues, missing links, and constraint problems.' },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex gap-4">
              <div className="w-9 h-9 bg-navy-900 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5">
                <Icon size={16} className="text-gold-500" />
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
              { num: '01', title: 'Upload',  desc: 'Select a P6 (.xer), MS Project (.xml), or PDF schedule file.' },
              { num: '02', title: 'Parse',   desc: 'Every activity, relationship, and constraint extracted automatically.' },
              { num: '03', title: 'Analyze', desc: 'AI identifies the critical path, calculates variance, and assesses quality.' },
              { num: '04', title: 'Report',  desc: 'Get professional reports, or ask questions in plain English.' },
            ].map(({ num, title, desc }) => (
              <div key={num} className="text-center">
                <div className="text-[30px] font-bold text-gold-500 mb-3 tabular-nums font-display">{num}</div>
                <div className="text-[15px] font-semibold text-navy-950 mb-2">{title}</div>
                <div className="text-[13px] text-warm-500 leading-relaxed max-w-[200px] mx-auto">{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Reports */}
      <section id="reports" className="max-w-6xl mx-auto px-6 py-20">
        <h2 className="font-display text-[30px] text-navy-950 mb-3">Professional reports, generated instantly</h2>
        <p className="text-warm-600 mb-10 max-w-[560px] text-[15px]">The same deliverables a scheduling consultant produces — executive narratives with findings and recommendations.</p>
        <div className="grid md:grid-cols-2 gap-4">
          {[
            { icon: BarChart3,     title: 'Executive Schedule Summary',        desc: 'High-level narrative with status, variance, key findings, and recommendations.' },
            { icon: Activity,      title: 'Critical & Near-Critical Paths',     desc: 'Driving activities, float consumption, path sequences, and near-critical analysis.' },
            { icon: FileText,      title: 'Baseline vs Current Variance',       desc: 'Milestone-by-milestone comparison with variance breakdown and cause categories.' },
            { icon: CheckCircle,   title: 'Schedule QA/QC Audit',               desc: 'DCMA 14-point compliance check with logic issues and specific fixes.' },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="bg-warm-100 border border-warm-200 rounded-lg p-5 hover:border-warm-300 transition-colors">
              <div className="w-9 h-9 bg-navy-900 rounded-md flex items-center justify-center mb-4">
                <Icon size={16} className="text-gold-500" />
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
              <p className="text-[13.5px] text-warm-600 mt-1 mb-5">For individual PMs trying AI schedule analysis.</p>
              <ul className="space-y-2.5 mb-6">
                {['Up to 3 schedules', 'Executive Summary report', '10 AI questions/day', 'P6, MS Project, PDF'].map(f => (
                  <li key={f} className="flex items-center gap-2 text-[13.5px] text-warm-700">
                    <span className="text-status-on-track font-bold text-[12px]">✓</span>{f}
                  </li>
                ))}
                {['Critical Path report', 'Variance report', 'Export to PDF/Word'].map(f => (
                  <li key={f} className="flex items-center gap-2 text-[13.5px] text-warm-300">
                    <span className="text-warm-300">—</span>{f}
                  </li>
                ))}
              </ul>
              <Link href="/auth?mode=signup" className="block text-center border border-warm-300 text-navy-950 py-2.5 rounded-md text-[13.5px] font-semibold hover:bg-warm-100 transition-colors">
                Start Free
              </Link>
            </div>

            <div className="bg-warm-50 border-2 border-gold-500 rounded-lg p-7 relative">
              <div className="absolute -top-3 left-6 bg-gold-500 text-navy-950 text-[11px] font-bold uppercase tracking-wider px-3 py-0.5 rounded-md">Most Popular</div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-warm-400 mb-2">Pro</div>
              <div className="text-[36px] font-bold text-navy-950">$49<span className="text-[15px] font-medium text-warm-400">/month</span></div>
              <p className="text-[13.5px] text-warm-600 mt-1 mb-5">For PMs and schedulers who need full capabilities.</p>
              <ul className="space-y-2.5 mb-6">
                {['Unlimited schedules', 'All 4 report types', 'Unlimited AI questions', 'P6, MS Project, PDF', 'Critical Path report', 'Variance & QA/QC', 'Export to PDF/Word/Excel'].map(f => (
                  <li key={f} className="flex items-center gap-2 text-[13.5px] text-warm-700">
                    <span className="text-status-on-track font-bold text-[12px]">✓</span>{f}
                  </li>
                ))}
              </ul>
              <Link href="/auth?mode=signup" className="block text-center bg-gold-500 text-navy-950 py-2.5 rounded-md text-[13.5px] font-semibold hover:bg-gold-400 transition-colors">
                Get Started
              </Link>
            </div>

            <div className="bg-warm-50 border border-warm-200 rounded-lg p-7">
              <div className="text-[11px] font-bold uppercase tracking-wider text-warm-400 mb-2">Enterprise</div>
              <div className="text-[36px] font-bold text-navy-950">Custom</div>
              <p className="text-[13.5px] text-warm-600 mt-1 mb-5">For organizations deploying across teams.</p>
              <ul className="space-y-2.5 mb-6">
                {['Everything in Pro', 'Org-wide deployment', 'Role-based access', 'SSO & audit trails', 'White-label reports', 'Dedicated support', 'Custom integrations'].map(f => (
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

      {/* CTA */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="bg-navy-900 rounded-lg px-8 py-16 text-center">
          <h2 className="font-display text-[30px] text-white mb-4">Stop waiting for schedule reports.</h2>
          <p className="text-white/45 mb-8 text-[15px]">Upload your first P6 or MS Project file and get instant AI-powered analysis.</p>
          <Link href="/auth?mode=signup" className="inline-block bg-gold-500 text-navy-950 px-10 py-3.5 rounded-md text-[15px] font-semibold hover:bg-gold-400 transition-colors">
            Get Started Free
          </Link>
          <p className="text-white/30 text-[12px] mt-4">No credit card required.</p>
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
              <p className="text-warm-500 text-[13px] leading-relaxed max-w-[240px]">AI Schedule Analysis for Construction. Built by Hoshmand AI.</p>
            </div>
            <div>
              <div className="text-white text-[11px] font-bold uppercase tracking-wider mb-3">Product</div>
              <a href="#features" className="block text-warm-500 text-[13px] py-1.5 hover:text-white/80 transition-colors">Features</a>
              <a href="#pricing" className="block text-warm-500 text-[13px] py-1.5 hover:text-white/80 transition-colors">Pricing</a>
              <a href="#how-it-works" className="block text-warm-500 text-[13px] py-1.5 hover:text-white/80 transition-colors">How It Works</a>
            </div>
            <div>
              <div className="text-white text-[11px] font-bold uppercase tracking-wider mb-3">Company</div>
              <a href="https://www.hoshmand.ai" className="block text-warm-500 text-[13px] py-1.5 hover:text-white/80 transition-colors">Hoshmand AI</a>
              <a href="mailto:support@hoshmand.ai" className="block text-warm-500 text-[13px] py-1.5 hover:text-white/80 transition-colors">Contact</a>
            </div>
            <div>
              <div className="text-white text-[11px] font-bold uppercase tracking-wider mb-3">Legal</div>
              <Link href="/privacy" className="block text-warm-500 text-[13px] py-1.5 hover:text-white/80 transition-colors">Privacy Policy</Link>
              <Link href="/terms" className="block text-warm-500 text-[13px] py-1.5 hover:text-white/80 transition-colors">Terms of Service</Link>
            </div>
          </div>
          <div className="border-t border-white/5 pt-5 flex flex-col md:flex-row items-center justify-between gap-2">
            <span className="text-warm-500/50 text-[12px]">© 2026 Planora. Built by Hoshmand AI. All rights reserved.</span>
            <span className="text-warm-500/30 text-[12px]">Built in Virginia</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
