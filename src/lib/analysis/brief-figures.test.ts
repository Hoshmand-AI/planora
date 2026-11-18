import { describe, it, expect } from 'vitest'
import { briefFigures } from './brief-figures'
import type { DailyBrief } from './daily-brief'

const headline = (o: Partial<DailyBrief['headline']> = {}): DailyBrief['headline'] => ({ status: 'behind', daysBehind: 40, forecast: '2027-08-17', required: '2027-07-08', requiredSource: 'Contract', milestone: null, text: '', ...o })
const progress = { percentComplete: 81, finished: 22, total: 46 }
const alerts = [{ level: 'act' }, { level: 'act' }, { level: 'watch' }]
const byId = (f: ReturnType<typeof briefFigures>) => Object.fromEntries(f.map(x => [x.id, x]))

describe('daily brief figures', () => {
  it('gives the four figures in order, with US dates and the difference in days', () => {
    const f = briefFigures({ headline: headline(), progress }, alerts)
    expect(f.map(x => x.label)).toEqual(['Forecast finish', 'Required finish', 'Complete, by duration', 'Alerts to act on today'])
    expect(f.map(x => x.value)).toEqual(['08/17/2027', '07/08/2027', '81%', '2 of 3'])
    expect(byId(f).required.note).toBe('Forecast is 40 days late')
    expect(byId(f).complete.note).toBe('22 of 46 activities finished')
    expect(f.every(x => !x.missing)).toBe(true)
  })

  it('words the difference when early, on the date, one day late, or overdue with a forecast that has passed', () => {
    const note = (o: Partial<DailyBrief['headline']>) => byId(briefFigures({ headline: headline(o), progress }, [])).required.note
    expect(note({ daysBehind: -5, status: 'ahead' })).toBe('Forecast is 5 days early')
    expect(note({ daysBehind: 0, status: 'on_track' })).toBe('Forecast is on this date')
    expect(note({ daysBehind: 1 })).toBe('Forecast is 1 day late')
    // The required date passed with the work unfinished: the brief counts to today, and the file still shows the old date.
    expect(note({ daysBehind: 134, forecast: '2027-07-08' })).toBe('134 days overdue')
  })

  it('says a figure does not exist instead of showing a number', () => {
    const f = byId(briefFigures({ headline: headline({ status: 'unknown', daysBehind: null, forecast: null, required: null }), progress: { percentComplete: null, finished: 0, total: 0 } }, []))
    expect([f.forecast.value, f.required.value, f.complete.value, f.alerts.value]).toEqual(['Not calculated', 'Not set', 'Not available', 'None'])
    expect([f.forecast.missing, f.required.missing, f.complete.missing]).toEqual([true, true, true])
    expect(f.required.note).toBeNull()
    expect(f.complete.note).toBeNull()
    // A brief built before the figure existed has no progress at all.
    expect(byId(briefFigures({ headline: headline() }, [])).complete.value).toBe('Not available')
  })

  it('a forecast with no required date keeps its date and gives no difference', () => {
    const f = byId(briefFigures({ headline: headline({ status: 'unknown', daysBehind: null, required: null }), progress }, [{ level: 'watch' }]))
    expect(f.forecast.value).toBe('08/17/2027')
    expect(f.required.value).toBe('Not set')
    expect(f.required.note).toBeNull()
    expect(f.alerts.value).toBe('0 of 1')
  })
})
