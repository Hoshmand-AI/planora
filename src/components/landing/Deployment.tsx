'use client'

// "Run it where your data lives": the visitor picks where RunF9 should run (RunF9 Cloud, their own
// AWS / Azure / Google Cloud account, or their own servers) and sees what that means for their data
// and AI, honestly labelled as available now or on request. The plan behind it:
// docs/strategy/DEPLOYMENT-OPTIONS.md; claims: docs/marketing/CLAIMS-REGISTER.md.

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Cloud, Server, Database, Sparkles, ShieldCheck } from 'lucide-react'
import { Reveal } from './motion'

interface Option {
  id: string
  tab: string
  title: string
  status: 'Available now' | 'On request'
  data: string
  ai: string
  fit: string
  cta: string
}

const OPTIONS: Option[] = [
  {
    id: 'cloud', tab: 'RunF9 Cloud', title: 'RunF9 Cloud', status: 'Available now',
    data: 'Hosted by RunF9 (Vercel and Neon, United States). Your firm’s data is kept separate from every other firm’s.',
    ai: 'Off until your admin turns it on; then Anthropic Claude. Projects marked CUI or classified are never sent to it.',
    fit: 'Teams that want to start today.',
    cta: '',
  },
  {
    id: 'aws', tab: 'Your AWS', title: 'In your AWS account', status: 'On request',
    data: 'Your AWS account: RunF9’s container and your own PostgreSQL (Amazon RDS or Aurora), including AWS GovCloud.',
    ai: 'None, or a model you host in your account. An Amazon Bedrock connector is built with your deployment.',
    fit: 'Firms whose data must stay in their AWS tenant.',
    cta: 'Ask about AWS',
  },
  {
    id: 'azure', tab: 'Your Azure', title: 'In your Microsoft Azure subscription', status: 'On request',
    data: 'Your Azure subscription: RunF9’s container and Azure Database for PostgreSQL, including Azure Government.',
    ai: 'None, or a model you host in your subscription. An Azure OpenAI connector is built with your deployment.',
    fit: 'Firms that run on Microsoft 365 and Azure.',
    cta: 'Ask about Azure',
  },
  {
    id: 'gcp', tab: 'Your Google Cloud', title: 'In your Google Cloud project', status: 'On request',
    data: 'Your Google Cloud project: RunF9’s container and Cloud SQL for PostgreSQL.',
    ai: 'None, or a model you host in your project. A Vertex AI connector is built with your deployment.',
    fit: 'Firms standardized on Google Cloud.',
    cta: 'Ask about Google Cloud',
  },
  {
    id: 'mixed', tab: 'Per client', title: 'A different cloud for each client', status: 'On request',
    data: 'Each client’s projects run in a RunF9 deployment inside the cloud that client requires: Azure for one, AWS or Google Cloud for another. Schedules, documents and the document-search index stay in that cloud’s own database; nothing is copied between them.',
    ai: 'Each deployment uses the AI in its own cloud (Azure OpenAI, Amazon Bedrock or Google Vertex AI) or none, so a client’s data never reaches another client’s cloud.',
    fit: 'Firms whose owners and clients each mandate a cloud. Your team signs in to every deployment with the same company login (SSO).',
    cta: 'Ask about multi-cloud',
  },
  {
    id: 'onprem', tab: 'Your servers', title: 'On your own servers, air-gapped', status: 'Available now',
    data: 'Your servers, with no internet connection needed. Built for projects marked CUI or classified (your security office accredits the system).',
    ai: 'None, or a model on your own hardware (for example Ollama or vLLM). Every release is checked to send nothing outside your network.',
    fit: 'Defense, government and owners with the strictest rules.',
    cta: 'Ask about on-premises',
  },
]

const ROW = [
  { key: 'data' as const, label: 'Where your data lives', icon: Database },
  { key: 'ai' as const, label: 'AI', icon: Sparkles },
  { key: 'fit' as const, label: 'Best for', icon: ShieldCheck },
]

export default function Deployment({ primaryHref, primaryLabel, contactEmail }: { primaryHref: string; primaryLabel: string; contactEmail: string }) {
  const [active, setActive] = useState(0)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const o = OPTIONS[active]
  // Links such as #deployment-azure (the hero's cloud chips) open that option.
  useEffect(() => {
    const sync = () => {
      const m = /^#deployment-(\w+)$/.exec(window.location.hash)
      const i = m ? OPTIONS.findIndex(x => x.id === m[1]) : -1
      if (i < 0) return
      setActive(i)
      document.getElementById('deployment')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])
  const select = (i: number) => { const n = (i + OPTIONS.length) % OPTIONS.length; setActive(n); tabs.current[n]?.focus() }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); select(active + 1) }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); select(active - 1) }
    else if (e.key === 'Home') { e.preventDefault(); select(0) }
    else if (e.key === 'End') { e.preventDefault(); select(OPTIONS.length - 1) }
  }
  const href = o.id === 'cloud' ? primaryHref : `mailto:${contactEmail}?subject=${encodeURIComponent(`RunF9 private deployment: ${o.id === 'mixed' ? 'a different cloud per client' : o.tab.replace(/^Your /, '')}`)}`
  const cta = o.id === 'cloud' ? primaryLabel : o.cta
  const btn = 'pressable inline-flex items-center justify-center rounded-full bg-accent-600 text-white font-semibold hover:bg-accent-700 transition-colors px-7 py-3 text-[15px]'

  return (
    <section id="deployment" aria-labelledby="deployment-h" className="max-w-6xl mx-auto px-6 pb-24 md:pb-36 scroll-mt-20">
      <Reveal className="text-center mb-10 md:mb-12">
        <h2 id="deployment-h" className="text-[36px] md:text-[56px] font-semibold tracking-[-0.04em] text-navy-950 leading-[1.05]">Run it where your data lives.</h2>
        <p className="text-[17px] md:text-[19px] text-warm-600 mt-4 max-w-[640px] mx-auto">One RunF9, the same features everywhere. Choose our cloud, your own AWS, Azure or Google Cloud account, a different cloud for each client, or your own servers.</p>
      </Reveal>
      <Reveal className="max-w-[880px] mx-auto">
        <div role="tablist" aria-label="Where RunF9 runs" onKeyDown={onKey} className="flex gap-1 overflow-x-auto p-1 rounded-full bg-warm-100 border border-warm-200 w-fit max-w-full mx-auto">
          {OPTIONS.map((x, i) => (
            <button
              key={x.id} ref={el => { tabs.current[i] = el }} type="button" role="tab" id={`dep-tab-${x.id}`}
              aria-selected={i === active} aria-controls="dep-panel" tabIndex={i === active ? 0 : -1}
              onClick={() => setActive(i)}
              className={`whitespace-nowrap rounded-full px-4 py-2 text-[14px] font-medium transition-colors ${i === active ? 'bg-white text-navy-950 shadow-sm' : 'text-warm-600 hover:text-navy-950'}`}
            >{x.tab}</button>
          ))}
        </div>
        <div id="dep-panel" role="tabpanel" aria-labelledby={`dep-tab-${o.id}`} className="mt-6 rounded-[28px] bg-white border border-warm-200 p-7 md:p-10">
          <div key={o.id} className="rise-in">
            <div className="flex flex-wrap items-center gap-3">
              {o.id === 'onprem' ? <Server size={22} className="text-accent-600" aria-hidden /> : <Cloud size={22} className="text-accent-600" aria-hidden />}
              <h3 className="text-[22px] md:text-[26px] font-semibold tracking-[-0.02em] text-navy-950">{o.title}</h3>
              <span className={`text-[12.5px] font-semibold rounded-full px-2.5 py-1 ${o.status === 'Available now' ? 'bg-status-on-track-bg text-status-on-track' : 'bg-accent-100 text-accent-700'}`}>{o.status}</span>
            </div>
            <dl className="mt-6 grid gap-5 md:grid-cols-3">
              {ROW.map(r => (
                <div key={r.key}>
                  <dt className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-warm-500"><r.icon size={14} aria-hidden />{r.label}</dt>
                  <dd className="mt-2 text-[15px] leading-relaxed text-warm-700">{o[r.key]}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              {href.startsWith('mailto:') ? <a href={href} className={btn}>{cta}</a> : <Link href={href} className={btn}>{cta}</Link>}
              {o.status === 'On request' && <p className="text-[13.5px] text-warm-600">Installed from the same container we run, in your account. Your data never passes through RunF9.</p>}
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  )
}
