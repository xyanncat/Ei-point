-- Keep voice activity cooldowns independent from text message cooldowns.
ALTER TABLE community.xp
  ADD COLUMN IF NOT EXISTS last_voice_awarded_at TIMESTAMPTZ;
