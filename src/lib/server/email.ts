// Transactional email (verification links, invitations). Provider chosen by environment:
//   RESEND_API_KEY      → Resend (https://resend.com)
//   POSTMARK_TOKEN      → Postmark (https://postmarkapp.com)
//   RUNF9_EMAIL_OUTBOX=<dir>  → writes each message as JSON to a folder (tests/CI only)
// EMAIL_FROM sets the sending address (default no-reply@hoshmand.ai); the display name is always
// "RunF9", whatever name EMAIL_FROM carries, so the brand can't drift. Replies go to EMAIL_REPLY_TO
// (default support@hoshmand.ai). Messages carry the branded HTML (email-template.ts) and a plain-text
// part with the same words. With no provider, nothing is
// sent and the app keeps working: invitation links are shown to the admin and email verification
// is reported as unavailable instead of blocking anyone. Message bodies are never logged.

import fs from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import { log } from './log'
import { airgapped } from './egress'

export interface Email { to: string; subject: string; text: string; html?: string }

export function emailProvider(): 'resend' | 'postmark' | 'outbox' | null {
  if (process.env.RESEND_API_KEY) return 'resend'
  if (process.env.POSTMARK_TOKEN) return 'postmark'
  if (process.env.RUNF9_EMAIL_OUTBOX) return 'outbox'
  return null
}
export const emailConfigured = () => emailProvider() !== null
export const SENDER_NAME = 'RunF9'

/** "RunF9 <address>", taking only the address from EMAIL_FROM ("Name <a@b>" or "a@b"). */
export function fromHeader(env: string | undefined = process.env.EMAIL_FROM): string {
  const raw = (env || '').trim()
  const addr = (/<([^>]+)>/.exec(raw)?.[1] ?? raw).trim()
  if (!/^[^\s@<>]+@[^\s@<>]+$/.test(addr)) return `${SENDER_NAME} <no-reply@hoshmand.ai>`
  // An address still named after the old brand (runf9@…) sends as no-reply@ on the same domain
  const [local, domain] = addr.split('@')
  return `${SENDER_NAME} <${/^planora$/i.test(local) ? 'no-reply' : local}@${domain}>`
}
const FROM = () => fromHeader()
const REPLY_TO = () => process.env.EMAIL_REPLY_TO || 'support@hoshmand.ai'

export async function sendEmail(m: Email): Promise<{ sent: boolean; provider: string | null }> {
  const provider = emailProvider()
  const domain = m.to.split('@')[1] || ''
  try {
    if ((provider === 'resend' || provider === 'postmark') && airgapped()) {
      // Hosted email providers are on the internet; an air-gapped install never calls them.
      log('error', 'email refused', { provider, toDomain: domain, error: 'Air-gapped install: hosted email providers are outside the network.' })
      return { sent: false, provider }
    }
    if (provider === 'resend') {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(8000),
        headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: FROM(), to: [m.to], reply_to: REPLY_TO(), subject: m.subject, text: m.text, ...(m.html ? { html: m.html } : {}) }),
      })
      if (!res.ok) throw new Error(`Resend responded ${res.status}`)
    } else if (provider === 'postmark') {
      const res = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST', signal: AbortSignal.timeout(8000),
        headers: { 'x-postmark-server-token': process.env.POSTMARK_TOKEN!, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ From: FROM(), To: m.to, ReplyTo: REPLY_TO(), Subject: m.subject, TextBody: m.text, ...(m.html ? { HtmlBody: m.html } : {}), MessageStream: 'outbound' }),
      })
      if (!res.ok) throw new Error(`Postmark responded ${res.status}`)
    } else if (provider === 'outbox') {
      const dir = process.env.RUNF9_EMAIL_OUTBOX!
      await fs.mkdir(dir, { recursive: true })
      // Write then rename, so a reader never sees a half-written message.
      const file = path.join(dir, `${Date.now()}-${randomUUID()}.json`)
      await fs.writeFile(`${file}.tmp`, JSON.stringify({ from: FROM(), replyTo: REPLY_TO(), ...m }, null, 2))
      await fs.rename(`${file}.tmp`, file)
    } else {
      return { sent: false, provider: null }
    }
    log('info', 'email sent', { provider, toDomain: domain, subject: m.subject })
    return { sent: true, provider }
  } catch (err) {
    log('error', 'email failed', { provider, toDomain: domain, error: (err as Error).message })
    return { sent: false, provider }
  }
}

/** Public origin for links in emails: APP_URL if set, else the request's own origin. */
export function appOrigin(req: Request): string {
  return (process.env.APP_URL || new URL(req.url).origin).replace(/\/$/, '')
}
