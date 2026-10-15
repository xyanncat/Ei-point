-- Preserve action-specific details needed to reconcile temporary Discord effects.
ALTER TABLE moderation.cases
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS moderation_cases_temporary_expiry_idx
  ON moderation.cases (expires_at)
  WHERE execution_status = 'applied' AND kind IN ('temp_role', 'temp_restriction');
