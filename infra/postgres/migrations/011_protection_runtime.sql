-- Durable moderation intent precedes Discord; unconfirmed effects need operator reconciliation.
ALTER TABLE moderation.cases ADD COLUMN IF NOT EXISTS execution_status TEXT NOT NULL DEFAULT 'applied';
ALTER TABLE security.lockdown_state ADD COLUMN IF NOT EXISTS original_permissions JSONB;
ALTER TABLE security.lockdown_state ADD COLUMN IF NOT EXISTS effects_status TEXT NOT NULL DEFAULT 'unconfirmed';

CREATE TABLE IF NOT EXISTS security.restore_executions (
  guild_id TEXT NOT NULL,
  snapshot_id UUID NOT NULL REFERENCES security.snapshots(snapshot_id),
  status TEXT NOT NULL DEFAULT 'running',
  id_map JSONB NOT NULL DEFAULT '{}',
  current_step TEXT,
  requested_by TEXT NOT NULL,
  interaction_key TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(guild_id,snapshot_id)
);
