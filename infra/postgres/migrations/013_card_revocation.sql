ALTER TABLE games.card_instances
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active','revoked'));
CREATE INDEX IF NOT EXISTS card_active_owner_idx
  ON games.card_instances(owner_guild_id,owner_user_id,instance_id)
  WHERE status='active';
