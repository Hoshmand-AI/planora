import { describe, expect, it } from 'vitest'
import { captureIsEmpty, captureSummary, distanceM, imageSize, parseCaptureFields, placeLabel, sniffMedia, MAX_NOTE_CHARS } from './capture'

const NOW = new Date('2026-11-17T15:00:00Z')
const ok = (b: Record<string, unknown>) => {
  const r = parseCaptureFields(b, NOW)
  if ('error' in r) throw new Error(r.error)
  return r.fields
}
const bytes = (...parts: (number[] | string)[]) => Uint8Array.from(parts.flatMap(p => typeof p === 'string' ? [...p].map(c => c.charCodeAt(0)) : p))

describe('parseCaptureFields', () => {
  it('needs a status, and says which ones exist', () => {
    const r = parseCaptureFields({ note: 'x' }, NOW)
    expect('error' in r && r.error).toMatch(/in progress, done, not started, problem/)
  })

  it('keeps line breaks in a dictated note and trims the rest', () => {
    const f = ok({ status: 'progress', note: '  Level 2,   Data Hall 1 \n\n\n\ncontainment   not finished  ' })
    expect(f.note).toBe('Level 2, Data Hall 1\n\ncontainment not finished')
    expect(ok({ status: 'issue', note: 'x'.repeat(MAX_NOTE_CHARS + 50) }).note).toHaveLength(MAX_NOTE_CHARS)
  })

  it('reads activity codes from a list, a JSON string or a comma list, without repeats', () => {
    expect(ok({ status: 'complete', activityCodes: ['D6010', ' D6010 ', 'E4020'] }).activityCodes).toEqual(['D6010', 'E4020'])
    expect(ok({ status: 'complete', activityCodes: '["A1","A2"]' }).activityCodes).toEqual(['A1', 'A2'])
    expect(ok({ status: 'complete', activityCodes: 'A1, A2,' }).activityCodes).toEqual(['A1', 'A2'])
    const r = parseCaptureFields({ status: 'complete', activityCodes: { a: 1 } }, NOW)
    expect('error' in r).toBe(true)
  })

  it('a place that was given is at least "picked"; no place has no source', () => {
    expect(ok({ status: 'progress', level: 'Level 2', room: 'Data Hall 1' })).toMatchObject({ level: 'Level 2', room: 'Data Hall 1', placeSource: 'picked' })
    expect(ok({ status: 'progress', room: 'Data Hall 1', placeSource: 'code' }).placeSource).toBe('code')
    expect(ok({ status: 'progress', placeSource: 'position' })).toMatchObject({ level: null, room: null, placeSource: 'none' })
  })

  it('accepts a position with its accuracy and refuses one that is not on the globe', () => {
    const f = ok({ status: 'progress', lat: '35.61234567891', lng: -81.2212, accuracyM: 8.44, altitudeM: '261.07', headingDeg: 359.6 })
    expect(f.position).toEqual({ lat: 35.6123457, lng: -81.2212, accuracyM: 8.4, altitudeM: 261.1, headingDeg: 0 })
    expect('error' in parseCaptureFields({ status: 'progress', lat: 95, lng: 10 }, NOW)).toBe(true)
    expect('error' in parseCaptureFields({ status: 'progress', lat: 35 }, NOW)).toBe(true)
    // A nonsense accuracy is dropped, not stored.
    expect(ok({ status: 'progress', lat: 1, lng: 1, accuracyM: -3 }).position?.accuracyM).toBeNull()
    expect(ok({ status: 'progress' }).position).toBeNull()
  })

  it("uses the phone's time, allows a capture that was saved offline, and refuses a clock set ahead", () => {
    expect(ok({ status: 'progress' }).takenAt).toBe(NOW.toISOString())
    expect(ok({ status: 'progress', takenAt: '2026-11-10T09:30:00-05:00' }).takenAt).toBe('2026-11-10T14:30:00.000Z')
    expect('error' in parseCaptureFields({ status: 'progress', takenAt: '2026-11-20T00:00:00Z' }, NOW)).toBe(true)
    expect('error' in parseCaptureFields({ status: 'progress', takenAt: 'yesterday' }, NOW)).toBe(true)
  })
})

describe('captureIsEmpty', () => {
  it('a capture needs a photo, a voice note or a few words', () => {
    expect(captureIsEmpty({ note: '' }, 0)).toBe(true)
    expect(captureIsEmpty({ note: 'ok' }, 0)).toBe(true)
    expect(captureIsEmpty({ note: 'Slab poured' }, 0)).toBe(false)
    expect(captureIsEmpty({ note: '' }, 1)).toBe(false)
  })
})

describe('sniffMedia', () => {
  it('recognizes photos and voice notes by their first bytes', () => {
    expect(sniffMedia(bytes([0xff, 0xd8, 0xff, 0xe0], 'JFIF....xxxx'))).toEqual({ kind: 'photo', contentType: 'image/jpeg' })
    expect(sniffMedia(bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a], 'xxxxxxxx'))).toEqual({ kind: 'photo', contentType: 'image/png' })
    expect(sniffMedia(bytes('RIFF', [1, 2, 3, 4], 'WEBPVP8 '))).toEqual({ kind: 'photo', contentType: 'image/webp' })
    expect(sniffMedia(bytes('RIFF', [1, 2, 3, 4], 'WAVEfmt '))).toEqual({ kind: 'audio', contentType: 'audio/wav' })
    expect(sniffMedia(bytes([0x1a, 0x45, 0xdf, 0xa3], 'xxxxxxxxxxxx'))).toEqual({ kind: 'audio', contentType: 'audio/webm' })
    expect(sniffMedia(bytes('OggS', 'xxxxxxxxxxxx'))).toEqual({ kind: 'audio', contentType: 'audio/ogg' })
    expect(sniffMedia(bytes([0, 0, 0, 0x1c], 'ftypM4A ', 'xxxx'))).toEqual({ kind: 'audio', contentType: 'audio/mp4' })
    expect(sniffMedia(bytes('ID3', [4, 0, 0, 0, 0, 0, 0], 'xxxx'))).toEqual({ kind: 'audio', contentType: 'audio/mpeg' })
  })

  it('refuses everything else: a web page, a script, an HEIC photo, a short file', () => {
    expect(sniffMedia(bytes('<!doctype html><html>'))).toBeNull()
    expect(sniffMedia(bytes('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull()
    expect(sniffMedia(bytes([0, 0, 0, 0x18], 'ftypheic', 'xxxx'))).toBeNull()
    expect(sniffMedia(bytes([0xff, 0xd8]))).toBeNull()
    expect(sniffMedia(bytes('%PDF-1.7 xxxxxxxx'))).toBeNull()
  })
})

describe('imageSize', () => {
  it('reads a PNG header', () => {
    const png = bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 13], 'IHDR', [0, 0, 6, 64], [0, 0, 4, 176])
    expect(imageSize(png, 'image/png')).toEqual({ width: 1600, height: 1200 })
  })
  it('reads a JPEG start-of-frame after its application segments', () => {
    const jpeg = bytes([0xff, 0xd8], [0xff, 0xe0, 0, 4, 1, 2], [0xff, 0xc0, 0, 17, 8, 0x04, 0xb0, 0x06, 0x40, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])
    expect(imageSize(jpeg, 'image/jpeg')).toEqual({ width: 1600, height: 1200 })
  })
  it('gives null for a header it does not understand', () => {
    expect(imageSize(bytes([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg')).toBeNull()
    expect(imageSize(bytes('nothing here at all'), 'image/webp')).toBeNull()
  })
})

describe('labels', () => {
  it('names a place from what was given', () => {
    expect(placeLabel({ level: 'Level 2', room: 'Data Hall 1' })).toBe('Level 2 · Data Hall 1')
    expect(placeLabel({ level: null, room: 'Roof' })).toBe('Roof')
    expect(placeLabel({ level: null, room: null })).toBe('')
  })
  it('summarizes a capture by its first line, else by what it holds', () => {
    expect(captureSummary({ note: '\nContainment not finished.\nSecond line', media: [], status: 'issue' })).toBe('Containment not finished.')
    expect(captureSummary({ note: 'y'.repeat(300), media: [], status: 'issue' }, 20)).toHaveLength(20)
    const photo = { id: 'm', kind: 'photo' as const, contentType: 'image/jpeg', sizeBytes: 1, width: 1, height: 1, seconds: null }
    expect(captureSummary({ note: '', media: [photo, photo, { ...photo, kind: 'audio' as const }], status: 'progress' })).toBe('2 photos and voice note')
    expect(captureSummary({ note: '', media: [], status: 'complete' })).toBe('Done')
  })
  it('measures distance in metres', () => {
    // One degree of latitude is about 111.2 km.
    expect(Math.round(distanceM({ lat: 35, lng: -81 }, { lat: 36, lng: -81 }) / 100)).toBe(1112)
    expect(distanceM({ lat: 35, lng: -81 }, { lat: 35, lng: -81 })).toBe(0)
  })
})
