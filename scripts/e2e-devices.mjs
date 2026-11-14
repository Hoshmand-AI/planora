#!/usr/bin/env node
// Device journeys: the same user path on iPhone, iPad and desktop profiles (screen size, pixel density, touch,
// mobile mode). Sign in, open the data-location chip, tap search (16px text, so Safari doesn't zoom), check the
// status tiles fit, open a project by tapping its card, tap through all eight project tabs, zoom the schedule,
// and use the bottom navigation (phones) or the sidebar collapse button (tablets, desktop). Every page must fit
// the screen width. Needs a server with RUNF9_SIGNUP=open:   BASE_URL=http://localhost:3000 node scripts/e2e-devices.mjs
// SCREENSHOTS=dir saves a few screenshots per device.

import fs from 'node:fs'
import path from 'node:path'
import { chromium, devices } from 'playwright'

const BASE = process.env.BASE_URL || 'http://localhost:3000', origin = new URL(BASE).origin, out = process.env.SCREENSHOTS
if (out) fs.mkdirSync(out, { recursive: true })
const executablePath = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined
const DEVICES = ['iPhone SE', 'iPhone 15', 'iPhone 15 Pro Max', 'iPad Mini', 'iPad Pro 11', 'iPad Pro 11 landscape', 'Desktop Chrome']
const browser = await chromium.launch(executablePath ? { executablePath } : {})
const xer = fs.readFileSync(path.join(process.cwd(), 'src/lib/parsers/__fixtures__/sample.xer'))
// One account and one uploaded schedule, signed in once and reused by every device (sign-ups are rate limited per network).
const setup = await browser.newContext()
await setup.request.post(BASE + '/api/auth', { data: { action: 'signup', email: `devices${Date.now()}@example.com`, password: 'correct horse battery staple', name: 'Dana Device', company: 'Device Testing Construction Company' }, headers: { origin } })
const up = await setup.request.post(`${BASE}/api/schedules`, { headers: { origin }, multipart: { file: { name: 'sample.xer', mimeType: 'application/octet-stream', buffer: xer } } })
if (!up.ok()) { console.error(`✗ Could not sign up and upload the sample schedule (HTTP ${up.status()})`); process.exit(1) }
const storageState = await setup.storageState()
await setup.close()
let failures = 0
const fail = (d, m) => { failures++; console.log(`   ✗ ${m}`) }
for (const name of DEVICES) {
  const { defaultBrowserType, ...desc } = devices[name]
  const ctx = await browser.newContext({ ...desc, storageState })
  const page = await ctx.newPage()
  const touch = !!desc.hasTouch
  const tap = async loc => touch ? loc.tap() : loc.click()
  console.log(`\n${name}: ${desc.viewport.width}x${desc.viewport.height} @${desc.deviceScaleFactor}x, touch=${touch}`)
  const fits = async (where) => {
    const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (o > 0) fail(name, `${where}: page ${o}px wider than the screen`)
  }
  await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle' })
  console.log(`   pointer coarse: ${await page.evaluate(() => matchMedia('(pointer: coarse)').matches)}`)
  await fits('Projects')
  // 1. Data location collapsible
  const chip = page.getByRole('button', { name: /Data storage/ })
  await tap(chip); await page.waitForTimeout(450)
  if (await chip.getAttribute('aria-expanded') !== 'true') fail(name, 'data-location chip did not open')
  else console.log('   ✓ data-location chip opens')
  await tap(chip); await page.waitForTimeout(350)
  // Search field: 16px on touch screens so Safari doesn't zoom
  const search = page.getByLabel('Search projects')
  await tap(search)
  const fs16 = await search.evaluate(e => parseFloat(getComputedStyle(e).fontSize))
  if (touch && fs16 < 16) fail(name, `search text ${fs16}px (Safari would zoom)`); else console.log(`   ✓ search text ${fs16}px`)
  // Status tiles all fully on screen
  const tilesOk = await page.evaluate(() => [...document.querySelectorAll('[aria-label="Filter projects by status"] button')].every(b => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= document.documentElement.clientWidth }))
  if (!tilesOk) fail(name, 'a status tile is off screen'); else console.log('   ✓ status tiles all on screen')
  if (out) await page.screenshot({ path: `${out}/${name.replace(/\W+/g, '-')}-projects.png` })
  // 2. Open the project from its card
  await tap(page.getByRole('button', { name: /Riverside Warehouse/ }).first())
  await page.waitForURL(/dashboard\/project/); await page.waitForLoadState('networkidle')
  await fits('Overview')
  if (out) await page.screenshot({ path: `${out}/${name.replace(/\W+/g, '-')}-overview.png` })
  // Every project tab
  for (const tab of ['Today', 'Schedule', 'Quality', 'Delays', 'Resources', 'Documents', 'Reports', 'Ask', 'Overview']) {
    const link = page.getByRole('navigation', { name: 'Project' }).getByRole('link', { name: tab, exact: true })
    await link.scrollIntoViewIfNeeded(); await tap(link)
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(300)
    const current = await page.getByRole('navigation', { name: 'Project' }).locator('[aria-current="page"]').textContent()
    if (current?.trim() !== tab) fail(name, `tab ${tab} not current (${current})`)
    await fits(tab)
    if (tab === 'Schedule') {
      if (desc.viewport.width >= 768) {
        // The data-date line must sit under its own label: both are placed by date, in two different containers.
        const lab = await page.getByText(/^Data date \d/).first().boundingBox().catch(() => null)
        const line = await page.locator('span.absolute.inset-y-0.w-0\\.5').first().boundingBox().catch(() => null)
        if (lab && line) { if (line.x < lab.x - 2 || line.x > lab.x + lab.width + 2) fail(name, `Schedule data-date line at ${Math.round(line.x)} is not under its label (${Math.round(lab.x)}–${Math.round(lab.x + lab.width)})`); else console.log('   ✓ Schedule data-date line is under its label') }
        await tap(page.getByRole('button', { name: 'Zoom in' })); await page.waitForTimeout(300)
        await fits('Schedule zoomed')
      } else {
        // Phones get a list in place of the chart: every activity row must show its dates in words, and no zoom control.
        const row = await page.locator('button[aria-pressed]').filter({ hasText: /\d{2}\/\d{2}\/\d{4}/ }).first().textContent().catch(() => null)
        if (!row) fail(name, 'Schedule list shows no activity dates on a phone'); else console.log('   ✓ Schedule is a list with dates on a phone')
        if (await page.getByRole('button', { name: 'Zoom in' }).isVisible().catch(() => false)) fail(name, 'zoom control shown on a phone, where there is no chart')
      }
      if (out) await page.screenshot({ path: `${out}/${name.replace(/\W+/g, '-')}-schedule.png` })
    }
  }
  console.log('   ✓ all 9 project tabs open by tap and fit the screen')
  // Sidebar collapse on tablets and desktops
  if (desc.viewport.width >= 768) {
    const w = () => page.evaluate(() => Math.round(document.querySelector('aside').getBoundingClientRect().width))
    const before = await w()
    const btn = page.getByRole('button', { name: /(Collapse|Expand) sidebar/ })
    await tap(btn); await page.waitForTimeout(400)
    const after = await w()
    if (before === after) fail(name, 'sidebar toggle did nothing'); else console.log(`   ✓ sidebar ${before}px → ${after}px`)
    await fits('sidebar toggled')
  } else {
    const nav = await page.getByRole('navigation', { name: 'Main (mobile)' }).isVisible()
    if (!nav) fail(name, 'bottom navigation missing'); else console.log('   ✓ bottom navigation visible')
  }
  await ctx.close()
}
await browser.close()
console.log(failures ? `\n${failures} problem(s)` : '\nAll device journeys passed')
process.exit(failures ? 1 : 0)
