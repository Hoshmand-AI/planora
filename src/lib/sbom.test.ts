import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildSbom, cdxLicenses, nameFromPath, npmPurl } from '../../scripts/sbom.mjs'

// `npm run sbom` (scripts/sbom.mjs): CycloneDX 1.5 JSON from package-lock.json, offline.

const lock = {
  name: 'planora', version: '1.0.0', lockfileVersion: 3,
  packages: {
    '': { name: 'planora', version: '1.0.0', license: 'ISC', dependencies: { pg: '^8', '@scope/lib': '^1' }, devDependencies: { vitest: '^5' } },
    'node_modules/pg': { version: '8.20.0', resolved: 'https://registry.npmjs.org/pg/-/pg-8.20.0.tgz', integrity: 'sha512-AAEC', license: 'MIT' },
    'node_modules/@scope/lib': { version: '1.2.3', license: '(MIT OR GPL-3.0-or-later)' },
    'node_modules/@scope/lib/node_modules/pg': { version: '8.20.0', license: 'MIT' },
    'node_modules/old': { version: '0.1.1' },
    'node_modules/odd': { version: '2.0.0', license: 'MIT/X11', optional: true },
    'node_modules/vitest': { version: '5.0.3', dev: true, license: 'MIT' },
    'node_modules/local-link': { resolved: 'packages/local', link: true },
  },
}

type Component = { type: string; 'bom-ref': string; name: string; group?: string; version: string; purl: string; scope: string; licenses?: unknown[]; hashes?: { alg: string; content: string }[] }

describe('SBOM (CycloneDX 1.5 from package-lock.json)', () => {
  it('has the CycloneDX 1.5 document shape', () => {
    const bom = buildSbom(lock, { timestamp: '2026-10-06T00:00:00.000Z' })
    expect(bom.bomFormat).toBe('CycloneDX')
    expect(bom.specVersion).toBe('1.5')
    expect(bom.version).toBe(1)
    expect(bom.serialNumber).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(bom.metadata.timestamp).toBe('2026-10-06T00:00:00.000Z')
    expect(bom.metadata.component).toMatchObject({ type: 'application', name: 'planora', version: '1.0.0', purl: 'pkg:npm/planora@1.0.0' })
    expect(Array.isArray(bom.components)).toBe(true)
    for (const c of bom.components as Component[]) {
      expect(c.type).toBe('library')
      expect(c['bom-ref']).toBe(c.purl)
      expect(c.purl).toMatch(/^pkg:npm\/(%40[^/]+\/)?[^@/]+@\d/)
      expect(typeof c.name).toBe('string')
      expect(typeof c.version).toBe('string')
    }
  })

  it('lists runtime packages once each with purl, license and hash; leaves out dev tools and links', () => {
    const bom = buildSbom(lock)
    const refs = (bom.components as Component[]).map(c => c.purl)
    expect(refs).toEqual(['pkg:npm/%40scope/lib@1.2.3', 'pkg:npm/odd@2.0.0', 'pkg:npm/old@0.1.1', 'pkg:npm/pg@8.20.0'])
    const pg = (bom.components as Component[]).find(c => c.name === 'pg')!
    expect(pg.licenses).toEqual([{ license: { id: 'MIT' } }])
    expect(pg.hashes).toEqual([{ alg: 'SHA-512', content: '000102' }])
    const scoped = (bom.components as Component[]).find(c => c.group === '@scope')!
    expect(scoped).toMatchObject({ name: 'lib', licenses: [{ expression: '(MIT OR GPL-3.0-or-later)' }] })
    expect((bom.components as Component[]).find(c => c.name === 'old')!.licenses).toBeUndefined()
    expect((bom.components as Component[]).find(c => c.name === 'odd')).toMatchObject({ scope: 'optional', licenses: [{ license: { name: 'MIT/X11' } }] })
    expect(bom.dependencies).toEqual([{ ref: 'pkg:npm/planora@1.0.0', dependsOn: ['pkg:npm/%40scope/lib@1.2.3', 'pkg:npm/pg@8.20.0'] }])
  })

  it('includes development tooling on request and is stable for the same lockfile', () => {
    const a = buildSbom(lock, { includeDev: true, timestamp: 't' })
    expect((a.components as Component[]).map(c => c.name)).toContain('vitest')
    expect(buildSbom(lock, { includeDev: true, timestamp: 't' })).toEqual(a)
    expect(buildSbom(lock).serialNumber).not.toBe(a.serialNumber)
  })

  it('helpers follow the purl and SPDX conventions', () => {
    expect(npmPurl('@types/node', '22.0.0')).toBe('pkg:npm/%40types/node@22.0.0')
    expect(nameFromPath('node_modules/a/node_modules/@s/b')).toBe('@s/b')
    expect(cdxLicenses('Apache-2.0 AND MIT')).toEqual([{ expression: 'Apache-2.0 AND MIT' }])
    expect(cdxLicenses(undefined)).toEqual([])
  })

  it('refuses a lockfile without a packages section', () => {
    expect(() => buildSbom({ lockfileVersion: 1, dependencies: {} })).toThrow(/lockfileVersion 2 or 3/)
  })

  it('runs as a CLI on this repository without network access', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'planora-sbom-'))
    const out = path.join(dir, 'sbom.cdx.json')
    execFileSync(process.execPath, ['scripts/sbom.mjs', '--output', out], { cwd: process.cwd(), stdio: 'pipe' })
    const bom = JSON.parse(fs.readFileSync(out, 'utf8'))
    expect(bom.specVersion).toBe('1.5')
    const names = (bom.components as Component[]).map(c => (c.group ? `${c.group}/${c.name}` : c.name))
    for (const dep of ['next', 'pg', 'react', 'bcryptjs']) expect(names).toContain(dep)
    expect(names).not.toContain('vitest')
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
