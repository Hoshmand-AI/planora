# Planora

AI construction scheduling that **asks before it builds**. Built by [Hoshmand AI](https://www.hoshmand.ai).

Planora works in three stages: **build** a schedule, **analyze** it, then **monitor** it.

1. **Build.** Planora interviews the scheduler the way a senior scheduler would. It asks how complete the drawings are, which permits this facility type needs in this jurisdiction, which long-lead equipment is involved, and about site, calendar and security constraints. Then it generates a CPM schedule and explains every duration and link.
2. **Analyze.** It runs DCMA 14-point quality checks, a critical-path and float review, and asks questions about the input data itself (for example, "your calendar is 5-day but this activity runs on a Saturday — intentional?").
3. **Monitor.** Publishing a plan creates a baseline. Dashboards, the timeline, Ask AI and reports all run on it.

## What makes it different

| Capability | Where |
|---|---|
| **Elicitation.** It works out what is missing and asks targeted questions, ordered by how much each answer can move the finish date. Follow-up questions depend on earlier answers, contradictions are flagged, and "don't know" or "can't share" answers become explicit assumptions with visible contingency. | `src/lib/planning/elicitation.ts` |
| **Grounding.** Durations and logic come from regional permit and regulation catalogs (10 regions, 50 permits, 20 regulations), long-lead equipment lead times (27 items), activity templates for 9 facility types, and **the firm's own completed projects** (actual vs. planned). | `src/lib/knowledge/*`, `src/lib/planning/history.ts` |
| **Evaluation.** Each plan gets a DCMA 14-point score, benchmarks against the firm's actual outcomes, risk-adjusted P50/P80 finish dates, a check that every grounded requirement is covered, recorded expert review, and a **leave-one-out backtest** against the firm's completed projects. | `src/lib/planning/evaluation.ts` |
| **Private data.** Every firm is an organization, and every query is scoped by `org_id`. Firm history only ever reads that firm's own schedules. | `src/lib/db.ts` |
| **Any file format.** Imports P6 XER and P6 XML (including calendars, constraints and WBS; the same project in either format gives identical CPM results), MS Project XML, Excel/CSV (messy headers are handled) and PDF. Nothing is dropped silently: every import and export carries an exception report of what was not mapped, converted or defaulted (`src/lib/parsers/exceptions.ts`). Activity names and calendars are normalized to shared meanings (for example "SOG", "F/R/P footings" and "Hang/Tape/Finish GWB" each map to a standard category). Exports MS Project XML, CSV and a **Basis of Schedule** narrative. | `src/lib/parsers/*`, `src/lib/semantic/taxonomy.ts`, `src/lib/export/*` |
| **Self-checking inputs.** Flags weekend or holiday work, out-of-sequence progress, invalid dates, dangling logic and other data issues. The scheduler answers each one inline. | `src/lib/analysis/input-checks.ts` |
| **Secure / air-gapped use.** Runs with no model, with an on-prem model, or with a cloud model through a provider-agnostic AI gateway (default cloud provider: Anthropic Claude via `ANTHROPIC_API_KEY`; OpenAI is an approved alternate, selected with `PLANORA_AI_PROVIDER=openai`). Cloud AI calls send request-relevant content to the selected provider. In air-gapped mode it refuses any model host that is not private. Withheld answers are never sent to a model; withheld constraints become placeholders with reserved time. Small models get narrow, JSON-only tasks that are validated and retried. | `src/lib/llm/provider.ts`, `src/lib/llm/gateway.ts`, `src/lib/planning/ai-questions.ts` |
| **Project documents.** Contracts, scheduling specifications and owner requirements are indexed per project (Postgres full-text search, scoped in SQL to the firm, project and workspace). Ask AI and reports can answer from them with verified citations like [Spec §1.3.4 p.3]; document text is treated as untrusted data, passages that read like prompt injection are never sent to a model, CUI passages never reach a cloud model, and candidate scheduling requirements (max duration, update frequency, float, NTP, completion, LDs) are suggested for people to confirm. | `src/lib/rag/*`, [docs/privacy/PROJECT-DOCUMENTS.md](docs/privacy/PROJECT-DOCUMENTS.md) |
| **Human control.** Every activity and link shows why it exists and where that came from. Overrides require a reason, report their impact on the finish date and critical path, survive regeneration, and are recorded in the audit trail and the narrative. | `src/lib/planning/overrides.ts` |

The scheduling core is deterministic TypeScript and runs without any model:
- multi-calendar CPM with FS/SS/FF/SF links, lags, constraints, progress and negative float
- DCMA checks
- a generator that details field work into segments of 44 days or less

## Tech stack

Next.js 16 (App Router, React 19), TypeScript strict, Tailwind v3, Postgres (`pg`, raw SQL, versioned migrations in `src/lib/migrations.ts` applied automatically), server-side sessions (signed httpOnly cookie), Vitest, Playwright + axe-core.

## Security, governance and operations

Roles (owner/admin/scheduler/reviewer/viewer), workspaces with ethical walls between client matters, invitations, two-step verification, single sign-on with OpenID Connect or SAML 2.0, SCIM 2.0 user provisioning, revocable sessions, rate limits and lockout, a hash-chained append-only audit log, retention and privacy controls, plan entitlements, and Monte Carlo schedule risk analysis.

- Start with [docs/security/SECURITY-OVERVIEW.md](docs/security/SECURITY-OVERVIEW.md) and [docs/governance/AUDIT-REMEDIATION.md](docs/governance/AUDIT-REMEDIATION.md).
- Operations docs are in [docs/operations](docs/operations); to report a vulnerability, see [SECURITY.md](SECURITY.md).
- Every API route is built with `api({ permission })` or `publicApi()` from `src/lib/server/api.ts` (the SCIM 2.0 endpoints under `/api/scim/v2` use `scimApi()`, which accepts only an organization SCIM token). A test fails the build otherwise.

## Setup

```bash
npm install
cp .env.example .env.local   # set DATABASE_URL, JWT_SECRET, and optionally AI settings
npm run dev
```

### Checks

```bash
npm run typecheck
npm test                                            # 410+ unit tests (incl. route guard, security, CPM performance budgets, export/import round trips)
BASE_URL=http://localhost:3000 node scripts/e2e-smoke.mjs   # end-to-end against a running server
# Security & governance suite (use DATABASE_URL for the audit-immutability checks; OIDC_ISSUER for SSO,
# with `PORT=4010 node scripts/mock-oidc.mjs` running and the app started with PLANORA_ALLOW_INSECURE_OIDC=1)
# PLANORA_EMAIL_OUTBOX + PLANORA_ALLOW_INSECURE_WEBHOOKS=1 on the server enable the email and webhook checks
BASE_URL=… DATABASE_URL=… OIDC_ISSUER=http://localhost:4010 PLANORA_EMAIL_OUTBOX=/tmp/outbox WEBHOOK_RECEIVER_PORT=4020 node scripts/e2e-security.mjs
BASE_URL=… DATABASE_URL=… WEBHOOK_RECEIVER_PORT=4020 node scripts/e2e-tenant-isolation.mjs   # org B vs every object of org A
BASE_URL=… DATABASE_URL=… node scripts/e2e-scim.mjs        # SAML sign-in and SCIM provisioning (server with PLANORA_ALLOW_INSECURE_OIDC=1)
BASE_URL=… node scripts/e2e-rag.mjs                         # project documents: isolation, injection, citations, deletion
RAG_TEST_DATABASE_URL=… npx vitest run src/lib/rag/rag.db.test.ts   # retrieval SQL against a real Postgres
BASE_URL=… node scripts/a11y-check.mjs                     # WCAG 2.2 AA (axe-core) on the main screens
# The suites above create their own firms: run that server with PLANORA_SIGNUP=open. The private beta gate is
# checked against a server in the default invite-only mode with PLANORA_PLATFORM_ADMINS=ops@beta.test:
BASE_URL=… DATABASE_URL=… BETA_ADMIN_EMAIL=ops@beta.test node scripts/e2e-beta.mjs
DATABASE_URL=… node scripts/backup.mjs backups && ADMIN_DATABASE_URL=… node scripts/restore-drill.mjs backups/*.dump
```

### Private beta access

Planora is in private beta: **sign-up and sign-in are by invitation** unless the instance re-opens self sign-up.

| Variable | Purpose |
|---|---|
| `PLANORA_SIGNUP` | Unset (default) or `invite_only`: sign-up needs an organization invitation or a beta invitation (SSO/SCIM provisioning into an organization and the first account on an empty instance still work), and sign-in needs beta access. `open`: anyone may sign up and the sign-in gate is off. |
| `PLANORA_PLATFORM_ADMINS` | Comma-separated platform operator emails (case-insensitive). Operators always pass the gate and use **Beta access** (`/dashboard/platform`, from the account menu) to invite a new firm (single-use, 14-day link; accepting it creates the firm's organization), revoke invitations, and revoke or restore a person's beta access. Everyone else gets 404 there. |
| `PLANORA_ACCESS_REQUEST_EMAIL` | Address behind the "Request access" links on the landing and sign-in pages (hidden on sign-in when unset). |

Accounts that existed before the gate shipped were grandfathered (migration 18). Organization admins keep inviting their own members as before. See `src/lib/server/signup-policy.ts` and `src/lib/server/beta.ts`.

### Integrations, email and alerts

API keys, signed webhooks and the operator settings for email (`RESEND_API_KEY`/`POSTMARK_TOKEN`, `EMAIL_FROM`) and security alerts (`PLANORA_ALERT_WEBHOOK_URL`) are described in [docs/API.md](docs/API.md).

### Air-gapped deployment

```bash
PLANORA_AIRGAPPED=true \
LLM_BASE_URL=http://gpu01.enclave.internal:11434/v1 LLM_MODEL=llama3.1:8b \
DATABASE_URL=postgres://planora@db.enclave.internal/planora PGSSLMODE=disable \
npm start
```

Fonts are bundled at build time, so at runtime the app makes no external network calls other than to the configured model host.

For a container deployment (non-root image, Docker Compose with PostgreSQL 17, backups, upgrades, TLS and hardening, every setting) see [docs/operations/ON-PREM-INSTALL.md](docs/operations/ON-PREM-INSTALL.md). `npm run sbom` writes a CycloneDX 1.5 SBOM from `package-lock.json` without network access. How the application maps to NIST SP 800-171 is in [docs/security/NIST-800-171-MAPPING.md](docs/security/NIST-800-171-MAPPING.md).

## Structure

```
src/lib/
  planning/   types (shared contract), calendar, cpm, elicitation, ai-questions, generator,
              overrides, history, evaluation, service
  knowledge/  regions (permits, regulations, climate), long-lead, templates, applicability
  semantic/   taxonomy (activity + calendar normalization)
  analysis/   dcma, input-checks
  standards/  versioned rules engine: GAO Schedule Assessment Guide profile, DCMA 14-point adapter,
              Planora Composite (threshold conflicts reported, never blended); runs stored in standards_runs
  parsers/    xer, xml, excel/csv, pdf, index
  export/     msp-xml, csv, narrative (Basis of Schedule)
  llm/        gateway (provider-agnostic contract + model registry), provider (cloud / local / offline,
              air-gap + CUI guard, quotas, audit), adapters: anthropic (default cloud), openai, local
  rag/        project documents: extraction, chunking, injection screening, scoped retrieval,
              grounding, citation checks, requirement extraction
src/app/
  dashboard/plan        Build: interview → schedule → evaluation & review → audit
  dashboard/quality     DCMA + the tool's questions about uploaded data; Standards tab (framework picker)
  dashboard/history     Firm data: private history, tagging, backtest
  api/plans/[id]/...    generate, edit, review, export, publish, suggest
```

Reference ranges for permits, regulations and lead times are planning defaults. Verify them with the Authority Having Jurisdiction and suppliers before baselining.
