#!/usr/bin/env node
// Software bill of materials (CycloneDX 1.5 JSON) built from package-lock.json alone — no network
// access and no extra dependencies, so it also runs inside an air-gapped enclave or on a release
// bundle without node_modules.
//
//   npm run sbom                                   → sbom.cdx.json (runtime dependencies)
//   node scripts/sbom.mjs --include-dev            → also build/test tooling
//   node scripts/sbom.mjs --output -               → print to stdout
//   node scripts/sbom.mjs --lockfile path/to/package-lock.json --output out.json
//
// Each installed package in the lockfile becomes one component with its name, version, npm purl,
// the license the lockfile records (if any) and the lockfile's integrity hash. Packages installed
// at several paths with the same version are listed once. CI also publishes `npm sbom` output as an
// artifact; this script is the offline equivalent for on-prem customers and procurement reviews.

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// SPDX identifiers that may be given as a license id; anything else is an expression or a name.
const SPDX_IDS = new Set(['0BSD', 'Apache-2.0', 'Artistic-2.0', 'BlueOak-1.0.0', 'BSD-2-Clause', 'BSD-3-Clause', 'CC-BY-3.0', 'CC-BY-4.0', 'CC0-1.0',
  'GPL-2.0-only', 'GPL-2.0-or-later', 'GPL-3.0-only', 'GPL-3.0-or-later', 'ISC', 'LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-3.0-only', 'LGPL-3.0-or-later',
  'MIT', 'MIT-0', 'MPL-2.0', 'Python-2.0', 'Unlicense', 'WTFPL', 'Zlib'])

/** npm package URL (purl spec): scoped names percent-encode the @. */
export function npmPurl(name, version) {
  const encoded = name.startsWith('@') ? `%40${name.slice(1)}` : name
  return `pkg:npm/${encoded}@${version}`
}

/** CycloneDX licenses[] for a lockfile license value (string, or legacy object/array forms). */
export function cdxLicenses(license) {
  const values = Array.isArray(license) ? license : license == null ? [] : [license]
  const out = []
  for (const v of values) {
    const text = typeof v === 'string' ? v.trim() : typeof v?.type === 'string' ? v.type.trim() : ''
    if (!text) continue
    if (SPDX_IDS.has(text)) out.push({ license: { id: text } })
    else if (/\s(OR|AND|WITH)\s/.test(text)) out.push({ expression: text })
    else out.push({ license: { name: text } })
  }
  // A single expression must stand alone (CycloneDX 1.5 allows one expression, or a list of licenses).
  const expr = out.find(l => l.expression)
  return expr ? [expr] : out
}

/** Package name for a lockfile "packages" key, e.g. node_modules/a/node_modules/@s/b → @s/b. */
export function nameFromPath(key) {
  const i = key.lastIndexOf('node_modules/')
  return i === -1 ? key : key.slice(i + 'node_modules/'.length)
}

function integrityHashes(integrity) {
  if (typeof integrity !== 'string') return []
  const algs = { sha512: 'SHA-512', sha384: 'SHA-384', sha256: 'SHA-256', sha1: 'SHA-1' }
  return integrity.split(/\s+/).flatMap(part => {
    const m = /^(sha512|sha384|sha256|sha1)-(.+)$/.exec(part)
    return m ? [{ alg: algs[m[1]], content: Buffer.from(m[2], 'base64').toString('hex') }] : []
  })
}

/** Builds the CycloneDX document. `lock` is the parsed package-lock.json (lockfileVersion 2 or 3). */
export function buildSbom(lock, { includeDev = false, timestamp = new Date().toISOString(), toolVersion = '1' } = {}) {
  if (!lock || typeof lock !== 'object' || !lock.packages) throw new Error('package-lock.json has no "packages" section (lockfileVersion 2 or 3 is required).')
  const root = lock.packages[''] || {}
  const rootName = root.name || lock.name || 'app'
  const rootVersion = root.version || lock.version || '0.0.0'
  const byRef = new Map()
  for (const [key, pkg] of Object.entries(lock.packages)) {
    if (!key || pkg.link || !pkg.version) continue
    if (pkg.dev && !includeDev) continue
    const name = pkg.name || nameFromPath(key)
    const purl = npmPurl(name, pkg.version)
    if (byRef.has(purl)) continue
    const slash = name.startsWith('@') ? name.indexOf('/') : -1
    const component = {
      type: 'library',
      'bom-ref': purl,
      ...(slash > 0 ? { group: name.slice(0, slash), name: name.slice(slash + 1) } : { name }),
      version: pkg.version,
      scope: pkg.optional ? 'optional' : 'required',
      purl,
    }
    const licenses = cdxLicenses(pkg.license)
    if (licenses.length) component.licenses = licenses
    const hashes = integrityHashes(pkg.integrity)
    if (hashes.length) component.hashes = hashes
    if (typeof pkg.resolved === 'string' && /^https?:/.test(pkg.resolved)) component.externalReferences = [{ type: 'distribution', url: pkg.resolved }]
    const props = [pkg.dev ? { name: 'cdx:npm:package:development', value: 'true' } : null].filter(Boolean)
    if (props.length) component.properties = props
    byRef.set(purl, component)
  }
  const components = [...byRef.values()].sort((a, b) => a['bom-ref'].localeCompare(b['bom-ref']))
  // A stable serial number for the same lockfile content and options.
  const digest = createHash('sha256').update(JSON.stringify({ components, rootName, rootVersion, includeDev })).digest('hex')
  const serial = `urn:uuid:${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${((parseInt(digest[16], 16) & 0x3) | 0x8).toString(16)}${digest.slice(17, 20)}-${digest.slice(20, 32)}`
  const rootRef = npmPurl(rootName, rootVersion)
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: serial,
    version: 1,
    metadata: {
      timestamp,
      tools: { components: [{ type: 'application', name: 'planora-sbom', version: toolVersion, description: 'scripts/sbom.mjs (offline, from package-lock.json)' }] },
      component: { type: 'application', 'bom-ref': rootRef, name: rootName, version: rootVersion, purl: rootRef, ...(root.license ? { licenses: cdxLicenses(root.license) } : {}) },
      properties: [{ name: 'planora:sbom:scope', value: includeDev ? 'runtime+development' : 'runtime' }],
    },
    components,
    // Direct dependencies of the application (the full tree is in the lockfile).
    dependencies: [{ ref: rootRef, dependsOn: directRefs(lock, root, includeDev, byRef) }],
  }
}

function directRefs(lock, root, includeDev, byRef) {
  const names = Object.keys({ ...(root.dependencies || {}), ...(includeDev ? root.devDependencies || {} : {}) })
  return names.map(n => { const p = lock.packages[`node_modules/${n}`]; return p?.version ? npmPurl(p.name || n, p.version) : null })
    .filter(ref => ref && byRef.has(ref)).sort()
}

function main(argv) {
  const arg = (flag) => { const i = argv.indexOf(flag); return i === -1 ? undefined : argv[i + 1] }
  const lockfile = path.resolve(arg('--lockfile') || 'package-lock.json')
  const output = arg('--output') || 'sbom.cdx.json'
  const includeDev = argv.includes('--include-dev')
  const lock = JSON.parse(fs.readFileSync(lockfile, 'utf8'))
  const bom = buildSbom(lock, { includeDev })
  const text = `${JSON.stringify(bom, null, 2)}\n`
  if (output === '-') process.stdout.write(text)
  else {
    fs.writeFileSync(output, text)
    console.error(`CycloneDX 1.5 SBOM: ${bom.components.length} components (${includeDev ? 'runtime + development' : 'runtime'}) → ${output}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2))
