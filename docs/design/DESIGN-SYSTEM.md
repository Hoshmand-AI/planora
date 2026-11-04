# RunF9 design system: how the v1.0 handoff maps to the code

The *RunF9 UI/UX and Brand System v1.0* package (an outside design handoff built from this repository's
source) is a refinement of the existing identity, not a rebrand. This page records what in it is already
the product, what was implemented from it, and what is left for an owner decision. Use the Tailwind names
below in code; never hard-code the hex values.

## Already the product (verified identical)
- **Brand assets:** `public/brand/runf9-logo-light.svg`, `runf9-logo-dark.svg`, `runf9-mark.svg`,
  `runf9-icon.svg`, `runf9-favicon.svg` are byte-for-byte the package's files. `src/components/Logo.tsx` is the in-app lockup.
- **Typeface:** DM Sans through `next/font` (`src/app/layout.tsx`), Tailwind `font-sans` / `font-display`.
- **Color tokens:** every value in the package's `runf9.tokens.css` equals `tailwind.config.js`:

| Package token | Tailwind | Value | Use |
|---|---|---|---|
| `--rf-navy-950` / text | `navy-950` | #06141B | headings, primary text |
| `--rf-navy-900` | `navy-900` | #11212D | app sidebar, dark surfaces |
| `--rf-navy-800/700/400/200` | `navy-800/700/400/200` | #253745 #4A5C6A #9BA8AB #CCD0CF | dark-surface layers |
| `--rf-accent-700/600/500/400/100` | `accent-700/600/500/400/100` | #1D4ED8 #2563EB #3B82F6 #60A5FA #EFF6FF | actions, links, selection, focus |
| `--rf-warm-50` / canvas | `warm-50` | #FAFBFB | page background |
| `--rf-warm-100/200/300` | `warm-100/200/300` | #F4F6F6 #EBEEEE #CCD0CF | soft surface, dividers, input borders |
| `--rf-warm-400/500/600/700` | `warm-400/500/600/700` | #56656F #4C5B66 #3F4E5A #253745 | muted → body text (all AA on light surfaces) |
| `--rf-status-*` and `*-bg` | `status-on-track`, `status-attention`, `status-at-risk`, `status-info`, `status-complete` (+ `-bg`) | #2F7358 **#1D4ED8** #A64848 #3A6A9C #4F7F61 | data meaning only, always with a word label. *Attention* was amber #94601C in the handoff; the owner's palette has no amber, so it uses the palette's deep blue (#1D4ED8 on #EFF6FF). |

- **Motion:** the package's timings are the ones in `src/app/globals.css` (`.pressable` 120 ms, color 160 ms,
  `.page-enter` 420 ms, disclosure 320 ms, `cubic-bezier(.22,1,.36,1)`), with `prefers-reduced-motion` honored.
- **Focus:** `:focus-visible` is a 2 px `accent-600` outline everywhere (`accent-400` on dark navigation).

## Implemented from the package (UI release 1)
| Area | Change | Package reference |
|---|---|---|
| Schedule (Gantt) | Calendar-aligned time ruler (weeks, months, quarters or years by span and zoom; partial first period named), period gridlines, data-date flag on the ruler | Gantt: “time ruler”, “vertical lines #EBEEEE” |
| Schedule (Gantt) | Explicit zoom toolbar (−, fit, +). Zoom widens the chart; the time scale never changes with filters | Gantt: “zoom via explicit toolbar buttons”; Motion: “wheel must not rescale” |
| Schedule (Gantt) | 42 px activity rows; each row's accessible name includes its dates and critical/complete state, so bar length and color are not the only signal | Gantt row rhythm; Accessibility: “bar length is not the only signal” |
| Schedule (Gantt) | Row focus ring drawn inside the chart so it isn't clipped | Accessibility: visible focus |
| Quality | Pass / Fail / Warning / Not applicable counted separately under the score; N/A is never shown as passed | DCMA: “Pass, Fail, Not applicable as separate states” |
| App sidebar | Active item gets a blue indicator and icon, in addition to the label and background | Global sidebar: “active indicator blue + label” |
| Accessibility | Scrollable tables and code blocks are keyboard-reachable regions (Organization, Beta access, SSO/SCIM, API keys, Firm data, Deploy, cloud policy); Firm-data inputs are labelled; DCMA tiles only reference the detail panel when it exists | WCAG 2.2 AA gates |
| CI | `scripts/a11y-check.mjs` also runs every screen at phone width (390×844) | Responsive: 320–768 px checks |

## UI release 2: palette, collapsibles, phone/iPad
| Area | Change |
|---|---|
| Palette | Status tiles (`.mood-tile`) were tinted peach/green/blue with colored glows from colors outside the palette (#FFF8F0, #F6DFC2, #E0902F and others), and the amber ring color #B86E1A wasn't the palette's either. Tiles are now the palette's white surface with the #EBEEEE divider and the standard card shadow; status shows as the figure's palette status color. The dark finish card's verdict is a pill in the palette's status colors (it used three off-palette pastels). The remaining stray literals now use their palette equivalents. `src/lib/palette.test.ts` fails the build if a hex color outside `tailwind.config.js` appears in a component or stylesheet (logo artwork and generated icons excepted). |
| Collapsibles | Projects: “Data stored in … · Connect AWS, Azure or Google Cloud” is now one chip; opening it explains where data and document search live and offers the cloud connection. Sidebar: collapse/expand button; a 72 px icon rail by default on tablets (768–1023 px), the full 240 px panel on desktops; the choice is remembered in the browser. |
| Phone and iPad | Form text is 16 px on touch screens, so iOS Safari no longer zooms the page when a field is tapped (the zoom made pages look cut off on the right). Projects status tiles wrap into a grid (3 across on phones, 5 from 768 px) instead of a sideways strip. Overview tiles are 2 across until 1024 px. Landing figures fit 320 px phones. |
| CI | `scripts/a11y-check.mjs` checks every screen at desktop (1280), iPad (820×1180) and phone (390×844) widths, and fails if a page is wider than the screen. |
| Device journeys | `scripts/e2e-devices.mjs` runs one user path on iPhone SE, iPhone 15, iPhone 15 Pro Max, iPad Mini, iPad Pro 11 (portrait and landscape) and desktop profiles (screen size, pixel density, touch): data-location chip, search without zoom, status tiles on screen, open a project by tap, all eight project tabs, schedule zoom, bottom navigation or sidebar collapse. Every page must fit the screen. Uses Chromium's device emulation, not physical devices. |
| Palette | “Needs attention” is the palette's deep blue (#1D4ED8 on #EFF6FF), not amber: the owner's palette has no amber. |

## Not implemented: needs an owner decision
- **Marketing hero redesign** (dark navy hero, new headline “Know the finish. Show the logic.”). It changes public copy and positioning, so the owner should decide.
- **Mockup simplifications that would remove information.** The package's own rule (“do not remove functional density”) wins over its previews:
  - the Projects page keeps “Needs an update”, sort, and the cards/table switch
  - the Schedule keeps its phase grouping and progress bars
  - Quality keeps all 14 check tiles and the decision workflow
- **Critical-path color.** The package suggests blue for critical bars. The product uses at-risk red with a “Critical” legend label and an “On the critical path” badge, and keeps that so critical and planned work stay distinct.

## Rules for new UI
- One H1 per page; section H2; card H3. Dates through `src/lib/format.ts` (MM/DD/YYYY or the project's DD/MM/YYYY) with `tabular-nums`.
- Status = color + word (+ dot/icon). Never a bare colored dot.
- Touch targets ≥ 44 px on phones; scrollable regions get `tabIndex={0}` and a label.
- Figures come from the schedule engine; AI-written narrative is labelled as such.
- Run `scripts/a11y-check.mjs` (desktop and phone) for any visual change.
