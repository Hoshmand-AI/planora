import { describe, expect, it } from 'vitest'
import { productCard, releaseNote, UPDATES } from './product-card'

describe('public product card', () => {
  it('names the product, its logo and its access', () => {
    const c = productCard({ VERCEL_GIT_COMMIT_SHA: '0694327abcdef', VERCEL_GIT_COMMIT_MESSAGE: 'Merge pull request #102 from Hoshmand-AI/x\n\nLanding page: readable screenshots' })
    expect(c.schema).toBe('hoshmand.product/1')
    expect(c.name).toBe('RunF9')
    expect(c.formerNames).toContain('Planora')
    expect(c.access).toBe('invite-only')
    expect(c.logo.mark.startsWith('/brand/')).toBe(true)
    expect(c.release).toMatchObject({ id: '0694327', note: 'Landing page: readable screenshots' })
  })

  it('reads the release note from a plain or a merge commit', () => {
    expect(releaseNote('Fix the ruler\n\nbody')).toBe('Fix the ruler')
    expect(releaseNote('Merge pull request #1 from a/b\n\nNew logo')).toBe('New logo')
    expect(releaseNote(undefined)).toBeUndefined()
  })

  it('keeps updates newest first with ISO dates', () => {
    for (const u of UPDATES) expect(u.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const dates = UPDATES.map(u => u.date)
    expect([...dates].sort().reverse()).toEqual(dates)
  })
})
