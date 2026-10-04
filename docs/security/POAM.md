# Plan of action and milestones (POA&M)

Open items after the 10/04/2026 remediation. Each item has an owner and a target; update this file as items close. "Owner" = the person accountable at Hoshmand AI.

| # | Item | Why it matters | Plan | Owner | Target |
|---|---|---|---|---|---|
| 1 | Independent penetration test | Procurement and defense buyers require third-party evidence | Commission a web-app pen test; fix findings within the SLAs in VULNERABILITY-MANAGEMENT.md | Founder | 12/2026 |
| 2 | Email verification for self sign-up | Proves control of the address before granting access | Add a transactional email provider (e.g. Postmark/SES), send verification on sign-up | Engineering | 11/2026 |
| 3 | Centralized log retention & alerting on security events | Platform logs roll off; audit log is in-app | Add a Vercel log drain to a SIEM/log service (e.g. Better Stack, Datadog); alert on `auth.locked`, 5xx spikes | Engineering | 11/2026 |
| 4 | Off-provider backups enabled | Protects against provider-level loss | Add `BACKUP_DATABASE_URL` (read-only role) and `BACKUP_PASSPHRASE` secrets; nightly workflow already in place | Founder | 10/2026 |
| 5 | Branch protection / code-owner review | Separation of duties for production changes | Require the `check`, `e2e`, `sast` and CodeQL checks on `main`; optionally require code-owner review for `.github/CODEOWNERS` paths (see CHANGE-MANAGEMENT.md) | Founder | 10/2026 |
| 6 | SCIM provisioning | Automatic onboarding/offboarding from the customer's directory | Implement SCIM 2.0 Users endpoint after first Enterprise SSO customer | Engineering | Q1 2027 |
| 7 | Manual assistive-technology testing | Automated scans catch ~40% of WCAG issues | NVDA + VoiceOver walkthrough of the interview, schedule and quality flows | Product | 11/2026 |
| 8 | Counsel review of Terms, Privacy, DPA template | Enterprise contracts | Engage SaaS counsel; publish DPA and SLA templates | Founder | 12/2026 |
| 9 | Cyber / E&O insurance | Procurement requirement | Obtain quotes; bind coverage before first enterprise contract | Founder | 12/2026 |
| 10 | SOC 2 Type I readiness | Common enterprise ask | Use this control matrix as the starting point; choose an auditor | Founder | 2027 |
| 11 | Independent CPM/DCMA validation | Proves parity with P6/MS Project | Run the reference corpus through P6 and compare dates/float/DCMA (see docs/governance/VALIDATION-PLAN.md) | Product | Q1 2027 |
| 12 | Customer validation | Proves outcomes | Paid pilots with success metrics (see docs/governance/PILOT-PLAYBOOK.md) | Founder | Q1 2027 |
