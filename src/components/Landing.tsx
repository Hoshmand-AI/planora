'use client'

import Link from 'next/link'
import { ArrowRight, Menu, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Logo } from '@/components/Logo'
import Hero from '@/components/landing/Hero'
import Pillars from '@/components/landing/Pillars'
import Deployment from '@/components/landing/Deployment'
import { UpdatesAndDelays } from '@/components/landing/UpdatesAndDelays'
import { ANCHOR, Audiences, Closing, Cta, DailyBrief, Faq, Figures, Footer, Integrations, PAD, Pricing, primaryBtn, Proof, Reports, SectionHead, Security, WRAP } from '@/components/landing/Sections'

const secondaryBtn = 'pressable inline-flex items-center justify-center rounded-full text-accent-600 font-semibold hover:bg-accent-100 transition-colors'

/** The sections the navigation bar links to, in page order. */
const NAV: [string, string][] = [['today', 'Daily Brief'], ['features', 'Features'], ['deployment', 'Your cloud'], ['security', 'Security'], ['pricing', 'Pricing'], ['faq', 'FAQ']]

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

  // The bar turns solid once the page has moved, and the link of the section being read is marked. A section is
  // "being read" from the moment its top passes a line a third of the way down the window until the next linked
  // section does; the sections between two links (updates, who it is for, reports, integrations) belong to the
  // link above them. Nothing is marked above the first linked section or below the last. One read of six
  // positions per animation frame while scrolling; nothing is written to the layout.
  const [scrolled, setScrolled] = useState(false)
  const [current, setCurrent] = useState<string | null>(null)
  useEffect(() => {
    const els = NAV.map(([id]) => document.getElementById(id)).filter((el): el is HTMLElement => !!el)
    let frame = 0
    const read = () => {
      frame = 0
      setScrolled(window.scrollY > 8)
      const line = Math.min(window.innerHeight * 0.35, 320)
      let at: string | null = null
      for (const el of els) if (el.getBoundingClientRect().top <= line) at = el.id
      const last = els[els.length - 1]
      if (last && at === last.id && last.getBoundingClientRect().bottom <= line) at = null
      setCurrent(at)
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(read) }
    read()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); if (frame) cancelAnimationFrame(frame) }
  }, [])

  const mail = (subject: string) => `mailto:${accessRequestEmail || 'support@hoshmand.ai'}?subject=${encodeURIComponent(subject)}`
  const questionHref = mail('RunF9 question')
  const demoHref = mail('RunF9 demo request')
  const contactHref = mail('RunF9 security documents')

  return (
    <div className="min-h-screen bg-warm-50 text-warm-600">
      {/* Navbar: quiet, the logo carries it; the link of the section on screen is marked */}
      <nav aria-label="Primary" className={`sticky top-0 z-50 transition-[background-color,border-color] duration-300 border-b ${scrolled || menuOpen ? 'bg-white border-warm-200' : 'bg-transparent border-transparent'}`}>
        <div className={`${WRAP} h-[76px] md:h-[84px] flex items-center justify-between`}>
          <Link href="/" aria-label="RunF9 home" className="flex items-center">
            <Logo variant="dark" size="h-[36px]" />
          </Link>
          <div className="hidden lg:flex items-center gap-7 xl:gap-9 whitespace-nowrap">
            {NAV.map(([id, label]) => (
              <a key={id} href={`#${id}`} aria-current={current === id ? 'true' : undefined}
                className={`relative py-2 text-small font-medium transition-colors ${current === id ? 'text-accent-700' : 'text-ink hover:text-accent-700'}`}>
                {label}
                <span aria-hidden className={`absolute inset-x-0 -bottom-0.5 h-0.5 rounded-full bg-accent-600 origin-left transition-transform duration-300 ${current === id ? 'scale-x-100' : 'scale-x-0'}`} />
              </a>
            ))}
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
            {NAV.map(([id, label]) => (
              <a key={id} href={`#${id}`} aria-current={current === id ? 'true' : undefined} onClick={() => setMenuOpen(false)}
                className={`flex items-center gap-3 py-3 text-copy border-b border-warm-200 ${current === id ? 'font-semibold text-accent-700' : 'text-ink'}`}>
                <span aria-hidden className={`h-5 w-[3px] rounded-full ${current === id ? 'bg-accent-600' : 'bg-transparent'}`} />{label}
              </a>
            ))}
            <Link href="/auth" className="flex items-center gap-3 py-3 text-copy text-ink border-b border-warm-200"><span aria-hidden className="h-5 w-[3px]" />Sign in</Link>
            <Cta href={primaryHref} className={`${primaryBtn} w-full mt-5 py-3 text-copy`}>{primaryLabel}</Cta>
          </div>
        )}
      </nav>

      {/* First screen: what RunF9 does with a schedule, in one sentence, and a window for each verb */}
      <Hero />

      {/* Facts: each figure is backed by an automated test or the product's own limits (see "Where these numbers come from") */}
      <Figures inviteOnly={inviteOnly} evidenceOpen={evidenceOpen} onToggleEvidence={() => setEvidenceOpen(v => !v)} />
      <Proof />

      {/* The Daily Brief, shown as product */}
      <DailyBrief />

      {/* Build. Check. Forecast. */}
      <section id="features" aria-labelledby="features-h" className={ANCHOR}>
        <div className={`${WRAP} ${PAD}`}>
          <SectionHead id="features-h" eyebrow="Features" title="Everything a scheduler does. Shown, not hidden."
            lead="RunF9 does the repetitive parts of scheduling and shows its work, so you can review and defend the result." className="mb-12 md:mb-16" />
          <Pillars />
        </div>
      </section>

      {/* After the baseline: monthly update comparison and Time Impact Analysis */}
      <UpdatesAndDelays />

      {/* Who it is for */}
      <Audiences />

      <Reports />

      {/* What it connects to */}
      <Integrations />

      {/* Choose the cloud: RunF9 Cloud, the firm's own AWS / Azure / Google account, a different cloud per client, or air-gapped */}
      <Deployment primaryHref={primaryHref} primaryLabel={primaryLabel} />

      <Security contactHref={contactHref} />

      {/* Pricing: licensed per organization, quoted after a demo on the firm's own schedule */}
      <Pricing inviteOnly={inviteOnly} demoHref={demoHref} questionHref={questionHref} />

      <Faq />

      <Closing inviteOnly={inviteOnly} primaryHref={primaryHref} />
      <Footer />
    </div>
  )
}
