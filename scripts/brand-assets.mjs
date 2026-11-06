#!/usr/bin/env node
// Regenerates the RunF9 brand files (public/brand/, the share image and the touch icon) from the
// logo in src/components/Logo.tsx, so every file matches the app exactly.
//   node scripts/brand-assets.mjs path/to/DMSans-variable.woff2
// The font (DM Sans, the site font) is used only for the taglines on the share image and banners;
// the logo letters are outlines and need no font. Uses the pre-installed Chromium (Playwright).

import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..')
const fontFile = process.argv[2]
if (!fontFile || !fs.existsSync(fontFile)) { console.error('Usage: node scripts/brand-assets.mjs <DM Sans .woff2>'); process.exit(1) }
const font = fs.readFileSync(fontFile).toString('base64')

// The logo geometry, read from the component so there is one source of truth.
const logo = fs.readFileSync(path.join(ROOT, 'src/components/Logo.tsx'), 'utf8')
const WORD = /const WORD = '([^']+)'/.exec(logo)[1]
const R_PATHS = `<path d="M18 88 L43 17 H91 C116 17 128 34 125 52 C123 68 111 77 91 77 H73 L103 104 H73 L52 80 L43 104 H16 L35 43" fill="url(#rf9r)"/>
<path d="M43 17 H91 C114 17 127 31 125 50" fill="none" stroke="#7D65F8" stroke-width="3" opacity=".55"/>
<rect x="41" y="36" width="55" height="8" rx="4" fill="url(#rf9b1)"/>
<rect x="48" y="52" width="41" height="8" rx="4" fill="url(#rf9b2)"/>
<path d="M102 40 L110 48 L102 56 L94 48 Z" fill="#C1B4FF"/>`
const defs = onDark => `<defs><linearGradient id="rf9r" x1="10" y1="85" x2="125" y2="12" gradientUnits="userSpaceOnUse"><stop stop-color="${onDark ? '#3B6CF6' : '#1D4ED8'}"/><stop offset=".42" stop-color="${onDark ? '#2337B8' : '#06141B'}"/><stop offset=".78" stop-color="#344DFF"/><stop offset="1" stop-color="#8B5CF6"/></linearGradient>
<linearGradient id="rf9b1" x1="40" y1="40" x2="96" y2="40" gradientUnits="userSpaceOnUse"><stop stop-color="#79DAFF"/><stop offset="1" stop-color="#2563EB"/></linearGradient>
<linearGradient id="rf9b2" x1="48" y1="56" x2="89" y2="56" gradientUnits="userSpaceOnUse"><stop stop-color="#AFD6FF"/><stop offset="1" stop-color="#7D65F8"/></linearGradient></defs>`

/** Full lockup; onDark = white letters for dark backgrounds. */
const lockup = (onDark, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="20 24 392 110" ${attrs} role="img" aria-label="RunF9"><title>RunF9</title>${defs(onDark)}<g transform="translate(10 18) scale(1.12)">${R_PATHS}</g><path d="${WORD}" fill="${onDark ? '#FFFFFF' : '#07172D'}"/></svg>`
const mark = (attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="14 14 114 92" ${attrs} role="img" aria-label="RunF9"><title>RunF9</title>${defs(false)}${R_PATHS}</svg>`
const appIcon = (attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" ${attrs} role="img" aria-label="RunF9"><title>RunF9</title>${defs(true)}<rect width="512" height="512" rx="120" fill="#0B1226"/><rect x="7" y="7" width="498" height="498" rx="113" fill="none" stroke="#273A65" stroke-width="12"/><g transform="translate(46 70) scale(3.05)">${R_PATHS}</g></svg>`

const B = p => path.join(ROOT, 'public/brand', p)
fs.writeFileSync(B('runf9-logo-light.svg'), lockup(false, 'width="1240" height="348"'))   // navy letters, for light backgrounds
fs.writeFileSync(B('runf9-logo-dark.svg'), lockup(true, 'width="1240" height="348"'))     // white letters, for dark backgrounds
fs.writeFileSync(B('runf9-mark.svg'), mark('width="512" height="413"'))
fs.writeFileSync(B('runf9-icon.svg'), appIcon('width="512" height="512"'))
fs.copyFileSync(path.join(ROOT, 'src/app/icon.svg'), B('runf9-favicon.svg'))

// Network art for the share image and banners: a schedule's logic, the driving path highlighted.
const network = (nodes, links, w, h) => `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="position:absolute;inset:0">${links.map(([a, b, hot]) => `<line x1="${nodes[a][0]}" y1="${nodes[a][1]}" x2="${nodes[b][0]}" y2="${nodes[b][1]}" stroke="${hot ? '#5B9BF0' : '#22406F'}" stroke-width="${hot ? 4 : 3}"/>`).join('')}${nodes.map(([x, y, k]) => `<circle cx="${x}" cy="${y}" r="${k === 'end' ? 11 : 8}" fill="${k === 'end' ? '#FFFFFF' : '#0F1D36'}" stroke="${k === 'dim' ? '#22406F' : '#5B9BF0'}" stroke-width="4"/>`).join('')}</svg>`
const page = (w, h, body) => `<html><head><style>@font-face{font-family:DMS;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:100 1000}
html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden}body{font-family:DMS;position:relative;background:radial-gradient(ellipse at 25% 20%,#16305C 0%,#0E1C38 45%,#0A1426 100%)}</style></head><body>${body}</body></html>`
const tagline = (x, y, size, sub) => `<div style="position:absolute;left:${x}px;top:${y}px;color:#fff"><div style="font-size:${size}px;font-weight:800;letter-spacing:-.02em">Construction scheduling, explained.</div>${sub ? `<div style="font-size:${Math.round(size * 0.5)}px;color:#A9BCD8;margin-top:${Math.round(size * 0.35)}px">${sub}</div>` : ''}</div>`

const browser = await chromium.launch(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {})
async function render(file, w, h, html, transparent = false) {
  const p = await browser.newPage({ viewport: { width: w, height: h } })
  await p.setContent(html); await p.evaluate(() => document.fonts.ready)
  await p.screenshot({ path: file, omitBackground: transparent })
  await p.close()
}
const plain = (w, h, svg) => `<html><body style="margin:0;width:${w}px;height:${h}px;display:flex;align-items:center;justify-content:center">${svg}</body></html>`

// Logos (transparent) for print, documents and email.
await render(B('runf9-logo-light.png'), 2480, 880, plain(2480, 880, lockup(false, 'width="2200"')), true)
await render(B('runf9-logo-dark.png'), 2480, 880, plain(2480, 880, lockup(true, 'width="2200"')), true)
await render(B('runf9-email-logo-light.png'), 372, 132, plain(372, 132, lockup(false, 'width="340"')), true)
await render(B('runf9-email-logo-dark.png'), 372, 132, plain(372, 132, lockup(true, 'width="340"')), true)
await render(B('profile-picture-1024.png'), 1024, 1024, plain(1024, 1024, appIcon('width="1024" height="1024"')), true)

// Share image (link previews on LinkedIn, X, Slack, iMessage) and social headers.
const ogNodes = [[886, 188], [1006, 151, 'dim'], [1110, 188], [1184, 284, 'end'], [1050, 327], [946, 390], [1155, 440, 'dim'], [977, 535, 'dim']]
const og = page(1200, 630, `${network(ogNodes, [[0, 1], [1, 2], [0, 5, 1], [5, 4, 1], [4, 2, 1], [2, 3, 1], [4, 6], [5, 7], [7, 6]], 1200, 630)}
<div style="position:absolute;left:80px;top:150px">${lockup(true, 'height="168"')}</div>${tagline(84, 372, 46, 'Build, check and forecast P6 &amp; MS Project schedules.')}`)
await render(path.join(ROOT, 'src/app/opengraph-image.png'), 1200, 630, og)
await render(path.join(ROOT, 'src/app/twitter-image.png'), 1200, 630, og)
const liNodes = [[918, 118], [1172, 95, 'dim'], [1393, 118], [1551, 178, 'end'], [1266, 205], [1045, 245], [1488, 276, 'dim'], [1108, 336, 'dim']]
await render(B('linkedin-banner-1584x396.png'), 1584, 396, page(1584, 396, `${network(liNodes, [[0, 1], [1, 2], [0, 5, 1], [5, 4, 1], [4, 2, 1], [2, 3, 1], [4, 6], [5, 7], [7, 6]], 1584, 396)}
<div style="position:absolute;left:92px;top:92px">${lockup(true, 'height="150"')}</div>${tagline(96, 268, 30)}`))
const xNodes = [[900, 140], [1130, 110, 'dim'], [1330, 150], [1440, 240, 'end'], [1180, 260], [990, 300], [1380, 360, 'dim'], [1060, 410, 'dim']]
await render(B('x-header-1500x500.png'), 1500, 500, page(1500, 500, `${network(xNodes, [[0, 1], [1, 2], [0, 5, 1], [5, 4, 1], [4, 2, 1], [2, 3, 1], [4, 6], [5, 7], [7, 6]], 1500, 500)}
<div style="position:absolute;left:92px;top:130px">${lockup(true, 'height="160"')}</div>${tagline(96, 318, 34)}`))
await browser.close()
console.log('Brand files written to public/brand/ and src/app/ (opengraph-image.png, twitter-image.png).')
