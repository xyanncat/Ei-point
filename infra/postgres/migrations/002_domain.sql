-- 002_domain.sql — security, moderation, community, games, ai, music, commerce (§4)
-- All financial / card / reward mutations MUST run in a tx guarded by idempotency_key UNIQUE.

CREATE SCHEMA IF NOT EXISTS security;
CREATE SCHEMA IF NOT EXISTS moderation;
CREATE SCHEMA IF NOT EXISTS community;
CREATE SCHEMA IF NOT EXISTS games;
CREATE SCHEMA IF NOT EXISTS ai;
CREATE SCHEMA IF NOT EXISTS music;
CREATE SCHEMA IF NOT EXISTS commerce;

-- Security
CREATE TABLE IF NOT EXISTS security.incidents (
  incident_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  actor_id TEXT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  detail JSONB NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS security.trust_state (
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
  score INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS security.whitelist (
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
  reason TEXT NOT NULL, added_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS security.lockdown_state (
  guild_id TEXT PRIMARY KEY,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  reason TEXT NULL,
  updated_by TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS security.snapshots (
  snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  checksum TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Moderation
CREATE TABLE IF NOT EXISTS moderation.cases (
  case_id BIGSERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL, -- warn|ban|unban|timeout|purge|note
  reason TEXT NOT NULL,
  expires_at TIMESTAMPTZ NULL,
  moderator_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cases_guild_user_idx ON moderation.cases (guild_id, user_id, created_at DESC);

-- Community
CREATE TABLE IF NOT EXISTS community.welcome_templates (
  guild_id TEXT PRIMARY KEY,
  template JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS community.xp (
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
  xp BIGINT NOT NULL DEFAULT 0,
  level INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, user_id)
);

-- Games (cards/economy — no dupes / no double-spend: UNIQUE + CHECK + tx)
CREATE TABLE IF NOT EXISTS games.card_definitions (
  card_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rarity TEXT NOT NULL,
  artwork_ref TEXT NOT NULL, -- volume id + checksum, never inline bytes
  checksum TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS games.card_instances (
  instance_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id TEXT NOT NULL REFERENCES games.card_definitions(card_id),
  owner_guild_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  locked BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS card_owner_idx ON games.card_instances (owner_guild_id, owner_user_id);
CREATE TABLE IF NOT EXISTS games.balances (
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
  amount_minor BIGINT NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS games.listings (
  listing_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  instance_id UUID NOT NULL REFERENCES games.card_instances(instance_id),
  price_minor BIGINT NOT NULL CHECK (price_minor > 0),
  status TEXT NOT NULL DEFAULT 'open', -- open|sold|cancelled
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS games.trades (
  trade_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|done|cancelled
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- AI memory
CREATE TABLE IF NOT EXISTS ai.threads (
  thread_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL, persona TEXT NOT NULL DEFAULT 'default',
  summary TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guild_id, user_id, persona)
);
CREATE TABLE IF NOT EXISTS ai.messages (
  message_id BIGSERIAL PRIMARY KEY,
  thread_id UUID NOT NULL REFERENCES ai.threads(thread_id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tokens INT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_msg_thread_idx ON ai.messages (thread_id, message_id DESC);
CREATE TABLE IF NOT EXISTS ai.usage_ledger (
  id BIGSERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
  provider TEXT NOT NULL, tokens_in INT NOT NULL DEFAULT 0, tokens_out INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Music
CREATE TABLE IF NOT EXISTS music.queue_snapshots (
  guild_id TEXT PRIMARY KEY,
  queue JSONB NOT NULL,
  position_ms BIGINT NOT NULL DEFAULT 0,
  loop_mode TEXT NOT NULL DEFAULT 'off',
  volume INT NOT NULL DEFAULT 100,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS music.permissions (
  guild_id TEXT NOT NULL, role_id TEXT NOT NULL, scope TEXT NOT NULL, -- master|dj
  PRIMARY KEY (guild_id, role_id, scope)
);

-- Commerce (server owns prices; browser never chooses amount/discount — §6)
CREATE TABLE IF NOT EXISTS commerce.catalog (
  sku TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_minor BIGINT NOT NULL CHECK (price_minor > 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS commerce.orders (
  order_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL, buyer_id TEXT NOT NULL,
  sku TEXT NOT NULL REFERENCES commerce.catalog(sku),
  amount_minor BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|claimed|settled|rejected|expired
  order_token_hash TEXT NOT NULL UNIQUE, -- public verification token (hashed)
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS commerce.claims (
  claim_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES commerce.orders(order_id),
  proof_ref TEXT NOT NULL, -- upload id + checksum
  status TEXT NOT NULL DEFAULT 'pending',
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id)
);
CREATE TABLE IF NOT EXISTS commerce.settlements (
  settlement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES commerce.orders(order_id),
  settled_by TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id)
);
CREATE TABLE IF NOT EXISTS commerce.referrals (
  code TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL, referrer_id TEXT NOT NULL,
  cycle TEXT NOT NULL, -- YYYY-MM month boundary enforced in app + CHECK
  uses INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS commerce.rewards (
  reward_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
  cycle TEXT NOT NULL,
  amount_minor BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved', -- reserved|paid|expired
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
