-- Provider cost units (redesign infrastructure §6): chat keeps its token
-- columns; speech and translation reserve and settle daily "cost units"
-- (characters) with the same PostgreSQL admission machinery, so caps are
-- enforced fleet-wide for both website and bot origins.
ALTER TABLE ai.usage_ledger ADD COLUMN IF NOT EXISTS units BIGINT NOT NULL DEFAULT 0;
ALTER TABLE ai.budget_reservations
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'chat'
    CHECK (kind IN ('chat', 'tts', 'translate'));
