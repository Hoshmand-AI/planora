import { describe, expect, it } from 'vitest'
import { imagery, tileUrl } from './imagery'

describe('the aerial picture source', () => {
  it('is USGS unless told otherwise', () => {
    const im = imagery({})!
    expect(im.source).toBe('usgs')
    expect(im.maxZoom).toBe(16)
    // The USGS service takes the row before the column.
    expect(tileUrl(im, 16, 18000, 26000)).toBe('https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/16/26000/18000')
  })
  it('is off when switched off, and always off on an air-gapped deployment', () => {
    expect(imagery({ RUNF9_SITE_IMAGERY: 'off' })).toBeNull()
    expect(imagery({ RUNF9_AIRGAPPED: 'true' })).toBeNull()
    expect(imagery({ RUNF9_AIRGAPPED: 'true', RUNF9_SITE_IMAGERY: 'https://tiles.example.com/{z}/{x}/{y}.jpg' })).toBeNull()
  })
  it('takes a custom tile address over https, with its credit line', () => {
    const im = imagery({ RUNF9_SITE_IMAGERY: 'https://tiles.example.com/{z}/{x}/{y}.jpg?key=abc', RUNF9_SITE_IMAGERY_ATTRIBUTION: 'Imagery © Example', RUNF9_SITE_IMAGERY_MAX_ZOOM: '20' })!
    expect(im).toMatchObject({ source: 'custom', attribution: 'Imagery © Example', maxZoom: 20 })
    expect(tileUrl(im, 3, 1, 2)).toBe('https://tiles.example.com/3/1/2.jpg?key=abc')
  })
  it('refuses an address that is not a tile template or not https', () => {
    expect(imagery({ RUNF9_SITE_IMAGERY: 'https://tiles.example.com/map' })).toBeNull()
    expect(imagery({ RUNF9_SITE_IMAGERY: 'http://tiles.example.com/{z}/{x}/{y}.jpg' })).toBeNull()
    expect(imagery({ RUNF9_SITE_IMAGERY: 'file:///etc/{z}/{x}/{y}' })).toBeNull()
    // A stand-in on this machine is allowed over http (tests).
    expect(imagery({ RUNF9_SITE_IMAGERY: 'http://127.0.0.1:4599/{z}/{x}/{y}.png' })?.source).toBe('custom')
  })
})
