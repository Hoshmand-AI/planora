import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

// Text sizes come from one scale (tailwind.config.js `theme.fontSize`; docs/design/DESIGN-SYSTEM.md, "Type").
// The app uses five of them, one per level of a page; public pages add headline sizes above those. A size
// written any other way (`text-[17px]`, Tailwind's own `text-sm`, an inline font-size off the scale) fails here,
// so a new screen cannot bring a sixth size with it.
const require_ = createRequire(import.meta.url)
const config = require_(path.join(process.cwd(), 'tailwind.config.js')) as { theme: { fontSize: Record<string, string> } }
const scale = config.theme.fontSize

const APP = ['title', 'heading', 'subhead', 'body', 'caption']
const PUBLIC = ['display', 'h1', 'h2', 'h3', 'lead', 'copy', 'small', 'fine']
const px = (name: string) => Number.parseFloat(scale[name])

// Public pages: the landing page, sign-in, legal, the deployment page, the sample report and the two error pages.
const PUBLIC_FILE = /^src\/(components\/(landing\/|Landing\.tsx|LegalPage\.tsx)|app\/(?!dashboard\/))/
// Emails are laid out with inline styles for mail clients, and generated images have no stylesheet.
const EXEMPT = /(^|\/)(icon\.tsx|apple-icon\.tsx|opengraph-image\.tsx|twitter-image\.tsx)$|\.test\.tsx?$/

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? files(p) : /\.(tsx|css)$/.test(e.name) && !EXEMPT.test(p) ? [p] : []
  })
}
const sources = files(path.join(process.cwd(), 'src')).map(f => ({ file: path.relative(process.cwd(), f).split(path.sep).join('/'), text: fs.readFileSync(f, 'utf8') }))

describe('type scale', () => {
  it('has the documented sizes: five for the app, eight for public pages', () => {
    expect(Object.keys(scale).sort()).toEqual([...APP, ...PUBLIC].sort())
    expect(APP.map(px)).toEqual([20, 16, 14, 13, 12])
    expect(PUBLIC.map(px)).toEqual([64, 40, 28, 20, 18, 16, 14, 13])
    // Each step down is smaller than the one above it.
    for (const names of [APP, PUBLIC]) for (let i = 1; i < names.length; i++) expect(px(names[i])).toBeLessThan(px(names[i - 1]))
  })

  it('no size is written outside the scale', () => {
    const off: string[] = []
    const allowed = new Set(Object.values(scale).map(v => Number.parseFloat(v)))
    for (const { file, text } of sources) {
      // `text-[17px]`, `text-[1.1rem]`: an arbitrary size. (`text-[#123456]` and `text-[color:…]` are colors.)
      for (const m of text.matchAll(/\btext-\[\s*[0-9.]+(px|rem|em|pt|%|vw)?\s*\]/g)) off.push(`${file}: ${m[0]}`)
      // Tailwind's default names are not defined in this project, so they would style nothing.
      for (const m of text.matchAll(/(?<![\w-])text-(xs|sm|base|lg|xl|[2-9]xl)(?![\w-])/g)) off.push(`${file}: ${m[0]}`)
      // Inline sizes (SVG chart text, a stylesheet rule) must be on the scale too.
      for (const m of text.matchAll(/\bfontSize\s*[=:]\s*\{?\s*["']?([0-9.]+)/g)) if (!allowed.has(Number(m[1]))) off.push(`${file}: fontSize ${m[1]}`)
      for (const m of text.matchAll(/font-size:\s*([0-9.]+)px/g)) if (!allowed.has(Number(m[1]))) off.push(`${file}: font-size ${m[1]}px`)
    }
    expect(off).toEqual([])
  })

  it('the app uses only its five sizes; headline sizes stay on public pages', () => {
    const off: string[] = []
    const publicOnly = new RegExp(`(?<![\\w-])text-(${PUBLIC.join('|')})(?![\\w-])`, 'g')
    const appPx = new Set(APP.map(px))
    for (const { file, text } of sources) {
      if (PUBLIC_FILE.test(file) || file.endsWith('.css')) continue
      for (const m of text.matchAll(publicOnly)) off.push(`${file}: ${m[0]}`)
      for (const m of text.matchAll(/\bfontSize\s*[=:]\s*\{?\s*["']?([0-9.]+)/g)) if (!appPx.has(Number(m[1]))) off.push(`${file}: fontSize ${m[1]}`)
    }
    expect(off).toEqual([])
  })

  it('an app page has one title: the page-title class, on an h1', () => {
    const off: string[] = []
    for (const { file, text } of sources) {
      if (PUBLIC_FILE.test(file) || file.endsWith('.css')) continue
      // The title size is reached through `.page-title` only, so every use of it is a page's h1.
      for (const m of text.matchAll(/(?<![\w-])text-title(?![\w-])/g)) off.push(`${file}: ${m[0]} (use the page-title class on the h1)`)
      for (const m of text.matchAll(/<(\w+)[^>]*\bpage-title\b/g)) if (m[1] !== 'h1') off.push(`${file}: page-title on <${m[1]}>`)
    }
    expect(off).toEqual([])
  })
})
