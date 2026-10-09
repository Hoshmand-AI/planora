# Planora — QA/QC and Audit Handoff

| | |
|---|---|
| **Product** | Planora — AI construction scheduling (build, analyze, monitor) |
| **Owner** | Hoshmand AI |
| **Repository** | `Hoshmand-AI/planora` (branch `main`) |
| **Release under review** | Merge commit `d75f048` (PR #3), deployed to Vercel production 09/30/2026 |
| **Hosting** | Vercel (app), Neon Postgres (database) |
| **Document date** | 10/03/2026 |

> **Update 10/04/2026:** the independent audit's findings have been remediated on top of this release. Read [governance/AUDIT-REMEDIATION.md](governance/AUDIT-REMEDIATION.md) for the item-by-item response, [security/SECURITY-OVERVIEW.md](security/SECURITY-OVERVIEW.md) for the controls now in place, and section 7 below for the current status of the original open risks. New automated suites are `scripts/e2e-security.mjs` (100+ checks), `scripts/a11y-check.mjs` (WCAG 2.2 AA) and `scripts/restore-drill.mjs`.

---

## 1. Purpose and scope

This document hands Planora over for independent **QA/QC testing** and **audit review**. It covers:

- what the product does and where each function lives in the code
- how to set up a test environment and run the automated checks
- a manual test script with expected results for each feature
- data, security and AI controls an auditor should verify
- how changes are made and released (change control)
- known limitations and open risks
- a sign-off sheet

**Out of scope:** the accuracy of third-party reference data (permit review times, equipment lead times). Planora presents these as planning ranges that must be checked with the Authority Having Jurisdiction (AHJ) and suppliers before a schedule is baselined.

---

## 2. Product overview

Planora works in three stages:

1. **Build.** It interviews the scheduler (drawings, permits, long-lead equipment, site, calendar, security, milestone targets). It then generates a CPM schedule that explains every duration and link.
2. **Analyze.** It imports existing schedules (P6 XER, MS Project XML, Excel/CSV, PDF) and runs DCMA 14-point checks, a critical-path review and input-data checks.
3. **Monitor.** Publishing a plan creates a baseline used by the dashboards, timeline, Ask AI and reports.

The scheduling core is deterministic TypeScript: CPM, DCMA, the generator, recovery modeling and exports. **It runs with no AI model at all.** A model (cloud, on-prem or none) only adds follow-up questions and narrative answers.

### Function map

| Function | Code location |
|---|---|
| Interview / question bank, date sequence checks | `src/lib/planning/elicitation.ts` |
| Schedule generator | `src/lib/planning/generator.ts` |
| CPM engine (multi-calendar, FS/SS/FF/SF, lags, constraints, negative float) | `src/lib/planning/cpm.ts`, `calendar.ts` |
| Human overrides (reason required) | `src/lib/planning/overrides.ts` |
| Evaluation (DCMA score, P50/P80, benchmark, coverage, backtest, date checks) | `src/lib/planning/evaluation.ts` |
| Recovery options when the finish is past the required date | `src/lib/planning/recovery.ts` |
| DCMA 14-point checks and fix guidance | `src/lib/analysis/dcma.ts`, `dcma-guidance.ts` |
| Input-data self-checks | `src/lib/analysis/input-checks.ts` |
| "About this project" brief | `src/lib/analysis/brief.ts` |
| Completion of imported files that lack float/dates | `src/lib/planning/complete-schedule.ts` |
| File parsers | `src/lib/parsers/*` |
| Activity / calendar normalization | `src/lib/semantic/taxonomy.ts` |
| Exports (P6 XER, MS Project XML, CSV, PDF, Excel ×2, Basis of Schedule) | `src/lib/export/*` |
| AI provider and air-gap guard | `src/lib/llm/provider.ts` |
| Database schema and tenancy | `src/lib/db.ts` |
| Authentication | `src/lib/auth.ts`, `src/app/api/auth/route.ts` |

### API endpoints

All endpoints below require an authenticated session except `POST /api/auth` (login/register).

| Endpoint | Purpose |
|---|---|
| `POST/GET /api/auth` | Login, register, current user |
| `GET /api/system` | AI mode and air-gap status |
| `GET/POST /api/plans` | List / create plans |
| `GET/PATCH /api/plans/[id]` | Plan view; save answers and notes |
| `POST /api/plans/[id]/generate` | Generate the schedule |
| `POST /api/plans/[id]/edit` | Human override (reason required) |
| `POST /api/plans/[id]/recover` | Apply a recovery option |
| `POST /api/plans/[id]/decide` | Record a DCMA decision (fix / accept with justification) |
| `POST /api/plans/[id]/review` | Record expert review |
| `POST /api/plans/[id]/publish` | Publish as a baseline schedule |
| `GET /api/plans/[id]/export` | Download exports |
| `POST /api/plans/[id]/suggest` | AI follow-up questions |
| `GET/POST /api/schedules` | List / upload schedules |
| `GET/POST /api/schedules/[id]/quality` | DCMA results, data questions, decisions |
| `GET/POST /api/history` | Firm history and tagging |
| `POST /api/ask`, `POST /api/reports` | Ask AI, narrative reports |
| `GET /api/portfolio` | Portfolio: every plan and uploaded schedule with alerts |
| `GET/POST /api/org/integrations` | API keys and webhooks (admins) |
| `GET /api/auth/verify` | Email confirmation link (public) |

Selected read endpoints (and answering/generating, for scheduler keys) also accept an organization API key. See [docs/API.md](API.md).

---

## 3. Test environment setup

**Requirements:** Node.js 22, Postgres 14+ (the schema is created automatically on first request).

```bash
npm ci
cp .env.example .env.local      # set DATABASE_URL and JWT_SECRET
npm run build
npm start                       # http://localhost:3000
```

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `JWT_SECRET` | Yes | Auth refuses to start without it in production |
| `PLANORA_AI_MODE` | No | `cloud`, `local` or `offline`. Default: cloud if `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is set, else offline |
| `PLANORA_AI_PROVIDER` | No | `anthropic` or `openai`. Default: `anthropic` when `ANTHROPIC_API_KEY` is set, else `openai` when `OPENAI_API_KEY` is set |
| `ANTHROPIC_API_KEY` | No | Cloud mode, Anthropic provider (default cloud provider) |
| `PLANORA_AI_FALLBACK` | No | `off` disables Anthropic's server-side refusal fallback (on by default) |
| `OPENAI_API_KEY` | No | Cloud mode, OpenAI provider (approved alternate) |
| `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` | No | On-prem model (OpenAI-compatible API) |
| `PLANORA_AIRGAPPED` | No | `true` refuses cloud AI and any non-private model host |
| `PLANORA_ALLOWED_HOSTS` | No | Extra model hosts allowed in air-gapped mode |

> Recommended: test once with `PLANORA_AI_MODE=offline`, which exercises every deterministic function, and once with a model configured.

---

## 4. Automated checks

| Check | Command | Result at release `d75f048` |
|---|---|---|
| Type check (TypeScript strict) | `npm run typecheck` | Pass, 0 errors |
| Unit tests | `npm test` | **331 / 331 pass** at `d75f048`; see the remediation PR for the current count |
| Production build | `npm run build` | Pass |
| End-to-end smoke test | `BASE_URL=http://localhost:3000 node scripts/e2e-smoke.mjs` | **70 / 70 pass** (offline mode) |
| CI (GitHub Actions `check` job) | Runs automatically on every PR and push to `main` | Green |

Unit test files: `planning/{cpm,calendar,pipeline,decisions}`, `analysis/{dcma,input-checks}`, `parsers/{xer,xml,excel}`, `export/{export,formats}`, `knowledge/{regions,long-lead,templates}`, `semantic/taxonomy`, `llm/provider`.

**QA action:** re-run all four commands on a clean checkout of the release commit and attach the output to the sign-off.

---

## 5. Manual test script

Record the result for each case: Pass, Fail or Blocked, plus notes and screenshots.

### 5.1 Account and access

| ID | Steps | Expected result |
|---|---|---|
| ACC-01 | Register a new account | Account and a new organization are created; the user lands on the dashboard |
| ACC-02 | Log in with the wrong password | Login is rejected with an error; no session cookie is set |
| ACC-03 | Open `/dashboard` while logged out | Redirected to login; API calls return 401 |
| ACC-04 | Create a plan in Org A. As an Org B user, request `/api/plans/<A's id>` | Not found / unauthorized. No Org A data is returned |
| ACC-05 | Upload a schedule in Org A. Check Org B's Firm data and Quality pages | Org A's schedule never appears |

### 5.2 Interview (Build)

| ID | Steps | Expected result |
|---|---|---|
| INT-01 | Start a plan; answer project type and location | Questions are ordered by schedule impact; permits and regulations match the state and facility type |
| INT-02 | Choose "Other…" on a choice question and type a custom answer | Answer is saved and shown as custom; it becomes an assumption in the Basis of Schedule |
| INT-03 | Pick an answer **and** type a note in "Anything to add?" (e.g. "Issued, but only for foundations") | Note is saved with the answer. The related permit/procurement activities are marked low confidence. The note appears under "Qualified answers" in the narrative export |
| INT-04 | Answer "Don't know" and "Can't share" on two questions | Each becomes an explicit assumption with contingency. A withheld answer is never included in any AI request (see SEC-05) |
| INT-05 | Type a location that is not in the state list (e.g. another country) | Accepted as typed text |
| INT-06 | Enter milestone targets out of order (dry-in before structure complete) | An alert appears right away naming both milestones and their dates |
| INT-07 | Enter an equipment delivery date after the milestone it gates, or after the required finish | An alert appears right away |
| INT-08 | Enter a permit expected date before the Notice to Proceed | Warning shown |
| INT-09 | Generate with only a few questions answered | Schedule generates. Remaining questions stay answerable, and the unanswered ones are listed as "Not answered yet" assumptions |

### 5.3 Schedule generation and CPM

| ID | Steps | Expected result |
|---|---|---|
| SCH-01 | Generate a schedule | Every activity shows duration, dates, total float, confidence and a "why" explanation with its source |
| SCH-02 | Set the start date on a weekend | NTP moves to the next working day and a note explains the move |
| SCH-03 | Check field activities | No field segment is longer than 44 working days; no negative lags (leads) |
| SCH-04 | Hand-check one path: start + durations + lags across calendars | Matches the dates and float Planora shows |
| SCH-05 | Enter milestone targets the logic can't meet | The milestone is held as finish-no-later-than and shows negative float. "Your dates vs. what the logic can achieve" names the days late and the driving activities |
| SCH-06 | All dates on screen and in exports | Shown as MM/DD/YYYY |

### 5.4 Overrides and audit trail

| ID | Steps | Expected result |
|---|---|---|
| OVR-01 | Change an activity duration without a reason | Rejected; a reason is required |
| OVR-02 | Change a duration with a reason | Saved. The impact on the finish date and critical path is shown. An entry is added to the Audit trail tab |
| OVR-03 | Regenerate the schedule after an override | The override survives regeneration |
| OVR-04 | Add a user-defined activity | Added, linked into the logic, and audited |
| OVR-05 | Export the Basis of Schedule narrative | Overrides, reasons, qualified answers and DCMA decisions are all listed |

### 5.5 Required finish and recovery

| ID | Steps | Expected result |
|---|---|---|
| REC-01 | Set a required finish earlier than the calculated finish | The header shows "Required finish N days late". A recovery panel explains the gap in calendar and work days, the negative float and the top drivers |
| REC-02 | Review the options (6-day week, early packages, expedite, add crews, answer questions, move date) | Each shows its new finish, days saved, whether it meets the date, and its trade-off. A combined result is shown |
| REC-03 | Apply one option | The schedule recalculates, the finish matches the modeled date, and an audit entry is written |
| REC-04 | Answer the Cost basis questions (field labor per day, cost of each late day) | Each option shows its resources, an added-cost range and the delay cost avoided; without the answers it says "not priced" |
| REC-05 | Build → "Open a sample project" (new organization) | A fully answered sample opens with a schedule, a missed required date and priced recovery options |

### 5.5a Portfolio, integrations and email

| ID | Steps | Expected result |
|---|---|---|
| POR-01 | Overview → "All projects and alerts (portfolio)" | Every plan and uploaded schedule, most urgent first, with status and alerts (late, milestone late, date conflict, review, stale data date) |
| INT-01 | Organization → Integrations → create a read-only API key; call `GET /api/portfolio` with it | Works; the key is shown once; calling `/api/org` with it returns 403; after revoking it returns 401 |
| INT-02 | Add a webhook to an HTTPS endpoint (e.g. a request-bin), "Send test", then create a plan | Signed deliveries arrive; `http://` and private addresses are refused |
| EML-01 | With an email provider configured, sign up a new organization | A confirmation email arrives; inviting people is blocked until the link is clicked; the link works once |
| QRL-01 | Organization → Policies → raise "High duration above" to 60 | Quality results state "remaining > 60d" and re-judge check 8 |
| ADP-01 | New plan → Interview | Facility type, location, scope, size and start come first; permit and long-lead questions are held under "Waiting on an earlier answer" until type and location are known |
| ADP-02 | Answer the foundations | Each next question shows how far it can move the finish ("up to N days"); questions that can't move it sit under "Optional details" |
| ADP-03 | Data center in VA, 60% drawings | Parallel long-lead items appear as one checklist ("together they move the finish up to N days") instead of many questions |
| ADP-04 | Open the sample project | Header says "Enough to build"; nothing left that moves the finish |

### 5.6 Quality (DCMA 14-point) and evaluation

| ID | Steps | Expected result |
|---|---|---|
| DCMA-01 | Open Evaluation on a generated plan | The DCMA 14-point table, quality grade, P50/P80, coverage and benchmark are shown |
| DCMA-02 | For a failing check, open its guidance card | Shows what it means, why it matters, steps to fix, and the flagged activities. "Show the activities" filters the schedule to them |
| DCMA-03 | Accept a failing check with a justification under 10 characters | Rejected |
| DCMA-04 | Accept with a proper justification, then Undo | Decision is recorded with user and time, appears in the narrative export, and can be reversed |
| DCMA-05 | Hand-verify 3 checks (e.g. #1 Logic, #6 High float, #7 Negative float) on a small schedule | Counts and percentages match a manual calculation against the DCMA thresholds |
| UI-01 | Scroll the plan, Overview and Quality pages | The summary header stays pinned under the navigation bar |

### 5.7 Import (Analyze)

| ID | Steps | Expected result |
|---|---|---|
| IMP-01 | Upload a P6 XER file | Activities, relationships, calendars, constraints and WBS are imported; calendars show "as labeled vs. as understood" |
| IMP-02 | Upload MS Project XML, Excel/CSV with messy headers, and a PDF | Each imports; activity names are mapped to standard categories |
| IMP-03 | Upload a file larger than 25 MB | Rejected with a clear message (HTTP 413) |
| IMP-04 | Upload a file with logic but no float or dates | Planora calculates CPM before analysis, and a warning says so |
| IMP-05 | Upload a file with no relationships | Activities are **not** all marked critical; a warning explains why |
| IMP-06 | Open Overview for the uploaded schedule | "About this project" summary shows type, location, size, dates, scope by phase and next milestones |
| IMP-07 | Upload a file with weekend work on a 5-day calendar, or out-of-sequence progress | Planora asks about each issue; answers are recorded |

### 5.8 Exports

| ID | Steps | Expected result |
|---|---|---|
| EXP-01 | Export P6 XER and import it into Primavera P6 | Imports without errors; activity count, logic, calendars and dates match Planora |
| EXP-02 | Export MS Project XML and open it in MS Project | Opens; tasks, links and dates match |
| EXP-03 | Export the PDF | Readable, MM/DD/YYYY dates, matches the on-screen schedule |
| EXP-04 | Export both Excel files (P6-style layout and import workbook) | The layout file shows WBS, indentation and colors; the import workbook re-imports into P6/MSP |
| EXP-05 | Export CSV and the Basis of Schedule narrative | Complete and consistent with the schedule |

### 5.9 AI and air-gap

| ID | Steps | Expected result |
|---|---|---|
| AI-01 | Run with `PLANORA_AI_MODE=offline` | Every function except AI follow-up questions and narrative Q&A works. The UI shows "AI offline — rules only" |
| AI-02 | Set `PLANORA_AIRGAPPED=true` with a public model host (e.g. api.anthropic.com or api.openai.com) | The model host is refused; no outbound call is made |
| AI-03 | Air-gapped with a private host (e.g. `*.internal`, 10.x.x.x) | Allowed |
| AI-04 | Ask AI a status question on an uploaded schedule | The answer starts with "About this project", uses MM/DD/YYYY, and does not call activities critical when the file has no logic |

---

## 6. Controls for audit

### 6.1 Data segregation (multi-tenancy)
- Every firm is an `organization`. All firm data tables (`schedules`, `activities`, `relationships`, `plans`, `chat_messages`, `data_question_responses`) carry `org_id`, and every query filters by it (`src/lib/db.ts`).
- Firm history and backtests only read the firm's own schedules. Generated plans are never added to firm history (covered by the e2e test).
- **Auditor check:** review `src/lib/db.ts` for any query without an `org_id` filter, and run ACC-04 / ACC-05.

### 6.2 Authentication and sessions
- Passwords are hashed with bcrypt (cost factor 12).
- Sessions use a JWT signed with `JWT_SECRET`, valid for 7 days, stored in an `httpOnly`, `SameSite=Lax` cookie that is `Secure` in production.
- Every API route checks the session before doing any work.

### 6.3 AI data handling
- Answers marked "Can't share" are never sent to a model; the model only sees a count of withheld items.
- Air-gapped mode refuses cloud AI and any non-private model host (`src/lib/llm/provider.ts`, covered by `llm/provider.test.ts`).
- AI output is validated (JSON schema, length, de-duplication) before use. AI never sets durations or logic on its own; those come from the deterministic generator and human overrides.

### 6.4 Traceability and audit trail
- Every activity and relationship records **why it exists and its source**: catalog, template, firm history, user answer or override.
- Overrides require a reason. Each one records the user, the time, and its impact on the finish date and critical path.
- Recovery actions, DCMA decisions (with justification) and expert reviews are recorded.
- The Basis of Schedule narrative export collects the assumptions, qualified answers, overrides and decisions for submission.

### 6.5 Change control (how code reaches production)
1. Changes are developed on a branch and submitted as a pull request to `main`.
2. CI must pass on the PR's latest commit (type check, 331 unit tests, build), along with the Vercel preview deployment.
3. **The owner has authorized the AI coding assistant (Claude) to merge its own PRs** once CI and the preview are green and there are no conflicts or open review comments (see `CLAUDE.md`). Vercel then deploys `main` to production.
4. Rollback: Vercel → Deployments → Instant Rollback.

> **Audit note:** step 3 means there is currently **no mandatory human code review** before production. Auditors should decide whether this is acceptable for the intended use. If not, add a GitHub branch protection rule that requires an approving review.

---

## 7. Known limitations and open risks (status after remediation)

| # | Item (as of 10/03/2026) | Status 10/04/2026 |
|---|---|---|
| 1 | No mandatory human review before merge | Required CI gates (unit, e2e, security, accessibility, SAST, CodeQL). CODEOWNERS marks the security-sensitive paths. **Owner action:** turn on code-owner review in branch protection (docs/operations/CHANGE-MANAGEMENT.md) |
| 2 | No login rate limiting or lockout | **Fixed:** IP and email limits, 15-minute lockout after 8 failures, generic errors |
| 3 | 6-character minimum password | **Fixed:** 12+ characters, common and personal passwords blocked; TOTP two-step verification and OIDC SSO added |
| 4 | 7-day sessions that couldn't be revoked | **Fixed:** server-side sessions; 12 h idle (adjustable); sign out everywhere; revoked on password change or removal |
| 5 | Audit trail capped at 500 entries per plan | **Fixed:** append-only, hash-chained `audit_events` enforced by database triggers; complete record; verification and CSV export |
| 6 | No role-based permissions | **Fixed:** owner, admin, scheduler, reviewer and viewer roles, enforced on every route |
| 7 | Reference ranges | Unchanged by design (shown as ranges; verify with the AHJ and suppliers). Now also drive the Monte Carlo ranges |
| 8 | `pg` SSL-mode warning | **Fixed:** verified TLS, and `sslmode` is stripped from the URL |
| 9 | Recovery options are what-if models | Still what-if models; the Monte Carlo analysis gives the probability of meeting the date, and (round 2) each option shows resources, an added-cost range and the delay cost avoided |
| 10 | DCMA checks 10–14 need extra data | Unchanged (N/A when the data is absent) |

## 8. Deliverables requested from QA/QC and audit

- [ ] Automated check output (section 4) on the release commit
- [ ] Completed manual test script (section 5) with Pass/Fail and evidence
- [ ] Defect list with severity, steps to reproduce and expected vs. actual results
- [ ] Hand-calculation evidence for CPM (SCH-04) and DCMA (DCMA-05)
- [ ] P6 and MS Project round-trip evidence (EXP-01, EXP-02, EXP-04)
- [ ] Tenancy and access-control findings (ACC-04, ACC-05, section 6.1)
- [ ] Opinion on the change-control process and the open risks in section 7

---

## 9. Sign-off

| Role | Name | Decision (Accept / Accept with conditions / Reject) | Date | Signature |
|---|---|---|---|---|
| QA/QC lead | | | | |
| Auditor | | | | |
| Product owner | | | | |

**Conditions / comments:**

&nbsp;
