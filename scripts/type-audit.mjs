// The type scale, measured in the browser (docs/design/DESIGN-SYSTEM.md, "Type"). Used by scripts/a11y-check.mjs
// on every screen at desktop, tablet and phone widths.
//
// What it checks on a rendered page:
//   1. every text is one of the scale's sizes (five in the app; public pages add their headline sizes);
//   2. in the app, the page title (the h1) is the largest text, alone at its size, and nothing as large as a
//      section heading sits above it;
//   3. nothing inside a section, card, row or dialog is larger than that container's own heading.
// It returns a list of problems (empty when the page is on the scale).

export const APP_SIZES = [12, 13, 14, 16, 20]
export const PUBLIC_SIZES = [12, 13, 14, 16, 18, 20, 28, 40, 64]

/** @param {import('playwright').Page} page */
export async function typeProblems(page) {
  const app = new URL(page.url()).pathname.startsWith('/dashboard')
  return page.evaluate(({ app, allowed }) => {
    const problems = []
    const sizeOf = el => Math.round(parseFloat(getComputedStyle(el).fontSize) * 100) / 100
    const shown = el => {
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        const cs = getComputedStyle(e)
        if (cs.display === 'none' || cs.visibility === 'hidden') return false
      }
      const r = el.getBoundingClientRect()
      // Screen-reader-only text is a 1px box; a closed panel has no box at all.
      return r.width > 1 && r.height > 1
    }
    const say = el => {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40)
      return `<${el.tagName.toLowerCase()}> "${t}"`
    }
    // Every element that directly holds text, and every form field (its value is not a text node).
    const texts = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const seen = new Set()
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement
      if (!n.textContent.trim() || !el || seen.has(el)) continue
      if (el.closest('script, style, noscript, title, [data-type-exempt]')) continue
      seen.add(el)
      if (shown(el)) texts.push(el)
    }
    for (const el of document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]), select, textarea')) if (shown(el)) texts.push(el)

    // 1. On the scale.
    const off = texts.filter(el => !allowed.includes(sizeOf(el)))
    for (const el of off.slice(0, 6)) problems.push(`${sizeOf(el)}px is not on the scale: ${say(el)}`)
    if (off.length > 6) problems.push(`…and ${off.length - 6} more off the scale`)

    if (app) {
      // 2. One title, the largest text, with nothing heading-sized above it.
      const chrome = el => !!el.closest('aside, nav[aria-label="Breadcrumb"], header, [role="dialog"], nav[aria-label="Primary"]')
      const h1s = [...document.querySelectorAll('h1')].filter(shown)
      if (h1s.length > 1) problems.push(`${h1s.length} page titles (h1) on one page`)
      const title = h1s[0]
      const body = texts.filter(el => !chrome(el))
      const top = Math.max(...allowed)
      for (const el of body) if (sizeOf(el) >= top && el !== title && !title?.contains(el)) problems.push(`as large as the page title: ${say(el)}`)
      if (title) {
        if (sizeOf(title) !== top) problems.push(`the page title is ${sizeOf(title)}px, not ${top}px`)
        const y = title.getBoundingClientRect().top
        for (const el of body) {
          if (el === title || title.contains(el)) continue
          if (sizeOf(el) >= 16 && el.getBoundingClientRect().bottom <= y) problems.push(`above the page title and as large as a heading: ${say(el)}`)
        }
      }
    }

    // 3. Nothing inside a container is larger than the container's heading. In the app a container is a section,
    //    a card or row, a folded panel or a dialog; on public pages only a section (a price may outsize its card's title).
    const containers = app ? 'section, article, aside, li, details, [role="dialog"], [role="region"]' : 'section'
    for (const box of document.querySelectorAll(containers)) {
      if (!shown(box)) continue
      const heading = [...box.querySelectorAll('h1, h2, h3, h4')].find(shown)
      if (!heading) continue
      const limit = sizeOf(heading)
      for (const el of texts) {
        if (!box.contains(el) || heading.contains(el)) continue
        if (sizeOf(el) > limit) { problems.push(`${sizeOf(el)}px inside a block headed at ${limit}px (${say(heading)}): ${say(el)}`); break }
      }
    }
    return [...new Set(problems)]
  }, { app, allowed: app ? APP_SIZES : PUBLIC_SIZES })
}
