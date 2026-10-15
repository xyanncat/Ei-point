-- Move welcome, community, and leveling controls to Himiko. Keep SilverWolf focused on games.
UPDATE config.bots
SET modules = ARRAY['games']::text[]
WHERE bot_key = 'silverwolf';

UPDATE config.bots
SET modules = ARRAY['embed', 'announce', 'welcome', 'community', 'leveling']::text[]
WHERE bot_key = 'himiko';

-- Preserve existing per-guild bot state and command restrictions for the moved features.
INSERT INTO config.bot_states (guild_id, bot_key, enabled, paused, updated_by, updated_at)
SELECT guild_id, 'himiko', enabled, paused, updated_by, updated_at
FROM config.bot_states
WHERE bot_key = 'silverwolf'
ON CONFLICT (guild_id, bot_key) DO NOTHING;

INSERT INTO config.command_permissions (guild_id, bot_key, command, role_ids, enabled, updated_by, updated_at)
SELECT guild_id, 'himiko', command, role_ids, enabled, updated_by, updated_at
FROM config.command_permissions
WHERE bot_key = 'silverwolf'
  AND command IN ('setwelcome', 'setleave', 'testwelcome', 'xp', 'setlevelchannel', 'leaderboard')
ON CONFLICT (guild_id, bot_key, command) DO NOTHING;

DELETE FROM config.command_permissions
WHERE bot_key = 'silverwolf'
  AND command IN ('setwelcome', 'setleave', 'testwelcome', 'xp', 'setlevelchannel', 'leaderboard');
