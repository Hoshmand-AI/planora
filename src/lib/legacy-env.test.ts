import { describe, expect, it } from 'vitest'
import { applyLegacyEnv } from './legacy-env'

describe('legacy PLANORA_* settings', () => {
  it('copies each PLANORA_X to RUNF9_X when RUNF9_X is not set', () => {
    const env: Record<string, string | undefined> = { PLANORA_SIGNUP: 'open', PLANORA_ENCRYPTION_KEY: 'k1', OTHER: 'x' }
    expect(applyLegacyEnv(env).sort()).toEqual(['RUNF9_ENCRYPTION_KEY', 'RUNF9_SIGNUP'])
    expect(env.RUNF9_SIGNUP).toBe('open')
    expect(env.RUNF9_ENCRYPTION_KEY).toBe('k1')
    expect(env.OTHER).toBe('x')
  })
  it('never overrides a RUNF9_X that is already set', () => {
    const env: Record<string, string | undefined> = { PLANORA_SIGNUP: 'open', RUNF9_SIGNUP: 'invite_only' }
    expect(applyLegacyEnv(env)).toEqual([])
    expect(env.RUNF9_SIGNUP).toBe('invite_only')
  })
})
