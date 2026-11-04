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
| `--rf-status-*` and `*-bg` | `status-on-track`, `status-attention`, `status-at-risk`, `status-info`, `status-complete` (+ `-bg`) | #2F7358 #94601C #A64848 #3A6A9C #4F7F61 | data meaning only, always with a word label |

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

## Not implemented: needs an owner decision
- **Marketing hero redesign** (dark navy hero, new headline “Know the finish. Show the logic.”). It changes public copy and positioning, so the owner should decide.
- **Collapsible 72 px icon rail** and **tablet icon-rail sidebar.** These are proposals in the package, not existing behavior.
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
