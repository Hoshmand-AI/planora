# Plan of action and milestones (POA&M)

Open items after the 10/04/2026 remediation (updated after round 2 the same day). Each item has an owner and a target; update this file as items close. "Owner" = the person accountable at Hoshmand AI.

| # | Item | Why it matters | Plan | Owner | Target |
|---|---|---|---|---|---|
| 1 | Independent penetration test | Procurement and defense buyers require third-party evidence | Scope written (PENTEST-PLAN.md). Commission a web-app pen test; fix findings within the SLAs in VULNERABILITY-MANAGEMENT.md | Founder | 12/2026 |
| 2 | Email verification for self sign-up | Proves control of the address before granting access | **Built (round 2).** Self sign-ups get a single-use, 48-hour confirmation link; invitations and SSO count as confirmed; unconfirmed accounts can't invite, create API keys/webhooks or export organization data. **Remaining (owner):** set `RESEND_API_KEY` (or `POSTMARK_TOKEN`) and `EMAIL_FROM` in Vercel with a verified sending domain. Until then nothing is enforced and invitation links are copied by hand | Founder | 10/2026 |
| 3 | Centralized log retention & alerting on security events | Platform logs roll off; audit log is in-app | **Alerting built (round 2):** account lockouts, MFA turned off, ownership/SSO/role changes, organization exports, new API keys and failed audit-chain verification are posted to `PLANORA_ALERT_WEBHOOK_URL` (a Slack/Teams incoming webhook). **Remaining (owner):** set that variable; add a Vercel log drain to a log service for retention | Founder | 11/2026 |
| 4 | Off-provider backups enabled | Protects against provider-level loss | `BACKUP_PASSPHRASE` added. Remaining: `BACKUP_DATABASE_URL` (read-only role on the new Neon database `planora-db`). The workflow now uses PostgreSQL 17 client tools to match Neon | Founder | 10/2026 |
| 5 | Branch protection / code-owner review | Separation of duties for production changes | Require the `check`, `e2e`, `sast` and CodeQL checks on `main`; optionally require code-owner review for `.github/CODEOWNERS` paths (see CHANGE-MANAGEMENT.md) | Founder | 10/2026 |
| 6 | SCIM provisioning | Automatic onboarding/offboarding from the customer's directory | Implement SCIM 2.0 Users endpoint after first Enterprise SSO customer | Engineering | Q1 2027 |
| 7 | Manual assistive-technology testing | Automated scans catch ~40% of WCAG issues | NVDA + VoiceOver walkthrough of the interview, schedule and quality flows | Product | 11/2026 |
| 8 | Counsel review of Terms, Privacy, DPA template | Enterprise contracts | DPA template drafted (docs/privacy/DPA-TEMPLATE.md) and a pre-filled vendor questionnaire (VENDOR-QUESTIONNAIRE.md). Remaining: engage SaaS counsel; publish SLA template | Founder | 12/2026 |
| 9 | Cyber / E&O insurance | Procurement requirement | Obtain quotes; bind coverage before first enterprise contract | Founder | 12/2026 |
| 10 | SOC 2 Type I readiness | Common enterprise ask | Use this control matrix as the starting point; choose an auditor | Founder | 2027 |
| 11 | Independent CPM/DCMA validation | Proves parity with P6/MS Project | Run the reference corpus through P6 and compare dates/float/DCMA (see docs/governance/VALIDATION-PLAN.md) | Product | Q1 2027 |
| 12 | Customer validation | Proves outcomes | Paid pilots with success metrics (see docs/governance/PILOT-PLAYBOOK.md) | Founder | Q1 2027 |
