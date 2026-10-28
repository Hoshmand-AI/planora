import { describe, expect, it } from 'vitest'
import { checkKey, describeLocation, objectKeyFor, storageClient, validateConnection } from './providers'

const awsSecret = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' }

describe('validateConnection', () => {
  it('accepts an S3 bucket and builds its location from names only', () => {
    const v = validateConnection('aws', { bucket: 'harbor-schedules', region: 'us-gov-west-1', prefix: 'projects' }, awsSecret, {})
    expect(v.config).toEqual({ bucket: 'harbor-schedules', region: 'us-gov-west-1', prefix: 'projects/' })
    expect(describeLocation('aws', v.config)).toBe('s3://harbor-schedules/projects/ (us-gov-west-1)')
  })

  it('refuses bad names, keys and folders', () => {
    expect(() => validateConnection('aws', { bucket: 'Bad_Bucket' }, awsSecret, {})).toThrow(/Bucket name/)
    expect(() => validateConnection('aws', { bucket: 'ok-bucket', region: 'nowhere' }, awsSecret, {})).toThrow(/Region/)
    expect(() => validateConnection('aws', { bucket: 'ok-bucket' }, { accessKeyId: 'x', secretAccessKey: 'y' }, {})).toThrow(/access key ID/)
    expect(() => validateConnection('gcp', { bucket: 'ok-bucket', prefix: '../up' }, awsSecret, {})).toThrow(/plain path/)
    expect(() => validateConnection('azure', { account: 'acct1', container: 'runf9' }, { sas: 'sv=2020&sp=rl' }, {})).toThrow(/SAS token/)
    expect(() => validateConnection('ftp', {}, {}, {})).toThrow(/Provider/)
  })

  it('allows a custom storage address only in a private deployment', () => {
    const cfg = { bucket: 'runf9', endpoint: 'https://minio.example.internal:9000' }
    expect(() => validateConnection('s3', cfg, awsSecret, {})).toThrow(/private RunF9 deployment/)
    expect(() => validateConnection('azure', { account: 'acct1', container: 'runf9', endpoint: 'http://169.254.169.254' }, { sas: 'sp=rl&sig=x' }, {})).toThrow(/private RunF9 deployment/)
    expect(validateConnection('s3', cfg, awsSecret, { RUNF9_DEPLOYMENT: 'onprem' }).config.endpoint).toBe('https://minio.example.internal:9000')
    expect(() => validateConnection('s3', { ...cfg, endpoint: 'https://user:pw@minio.internal/path' }, awsSecret, { RUNF9_DEPLOYMENT: 'onprem' })).toThrow(/only the address/)
  })
})

describe('keys', () => {
  it('refuses traversal and control characters', () => {
    for (const k of ['../x', 'a/../b', '/abs', 'a\u0000b', 'a\\b', '']) expect(() => checkKey(k)).toThrow()
    expect(checkKey('projects/Update 6 (rev 2).xer')).toBe('projects/Update 6 (rev 2).xer')
  })

  it('names kept originals by date, fingerprint and a safe file name', () => {
    const key = objectKeyFor('projects/', 'schedules', 'Riverside: Update #6.xer', 'abcdef1234567890', new Date('2026-10-28T12:00:00Z'))
    expect(key).toBe('projects/runf9/schedules/2026-10-28-abcdef12-Riverside_ Update _6.xer')
  })
})

describe('egress', () => {
  it('an air-gapped deployment does not reach a public cloud', async () => {
    const env = { RUNF9_AIRGAPPED: 'true' }
    const c = storageClient('aws', { bucket: 'harbor-schedules', region: 'us-east-1' }, awsSecret, env)
    await expect(c.list()).rejects.toThrow(/outside your network/)
  })
})
