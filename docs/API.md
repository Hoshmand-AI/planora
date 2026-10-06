# Planora API and webhooks

For integrating Planora with BI dashboards, data warehouses and your own tools. Available on the Pro and Enterprise plans. Admins manage keys and webhooks under **Organization → Integrations: API and webhooks**.

## API keys

- Create a key with a name (what will use it), an access level and an expiry:
  - **Read-only** (viewer role)
  - **Scheduler** (can also answer interview questions and generate schedules)
- Keys never have admin rights.
- The key is shown **once**. Planora stores only its SHA-256 hash, so a lost key can't be recovered: revoke it and create another.
- Send the key as a bearer token:

```bash
curl -H "Authorization: Bearer pk_live_…" https://planora-chi.vercel.app/api/portfolio
```

- Each key is limited to 600 requests per minute.
- Writes made with a key appear in the audit log as `api-key:<name>`.
- Revoking a key takes effect on the next request.

### Endpoints that accept API keys

| Method | Path | Access | Returns |
|---|---|---|---|
| GET | `/api/portfolio` | read-only | Every plan and uploaded schedule with status, forecast vs required dates and alerts |
| GET | `/api/plans` | read-only | Plans with readiness, finish and activity count |
| GET | `/api/plans/{id}` | read-only | Full plan: answers, generated schedule (activities, logic, CPM dates and float), evaluation, recovery options |
| GET | `/api/plans/{id}/risk` | read-only | Monte Carlo schedule risk analysis (P50/P80, criticality, sensitivity) |
| GET | `/api/plans/{id}/export?format=xer\|xml\|xlsx-import\|xlsx-p6\|pdf\|csv\|md` | read-only | Export file (formats your plan includes) |
| GET | `/api/schedules` | read-only | Uploaded schedules; `?id=` for one schedule with activities, logic and metrics |
| GET | `/api/schedules/{id}/quality` | read-only | DCMA 14-point assessment (your organization's thresholds) and data questions, plus the reviewer dispositions (`review`) |
| GET | `/api/schedules/{id}/review` | read-only | Reviewer dispositions of an uploaded submission: per DCMA finding / data question and overall |
| GET | `/api/schedules/{id}/export?format=xer\|xml\|csv\|xlsx-p6\|xlsx-import\|lookahead-xlsx\|original` | read-only | Export an uploaded schedule. A P6 upload exports as its original XER with Planora's recalculated dates and float (codes, UDFs, resources kept); add `&rebuild=1` for a fresh XER. `lookahead-xlsx` is the 3-week look-ahead (work in progress or starting within 21 days of the data date). XLSX files carry a Provenance sheet (source file, SHA-256, release, progress mode, settings, data date) |
| GET | `/api/schedules/{id}/edits` | read-only | Edits made in Planora to an uploaded schedule (duration, relationship, constraint), each with before/after, reason, author and date. Adding (`POST`, reason required) and reverting (`DELETE ?editId=&reason=`) need a signed-in owner, admin or scheduler |
| GET | `/api/schedules/{id}/recovery` | read-only | What-if / recovery options modeled on the schedule's own network (crash, overlap FS→SS+lag, expedite), each with its new finish, float effect and the edits that apply it |
| GET | `/api/schedules/{id}/risk` | read-only | Monte Carlo risk analysis of an uploaded schedule, using the scheduler's three-point ranges and risk events (`PUT`, signed-in scheduler) over the rule-based ranges |
| GET | `/api/schedules/compare?id=…&base=…[&format=csv\|xlsx]` | read-only | Update-to-update comparison; without `base`, the latest upload of the project with an earlier data date. `format=csv` downloads the activity-level differences, `format=xlsx` a workbook with a sheet per change category. Comparing a schedule with itself (same id or identical file) is `400` (`same_schedule`) |
| GET | `/api/schedules/windows?id=…[&format=csv\|xlsx]` | read-only | Windows analysis of the update series `id` belongs to: per consecutive pair, data dates, finish-milestone movement, driving-path start/end and the movement split into progress, added/deleted activities and revisions (logic, durations, constraints, calendars) by half-step recalculation; plus the finish-float / BEI trend |
| PATCH | `/api/plans/{id}` | scheduler | Record interview answers: `{ "answers": { "<questionId>": { "status": "known", "value": … } } }`. An invalid value (e.g. an option that is not listed) returns `400` with code `invalid_answer` and `errors` per question naming the valid options; nothing is saved. Yes/no questions accept `true`/`false` (or `"yes"`/`"no"`). |
| POST | `/api/plans/{id}/generate` | scheduler | Generate or regenerate the schedule |

### Errors

- A key used on any other endpoint gets `403` with code `api_key_not_allowed`.
- An unknown, expired or revoked key gets `401` with code `invalid_api_key`.
- Every error response includes a `requestId`. Quote it when you contact support.

## Webhooks

- Add an HTTPS endpoint and pick the events you want (`GET /api/org/integrations` lists them).
- Endpoints that resolve to private or internal network addresses are refused.
- Planora `POST`s JSON within seconds of the event and does not follow redirects.
- After 20 consecutive failed deliveries the endpoint is disabled; re-enable it from the same screen.
- "Send test" sends a `webhook.test` event.

| Event | When |
|---|---|
| `plan.created` | A plan was created |
| `plan.generate` | A schedule was generated or regenerated |
| `plan.publish` | A plan was published as a baseline schedule |
| `plan.review` | An expert review was recorded |
| `plan.recovery` | A recovery option was applied |
| `plan.deleted` | A plan was deleted |
| `schedule.upload` | A schedule file was uploaded |
| `schedule.delete` | An uploaded schedule was deleted |
| `member.joined` | A member joined the organization |
| `member.removed` | A member was removed |

Payload:

```json
{ "id": "…", "event": "plan.publish", "occurredAt": "2026-10-04T08:00:00.000Z", "organizationId": "org_…",
  "data": { "targetType": "plan", "targetId": "…", "detail": { "plan": "Riverside MOB", "version": 7 }, "actor": "ana@firm.com" } }
```

Headers:
- `X-Planora-Event`: the event name.
- `X-Planora-Delivery`: a unique id; use it to ignore duplicates.
- `X-Planora-Signature: t=<unix seconds>,v1=<hex>`.

### Verifying the signature

Recompute `HMAC-SHA256(secret, "<t>.<raw body>")` and compare it in constant time. Reject requests whose `t` is more than 5 minutes old.

```js
import crypto from 'node:crypto'
function verify(secret, rawBody, header) {
  const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header) || []
  if (!t || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1))
}
```

The signing secret (`whsec_…`) is shown once when you add the endpoint.

## Operator settings (environment variables)

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` or `POSTMARK_TOKEN`, plus `EMAIL_FROM` | Turns on email: confirmation links for self sign-up and emailed invitations. Without them nothing is sent and email confirmation is not enforced |
| `APP_URL` | Public URL used in emailed links (defaults to the request's origin) |
| `PLANORA_ALERT_WEBHOOK_URL` | Slack/Teams incoming webhook for platform security alerts (lockouts, MFA disabled, ownership/SSO/role changes, organization exports, new API keys, failed audit verification) |
| `PLANORA_ALLOW_INSECURE_WEBHOOKS=1` | **Tests only.** Allows `http://` and local webhook targets |
| `PLANORA_EMAIL_OUTBOX=<dir>` | **Tests only.** Writes emails to a folder instead of sending them |
