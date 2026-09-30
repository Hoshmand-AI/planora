# Planora — notes for Claude sessions

## Shipping changes (standing instruction from the owner)
The owner has asked Claude to ship without waiting on them:
1. Develop on a branch, then open a PR to `main`.
2. Wait for the **CI** workflow (typecheck, tests, build) and the **Vercel** preview deployment to pass on the PR's latest commit.
3. If both are green and there are no merge conflicts or unresolved review comments, **merge the PR yourself** (merge commit). Vercel then deploys `main` to production.
4. After merging, confirm the production deployment is Ready, and report what shipped in plain language.
5. If CI or the preview fails, fix and push; never merge a red PR, and never skip or disable tests to get green.
Rollback: Vercel → Deployments → Instant Rollback.

## Checks
`npm run typecheck`, `npm test`, `npm run build`; end-to-end: `BASE_URL=… node scripts/e2e-smoke.mjs` against a running server with Postgres.

## Conventions
See README.md (Tailwind v3 only, raw SQL via `pg`, all firm data scoped by `org_id`, dates shown MM/DD/YYYY via `src/lib/format.ts`).
