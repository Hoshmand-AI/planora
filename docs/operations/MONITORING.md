# Monitoring, logging and alerting

| Signal | Where | Alert |
|---|---|---|
| Liveness/readiness: DB reachable, schema current | `GET /api/health` (public, no data) | Uptime workflow every 15 min opens an `incident` GitHub issue and closes it on recovery |
| Request log: method, path, status, latency, request id, user/org id | Vercel runtime logs (JSON lines) | Vercel log drain → log service (see POA&M #3) |
| Errors | `level":"error"` lines with request id; users see the same id | Vercel runtime errors view; log drain alert |
| Security events | `audit_events`: `auth.signin_failed`, `auth.locked`, `auth.mfa_failed`, `auth.sso_failed`, `member.*`, `org.settings_changed`, `org.sso_changed` | Organization admins review in-app. `auth.locked`, `account.mfa_disabled`, `org.ownership_transferred`, `org.sso_changed`, `member.role_changed`, `privacy.organization_exported`, `apikey.created` and `audit.chain_broken` are posted to `PLANORA_ALERT_WEBHOOK_URL` (Slack/Teams incoming webhook) after the event is committed; without it they are logged as `security alert` warnings |
| AI use and spend | `ai.request` audit events; per-org daily quota | Quota stops spend at the limit; usage shown on the Organization page |
| Customer integrations | Webhook delivery status per endpoint (Organization → Integrations); endpoints disable after 20 failures | Visible to the customer's admins; `webhook dispatch failed` errors in logs |
| Dependencies and code | Dependabot, CodeQL, Semgrep, `npm audit` | GitHub security alerts; CI failures |

**Service level objectives (targets):**
- 99.5% monthly availability of `/api/health`.
- p95 API latency under 1.5 s, excluding uploads, exports and AI.
- Under 0.5% 5xx responses.

**Tracing a problem:** every error response carries a `requestId` (also in the `x-request-id` header). Search the logs for it to see the full request and its outcome.
