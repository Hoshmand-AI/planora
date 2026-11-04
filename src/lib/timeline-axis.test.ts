import { describe, it, expect } from 'vitest'
import { axisTicks, axisUnit } from './timeline-axis'

const d = (iso: string) => Date.parse(iso + 'T00:00:00Z')

describe('schedule time ruler', () => {
  it('picks a coarser unit for longer spans and a finer one when zoomed in', () => {
    expect(axisUnit(d('2026-03-01'), d('2026-04-15'))).toBe('week')
    expect(axisUnit(d('2026-01-01'), d('2026-10-01'))).toBe('month')
    expect(axisUnit(d('2026-01-01'), d('2028-06-01'))).toBe('quarter')
    expect(axisUnit(d('2026-01-01'), d('2036-01-01'))).toBe('year')
    expect(axisUnit(d('2026-01-01'), d('2028-06-01'), 4)).toBe('month')
  })

  it('aligns month ticks to the 1st, inside the span, with the year on the first tick and on January', () => {
    const { unit, ticks } = axisTicks(d('2026-10-15'), d('2027-03-10'))
    expect(unit).toBe('month')
    // The span starts mid-October: a leading tick at the left edge names it.
    expect(ticks.map(x => x.label)).toEqual(['Oct 2026', 'Nov', 'Dec', 'Jan 2027', 'Feb', 'Mar'])
    expect(ticks[0]).toMatchObject({ t: d('2026-10-15'), lead: true })
    expect(ticks[1].t).toBe(d('2026-11-01'))
    expect(ticks.every(x => x.t >= d('2026-10-15') && x.t <= d('2027-03-10'))).toBe(true)
    // Starting exactly on a boundary needs no leading tick.
    expect(axisTicks(d('2026-11-01'), d('2027-03-10')).ticks[0]).toEqual({ t: d('2026-11-01'), label: 'Nov 2026' })
  })

  it('starts week ticks on Mondays and labels them as dates', () => {
    const { unit, ticks } = axisTicks(d('2026-03-04'), d('2026-04-01'))
    expect(unit).toBe('week')
    expect(ticks.map(x => x.label)).toEqual(['03/09/2026', '03/16/2026', '03/23/2026', '03/30/2026'])
    expect(ticks.every(x => new Date(x.t).getUTCDay() === 1)).toBe(true)
  })

  it('labels quarters and years', () => {
    expect(axisTicks(d('2026-02-01'), d('2027-12-31')).ticks.map(x => x.label)).toEqual(['Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026', 'Q1 2027', 'Q2 2027', 'Q3 2027', 'Q4 2027'])
    expect(axisTicks(d('2026-06-01'), d('2036-06-01')).ticks.slice(0, 2).map(x => x.label)).toEqual(['2026', '2027'])
  })

  it('returns no ticks for an empty span', () => {
    expect(axisTicks(d('2026-01-01'), d('2026-01-01')).ticks).toEqual([])
  })
})
