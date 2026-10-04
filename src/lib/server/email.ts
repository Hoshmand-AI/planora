// Transactional email (verification links, invitations). Provider chosen by environment:
//   RESEND_API_KEY      → Resend (https://resend.com)
//   POSTMARK_TOKEN      → Postmark (https://postmarkapp.com)
//   PLANORA_EMAIL_OUTBOX=<dir>  → writes each message as JSON to a folder (tests/CI only)
// EMAIL_FROM sets the sender (default "Planora <no-reply@hoshmand.ai>"). With no provider, nothing is
// sent and the app keeps working: invitation links are shown to the admin and email verification
// is reported as unavailable instead of blocking anyone. Message bodies are never logged.

import fs from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import { log } from './log'

export interface Email { to: string; subject: string; text: string }

export function emailProvider(): 'resend' | 'postmark' | 'outbox' | null {
  if (process.env.RESEND_API_KEY) return 'resend'
  if (process.env.POSTMARK_TOKEN) return 'postmark'
  if (process.env.PLANORA_EMAIL_OUTBOX) return 'outbox'
  return null
}
export const emailConfigured = () => emailProvider() !== null
const FROM = () => process.env.EMAIL_FROM || 'Planora <no-reply@hoshmand.ai>'

export async function sendEmail(m: Email): Promise<{ sent: boolean; provider: string | null }> {
  const provider = emailProvider()
  const domain = m.to.split('@')[1] || ''
  try {
    if (provider === 'resend') {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(8000),
        headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: FROM(), to: [m.to], subject: m.subject, text: m.text }),
      })
      if (!res.ok) throw new Error(`Resend responded ${res.status}`)
    } else if (provider === 'postmark') {
      const res = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST', signal: AbortSignal.timeout(8000),
        headers: { 'x-postmark-server-token': process.env.POSTMARK_TOKEN!, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ From: FROM(), To: m.to, Subject: m.subject, TextBody: m.text, MessageStream: 'outbound' }),
      })
      if (!res.ok) throw new Error(`Postmark responded ${res.status}`)
    } else if (provider === 'outbox') {
      const dir = process.env.PLANORA_EMAIL_OUTBOX!
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(path.join(dir, `${Date.now()}-${randomUUID()}.json`), JSON.stringify({ from: FROM(), ...m }, null, 2))
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
