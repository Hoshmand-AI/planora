import type { Metadata } from 'next'
import Link from 'next/link'
import { Logo } from '@/components/Logo'
import { deployOptions } from '@/lib/deploy-options'
import { siteUrl } from '@/lib/site-url'

export const metadata: Metadata = {
  title: 'Run RunF9 in your own cloud — RunF9',
  description: 'Deploy RunF9 in your own AWS, Azure or Google Cloud account: the app, its PostgreSQL database, your documents and the search index all stay in your account.',
}

/** Private deployment guide: one template per cloud, everything (database included) in the customer's account. */
export default function DeployPage() {
  const options = deployOptions(siteUrl())
  return (
    <div className="min-h-screen bg-warm-50">
      <nav className="h-16 flex items-center justify-between px-6 border-b border-warm-200 bg-white/80 backdrop-blur-xl">
        <Link href="/" aria-label="RunF9 home"><Logo variant="dark" size="h-[30px]" /></Link>
        <Link href="/#deployment" className="text-small text-accent-600 underline">All the ways to run RunF9</Link>
      </nav>
      <main className="max-w-[960px] mx-auto px-6 py-12">
        <h1 className="text-h2 md:text-h1 font-semibold tracking-[-0.02em] md:tracking-[-0.03em] text-ink leading-tight">Run RunF9 in your own cloud</h1>
        <p className="text-lead text-warm-700 mt-3 max-w-[720px] leading-snug">
          One template installs the whole of RunF9 in your account: the app, its PostgreSQL database, your schedules, analysis, documents and the document-search index.
          Nothing is stored with RunF9, and you choose the AI (your cloud&apos;s own, or none). For a client that requires a different cloud, deploy one copy in each.
        </p>
        <p className="text-fine text-warm-600 mt-3 max-w-[720px]">
          Preview: the templates are checked automatically (AWS with cfn-lint, Google with terraform validate) and we do the first install with you. Questions: support@hoshmand.ai.
        </p>

        <div className="mt-10 space-y-6">
          {options.map(o => (
            <section key={o.id} id={o.id} aria-labelledby={`${o.id}-h`} className="rounded-3xl border border-warm-200 bg-white p-6 md:p-8">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <h2 id={`${o.id}-h`} className="text-h3 font-semibold tracking-[-0.02em] text-ink">{o.cloud}</h2>
                <a href={o.launchUrl ?? o.template} {...(o.launchUrl ? { target: '_blank', rel: 'noopener noreferrer' } : { download: true })}
                  className="pressable inline-flex items-center rounded-full bg-accent-600 px-5 py-2.5 text-small font-semibold text-white hover:bg-accent-700">{o.launchLabel}</a>
              </div>
              <dl className="mt-4 grid gap-3 md:grid-cols-3 text-fine">
                <div><dt className="text-warm-600">App</dt><dd className="mt-0.5 font-medium text-ink">{o.runs}</dd></div>
                <div><dt className="text-warm-600">Database</dt><dd className="mt-0.5 font-medium text-ink">{o.database}</dd></div>
                <div><dt className="text-warm-600">AI</dt><dd className="mt-0.5 font-medium text-ink">{o.ai}</dd></div>
              </dl>
              <ol className="mt-5 list-decimal ml-5 space-y-1.5 text-small text-warm-700">{o.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
              {o.commands && <pre tabIndex={0} aria-label="Commands" className="mt-4 overflow-x-auto rounded-xl bg-navy-950 p-4 text-fine text-white"><code>{o.commands}</code></pre>}
              <p className="mt-4 text-fine text-warm-600">Template: <a href={o.template} className="text-accent-600 underline">{o.template.replace(/^https?:\/\//, '')}</a></p>
            </section>
          ))}
        </div>

        <section aria-labelledby="after-h" className="mt-10 text-small text-warm-700 space-y-2 max-w-[760px]">
          <h2 id="after-h" className="text-h3 font-semibold text-ink">After it is running</h2>
          <ul className="list-disc ml-5 space-y-1.5">
            <li>The first person to sign up creates the organization and becomes its owner. Then set sign-up to invite-only (the template&apos;s signup setting) and invite your team, or connect your company sign-in (SSO).</li>
            <li>Organization &gt; Where your data lives shows &quot;Your AWS account&quot; (or Azure, or Google Cloud) and the region.</li>
            <li>Upgrades: deploy the template again with the new image version; database changes are applied automatically and are always additive.</li>
            <li>Backups: your cloud&apos;s automated database backups (14 days by default). Keep the encryption key with them.</li>
          </ul>
        </section>
      </main>
    </div>
  )
}
