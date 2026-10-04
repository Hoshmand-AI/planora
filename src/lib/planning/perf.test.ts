import { describe, expect, it } from 'vitest'
import { runCpm } from './cpm'
import type { CpmActivity, CpmLink } from './types'

// Capacity envelope: CPM on large synthetic networks (parallel chains with cross-links, mixed
// relationship types and lags, two calendars) must stay within these budgets on a CI runner.
// See docs/operations/CAPACITY.md for the measured numbers.
function network(n: number) {
  const activities: CpmActivity[] = [], links: CpmLink[] = []
  const chains = Math.max(10, Math.round(n / 200))
  for (let i = 0; i < n; i++) {
    activities.push({ id: `a${i}`, code: `A${i}`, name: `Activity ${i}`, duration: i % 25 === 0 ? 0 : 1 + (i * 7) % 15, type: i % 25 === 0 ? 'milestone' : 'task', calendarId: i % 9 === 0 ? 'cal-7d' : 'cal-5d' })
    if (i >= chains) links.push({ from: `a${i - chains}`, to: `a${i}`, type: 'FS', lag: 0 })
    if (i >= chains * 3 && i % 5 === 0) links.push({ from: `a${i - chains * 3 + 1}`, to: `a${i}`, type: i % 2 ? 'SS' : 'FF', lag: i % 3 })
  }
  const calendars = [
    { id: 'cal-5d', name: '5-day', workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidays: [] },
    { id: 'cal-7d', name: '7-day', workDays: [0, 1, 2, 3, 4, 5, 6], hoursPerDay: 8, holidays: [] },
  ]
  return { projectStart: '2027-01-04', activities, links, calendars, defaultCalendarId: 'cal-5d' }
}

describe('CPM performance budget', () => {
  for (const [n, budgetMs] of [[10_000, 2_000], [50_000, 8_000], [100_000, 15_000]] as const) {
    it(`${n.toLocaleString()} activities in under ${budgetMs / 1000}s`, () => {
      const input = network(n)
      const t = Date.now()
      const r = runCpm(input as never)
      const ms = Date.now() - t
      console.log(`CPM ${n} activities / ${input.links.length} links: ${ms} ms`)
      expect(Object.keys(r.times).length).toBe(n)
      expect(r.criticalPath.length).toBeGreaterThan(0)
      expect(ms).toBeLessThan(budgetMs)
    }, 60_000)
  }
})
