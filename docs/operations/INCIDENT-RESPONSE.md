# Incident response

## Severity
| Level | Definition | Examples | Response | Update cadence |
|---|---|---|---|---|
| SEV1 | Data exposure, security breach, or full outage | Cross-tenant data access, leaked credentials, database down | Immediately, all hands | Every 30 min |
| SEV2 | Major feature down or degraded for many users | Sign-in failing, uploads failing, 5xx > 5% | Within 1 hour | Every 2 h |
| SEV3 | Minor or single-customer impact | One export format broken, slow reports | Next business day | Daily |

## Roles
- **Incident lead:** coordinates, decides, and owns communication. Default: the founder.
- **Responder:** investigates and fixes (engineering).
- **Scribe:** keeps the timeline in the incident issue.

## Steps
1. **Detect:** an uptime issue (`incident` label), a customer report, a security report, or a CI/security alert. Open or adopt the GitHub issue and record the start time.
2. **Triage:** assign a severity and incident lead. For a suspected security incident, preserve evidence: export the audit log (Organization → Audit log → CSV) and keep the Vercel logs.
3. **Contain:**
   - roll back (Vercel → Instant Rollback);
   - revoke sessions (`UPDATE sessions SET revoked_at=NOW()` for affected users, or rotate `JWT_SECRET` to end every session);
   - rotate secrets: `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`, the database password, `PLANORA_ENCRYPTION_KEY` (MFA secrets would need re-enrollment);
   - switch AI off for affected organizations.
4. **Fix:** a pull request with a test that reproduces the problem; CI must be green.
5. **Communicate:** tell affected organization owners what happened, what data was involved, what we did and what they should do.
   - Where personal data is involved, notify customers without undue delay, and within 72 hours where law or contract requires.
6. **Recover:** confirm `/api/health` and audit-chain verification pass, and close the incident issue.
7. **Postmortem** (SEV1/SEV2 within 5 business days, blameless): timeline, root cause, what worked, and action items with owners. Store it in `docs/operations/postmortems/`.

## Contacts
- Security reports: security@hoshmand.ai.
- Customer notifications: organization owners' emails (Organization → Members).
- Vendors: Vercel support, Neon support, Anthropic support (or OpenAI support if that provider is selected).
