# Backup and recovery

## Objectives

| Tier | Scope | RPO (max data loss) | RTO (max downtime) |
|---|---|---|---|
| Application | Vercel deployment | 0 (code is in git) | 15 minutes (Instant Rollback or redeploy) |
| Database | Neon PostgreSQL | ≤ 5 minutes (point-in-time recovery within the plan's history window) | 2 hours |
| Off-provider copy | Nightly encrypted dump (GitHub Actions) | 24 hours | 4 hours |

## Backups
1. **Primary: Neon point-in-time recovery.** Neon keeps a write-ahead log history; restore to any second inside the plan's history window, as a new branch. Confirm the window in the Neon console (Settings → Storage).
2. **Secondary: nightly logical backup** (`.github/workflows/backup.yml`). It runs `scripts/backup.mjs` (pg_dump with a SHA-256 manifest, row counts and audit-chain heads), **restores it into a scratch database and verifies it** (`scripts/restore-drill.mjs`), then encrypts it (AES-256) and keeps it for 35 days.
   - To enable it, add the repository secrets `BACKUP_DATABASE_URL` (a read-only role) and `BACKUP_PASSPHRASE`.
   - Production runs on Neon **PostgreSQL 17** (project `planora-db`, region us-east-1 / iad1, created through the Vercel Neon integration under support@hoshmand.ai on 10/04/2026). `pg_dump` refuses to dump a newer server than itself, so the workflow installs the PostgreSQL 17 client tools (`PG_BIN`) and restores into a `postgres:17` scratch server. CI uses the same version.
   - Create the read-only role in the Neon SQL Editor (replace the password; never commit it):
     ```sql
     CREATE ROLE backup_reader WITH LOGIN PASSWORD '<long random password>';
     GRANT CONNECT ON DATABASE neondb TO backup_reader;
     GRANT USAGE ON SCHEMA public TO backup_reader;
     GRANT SELECT ON ALL TABLES IN SCHEMA public TO backup_reader;
     GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO backup_reader;
     ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public GRANT SELECT ON TABLES TO backup_reader;
     ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public GRANT SELECT ON SEQUENCES TO backup_reader;
     ```
3. **Every pull request** runs the same backup and restore drill against the CI database, so the procedure itself can't silently break.

## Restore procedures
**Neon point-in-time recovery:**
1. In Neon, choose Branches → Restore, and pick the timestamp before the incident.
2. Create the branch and copy its connection string.
3. In Vercel, update `DATABASE_URL` (Production) and redeploy.
4. Check `/api/health` and the audit-log integrity check.
5. Record the incident.

**From a nightly dump:**
1. Download the artifact.
2. Decrypt it: `gpg -d file.dump.gpg > file.dump`.
3. Restore it: `pg_restore --no-owner --dbname=<new db> file.dump`.
4. Run `ADMIN_DATABASE_URL=… node scripts/restore-drill.mjs file.dump` to verify counts and audit chains.
5. Point `DATABASE_URL` at the new database.

**Application:** Vercel → Deployments → choose the last good deployment → Instant Rollback.
- Migrations are additive: a rollback runs older code against a newer schema safely, because the code only ignores the new columns.

## Drill record
| Date | Type | Data size | Restore time | Result |
|---|---|---|---|---|
| 10/04/2026 | Local drill of a 577 KB dump (7,047 rows) | 577 KB | 0.2 s | Pass: counts match; tamper detected in the one chain deliberately altered by the security test |
