# Change management

## How a change reaches production
1. **Branch + pull request:** every change goes through a pull request to `main`. Nobody pushes directly.
2. **Automated gates:** the pull request must pass every required check:
   - `check`: typecheck, unit tests including the access-control route guard, build, dependency audit, SBOM;
   - `e2e`: the real app on PostgreSQL, the security suite, the backup and restore drill, accessibility;
   - `sast`: Semgrep;
   - CodeQL;
   - the Vercel preview deployment.
3. **Review:**
   - **Standard changes** (features, fixes, docs): may be merged by the change author after all gates pass. This includes the AI coding assistant working under the owner's standing instruction in `CLAUDE.md`.
   - **Security-sensitive changes** are the paths listed in `.github/CODEOWNERS`: authentication, sessions, permissions, the audit log, crypto, migrations, SSO, CI and deployment configuration. When code-owner review is required on `main` (branch-protection setting), these need an approving review from a code owner other than the author before merging.
4. **Deploy:** merging into `main` deploys to production (Vercel). The deployment is checked as Ready and healthy, and the change is summarized for the owner.
5. **Rollback:** Vercel Instant Rollback (see RUNBOOKS.md).

## Records
- Every production change is a merge commit on `main` linked to its pull request, with CI results and the Vercel deployment.
- Changes made by the AI assistant are labelled in the commit trailer and in the PR description.

## Turning on code-owner review (owner decision)
GitHub → Settings → Branches → Branch protection for `main`:
- **Require status checks to pass:** `check`, `e2e`, `sast`, `analyze` (CodeQL).
- **Require review from Code Owners:** this adds independent human approval for security-sensitive changes. Standard changes keep merging automatically after the gates pass.
