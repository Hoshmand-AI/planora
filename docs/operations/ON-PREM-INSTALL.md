# On-premises and air-gapped installation

_Last updated 10/06/2026._

This guide is for customers who run Planora inside their own network: federal and defense
contractors handling Controlled Unclassified Information (CUI), firms that need EU or Canadian data
residency, and enterprises that don't use the hosted service. It covers the container deliverable
(`Dockerfile`, `docker-compose.yml`), every setting the application reads, TLS, backups, upgrades,
hardening, and what support exists today.

Planora's commercial cloud service is not authorized for CUI (see
[../security/CUI-HANDLING.md](../security/CUI-HANDLING.md)). An on-premises instance runs inside
your boundary, under your controls. How Planora's own controls map to NIST SP 800-171 is in
[../security/NIST-800-171-MAPPING.md](../security/NIST-800-171-MAPPING.md).

## 1. What you get

| File | What it is |
|---|---|
| `Dockerfile` | Multi-stage build. The default `runtime` target is a Node.js 22 image running the Next.js standalone server as a non-root user (uid 10001), with a health check. The `ops` target adds the PostgreSQL 17 client tools for backups and restore drills. |
| `docker-compose.yml` | Reference deployment: PostgreSQL 17 with a named volume and a health check, the app, and on-demand `backup` and `restore-drill` services. |
| `.env.onprem.example` | The settings Compose needs. Copy it to `.env` and fill in the secrets. |
| `scripts/backup.mjs`, `scripts/restore-drill.mjs` | The same backup and verified-restore procedure that CI runs on every change. |
| `scripts/sbom.mjs` (`npm run sbom`) | CycloneDX 1.5 software bill of materials built offline from `package-lock.json`. The runtime image also contains it at `/app/sbom.cdx.json`. |

The application code is the same build as the hosted service. On-premises behaviour is selected
only by environment variables (section 4).

## 2. Requirements

| Item | Minimum | Notes |
|---|---|---|
| Host OS | 64-bit Linux (x86-64 or arm64) that runs Docker Engine 24+ with Compose v2 | A hardened baseline such as the DISA STIG or CIS benchmark for your distribution is recommended (section 8) |
| CPU / memory | 2 vCPU, 4 GB RAM for the app and database together, for a pilot of tens of users | CPM on a 100,000-activity schedule takes about 1 s ([CAPACITY.md](CAPACITY.md)). Add CPU for many concurrent Monte Carlo runs |
| Disk | 20 GB for images and the database volume, plus backup space | Uploaded original files (up to 25 MB each) are kept in the database for chain of custody |
| Database | PostgreSQL 17 (bundled in Compose) | Any PostgreSQL 14+ works if you run your own; backups need client tools of the server's major version or newer |
| TLS | A reverse proxy or load balancer you operate (nginx, HAProxy, Apache, F5, …) | The app serves plain HTTP on port 3000 and must sit behind TLS (section 5) |
| Build host | Internet access to npm and Google Fonts, **only when building the image** | The enclave itself needs no internet access |
| AI model (optional) | An OpenAI-compatible server inside your network (Ollama, vLLM, llama.cpp server, TGI) | Default is no model at all: every scheduling feature works without one |

Without Docker you can run the same build with Node.js 22 (`npm ci && npm run build && npm start`)
against your own PostgreSQL. The settings are identical.

## 3. Install

**On a connected build host:**

```bash
git clone <your Planora source or release bundle> planora && cd planora
git checkout <release commit>
docker build -t planora:<version> .                 # app image
docker build --target ops -t planora-ops:<version> .  # backup / restore tools
node scripts/sbom.mjs --output planora-<version>.cdx.json   # SBOM for your records (no network needed)
docker save planora:<version> planora-ops:<version> postgres:17 | gzip > planora-<version>-images.tar.gz
sha256sum planora-<version>-images.tar.gz > planora-<version>-images.tar.gz.sha256
```

The web fonts are fetched once by `next build` and bundled into the image. Nothing is downloaded
at runtime.

**Inside the enclave:**

```bash
sha256sum -c planora-<version>-images.tar.gz.sha256
gunzip -c planora-<version>-images.tar.gz | docker load
cp .env.onprem.example .env && chmod 600 .env
# Fill in POSTGRES_PASSWORD, JWT_SECRET, PLANORA_ENCRYPTION_KEY (openssl rand -base64 48 for each),
# APP_URL (the HTTPS address users will open) and PLANORA_VERSION=<version>.
docker compose up -d
docker compose ps        # app and db should become "healthy"
curl -s http://127.0.0.1:3000/api/health
```

The first request creates the database schema (section 7). Then:

1. Open `APP_URL` in a browser and sign up. On an empty instance the first account creates the
   organization and becomes its **owner**. With `PLANORA_SIGNUP=invite_only` (the Compose default)
   every later account needs an invitation from an admin, or single sign-on into a verified domain.
   Create the owner account before you open the instance to users.
2. Under **Organization**: turn on **Require two-step verification**, set the session idle timeout,
   invite members with the least role they need, and configure single sign-on if you use it.
3. If you handle multiple clients or matters, create **Workspaces** under Organization and wall them
   off (the "Workspaces" section of [../security/NIST-800-171-MAPPING.md](../security/NIST-800-171-MAPPING.md)
   explains the model).
4. Set the plan for your organization according to your licence:
   `docker compose run --rm --entrypoint node backup scripts/set-plan.mjs <owner email> enterprise "licence <ref>"`
   (the change is written to the audit log), or set `PLANORA_DEFAULT_PLAN` before the first sign-up.

## 4. Configuration reference

These are all the environment variables the application and its scripts read (collected from
`process.env` in `src/`, `scripts/` and `next.config.js`).

### Required

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string. Compose builds it from `POSTGRES_PASSWORD`. |
| `JWT_SECRET` | Signs session cookies. The app refuses to authenticate in production without it. 64+ random characters. Rotating it signs everyone out. |
| `PLANORA_ENCRYPTION_KEY` | AES-256-GCM key material for secrets stored in the database (MFA seeds, SSO client secret, webhook secrets). Defaults to a key derived from `JWT_SECRET`. Set it once, before anyone enrolls in two-step verification: changing it later makes stored MFA and SSO secrets unreadable (members re-enroll). |
| `APP_URL` | Public HTTPS origin used in invitation and verification links, e.g. `https://planora.example.internal`. |
| `PLANORA_DEPLOYMENT` | `onprem` (set in the image). Marks the instance as customer-hosted, which removes the "do not store CUI in the commercial cloud" warning. |

### Database

| Variable | Default | Purpose |
|---|---|---|
| `PGSSLMODE` | (TLS on) | `disable` turns TLS to the database off. Compose sets it because app and database share a private Docker network on one host. For a database on another host, leave it unset: TLS is then always verified (certificate and host name). |
| `PGSSLROOTCERT` | — | Path to a private CA certificate for the database's TLS certificate. |
| `PG_POOL_MAX` | 10 | Connections per app instance. |
| `ADMIN_DATABASE_URL` | — | `scripts/restore-drill.mjs` only: a role that may create and drop the scratch database. |
| `PG_BIN` | — | `scripts/backup.mjs` / `restore-drill.mjs`: directory of `pg_dump` / `pg_restore` (set in the ops image). |
| `KEEP_RESTORE` | — | `restore-drill.mjs`: `1` keeps the scratch database for inspection. |
| `ALLOW_BROKEN_CHAINS` | — | `restore-drill.mjs`: pass even if some audit chains were already broken before the backup (CI, where the security test tampers with one on purpose). Never use it for a production drill. |

### AI

| Variable | Default | Purpose |
|---|---|---|
| `PLANORA_AI_MODE` | `offline` in the image | `offline` (no model), `local` (an OpenAI-compatible server in your network) or `cloud` (Anthropic by default, or OpenAI with `PLANORA_AI_PROVIDER=openai`; sends request content to that provider; not for CUI). |
| `PLANORA_AIRGAPPED` | `true` in Compose | Refuses cloud AI and any model host that is not loopback, private-network, `*.local`, `*.internal`, or listed in `PLANORA_ALLOWED_HOSTS`. |
| `LLM_BASE_URL` | — | Local model endpoint, e.g. `http://gpu01.enclave.internal:11434/v1`. |
| `LLM_MODEL` | `llama3.1:8b` (local) | Model name. Must be in the approved list. |
| `LLM_API_KEY` | — | Key for the local endpoint, if it needs one. |
| `PLANORA_ALLOWED_HOSTS` | — | Extra on-prem model host names allowed in air-gapped mode (comma-separated). |
| `PLANORA_APPROVED_MODELS` | list in [../ai/MODEL-REGISTRY.md](../ai/MODEL-REGISTRY.md) | Comma-separated registry; any other model is refused. |
| `PLANORA_AI_DAILY_LIMIT` | 300 | Ceiling on each organization's AI requests per day. |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `PLANORA_AI_PROVIDER` | — | Cloud mode only. Leave unset on CUI instances. |

Organizations also have their own AI switch (off by default for new organizations) under
Organization → Policies. Projects marked CUI or classified are never sent to a model outside your
network, whatever these settings say ([../security/CUI-HANDLING.md](../security/CUI-HANDLING.md)).

### Accounts and access

| Variable | Default | Purpose |
|---|---|---|
| `PLANORA_SIGNUP` | `open`; `invite_only` in Compose | `invite_only`: after the first account, sign-up requires an invitation (SSO into a verified domain still provisions members). |
| `PLANORA_DEFAULT_PLAN` | `free` | Plan for organizations created from now on (`free`, `pro`, `enterprise`); see `src/lib/server/entitlements.ts`. Change an existing organization with `scripts/set-plan.mjs`. |
| `NODE_EXTRA_CA_CERTS` | — | Standard Node.js setting: a PEM bundle of private CAs to trust for an on-prem OpenID Connect provider or model host over HTTPS. |
| `PLANORA_ALLOW_INSECURE_OIDC` | — | Tests only: allows `http://` identity providers and skips DNS domain verification. Never set in production. |

### Email, alerts and webhooks

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` / `POSTMARK_TOKEN` | Cloud email providers. **Usually not reachable from an enclave.** Without a provider nothing is emailed: invitation links are shown to the admin to pass on, and email verification is reported as unavailable instead of blocking anyone. There is no SMTP option today. |
| `EMAIL_FROM` | Sender address when a provider is set. |
| `PLANORA_EMAIL_OUTBOX` | Tests only: writes emails as JSON files to a folder. |
| `PLANORA_ALERT_WEBHOOK_URL` | Security alerts (lockouts, MFA turned off, role/SSO/ownership changes, organization exports, new API keys, failed audit verification). Webhook and alert destinations must be public HTTPS addresses (private and internal addresses are refused to prevent SSRF), so inside an enclave leave this unset: each alert is then written to the application log as a `security alert` line that your log collector can forward. |
| `PLANORA_ALLOW_INSECURE_WEBHOOKS` | Tests only: allows `http://` and private webhook destinations. Never set in production. |

### Runtime and diagnostics

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `HOSTNAME` | 3000 / 0.0.0.0 | Listening port and address inside the container. |
| `NODE_ENV` | `production` | Must be `production` (secure cookies, strict CSP, required secrets). |
| `PLANORA_RELEASE` | `local` | Release label shown by `/api/health`. Compose sets it to `PLANORA_VERSION`. |
| `PLANORA_DEBUG` | — | Enables debug log lines. |
| `PLANORA_STANDALONE` | — | Build time only: `1` makes `next build` produce the standalone server the image uses. The hosted (Vercel) build doesn't set it. |
| `VERCEL_GIT_COMMIT_SHA` | — | Set by Vercel on the hosted service only. |
| `BASE_URL`, `OIDC_ISSUER`, `WEBHOOK_RECEIVER_PORT`, `LLM_LOG`, `FULL_PAGE`, `SCREENSHOTS` | — | End-to-end and accessibility test scripts only. |

## 5. TLS termination

The container speaks plain HTTP and Compose publishes it on `127.0.0.1:3000` only. Put a TLS reverse
proxy in front of it, on the same host or in your DMZ:

- TLS 1.2 or 1.3 only, with your organization's approved cipher suites (FIPS-approved suites if you
  need them: the proxy is where FIPS-validated TLS can be provided; see the 800-171 mapping, 3.13.11).
- Forward `Host`, `X-Forwarded-For` and `X-Forwarded-Proto`; the app uses `X-Forwarded-For` for the
  audit log and rate limits, and `Host` / `X-Forwarded-Host` for its cross-site write check.
- Allow request bodies of at least 26 MB (uploads are limited to 25 MB by the app).
- Allow at least 120 s read timeouts if you use a local model (`local` mode waits up to 120 s).
- The app already sends HSTS, CSP and the other security headers. Session cookies are `Secure`, so
  the instance only works over HTTPS.

Minimal nginx example:

```nginx
server {
  listen 443 ssl;
  server_name planora.example.internal;
  ssl_certificate     /etc/pki/planora/fullchain.pem;
  ssl_certificate_key /etc/pki/planora/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  client_max_body_size 26m;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
    proxy_read_timeout 180s;
  }
}
```

Set `X-Forwarded-For` to the client address as above (don't append a client-supplied header), so a
client can't spoof the address recorded in the audit log.

## 6. Backups and restore

The procedure is the one in [BACKUP-AND-RECOVERY.md](BACKUP-AND-RECOVERY.md), which CI runs on every
change: `scripts/backup.mjs` writes a `pg_dump` (custom format) plus a manifest with its SHA-256,
per-table row counts, the schema migration and every organization's audit-chain head;
`scripts/restore-drill.mjs` restores it into a scratch database and checks all of them, including
that every audit hash chain still verifies.

```bash
mkdir -p backups && sudo chown 999:999 backups        # the ops image runs as the postgres user
docker compose --profile ops run --rm backup           # → backups/planora-<timestamp>.dump + .manifest.json
docker compose --profile ops run --rm restore-drill /backups/planora-<timestamp>.dump
```

- **Schedule it** (cron or a systemd timer) at least daily, and run the restore drill at least
  monthly. Record each drill in your own records.
- **Encrypt and move it off the host.** The dump is not encrypted. Encrypt it (for example
  `gpg --symmetric --cipher-algo AES256`) and copy it to backup media under your media-protection
  procedures. The hosted service does the same in `.github/workflows/backup.yml`.
- **Restore for real:** create an empty database, `pg_restore --no-owner --dbname=<new db> <dump>`,
  run the restore drill against the dump, then point `DATABASE_URL` at the restored database and
  restart the app. Check `/api/health` and Organization → Audit log → Verify integrity.
- Volume snapshots of `pgdata` are a useful addition but are only consistent if taken with the
  database stopped or with your storage's crash-consistent snapshot feature.

## 7. Upgrades and migrations

- **How migrations run:** the database schema is versioned in `src/lib/migrations.ts`. On the first
  database access after start-up, the app applies every pending migration in order, each in its own
  transaction, under a cluster-wide advisory lock (so several app instances can start at once), and
  records it in `schema_migrations` with a checksum. `/api/health` reports `schema.current`.
- **Migrations are additive** (new tables and columns only). The previous release keeps working
  against the newer schema, so rolling back the image is safe without restoring the database.
- **Upgrade steps:**
  1. Read the release notes for the target commit.
  2. Take a backup and run the restore drill on it (section 6).
  3. `docker load` the new images, set `PLANORA_VERSION` in `.env`.
  4. `docker compose up -d app` and wait for `healthy`; `curl -s 127.0.0.1:3000/api/health` should
     show `"current": true` for the schema.
  5. To roll back, set the previous `PLANORA_VERSION` and `docker compose up -d app` again.
- Skipping releases is supported: all pending migrations are applied in order.
- PostgreSQL major-version upgrades (for example 17 → 18) are a database operation: back up,
  restore into the new major version, run the restore drill, then switch `DATABASE_URL`.

## 8. Hardening

**Network**
- Block all egress from the app container except to the database and, if used, the on-prem model
  host. The `backend` network in Compose is `internal` (no route out); the `edge` network that
  carries the published port is not, so add host firewall rules (the `DOCKER-USER` iptables chain or
  nftables) that drop outbound traffic from the app container, or run the host without a default
  route.
- Keep `PLANORA_AIRGAPPED=true`: it refuses any model host outside your private network even if
  someone misconfigures `LLM_BASE_URL`.
- Expose only the reverse proxy (443) to users. Don't publish the database port.

**Secrets**
- Generate `JWT_SECRET`, `PLANORA_ENCRYPTION_KEY` and `POSTGRES_PASSWORD` with a CSPRNG
  (`openssl rand -base64 48`); keep `.env` mode 600 and owned by root, or use Docker secrets / your
  secrets manager to inject them.
- Never set the `*_ALLOW_INSECURE_*` test flags or `ALLOW_BROKEN_CHAINS` in production.
- Rotating `JWT_SECRET` signs everyone out. Rotating `PLANORA_ENCRYPTION_KEY` requires members to
  re-enroll two-step verification and admins to re-enter the SSO client secret and webhook secrets.

**Containers**
- The app runs as a non-root user with a read-only root filesystem, all Linux capabilities dropped
  and `no-new-privileges` (Compose settings). Keep them.
- Pin images by digest in production (`docker images --digests`) and rebuild for security updates
  of the Node.js and PostgreSQL base images.
- Scan images with your scanner of choice and compare against the SBOM.

**Host and database**
- Apply your OS baseline (DISA STIG or CIS benchmark), time synchronization from your authoritative
  NTP source (audit timestamps come from the host clock), host-based audit logging, endpoint
  protection, and full-disk or volume encryption for the Docker data directory and backup media.
  Planora does not encrypt schedule content itself at the application layer; protection at rest is
  provided by your storage encryption.
- Collect the app's JSON logs (`docker logs`, or a log driver to your SIEM). Every line carries a
  request id; security alerts appear as `security alert` lines (section 4).
- Restrict who can run `docker` on the host: Docker access is root-equivalent and gives database
  access.

**In the application** (Organization screen): require two-step verification, set the idle timeout,
use single sign-on with your IdP's MFA, give members the least role they need, use workspaces with
walls for client separation, and review the audit log (it can be verified and exported as CSV).

## 9. Data residency

Planora's hosted service stores data in the United States only (Vercel iad1 and Neon us-east; see
[../privacy/SUBPROCESSORS.md](../privacy/SUBPROCESSORS.md)). There is **no hosted EU or Canadian
region**. Customers who need data to stay in the EU, Canada or any other jurisdiction can run this
on-premises or private-cloud deployment in a data centre or cloud region of their choice: the
application, database, backups and (optional) model all run where you put them, and the instance
makes no calls to Planora or any other outside service at runtime. Residency is then determined by
your hosting, not by Planora.

## 10. Versioning and support

What exists today, stated plainly:

- **Versions** are git commits on `main`; every commit there has passed the full CI suite (typecheck,
  unit tests, build, end-to-end against PostgreSQL 17, security checks, backup and restore drill,
  accessibility, SAST, CodeQL, dependency audit). There are no tagged release branches or long-term
  support lines yet; for an on-prem delivery we identify the exact commit and the image digest.
- **Compatibility:** schema migrations are additive and applied automatically, so any later commit
  upgrades any earlier one.
- **Security fixes:** our internal targets are in
  [../security/VULNERABILITY-MANAGEMENT.md](../security/VULNERABILITY-MANAGEMENT.md). On-premises
  customers receive fixes as a new image; applying it is the customer's change.
- **No phone-home and no licence server:** the instance keeps working without any connection to
  Planora.
- **Support channel:** support@hoshmand.ai. Planora is a single-founder company (see
  [../security/VENDOR-QUESTIONNAIRE.md](../security/VENDOR-QUESTIONNAIRE.md), section 9).

**To be agreed per contract** (no standard terms exist yet): support hours and response times,
service levels, release cadence and the support window for older versions, remote-access or
on-site assistance, escrow, licence terms and pricing.

## 11. Known limitations of the on-prem build

- No SMTP email: invitations are passed on by the admin (section 4).
- Webhooks and the alert channel can't target private addresses; use log forwarding for alerts.
- The image build needs internet access (npm, fonts); build outside the enclave and transfer it.
- No application-level encryption of schedule content at rest (use storage encryption).
- Cryptography uses Node.js's bundled OpenSSL; it has not been validated or tested in FIPS mode
  (see 3.13.11 in the [800-171 mapping](../security/NIST-800-171-MAPPING.md)).
- The standalone container build is not yet exercised in CI (CI builds and tests the regular
  `next build`). Run the health check and a smoke test after each image build.
