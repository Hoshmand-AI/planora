# Data map and retention schedule

| Data | Examples | Classification | Purpose | Stored in | Owner | Retention | Shared with |
|---|---|---|---|---|---|---|---|
| Account | name, work email, role, organization | Personal – business contact | Sign-in, attribution, access control | `users` | Customer org (controller); Hoshmand AI (processor) | Until the account or organization is deleted | Vercel, Neon |
| Credentials | bcrypt password hash, encrypted TOTP secret, hashed recovery codes | Secret | Authentication | `users` | Hoshmand AI | Until changed/deleted | Neon (encrypted at rest) |
| Sessions | session id, IP, browser, timestamps | Personal – technical | Security, "where you're signed in" | `sessions` | Hoshmand AI | 30 days after end | Neon |
| Project data | interview answers, notes, generated schedules, overrides, reviews, decisions | Customer confidential (may be CUI only in on-prem deployments) | The service | `plans` | Customer org | Until deleted, or the org's inactivity retention | Neon; OpenAI only when cloud AI is on and only request-relevant parts |
| Uploaded schedules | activities, relationships, calendars (original file not kept) | Customer confidential | Analysis | `schedules`, `activities`, `relationships` | Customer org | Until deleted, or the org's inactivity retention | Neon; OpenAI as above |
| Project documents | extracted text of contracts, scheduling specifications, owner requirements, split into cited passages; title, type, trust, SHA-256, size (original file not kept) | Customer confidential (may be CUI only in on-prem deployments) | Grounding Ask AI and reports, search, candidate requirements | `project_documents`, `document_chunks`, `document_requirement_reviews` | Customer org | Until the document, its upload or the org is deleted; passages hard-deleted at once, a tombstone (id, SHA-256, size, dates) remains | Neon; OpenAI only for "Use project documents" with cloud AI on, never CUI/classified or flagged passages. See [PROJECT-DOCUMENTS.md](PROJECT-DOCUMENTS.md) |
| Retrieval log | user, project, purpose, SHA-256 of the query, returned document and passage ids | Technical | Accountability for what was retrieved and sent to a model | `retrieval_log` | Customer org | 400 days | Neon |
| Data-question responses | "intentional / will fix" answers | Customer confidential | Quality review | `data_question_responses` | Customer org | With the schedule | Neon |
| Ask AI history | questions and answers | Customer confidential | Q&A continuity | `chat_messages` | Customer org | 365 days default (org-configurable) | Neon; OpenAI when cloud AI is on |
| Audit log | actor, action, target, IP, browser, request id, hash | Personal – technical + customer confidential | Accountability, security, disputes | `audit_events` | Customer org | Life of the organization; tombstone after deletion | Neon |
| AI request metadata | model, purpose, sizes, latency, SHA-256 of prompt | Technical | AI governance and spend control | `audit_events` (`ai.request`) | Customer org | As audit log | — |
| Invitations | email, role, hashed token | Personal – business contact | Onboarding | `invitations` | Customer org | 30 days after expiry/revocation | Neon |
| SSO configuration | issuer, client id, encrypted client secret, domains | Customer confidential / secret | Federation | `organizations.sso`, `sso_domains` | Customer org | Until changed or org deleted | Neon |
| API keys | name, role, key prefix, SHA-256 of the key, creator, last use | Secret (hash only) | Integrations | `api_keys` | Customer org | Until revoked and the org is deleted | Neon |
| Webhooks | endpoint URL, events, encrypted signing secret, delivery status | Customer confidential / secret | Integrations | `webhooks` | Customer org | Until removed or org deleted | Neon; event payloads go to the customer's own endpoint |
| Email tokens | SHA-256 of single-use confirmation tokens | Secret (hash only) | Email verification | `email_tokens` | Hoshmand AI | 48 hours (single use) | Neon |
| Transactional email | recipient address, confirmation or invitation link | Personal – business contact | Email verification, invitations | Email provider | Hoshmand AI | Provider retention | Resend or Postmark (if configured) |
| Rate-limit counters | keys with IP/email/org id, counts | Technical | Abuse prevention | `rate_limits` | Hoshmand AI | 2 days | Neon |
| Platform logs | request lines (JSON) with request id, user id, path, status | Technical | Operations | Vercel | Hoshmand AI | Vercel plan retention | Vercel |
| Backups | full database | As above (highest class) | Recovery | Neon PITR; optional encrypted GitHub artifact | Hoshmand AI | Neon window; artifacts 35 days | Neon, GitHub (encrypted) |

**Minimization:**
- Original uploaded files are discarded after parsing (schedules and project documents alike).
- The retrieval log keeps ids and a query hash, never query or document text.
- "Can't share" answers are stored without a value and are never sent to a model.
- AI calls are logged without their content.
- No analytics or advertising trackers; the only cookie is the session cookie.

**Rights handling:**
- Self-service personal export and account deletion: Account & security.
- Organization export and deletion: Organization.
- Anything else goes to privacy@hoshmand.ai, with a response target of 30 days.
