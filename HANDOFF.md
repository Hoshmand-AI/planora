# RunF9 handoff (2026-11-15)

Paste this into the new chat. It says where things stand, what was done, and what to do next.

## What this is

- Product: **RunF9**, a construction scheduling web app.
- Repository: `Hoshmand-AI/planora` on GitHub. Next.js, TypeScript, Tailwind, Postgres. Deployed on Vercel.
- Read `CLAUDE.md` in the repo first. It has the rules for shipping, testing and security.

## The goal

> Scrape Procore, Autodesk, Apple, Google and other top websites with Firecrawl, and make my website's user interface and user experience one of the top ones.

**The goal is not met yet.** Independent reviews of the signed-in app score it 6.0 to 6.9 out of 10. Procore scores about 7 to 7.5. Stripe and Linear score about 9.

## Where the code stands

- `main` is live in production. It includes everything up to pull request 143.
- Branch `claude/dreamy-goldberg-scrv3y` has **one more commit that is not merged and not fully tested**. It applies three decisions I made on 2026-11-15:
  1. All buttons, inputs, chips and selects in the app use one 8px corner.
  2. The Overview page no longer repeats the Today page. It shows two counts and a link to Today.
  3. The Organization page uses construction wording ("Workspaces", "Restricted to members") instead of law-firm wording.
- I also decided: **keep the compliance notices visible** (the note on Delays, the controlled-information banner on Documents, the security explanations on Organization). Do not hide them.

## What to do first

1. Open the repo on branch `claude/dreamy-goldberg-scrv3y`.
2. Run the checks listed in `CLAUDE.md`. Typecheck and unit tests already pass. The build and the end-to-end suites have **not** been run on the last commit.
3. Look at the app on desktop and phone. Fix anything the corner-radius change broke (disabled buttons, the Schedule zoom control, the three-dot menu, any button still fully rounded).
4. Open a pull request to `main`. Merge it when CI and the Vercel preview are green.

## What was done (pull requests 134 to 143, all live)

- One consistent style for buttons, tabs and filter chips.
- **Today:** the attention list is a clear table. It names the late activity and its date, and ranks items as "Act" or "Watch".
- **Damages:** no dollar estimate when the contract clause names a different milestone.
- **Schedule:** date, float and percent-done columns beside the chart, with a toggle to hide them.
- **Overview:** analysis tools moved to their own tab; shorter header; repeated facts removed.
- **Documents:** adding a document opens in a dialog.
- **Phone:** shorter header, a scroll cue on the tabs, and the current tab is always visible.
- Two bugs I caused were fixed, and tests were added to catch them: the data-date line on the Schedule, and the current tab hidden on a phone.

## What still needs work

1. Re-score the app after the corner-radius change (it has not been reviewed yet).
2. Phone: the header and two tab rows still take about 30% of the first screen. The Schedule has no chart on a phone.
3. Reports, Delays and Ask are half empty on desktop.
4. Schedule: no dependency lines between bars.
5. Numbers use a different typeface from the text. Changing it is a look change; ask me first.
6. Some correct figures look wrong and need clearer labels (Procurement over-allocation, "missed tasks" versus "overdue", "81% complete").

## Things to know

- The review scores are noisy. The same screens got 6.0 and 6.5 in back-to-back reviews. Do not chase a single score.
- Never skip or disable a test to get CI green.
- A longer version of these notes is in `docs/HANDOFF-ui-ux.md`.

## Still waiting on me (not code)

- Send the Procore sandbox support email (a Gmail draft exists).
- Microsoft Entra permissions (Mail.Read, offline_access).
- Set invited firms to the Pro plan.
- A customer who can be named on the marketing site.
