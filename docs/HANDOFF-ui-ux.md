# RunF9 UI/UX work: handoff

Written 2026-11-15 so the work can continue in another Claude Code session or account.
Read `CLAUDE.md` at the repo root first: it holds the shipping rules, the check commands and the security rules.

## The goal

The owner's goal, verbatim:

> through firecrawl go and scrape websites for Procore, Autodesk, Apple, Google, and all the best websites in the Globe and Make my website's user interface, and user experience as one of the top ones.

**It is not met.** Twenty-six independent reviews of the signed-in app scored it between 6.0 and 6.9 out of 10, against roughly 7 to 7.5 for Procore and 8.5 to 9.3 for Stripe and Linear. The latest verdict was "not at Procore's level".

## Where the code is

- Repository: `Hoshmand-AI/planora` (the product is called RunF9).
- `main` is at the merge of pull request 143 and is deployed to production on Vercel.
- Work branch: `claude/dreamy-goldberg-scrv3y`. It is one commit ahead of `main`.

### The one unmerged commit (needs verification before it ships)

Commit `d5670fa` on the work branch, "One 8px corner for controls; Overview points to Today; Workspaces in construction terms". It applies three decisions the owner made on 2026-11-15:

1. **One radius.** Buttons, control groups, inputs and selects in the signed-in app use one 8px corner (`rounded-lg`). Status badges, avatars and the marketing site are unchanged. About 30 files.
2. **Overview stripped.** The in-progress and starting lists are replaced by two counts and a "See them on Today" link (`src/app/dashboard/project/page.tsx`).
3. **Organization wording.** "Workspaces (ethical walls)" became "Workspaces", "client matter" became "client, business unit or project", "Walled" became "Restricted to members" (`src/components/Workspaces.tsx`).

The owner also decided: **do not fold the compliance-style notices** (the "calculation, not conclusion" note on Delays, the controlled-information banner on Documents, the policy explanations on Organization security). Leave them visible.

**Verification status of that commit:** `npm run typecheck` and `npm test` (2,350 tests) pass. **Not yet run:** `npm run build`, `scripts/e2e-devices.mjs`, `scripts/a11y-check.mjs`, `scripts/e2e-smoke.mjs`, `scripts/e2e-beta.mjs`. Nobody has looked at screenshots of it.

### Next steps for that commit

1. Run the build and the end-to-end suites listed in `CLAUDE.md`.
2. Look at the app at desktop and phone widths. Things most likely to need a touch-up after the radius change:
   - the disabled-button rule in `src/app/globals.css` (selector `button:disabled[class*='rounded-lg'][class*='text-[1']`), which may now catch or miss some buttons;
   - the zoom control and the "Dates and float" toggle on the Schedule;
   - the three-dot menu button (`src/components/MoreMenu.tsx`);
   - any pill button the codemod missed: search for `rounded-full` on `<button>` and `<Link>` elements under `src/app/dashboard` and `src/components`.
3. Add one line to `UPDATES` in `src/lib/product-card.ts` (newest first, public-safe wording).
4. Open a pull request to `main`, wait for CI and the Vercel preview, then merge with a merge commit, as `CLAUDE.md` describes.

## What shipped in this stretch (pull requests 134 to 143, all merged)

- **Controls.** One button size, hover and disabled style; sub-tabs underlined like the main tabs; filters are chips with a check when on; 67 one-off button styles normalised to the shared set (`Button` and `buttonClass` in `src/components/ui.tsx`).
- **Today.** The attention list is a ruled table with the kind of item in its own column. Each row names the late activity or milestone and its date. Late work is "Act" only when it is critical or has used up its float, otherwise "Watch" (`src/lib/server/brief-service.ts`).
- **Liquidated damages.** No estimated amount when the contract clause names a different milestone from the one the forecast is measured against (`src/lib/analysis/project-watch.ts`, with tests).
- **Schedule.** Date, float and percent-done columns beside the chart, behind a "Dates and float" toggle remembered per browser. One line per activity on wide screens. Two custom Tailwind variants, `cols:` and `wide:`, are defined in `tailwind.config.js` for this.
- **Overview.** The analysis tools have their own tab (`#tools`); the header is one row shorter; duplicated facts removed; the variance tile is labelled "Variance vs baseline".
- **Documents.** Adding a document opens a dialog over the library.
- **Resources.** The chart states its unit; method notes are folded behind a "How this works" link (`Hint` in `src/components/ui.tsx`).
- **Quality.** Percentages say what they are a share of ("1 of 24 open activities").
- **Phone.** The project header replaces the logo bar; the tab strip has a scroll cue; Today leads with the answer; the current tab is scrolled into view on a direct load.
- **Wording.** The tab is "Ask"; the sidebar says "AI off · rules only" when no model is on.

### Two regressions found and fixed along the way (and the guards added)

- **Schedule data-date line drawn at the wrong date** after the name column was widened. The overlay's left offset must equal the sticky name column's width (`md:w-[260px]`, `wide:w-[360px]`, `cols:w-[628px]` in `src/app/dashboard/timeline/page.tsx`). `scripts/e2e-devices.mjs` now asserts the line sits under its label.
- **Current tab off-screen on a phone after a direct load.** `scripts/e2e-devices.mjs` now reloads Documents and asserts the current tab is visible.

## What the reviews still mark down

Ranked roughly by how often they appear:

1. **Control consistency.** Expected to improve with commit `d5670fa`; not yet re-scored.
2. **Explanatory prose under controls.** The owner chose to keep the compliance-style notices. Plain helper text elsewhere can still be shortened.
3. **Phone.** Header plus two tab rows take about 30% of the first screen; the Schedule has no chart on a phone.
4. **Half-empty screens.** Reports, Delays and Ask at desktop width.
5. **Schedule.** No dependency lines; the first milestone draws as a triangle where others are diamonds.
6. **Numerals.** Digits use a separate Inter face (`src/app/fonts/digits.ts`) and read as a different typeface from the DM Sans text. Changing this is a look change the owner has not decided on.
7. **Figures that are right but read as wrong** and need clearer labels:
   - Procurement's peak is above its limit yet shows zero over-allocated, because the peak has passed.
   - Quality counts three missed tasks (against the baseline) where Today counts two overdue (against today).
   - "81% complete" (by duration) beside "22 of 46 activities finished".
   - The critical path check passes with "Finish moves 600d when P1030 slips 600d".

## How the scoring was done, and its limits

- A screenshot script captured 13 desktop first screens, 6 full pages and 6 phone first screens of the sample project. It lives outside version control (`scripts/_x.mjs` was a scratch file); recreate it with Playwright if needed.
- A fresh sub-agent with no knowledge of the code read the screenshots beside reference images of Linear, Stripe and Procore and returned scores, eight ranked problems, contradictions and a verdict.
- **The instrument is noisy.** The same screens drew 6.0 and 6.5 in consecutive rounds, and reviews asked for opposite things on the Schedule (chart width, then date columns). Treat a single score as plus or minus half a point. The reference images were marketing pages with small product crops.

## What Firecrawl returned

Useful:

- **Procore support (Schedule tool):** list, calendar, Gantt and lookahead views; configurable columns; view toggles for critical path, percent complete and dependencies; filters; zoom.
- **Apple Human Interface Guidelines:** segmented controls for closely related views (about five segments at most on a phone); keep list rows short and prefer a table to prose.
- **Google Material 3:** filter chips take an 8px corner and a check when selected; app-bar headlines should not be truncated and may wrap to two lines; secondary tabs sit below primary tabs.
- **Linear docs (display options):** one control chooses which properties show on each row.
- **Notion (timeline):** the table beside the timeline shows and hides with one control.
- **Atlassian (empty states):** a heading, few words, one action, in a narrow centred column.
- **Brand tokens** for Procore, Autodesk, Apple, Google Workspace and Linear (fonts, colours, button radius).

Returned nothing usable: Procore's scheduling product page (404), Autodesk's schedule help page (not found), Jira's timeline page (404), Stripe's patterns and dashboard pages (index only), Shopify Polaris (redirected), Apple's layout page, Google Sheets' product page.

## Local setup that worked

- Next.js 16, TypeScript, Tailwind v3, Postgres 16 via raw `pg`, vitest, Playwright.
- Two production servers were run locally: port 3000 with `RUNF9_SIGNUP=open`, port 3001 in the default invite-only mode with `RUNF9_PLATFORM_ADMINS` set, as `.github/workflows/ci.yml` does.
- Before each end-to-end suite, clear the `rate_limits` table, or sign-ins get throttled.
- `scripts/e2e-cloud-storage.mjs` needs the S3 and Azure emulators and was only ever run in CI.
- Tests that assert display wording were updated when the wording changed; no test was skipped or disabled.

## Not part of this work, still with the owner

- The Procore sandbox support email (a Gmail draft exists, unsent).
- Microsoft Entra permissions (Mail.Read, offline_access).
- Setting invited firms to the Pro plan.
- A customer who can be named on the marketing site.
