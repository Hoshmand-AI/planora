import { describe, expect, it } from 'vitest'
import { currentName, upgradeLegacyData } from './legacy-data'

describe('legacy stored data', () => {
  it('renames old keys and values anywhere in stored JSON', () => {
    const stored = {
      recalc: { samples: [{ code: 'A1', fileFloat: 3, planoraFloat: 0, planoraFinish: '2026-10-09', planoraLateStart: null }] },
      frameworks: ['PLANORA_COMPOSITE', 'DCMA_14'],
      summary: { PLANORA_COMPOSITE: { score: 90 } },
      threshold: { source: 'planora_default' },
      when: new Date('2026-10-01T00:00:00Z'),
    }
    const up = upgradeLegacyData(stored)
    expect(up.recalc.samples[0]).toEqual({ code: 'A1', fileFloat: 3, runf9Float: 0, runf9Finish: '2026-10-09', runf9LateStart: null })
    expect(up.frameworks).toEqual(['RUNF9_COMPOSITE', 'DCMA_14'])
    expect(Object.keys(up.summary)).toEqual(['RUNF9_COMPOSITE'])
    expect((up.threshold as { source: string }).source).toBe('runf9_default')
    expect(up.when).toEqual(stored.when)
    expect(stored.frameworks[0]).toBe('PLANORA_COMPOSITE') // input untouched
  })
  it('leaves current names and ordinary text alone', () => {
    expect(currentName('GAO_SCHEDULE_GUIDE')).toBe('GAO_SCHEDULE_GUIDE')
    expect(upgradeLegacyData({ name: 'Planora tower', n: 1 })).toEqual({ name: 'Planora tower', n: 1 })
  })
})
