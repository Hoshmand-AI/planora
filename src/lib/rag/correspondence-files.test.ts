import { describe, it, expect } from 'vitest'
import { emailToText, transcriptToText } from './correspondence-files'
import { extractDocument } from './extract'
import { extractSignals } from '@/lib/analysis/correspondence'

const eml = [
  'From: =?utf-8?B?Sm9zw6kgUMOpcmV6?= <jose@sub.example>', 'To: super@gc.example', 'Date: Mon, 9 Nov 2026 14:02:00 -0500',
  'Subject: =?utf-8?Q?Switchgear_ship_date?=', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="outer"', '',
  '--outer', 'Content-Type: multipart/alternative; boundary="alt"', '',
  '--alt', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable', '',
  'The medium-voltage switchgear will be delayed by 3 weeks; the vendor=', ' failed the breaker test. Caf=C3=A9 meeting tomorrow.', '',
  '--alt', 'Content-Type: text/html; charset=utf-8', '', '<p>HTML copy that must not be used</p>', '--alt--',
  '--outer', 'Content-Type: application/pdf; name="quote.pdf"', 'Content-Disposition: attachment; filename="quote.pdf"', 'Content-Transfer-Encoding: base64', '', 'JVBERi0xLjQK', '--outer--', '',
].join('\r\n')

describe('saved emails and meeting transcripts', () => {
  it('reads an email: decoded headers, the plain-text part, no attachment and no HTML copy', () => {
    const t = emailToText(eml)
    expect(t).toContain('From: José Pérez <jose@sub.example>')
    expect(t).toContain('Subject: Switchgear ship date')
    expect(t).toContain('delayed by 3 weeks; the vendor failed the breaker test. Café meeting tomorrow.')
    expect(t).not.toContain('HTML copy')
    expect(t).not.toContain('JVBERi0')
  })

  it('falls back to the HTML part without its markup', () => {
    const t = emailToText('Subject: Hold\r\nContent-Type: text/html\r\n\r\n<div>Inspection is <b>on hold</b>.</div><script>x()</script>')
    expect(t).toContain('Inspection is  on hold .'.replace(/\s+/g, ' ').slice(0, 10))
    expect(t).not.toContain('<b>')
    expect(t).not.toContain('x()')
  })

  it('HTML is reduced to text: nested tags cannot rebuild one, and entities are decoded once', () => {
    const t = emailToText('Content-Type: text/html\r\n\r\n<p>Hold <scr<script>x</script>ipt>alert(1)</scr</script >ipt> A &amp;lt; B &lt; C</p><SCRIPT type="x">steal()</SCRIPT foo>')
    expect(t).not.toMatch(/<script|<\/script|steal\(\)/i)
    expect(t).toContain('A &lt; B < C')
  })

  it('reads a Teams or Zoom transcript as speaker lines', () => {
    const vtt = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\n<v Dana PM>The switchgear will be delayed\n\n2\n00:00:04.000 --> 00:00:06.000\n<v Dana PM>by 3 weeks.\n\n3\n00:00:07.000 --> 00:00:09.000\n<v Sam Field>Understood.\n'
    expect(transcriptToText(vtt)).toBe('Dana PM: The switchgear will be delayed by 3 weeks.\nSam Field: Understood.')
    expect(transcriptToText('1\n00:00:01,000 --> 00:00:04,000\nPour is on hold\n\n2\n00:00:05,000 --> 00:00:06,000\nuntil Friday.\n')).toBe('Pour is on hold until Friday.')
  })

  it('an uploaded .eml flows through extraction into a schedule signal', async () => {
    const { pages, format } = await extractDocument(Buffer.from(eml), 'switchgear.eml')
    expect(format).toBe('txt')
    const s = extractSignals([{ documentId: 'd', title: 'Email', docType: 'email', citation: '', text: pages[0].text }], [{ id: 'a', code: 'P1030', name: 'Procure Medium-Voltage Switchgear', open: true }])
    expect(s[0]).toMatchObject({ kind: 'delay', days: 15, activity: { code: 'P1030' } })
  })
})
