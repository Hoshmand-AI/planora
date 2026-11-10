// Temporary UI walk script (review only). Usage: node scripts/_ui_walk.mjs <desktop|tablet|phone> <pm|new|public|explore>
import { chromium } from 'playwright'
import fs from 'node:fs'

const OUT = '/tmp/claude-0/-home-user-planora/49628d70-d906-51be-a2a3-fdde71339ffa/scratchpad/ui'
const BASE = 'http://localhost:3000'
const VP = { desktop: { width: 1440, height: 900 }, tablet: { width: 820, height: 1180 }, phone: { width: 390, height: 844 } }
const vpName = process.argv[2] || 'desktop'
const stage = process.argv[3] || 'pm'
const log = { vp: vpName, stage, steps: [], events: [] }
let step = 'init'

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const ctx = await browser.newContext({ viewport: VP[vpName], isMobile: vpName === 'phone', hasTouch: vpName !== 'desktop', deviceScaleFactor: 1, permissions: ['clipboard-read', 'clipboard-write'] })
const page = await ctx.newPage()
page.on('console', m => { if (m.type() === 'error') log.events.push({ step, kind: 'console', text: m.text().slice(0, 400), url: page.url() }) })
page.on('pageerror', e => log.events.push({ step, kind: 'pageerror', text: String(e).slice(0, 600), url: page.url() }))
page.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) log.events.push({ step, kind: r.status() >= 500 ? 'http5xx' : 'http4xx', status: r.status(), url: r.url().replace(BASE, ''), method: r.request().method() }) })
page.on('dialog', d => { log.events.push({ step, kind: 'dialog', text: d.message() }); d.accept().catch(() => {}) })

const RAW = [/\b\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?\b/g, /\bundefined\b/g, /\bNaN\b/g, /\bnull\b/g, /\[object Object\]/g, /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, /\bat [\w.]+ \(.*:\d+:\d+\)/g, /\bInfinity\b/g, /\b\d{1,2}\/\d{1,2}\/\d{2}\b(?!\d)/g, /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4}\b/g]
async function settle(ms = 15000) {
  const t0 = Date.now()
  await page.waitForLoadState('networkidle', { timeout: ms }).catch(() => {})
  // spinners
  while (Date.now() - t0 < ms) {
    const n = await page.locator('.animate-spin:visible').count().catch(() => 0)
    if (!n) return { spin: false, ms: Date.now() - t0 }
    await page.waitForTimeout(400)
  }
  return { spin: true, ms }
}
async function snap(name, note = '') {
  step = name
  const s = await settle()
  await page.waitForTimeout(350)
  const info = await page.evaluate(() => {
    const de = document.documentElement
    const wide = []
    if (de.scrollWidth > window.innerWidth) {
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect()
        if (r.right > window.innerWidth + 1 && r.width > 0 && r.width < window.innerWidth * 3) { wide.push(`${el.tagName}.${String(el.className).slice(0, 60)} right=${Math.round(r.right)}`); if (wide.length > 6) break }
      }
    }
    // clipped text: elements whose scrollWidth exceeds clientWidth with overflow hidden and no ellipsis title
    const clipped = []
    for (const el of document.querySelectorAll('button, a, h1, h2, h3, th, td, span, p, label, dt, dd')) {
      const cs = getComputedStyle(el)
      if (!el.offsetParent) continue
      if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && el.innerText.trim()) {
        clipped.push(`${el.tagName} "${el.innerText.trim().slice(0, 70)}" ${el.clientWidth}/${el.scrollWidth}${cs.textOverflow === 'ellipsis' ? ' (ellipsis)' : ''}`)
        if (clipped.length > 14) break
      }
    }
    return { sw: de.scrollWidth, iw: window.innerWidth, h: de.scrollHeight, wide, clipped, text: document.body.innerText, title: document.title }
  })
  const raw = []
  for (const re of RAW) { const m = info.text.match(re); if (m) raw.push(...[...new Set(m)].slice(0, 6).map(x => { const i = info.text.indexOf(x); return `${x} :: …${info.text.slice(Math.max(0, i - 50), i + x.length + 30).replace(/\n/g, ' ⏎ ')}…` })) }
  const file = `${vpName}-${name}.png`
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true }).catch(e => log.events.push({ step, kind: 'shot-fail', text: String(e) }))
  fs.writeFileSync(`${OUT}/text-${vpName}-${name}.txt`, info.text)
  const rec = { name, file, url: page.url().replace(BASE, ''), note, overflow: info.sw > info.iw ? `${info.sw}>${info.iw}` : '', wide: info.wide, clipped: info.clipped, spinnerStuck: s.spin, raw, height: info.h }
  log.steps.push(rec)
  console.log(`[${vpName}] ${name} ${rec.url} ${rec.overflow ? 'OVERFLOW ' + rec.overflow : ''} ${s.spin ? 'SPINNER-STUCK' : ''} raw=${raw.length}`)
  return info
}
const note = (t) => { log.steps.push({ name: step, note: t }); console.log('   · ' + t) }
async function tryDo(label, fn) { try { await fn(); } catch (e) { note(`COULD NOT: ${label}: ${String(e).split('\n')[0].slice(0, 200)}`) } }
async function buttons() { return page.evaluate(() => [...document.querySelectorAll('main button, main a, main select, main input, main textarea, main summary, main [role=tab]')].filter(e => e.offsetParent).map(e => `${e.tagName}${e.type ? '[' + e.type + ']' : ''}:${(e.innerText || e.getAttribute('aria-label') || e.placeholder || e.name || '').trim().replace(/\s+/g, ' ').slice(0, 60)}`).slice(0, 150)) }
async function signup(tag) {
  const email = `ui${Date.now()}${tag}@example.com`
  const r = await ctx.request.post(`${BASE}/api/auth`, { data: { action: 'signup', email, password: 'correct horse battery staple', name: 'Dana PM', company: 'Demo Builders' } })
  note(`signup ${email} -> ${r.status()}`)
  if (r.status() >= 400) note('signup body: ' + (await r.text()).slice(0, 300))
  return email
}
const sidOf = () => new URL(page.url()).searchParams.get('schedule')
const done = async () => { fs.writeFileSync(`${OUT}/log-${vpName}-${stage}.json`, JSON.stringify(log, null, 1)); await browser.close() }
const h = { page, ctx, snap, note, tryDo, buttons, signup, sidOf, settle, BASE, OUT, vpName, stage, log, setStep: s => { step = s } }
const mod = await import(`${OUT}/stage_${stage}.mjs`).catch(e => { console.error(e); return null })
if (mod) { try { await mod.default(h) } catch (e) { note('FATAL ' + String(e).slice(0, 500)); await page.screenshot({ path: `${OUT}/${vpName}-${stage}-FATAL.png` }).catch(() => {}) } }
await done()
