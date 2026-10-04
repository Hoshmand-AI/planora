import type { Metadata } from 'next'
import { LegalPage } from '@/components/LegalPage'

export const metadata: Metadata = { title: 'Terms of Service — Planora' }

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" effective="10/04/2026">
      <p>These terms govern use of Planora, provided by Hoshmand AI. If your organization has signed a master services agreement or order form with us, that agreement governs instead where it differs.</p>

      <h2>1. The service</h2>
      <p>Planora helps construction teams build, analyze and monitor CPM schedules: an interview that gathers project facts, schedule generation, quality checks (including the DCMA 14-point assessment), recovery modeling, exports to Primavera P6 and Microsoft Project, and optional AI assistance.</p>

      <h2>2. Planning support, not professional approval</h2>
      <ul>
        <li>Planora&apos;s outputs (schedules, durations, risk-adjusted dates, recovery options, quality findings, AI answers) are <strong>planning support</strong>. They are not engineering, legal or contractual advice, and are not an approved baseline until your qualified scheduler and the responsible parties review and accept them.</li>
        <li>Permit review times, regulations and lead times are reference ranges. Confirm them with the Authority Having Jurisdiction and suppliers before you rely on them.</li>
        <li>Risk-adjusted P50/P80 dates are estimates based on documented assumptions and, where available, your firm&apos;s history. They are not guarantees.</li>
        <li>You are responsible for decisions, submissions and contractual commitments made using Planora.</li>
      </ul>

      <h2>3. Accounts and security</h2>
      <p>Keep your credentials confidential and use two-step verification where your organization requires it. Each account is for one person. Organization owners and admins control membership, roles and policies and are responsible for removing people who should no longer have access.</p>

      <h2>4. Your data</h2>
      <p>Your organization owns the data it puts into Planora and the schedules and reports Planora produces for it. We use it only to provide and secure the service, as described in the <a href="/privacy">Privacy Policy</a>. Your organization can export its data at any time and delete it; when an organization is deleted, its data is removed from the live service and rolls off backups on the provider&apos;s schedule.</p>

      <h2>5. Acceptable use</h2>
      <p>Don&apos;t attempt to access another organization&apos;s data, probe or overload the service, bypass rate limits or security controls, upload malicious files, or use Planora to break the law. We may suspend access to protect the service or other customers, and will tell you why unless we are not allowed to.</p>

      <h2>6. Availability and changes</h2>
      <p>We work to keep Planora available and to fix problems quickly, but unless your agreement includes a service level, the service is provided without a guaranteed uptime. We may improve or change features; we will give admins notice before removing a feature they rely on.</p>

      <h2>7. Warranties and liability</h2>
      <p>Except as stated in a signed agreement, Planora is provided &quot;as is&quot;, without warranties of fitness for a particular purpose, and to the extent the law allows we are not liable for indirect or consequential losses, including project delays or claims, arising from use of the service.</p>

      <h2>8. Contact</h2>
      <p><a href="mailto:support@hoshmand.ai">support@hoshmand.ai</a> · <a href="https://www.hoshmand.ai">hoshmand.ai</a></p>
    </LegalPage>
  )
}
