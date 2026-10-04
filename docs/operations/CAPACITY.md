# Capacity envelope

Measured 10/04/2026 on a CI-class Linux container (Node.js 22). Budgets are enforced by `src/lib/planning/perf.test.ts` on every change.

| Workload | Measured | Budget (fails CI if exceeded) |
|---|---|---|
| CPM, 10,000 activities / 11,920 relationships | 0.10 s | 2 s |
| CPM, 50,000 activities / 59,600 relationships | 0.37 s | 8 s |
| CPM, 100,000 activities / 119,200 relationships | 0.88 s | 15 s |
| Monte Carlo risk analysis, ~100-activity plan, 1,000 iterations | 0.7 s | 20 s (unit test) |

**Supported limits:**
- Uploaded files: 25 MB.
- Schedules: up to 100,000 activities per schedule.
- Monte Carlo iterations: reduced automatically for large networks, with a minimum of 200.

The web tier is stateless: sessions, rate limits and locks live in PostgreSQL, so Vercel functions scale horizontally. Database connections: up to `PG_POOL_MAX` (default 10) per instance; use Neon's pooled connection string in production.
