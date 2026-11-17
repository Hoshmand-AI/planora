# RunF9 design system: how the v1.0 handoff maps to the code

The *RunF9 UI/UX and Brand System v1.0* package (an outside design handoff built from this repository's
source) is a refinement of the existing identity, not a rebrand. This page records what in it is already
the product, what was implemented from it, and what is left for an owner decision. Use the Tailwind names
below in code; never hard-code the hex values.

## Already the product (verified identical)
- **Brand assets:** `public/brand/runf9-logo-light.svg`, `runf9-logo-dark.svg`, `runf9-mark.svg`,
  `runf9-icon.svg`, `runf9-favicon.svg` are byte-for-byte the package's files. `src/components/Logo.tsx` is the in-app lockup.
- **Typeface:** DM Sans through `next/font` (`src/app/layout.tsx`), Tailwind `font-sans` / `font-display`.
- **The pattern (11/2026):** greys carry no hue and step evenly from `ink` to `warm-400`; color appears only where it means something (one filled blue button per view, status dots and badges, the navy bar). Text sizes come from one short scale, used by level (see **Type** below). Weights are regular, medium and semibold only; no half-pixel sizes and no bold or heavier in the app.
- **Type (11/2026):** the app has five text sizes, one per level of a page, and nothing else. Size follows position: the page title, at the top-left, is the largest text on the page; a level down the page or into a card is one step smaller; in a row the leftmost text is the largest and the notes and controls to its right are smaller. So a reader can tell what is inside what from the size alone.

  | Level | Class | Size | What it is |
  |---|---|---|---|
  | 1 | `page-title` (on the `<h1>`) | 20px | The page title: once per page, top-left. Nothing else is this size. |
  | 2 | `text-heading` | 16px | A section's heading (`<h2>`), a dialog's title, the figure that answers the page (the forecast finish), a figure on a tile directly under a section heading. |
  | 3 | `text-subhead` | 14px | The title of an item inside a section: a card, a row, a folded row, a sub-heading (`<h3>`), a navigation item or tab; a figure inside a card. |
  | 4 | `text-body` | 13px | Everything read or operated: text, buttons, fields, table cells, menus. |
  | 5 | `text-caption` | 12px | Notes: captions, hints, column headers, badges, chart text. |

  Rules: (a) nothing inside a section, card, row or dialog is larger than that container's own heading; (b) a figure is never set larger to make it important: it takes the size of the heading of what it sits in, in semibold ink with tabular numerals, and it comes first, with its caption under it; (c) body text is 13px everywhere, and 14px is only ever the title of an item; (d) the same sizes on a phone and a desktop (form fields are 16px on touch screens, which is on the scale, so iOS does not zoom). Public pages (landing, sign-in, legal) add headline sizes above these: `text-display` 64, `text-h1` 40, `text-h2` 28, `text-h3` 20, `text-lead` 18, `text-copy` 16, `text-small` 14, `text-fine` 13; a headline is one size on a phone and one on a desktop (`text-h1 md:text-display`, `text-h2 md:text-h1`, `text-h3 md:text-h2`). The sizes are the only entries in `theme.fontSize` (`tailwind.config.js`), so Tailwind's `text-sm` or an arbitrary `text-[17px]` do not exist. `src/lib/type-scale.test.ts` fails the build on a size written as an arbitrary class, a default Tailwind name or an off-scale value in a stylesheet or an inline `fontSize`, on a headline size in app code, and on an `<h1>` that is not the `page-title`; `scripts/type-audit.mjs` measures every screen in the browser at desktop, tablet and phone widths (run by `scripts/a11y-check.mjs` in CI) and fails if a text is off the scale, if a page shows a second title or anything as large as it, or if something is larger than the first heading of its section, card or dialog. A figure on a public page (a price, a statistic, the hero's finish date) is `text-h2` at both widths. Emails are laid out separately for mail clients (`src/lib/server/email-template.ts`).
- **Noise rules (11/2026):** (1) a fact is shown once per page: a date or a count that the header states is not repeated in a tile, a heading and a sentence below it; (2) one filled button per view, the next step, and every other action is outlined, a text link or in the "…" menu; (3) what is not needed to decide the next step is folded, with its answer in the row's right-hand note (for example "0% chance of 03/01/2028"); (4) long lists open as their groups (phases), not as every row; (5) a filter, legend entry or count that says nothing (zero, or everything) is not shown; (6) forms that are rarely used open from a button; (7) labels are sentence case, never uppercase with letter-spacing; (8) a figure on a tile is plain ink and its status is a small dot beside the caption; (9) a chart is drawn at the width it is shown at, so its text is the app's 12px on a phone and on a wide screen, and what it says in words is its accessible name, not a paragraph under it; (10) finished work starts folded (a completed group on the Gantt chart, passing rules in a standards run); (11) a dialog is a plain list on white (rows divided by hairlines, the current item ticked), never boxes inside a box, and what few people need sits under "More options"; (12) a status is said in one place: before a plan has a schedule the interview's own card is the status and carries the one build button, so the page header repeats neither; (13) a result opens with its figures and, where there is one, its chart, and the method and the inputs are folded under it (schedule risk analysis: P50, P80, the chance of meeting the date, the spread of finishes); (14) a question shows one way to answer and one button, and a rarer way to answer opens from a link ("Not in the US?"); (15) amounts are written as people write them ("$12,000 per calendar day", "90%"), through `fmtAmount` in `src/lib/format.ts`. (16) an empty page is a heading, one sentence and one action: no decorative mark in a box, and no explanation of the product to someone who has already signed up; (17) a destructive or rare form (delete the organization, transfer ownership, a new API key or webhook) is a button until it is asked for, and then shows only its own fields.
- **Surfaces:** the app canvas is white; panels are separated by a `warm-200` hairline and carry no shadow.
- **Color tokens:** every value in the package's `runf9.tokens.css` equals `tailwind.config.js`:

| Package token | Tailwind | Value | Use |
|---|---|---|---|
| text | `ink` | #1D2125 | titles, figures, primary text: a neutral near-black with no hue |
| `--rf-navy-950/900/800` | `navy-950/900/800` | #0C2340 #14304F #1F3F61 | the one brand dark: the top bar, the finish forecast, dark sections of the public site |
| `--rf-navy-700/400/200` | `navy-700/400/200` | #555B61 #A2A7AC #D3D6D9 | neutral greys used on dark surfaces |
| `--rf-accent-700/600/500/400/100` | `accent-700/600/500/400/100` | #1F4E9E #2B63C1 #4A82D6 #7FAAE8 #EEF3FB | actions, links, selection, focus |
| `--rf-warm-50` / canvas | `warm-50` | #FAFAFB | page background |
| `--rf-warm-100/200/300` | `warm-100/200/300` | #F4F5F6 #E8EAEC #D3D6D9 | soft surface, dividers, input borders |
| `--rf-warm-400/500/600/700` | `warm-400/500/600/700` | #666C72 #5A6066 #4B5056 #33383D | muted → body text, in even steps (all AA on light surfaces) |
| `--rf-status-*` and `*-bg` | `status-on-track`, `status-attention`, `status-at-risk`, `status-info`, `status-complete` (+ `-bg`) | #2F7358 **#1F4E9E** #A64848 #3A6A9C #4F7F61 | data meaning only, always with a word label. *Attention* was amber #94601C in the handoff; the owner's palette has no amber, so it uses the palette's deep blue (#1D4ED8 on #EFF6FF). |

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
- **Schedule bars: three colours.** Every timeline (the Gantt chart, the plan builder, the Overview ribbon, the exports and the public page) uses the `bar` tokens and no others: blue (`bar-done`) for work done, green (`bar-todo`) for work remaining, red (`bar-critical`) for the critical path. This is what a Primavera P6 user expects. A baseline and the data date are lines, not bars. Critical work also carries a “Critical” legend label and an “On the critical path” badge, so colour is never the only signal.

## Rules for new UI
- One H1 per page (`page-title`); section H2 (`text-heading`); card H3 (`text-subhead`). Sizes only from the type scale above. Dates through `src/lib/format.ts` (MM/DD/YYYY or the project's DD/MM/YYYY) with `tabular-nums`.
- Status = color + word (+ dot/icon). Never a bare colored dot.
- Touch targets ≥ 44 px on phones; scrollable regions get `tabIndex={0}` and a label.
- Figures come from the schedule engine; AI-written narrative is labelled as such.
- Run `scripts/a11y-check.mjs` (desktop and phone) for any visual change.
