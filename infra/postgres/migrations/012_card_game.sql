CREATE TABLE IF NOT EXISTS games.card_games (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  deck JSONB NOT NULL,
  hand JSONB NOT NULL DEFAULT '[]'::jsonb,
  score BIGINT NOT NULL DEFAULT 0 CHECK (score >= 0),
  games_played BIGINT NOT NULL DEFAULT 0 CHECK (games_played >= 0),
  games_won BIGINT NOT NULL DEFAULT 0 CHECK (games_won >= 0 AND games_won <= games_played),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, user_id),
  CHECK (jsonb_typeof(deck) = 'array' AND jsonb_array_length(deck) <= 52),
  CHECK (jsonb_typeof(hand) = 'array' AND jsonb_array_length(hand) <= 5)
);
