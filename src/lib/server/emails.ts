// The words of every email RunF9 sends, in one place, rendered with the shared design
// (email-template.ts). Each builder returns the subject plus HTML and plain-text bodies.

import { renderEmail, type EmailContent } from './email-template'

export interface BuiltEmail { subject: string; html: string; text: string }

const build = (subject: string, content: EmailContent, origin: string): BuiltEmail => ({ subject, ...renderEmail(content, origin) })

export function passwordResetContent(name: string, link: string, minutes: number): EmailContent {
  return {
    preheader: `Choose a new password. The link expires in ${minutes} minutes.`,
    title: 'Reset your password',
    paragraphs: [`Hi ${name},`, 'Someone (hopefully you) asked to reset the password for your RunF9 account. Choose a new one with the button below.'],
    action: { label: 'Choose a new password', url: link },
    note: `The link works once and expires in ${minutes} minutes.`,
    footnote: "If you didn't ask for this, ignore this message: your password stays the same.",
  }
}
export const passwordResetEmail = (name: string, link: string, minutes: number, origin: string) =>
  build('Reset your RunF9 password', passwordResetContent(name, link, minutes), origin)

export const verificationEmail = (name: string, link: string, hours: number, origin: string) => build('Confirm your email for RunF9', {
  preheader: 'One click to confirm this is your address.',
  title: 'Confirm your email',
  paragraphs: [`Hi ${name},`, 'Confirm that this is your email address for RunF9. It keeps your account recoverable and lets you invite your team.'],
  action: { label: 'Confirm email address', url: link },
  note: `The link works once and expires in ${hours} hours.`,
  footnote: "If you didn't create a RunF9 account, ignore this message.",
}, origin)

export const betaInviteEmail = (o: { inviter: string; company: string | null; email: string; link: string; days: number }, origin: string) => build('Your invitation to the RunF9 private beta', {
  preheader: 'Create your firm’s private RunF9 workspace.',
  title: 'You’re invited to the RunF9 beta',
  paragraphs: [
    'Hi,',
    `${o.inviter} invited ${o.company || 'you'} to the RunF9 private beta. RunF9 builds and checks construction schedules and explains every duration and link.`,
    'You’ll own your firm’s private workspace and can invite colleagues from there.',
  ],
  action: { label: 'Create your firm’s account', url: o.link },
  note: `The link works once, only for ${o.email}, and expires in ${o.days} days.`,
}, origin)

export const orgInviteEmail = (o: { inviter: string; inviterEmail: string; org: string; role: string; link: string; days: number }, origin: string) => build(`${o.inviter} invited you to ${o.org} on RunF9`, {
  preheader: `Join ${o.org} on RunF9 as ${o.role}.`,
  title: `Join ${o.org} on RunF9`,
  paragraphs: [`${o.inviter} (${o.inviterEmail}) invited you to join ${o.org} on RunF9 as ${o.role}.`],
  action: { label: 'Accept invitation', url: o.link },
  note: `The link works once, only for this email address, and expires in ${o.days} days.`,
  footnote: 'Not expecting this? You can ignore it; nothing happens unless you accept.',
}, origin)
