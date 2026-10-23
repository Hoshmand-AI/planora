import { describe, expect, it } from 'vitest'
import { effectiveUploadLimit, formatMb, tooLargeMessage, VERCEL_BODY_LIMIT_BYTES } from './upload-limit'
import { siteUrl } from './site-url'

describe('upload limits where the app runs', () => {
  const app = 25 * 1024 * 1024
  it('self-hosted keeps the app limit', () => {
    expect(effectiveUploadLimit(app, {})).toBe(app)
  })
  it('on Vercel the file limit stays under the 4.5 MB request body limit', () => {
    const v = effectiveUploadLimit(app, { VERCEL: '1' })
    expect(v).toBeLessThan(VERCEL_BODY_LIMIT_BYTES)
    expect(v).toBeGreaterThan(4 * 1024 * 1024)
    expect(effectiveUploadLimit(1024, { VERCEL: '1' })).toBe(1024)
  })
  it('messages name the limit and what to do', () => {
    expect(formatMb(25 * 1024 * 1024)).toBe('25 MB')
    expect(tooLargeMessage('schedule', 25 * 1024 * 1024)).toMatch(/limit is 25 MB.*Export only this project/)
    expect(tooLargeMessage('document')).toMatch(/Split it/)
  })
})

describe('public site URL (robots, sitemap, link previews)', () => {
  it('prefers APP_URL, then the Vercel production domain, then localhost', () => {
    expect(siteUrl({ APP_URL: 'https://app.planora.example/', VERCEL_PROJECT_PRODUCTION_URL: 'x.vercel.app' })).toBe('https://app.planora.example')
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'planora-chi.vercel.app' })).toBe('https://planora-chi.vercel.app')
    expect(siteUrl({ APP_URL: 'not a url' })).toBe('http://localhost:3000')
  })
})
