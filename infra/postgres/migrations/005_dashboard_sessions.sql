-- Server-side OAuth sessions; access tokens are AES-GCM encrypted using SESSION_SECRET.
ALTER TABLE access.sessions ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
ALTER TABLE access.sessions ADD COLUMN encrypted_token TEXT;
CREATE INDEX dashboard_sessions_expiry_idx ON access.sessions(expires_at);
CREATE INDEX dashboard_incidents_guild_time_idx ON security.incidents(guild_id,created_at DESC);
CREATE INDEX dashboard_actions_scope_time_idx ON config.settings_history(scope,changed_at DESC);
