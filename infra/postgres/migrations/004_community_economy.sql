-- Forward-only Phase 6 extension. No legacy data or catalog is invented.
ALTER TABLE community.xp ADD COLUMN last_awarded_at TIMESTAMPTZ;
ALTER TABLE community.xp ADD CONSTRAINT xp_nonnegative CHECK(xp >= 0);
CREATE INDEX xp_leaderboard_idx ON community.xp(guild_id, xp DESC, user_id);
CREATE TABLE community.xp_events (
  guild_id TEXT NOT NULL, message_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(guild_id,message_id)
);
CREATE INDEX xp_event_retention_idx ON community.xp_events(created_at);

ALTER TABLE games.card_definitions ADD COLUMN max_supply BIGINT CHECK(max_supply > 0);
ALTER TABLE games.card_definitions ADD COLUMN issued_count BIGINT NOT NULL DEFAULT 0 CHECK(issued_count >= 0);
ALTER TABLE games.card_definitions ADD COLUMN active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE games.card_instances ADD COLUMN serial_number BIGINT;
ALTER TABLE games.card_instances ADD COLUMN reservation_id UUID;
ALTER TABLE games.card_instances ADD COLUMN reservation_type TEXT CHECK(reservation_type IN ('listing','trade'));
CREATE UNIQUE INDEX card_serial_idx ON games.card_instances(card_id,serial_number) WHERE serial_number IS NOT NULL;
CREATE UNIQUE INDEX one_open_listing_idx ON games.listings(instance_id) WHERE status='open';
ALTER TABLE games.trades ADD COLUMN sender_id TEXT;
ALTER TABLE games.trades ADD COLUMN recipient_id TEXT;
ALTER TABLE games.trades ADD COLUMN offered_amount BIGINT NOT NULL DEFAULT 0 CHECK(offered_amount >= 0);
ALTER TABLE games.trades ADD COLUMN requested_amount BIGINT NOT NULL DEFAULT 0 CHECK(requested_amount >= 0);
ALTER TABLE games.trades ADD COLUMN expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '1 day';
CREATE INDEX trade_expiry_idx ON games.trades(guild_id,expires_at) WHERE status='pending';
CREATE TABLE games.trade_items (
  trade_id UUID NOT NULL REFERENCES games.trades(trade_id),
  instance_id UUID NOT NULL REFERENCES games.card_instances(instance_id),
  side TEXT NOT NULL CHECK(side IN ('offered','requested')),
  PRIMARY KEY(trade_id,instance_id)
);
CREATE TABLE games.packs (
  pack_id TEXT PRIMARY KEY, name TEXT NOT NULL,
  price_minor BIGINT NOT NULL CHECK(price_minor >= 0),
  size INT NOT NULL CHECK(size BETWEEN 1 AND 10),
  admin_only BOOLEAN NOT NULL DEFAULT false, active BOOLEAN NOT NULL DEFAULT true
);
CREATE TABLE games.pack_items (
  pack_id TEXT NOT NULL REFERENCES games.packs(pack_id),
  card_id TEXT NOT NULL REFERENCES games.card_definitions(card_id),
  weight INT NOT NULL CHECK(weight BETWEEN 1 AND 1000000),
  PRIMARY KEY(pack_id,card_id)
);
CREATE TABLE games.operations (
  guild_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL, receipt JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(guild_id,idempotency_key)
);
CREATE TABLE games.ledger (
  entry_id BIGSERIAL PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
  delta_minor BIGINT NOT NULL, operation_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ledger_member_idx ON games.ledger(guild_id,user_id,entry_id DESC);
ALTER TABLE ops.outbox ADD COLUMN lease_expires_at TIMESTAMPTZ;
ALTER TABLE ops.outbox ADD COLUMN attempts INT NOT NULL DEFAULT 0;
ALTER TABLE ops.outbox ADD COLUMN last_error TEXT;
ALTER TABLE ops.outbox ADD COLUMN next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now();
