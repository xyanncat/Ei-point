ALTER TABLE commerce.catalog ADD COLUMN IF NOT EXISTS membership_days INT NOT NULL DEFAULT 0 CHECK (membership_days >= 0);
ALTER TABLE commerce.orders ADD COLUMN IF NOT EXISTS public_id TEXT UNIQUE;
ALTER TABLE commerce.orders ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'upi' CHECK (method IN ('upi','usdt'));
ALTER TABLE commerce.orders ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days');
ALTER TABLE commerce.orders ADD COLUMN IF NOT EXISTS referral_code TEXT REFERENCES commerce.referrals(code);
ALTER TABLE commerce.orders ADD COLUMN IF NOT EXISTS request_hash TEXT;
ALTER TABLE commerce.orders ADD COLUMN IF NOT EXISTS service_name TEXT;
ALTER TABLE commerce.orders ADD COLUMN IF NOT EXISTS membership_days INT NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS commerce_proof_once ON commerce.claims(proof_ref);
CREATE TABLE IF NOT EXISTS commerce.memberships (
 guild_id TEXT NOT NULL, user_id TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(guild_id,user_id)
);
CREATE TABLE IF NOT EXISTS commerce.checkout_rate_limits (
 bucket TEXT PRIMARY KEY, window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(), requests INT NOT NULL DEFAULT 1
);
INSERT INTO commerce.catalog(sku,name,price_minor,membership_days) VALUES
 ('account-management-membership','All-Games Account Management Membership (30 Days)',70000,30),
 ('hsr-trailblaze-missions','Trailblaze Missions',259900,0),
 ('hsr-companion-world-quests','Companion Missions + World Quests',299900,0),
 ('hsr-single-character-build','Single Character Build',49900,0),
 ('hsr-full-team-build','Full Team Build (4 Characters)',199900,0),
 ('hsr-per-planet-exploration','Per Planet Exploration',99900,0),
 ('hsr-full-exploration','Full Star Rail Exploration',599900,0),
 ('hsr-all-in-one-package','Star Rail All-In-One Package',999900,0),
 ('genshin-one-region-exploration','Any 1 Region (100%)',69900,0),
 ('genshin-three-regions-exploration','Any 3 Regions (100%)',149900,0),
 ('genshin-one-nation-exploration','One Nation Full Exploration',499900,0),
 ('genshin-sumeru-exploration','Sumeru Complete Exploration',759900,0),
 ('genshin-world-quests','World Quests',199900,0),
 ('genshin-reputation-quests','Reputation Quests',149900,0),
 ('genshin-archon-quest','Archon Quest',49900,0),
 ('genshin-character-story-quests','All Character Story Quests',499900,0),
 ('genshin-main-event','Main Event',20000,0),
 ('genshin-short-event','Short Event',15000,0),
 ('genshin-teyvat-package','All-In-One Teyvat Package',1999900,0)
ON CONFLICT(sku) DO NOTHING;
