-- Durable admission reservations and fleet-wide voice leases.
ALTER TABLE music.queue_snapshots ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS ai.budget_reservations (
  reservation_id UUID PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
  tokens BIGINT NOT NULL CHECK(tokens > 0), expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_budget_owner ON ai.budget_reservations(guild_id,user_id);
CREATE TABLE IF NOT EXISTS ai.voice_leases (
  owner TEXT PRIMARY KEY, expires_at TIMESTAMPTZ NOT NULL
);
