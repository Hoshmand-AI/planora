import { describe, expect, it } from 'vitest'
import { awsExternalId, awsLaunchUrl, ROLE_ARN, signInOptions, startOAuth } from './cloud-auth'

const azure = { RUNF9_AZURE_CLIENT_ID: 'cid', RUNF9_AZURE_CLIENT_SECRET: 'csecret' }
const aws = { RUNF9_AWS_ACCOUNT_ID: '999988887777', RUNF9_AWS_ACCESS_KEY_ID: 'AKIA', RUNF9_AWS_SECRET_ACCESS_KEY: 's' }

describe('sign-in options', () => {
  it('offers each method only when RunF9 has that identity', () => {
    expect(signInOptions({})).toEqual({ azure: false, gcp: false, aws: false })
    expect(signInOptions({ ...azure, ...aws })).toEqual({ azure: true, gcp: false, aws: true })
    expect(signInOptions({ ...aws, RUNF9_AWS_ACCOUNT_ID: 'not-an-account' }).aws).toBe(false)
  })
})

describe('OAuth start', () => {
  it('asks Microsoft for storage access only, with PKCE, never sending the secret', () => {
    const s = startOAuth('azure', 'https://runf9.ai/api/storage/oauth/callback', azure)
    const u = new URL(s.url)
    expect(u.origin + u.pathname).toBe('https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize')
    expect(u.searchParams.get('scope')).toBe('https://storage.azure.com/user_impersonation offline_access')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('state')).toBe(s.state)
    expect(s.url).not.toContain('csecret')
  })

  it('asks Google for offline Cloud Storage access', () => {
    const u = new URL(startOAuth('gcp', 'https://runf9.ai/cb', { RUNF9_GOOGLE_CLIENT_ID: 'g', RUNF9_GOOGLE_CLIENT_SECRET: 'h' }).url)
    expect(u.hostname).toBe('accounts.google.com')
    expect(u.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/devstorage.read_write')
    expect(u.searchParams.get('access_type')).toBe('offline')
  })

  it('ignores test-only sign-in addresses in the production cloud service', () => {
    const u = new URL(startOAuth('azure', 'https://runf9.ai/cb', { ...azure, RUNF9_AZURE_AUTHORITY: 'https://evil.example' }).url)
    expect(u.hostname).toBe('login.microsoftonline.com')
    const t = new URL(startOAuth('azure', 'https://runf9.ai/cb', { ...azure, RUNF9_AZURE_AUTHORITY: 'http://127.0.0.1:4030/ms', RUNF9_STORAGE_CUSTOM_ENDPOINTS: 'true' }).url)
    expect(t.host).toBe('127.0.0.1:4030')
  })

  it('refuses when the app registration is missing', () => {
    expect(() => startOAuth('azure', 'https://runf9.ai/cb', {})).toThrow(/not set up/)
  })
})

describe('AWS role', () => {
  it('gives each organization its own stable external ID', () => {
    const env = { JWT_SECRET: 'k' }
    expect(awsExternalId('org_a', env)).toBe(awsExternalId('org_a', env))
    expect(awsExternalId('org_a', env)).not.toBe(awsExternalId('org_b', env))
    expect(awsExternalId('org_a', env)).toMatch(/^runf9-[0-9a-f]{32}$/)
  })

  it('builds a CloudFormation quick-create link with everything filled in', () => {
    const url = awsLaunchUrl({ orgId: 'org_a', bucket: 'client.bucket', region: 'us-gov-west-1', prefix: 'p/', templateUrl: 'https://b.s3.amazonaws.com/t.yaml' }, { ...aws, JWT_SECRET: 'k' })
    const q = new URLSearchParams(url.split('#/stacks/quickcreate?')[1])
    expect(url.startsWith('https://console.aws.amazon.com/cloudformation/home?region=us-gov-west-1#')).toBe(true)
    expect(q.get('param_RunF9AccountId')).toBe('999988887777')
    expect(q.get('param_ExternalId')).toBe(awsExternalId('org_a', { JWT_SECRET: 'k' }))
    expect(q.get('stackName')).toBe('RunF9-Storage-client-bucket')
  })

  it('accepts only role ARNs', () => {
    expect(ROLE_ARN.test('arn:aws:iam::111122223333:role/RunF9-Storage-x')).toBe(true)
    expect(ROLE_ARN.test('arn:aws-us-gov:iam::111122223333:role/path/RunF9')).toBe(true)
    expect(ROLE_ARN.test('arn:aws:iam::111122223333:user/alice')).toBe(false)
  })
})
