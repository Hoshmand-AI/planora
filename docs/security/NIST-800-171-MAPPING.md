# NIST SP 800-171 mapping (on-premises deployments)

_Last updated 10/06/2026._

**Status: self-assessment by the vendor, not an assessment.** Planora has no CMMC assessment, no
FedRAMP authorization and no third-party attestation of any kind (see [POAM.md](POAM.md)). This
document helps a customer's assessor and system security plan (SSP) author see, for each of the 110
security requirements of NIST SP 800-171 Rev. 2 (the revision CMMC Level 2 uses), what the Planora
application provides, what the customer's environment must provide, and where there are gaps. The
Rev. 3 family view is in [CONTROL-MATRIX.md](CONTROL-MATRIX.md).

**Scope.** It applies only to an **on-premises or air-gapped** Planora instance inside the
customer's assessed boundary ([../operations/ON-PREM-INSTALL.md](../operations/ON-PREM-INSTALL.md)).
Planora's hosted commercial cloud is not offered for CUI ([CUI-HANDLING.md](CUI-HANDLING.md)).
Requirement titles below are paraphrased; use the NIST publication for the authoritative text.

**Responsibility key**

| Code | Meaning |
|---|---|
| **App** | The Planora application implements it; the customer configures and uses it. |
| **Shared** | Planora provides part of it; the customer's environment, configuration or procedures must provide the rest. |
| **Customer** | Provided by the customer's environment, organization or procedures. Planora is not involved, or only supplies information. |
| **Gap** | Planora does not meet its share today. A compensating measure is suggested. |

**Summary**

| Family | Reqs | App | Shared | Customer | Gap |
|---|---|---|---|---|---|
| 3.1 Access control | 22 | 6 | 4 | 10 | 2 |
| 3.2 Awareness and training | 3 | 0 | 0 | 3 | 0 |
| 3.3 Audit and accountability | 9 | 3 | 4 | 2 | 0 |
| 3.4 Configuration management | 9 | 0 | 5 | 4 | 0 |
| 3.5 Identification and authentication | 11 | 5 | 4 | 0 | 2 |
| 3.6 Incident response | 3 | 0 | 1 | 2 | 0 |
| 3.7 Maintenance | 6 | 0 | 0 | 6 | 0 |
| 3.8 Media protection | 9 | 0 | 1 | 8 | 0 |
| 3.9 Personnel security | 2 | 0 | 1 | 1 | 0 |
| 3.10 Physical protection | 6 | 0 | 0 | 6 | 0 |
| 3.11 Risk assessment | 3 | 0 | 2 | 1 | 0 |
| 3.12 Security assessment | 4 | 0 | 1 | 3 | 0 |
| 3.13 System and communications protection | 16 | 2 | 6 | 6 | 2 |
| 3.14 System and information integrity | 7 | 0 | 4 | 2 | 1 |
| **Total** | **110** | **16** | **33** | **54** | **7** |

The seven gaps are: system-use notification (3.1.9), session lock with pattern-hiding display
(3.1.10), disabling inactive identifiers (3.5.6), password reuse history (3.5.8), FIPS-validated
cryptography (3.13.11), application-level encryption of CUI at rest (3.13.16) and malicious-code
scanning of uploaded files (3.14.2). Each has a compensating measure below.

## 3.1 Access control

| Req | Requirement (paraphrased) | Resp. | Planora implementation / customer action | Evidence |
|---|---|---|---|---|
| 3.1.1 | Limit access to authorized users, processes, devices | Shared | Every API route requires an authenticated session or API key (`api()`); a test fails the build if a route skips it. Accounts come from invitations, SSO into DNS-verified domains, or (with `PLANORA_SIGNUP=invite_only`) only the bootstrapping owner. Network access to the instance: customer | `src/lib/server/api.ts`, `src/lib/server/routes.test.ts`, `src/lib/server/signup-policy.ts` |
| 3.1.2 | Limit access to permitted transactions and functions | App | Five roles with a fixed permission matrix; each route declares its permission. Workspaces restrict which schedules and plans a member can see | `src/lib/server/permissions.ts`, `src/lib/server/workspaces.ts` |
| 3.1.3 | Control the flow of CUI | Shared | Organization (`org_id`) and workspace scoping on every schedule/plan read; CUI/classified projects are never sent to a model outside the network; air-gapped mode refuses non-private model hosts; webhooks refuse private destinations. Network flow control: customer | `src/lib/db.ts`, `src/lib/llm/provider.ts`, [CUI-HANDLING.md](CUI-HANDLING.md) |
| 3.1.4 | Separation of duties | App | Optional policies: the author can't approve their own plan; publishing needs an independent approval bound to the exact schedule content. Role separation (reviewer vs scheduler) | `src/lib/server/approval.ts` |
| 3.1.5 | Least privilege | App | Least-privilege roles (viewer read-only; API keys never admin); restricted members and walled workspaces narrow data access further | `src/lib/server/permissions.ts`, `src/lib/server/api-keys.ts` |
| 3.1.6 | Non-privileged accounts for non-security functions | Customer | Admins can hold a separate lower-role account for daily work; procedure is the customer's | — |
| 3.1.7 | Prevent non-privileged users running privileged functions; log privileged functions | App | Membership, policy, SSO, workspace and key management require `org.manage`/`org.own`; all are written to the audit log | `src/app/api/org/route.ts`, `src/app/api/workspaces/route.ts`, `src/lib/server/audit.ts` |
| 3.1.8 | Limit unsuccessful logon attempts | App | Account locks for 15 minutes after 8 consecutive failures; per-account and per-IP attempt limits; lockouts raise a security alert | `src/lib/server/rate-limit.ts`, `src/app/api/auth/route.ts` |
| 3.1.9 | Privacy and security notices (system-use notification) | **Gap** | No configurable logon banner in the app. Compensate: display the approved notice at the reverse proxy or SSO identity provider sign-in page | — |
| 3.1.10 | Session lock with pattern-hiding display | **Gap** | The app ends sessions after an idle timeout (1–24 h, set by the organization) but has no screen lock. Compensate: OS screen lock policy on endpoints (customer), shortest practical idle timeout | `src/lib/server/settings.ts` |
| 3.1.11 | Terminate sessions after defined conditions | App | Server-side sessions end on idle timeout, 7-day absolute limit, sign-out, "sign out everywhere", password change and member removal; checked on every request | `src/lib/auth.ts` |
| 3.1.12 | Monitor and control remote access | Customer | VPN / remote-access gateway. The audit log records IP and user agent for every action | — |
| 3.1.13 | Cryptographic protection of remote access sessions | Customer | TLS at the customer's reverse proxy ([ON-PREM-INSTALL.md](../operations/ON-PREM-INSTALL.md) section 5) | — |
| 3.1.14 | Route remote access through managed access points | Customer | Network architecture | — |
| 3.1.15 | Authorize remote privileged commands | Customer | Host and container administration (Docker access is root-equivalent) | — |
| 3.1.16 | Authorize wireless access | Customer | — | — |
| 3.1.17 | Protect wireless access | Customer | — | — |
| 3.1.18 | Control mobile device connections | Customer | — | — |
| 3.1.19 | Encrypt CUI on mobile devices | Customer | Planora stores nothing on devices beyond files a user downloads | — |
| 3.1.20 | Verify and control connections to external systems | Shared | Air-gapped mode refuses any model host outside the private network; the instance makes no outbound calls by default (no telemetry, no licence check); webhooks and the alert channel accept only public HTTPS destinations and are admin-configured and audited; API keys are scoped and revocable. Firewall egress rules: customer | `src/lib/llm/provider.ts`, `src/lib/server/webhooks.ts`, [ON-PREM-INSTALL.md](../operations/ON-PREM-INSTALL.md) section 8 |
| 3.1.21 | Limit portable storage on external systems | Customer | Exports and downloads are audited (`schedule.export`, `plan.export`, `schedule.download_original`); device control is the customer's | `src/lib/server/audit.ts` |
| 3.1.22 | Control CUI on publicly accessible systems | Shared | Planora has no public sharing or anonymous links; the instance should not be internet-facing | — |

### Workspaces (ethical walls)

Workspaces support 3.1.2, 3.1.3, 3.1.5 and 3.13.4 inside one organization. A workspace groups the
schedules and plans of one client matter or engagement. A **walled** workspace is visible only to
its members; a **restricted** member sees only their own workspaces; owners and admins see
everything; API keys never see walled workspaces. Enforcement is in one place: `api()` resolves the
caller's access once per request and every schedule and plan read in `src/lib/db.ts` applies it, so
lists, reads, exports, quality checks, risk analysis, comparisons, reports, Ask AI, the portfolio,
firm history and every plan action return "not found" across a wall. Tests
(`src/lib/server/workspaces.test.ts`) run each endpoint family as a restricted member. Workspace
changes are audited (`workspace.*`). Activities, relationships and stored files are read only after
their schedule passed the scoped read. A reviewer who doesn't see every workspace also doesn't see
audit events about schedules, plans or workspaces behind a wall. Not covered by walls: the member
list of the organization, organization-level webhooks (configured by admins, they receive events
for all workspaces) and the organization data export (owners and admins only).

## 3.2 Awareness and training

| Req | Requirement (paraphrased) | Resp. | Notes |
|---|---|---|---|
| 3.2.1 | Security awareness for users and managers | Customer | Planora supplies user-facing documentation; training is the customer's |
| 3.2.2 | Role-based security training | Customer | Admin guidance: [ON-PREM-INSTALL.md](../operations/ON-PREM-INSTALL.md) |
| 3.2.3 | Insider-threat awareness | Customer | — |

## 3.3 Audit and accountability

| Req | Requirement (paraphrased) | Resp. | Planora implementation / customer action | Evidence |
|---|---|---|---|---|
| 3.3.1 | Create and retain audit records | Shared | `audit_events` records sign-ins (and failures), member, role, policy, SSO and workspace changes, plan edits, reviews, publishing, uploads, exports, AI requests (metadata and prompt hash, never content) and privacy actions. Kept until the organization is deleted. Retention policy and capacity: customer | `src/lib/server/audit.ts` |
| 3.3.2 | Trace actions to individual users | App | Each record carries actor id and email, time, IP, user agent and request id; API-key actions are attributed to the named key | `src/lib/server/audit.ts`, `src/lib/server/context.ts` |
| 3.3.3 | Review and update logged events | Customer | The event set is documented; periodic review is the customer's procedure | — |
| 3.3.4 | Alert on audit logging process failure | Shared | A failed audit write fails the request for material actions and logs an error; a failed hash-chain verification raises a security alert. Monitoring the logs and the database: customer | `src/lib/server/audit.ts`, `src/lib/server/webhooks.ts` |
| 3.3.5 | Correlate audit review, analysis and reporting | Shared | Audit log CSV export and filters; structured JSON application logs with request ids. SIEM correlation: customer | `src/app/api/audit/route.ts`, `src/lib/server/log.ts` |
| 3.3.6 | Audit reduction and report generation | App | Filter by action, actor, target and time; CSV export; in-app integrity verification | `src/app/api/audit/route.ts` |
| 3.3.7 | Authoritative time source | Customer | Timestamps come from the host clock and PostgreSQL; synchronize with the customer's NTP source | — |
| 3.3.8 | Protect audit information and tools | Shared | Append-only: a database trigger rejects UPDATE, DELETE and TRUNCATE, and records are hash-chained per organization so any change is detectable; the restore drill re-verifies every chain. A database superuser could still disable the trigger, which the chain would expose: restrict database administration (customer) | `src/lib/migrations.ts` (migration 2), `scripts/restore-drill.mjs` |
| 3.3.9 | Limit audit management to privileged users | App | Only owners, admins and reviewers can read or export the log; no role can edit it | `src/lib/server/permissions.ts` |

## 3.4 Configuration management

| Req | Requirement (paraphrased) | Resp. | Planora implementation / customer action |
|---|---|---|---|
| 3.4.1 | Baseline configurations and inventories | Shared | Container image pinned by digest; CycloneDX SBOM (`npm run sbom`, also `/app/sbom.cdx.json` in the image); every setting is listed in [ON-PREM-INSTALL.md](../operations/ON-PREM-INSTALL.md). Host and network inventory: customer |
| 3.4.2 | Security configuration settings | Shared | Secure defaults in the image and Compose file (AI offline, air-gapped, invite-only sign-up, non-root, read-only filesystem, no capabilities); hardening guide section 8. Enforcement on hosts: customer |
| 3.4.3 | Track and control changes | Shared | Vendor side: pull requests with required CI ([../operations/CHANGE-MANAGEMENT.md](../operations/CHANGE-MANAGEMENT.md)); organization policy changes are audited in the app. Deploying new images: customer change control |
| 3.4.4 | Security impact analysis of changes | Customer | Release notes identify migrations; migrations are additive so rollback is safe |
| 3.4.5 | Access restrictions for change | Customer | Who may run `docker` and change `.env` |
| 3.4.6 | Least functionality | Shared | The image contains only the standalone server; no shell access is needed; telemetry is disabled. Host minimization: customer |
| 3.4.7 | Restrict nonessential programs, ports, protocols | Shared | One HTTP port (3000), published on loopback only; the database is on an internal network. Host ports and services: customer |
| 3.4.8 | Application allowlisting / denylisting | Customer | — |
| 3.4.9 | Control user-installed software | Customer | Planora has no plug-ins or user-installed code |

## 3.5 Identification and authentication

| Req | Requirement (paraphrased) | Resp. | Planora implementation / customer action | Evidence |
|---|---|---|---|---|
| 3.5.1 | Identify users, processes, devices | App | Unique accounts (one email per account); API keys are named service identities | `src/lib/db.ts`, `src/lib/server/api-keys.ts` |
| 3.5.2 | Authenticate before access | App | Password (bcrypt) or OpenID Connect SSO; API keys by SHA-256-hashed bearer secret | `src/lib/auth.ts`, `src/lib/server/sso.ts` |
| 3.5.3 | Multifactor authentication | Shared | TOTP two-step verification with single-use recovery codes; an organization can require it for every member. SSO sessions rely on the identity provider's MFA (customer IdP policy). API keys are single-factor service credentials: limit them to integrations and set expiry | `src/lib/server/mfa.ts`, `src/lib/server/totp.ts` |
| 3.5.4 | Replay-resistant authentication | Shared | Each TOTP step is accepted once; SSO uses PKCE, state and nonce; sessions are bound to a server-side record. Transport protection (TLS): customer | `src/lib/server/totp.ts`, `src/lib/server/sso.ts` |
| 3.5.5 | Prevent reuse of identifiers | Shared | Emails are unique; user ids are random UUIDs; removed members are disabled, not deleted, so their address can't be re-registered in the meantime. Identifier policy: customer | `src/lib/server/org.ts` |
| 3.5.6 | Disable identifiers after inactivity | **Gap** | No automatic disabling of inactive accounts in Planora itself. Compensate: provision with SCIM 2.0 so accounts disabled in the identity provider (for example by its inactivity policy) are disabled in Planora and signed out at once, with SSO enforced; or review members periodically and remove inactive ones (removal is immediate and audited) | — |
| 3.5.7 | Password complexity | App | Minimum 12 characters, maximum 128, common, repetitive and personal passwords blocked (NIST SP 800-63B approach: length over composition rules). If the customer's policy demands composition rules, enforce SSO | `src/lib/server/password.ts` |
| 3.5.8 | Prohibit password reuse | **Gap** | No password history. Compensate: enforce SSO, so the IdP's password history applies | — |
| 3.5.9 | Temporary passwords with immediate change | App | No temporary passwords exist: people join through single-use, email-bound invitation links (7-day expiry) and set their own password | `src/lib/server/org.ts` |
| 3.5.10 | Store and transmit only protected passwords | Shared | Passwords stored as bcrypt (cost 12), never logged; MFA seeds and SSO secrets encrypted (AES-256-GCM). TLS in transit: customer | `src/lib/auth.ts`, `src/lib/server/crypto.ts` |
| 3.5.11 | Obscure authentication feedback | App | Masked password fields; generic, timing-equalized sign-in errors | `src/app/api/auth/route.ts` |

## 3.6 Incident response

| Req | Requirement (paraphrased) | Resp. | Notes |
|---|---|---|---|
| 3.6.1 | Incident-handling capability | Shared | The app supplies the audit log, security-alert log lines and integrity verification; Planora's own process is [../operations/INCIDENT-RESPONSE.md](../operations/INCIDENT-RESPONSE.md). The customer's capability covers its instance |
| 3.6.2 | Track, document and report incidents | Customer | Including DFARS 252.204-7012 reporting where applicable |
| 3.6.3 | Test incident response | Customer | — |

## 3.7 Maintenance

| Req | Requirement (paraphrased) | Resp. | Notes |
|---|---|---|---|
| 3.7.1 | Perform maintenance | Customer | Upgrades are image replacements ([ON-PREM-INSTALL.md](../operations/ON-PREM-INSTALL.md) section 7) |
| 3.7.2 | Control maintenance tools and personnel | Customer | — |
| 3.7.3 | Sanitize equipment removed for maintenance | Customer | — |
| 3.7.4 | Check media with diagnostic programs | Customer | — |
| 3.7.5 | MFA for nonlocal maintenance | Customer | Planora staff have no access to on-prem instances unless the customer grants it |
| 3.7.6 | Supervise maintenance personnel | Customer | — |

## 3.8 Media protection

| Req | Requirement (paraphrased) | Resp. | Notes |
|---|---|---|---|
| 3.8.1 | Protect system media containing CUI | Customer | Database volume and backups |
| 3.8.2 | Limit access to CUI on media | Customer | — |
| 3.8.3 | Sanitize or destroy media | Customer | — |
| 3.8.4 | Mark media with CUI markings | Shared | Plans record a classification (`security.classification`); exported files carry no CUI banner markings today, so mark exported files under the customer's procedure |
| 3.8.5 | Control access to media during transport | Customer | — |
| 3.8.6 | Cryptography for CUI on digital media in transport | Customer | `scripts/backup.mjs` dumps are not encrypted; encrypt them before they leave the host (install guide section 6) |
| 3.8.7 | Control removable media | Customer | — |
| 3.8.8 | Prohibit portable storage without an owner | Customer | — |
| 3.8.9 | Protect backup CUI | Customer | Backups carry a SHA-256 manifest and are verified by the restore drill; confidentiality of stored backups: customer |

## 3.9 Personnel security

| Req | Requirement (paraphrased) | Resp. | Notes |
|---|---|---|---|
| 3.9.1 | Screen individuals before access | Customer | — |
| 3.9.2 | Protect CUI during personnel actions | Shared | Removing a member disables the account and revokes every session immediately; role changes and workspace removals take effect on the next request; all are audited. The procedure and timing are the customer's |

## 3.10 Physical protection

| Req | Requirement (paraphrased) | Resp. |
|---|---|---|
| 3.10.1 | Limit physical access | Customer |
| 3.10.2 | Protect and monitor the facility | Customer |
| 3.10.3 | Escort and monitor visitors | Customer |
| 3.10.4 | Physical access logs | Customer |
| 3.10.5 | Manage physical access devices | Customer |
| 3.10.6 | Safeguarding at alternate work sites | Customer |

## 3.11 Risk assessment

| Req | Requirement (paraphrased) | Resp. | Notes |
|---|---|---|---|
| 3.11.1 | Assess risk | Customer | Planora supplies [SECURITY-OVERVIEW.md](SECURITY-OVERVIEW.md), this mapping and its own [../governance/RISK-REGISTER.md](../governance/RISK-REGISTER.md) |
| 3.11.2 | Scan for vulnerabilities | Shared | Vendor: `npm audit` gate, Dependabot, Semgrep, CodeQL on every change; no third-party penetration test yet (POA&M #1). Customer: scan the hosts and images (use the SBOM) |
| 3.11.3 | Remediate vulnerabilities | Shared | Vendor targets in [VULNERABILITY-MANAGEMENT.md](VULNERABILITY-MANAGEMENT.md); the customer applies new images |

## 3.12 Security assessment

| Req | Requirement (paraphrased) | Resp. | Notes |
|---|---|---|---|
| 3.12.1 | Periodically assess controls | Customer | — |
| 3.12.2 | Plans of action | Customer | Planora's own open items: [POAM.md](POAM.md) |
| 3.12.3 | Monitor controls continuously | Customer | `/api/health`, audit-chain verification and logs support it |
| 3.12.4 | System security plan | Shared | This mapping and the install guide are inputs to the customer's SSP; the SSP is the customer's |

## 3.13 System and communications protection

| Req | Requirement (paraphrased) | Resp. | Planora implementation / customer action | Evidence |
|---|---|---|---|---|
| 3.13.1 | Monitor and protect communications at boundaries | Shared | No outbound calls by default; model hosts limited to the private network in air-gapped mode; the database on an internal Docker network. Boundary devices: customer | `src/lib/llm/provider.ts`, `docker-compose.yml` |
| 3.13.2 | Secure architecture and engineering | Shared | Deterministic engine independent of AI; single enforcement points for access (`api()`, scoped reads in `db.ts`); defense-in-depth headers. Overall system architecture: customer | [SECURITY-OVERVIEW.md](SECURITY-OVERVIEW.md) |
| 3.13.3 | Separate user and system-management functionality | Shared | Organization management is permission-gated in the app; host, database and container administration are outside the app (customer) | `src/lib/server/permissions.ts` |
| 3.13.4 | Prevent unauthorized transfer via shared resources | App | Organization isolation on every query (tested end to end between two firms) and workspace walls inside an organization | `src/lib/db.ts`, `scripts/e2e-tenant-isolation.mjs`, `src/lib/server/tenant-scope.test.ts`, `src/lib/server/workspaces.test.ts` |
| 3.13.5 | Subnetworks for public components | Customer | Place the reverse proxy in a DMZ if users reach it from outside the enclave | — |
| 3.13.6 | Deny network traffic by default | Customer | Host and network firewalls (install guide section 8) | — |
| 3.13.7 | Prevent split tunneling | Customer | — | — |
| 3.13.8 | Cryptography for CUI in transit | Shared | Database TLS is verified (certificate and host name) whenever enabled; Compose disables it only on the single-host internal network. User-facing TLS at the proxy: customer | `src/lib/db.ts` (`databaseTlsConfig`) |
| 3.13.9 | Terminate connections at session end or inactivity | Shared | Sessions end on idle timeout; connection timeouts at the proxy: customer | `src/lib/auth.ts` |
| 3.13.10 | Manage cryptographic keys | Customer | `JWT_SECRET`, `PLANORA_ENCRYPTION_KEY`, TLS keys; rotation effects are documented in the install guide | — |
| 3.13.11 | FIPS-validated cryptography | **Gap** | Planora uses Node.js's bundled OpenSSL (AES-256-GCM, SHA-256, HMAC) and bcrypt for passwords; it has not been validated or tested with a FIPS 140 module, and bcrypt is not a FIPS-approved algorithm. Compensate: terminate TLS on a FIPS-validated proxy and use FIPS-validated storage encryption; use SSO so passwords are held by a FIPS-validated IdP. Running Node.js against a FIPS provider is untested | `src/lib/server/crypto.ts` |
| 3.13.12 | Collaborative computing devices | Customer | Planora uses no cameras or microphones (blocked by Permissions-Policy) | `next.config.js` |
| 3.13.13 | Control mobile code | App | Content Security Policy allows only same-origin scripts; no plug-ins | `next.config.js` |
| 3.13.14 | Control VoIP | Customer | Not used | — |
| 3.13.15 | Authenticity of communications sessions | Shared | Signed session cookies bound to server-side sessions; `HttpOnly`, `Secure`, `SameSite=Lax`; Origin / Sec-Fetch-Site checks on writes. TLS: customer | `src/lib/auth.ts`, `src/lib/server/api.ts` |
| 3.13.16 | Protect CUI at rest | **Gap** | Schedule and plan content is stored unencrypted in PostgreSQL at the application layer (only secrets are field-encrypted). Compensate: full-disk or volume encryption (FIPS-validated) for the database volume and backups (customer) | `src/lib/server/crypto.ts` |

## 3.14 System and information integrity

| Req | Requirement (paraphrased) | Resp. | Notes |
|---|---|---|---|
| 3.14.1 | Identify, report and correct flaws | Shared | Vendor: dependency gate, Dependabot, SAST, CodeQL, fix SLAs. Customer: apply new images promptly |
| 3.14.2 | Malicious code protection | **Gap** | Uploaded files are parsed by a fixed set of parsers (XER, MS Project XML, Excel/CSV, PDF), never executed, limited to 25 MB, and kept in the database; they are not scanned for malware. Compensate: endpoint protection on user devices and the host; scan exported originals before opening them in other tools |
| 3.14.3 | Monitor security alerts and advisories | Shared | Vendor monitors dependency advisories; customer subscribes to Planora release notices and base-image advisories |
| 3.14.4 | Update malicious code protection | Customer | — |
| 3.14.5 | Periodic and real-time scans | Customer | — |
| 3.14.6 | Monitor systems and traffic for attacks | Shared | Rate limits, lockouts and security-alert log lines; structured logs with request ids. Network and host monitoring: customer |
| 3.14.7 | Identify unauthorized use | Shared | Audit log of every material action with actor and source; failed sign-ins and lockouts recorded. Review and SIEM rules: customer |

## Changes to this document

Update it when a security feature changes. Every gap closed should also be reflected in
[POAM.md](POAM.md) and [VENDOR-QUESTIONNAIRE.md](VENDOR-QUESTIONNAIRE.md).
