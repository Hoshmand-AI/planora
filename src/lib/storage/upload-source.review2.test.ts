import { describe, expect, it, vi } from 'vitest'

// Review round 2 (M5): an import from connected storage stays inside the connection's folder.

const get = vi.fn(async () => Buffer.from('bytes'))
let prefix: string | undefined = 'runf9/'
vi.mock('./store', () => ({
  openStorageConnection: vi.fn(async () => ({ connection: { id: 'c1', name: 'Client bucket', canRead: true, location: 's3://b/runf9/', config: { prefix } }, client: { get } })),
}))

import { keyInsidePrefix, readUploadSource } from './upload-source'

const form = (key: string) => { const f = new FormData(); f.set('sourceConnectionId', 'c1'); f.set('sourceKey', key); return f }

describe('importing from connected storage', () => {
  it('knows which keys lie inside the folder', () => {
    expect(keyInsidePrefix('runf9/updates/may.xer', 'runf9/')).toBe(true)
    expect(keyInsidePrefix('other-client/contract.pdf', 'runf9/')).toBe(false)
    expect(keyInsidePrefix('runf9-private/contract.pdf', 'runf9/')).toBe(false)
    expect(keyInsidePrefix('runf9/', 'runf9/')).toBe(false)
    expect(keyInsidePrefix('anything/at/all.pdf', '')).toBe(true)
    expect(keyInsidePrefix('anything/at/all.pdf', undefined)).toBe(true)
  })

  it('refuses a file outside the folder without reading it', async () => {
    prefix = 'runf9/'; get.mockClear()
    await expect(readUploadSource(form('other-client/contract.pdf'), 'o1', 1000, 'too large')).rejects.toMatchObject({ status: 400, code: 'outside_folder' })
    expect(get).not.toHaveBeenCalled()
  })

  it('reads a file inside the folder', async () => {
    prefix = 'runf9/'; get.mockClear()
    const r = await readUploadSource(form('runf9/updates/may.xer'), 'o1', 1000, 'too large')
    expect(r?.fileName).toBe('may.xer')
    expect(r?.from).toEqual({ connectionId: 'c1', key: 'runf9/updates/may.xer', location: 's3://b/runf9/' })
    expect(get).toHaveBeenCalledWith('runf9/updates/may.xer', 1000)
  })

  it('reads any file when the connection has no folder', async () => {
    prefix = undefined; get.mockClear()
    expect((await readUploadSource(form('contracts/prime.pdf'), 'o1', 1000, 'too large'))?.fileName).toBe('prime.pdf')
  })
})
