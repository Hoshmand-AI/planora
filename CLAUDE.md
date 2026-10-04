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
`npm run typecheck`, `npm test`, `npm run build`; end-to-end against a running server with Postgres: `scripts/e2e-smoke.mjs`, `scripts/e2e-security.mjs`, `scripts/a11y-check.mjs`, backup + `scripts/restore-drill.mjs` (CI runs all of them — see `.github/workflows/ci.yml` for the env).

## Security rules for changes
- Every API handler uses `api({ permission })` or `publicApi()` from `src/lib/server/api.ts` (enforced by `src/lib/server/routes.test.ts`).
- Schema changes: add a new numbered migration in `src/lib/migrations.ts`; never edit a shipped one; keep migrations additive (rollback safety).
- Record material actions with `audit()` from `src/lib/server/audit.ts`; never log secrets or prompt content.
- Change management: docs/operations/CHANGE-MANAGEMENT.md. If code-owner review is enabled on `main`, PRs touching `.github/CODEOWNERS` paths wait for the owner's approval instead of self-merging.

## Conventions
See README.md (Tailwind v3 only, raw SQL via `pg`, all firm data scoped by `org_id`, dates shown MM/DD/YYYY via `src/lib/format.ts`, text colors must keep WCAG AA contrast — use the `warm-*` tokens, not `text-white/40`-style faint text).
