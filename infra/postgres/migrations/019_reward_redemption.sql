-- A12/7C: reward redemption and membership revocation audit.
-- Reserved referrals credit a later checkout: the order holds the reward rows
-- (status 'redeemed' + order link) from creation, releases them on rejection /
-- expiry, and pays them exactly once inside the settlement transaction.
ALTER TABLE commerce.rewards ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES commerce.orders(order_id);
ALTER TABLE commerce.orders ADD COLUMN IF NOT EXISTS credit_applied_minor BIGINT NOT NULL DEFAULT 0;
ALTER TABLE commerce.memberships ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rewards_status_check' AND conrelid = 'commerce.rewards'::regclass) THEN
    ALTER TABLE commerce.rewards ADD CONSTRAINT rewards_status_check CHECK (status IN ('reserved','redeemed','paid','expired'));
  END IF;
END $$;
