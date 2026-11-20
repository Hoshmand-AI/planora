'use client'

// "Run it where your data lives": information only. The visitor picks RunF9 Cloud, their AWS / Azure /
// Google Cloud storage (connected in the app: src/components/CloudStorage.tsx), a cloud per client,
// or their own servers, and sees what that means for their data and AI. The plan behind it:
// docs/strategy/DEPLOYMENT-OPTIONS.md; claims: docs/marketing/CLAIMS-REGISTER.md.

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Cloud, Server, Database, Sparkles, ShieldCheck } from 'lucide-react'
import { Reveal } from './motion'
import { ANCHOR, Cta, PAD, primaryBtn, SectionHead, WRAP } from './Sections'

interface Option {
  id: string
  tab: string
  title: string
  status: 'Available now' | 'On request'
  data: string
  ai: string
  fit: string
}

const OPTIONS: Option[] = [
  {
    id: 'cloud', tab: 'RunF9 Cloud', title: 'RunF9 Cloud', status: 'Available now',
    data: 'Hosted by RunF9 (Vercel and Neon, United States). Your firm’s data is kept separate from every other firm’s.',
    ai: 'Off until your admin turns it on; then Anthropic Claude. Projects marked CUI or classified are never sent to it.',
    fit: 'Teams that want to start today.',
  },
  {
    id: 'aws', tab: 'AWS', title: 'Connect your Amazon S3', status: 'Available now',
    data: 'Connect an S3 bucket in your AWS account (GovCloud included). Import schedules and documents straight from it, and keep the original files there instead of in RunF9. Or run all of RunF9 in your AWS account, database included, from one template.',
    ai: 'The same AI choice as RunF9 Cloud. Inside your own AWS account: none, or a model you host; an Amazon Bedrock connector is built with that deployment.',
    fit: 'Firms whose files must stay in their AWS account.',
  },
  {
    id: 'azure', tab: 'Azure', title: 'Connect your Azure Blob Storage', status: 'Available now',
    data: 'Connect a container in your Azure storage account. Import schedules and documents straight from it, and keep the original files there. Or run all of RunF9 in your Azure subscription, database included, from one template.',
    ai: 'The same AI choice as RunF9 Cloud. Inside your own subscription: none, or a model you host; an Azure OpenAI connector is built with that deployment.',
    fit: 'Firms that run on Microsoft 365 and Azure.',
  },
  {
    id: 'gcp', tab: 'Google Cloud', title: 'Connect your Google Cloud Storage', status: 'Available now',
    data: 'Connect a Cloud Storage bucket in your Google Cloud project. Import schedules and documents straight from it, and keep the original files there. Or run all of RunF9 in your project, database included, from one template.',
    ai: 'The same AI choice as RunF9 Cloud. Inside your own project: none, or a model you host; a Vertex AI connector is built with that deployment.',
    fit: 'Firms standardized on Google Cloud.',
  },
  {
    id: 'mixed', tab: 'Per client', title: 'A different cloud for each client', status: 'Available now',
    data: 'Connect as many storages as your clients require, for example the owner’s Azure for one project and AWS for another. On every upload your team picks where the file comes from and where the original is kept.',
    ai: 'Follows your organization’s AI setting. Projects marked CUI or classified are never sent to a cloud model.',
    fit: 'Firms whose owners and clients each mandate a cloud. For a whole RunF9 per client cloud (database included), deploy one copy in each.',
  },
  {
    id: 'onprem', tab: 'Your servers', title: 'On your own servers, air-gapped', status: 'Available now',
    data: 'Your servers, with no internet connection needed. Built for projects marked CUI or classified (your security office accredits the system).',
    ai: 'None, or a model on your own hardware (for example Ollama or vLLM). Every release is checked to send nothing outside your network.',
    fit: 'Defense, government and owners with the strictest rules.',
  },
]

const ROW = [
  { key: 'data' as const, label: 'Where your data lives', icon: Database },
  { key: 'ai' as const, label: 'AI', icon: Sparkles },
  { key: 'fit' as const, label: 'Best for', icon: ShieldCheck },
]

export default function Deployment({ primaryHref, primaryLabel }: { primaryHref: string; primaryLabel: string }) {
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
    // A second click on the same chip changes no hash, so follow the click as well.
    const onClick = (e: MouseEvent) => { if ((e.target as Element | null)?.closest?.('a[href^="#deployment-"]')) setTimeout(sync) }
    window.addEventListener('hashchange', sync)
    document.addEventListener('click', onClick)
    return () => { window.removeEventListener('hashchange', sync); document.removeEventListener('click', onClick) }
  }, [])
  const select = (i: number) => { const n = (i + OPTIONS.length) % OPTIONS.length; setActive(n); tabs.current[n]?.focus() }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); select(active + 1) }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); select(active - 1) }
    else if (e.key === 'Home') { e.preventDefault(); select(0) }
    else if (e.key === 'End') { e.preventDefault(); select(OPTIONS.length - 1) }
  }
  return (
    <section id="deployment" aria-labelledby="deployment-h" className={`bg-white border-t border-warm-200 ${ANCHOR}`}>
      <div className={`${WRAP} ${PAD}`}>
        <SectionHead id="deployment-h" eyebrow="Your cloud" title="Run it where your data lives."
          lead="One RunF9, the same features everywhere. Use our cloud, connect your own AWS, Azure or Google Cloud storage (a different one for each client if you need), or run it on your own servers." />
        <Reveal className="mt-12 md:mt-16">
          <div role="tablist" aria-label="Where RunF9 runs" onKeyDown={onKey} className="flex gap-1 overflow-x-auto p-1 rounded-full bg-warm-100 border border-warm-200 w-fit max-w-full">
            {OPTIONS.map((x, i) => (
              <button
                key={x.id} ref={el => { tabs.current[i] = el }} type="button" role="tab" id={`dep-tab-${x.id}`}
                aria-selected={i === active} aria-controls="dep-panel" tabIndex={i === active ? 0 : -1}
                onClick={() => setActive(i)}
                className={`whitespace-nowrap rounded-full px-4 py-2 text-small font-medium transition-colors ${i === active ? 'bg-white text-ink shadow-sm' : 'text-warm-600 hover:text-ink'}`}
              >{x.tab}</button>
            ))}
          </div>
          <div id="dep-panel" role="tabpanel" aria-labelledby={`dep-tab-${o.id}`} className="mt-6 rounded-[28px] bg-warm-50 border border-warm-200 p-7 md:p-12">
            <div key={o.id} className="rise-in">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                {o.id === 'onprem' ? <Server size={26} strokeWidth={1.6} className="text-accent-600" aria-hidden /> : <Cloud size={26} strokeWidth={1.6} className="text-accent-600" aria-hidden />}
                <h3 className="text-h3 md:text-h2 font-semibold tracking-[-0.01em] md:tracking-[-0.02em] text-ink leading-tight">{o.title}</h3>
                <span className={`text-caption font-semibold rounded-full px-2.5 py-1 ${o.status === 'Available now' ? 'bg-status-on-track-bg text-status-on-track' : 'bg-accent-100 text-accent-700'}`}>{o.status}</span>
              </div>
              <dl className="mt-8 grid gap-x-12 gap-y-8 md:grid-cols-3">
                {ROW.map(r => (
                  <div key={r.key} className="border-t border-warm-200 pt-5">
                    <dt className="flex items-center gap-2 text-small font-semibold text-ink"><r.icon size={16} className="text-accent-600" aria-hidden />{r.label}</dt>
                    <dd className="mt-2.5 text-copy leading-relaxed text-warm-700">{o[r.key]}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-4">
                <Cta href={primaryHref} className={`${primaryBtn} px-6 py-3 text-small`}>{primaryLabel}</Cta>
                <p className="text-small text-warm-600">{o.id === 'cloud' ? 'Hosted, updated and backed up by RunF9.' : o.id === 'onprem' ? 'Installed from the same container we run.' : <>Connect storage after you sign up, under Organization &gt; Cloud storage, or <Link href={`/deploy${o.id === 'mixed' ? '' : `#${o.id}`}`} className="font-semibold text-accent-700 underline underline-offset-4">run RunF9 in your own cloud</Link>.</>}</p>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
