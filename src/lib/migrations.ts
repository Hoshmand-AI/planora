// Versioned, ordered database migrations. Each runs once, in order, inside a transaction, and is
// recorded in schema_migrations with a checksum so drift is detectable. Never edit a migration that
// has shipped: add a new one. Migration 1 is the original schema (idempotent, so it is safe on
// databases created before migrations existed).

import { createHash } from 'crypto'

export interface Migration { id: number; name: string; sql: string }

export const MIGRATIONS: Migration[] = [
  {
    id: 1, name: 'baseline',
    sql: `    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      version TEXT,
      source_type TEXT,
      file_name TEXT,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      activity_count INTEGER DEFAULT 0,
      relationship_count INTEGER DEFAULT 0,
      project_start TEXT,
      project_finish TEXT,
      data_date TEXT,
      variance_days INTEGER,
      critical_count INTEGER DEFAULT 0,
      percent_complete NUMERIC DEFAULT 0
    );
    ALTER TABLE schedules ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
    ALTER TABLE schedules ADD COLUMN IF NOT EXISTS calendars JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE schedules ADD COLUMN IF NOT EXISTS default_calendar_id TEXT;
    ALTER TABLE schedules ADD COLUMN IF NOT EXISTS warnings JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE schedules ADD COLUMN IF NOT EXISTS plan_id TEXT;
    ALTER TABLE schedules ADD COLUMN IF NOT EXISTS project_type TEXT;
    ALTER TABLE schedules ADD COLUMN IF NOT EXISTS region TEXT;
    ALTER TABLE schedules ADD COLUMN IF NOT EXISTS gross_sqft NUMERIC;
    CREATE INDEX IF NOT EXISTS schedules_org_idx ON schedules(org_id);
    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
      activity_id TEXT,
      name TEXT,
      wbs TEXT,
      duration NUMERIC DEFAULT 0,
      remaining_duration NUMERIC DEFAULT 0,
      percent_complete NUMERIC DEFAULT 0,
      early_start TEXT, early_finish TEXT,
      late_start TEXT, late_finish TEXT,
      actual_start TEXT, actual_finish TEXT,
      baseline_start TEXT, baseline_finish TEXT,
      total_float NUMERIC DEFAULT 0,
      free_float NUMERIC DEFAULT 0,
      is_critical BOOLEAN DEFAULT false,
      status TEXT DEFAULT 'not_started',
      activity_type TEXT DEFAULT 'task'
    );
    ALTER TABLE activities ADD COLUMN IF NOT EXISTS calendar_id TEXT;
    ALTER TABLE activities ADD COLUMN IF NOT EXISTS constraint_type TEXT;
    ALTER TABLE activities ADD COLUMN IF NOT EXISTS constraint_date TEXT;
    ALTER TABLE activities ADD COLUMN IF NOT EXISTS category TEXT;
    ALTER TABLE activities ADD COLUMN IF NOT EXISTS source_id TEXT;
    CREATE INDEX IF NOT EXISTS activities_schedule_idx ON activities(schedule_id);
    CREATE TABLE IF NOT EXISTS relationships (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
      predecessor_id TEXT, successor_id TEXT,
      type TEXT DEFAULT 'FS',
      lag NUMERIC DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS relationships_schedule_idx ON relationships(schedule_id);
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      answers JSONB NOT NULL DEFAULT '{}',
      generated JSONB,
      reviews JSONB NOT NULL DEFAULT '[]',
      audit JSONB NOT NULL DEFAULT '[]',
      schedule_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS extra_questions JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS decisions JSONB NOT NULL DEFAULT '{}';
    CREATE INDEX IF NOT EXISTS plans_org_idx ON plans(org_id);
    CREATE TABLE IF NOT EXISTS data_question_responses (
      schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
      question_id TEXT NOT NULL,
      response TEXT NOT NULL,
      note TEXT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (schedule_id, question_id)
    );
  
    INSERT INTO organizations (id, name)
      SELECT 'org_' || u.id, u.name FROM users u WHERE u.org_id IS NULL
      ON CONFLICT (id) DO NOTHING;
    UPDATE users SET org_id = 'org_' || id WHERE org_id IS NULL;
    UPDATE schedules s SET org_id = u.org_id FROM users u WHERE s.user_id = u.id AND s.org_id IS NULL;
  `,
  },
  {
    id: 2, name: 'security_and_governance',
    sql: `
    -- Roles and account security
    ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT;
    UPDATE users SET role = 'owner' WHERE role IS NULL;
    ALTER TABLE users ALTER COLUMN role SET DEFAULT 'viewer';
    ALTER TABLE users ALTER COLUMN role SET NOT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_logins INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_last_step BIGINT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_recovery JSONB NOT NULL DEFAULT '[]';
    CREATE INDEX IF NOT EXISTS users_org_idx ON users(org_id);
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}';

    -- Server-side sessions: short idle timeout, revocable, visible to the user
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      ip TEXT,
      user_agent TEXT
    );
    CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

    -- Fixed-window counters for rate limits and quotas
    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      window_start TIMESTAMPTZ NOT NULL,
      count INTEGER NOT NULL
    );

    -- Invitations into an organization
    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      invited_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      accepted_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS invitations_org_idx ON invitations(org_id);

    -- Tamper-evident, append-only audit log (hash-chained per organization).
    -- No foreign key to organizations: records outlive the objects they describe.
    CREATE TABLE IF NOT EXISTS audit_events (
      seq BIGSERIAL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      org_id TEXT NOT NULL,
      at TIMESTAMPTZ NOT NULL,
      actor_id TEXT,
      actor_email TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      detail JSONB NOT NULL DEFAULT '{}',
      ip TEXT,
      user_agent TEXT,
      request_id TEXT,
      prev_hash TEXT NOT NULL,
      hash TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS audit_events_org_idx ON audit_events(org_id, seq);
    CREATE INDEX IF NOT EXISTS audit_events_target_idx ON audit_events(org_id, target_type, target_id);
    CREATE OR REPLACE FUNCTION planora_audit_immutable() RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP = 'DELETE' AND current_setting('planora.audit_purge', true) = 'on' THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'audit_events is append-only (% blocked)', TG_OP;
    END;
    $fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS audit_events_immutable ON audit_events;
    CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE ON audit_events
      FOR EACH ROW EXECUTE FUNCTION planora_audit_immutable();
    DROP TRIGGER IF EXISTS audit_events_no_truncate ON audit_events;
    CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
      FOR EACH STATEMENT EXECUTE FUNCTION planora_audit_immutable();

    -- Optimistic locking for plans
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

    -- Housekeeping bookkeeping (retention purges run at most hourly)
    CREATE TABLE IF NOT EXISTS maintenance_runs (
      name TEXT PRIMARY KEY,
      last_run_at TIMESTAMPTZ NOT NULL
    );
    `,
  },
  {
    id: 3, name: 'plans_entitlements_and_sso',
    sql: `
    -- Subscription plan per organization (entitlements are enforced in src/lib/server/entitlements.ts).
    -- Organizations that existed before plans were enforced keep full (pro) access.
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan TEXT;
    UPDATE organizations SET plan = 'pro' WHERE plan IS NULL;
    ALTER TABLE organizations ALTER COLUMN plan SET DEFAULT 'free';
    ALTER TABLE organizations ALTER COLUMN plan SET NOT NULL;
    -- Single sign-on (OpenID Connect) configuration; the client secret is stored encrypted.
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS sso JSONB NOT NULL DEFAULT '{}';
    CREATE TABLE IF NOT EXISTS sso_domains (
      domain TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
    );
    -- How a session was established (password, password+totp, sso, ...)
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS method TEXT;
    `,
  },
  {
    id: 4, name: 'api_keys_webhooks_email_verification',
    sql: `
    -- Organization API keys for integrations (read-only or scheduler); only a SHA-256 of the key is stored.
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ,
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS api_keys_org_idx ON api_keys(org_id);

    -- Outbound webhooks; the signing secret is stored encrypted.
    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      events JSONB NOT NULL DEFAULT '[]',
      secret_enc TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      disabled_at TIMESTAMPTZ,
      last_delivery_at TIMESTAMPTZ,
      last_status TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS webhooks_org_idx ON webhooks(org_id);

    -- Email verification for self sign-up (single-use, hashed, expiring tokens).
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS email_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS email_tokens_user_idx ON email_tokens(user_id);
    `,
  },
  {
    id: 5, name: 'schedule_analysis_versions_source_files',
    sql: `
    -- Planora's own analysis of an uploaded schedule (forecast vs reported finish, finish-milestone
    -- variance, status, recalculation differences) so lists and alerts don't depend on file headers.
    ALTER TABLE schedules ADD COLUMN IF NOT EXISTS analysis JSONB;
    -- Uploads of the same project (P6 project short name / MS Project title) form one update series.
    ALTER TABLE schedules ADD COLUMN IF NOT EXISTS project_key TEXT;
    CREATE INDEX IF NOT EXISTS schedules_project_key_idx ON schedules(org_id, project_key);
    -- Whether this schedule's actuals may calibrate the firm's history (as-built projects only by default).
    ALTER TABLE schedules ADD COLUMN IF NOT EXISTS in_history BOOLEAN NOT NULL DEFAULT TRUE;
    -- The original uploaded file and its SHA-256, kept for chain of custody.
    CREATE TABLE IF NOT EXISTS schedule_files (
      schedule_id TEXT PRIMARY KEY REFERENCES schedules(id) ON DELETE CASCADE,
      org_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      content BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS schedule_files_org_idx ON schedule_files(org_id);
    `,
  },
  {
    id: 6, name: 'finish_milestone_designation',
    sql: `
    -- The contract/finish milestone a scheduler designated for an uploaded schedule (activity id or
    -- activity code); NULL = Planora picks it. Additive: older code ignores the column.
    ALTER TABLE schedules ADD COLUMN IF NOT EXISTS finish_milestone_id TEXT;
    -- P6 milestone type (TT_FinMile = 'finish', TT_Mile = 'start') so the finish milestone can be
    -- told apart from start milestones; NULL for sources without the distinction.
    ALTER TABLE activities ADD COLUMN IF NOT EXISTS milestone_kind TEXT;
    `,
  },
  {
    id: 7, name: 'uploaded_schedule_edits_and_risk_inputs',
    sql: `
    -- Edits a scheduler makes to an uploaded schedule in Planora (remaining duration, relationship,
    -- constraint), each with a reason. An override layer: the imported activities and relationships
    -- are never changed; edits are applied in order on read. Reverting sets reverted_at (kept for the
    -- record). Additive: older code ignores the table.
    CREATE TABLE IF NOT EXISTS schedule_edits (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
      org_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      change JSONB NOT NULL,
      reason TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      option_id TEXT,
      user_id TEXT,
      user_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reverted_at TIMESTAMPTZ,
      reverted_by TEXT,
      revert_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS schedule_edits_schedule_idx ON schedule_edits(org_id, schedule_id, created_at);
    -- Schedule risk analysis inputs for an uploaded schedule: the scheduler's per-activity three-point
    -- ranges (work days) and discrete risk events (probability, impact days, affected activity).
    CREATE TABLE IF NOT EXISTS schedule_risk_inputs (
      schedule_id TEXT PRIMARY KEY REFERENCES schedules(id) ON DELETE CASCADE,
      org_id TEXT NOT NULL,
      ranges JSONB NOT NULL DEFAULT '[]',
      events JSONB NOT NULL DEFAULT '[]',
      updated_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS schedule_risk_inputs_org_idx ON schedule_risk_inputs(org_id);
    `,
  },
  {
    id: 8, name: 'upload_history_series_cui',
    sql: `
    -- Security classification of an uploaded schedule (same values as plans: unclassified, cui,
    -- classified); NULL = not set. CUI/classified uploads never reach a cloud model and their exports
    -- carry CUI markings.
    ALTER TABLE schedules ADD COLUMN IF NOT EXISTS classification TEXT;
    -- Firm history: whose schedule it is ('own' / 'third_party', NULL = not stated), an explicit
    -- override to include a schedule that is not as-built, and whether the file is a re-imported
    -- Planora export (never used to calibrate history). Additive: older code ignores the columns.
    ALTER TABLE schedules ADD COLUMN IF NOT EXISTS upload_origin TEXT;
    ALTER TABLE schedules ADD COLUMN IF NOT EXISTS history_override BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE schedules ADD COLUMN IF NOT EXISTS planora_export BOOLEAN NOT NULL DEFAULT FALSE;
    `,
  },
  {
    id: 9, name: 'submission_review_dispositions',
    sql: `
    -- Reviewer workflow for uploaded submissions. Additive: older code ignores both tables.
    -- One disposition per DCMA finding ('dcma:<n>') or data question (its id) of an upload:
    -- accepted / exception (with justification) / needs_revision.
    CREATE TABLE IF NOT EXISTS review_dispositions (
      schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
      org_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      disposition TEXT NOT NULL CHECK (disposition IN ('accepted', 'exception', 'needs_revision')),
      justification TEXT,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (schedule_id, item_id)
    );
    CREATE INDEX IF NOT EXISTS review_dispositions_org_idx ON review_dispositions(org_id);
    -- The overall disposition of the submission: approved / approved as noted / revise and resubmit.
    CREATE TABLE IF NOT EXISTS submission_reviews (
      schedule_id TEXT PRIMARY KEY REFERENCES schedules(id) ON DELETE CASCADE,
      org_id TEXT NOT NULL,
      disposition TEXT NOT NULL CHECK (disposition IN ('approved', 'approved_as_noted', 'revise_and_resubmit')),
      comments TEXT,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS submission_reviews_org_idx ON submission_reviews(org_id);
    `,
  },
  {
    id: 10, name: 'workspaces_ethical_walls',
    sql: `
    -- Matter / engagement workspaces inside an organization, for project-level access control
    -- (ethical walls). Enforcement lives in src/lib/server/workspaces.ts and the scoped reads in
    -- src/lib/db.ts. Additive: older code ignores the new tables and columns, and every existing
    -- schedule and plan stays organization-wide (workspace_id NULL) until an admin assigns it.
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      -- Walled: only the workspace's members (and owners/admins) can see its schedules and plans.
      walled BOOLEAN NOT NULL DEFAULT FALSE,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS workspaces_org_idx ON workspaces(org_id);
    CREATE UNIQUE INDEX IF NOT EXISTS workspaces_org_name_idx ON workspaces(org_id, LOWER(name));
    CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      org_id TEXT NOT NULL,
      added_by TEXT,
      added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS workspace_members_user_idx ON workspace_members(org_id, user_id);
    -- A restricted member sees only the schedules and plans of the workspaces they belong to.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS workspace_restricted BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE schedules ADD COLUMN IF NOT EXISTS workspace_id TEXT;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS workspace_id TEXT;
    CREATE INDEX IF NOT EXISTS schedules_workspace_idx ON schedules(org_id, workspace_id);
    CREATE INDEX IF NOT EXISTS plans_workspace_idx ON plans(org_id, workspace_id);
    `,
  },
  {
    id: 11, name: 'baseline_resolver',
    sql: `
    -- One baseline for every surface (src/lib/analysis/baseline.ts). Additive: older code ignores both
    -- columns. baseline_schedule_id = the earlier upload of the series the scheduler designated as this
    -- upload's baseline (NULL = the upload labelled Baseline); baseline_meta = the P6 project baseline
    -- embedded in the uploaded XER and whether the file's own target dates may serve as a baseline.
    ALTER TABLE schedules ADD COLUMN IF NOT EXISTS baseline_schedule_id TEXT;
    ALTER TABLE schedules ADD COLUMN IF NOT EXISTS baseline_meta JSONB;
    `,
  },
]

export function checksum(m: Migration): string {
  return createHash('sha256').update(m.sql.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16)
}

export const LATEST_MIGRATION = MIGRATIONS[MIGRATIONS.length - 1].id
