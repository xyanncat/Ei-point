-- 017: Sanction ownership + fair expiry scheduling (A05/A06/A07).
-- Cleanup may only act for the current owning sanction; equal-kind cases supersede older ones.
ALTER TABLE moderation.cases
  ADD COLUMN IF NOT EXISTS superseded_by BIGINT NULL,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS lease_owner TEXT NULL,
  ADD COLUMN IF NOT EXISTS lease_until TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS attempt_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error_code TEXT NULL;

-- Fast due-claim scan: unexpired lease, due next attempt, not superseded.
CREATE INDEX IF NOT EXISTS moderation_cases_due_idx
  ON moderation.cases (next_attempt_at, expires_at)
  WHERE execution_status = 'applied' AND expires_at IS NOT NULL AND superseded_by IS NULL;
