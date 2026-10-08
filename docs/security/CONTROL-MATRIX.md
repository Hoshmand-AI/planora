# Control matrix

Maps Planora's controls to common frameworks, with the evidence an assessor can check. Status: **Implemented** (in code and tested), **Partial**, or **Owner action** (needs a business decision, contract or third party). This document is also the skeleton of a System Security Plan; open items are tracked in [POAM.md](POAM.md).

## OWASP Top 10:2025 / ASVS

| Risk | Control | Evidence | Status |
|---|---|---|---|
| A01 Broken access control | RBAC on every route; org-scoped queries; 404 for other tenants; route-guard test | `src/lib/server/api.ts`, `permissions.ts`, `routes.test.ts`, `scripts/e2e-smoke.mjs` (two firms), `e2e-security.mjs` (roles), `e2e-tenant-isolation.mjs` (every object, cross-org), `tenant-scope.test.ts` (org_id on every query) | Implemented |
| A02 Security misconfiguration | CSP, HSTS, frame, CORP/COOP headers; `poweredByHeader` off; no stack traces | `next.config.js`, `api.ts` error handler, e2e header check | Implemented |
| A03 Software supply chain | `npm audit` gate (runtime), Dependabot, SBOM artifact, pinned lockfile (`npm ci`), CodeQL | `.github/workflows/ci.yml`, `codeql.yml`, `dependabot.yml` | Implemented |
| A04 Cryptographic failures | TLS to DB with verification; bcrypt; AES-256-GCM for MFA/SSO secrets; hashed recovery codes and invitation tokens | `databaseTlsConfig` in `src/lib/db.ts`, `src/lib/server/crypto.ts`, `security.test.ts` | Implemented |
| A05 Injection | Parameterized SQL only (`pg`), formula-injection neutralization in CSV, no dynamic code | `src/lib/db.ts`, `src/lib/export/csv.ts`, Semgrep in CI | Implemented |
| A06 Insecure design | Deterministic scheduling core separated from AI; optimistic locking; separation-of-duties policies | `src/lib/planning/*`, `savePlan`, review/publish routes | Implemented |
| A07 Authentication failures | Password policy, lockout, rate limits, TOTP MFA, OIDC SSO, revocable sessions, generic errors | `src/lib/auth.ts`, `src/app/api/auth/*`, `src/lib/server/email-verification.ts`, `e2e-security.mjs` | Implemented (email verification built; provider key: Owner action) |
| A08 Software/data integrity | Hash-chained, DB-enforced append-only audit log; backup manifests with SHA-256 | `src/lib/server/audit.ts`, migration 2 trigger, `scripts/restore-drill.mjs` | Implemented |
| A09 Logging & alerting failures | Structured JSON logs with request ids; audit log; uptime probe → incident issue | `src/lib/server/log.ts`, `src/lib/server/webhooks.ts` (security alerts), `.github/workflows/uptime.yml` | Implemented (alert channel URL and central log retention: Owner action) |
| A01/A10 Server-side request forgery (webhooks) | HTTPS only, DNS resolution checked against private/loopback/link-local/metadata ranges, no redirects, timeout | `src/lib/server/webhooks.ts`, `security.test.ts` | Implemented |
| A10 Mishandling exceptional conditions | Central error handling; JSON-body validation; 409/429/402 semantics; retries only for idempotent model calls | `api.ts`, `provider.ts` | Implemented |

## NIST Cybersecurity Framework 2.0

| Function | What Planora does | Evidence |
|---|---|---|
| Govern | Policies, risk register, change management, vendor list | `docs/governance/*`, `docs/operations/CHANGE-MANAGEMENT.md`, `docs/privacy/SUBPROCESSORS.md` |
| Identify | Data map and classification; SBOM; capacity envelope | `docs/privacy/DATA-MAP.md`, CI SBOM, `docs/operations/CAPACITY.md` |
| Protect | Access control, MFA/SSO, encryption, secure SDLC, accessibility | sections above |
| Detect | Audit log, failed-login/lockout events, uptime probe, CodeQL/Semgrep/Dependabot | `audit_events`, workflows |
| Respond | Incident response plan and runbooks | `docs/operations/INCIDENT-RESPONSE.md`, `RUNBOOKS.md` |
| Recover | Neon point-in-time recovery, nightly off-provider backup with restore drill, Vercel instant rollback | `docs/operations/BACKUP-AND-RECOVERY.md`, `backup.yml` |

## NIST SP 800-171 Rev. 3 (for CUI deployments)

Planora's cloud service is **not** offered for Controlled Unclassified Information. For CUI, Planora runs on-premises / air-gapped inside the customer's assessed boundary (`PLANORA_AIRGAPPED=true`, on-prem model or no model, on-prem PostgreSQL). The application then provides these controls; the hosting environment provides the rest. On the commercial cloud, the app warns against entering CUI and refuses to send projects marked CUI or classified to a cloud model ([CUI-HANDLING.md](CUI-HANDLING.md)).

| Family | Application control | Status |
|---|---|---|
| 03.01 Access control | RBAC, least privilege, project-level workspaces (ethical walls), session termination (idle timeout, revocation), unsuccessful-logon lockout | Implemented |
| 03.03 Audit & accountability | Event logging with actor/time/source, protection of audit information (append-only + hash chain), review/export | Implemented |
| 03.05 Identification & authentication | Unique accounts, MFA (TOTP) or federated SSO, password policy, replay-resistant codes | Implemented |
| 03.13 System & communications protection | TLS to DB with verification; air-gapped model-host allowlist; no external calls at runtime | Implemented |
| 03.14 System & information integrity | Dependency scanning, SAST, flaw remediation SLAs | Implemented (process) |
| 03.04 Configuration management, 03.06 Incident response, 03.08 Media protection, 03.10 Physical, 03.12 Assessment | Hosting-environment and organizational controls | Owner action (customer/enclave) |

Requirement-by-requirement (Rev. 2, 110 requirements), with the known gaps: [NIST-800-171-MAPPING.md](NIST-800-171-MAPPING.md). Installation and hardening: [../operations/ON-PREM-INSTALL.md](../operations/ON-PREM-INSTALL.md).

## WCAG 2.2 AA

Automated axe-core scan of 11 key screens on every change (no serious or critical violations); visible keyboard focus; skip link; labelled forms, dialogs and tables; text contrast at least 4.5:1; reduced-motion support. Manual screen-reader testing (NVDA, VoiceOver) is tracked in [POAM.md](POAM.md).
