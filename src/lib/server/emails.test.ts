import { describe, expect, it } from 'vitest'
import { fromHeader } from './email'
import { betaInviteEmail, orgInviteEmail, passwordResetEmail, verificationEmail } from './emails'

const ORIGIN = 'https://runf9.ai'

describe('sender', () => {
  it('always sends as "RunF9", taking only the address from EMAIL_FROM', () => {
    expect(fromHeader('Planora <no-reply@hoshmand.ai>')).toBe('RunF9 <no-reply@hoshmand.ai>')
    expect(fromHeader('alerts@runf9.ai')).toBe('RunF9 <alerts@runf9.ai>')
    expect(fromHeader(' "Old Name" <ops@example.com> ')).toBe('RunF9 <ops@example.com>')
    expect(fromHeader(undefined)).toBe('RunF9 <no-reply@hoshmand.ai>')
    expect(fromHeader('not an address')).toBe('RunF9 <no-reply@hoshmand.ai>')
  })

  it('never sends from an address named after the old brand', () => {
    expect(fromHeader('Planora <planora@hoshmand.ai>')).toBe('RunF9 <no-reply@hoshmand.ai>')
    expect(fromHeader('PLANORA@hoshmand.ai')).toBe('RunF9 <no-reply@hoshmand.ai>')
  })
})

describe('branded emails', () => {
  const all = [
    passwordResetEmail('Ada', `${ORIGIN}/auth/reset?token=abc`, 30, ORIGIN),
    verificationEmail('Ada', `${ORIGIN}/api/auth/verify?token=abc`, 48, ORIGIN),
    betaInviteEmail({ inviter: 'Ops', company: 'Acme Builders', email: 'pm@acme.test', link: `${ORIGIN}/auth?beta=abc`, days: 14 }, ORIGIN),
    orgInviteEmail({ inviter: 'Ada', inviterEmail: 'ada@acme.test', org: 'Acme', role: 'Editor', link: `${ORIGIN}/auth?invite=abc`, days: 7 }, ORIGIN),
  ]

  it('say RunF9, never Planora, in subject, HTML and text', () => {
    for (const m of all) {
      expect(`${m.subject}\n${m.html}\n${m.text}`).not.toMatch(/planora/i)
      expect(m.subject).toMatch(/RunF9/)
      expect(m.text).toMatch(/— RunF9 by Hoshmand AI$/)
    }
  })

  it('carry the link as a button and as plain text, with the logo, dark mode and a preheader', () => {
    for (const m of all) {
      const link = /(https:\/\/runf9\.ai\/[^\s]+)/.exec(m.text)![1]
      expect(m.html).toContain(`href="${link.replace(/&/g, '&amp;')}"`)
      expect(m.html).toContain(`${ORIGIN}/brand/runf9-email-logo-light.png`)
      expect(m.html).toContain('prefers-color-scheme: dark')
      expect(m.html).toMatch(/display:none;max-height:0/)
      expect(m.html).toMatch(/border-radius:999px/)
    }
  })

  it('escapes names so a crafted name cannot inject markup', () => {
    const m = orgInviteEmail({ inviter: '<script>x</script>', inviterEmail: 'a@b.c', org: 'A&B', role: 'Viewer', link: `${ORIGIN}/auth?invite=1`, days: 7 }, ORIGIN)
    expect(m.html).not.toContain('<script>')
    expect(m.html).toContain('&lt;script&gt;')
    expect(m.html).toContain('A&amp;B')
  })

  it('keeps the reset wording people rely on', () => {
    expect(all[0].text).toMatch(/expires in 30 minutes/)
    expect(all[0].text).toMatch(/If you didn't ask for this, ignore this message/)
  })
})
