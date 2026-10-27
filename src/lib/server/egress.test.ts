import { afterEach, describe, expect, it } from 'vitest'
import { egressProblem } from './egress'
import { urlProblem } from './webhooks'

describe('air-gapped egress rule', () => {
  const env = (extra: Record<string, string> = {}) => ({ RUNF9_AIRGAPPED: 'true', ...extra })
  it('allows everything when not air-gapped', () => {
    expect(egressProblem('https://api.anthropic.com/v1', {})).toBeNull()
  })
  it('refuses internet hosts and allows in-network ones', () => {
    expect(egressProblem('https://api.resend.com/emails', env())).toMatch(/air-gapped/)
    expect(egressProblem('https://login.microsoftonline.com/x', env())).toMatch(/outside your network/)
    expect(egressProblem('http://10.1.2.3/hook', env())).toBeNull()
    expect(egressProblem('https://adfs.corp.internal/adfs', env())).toBeNull()
    expect(egressProblem('https://idp.acme.com/x', env({ RUNF9_ALLOWED_HOSTS: 'idp.acme.com' }))).toBeNull()
  })
})

describe('webhook destinations in an air-gapped install', () => {
  const saved = { ...process.env }
  afterEach(() => { process.env = { ...saved } })
  it('accepts only receivers the customer listed', async () => {
    process.env.RUNF9_AIRGAPPED = 'true'
    process.env.RUNF9_ALLOWED_HOSTS = 'hooks.corp.internal'
    delete process.env.RUNF9_ALLOW_INSECURE_WEBHOOKS
    expect(await urlProblem('https://hooks.example.com/x')).toMatch(/air-gapped/)
    expect(await urlProblem('https://10.0.0.9/x')).toMatch(/listed in RUNF9_ALLOWED_HOSTS/)
    expect(await urlProblem('https://hooks.corp.internal/x')).toBeNull()
    expect(await urlProblem('http://hooks.corp.internal/x')).toMatch(/HTTPS/)
  })
})
