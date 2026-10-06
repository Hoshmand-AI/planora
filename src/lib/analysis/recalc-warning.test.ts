import { describe, expect, it } from 'vitest'
import { describeDifference, importNotes, recalcWarning } from './recalc-warning'

describe('importNotes', () => {
  const uploadNote = 'The file did not include calculated dates or float, so Planora scheduled 40 activities from their durations, logic and calendars (retained logic; critical path and float are Planora\'s calculation).'
  const loadNote = 'Planora recalculated all 40 activities from their durations, logic, calendars and constraints (retained logic) instead of using the dates and float stored in the file; differences from the file are listed in the analysis.'
  it('keeps the upload-time note and does not add a contradictory one on read', () => {
    expect(importNotes([uploadNote, 'Calendar "X": odd'], loadNote, true, null)).toEqual([uploadNote, 'Calendar "X": odd'])
  })
  it('adds the read-time note for older uploads that recorded none, once', () => {
    expect(importNotes(['a', 'a'], loadNote, false, null)).toEqual([loadNote, 'a'])
    expect(importNotes([], loadNote, true, null)).toEqual([])
  })
  it('rewrites the stored file-vs-Planora comparison from its samples', () => {
    const old = '2 of 9 open activities have a finish or total float in the file that differs from Planora\'s recalculation by more than 1 day (e.g. A1: file 5d / Planora 5d float).'
    const out = importNotes([old], null, true, { compared: 9, differing: 2, samples: [{ code: 'A1', name: 'x', fileFinish: '2026-01-01', planoraFinish: '2026-01-10', fileFloat: 5, planoraFloat: 5 }] })
    expect(out).toHaveLength(1)
    expect(out[0]).toContain('A1: finish file 01/01/2026 / Planora 01/10/2026')
    expect(out[0]).not.toContain('5d / Planora 5d')
  })
})

describe('recalcWarning', () => {
  it('lists only the field that differs, with US dates', () => {
    const w = recalcWarning({
      compared: 50, differing: 3, samples: [
        { code: 'A100', name: 'Pour', fileFinish: '2026-10-01', planoraFinish: '2026-10-09', fileFloat: 5, planoraFloat: 5 },
        { code: 'A200', name: 'Frame', fileFinish: '2026-10-01', planoraFinish: '2026-10-01', fileFloat: 10, planoraFloat: 2 },
        { code: 'A300', name: 'Roof', fileFinish: '2026-10-01', planoraFinish: '2026-10-05', fileFloat: 0, planoraFloat: -4 },
      ],
    })!
    expect(w).toContain('A100: finish file 10/01/2026 / Planora 10/09/2026')
    expect(w).not.toMatch(/A100: [^;]*float/)
    expect(w).toContain('A200: float file 10d / Planora 2d')
    expect(w).not.toMatch(/A200: [^;]*finish/)
    expect(w).toContain('A300: finish file 10/01/2026 / Planora 10/05/2026, float file 0d / Planora -4d')
    expect(w).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })
  it('skips samples that differ by a day or less and returns null when nothing differs', () => {
    expect(describeDifference({ code: 'B', name: 'x', fileFinish: '2026-10-01', planoraFinish: '2026-10-02', fileFloat: 3, planoraFloat: 4 })).toBe('')
    expect(recalcWarning({ compared: 10, differing: 0, samples: [] })).toBeNull()
    expect(recalcWarning(null)).toBeNull()
  })
})
