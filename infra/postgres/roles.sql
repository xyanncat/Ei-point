-- Roles: least-privilege service accounts (§4). App never runs as superuser.
-- Apply after migrations as postgres superuser; values come from vault/operator, not git.
--   CREATE ROLE ei_royality_app WITH LOGIN PASSWORD '<from .env>';
--   CREATE ROLE ei_royality_worker WITH LOGIN PASSWORD '<worker pw>';
--   CREATE ROLE ei_royality_readonly WITH LOGIN PASSWORD '<ro pw>';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ei_royality_app') THEN
    CREATE ROLE ei_royality_app WITH LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ei_royality_worker') THEN
    CREATE ROLE ei_royality_worker WITH LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ei_royality_readonly') THEN
    CREATE ROLE ei_royality_readonly WITH LOGIN;
  END IF;
END $$;

GRANT CONNECT ON DATABASE ei_royality TO ei_royality_app, ei_royality_worker, ei_royality_readonly;
GRANT USAGE ON SCHEMA access, config, ops, security, moderation, community, games, ai, music, commerce TO ei_royality_app, ei_royality_worker, ei_royality_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA access, config, ops, security, moderation, community, games, ai, music, commerce TO ei_royality_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA ops TO ei_royality_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA access, config, ops, security, moderation, community, games, ai, music, commerce TO ei_royality_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA access, config, ops, security, moderation, community, games, ai, music, commerce GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ei_royality_app;
