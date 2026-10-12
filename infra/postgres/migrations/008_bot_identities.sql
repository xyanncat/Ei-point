-- 008_bot_identities.sql — Kafka/Cyrene/Robin/Cipher/SilverWolf/Himiko registry (§2).
-- Identity ≠ modules. config.bots holds one row per identity; code reads BOT_KEY env.
-- Modules per identity (see packages/contracts BOT_MODULES):
--   kafka      = security, moderation, logging   (full security & moderation)
--   cyrene     = ai, search, tts                 (AI chat + voice TTS playback)
--   robin      = music                           (music and playback)
--   cipher     = commerce                        (payment & referral system)
--   silverwolf = community, games                (welcome/leave, XP/levels, cards/packs/market/trades)
--   himiko     = embed, announce                 (embed messages & announcements)
--
-- Transitional: both bot-security and bot-moderation processes currently run with
-- BOT_KEY=kafka sharing the Kafka token until the single-process Kafka merge lands.
-- The embed worker (Himiko) currently runs via apps/workers + dashboard API;
-- a dedicated Himiko gateway process is a P1 build task. No destructive backfill
-- here: seed rows are inserted only when missing, legacy keys are left untouched.

INSERT INTO config.bots (bot_key, application_id, modules, guild_ids)
VALUES
  ('kafka',      'pending-kafka-application-id',      ARRAY['security','moderation','logging'], '{}'),
  ('cyrene',     'pending-cyrene-application-id',     ARRAY['ai','search','tts'],               '{}'),
  ('robin',      'pending-robin-application-id',      ARRAY['music'],                           '{}'),
  ('cipher',     'pending-cipher-application-id',     ARRAY['commerce'],                        '{}'),
  ('silverwolf', 'pending-silverwolf-application-id', ARRAY['community','games'],               '{}'),
  ('himiko',     'pending-himiko-application-id',     ARRAY['embed','announce'],                '{}')
ON CONFLICT (bot_key) DO NOTHING;
