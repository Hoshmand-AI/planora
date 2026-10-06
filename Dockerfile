# syntax=docker/dockerfile:1
#
# Planora on-premises / air-gapped image. See docs/operations/ON-PREM-INSTALL.md.
#
#   docker build -t planora:<version> .
#
# Build on a connected build host (npm packages and the bundled web fonts are downloaded at build
# time), then move the image into the enclave with `docker save` / `docker load`. At runtime the app
# makes no outbound connections except to the database and, if configured, an on-prem model host.
#
# Stages:  deps → build → runtime (default; non-root, Next.js standalone server)
#          ops  (optional; PostgreSQL 17 client tools + Node for scripts/backup.mjs and the restore drill)

ARG NODE_IMAGE=node:22-bookworm-slim
ARG POSTGRES_IMAGE=postgres:17-bookworm

# ── 1. Dependencies, installed exactly from package-lock.json ──────────────────────────────────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 npm_config_fund=false npm_config_audit=false
COPY package.json package-lock.json ./
RUN npm ci

# Runtime-only dependencies for the ops image (pg for the backup / restore scripts).
FROM ${NODE_IMAGE} AS deps-prod
WORKDIR /app
ENV npm_config_fund=false npm_config_audit=false
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# ── 2. Production build (standalone output) ────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production PLANORA_STANDALONE=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# JWT_SECRET is only needed so the build can evaluate server modules; it is not used at runtime and
# is not kept in the image (the runtime stage starts clean). Set the real secret at run time.
RUN JWT_SECRET=build-time-placeholder-not-used-at-runtime npm run build \
 && node scripts/sbom.mjs --output /app/sbom.cdx.json

# ── 3. Runtime: non-root, read-only friendly ───────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime
LABEL org.opencontainers.image.title="Planora" \
      org.opencontainers.image.description="Planora schedule planning and analysis (on-premises build)" \
      org.opencontainers.image.vendor="Hoshmand AI" \
      org.opencontainers.image.source="https://github.com/Hoshmand-AI/planora"
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    PLANORA_DEPLOYMENT=onprem \
    PLANORA_AI_MODE=offline
RUN groupadd --system --gid 10001 planora \
 && useradd --system --uid 10001 --gid planora --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin planora
# Application files stay owned by root (the app user can't modify its own code); only the Next.js
# cache directory is writable.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/sbom.cdx.json /app/sbom.cdx.json
RUN mkdir -p /app/.next/cache && chown planora:planora /app/.next/cache
USER planora:planora
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]

# ── Optional: operations image (backups and the restore drill) ─────────────────────────────────
#   docker build --target ops -t planora-ops:<version> .
FROM ${POSTGRES_IMAGE} AS ops
COPY --from=deps-prod /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=deps-prod /app/node_modules ./node_modules
COPY package.json ./
COPY scripts ./scripts
ENV PG_BIN=/usr/lib/postgresql/17/bin
USER postgres
ENTRYPOINT []
CMD ["node", "scripts/backup.mjs", "/backups"]
