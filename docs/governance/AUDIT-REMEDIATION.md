# Audit remediation report

Response to *Planora Independent QA/QC, Startup, Enterprise & Risk Audit* (120 aspects, 10/03/2026), release under review `d75f048`. Remediation was completed 10/04/2026 on branch `claude/eloquent-tesla-6gzy4k`.

**Legend**
- ✅ **Fixed:** implemented in code and covered by automated tests.
- ◐ **Improved:** implemented in part; the rest is listed.
- 📄 **Process:** a documented procedure, policy or template is now in place.
- 👤 **Owner action:** cannot be done in code (a business, legal or third-party step). The exact next step is listed in [POAM.md](../security/POAM.md).

Scores are the auditor's to revise. This report lists what changed and where the evidence is. A ✅ item needs independent re-testing before it can be scored 10/10.

## Summary of what changed

| Area | Before | After |
|---|---|---|
| Framework | Next.js 14.2.5 (critical advisories), React 18 | Next.js 16, React 19. Runtime `npm audit`: **0 vulnerabilities** |
| Sign-in | 6-character passwords; 7-day JWT that couldn't be revoked; no throttling; account enumeration | 12+ characters with a common-password block; server-side revocable sessions (12 h idle, adjustable); IP, email and account rate limits; lockout; generic errors |
| MFA / SSO | None | TOTP with recovery codes; organizations can require it. OpenID Connect SSO with PKCE, JWKS verification, DNS-verified domains, just-in-time provisioning and an enforce option |
| Organizations | One user per organization; no roles | Invitations, 5 roles enforced on every route, offboarding, ownership transfer, unlock, policies console |
| Audit trail | JSON on the plan, truncated at 500 entries, editable | Append-only `audit_events`, hash-chained, with database triggers that block edits and deletes. In-app verification and CSV export. Covers auth, members, plans, exports, AI and privacy |
| Data integrity | Whole-plan overwrite; runtime `ALTER`s | Optimistic locking (409 on conflict); numbered, checksummed migrations run under a lock |
| Privacy | Legacy "HSI" policy | Accurate policy and terms, data map, subprocessors, retention settings with automatic purge, personal and organization export, account and organization deletion |
| AI | Any configured model; no limits; unlogged | Organization AI switch; registry of approved, version-pinned models; daily and per-minute quotas; every call logged as metadata plus a hash |
| Risk analysis | Rule-based P50/P80 presented as risk dates | Monte Carlo SRA (full CPM per iteration, triangular ranges, correlated field work, criticality, sensitivity, probability of meeting the required date), plus honest labelling of the scenario dates |
| Exports | CSV formula injection possible | Formula prefixes neutralized |
| Web hardening | No security headers; no CSRF check | CSP, HSTS, frame, nosniff, COOP/CORP and Permissions-Policy headers; Origin / Sec-Fetch-Site checks on every write |
| Database TLS | `rejectUnauthorized: false` | Certificate and host-name verification; weaker `sslmode` values in the URL are stripped |
| Operations | No health check or alerting | `/api/health`; 15-minute uptime probe that opens incident issues; structured JSON logs with request ids; runbooks; incident response plan; RTO/RPO; backup plus a restore drill in CI and nightly |
| QA gates | Typecheck, unit tests, build | Plus: end-to-end on PostgreSQL, a 100+ check security suite, the restore drill, a WCAG 2.2 AA scan, Semgrep, CodeQL, an npm-audit gate, SBOM, CPM performance budgets and Dependabot |
| Accessibility | Low-contrast palette, unlabeled controls | Contrast-compliant tokens; visible focus; skip link; labelled forms, dialogs and tables; `aria-current`; reduced motion. **0 serious or critical axe violations on 11 screens** |
| Plans and pricing | Pricing page promised limits nothing enforced, plus features that don't exist (Word export, white-label) | Entitlements enforced on the server (uploads, AI, reports, exports, SSO); pricing page corrected; operator script records plan changes in the audit log |

---

## 3. Vision & differentiation

| # | Aspect | Status | What changed / evidence |
|---|---|---|---|
| 1 | Problem clarity | 👤 | Quantified ROI needs pilots. [PILOT-PLAYBOOK.md](PILOT-PLAYBOOK.md) defines the metrics |
| 2 | Product positioning | 📄 | Positioned as the intelligence, quality and recovery layer around P6/MSP (audit §18.2), in the pilot playbook |
| 3 | Ask before building | ✅ | Unchanged strength; the interview remains the default build path |
| 4 | Deterministic + AI architecture | ✅📄 | Boundary documented ([AI-GOVERNANCE.md](../ai/AI-GOVERNANCE.md)). Offline mode is tested in CI; AI can't change schedule data |
| 5 | Explainability | ✅ | Monte Carlo drivers show the range basis for each activity; audit records show actor and reason |
| 6 | Construction specialization | — | Unchanged strength |
| 7 | Competitive defensibility | 👤 | Firm-history learning and backtest exist; the data moat needs customers (pilots) |
| 8 | Brand narrative | ✅ | Legacy "Hoshmand Schedule Intelligence / HSI" naming removed from the privacy and terms pages; pricing page aligned with reality |

## 4. Customer value & workflow

| # | Aspect | Status | What changed / evidence |
|---|---|---|---|
| 9 | Time-to-value | — | Unchanged (upload → analysis) |
| 10 | Onboarding | ◐ | The invitation flow shows organization and role. A guided sample project is still to do |
| 11 | Interview workflow | — | Unchanged strength |
| 12 | Unknown/withheld handling | ✅ | Withheld values are now provably excluded (tests). Uncertainty propagates into the Monte Carlo ranges (low confidence widens them) |
| 13 | Recovery workflow | ◐ | Each option is still modeled on the network. Probability of meeting the date now comes from Monte Carlo. Cost/resource consequences still to do |
| 14 | Decision traceability | ✅ | Every material state change is in the append-only audit log, with plan version and detail |
| 15 | Collaboration | ✅ | Multi-member organizations, roles, invitations, independent review and approval-to-publish policies, conflict-safe concurrent editing |
| 16 | Monitor lifecycle | ◐ | Unchanged baseline/dashboard; portfolio alerts still to do |

## 5. Construction scheduling & domain correctness

| # | Aspect | Status | What changed / evidence |
|---|---|---|---|
| 17–20 | CPM, calendars, relationships, constraints | ◐ | Performance budgets added (100k activities in < 1 s). Independent P6 parity corpus planned: [VALIDATION-PLAN.md](VALIDATION-PLAN.md) |
| 21 | DCMA checks | ◐ | Unchanged; independent metric validation is in the validation plan |
| 22 | Input self-checking | — | Unchanged |
| 23 | Risk / P50/P80 methodology | ✅ | **Monte Carlo SRA** in `src/lib/planning/sra.ts`:<br>• the full CPM per iteration;<br>• triangular distributions from catalog, firm-history or kind-of-work ranges;<br>• Gaussian-copula correlation for field work;<br>• P10–P90, a histogram and the probability of meeting the required date;<br>• criticality index and Spearman sensitivity;<br>• seeded, so runs are reproducible.<br>Shown in the UI, the Basis of Schedule and the PDF. Tested in `sra.test.ts` |
| 24 | Historical backtesting | ◐ | Firm ratios now calibrate the simulation's ranges. Larger datasets need customers |

## 6. UX & accessibility

| # | Aspect | Status | What changed / evidence |
|---|---|---|---|
| 25–27 | Visual, hierarchy, responsive | — | Unchanged. New screens follow the design system |
| 28 | Keyboard navigation | ✅ | Global `:focus-visible` ring (3:1), skip-to-content link, real buttons and links. The CI check verifies focus is reachable on every page |
| 29 | Semantic accessibility | ✅ | Labelled inputs (`htmlFor`/`id`), `aria-label` on icon buttons, `role=alert/status` banners, table captions and `scope`, `aria-current` navigation, `nav` landmarks |
| 30 | Error recovery | ✅ | Structured errors with a `code`, a recovery hint and a `requestId` (409 reload prompt, 429 Retry-After, 402 upgrade path, MFA-setup redirect) |
| 31 | Accessibility QA | ✅ | `scripts/a11y-check.mjs` (axe-core, WCAG 2.0/2.1/2.2 A/AA) on 11 screens in CI. Manual NVDA/VoiceOver testing is POA&M #7 |
| 32 | Internationalization | ◐ | Not started. Dates stay MM/DD/YYYY by product decision; locale settings are a future item |

## 7. Data & interoperability

| # | Aspect | Status | What changed / evidence |
|---|---|---|---|
| 33–39 | Imports, exports, round-trip | ◐ | Unchanged. Round-trip parity is in the validation plan |
| 40 | Export safety | ✅ | `neutralizeFormula` in `src/lib/export/csv.ts` (also applied to the audit CSV). Excel exports write values, never formulas. Tested |

## 8. Architecture & scalability

| # | Aspect | Status | What changed / evidence |
|---|---|---|---|
| 41 | Separation of concerns | ✅ | New `src/lib/server/*` layer (api, auth context, permissions, audit, rate limit, sso, entitlements, maintenance) |
| 42 | Database model | ◐ | Security-critical state is normalized (sessions, invitations, audit_events, sso_domains, rate_limits). The plan body stays JSON, protected by versioning |
| 43 | Migrations | ✅ | `src/lib/migrations.ts`: numbered, checksummed, one transaction each, advisory lock, drift warning. Visible in `/api/health`. Rollback guidance in RUNBOOKS.md |
| 44 | Concurrent editing | ✅ | `plans.version` plus a conditional update; clients send `x-plan-version`; 409 with a reload prompt. Tested end to end |
| 45 | Connection management | ✅ | Pool size, connect and idle timeouts are configurable; health latency is reported |
| 46 | Stateless scaling | ✅ | Sessions, limits and locks live in PostgreSQL. [CAPACITY.md](../operations/CAPACITY.md) |
| 47 | Background processing | ◐ | Retention runs as a claimed hourly job. Large uploads remain synchronous (25 MB cap) |
| 48 | Very large schedules | ✅ | 10k / 50k / 100k-activity budgets enforced in CI (0.1 s / 0.37 s / 0.88 s measured) |

## 9. QA, reliability & release engineering

| # | Aspect | Status | What changed / evidence |
|---|---|---|---|
| 49 | Unit testing | ✅ | 380+ tests, including RFC 4226/6238 vectors, the RBAC route guard (fails the build if a route skips the check), crypto, hashing, CSV and SRA math |
| 50 | End-to-end tests | ✅ | Smoke suite (70 checks) plus security suite (100+ checks) against real PostgreSQL in CI |
| 51 | CI gates | ✅ | Adds e2e, restore drill, accessibility, Semgrep, CodeQL, the npm-audit gate, SBOM and performance budgets |
| 52 | Human release review | ◐📄 | Required automated gates. CODEOWNERS covers security-sensitive paths; turning on code-owner review in branch protection adds independent human approval for those paths without slowing other changes ([CHANGE-MANAGEMENT.md](../operations/CHANGE-MANAGEMENT.md)). 👤 Switch it on (POA&M #5) |
| 53 | Security testing | ✅◐ | SAST (Semgrep, CodeQL) and the security e2e suite in CI. 👤 External pen test (POA&M #1) |
| 54 | Supply chain | ✅ | Dependabot, runtime audit gate, CycloneDX SBOM per build, lockfile installs |
| 55 | Performance testing | ✅ | CPM budgets in CI; SRA timing test |
| 56 | Rollback | ✅📄 | Additive migrations plus a rollback runbook; restore drill on every PR |

## 10. Cybersecurity

| # | Aspect | Status | What changed / evidence |
|---|---|---|---|
| 57 | Authentication | ✅ | Password policy, TOTP MFA, OIDC SSO. 👤 Email verification needs an email provider (POA&M #2) |
| 58 | Sessions | ✅ | Server-side and revocable, idle and absolute timeouts, device list, sign out everywhere, revoked on password change or removal |
| 59 | Brute-force / abuse | ✅ | IP, email, user and org rate limits in the database; lockout; timing-equalized generic errors; AI and upload quotas |
| 60 | Tenant isolation | ✅ | Unchanged org scoping plus a route-guard test and two-firm e2e. (Row-level security is not used: every query already carries `org_id`, and the guard test enforces RBAC) |
| 61 | Database TLS | ✅ | `rejectUnauthorized: true` with host verification; `PGSSLROOTCERT` for private CAs. Tested |
| 62 | Application hardening | ✅ | Security headers and CSP, CSRF origin checks, no stack traces, JSON body validation |
| 63 | Dependency security | ✅ | Next.js 16 / React 19 / Vitest 5; runtime audit is clean; one documented dev-only exception |
| 64 | Detection / response | ✅◐ | Audit events for auth failures and lockouts; uptime alerts; incident plan. 👤 Central log drain (POA&M #3) |

## 11. Privacy & data governance

| # | Aspect | Status | What changed / evidence |
|---|---|---|---|
| 65 | Privacy notice accuracy | ✅ | `/privacy` rewritten to match the actual data flows, AI modes, subprocessors and retention. 👤 Counsel review (POA&M #8) |
| 66 | Data inventory | ✅ | [DATA-MAP.md](../privacy/DATA-MAP.md) |
| 67 | Data minimization | ✅ | Original files discarded; withheld values dropped (tested); AI logs carry no content; org AI switch |
| 68 | Retention | ✅ | Per-organization AI-history and inactive-project retention; automatic purges of sessions, counters and invitations; purges are audited |
| 69 | User rights | ✅ | Self-service personal export and account erasure; organization export and deletion |
| 70 | Subprocessors | ✅ | [SUBPROCESSORS.md](../privacy/SUBPROCESSORS.md); listed in the privacy policy. 👤 DPA template |
| 71 | Residency | ◐ | Documented. On-prem deployment for strict residency. 👤 Confirm the Neon region |
| 72 | Deletion lifecycle | ✅ | Cascading deletes; organization deletion purges the audit chain and leaves a tombstone with the final hash; reassignment on member erasure |

## 12. AI governance

| # | Aspect | Status | What changed / evidence |
|---|---|---|---|
| 73 | AI/deterministic separation | ✅ | Documented boundary; offline CI run |
| 74 | Withheld-data protection | ✅ | Tests cover the brief, generated schedule and coercion paths |
| 75 | Prompt minimization / inspection | ✅ | Every call is audited with a prompt SHA-256, sizes and purpose |
| 76 | Structured output validation | ✅ | Unchanged validators; the quota error is surfaced instead of being swallowed |
| 77 | Model / version governance | ✅ | Approved registry (`PLANORA_APPROVED_MODELS`); default pinned to `gpt-4o-2024-11-20`; [MODEL-REGISTRY.md](../ai/MODEL-REGISTRY.md) |
| 78 | AI evaluation | ◐📄 | Golden prompts and acceptance criteria defined; an automated live-model harness is still to do |
| 79 | AI monitoring / incidents | ✅ | `ai.request` events with ok/error and latency; incident handling in AI-GOVERNANCE.md |
| 80 | Claims / calibration | ✅ | Scenario vs Monte Carlo labelling; method and assumptions shown with every result |

## 13. Enterprise collaboration & administration

| # | Aspect | Status | What changed / evidence |
|---|---|---|---|
| 81 | Multi-user organization | ✅ | Invitations, joining, offboarding, ownership transfer, unlock |
| 82 | RBAC | ✅ | Owner / Admin / Scheduler / Reviewer / Viewer; permission matrix in `permissions.ts`; enforced on every route; tested |
| 83 | Organization admin | ✅ | Organization page: members, invitations, policies (MFA, independent review, approval, AI, quotas, idle timeout, retention), audit log, data export, SSO, deletion |
| 84 | SSO / SCIM | ✅◐ | OIDC SSO implemented and tested against a test identity provider. 👤 SCIM (POA&M #6) |
| 85 | Approval workflows | ✅ | Independent-review and approval-before-publish policies, tied to the exact schedule generation |
| 86 | Portfolio management | ◐ | Not started |
| 87 | Customer configuration | ◐ | Organization policies are configurable; custom templates and rules are a future item |
| 88 | Public API | ◐ | Not started (service accounts and webhooks are future items) |

## 14. Government, defense & compliance

| # | Aspect | Status | What changed / evidence |
|---|---|---|---|
| 89 | CUI readiness | 📄 | Control mapping and a CUI deployment model (on-prem/air-gapped only) in [CONTROL-MATRIX.md](../security/CONTROL-MATRIX.md). No CUI claim for the cloud service |
| 90 | Offline/on-prem | ✅ | Unchanged; the air-gap host guard is tested. 👤 Network-level egress enforcement belongs to the customer enclave |
| 91 | Audit immutability | ✅ | Append-only with triggers plus a hash chain; tamper detection tested |
| 92 | Access-control evidence | ✅ | MFA, least privilege, lifecycle, lockout, audit of all access changes |
| 93 | Change management | ✅◐ | Documented; required gates; CODEOWNERS. 👤 Turn on code-owner review |
| 94 | SSP / POA&M | 📄 | Control matrix (SSP skeleton) and [POAM.md](../security/POAM.md) |
| 95 | Vulnerability management | ✅📄 | [VULNERABILITY-MANAGEMENT.md](../security/VULNERABILITY-MANAGEMENT.md): SLAs, tooling, exception register |
| 96 | Independent assessment | 👤 | POA&M #1 |

## 15. Operations, observability & DR

| # | Aspect | Status | What changed / evidence |
|---|---|---|---|
| 97 | Application monitoring | ✅◐ | Health endpoint, latency in access logs, uptime probe. 👤 APM / log service (POA&M #3) |
| 98 | Structured logging | ✅ | JSON lines with request id, user and org, secrets redacted (`src/lib/server/log.ts`) |
| 99 | Alerting | ✅ | Uptime workflow opens and closes incident issues |
| 100 | Backup strategy | ✅📄 | Neon PITR plus a nightly encrypted off-provider dump. 👤 Add the two secrets |
| 101 | Restore testing | ✅ | `restore-drill.mjs` on every PR (CI) and nightly; checks counts, schema, SHA-256 and audit chains |
| 102 | RTO / RPO | 📄 | Defined per tier in BACKUP-AND-RECOVERY.md |
| 103 | Incident response | 📄 | [INCIDENT-RESPONSE.md](../operations/INCIDENT-RESPONSE.md) |
| 104 | Runbooks | 📄 | [RUNBOOKS.md](../operations/RUNBOOKS.md): deploy, rollback, migrations, auth, AI, database, security, plans, secrets |

## 16. Business model & GTM

| # | Aspect | Status | What changed / evidence |
|---|---|---|---|
| 105 | ICP | 📄 | Pilot playbook |
| 106 | Pricing | 👤 | Willingness-to-pay validation needs pilots |
| 107 | Entitlement enforcement | ✅ | `src/lib/server/entitlements.ts` enforced on uploads, AI, reports, exports and SSO. Existing organizations are grandfathered to Pro. Plan changes are audited. 👤 Billing provider |
| 108 | Enterprise sales readiness | 📄 | Security overview, control matrix, data map, subprocessors, policies. 👤 DPA/SLA templates |
| 109–112 | Pilots, validation, moat, expansion | 👤📄 | Pilot playbook; KPIs in the risk register |

## 17. Legal & governance

| # | Aspect | Status | What changed / evidence |
|---|---|---|---|
| 113 | Terms | ✅👤 | Rewritten (scope, planning-support disclaimer, acceptable use, data ownership, availability). Counsel review is POA&M #8 |
| 114 | Privacy policy | ✅👤 | Rewritten (see #65) |
| 115 | Professional-use disclaimer | ✅ | Terms §2 separates planning support from professional, contractual and owner approval |
| 116 | IP / licensing | ◐ | SBOM gives the open-source inventory. 👤 IP register and contributor policy |
| 117 | Internal policies | 📄 | [POLICIES.md](POLICIES.md) with owners and review cycle |
| 118 | Third-party risk | 📄 | Vendor review in POLICIES.md §5 and SUBPROCESSORS.md |
| 119 | Insurance / procurement | 👤 | POA&M #9 |
| 120 | Executive risk governance | 📄 | [RISK-REGISTER.md](RISK-REGISTER.md) with KPIs and a monthly review |

---

## Owner actions, in priority order

1. **GitHub branch protection** on `main`:
   - required checks `check`, `e2e`, `sast` and `analyze`;
   - optionally require code-owner review (adds human approval only for security-sensitive paths).
2. **Backup secrets:** `BACKUP_DATABASE_URL` (read-only role) and `BACKUP_PASSPHRASE` in GitHub → Settings → Secrets → Actions.
3. **Optional:** set `PLANORA_ENCRYPTION_KEY` (32+ random characters) in Vercel, separate from `JWT_SECRET`. Do this before anyone enrolls 2-step verification; changing it later forces re-enrollment.
4. **Optional:** set `PLANORA_DEFAULT_PLAN`. New organizations start on **Free** unless it is set to `pro`.
5. **Log drain** to a log service and alerts on `auth.locked` and 5xx (POA&M #3).
6. **Third parties:** pen test, counsel review, insurance, email provider for verification (POA&M #1, #2, #8, #9).
