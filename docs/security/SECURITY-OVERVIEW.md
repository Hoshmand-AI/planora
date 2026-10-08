# Planora security overview

_For customers' security reviews and procurement. Last updated 10/06/2026._

## Architecture

| Layer | Technology | Notes |
|---|---|---|
| Application | Next.js 16 (React 19), TypeScript strict, Node.js 22 | Hosted on Vercel (cloud) or run on-premises from the provided container image or with `npm start` ([ON-PREM-INSTALL.md](../operations/ON-PREM-INSTALL.md)) |
| Database | PostgreSQL 14+ (Neon in the cloud) | TLS with certificate and host-name verification; encrypted at rest by the provider |
| AI (optional) | OpenAI API (cloud), any OpenAI-compatible on-prem model, or none | Organization-level switch, off by default for new organizations; air-gapped mode refuses non-private hosts; CUI/classified projects are never sent to a cloud model |

The scheduling engine (interview, CPM, DCMA checks, Monte Carlo risk analysis, recovery modeling, exports) is deterministic code that never depends on a model. Models only phrase answers and suggest extra interview questions.

## Identity and access

- **Passwords:** at least 12 characters, common and personal passwords blocked (NIST SP 800-63B). Stored as bcrypt (cost 12).
- **Two-step verification:** TOTP authenticator apps, with 10 single-use recovery codes (hashed). Each time step is accepted once per user (the last used step is stored), at sign-in, at re-authentication and at enrollment. Enrollment can only be confirmed while it is pending. New recovery codes require the current password plus a current code. The secret is encrypted with AES-256-GCM. Organizations can require it for every member.
- **Single sign-on:** OpenID Connect (Entra ID, Okta, Google Workspace…). Authorization code + PKCE, state and nonce, ID-token signature verified against the provider's JWKS, issuer/audience/expiry checks, verified email in a DNS-verified domain. Just-in-time provisioning with a default role. Can be enforced (owners keep a break-glass password).
- **SAML 2.0 single sign-on** (Enterprise plan, alongside OpenID Connect; `src/lib/server/saml.ts`): each organization has its own service-provider entity ID, assertion consumer service (ACS) URL and downloadable SP metadata. Admins paste the identity provider's metadata (or enter its entity ID, sign-on URL and signing certificates; several certificates can be listed for a rollover). Sign-in is SP-initiated only: Planora sends an AuthnRequest with the HTTP-Redirect binding, stores the request ID and binds it to the browser with a signed, 10-minute state cookie and the RelayState. The ACS (HTTP-POST) accepts a response only if:
  - its XML signature, over the Response or the Assertion, verifies against a configured certificate (checked by the maintained `@node-saml/node-saml` / `xml-crypto` libraries, not custom code). Unsigned responses, responses with more than one assertion, and signature-wrapping attempts are rejected;
  - the Audience is Planora's SP entity ID, the Destination (when present) and the bearer `SubjectConfirmationData` Recipient are the ACS URL, and the signed assertion's Issuer is the configured IdP entity ID;
  - `NotBefore`/`NotOnOrAfter` hold, with 60 seconds of clock skew;
  - `InResponseTo` answers the request issued to that browser for that organization. Each request ID is usable once, and assertion IDs are remembered until they expire, so a response can't be replayed;
  - the email (configurable attribute, else the common ones, else an email NameID) is in one of the organization's DNS-verified domains.

  Members are signed in, or created just-in-time in that organization only, with the default role or a role mapped from IdP groups (the most privileged match; owners are never changed). An email that already belongs to another organization is refused. SAML sessions follow the same rules as OIDC sessions, including the MFA policy (the identity provider's MFA applies) and "Require single sign-on", which blocks password sign-in for everyone except owners. Admins can run a **test sign-in** that checks the whole response and reports the result without signing anyone in. Configuration changes, sign-ins, failures and tests are audited, without assertion content.
- **SCIM 2.0 provisioning** (Enterprise plan; `src/lib/server/scim.ts`, `/api/scim/v2`): the identity provider can create, update, deactivate and delete members. The service supports `ServiceProviderConfig`, `ResourceTypes`, `Schemas` and `Users` (list with `filter=userName eq "…"` (also `emails.value`, `externalId`, `id`) and `startIndex`/`count` paging; get; POST; PUT; PATCH; DELETE). Responses use the RFC 7643/7644 shapes, including the SCIM error schema. Groups and bulk operations are not supported; roles come from the User's `roles` attribute (admin, scheduler, reviewer or viewer; never owner).
  - **Authentication:** per-organization bearer tokens created by an admin, shown once, stored as SHA-256 only, revocable at once, last use tracked, rate-limited per token. A token works only on SCIM endpoints and only on its own organization's members; session cookies and API keys are not accepted there. An automated test requires every SCIM route to use the dedicated `scimApi()` wrapper.
  - **Safeguards:** provisioned emails must be in the organization's verified SSO domains, and an address that already belongs to another organization is refused. SCIM can't deactivate owners or change their role or email.
  - **Deprovisioning:** `active=false` or DELETE disables the account and revokes all its sessions in the same transaction, so access ends on the next request. Project data stays with the firm.
  - Every change is audited under the token's name. Admins see the latest provisioning events in Organization settings.
- **Sessions:** server-side and revocable. Each request re-checks the session, so sign-out, "sign out everywhere", password change and member removal take effect immediately. Idle timeout is 12 hours by default (an admin can set 1–24), with an absolute limit of 7 days. Cookie: `HttpOnly`, `Secure`, `SameSite=Lax`.
- **Abuse controls:** database-backed rate limits that hold across all servers:
  - Sign-in: 10 attempts per 15 minutes per account (email), and the account locks for 15 minutes after 8 consecutive failures. Per network, only **failed** sign-ins count, up to 300 per 15 minutes per IP, so offices and job sites behind one shared IP aren't locked out by their own successful sign-ins.
  - Also limited: sign-up, two-step codes, API calls (600 per minute per user), uploads (60 per hour per organization), exports, and AI (daily organization quota plus 20 per minute per user).
  - Sign-in errors are generic and timing-equalized.
- **Roles (least privilege):** Owner, Admin, Scheduler, Reviewer, Viewer. Every API route declares the permission it needs. An automated test fails the build if a route skips the check or a new public endpoint appears.
- **Separation of duties (optional policies):** the person who built a plan can't approve it, and publishing a baseline requires an independent approving review of that exact version. Each review is bound to a SHA-256 fingerprint of the generated schedule's content. Any later override, regeneration or other change makes the approval stale, and publishing is refused until a fresh independent review (`src/lib/server/approval.ts`).
- **Email verification:** self sign-ups confirm their address with a single-use, 48-hour link (token stored as SHA-256). Until then they can't invite people, create API keys or webhooks, or export organization data. Invited and SSO members are confirmed on creation. Active when an email provider is configured.
- **API keys (integrations):** organization keys with a viewer or scheduler role (never admin), optional expiry, revocable, stored as SHA-256 only, last use tracked, accepted only by endpoints that opt in, rate-limited per key, and audited. See [docs/API.md](../API.md).
- **Webhooks:** HTTPS only; destinations that resolve to private, loopback, link-local or metadata addresses are refused (SSRF); redirects are not followed; 5-second timeout; deliveries signed with HMAC-SHA256 over a timestamp and the body; endpoints auto-disable after 20 consecutive failures. Signing secrets are encrypted at rest.
- **Membership lifecycle:** single-use invitations bound to an email address (7-day expiry), role changes, offboarding (account disabled and signed out immediately; data stays with the firm), ownership transfer, account unlock.

## Tenant isolation

Every firm is an organization and every query for firm data is scoped by `org_id`. Another firm's object ids return "not found". The end-to-end suite runs two competing firms against each other on every change.

Inside an organization, **workspaces** separate client matters or engagements (ethical walls). A walled workspace's schedules and plans are visible only to its members; a member can be limited to their own workspaces; owners and admins see everything; API keys never see walled workspaces. The rule is applied in one place, the schedule and plan reads in `src/lib/db.ts`, so every list, read, export, comparison, report, portfolio and history endpoint enforces it (`src/lib/server/workspaces.test.ts`). Workspace changes are audited.

## Application security

- Content Security Policy (`frame-ancestors 'none'`, same-origin resources), HSTS, `nosniff`, `X-Frame-Options: DENY`, strict referrer policy, restrictive Permissions-Policy, COOP/CORP.
- Cross-site request forgery: SameSite cookies plus Origin / Sec-Fetch-Site checks on every write.
- Input limits: 25 MB uploads, a whitelist of parsers (XER, MSP XML, Excel/CSV, PDF), and the original files are not stored.
- Spreadsheet formula injection is neutralized in CSV exports.
- Optimistic locking on plans: concurrent edits get 409 Conflict instead of overwriting each other.
- Errors return a request id, never stack traces.

## Audit trail

Every material event is appended to `audit_events`: sign-ins (and failures), member and role changes, policy changes, plan edits with reasons, reviews, publishing, exports, uploads, AI requests, privacy actions and retention purges. Each record carries the actor, time, IP address, user agent and request id.

- Records are **hash-chained per organization**.
- A **database trigger rejects UPDATE, DELETE and TRUNCATE**.
- Admins and reviewers can verify the chain in the app and download it as CSV.
- Organization deletion is the only purge path. It leaves a tombstone, including the final hash of the purged chain, on a system chain.

## Data protection and privacy

- **AI data:** cloud AI is opt-in. New organizations start rules-only until an admin turns AI on. Answers marked "Can't share" never reach a model (covered by tests). Projects marked CUI or classified are never sent to a model outside the customer's network, and the commercial cloud service warns that CUI must not be stored there (see [CUI-HANDLING.md](CUI-HANDLING.md)). AI calls log metadata and a SHA-256 of the prompt, never the content.
- **Retention:** configurable per organization (AI history, inactive projects). Sessions, rate counters and invitations are purged automatically.
- **Portability:** personal data export, full organization export (JSON), account erasure, and organization deletion.
- See [docs/privacy/DATA-MAP.md](../privacy/DATA-MAP.md) and [SUBPROCESSORS.md](../privacy/SUBPROCESSORS.md).

## Secure development

- **CI on every change:**
  - typecheck and 380+ unit tests, including the RFC test vectors for 2-step codes, the RBAC route guard and the CPM performance budgets;
  - a production build;
  - an end-to-end flow against PostgreSQL, plus 100+ security and governance checks;
  - a backup + restore drill;
  - a WCAG 2.2 AA accessibility scan;
  - Semgrep (OWASP Top 10, secrets);
  - CodeQL (security-extended);
  - an `npm audit` gate (runtime: no high/critical) and a CycloneDX SBOM.
- Dependabot opens weekly update pull requests.
- Changes reach production only through pull requests to `main`, after the checks above pass. See [docs/operations/CHANGE-MANAGEMENT.md](../operations/CHANGE-MANAGEMENT.md).

## Operations

Health endpoint and 15-minute uptime probe that opens an incident issue; security events (lockouts, MFA disabled, ownership/SSO/role changes, organization exports, new API keys, failed audit verification) pushed to an operator alert channel (`PLANORA_ALERT_WEBHOOK_URL`); structured JSON logs with request ids; documented incident response, runbooks, backup/restore and RTO/RPO. See [docs/operations](../operations).

## Not yet in place (honest status)

See [docs/security/POAM.md](POAM.md): an independent penetration test, a SOC 2 / CMMC assessment, configuring the email provider and alert channel in production, and central log retention.
