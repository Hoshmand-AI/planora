# Claims register

Every public claim about Planora (website, sales decks, proposals) must be listed here with its evidence before it is published. The standard is the one the FTC applies to advertising: an objective claim needs "competent and reliable evidence" in hand *before* it is made. A claim that can't be shown here gets reworded or removed. Owner: founder. Review: before each release that changes the website, and quarterly.

**Status:** ✅ evidenced · 👤 needs the founder's confirmation or documents · 🗑 removed (and why)

## Landing page (`src/app/page.tsx`), 10/05/2026

| Claim | Status | Evidence / how to reproduce |
|---|---|---|
| "14 of 14 DCMA 14-Point checks, run automatically" | ✅ | `src/lib/analysis/dcma.ts` implements checks 1–14. `src/lib/analysis/dcma.test.ts` has a passing schedule for all 14 and a failing case for each. Checks without the needed data return "n/a", never "pass". Run `npx vitest run src/lib/analysis/dcma.test.ts` |
| "100,000 activities scheduled by our CPM engine in automated tests" | ✅ | `src/lib/planning/perf.test.ts`: synthetic networks of 10k, 50k and 100k activities (FS/SS/FF, lags, two calendars), on every CI run, with budgets of 2/8/15 s. The test prints the measured time. This is the CPM calculation only; file upload and parsing are not part of the figure |
| "0 days difference in dates and float after a P6 or MS Project round trip, in our test set" | ✅ | `src/lib/export/roundtrip.test.ts`: 5 schedules exported to XER and MSP XML, re-imported, re-scheduled from scratch; every activity's ES/EF/TF must match. Parity with P6/MSP calculating the same projects is **not** claimed (planned: `docs/governance/VALIDATION-PLAN.md`) |
| "$0 to start. No credit card" | ✅ | Free plan in `src/lib/server/entitlements.ts`; no billing integration exists |
| "Founded by a construction scheduling consultant with 13 years in the field and a degree in architecture" | 👤 | Founder to confirm the years (the founder has 22 years of total work experience, including teaching) and keep proof: CV, diploma, references. The title "architect" is **not** used because it is a licensed title in US states |
| Former line: "managed schedules at Meta, USPS, and Applied Digital" | 🗑 👤 | Removed until the founder confirms (a) the work, (b) that naming the client is allowed by the contract or NDA, and (c) wording that doesn't imply endorsement (FTC Endorsement Guides). Suggested once confirmed: "has scheduled projects for clients including …" with written permission on file |
| Former stat: "100K+ Activities Parsed" | 🗑 | Implied cumulative customer usage that didn't exist; replaced by the tested CPM figure above |
| Former stat and heading: "$200/hr Consultant Replaced", "The $200/hour problem", "Senior scheduler: $150–250/hour" | 🗑 | No source for the rate; "replaced" can't be shown and alienates consultants, the first target customers (`docs/strategy/MARKET-RESEARCH.md`) |
| Former line: "Single variance report: 2–3 days" | 🗑 | No source |
| Former line: "No mobile access to schedule data" | 🗑 | False: Primavera Cloud and P6 have web and mobile access |
| Former line: "20-year-old desktop software" | 🗑 | Disparaging and unprovable; P6 is actively developed |
| Former line: "the same analysis/deliverable a consultant produces" | 🗑 | Unprovable equivalence claim |
| Former: "AI identifies the critical path" | 🗑 | Wrong: the critical path comes from the CPM algorithm (`src/lib/planning/cpm.ts`), not AI. The page now says so |
| Former: "Upload XER, XML, or PDF. Every activity, relationship, and constraint extracted" | 🗑 | PDF import has no logic (`src/lib/parsers/pdf-parser.ts` returns no relationships and says so). Reworded per format |
| Former: "Most Popular" badge on Pro | 🗑 | No customer data to support it |
| Former: Free plan listed "API keys & signed webhooks" | 🗑 | Wrong: integrations are Pro and Enterprise only (`entitlements.ts`). Fixed |
| "Native P6 and MS Project files: import .xer and .xml with activities, logic, lags, constraints and calendars, and export the same formats" | ✅ | `src/lib/parsers/xer-parser.ts`, `xml-parser.ts`, `src/lib/export/xer.ts`, `msp-xml.ts`; tests in `xer-parser.test.ts`, `xml-parser.test.ts`, `formats.test.ts`, `export.test.ts`, `roundtrip.test.ts` |
| "Questions are ranked by how far each answer can move your finish date" | ✅ | `src/lib/planning/adaptive.ts` re-schedules under each plausible answer; `adaptive.test.ts` |
| "Each failing check lists the activities involved and a suggested fix" | ✅ | `DcmaCheck.offenders`; `src/lib/analysis/dcma-guidance.ts` |
| "Forward and backward CPM passes with calendars, holidays, lags and constraints. Total and free float" | ✅ | `src/lib/planning/cpm.ts`, `calendar.ts`; `cpm.test.ts`, `calendar.test.ts` |
| "Monte Carlo risk analysis (200 to 1,000 iterations of the full network) gives P50 and P80" | ✅ | `src/lib/planning/sra.ts` (iteration budget 200–1,000 by network size); `sra.test.ts` |
| "Recovery options are re-scheduled on the real network and priced from your labor cost" | ✅ | `src/lib/planning/recovery.ts`; `decisions.test.ts` |
| "A version-pinned cloud model (Anthropic Claude by default, OpenAI as an approved alternate) … calculated figures come from the engine, not the model. AI can be switched off" | ✅ | `DEFAULT_CLOUD_MODEL = 'claude-opus-5-5'` and `MODEL_REGISTRY` in `src/lib/llm/gateway.ts` / `src/lib/llm/provider.ts`; DCMA results injected as computed text in `src/lib/openai.ts`; org AI switch in `settings.ts` |
| "The CPM engine computes dates … This is arithmetic, not AI" | ✅ | `cpm.ts` is deterministic; no model call |
| "See the DCMA 14-Point results in seconds" | ✅ | Upload, parse and DCMA run in one request (`src/app/api/schedules/route.ts`); the e2e smoke test measures uploads in well under a second locally. Re-measure on production before quoting a number |
| Pricing: Free 3 uploaded schedules, Executive Summary, 10 AI requests/day, P6/MSP/CSV export; Pro all 4 reports, 1,000 AI/day, PDF and Excel export, integrations; Enterprise SSO | ✅ | `src/lib/server/entitlements.ts` (enforced server-side; e2e tests in `scripts/e2e-security.mjs`) |
| Pro "$49/month" | 👤 | A price is an offer, not a fact claim, but there is no checkout yet: upgrades go through sales@ (Organization page). Market research suggests $149/mo (`docs/strategy/MARKET-RESEARCH.md`); founder decides |
| Enterprise "On-premises / air-gapped deployment" | ✅ | `PLANORA_AIRGAPPED` mode in `src/lib/llm/provider.ts`, README "Air-gapped deployment" |
| Enterprise "Support by email from the founder" | ✅ | Replaces "Dedicated support", which implied a staffed team |

## Rules for new claims

1. Numbers must come from a test, the product's own limits, or a cited public source with a date.
2. Say what was measured ("in our test set", "CPM calculation only").
3. No customer counts, usage totals, savings or "hours saved" until there is customer data to show; when there is, keep the dataset and method here.
4. No client or employer names without written permission; no testimonials without consent and a record.
5. No comparisons that disparage competitors' products; compare features with dated, sourced facts only.
