-- Dashboard controls are durable desired state. Applied timestamps require a runtime acknowledgement.
CREATE TABLE IF NOT EXISTS config.bot_states (
 guild_id TEXT NOT NULL REFERENCES access.guilds(guild_id) ON DELETE CASCADE,
 bot_key TEXT NOT NULL REFERENCES config.bots(bot_key) ON DELETE CASCADE,
 enabled BOOLEAN NOT NULL DEFAULT TRUE, paused BOOLEAN NOT NULL DEFAULT FALSE,
 updated_by TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(guild_id,bot_key)
);
CREATE TABLE IF NOT EXISTS config.guild_controls (
 guild_id TEXT PRIMARY KEY REFERENCES access.guilds(guild_id) ON DELETE CASCADE,
 notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
 server_paused BOOLEAN NOT NULL DEFAULT FALSE,
 notification_preferences JSONB NOT NULL DEFAULT '{}',
 updated_by TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS config.command_permissions (
 guild_id TEXT NOT NULL REFERENCES access.guilds(guild_id) ON DELETE CASCADE,
 bot_key TEXT NOT NULL REFERENCES config.bots(bot_key) ON DELETE CASCADE,
 command TEXT NOT NULL, role_ids TEXT[] NOT NULL DEFAULT '{}', enabled BOOLEAN NOT NULL DEFAULT TRUE,
 updated_by TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(guild_id,bot_key,command)
);
CREATE TABLE IF NOT EXISTS access.secret_vault (
 name TEXT PRIMARY KEY, encrypted_value TEXT NOT NULL,
 updated_by TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS access.control_audit (
 id BIGSERIAL PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL,
 guild_id TEXT, target TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS control_audit_guild_time ON access.control_audit(guild_id,created_at DESC);
CREATE TABLE IF NOT EXISTS config.infra_accounts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 provider TEXT NOT NULL CHECK(provider IN ('postgres','redis','mongodb')),
 account_name TEXT NOT NULL,region TEXT,secret_ref TEXT NOT NULL,endpoint TEXT,
 enabled BOOLEAN NOT NULL DEFAULT TRUE,metadata JSONB NOT NULL DEFAULT '{}',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
