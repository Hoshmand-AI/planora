import type { Metadata } from 'next'
import { LegalPage } from '@/components/LegalPage'

export const metadata: Metadata = { title: 'Privacy Policy — Planora' }

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" effective="10/04/2026">
      <p>Hoshmand AI (&quot;we&quot;, &quot;us&quot;) operates Planora, a construction scheduling application. This policy explains what Planora collects, why, who processes it, how long it is kept and the controls you have. If your organization has a signed agreement with us, that agreement takes precedence where it differs.</p>

      <h2>1. What we collect</h2>
      <ul>
        <li><strong>Account data:</strong> your name, work email, organization, role, and a one-way hash of your password (bcrypt). If you turn on two-step verification, its secret is stored encrypted and recovery codes are stored only as hashes.</li>
        <li><strong>Project data your organization adds:</strong> interview answers and notes, generated schedules, overrides with reasons, reviews and quality decisions. When you upload a schedule file (P6 XER, MS Project XML, Excel/CSV, PDF), Planora extracts the activities, relationships, calendars and dates and stores those; the original file is not kept.</li>
        <li><strong>Ask AI history:</strong> questions you ask about a schedule and the answers.</li>
        <li><strong>Security and audit records:</strong> sign-ins and failed sign-ins, the actions taken in Planora (for example &quot;exported plan&quot;, &quot;changed a role&quot;), with time, IP address and browser type. Your organization uses these to prove who did what.</li>
      </ul>
      <p>Planora uses one strictly necessary cookie to keep you signed in. It has no advertising or analytics trackers.</p>

      <h2>2. How we use it</h2>
      <p>To provide the service (scheduling, analysis, exports, AI features your organization allows), to secure accounts and detect abuse, to keep the audit record your organization relies on, and to support you when you ask. We do not sell personal data or use your organization&apos;s project data to train AI models or to serve other customers.</p>

      <h2>3. AI processing</h2>
      <ul>
        <li>Your organization controls AI. An admin can switch AI off completely, in which case nothing is sent to any model and Planora runs on its built-in rules.</li>
        <li>In <strong>cloud AI</strong> mode, the parts of a schedule needed to answer a request are sent to OpenAI&apos;s API. Under OpenAI&apos;s API terms, API data is not used to train their models by default.</li>
        <li>In <strong>on-premises / air-gapped</strong> deployments, requests go only to a model inside your own network.</li>
        <li>Interview answers marked &quot;Can&apos;t share&quot; are never sent to any model.</li>
        <li>Each AI request is logged with the model, purpose, size and a fingerprint (hash) of the request, but not its content, so your organization can audit AI use.</li>
      </ul>

      <h2>4. Who processes data for us</h2>
      <table>
        <thead><tr><th scope="col">Provider</th><th scope="col">Purpose</th><th scope="col">Data</th></tr></thead>
        <tbody>
          <tr><td>Vercel Inc.</td><td>Application hosting and request logs</td><td>All application traffic</td></tr>
          <tr><td>Neon Inc.</td><td>Managed PostgreSQL database and backups</td><td>Account, project and audit data</td></tr>
          <tr><td>OpenAI, L.L.C.</td><td>AI features, only when cloud AI is enabled for your organization</td><td>Request content described in section 3</td></tr>
        </tbody>
      </table>
      <p>On-premises deployments use none of these providers. We will update this list before adding a new provider that processes customer data.</p>

      <h2>5. How long we keep it</h2>
      <table>
        <thead><tr><th scope="col">Data</th><th scope="col">Kept</th></tr></thead>
        <tbody>
          <tr><td>Account data</td><td>While the account exists; deleted when you or your organization delete it</td></tr>
          <tr><td>Project data</td><td>Until your organization deletes it, or automatically after a period of inactivity your admin sets</td></tr>
          <tr><td>Ask AI history</td><td>365 days by default (your admin can change this)</td></tr>
          <tr><td>Audit records</td><td>For the life of the organization; deleted with it (a record that the deletion happened is kept)</td></tr>
          <tr><td>Ended sign-in sessions</td><td>30 days</td></tr>
          <tr><td>Rate-limit counters</td><td>2 days</td></tr>
          <tr><td>Database backups</td><td>Roll off on the database provider&apos;s backup schedule</td></tr>
        </tbody>
      </table>

      <h2>6. Your choices and rights</h2>
      <ul>
        <li>Download your personal data, or delete your account, under <strong>Account &amp; security</strong>.</li>
        <li>Organization admins can export all of the organization&apos;s data, set retention, remove members, and delete the organization under <strong>Organization</strong>.</li>
        <li>For any other request (access, correction, objection), email <a href="mailto:privacy@hoshmand.ai">privacy@hoshmand.ai</a>. Because project data belongs to your organization, we may refer requests about it to your organization&apos;s admin.</li>
      </ul>

      <h2>7. Security</h2>
      <p>Connections are encrypted with TLS, including the connection to the database (with certificate verification); data is encrypted at rest by our database provider. Access inside an organization is limited by role, every firm&apos;s data is kept separate, and sensitive actions are recorded in a tamper-evident audit log. See our security overview for details.</p>

      <h2>8. Changes and contact</h2>
      <p>We will post changes here with a new effective date and notify organization admins of material changes. Questions: <a href="mailto:privacy@hoshmand.ai">privacy@hoshmand.ai</a> · Hoshmand AI, <a href="https://www.hoshmand.ai">hoshmand.ai</a>.</p>
    </LegalPage>
  )
}
