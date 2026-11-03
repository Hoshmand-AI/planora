import { describe, expect, it } from 'vitest'
import { signV4, uriEncode } from './sigv4'

describe('signV4', () => {
  // AWS's published example: "GET Object" with a Range header (Amazon S3 API reference,
  // "Signature Calculations for the Authorization Header: Transferring Payload in a Single Chunk").
  it('matches the AWS documentation example', () => {
    const h = signV4({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      headers: { Range: 'bytes=0-9' },
      now: new Date('2013-05-24T00:00:00Z'),
    })
    expect(h.authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41')
    expect(h['x-amz-content-sha256']).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(h.host).toBeUndefined()
  })

  const KEYS = { region: 'us-east-1', accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', now: new Date('2013-05-24T00:00:00Z') }

  it('matches the AWS "PUT Object" example (body hash, extra headers, encoded key)', () => {
    const h = signV4({
      ...KEYS, method: 'PUT',
      url: new URL(`https://examplebucket.s3.amazonaws.com/${encodeURIComponent('test$file.text')}`),
      body: Buffer.from('Welcome to Amazon S3.'),
      headers: { Date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' },
    })
    expect(h.authorization).toMatch(/SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class, Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd$/)
  })

  it('matches the AWS "GET Bucket (List Objects)" example (query string)', () => {
    const h = signV4({ ...KEYS, method: 'GET', url: new URL('https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J') })
    expect(h.authorization).toMatch(/Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7$/)
  })

  it('encodes the way SigV4 requires', () => {
    expect(uriEncode("a b!'()*")).toBe('a%20b%21%27%28%29%2A')
    expect(uriEncode('runf9/x y.xer', true)).toBe('runf9/x%20y.xer')
  })
})
