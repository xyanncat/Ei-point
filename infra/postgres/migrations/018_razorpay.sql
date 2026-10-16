-- A12: Razorpay orders settle through the owner's hosted payment page
-- (https://razorpay.me/@subrodluffy) with manual staff verification of the
-- buyer's submitted payment reference — no API keys, webhooks or provider
-- receipts (owner decision, 2026-10-16). This migration only widens the order
-- method contract; the earlier API-based tables were never deployed and were
-- removed before commit.
ALTER TABLE commerce.orders DROP CONSTRAINT IF EXISTS orders_method_check;
ALTER TABLE commerce.orders DROP CONSTRAINT IF EXISTS commerce_orders_method_check;
ALTER TABLE commerce.orders ADD CONSTRAINT orders_method_check CHECK (method IN ('upi','usdt','razorpay'));
