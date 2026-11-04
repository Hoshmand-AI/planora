import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

// The UI uses the RunF9 palette only (tailwind.config.js; docs/design/DESIGN-SYSTEM.md). A hex color written
// straight into a component or stylesheet must be one of the palette's values. The logo artwork and the
// generated app icons are brand assets and keep their own colors.
const require_ = createRequire(import.meta.url)
const config = require_(path.join(process.cwd(), 'tailwind.config.js')) as { theme: { extend: { colors: Record<string, string | Record<string, string>> } } }
const palette = new Set<string>(['#FFFFFF', '#FFF', '#000000'])
for (const v of Object.values(config.theme.extend.colors)) for (const c of typeof v === 'string' ? [v] : Object.values(v)) palette.add(c.toUpperCase())

const EXEMPT = /(^|\/)(Logo\.tsx|icon\.tsx|apple-icon\.tsx|opengraph-image\.tsx|twitter-image\.tsx)$|\.test\.tsx?$/
function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? files(p) : /\.(tsx|css)$/.test(e.name) && !EXEMPT.test(p) ? [p] : []
  })
}

describe('color palette', () => {
  it('UI code uses only palette colors', () => {
    const off: string[] = []
    for (const f of files(path.join(process.cwd(), 'src'))) {
      const text = fs.readFileSync(f, 'utf8')
      for (const m of text.matchAll(/#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b(?![0-9A-Fa-f])/g)) {
        if (!palette.has(m[0].toUpperCase())) off.push(`${path.relative(process.cwd(), f)}: ${m[0]}`)
      }
    }
    expect(off).toEqual([])
  })
})
