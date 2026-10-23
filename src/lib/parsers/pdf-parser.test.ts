import { describe, it, expect } from 'vitest'
import { parseFlexDate, parsePdfText } from './pdf-parser'

describe('PDF text dates (timezone-safe)', () => {
  it('reads printed dates as written, without a local-time shift', () => {
    const tz = process.env.TZ
    process.env.TZ = 'Asia/Tokyo' // east of UTC: new Date('11/02/2026').toISOString() gave 2026-11-01
    try {
      expect(parseFlexDate('11/02/2026')).toBe('2026-11-02')
      expect(parseFlexDate('11-02-2026')).toBe('2026-11-02')
      expect(parseFlexDate('02-Nov-26')).toBe('2026-11-02')
      expect(parseFlexDate('2026-11-02')).toBe('2026-11-02')
    } finally { process.env.TZ = tz }
  })

  it('takes the earliest and latest dates as the project span, not a print date in the page header', () => {
    const p = parsePdfText('Metra CREATE P2   Run date 10/23/2026\nA1000   Notice to Proceed   0d   02-Nov-26   02-Nov-26\nA1010   Mobilize site   10d   03-Nov-26   16-Nov-26', 's')
    const rows = p.activities.filter(a => a.name !== 'Metra CREATE P2').map(a => [a.name, a.earlyStart, a.earlyFinish])
    expect(rows).toEqual([['Notice to Proceed', '2026-11-02', '2026-11-02'], ['Mobilize site', '2026-11-03', '2026-11-16']])
    expect(p.projectFinish).toBe('2026-11-16')
    expect(p.relationships).toEqual([])
  })
})
