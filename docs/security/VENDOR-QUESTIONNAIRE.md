# Vendor security questionnaire — pre-filled answers

For procurement and IT reviewers. These answers follow the topics of common questionnaires (SIG Lite, CAIQ, HECVAT Lite). They state what exists today and what does not. Each answer points to the evidence in this repository. Last updated 10/06/2026.

**What Planora does not have yet** (see [POAM.md](POAM.md)):
- No SOC 2 report, ISO 27001 certificate, FedRAMP/StateRAMP authorization or CMMC assessment.
- No third-party penetration test yet. The scope is written: [PENTEST-PLAN.md](PENTEST-PLAN.md).
- No cyber / E&O insurance bound yet.
- No counsel-reviewed DPA yet. A template exists: [../privacy/DPA-TEMPLATE.md](../privacy/DPA-TEMPLATE.md).
- Planora is a single-founder company. Continuity measures are described in section 9.

## 1. Company and scope
| Question | Answer | Evidence |
|---|---|---|
| Legal entity / contact | Hoshmand AI; security contact support@hoshmand.ai | Terms, Privacy pages |
| What data is processed? | Schedule files (activities, dates, logic, calendars), interview answers, account data, audit log | [../privacy/DATA-MAP.md](../privacy/DATA-MAP.md) |
| Where is data stored? | Hosted service: United States only (Vercel iad1 application hosting, Neon Postgres us-east). There is no hosted EU or Canadian region | [../privacy/SUBPROCESSORS.md](../privacy/SUBPROCESSORS.md) |
| EU / Canadian data residency | Available only through a customer-hosted (on-premises or private-cloud) deployment that you run in the country or region you choose. Planora does not offer it as a hosted region. The customer-hosted instance makes no runtime calls to Planora or other outside services, so residency follows your hosting | [../operations/ON-PREM-INSTALL.md](../operations/ON-PREM-INSTALL.md) section 9 |
| Can it run on-premises / air-gapped? | Yes. The same build runs on your own servers with a local or no AI model (`PLANORA_DEPLOYMENT=onprem`, `PLANORA_AIRGAPPED=1`). A production `Dockerfile` (non-root, standalone server) and a `docker-compose.yml` with PostgreSQL 17 are provided, with an install, upgrade, backup and hardening guide. Nothing leaves your network | [../operations/ON-PREM-INSTALL.md](../operations/ON-PREM-INSTALL.md), [CUI-HANDLING.md](CUI-HANDLING.md) |

## 2. Access control
| Question | Answer | Evidence |
|---|---|---|
| SSO | OpenID Connect (Azure AD / Entra, Okta, Google); per-domain enforcement | `src/lib/server/sso.ts` |
| MFA | TOTP with single-use recovery codes. Replayed codes are rejected. An organization can require MFA | `src/lib/server/mfa.ts` |
| Roles | Owner, admin, scheduler, reviewer, viewer. Every API route declares its permission and a test enforces it | `src/lib/server/routes.test.ts` |
| Project-level access (ethical walls) | Workspaces group schedules and plans by client matter or engagement. A walled workspace is visible only to its members; members can be limited to their own workspaces; owners and admins see all. Enforced on every list, read and export endpoint, and audited | `src/lib/server/workspaces.ts`, `src/lib/server/workspaces.test.ts` |
| Separation of duties | Publishing a plan requires an approval by someone other than the author, tied to the exact schedule content. Any edit invalidates the approval | `src/lib/server/approval.ts` |
| Session security | Revocable server sessions, idle and absolute timeouts, CSRF protection, secure cookies | [SECURITY-OVERVIEW.md](SECURITY-OVERVIEW.md) |
| Brute force | Per-account lockout after 8 failures; failed-attempt limits per account and per IP | `src/lib/server/rate-limit.ts` |

## 3. Data protection
| Question | Answer | Evidence |
|---|---|---|
| Encryption in transit | TLS 1.2+ everywhere; HSTS preload | Response headers |
| Encryption at rest | Neon storage encryption (AES-256). Secrets (SSO client secret, webhook secrets) are additionally encrypted by the application | [SECURITY-OVERVIEW.md](SECURITY-OVERVIEW.md) |
| Tenant isolation | Every query is scoped by organization; cross-tenant access is tested end to end | `scripts/e2e-security.mjs` |
| Original files / chain of custody | The uploaded file is kept unchanged with its SHA-256, which is also written to the tamper-evident audit log. It can be downloaded again | `src/app/api/schedules/[id]/export/route.ts` |
| Audit log | Append-only and hash-chained; covers every answer, override, review, export and upload | `src/lib/server/audit.ts` |
| Data export and deletion | Organization export; member and organization erasure | [../privacy/DATA-MAP.md](../privacy/DATA-MAP.md) |
| Firm history | Only schedules marked as your own as-built projects calibrate durations. Uploads that are in progress, or belong to clients or third parties, are excluded by default | `schedules.in_history` |

## 4. AI
| Question | Answer | Evidence |
|---|---|---|
| Is AI used? | Optional. The schedule engine, DCMA checks and reports are deterministic code. AI only phrases answers and suggestions | [../ai/AI-GOVERNANCE.md](../ai/AI-GOVERNANCE.md) |
| Is it on by default? | No. New organizations start with AI off; an admin turns it on | `src/lib/server/org.ts` |
| Is our data used to train models? | No. OpenAI API terms exclude API data from training. No other model provider is used | [../privacy/SUBPROCESSORS.md](../privacy/SUBPROCESSORS.md) |
| CUI / classified projects | Cloud AI is refused for projects marked CUI, classified or withheld. The cloud service warns that CUI must not be stored there | [CUI-HANDLING.md](CUI-HANDLING.md) |

## 5. Secure development
| Question | Answer | Evidence |
|---|---|---|
| Code review and CI | Every change goes through a pull request. CI runs typecheck, unit tests, build, end-to-end, security and accessibility tests, SAST and CodeQL | `.github/workflows/ci.yml` |
| Dependency management | `npm audit` gates the build on high and critical advisories; a CycloneDX SBOM is produced on every build. `npm run sbom` produces a CycloneDX 1.5 SBOM from `package-lock.json` without network access (also shipped in the on-prem image at `/app/sbom.cdx.json`) | [VULNERABILITY-MANAGEMENT.md](VULNERABILITY-MANAGEMENT.md), `scripts/sbom.mjs` |
| Vulnerability SLAs | Critical 7 days, high 30 days | [VULNERABILITY-MANAGEMENT.md](VULNERABILITY-MANAGEMENT.md) |
| Penetration test | Not yet. Scope and selection criteria are in [PENTEST-PLAN.md](PENTEST-PLAN.md) | — |

## 6. Availability and recovery
| Question | Answer | Evidence |
|---|---|---|
| Backups | Provider point-in-time recovery, plus encrypted off-provider dumps with a scheduled restore drill | [../operations/BACKUP-AND-RECOVERY.md](../operations/BACKUP-AND-RECOVERY.md) |
| Monitoring / incident response | Health endpoint, structured logs, security alerts; a documented incident process | [../operations/INCIDENT-RESPONSE.md](../operations/INCIDENT-RESPONSE.md) |
| Rollback | Instant rollback to any previous deployment | [../operations/CHANGE-MANAGEMENT.md](../operations/CHANGE-MANAGEMENT.md) |

## 7. Compliance
| Question | Answer |
|---|---|
| SOC 2 | Not yet. The control matrix ([CONTROL-MATRIX.md](CONTROL-MATRIX.md)) is the readiness baseline |
| FedRAMP / CMMC / NIST 800-171 | Not assessed. For federal or CUI work, use the on-premises deployment inside your own accredited environment. A vendor self-assessment maps all 110 NIST SP 800-171 Rev. 2 requirements to what the application provides, what your environment must provide, and seven known gaps: [NIST-800-171-MAPPING.md](NIST-800-171-MAPPING.md) |
| Accessibility | WCAG 2.2 AA is checked automatically on every build; manual testing with assistive technology is planned |

## 8. Contracts
| Question | Answer |
|---|---|
| DPA | Template in [../privacy/DPA-TEMPLATE.md](../privacy/DPA-TEMPLATE.md). Not yet counsel-reviewed; we will sign your DPA if it is reasonable |
| SLA | Pro: best effort. Enterprise: written SLA by agreement |
| Insurance | Not yet bound (POA&M #9) |

## 9. Business continuity (single-founder vendor)
- **Source code escrow:** not in place today; can be discussed for an Enterprise contract.
- **On-premises licence:** your on-premises installation keeps working without Planora's servers.
- **Data portability:** every schedule exports to P6 XER, MS Project XML, Excel and CSV, and the original file is always downloadable. You are never locked in.
- **Operational runbooks:** in [../operations/RUNBOOKS.md](../operations/RUNBOOKS.md).
