-- 001_core.sql — access, configuration, operations ( feel §4: Access/Configuration/Operations )
-- Snowflakes as TEXT. Money as BIGINT minor units. All mutable state via tx + idempotency keys.

CREATE SCHEMA IF NOT EXISTS access;
CREATE SCHEMA IF NOT EXISTS config;
CREATE SCHEMA IF NOT EXISTS ops;

-- Approved guilds: bots do nothing outside these rows.
CREATE TABLE IF NOT EXISTS access.guilds (
  guild_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  approved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS access.staff_roles (
  guild_id TEXT NOT NULL REFERENCES access.guilds(guild_id) ON DELETE CASCADE,
  role_id TEXT NOT NULL,
  scope TEXT NOT NULL, -- e.g. security|moderation|commerce-settle|music-master
  PRIMARY KEY (guild_id, role_id, scope)
);

CREATE TABLE IF NOT EXISTS access.sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_user_id TEXT NOT NULL,
  guild_id TEXT NULL REFERENCES access.guilds(guild_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON access.sessions (discord_user_id);

-- Bot registry: identity ≠ modules (§2). One row per bot; code reads this, never a hard-coded list.
-- Identities: kafka (security+moderation+logging), cyrene (ai+search+tts),
-- robin (music), cipher (commerce), silverwolf (community+games), himiko (embed+announce).
CREATE TABLE IF NOT EXISTS config.bots (
  bot_key TEXT PRIMARY KEY, -- kafka|cyrene|robin|cipher|silverwolf|himiko
  application_id TEXT NOT NULL UNIQUE,
  modules TEXT[] NOT NULL,
  guild_ids TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS config.settings (
  scope TEXT NOT NULL,       -- global|guild:<id>|bot:<key>
  key TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  value JSONB NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ NULL, -- NULL = saved but NOT confirmed applied by bot (§6)
  PRIMARY KEY (scope, key, version)
);

CREATE TABLE IF NOT EXISTS config.settings_history (
  id BIGSERIAL PRIMARY KEY,
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  version INT NOT NULL,
  value JSONB NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Durable jobs + transactional outbox (§5).
CREATE TABLE IF NOT EXISTS ops.jobs (
  job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,
  payload JSONB NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|leased|done|failed|dead
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  lease_owner TEXT NULL,
  lease_expires_at TIMESTAMPTZ NULL,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_status_next_idx ON ops.jobs (status, next_run_at);

CREATE TABLE IF NOT EXISTS ops.outbox (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  correlation_id TEXT NOT NULL,
  published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (aggregate, aggregate_id, type, correlation_id)
);
CREATE INDEX IF NOT EXISTS outbox_unpublished_idx ON ops.outbox (published, created_at) WHERE published = FALSE;

CREATE TABLE IF NOT EXISTS ops.service_status (
  service TEXT PRIMARY KEY,
  liveness TEXT NOT NULL DEFAULT 'unknown',   -- ok|degraded|down|unknown
  gateway TEXT NOT NULL DEFAULT 'unknown',
  db_ready BOOLEAN NOT NULL DEFAULT FALSE,
  provider TEXT NOT NULL DEFAULT 'unknown',
  latency_ms INT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ops.diagnostic_events (
  id BIGSERIAL PRIMARY KEY,
  service TEXT NOT NULL,
  correlation_id TEXT NULL,
  category TEXT NOT NULL, -- latency|error|rate-limit|dns|disk|queue|auth|provider
  detail JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS diag_service_time_idx ON ops.diagnostic_events (service, created_at DESC);
