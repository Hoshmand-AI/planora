# Enterprise risk register

Scored 1–5 for likelihood (L) and impact (I). Reviewed monthly by the founder.

| # | Risk | L | I | Controls in place | Next action | Owner |
|---|---|---|---|---|---|---|
| R1 | Cross-tenant data exposure | 1 | 5 | Org scoping; RBAC route guard test; two-firm e2e on every change | Pen test (POA&M #1) | Eng |
| R2 | Account takeover | 2 | 4 | Password policy, lockout, MFA/SSO, revocable sessions, audit | Email verification (POA&M #2) | Eng |
| R3 | Data loss | 1 | 5 | Neon PITR; nightly verified off-provider backup (once secrets set); restore drill in CI | Enable backup secrets (POA&M #4) | Founder |
| R4 | Wrong schedule output relied on contractually | 3 | 4 | Deterministic CPM tests; DCMA tests; explainability; disclaimers; human review/approval policies | Independent P6 parity validation (POA&M #11) | Product |
| R5 | AI hallucination in reports | 3 | 3 | AI can't set schedule data; computed facts in prompts; golden prompts; org AI switch | Monthly golden-prompt run | Product |
| R6 | AI cost runaway / abuse | 2 | 3 | Per-org daily quota, per-user rate limit, plan caps | Provider spend cap in the Anthropic Console (or OpenAI dashboard if selected); `estimatedCostUsd` on `ai.request` audit events | Founder |
| R7 | Vulnerable dependency | 3 | 3 | Dependabot, npm audit gate, CodeQL, Semgrep, SLAs | — | Eng |
| R8 | Outage undetected | 2 | 3 | 15-min uptime probe → incident issue | Log drain + alerting (POA&M #3) | Eng |
| R9 | Unreviewed risky change reaches prod | 2 | 4 | Required CI gates; CODEOWNERS for sensitive paths | Turn on code-owner review (POA&M #5) | Founder |
| R10 | Key-person dependency | 4 | 4 | Runbooks, docs, infrastructure as code | Second admin on Vercel/Neon/GitHub | Founder |
| R11 | Legal/contract exposure | 3 | 4 | Terms with planning-support disclaimer; privacy policy | Counsel review, insurance (POA&M #8–9) | Founder |
| R12 | No validated customer outcomes | 4 | 4 | Firm-history backtest in product | Paid pilots (POA&M #12) | Founder |

## Company KPIs (reviewed monthly)
- **Product:** import success rate, time to first schedule, weekly active schedulers.
- **Quality:**
  - CPM parity defects;
  - DCMA false-positive / false-negative rates;
  - export round-trip defects.
- **AI:** `ai.request` failure rate, cost per active project, golden-prompt pass rate.
- **Security:** age of open high/critical vulnerabilities, MFA/SSO coverage, `auth.locked` rate.
- **Reliability:** availability, p95 latency, restore-drill success.
- **Business:** pilot conversion, retention, sales cycle.
