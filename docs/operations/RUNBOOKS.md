# Runbooks

## Deploy
Merge a green pull request into `main`; Vercel builds and deploys production. Confirm the deployment is **Ready** and `GET /api/health` returns `"status":"ok"` with `schema.current: true`.

## Roll back
Vercel → Deployments → last good deployment → **Instant Rollback**.

Database migrations only add things, so older code keeps working with the newer schema. One known effect: accounts created by the pre-roles code during a rollback get the `viewer` role in their own new organization. After rolling forward, fix them with:

```sql
UPDATE users u SET role='owner' WHERE role='viewer'
  AND NOT EXISTS (SELECT 1 FROM users x WHERE x.org_id=u.org_id AND x.role='owner');
```

## Database migrations
Migrations live in `src/lib/migrations.ts`. They are numbered, checksummed, applied in order, one transaction each, under an advisory lock, on the first request after a deploy. Never edit a shipped migration; add a new one.
- Check: `/api/health` → `checks.schema`.
- Logs: `migration applied` lines; `migration checksum drift` warnings mean a shipped migration was edited.

## Authentication problems
| Symptom | Action |
|---|---|
| A user is locked out (`auth.locked`) | An admin clicks **Unlock** (Organization → Members), or wait 15 minutes |
| A user lost their 2-step device | They use a recovery code. If they have none, an admin removes them and invites them again. Operators can clear MFA with `UPDATE users SET mfa_secret=NULL, mfa_enabled_at=NULL, mfa_recovery='[]' WHERE email=…`; log it in the incident issue |
| SSO fails for everyone (`auth.sso_failed`) | Check the provider: client secret expiry (Entra secrets expire), the redirect URI, issuer discovery. Owners can still use password sign-in |
| Everyone is signed out | `JWT_SECRET` changed. This is expected after a rotation |

## AI problems
| Symptom | Action |
|---|---|
| "AI analysis temporarily unavailable" | Provider outage or key problem. Scheduling still works. Check `ai.request` events with `ok:false` |
| Daily limit reached | The organization's admin raises **AI requests per day** within the plan limit |
| Need to stop all AI immediately | Set `PLANORA_AI_MODE=offline` in Vercel and redeploy, or have organizations switch AI off |
| Model change | Follow docs/ai/MODEL-REGISTRY.md (evaluation, then `PLANORA_APPROVED_MODELS` / `LLM_MODEL`) |

## Database outage
1. `/api/health` returns 503 and the uptime probe opens an incident.
2. Check the Neon status page and console (compute suspended? storage full?).
3. If data is corrupted, follow BACKUP-AND-RECOVERY.md (point-in-time restore to a new branch, then switch `DATABASE_URL`).

## Security event
Follow INCIDENT-RESPONSE.md. Useful queries:
- recent failed sign-ins: `SELECT at, actor_email, ip FROM audit_events WHERE action IN ('auth.signin_failed','auth.locked') ORDER BY seq DESC LIMIT 100`
- exports by a user: `… WHERE action='plan.export' AND actor_email=…`

## Change an organization's plan
`DATABASE_URL=… node scripts/set-plan.mjs <org id | member email> <free|pro|enterprise> "reason"`. The change is recorded in that organization's audit log.

## Secrets
| Name | Purpose | Rotation |
|---|---|---|
| `JWT_SECRET` | Signs session and challenge tokens | Yearly, or after an incident. Signs everyone out |
| `PLANORA_ENCRYPTION_KEY` | Encrypts MFA and SSO secrets (falls back to `JWT_SECRET`) | Rotating it requires re-enrolling MFA and re-entering SSO secrets |
| `DATABASE_URL` | Database | Rotate the password in Neon, update it in Vercel, redeploy |
| `OPENAI_API_KEY` | Cloud AI | Yearly, or after an incident |
