import { describe, it, expect } from 'vitest'
import { fmtAmount } from './format'

describe('fmtAmount: a number answer with its unit, as people write it', () => {
  it('separates thousands and puts a dollar sign on dollar amounts', () => {
    expect(fmtAmount(12000, 'USD per calendar day')).toBe('$12,000 per calendar day')
    expect(fmtAmount(18000, 'USD per work day')).toBe('$18,000 per work day')
    expect(fmtAmount(45, 'USD millions')).toBe('$45 million')
    expect(fmtAmount(120000, 'sf')).toBe('120,000 sf')
  })
  it('closes up a percentage and keeps small numbers as they are', () => {
    expect(fmtAmount(90, '%')).toBe('90%')
    expect(fmtAmount(3, 'stories')).toBe('3 stories')
    expect(fmtAmount(2.5, 'acres')).toBe('2.5 acres')
    expect(fmtAmount(7)).toBe('7')
  })
  it('reads a number stored as text, and passes anything else through', () => {
    expect(fmtAmount('12000', 'USD per work day')).toBe('$12,000 per work day')
    expect(fmtAmount('about ten', 'weeks')).toBe('about ten weeks')
    expect(fmtAmount('', 'weeks')).toBe('')
    expect(fmtAmount(null)).toBe('')
  })
})
