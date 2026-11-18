# Handoff: where the work stands (11/18/2026)

Read this first, then `CLAUDE.md` (the shipping rules) and `README.md` (conventions).

## The request being worked on

The owner's twelve-item list for the public page and the product:

1. Headline "Construction schedules, calculated and explained" → "Construction schedules, analyzed and explained."
2. Remove "Construction Schedule Analysis - Private beta, by invitation".
3. Users can upload a PDF, Word, Excel or PowerPoint schedule and it is analyzed; the hero text says so.
4. Pricing: remove the membership plans; enterprise-style "Request a demo" instead.
5. Remove the hero's "Request access" button and "See the Daily Brief" link.
6. Every timeline uses three colours: blue completed, green remaining (forecast / not started), red critical (Primavera P6's convention).
7. Checks beyond DCMA: other industry methods (PSP, PMI-SP, USACE and so on), researched.
8. Sample report: remove "See plans and request access" and "RunF9 writes this for your own schedule in seconds."
9. The morning brief gets the showcase format: tabs, RunF9 logo, a higher-end header.
10. Remove "And 3 more to watch in the product."
11. Say the product reads meeting transcripts, drawings and daily notes; Procore and Kahua "coming soon".
12. A project can store one schedule as the baseline (all uploads compared against it) and one more (for example last month) to compare the current schedule with.

## Status

### Live in production (PR 176, merged as `ada2405`, schema 29)

Items 1, 2, 3, 4, 5, 8, 10, 11 and 12 are live, plus the parts of 6, 7 and 9 listed below. See https://github.com/Hoshmand-AI/planora/pull/176 for the full table.

- **3:** Word (.docx) and PowerPoint (.pptx) import is new (`src/lib/parsers/office-parser.ts`); PDF, Excel and CSV already worked. Old `.doc`/`.ppt` are refused with a message.
- **6:** `bar` colour tokens in `tailwind.config.js` (done `#2B63C1`, todo `#12A37F`, critical `#C81E1E`), applied to the Gantt chart, plan builder, Overview ribbon, Excel export and the public page.
- **7 (first part):** the landing tile reads "DCMA + GAO" and names AACE 52R-06 and EIA-748 with a no-affiliation note. DCMA runs on every upload; GAO runs in the Standards view.
- **9 (first part):** the public showcase only.
- **11:** Procore and Kahua are shown as "Coming soon … Not available yet" (no connector code exists).
- **12:** "Kept for this project" under Analysis tools. Migration 29 adds `project_schedule_roles`; the API is `GET/PUT /api/schedules/{id}/roles`. The baseline applies to uploads dated on or after it, unless an upload has its own chosen baseline. The stored comparison schedule is the default for "what changed" only for uploads that come after it.

### Pushed to `claude/eloquent-tesla-6gzy4k`, NOT merged, NO pull request yet

Head `970ca06`, three changes on top of `main`:

1. **`df26cca` License wording inside the app, and the F9 picture's blue (item 6).**
   - Members no longer see "Plan: Free", "Enterprise plan" or "Upgrade" text. The Organization tab is now "License and data", and its section is "Your license". The 402 message now says "isn't included in your organization's license. To add it, contact support@hoshmand.ai."
   - The limits themselves (`src/lib/server/entitlements.ts`) are unchanged; new organizations still start on `free` unless `RUNF9_DEFAULT_PLAN` is set.
   - On the landing page's hero chart the blue part of each bar is now the share of that work area's activities that are finished, labelled "completed".
2. **`3c37982` Two new standards rule packs (item 7).**
   - `USACE_UFGS`: 10 rules drawn from UFGS 01 32 01.00 10 (Aug 2026), paragraphs 3.3.2, 3.3.8, 3.3.8.2, 3.3.11, 3.3.13, 3.3.16 and 3.5.4.3. It adds a new rule kind, `guide_specification`.
   - `PMI_SCHEDULING`: 9 rules drawn from the PMI Practice Standard for Scheduling, 2nd edition, section 3.4.
   - Both are run on their own from the Standards panel; the RunF9 Composite is unchanged (still GAO + DCMA, same version hash, pinned by a test).
   - Files are in `src/lib/standards/` (`usace.ts`, `pmi.ts`, `shared.ts`, tests).
   - PSP and PMI-SP certify people, not schedules, so they are deliberately not frameworks.
3. **`1c995c8` The real Daily Brief in the showcase format (item 9).**
   - `src/components/ProjectBrief.tsx`: a navy header with the logo, then four figures (forecast finish, required finish, % complete, alerts to act on), then tabs: Project manager, Field, Client, Email and meetings, What-ifs.
   - The email (`src/lib/server/brief-digest.ts`, `email-template.ts`) gets the same header and figures and headed sections.
   - New helper `src/lib/analysis/brief-figures.ts`.

Checked on this head: `npx tsc --noEmit` is clean, and `npx vitest run` passes (2,523 tests, 19 skipped).
**Not yet run on it:** `npm run build`, the e2e scripts, and the accessibility and device checks. The new brief layout has not been viewed in a browser or a mail client.

## Next steps, in order

1. **Product card:** add `UPDATES` lines to `src/lib/product-card.ts` (newest first, public-safe) for the USACE/PMI checks and the new brief layout. Then add rows to `docs/marketing/CLAIMS-REGISTER.md` if the landing page starts naming USACE or PMI.
2. **Landing tile (optional):** say the Standards view can also run "checks drawn from USACE UFGS 01 32 01.00 10 and the PMI Practice Standard for Scheduling".
   - Wording must be "drawn from", never "compliant with" or "certified".
   - Keep the no-affiliation note.
   - The tile is in `src/components/Landing.tsx` around the `DCMA + GAO` figure.
3. **Run the checks locally against a server with Postgres** (see "Running it locally"): `npm run build`, then `scripts/e2e-smoke.mjs`, `e2e-devices.mjs`, `a11y-check.mjs`, `e2e-rag.mjs`, `e2e-security.mjs` and `e2e-baseline.mjs`. Several of them assert on the brief page and the Organization page.
4. **Retake the landing pictures** if the Overview or brief screens they show changed (`public/landing/*.webp`).
5. **Review, then ship:**
   - Run a review of `git diff origin/main...HEAD`. The brief tabs' accessibility, the email in Gmail and Outlook, and USACE rule correctness deserve the most attention.
   - Open a PR to `main`, wait for CI and the Vercel preview on its latest commit, read the review comments, then merge with a merge commit.
   - Confirm https://runf9.ai/api/health shows the new release and `schema.current: true`, and that there are no runtime errors.
   - Then reset the branch: `git fetch -q origin main && git checkout -q -B claude/eloquent-tesla-6gzy4k origin/main && git push -u origin claude/eloquent-tesla-6gzy4k`.

## Points the owner should decide

1. **Plans vs. "everything included":** the public page says pricing is per organization. Should new organizations get everything (set `RUNF9_DEFAULT_PLAN=enterprise` and move existing organizations up with `scripts/set-plan.mjs`), or keep the limits and just call them a license (the current state)?
2. **Brief email to clients:** the client version shows the "Alerts to act on today" count, but not the alerts themselves. Remove the count for clients? (`briefEmailHtml` / `briefEmailText` in `src/lib/server/brief-digest.ts`.)
3. **Project manager email content:** it now also carries "Email and meetings" (up to 5 quoted signals) and "What-ifs" (up to 5), so it matches the tabs. Keep it?
4. **Rules still not built:**
   - USACE paragraphs not built: 3.3.10 calendars, 3.3.7 activity codes and SDEF export, 3.3.5 mandatory activities, 3.2.1 cost loading, and 3.3.17 / 3.3.12 retained logic and how actuals were entered. The uploaded data does not carry what these rules need.
   - Other methods not built: NDIA PASEG, NAVFAC UFGS 01 32 17.00 20, NASA and DOE guides. Their sources were not verified, because the research hosts were blocked.
5. **Earlier open items:**
   - The aerial picture source for the site map (USGS vs Esri). A 30-day sub-processor notice is needed for USGS; `RUNF9_SITE_IMAGERY=off` holds it.
   - Drawings as PDF.
   - A Next.js upgrade for the reported vulnerability.
   - The numbers typeface (ask the owner first).
   - The definition of the "required date" milestone.

## Known limits in what shipped

- **USACE-01 (20-work-day durations):** it recognises procurement activities by their name or WBS, because uploads carry no activity codes. The finding says so.
- **USACE-04 (prohibited constraints):** it cannot see zero-float constraints in uploaded files, because the importer drops constraint types outside the eight known ones.
- **PMI numeric limits:** they reuse the organization's GAO screening settings (`openEndsMaxPct`, `lagsMaxPct`, `highFloatDays`); PMI publishes no thresholds.
- **Threshold conflicts:** they are listed only inside the Composite run.
- **Word tables:** nested tables, merged cells, semicolons in cells and very large decks are handled, with tests in `office-parser.test.ts`.

## Rules that must hold (from CLAUDE.md and the owner)

- **Branch:** work on `claude/eloquent-tesla-6gzy4k` only, then PR to `main`. Never merge a red PR, and never skip or disable a test to get green. Never push an empty commit or close and reopen a PR to kick CI.
- **Migrations:** additive, numbered migrations only, in `src/lib/migrations.ts`. 29 is the latest shipped; the next is 30. Never edit a shipped one.
- **API and audit:** every API handler uses `api({ permission })`, `publicApi()` or `scimApi()`; `audit()` records material actions; never log secrets or prompt content.
- **Data:** all firm data is scoped by `org_id`; raw SQL via `pg`.
- **Styling:**
  - Tailwind v3; colours only from `tailwind.config.js` (a palette test enforces it); WCAG AA contrast with the `warm-*` tokens.
  - Type scale tokens only: `text-heading/subhead/body/caption` in the app, `h1/h2/h3/lead/copy/small/fine` on public pages.
  - Buttons, inputs and chips are `rounded-lg`.
  - Dates MM/DD/YYYY through `src/lib/format.ts`.
- **Public claims:**
  - Every public claim goes in `docs/marketing/CLAIMS-REGISTER.md`.
  - Customer-visible changes get a line in `UPDATES` in `src/lib/product-card.ts`.
  - Use "drawn from" wording for DCMA, GAO, USACE, PMI, AACE and EIA-748, with a no-affiliation note.
- **Secrets and personal data:** never decrypt Vercel env values unless explicitly asked; secrets go into Vercel, never into chat. Never send the owner's email address to an outside service.
- **Owner preferences:** keep compliance notices visible, and ask before changing the numbers typeface.

## Running it locally

```bash
service postgresql start
# a database per run, owned by role runf9 (password runf9)
su postgres -c "psql -qc 'CREATE DATABASE runf9dev OWNER runf9'"
npm run build   # ends with a "known security vulnerability, upgrade Next.js" notice after building; the output is usable
DATABASE_URL=postgres://runf9:runf9@localhost:5432/runf9dev JWT_SECRET=local-only RUNF9_AI_MODE=offline \
RUNF9_DEFAULT_PLAN=pro RUNF9_SIGNUP=open RUNF9_ALLOW_INSECURE_WEBHOOKS=1 RUNF9_ALLOW_INSECURE_OIDC=1 \
RUNF9_EMAIL_OUTBOX=/tmp/outbox CRON_SECRET=ci-only-cron-secret RUNF9_BRIEF_HOUR_UTC=0 PORT=3000 npm start &
# the e2e scripts need DATABASE_URL, RUNF9_EMAIL_OUTBOX, CRON_SECRET, RUNF9_BRIEF_HOUR_UTC=0 and BASE_URL=http://localhost:3000
node scripts/e2e-smoke.mjs
```

- **Rate limits:** repeated runs hit the sign-up limit. Clear it with `su postgres -c "psql -qd runf9dev -c 'DELETE FROM rate_limits'"`.
- **Playwright:** scripts need `executablePath: '/opt/pw-browsers/chromium'` in cloud containers.
- **Full CI setup:** see `.github/workflows/ci.yml` for the environment of every e2e step, including the S3/Azure emulators and the second invite-only server for `e2e-beta.mjs`.
- **Production:** Vercel project `prj_3TR4nyUHGRhHViBPhSEaOPIqIGDS`, team `team_f6LD6MB7CjVms0dNIr8Er0SD`. To roll back: Vercel → Deployments → Instant Rollback.
