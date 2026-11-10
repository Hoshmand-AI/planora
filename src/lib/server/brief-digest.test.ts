import { describe, it, expect } from 'vitest'
import { briefEmailText, sendDueBriefs, DIGEST_HOUR_UTC } from './brief-digest'

const out = {
  brief: { asOf: '2026-11-10', audiences: { pm: ['Behind: forecast 2027-08-12.'], field: ['Starts today: E4047.'], client: ['Forecast 2027-08-12.'] } },
  alerts: [{ level: 'act', section: 'contract', text: 'Written notice is due within 7 days.' }, { level: 'watch', section: 'today', text: 'Today: 1 start.' }],
  schedule: { id: 's 1', name: 'Data Center' },
} as unknown as Parameters<typeof briefEmailText>[0]

describe('daily brief email', () => {
  it('carries the chosen version, what needs action, US dates and a link', () => {
    const t = briefEmailText(out, 'pm', 'https://app.example')
    expect(t).toContain('Data Center: daily brief for 11/10/2026 (Project manager)')
    expect(t).toContain('- Behind: forecast 08/12/2027.')
    expect(t).toContain('Needs attention today:\n- Written notice is due within 7 days.')
    expect(t).not.toContain('Today: 1 start.') // watch items stay on the page
    expect(t).toContain('https://app.example/dashboard/today?schedule=s%201')
  })
  it('the client version leaves out the internal action list', () => {
    const t = briefEmailText(out, 'client', '')
    expect(t).toContain('- Forecast 08/12/2027.')
    expect(t).not.toContain('Needs attention today')
    expect(t).toContain('choose the Today tab')
  })
  it('nothing is sent at weekends, before the morning hour, or without email set up', async () => {
    const sat = new Date(Date.UTC(2026, 10, 14, DIGEST_HOUR_UTC + 1)), early = new Date(Date.UTC(2026, 10, 10, DIGEST_HOUR_UTC - 1))
    expect(await sendDueBriefs(sat)).toEqual({ sent: 0, skipped: 0 })
    expect(await sendDueBriefs(early)).toEqual({ sent: 0, skipped: 0 })
    expect(await sendDueBriefs(new Date(Date.UTC(2026, 10, 10, DIGEST_HOUR_UTC + 1)))).toEqual({ sent: 0, skipped: 0 }) // no provider in unit tests
  })
})
