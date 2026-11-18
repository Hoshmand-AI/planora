import { describe, it, expect } from 'vitest'
import { briefEmail, briefEmailHtml, briefEmailSubject, briefEmailText, sendDueBriefs, DIGEST_HOUR_UTC, DIGEST_NOTE } from './brief-digest'

const out = {
  brief: {
    asOf: '2026-11-10', dataDate: '2026-11-03',
    headline: { status: 'behind', daysBehind: 35, forecast: '2027-08-12', required: '2027-07-08', requiredSource: 'Contract', milestone: null, text: 'Behind: forecast 2027-08-12.' },
    progress: { percentComplete: 81, finished: 22, total: 46 },
    audiences: { pm: ['Behind: forecast 2027-08-12.'], field: ['Starts today: E4047.'], client: ['Forecast 2027-08-12.'] },
    signals: [{ kind: 'delay', quote: 'Switchgear is <3 weeks> late & the vendor failed the test.', days: 15, activity: { id: 'a1', code: 'P1030', name: 'Procure Switchgear' }, documentId: 'd1', title: 'OAC minutes', citation: 'OAC minutes, p. 2', docType: 'minutes' }],
    whatIfs: [{ title: 'Default what-if: P1030 Procure Switchgear +5 work days', text: 'If P1030 takes 5 work days longer, the finish moves from 2027-08-12 to 2027-08-19.', finishBefore: '2027-08-12', finishAfter: '2027-08-19', days: 7 }],
  },
  alerts: [{ level: 'act', section: 'contract', text: 'Written notice is due within 7 days.' }, { level: 'watch', section: 'today', text: 'Today: 1 start.' }],
  schedule: { id: 's 1', name: 'Data Center <Phase 2>' },
} as unknown as Parameters<typeof briefEmailText>[0]
// A brief with nothing to measure against: no forecast, no required date, no activities, no alerts.
const bare = {
  brief: { asOf: '2026-11-10', dataDate: null, headline: { status: 'unknown', daysBehind: null, forecast: null, required: null, requiredSource: null, milestone: null, text: '' }, progress: { percentComplete: null, finished: 0, total: 0 }, audiences: { pm: ['The schedule has no calculated finish yet.'], field: [], client: [] }, signals: [], whatIfs: [] },
  alerts: [], schedule: { id: 's2', name: 'Empty' },
} as unknown as Parameters<typeof briefEmailText>[0]
const order = (t: string, ...parts: string[]) => parts.map(x => t.indexOf(x))
const ascending = (xs: number[]) => xs.every((x, i) => x >= 0 && (i === 0 || x > xs[i - 1]))

describe('daily brief email', () => {
  it('carries the chosen version, what needs action, US dates and a link', () => {
    const t = briefEmailText(out, 'pm', 'https://app.example')
    expect(t).toContain('Data Center <Phase 2>: daily brief for 11/10/2026 (Project manager)')
    expect(t).toContain('- Behind: forecast 08/12/2027.')
    expect(t).toContain('Needs attention today:\n- Written notice is due within 7 days.')
    expect(t).not.toContain('Today: 1 start.') // watch items stay on the page
    expect(t).toContain('https://app.example/dashboard/project?schedule=s%201')
  })
  it('the client version leaves out the internal action list, the correspondence and the what-if runs', () => {
    const t = briefEmailText(out, 'client', '')
    expect(t).toContain('- Forecast 08/12/2027.')
    expect(t).not.toContain('Needs attention today')
    expect(t).not.toContain('Email and meetings')
    expect(t).not.toContain('What-ifs')
    expect(t).toContain('open the project Overview')
    const h = briefEmailHtml(out, 'client', '')
    expect(h).not.toContain('Needs attention today')
    expect(h).not.toContain('Switchgear')
  })
  it('the subject line is unchanged', () => {
    expect(briefEmailSubject(out)).toBe('Daily brief: Data Center <Phase 2>, 11/10/2026')
  })
  it('the text part gives the four figures, then the parts in the order of the tabs', () => {
    const t = briefEmailText(out, 'pm', 'https://app.example', DIGEST_NOTE)
    expect(t).toContain('Data date 11/03/2026')
    expect(t).toContain('Forecast finish: 08/12/2027\nRequired finish: 07/08/2027 (Forecast is 35 days late)\nComplete, by duration: 81% (22 of 46 activities finished)\nAlerts to act on today: 1 of 2')
    expect(ascending(order(t, 'Forecast finish:', 'Project manager:', 'Needs attention today:', 'Email and meetings:', 'What-ifs:', 'Open the full brief:', 'You get this every working morning'))).toBe(true)
    expect(t).toContain('- OAC minutes, p. 2, about P1030 Procure Switchgear, 15 work days\n  "Switchgear is <3 weeks> late & the vendor failed the test."')
    expect(t).toContain('the finish moves from 08/12/2027 to 08/19/2027.')
    // The field version has the action list, not the project manager's reading of the correspondence.
    const f = briefEmailText(out, 'field', '')
    expect(f).toContain('Field:\n- Starts today: E4047.')
    expect(f).toContain('Needs attention today:')
    expect(f).not.toContain('Email and meetings')
  })
  it('the HTML part has the wordmark, the project, the date, the four figures in a table and the same parts in the same order', () => {
    const { html, text } = briefEmail(out, 'pm', 'https://app.example', DIGEST_NOTE)
    expect(text).toBe(briefEmailText(out, 'pm', 'https://app.example', DIGEST_NOTE))
    expect(ascending(order(html.slice(html.indexOf('>RunF9<')), '>RunF9<', 'Daily Brief', '11/10/2026', 'Data Center &lt;Phase 2&gt;', 'Data date 11/03/2026', '08/12/2027', 'Forecast finish', '07/08/2027', 'Required finish', 'Forecast is 35 days late', '81%', 'Complete, by duration', '1 of 2', 'Alerts to act on today',
      '>Project manager</h2>', '>Needs attention today</h2>', '>Email and meetings</h2>', '>What-ifs</h2>', 'Open the full brief', 'You get this every working morning'))).toBe(true)
    // Every line of the text part's lists is in the HTML part too.
    for (const line of ['Behind: forecast 08/12/2027.', 'Written notice is due within 7 days.', 'the finish moves from 08/12/2027 to 08/19/2027.']) expect(html).toContain(line)
    expect(html).toContain('href="https://app.example/dashboard/project?schedule=s%201"')
  })
  it('the HTML part escapes what it quotes and loads nothing from a server', () => {
    const html = briefEmailHtml(out, 'pm', 'https://app.example')
    expect(html).toContain('Switchgear is &lt;3 weeks&gt; late &amp; the vendor failed the test.')
    expect(html).not.toContain('<Phase 2>')
    // No picture, script, stylesheet or frame: nothing a mail client would block, and no tracking pixel.
    expect(html).not.toMatch(/<(img|script|link|iframe|object|embed|video|audio|source)\b/i)
    expect(html).not.toMatch(/url\(|@import|\bsrc=|background=/i)
    // The only address in it is the link to the brief.
    expect([...new Set([...html.matchAll(/https?:\/\/[^"<\s]+/g)].map(m => m[0]))]).toEqual(['http://www.w3.org/1999/xhtml', 'https://app.example/dashboard/project?schedule=s%201'])
  })
  it('a figure that does not exist is worded, never a number', () => {
    const t = briefEmailText(bare, 'pm', '')
    expect(t).toContain('Forecast finish: Not calculated\nRequired finish: Not set\nComplete, by duration: Not available\nAlerts to act on today: None')
    expect(t).not.toContain('Data date')
    const h = briefEmailHtml(bare, 'pm', '')
    for (const w of ['Not calculated', 'Not set', 'Not available', 'None']) expect(h).toContain(`>${w}</div>`)
    expect(h).not.toContain('Needs attention today')
    expect(h).toContain('Open RunF9 and open the project Overview for the full brief.')
    expect(h).not.toContain('href=')
  })
  it('nothing is sent at weekends, before the morning hour, or without email set up', async () => {
    const sat = new Date(Date.UTC(2026, 10, 14, DIGEST_HOUR_UTC + 1)), early = new Date(Date.UTC(2026, 10, 10, DIGEST_HOUR_UTC - 1))
    expect(await sendDueBriefs(sat)).toEqual({ sent: 0, skipped: 0 })
    expect(await sendDueBriefs(early)).toEqual({ sent: 0, skipped: 0 })
    expect(await sendDueBriefs(new Date(Date.UTC(2026, 10, 10, DIGEST_HOUR_UTC + 1)))).toEqual({ sent: 0, skipped: 0 }) // no provider in unit tests
  })
})
