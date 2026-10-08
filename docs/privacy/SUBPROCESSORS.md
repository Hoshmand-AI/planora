# Subprocessors

| Provider | Service | Data | Location | When |
|---|---|---|---|---|
| Vercel Inc. | Application hosting, request logs | All application traffic | United States (default region iad1) | Cloud service |
| Neon Inc. | Managed PostgreSQL, backups (point-in-time recovery) | All stored data | Region of the project's database (confirm in the Neon console) | Cloud service |
| Anthropic, PBC | Model inference via API — **default cloud AI provider** (Claude) | Request-relevant schedule content (never answers marked "Can't share", never projects marked CUI or classified) | United States (confirm against the agreement in force) | Opt-in: only after an organization admin turns on **Allow AI features** (Organization → Policies) **and** the deployment is in cloud AI mode with the Anthropic provider (the default when `ANTHROPIC_API_KEY` is set). New organizations start with AI off. |
| OpenAI, L.L.C. | Model inference via API — **approved alternate** cloud AI provider | Request-relevant schedule content (never answers marked "Can't share", never projects marked CUI or classified) | United States | Only if the deployment selects it (`PLANORA_AI_PROVIDER=openai`, or only `OPENAI_API_KEY` is set). Opt-in: only after an organization admin turns on **Allow AI features** (Organization → Policies) **and** the deployment is in cloud AI mode. New organizations start with AI off. Organizations created before 10/06/2026 keep the setting they had (on unless an admin turned it off). |
| Resend, Inc. **or** Wildbit LLC (Postmark) | Transactional email (confirmation links, invitations) | Recipient email address, message text | United States | Only if `RESEND_API_KEY` or `POSTMARK_TOKEN` is configured |
| GitHub, Inc. | Encrypted off-provider backup artifacts | Encrypted database dump | United States | Only if the nightly backup workflow is enabled |

Only one cloud AI provider is active at a time (shown in the AI status in Settings). Training and data-retention terms must be verified against the provider agreement in force; Planora does not assert them here.

On-premises / air-gapped deployments use none of these. Customers are notified 30 days before a new subprocessor that processes customer data is added.
