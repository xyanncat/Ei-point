# Ei Point bot commands and functions

This catalog lists commands currently defined by the checked-in bot code, plus the non-command functions wired into each bot. It is a source-level reference, not proof that commands are registered in Discord, work in a live guild, or match every legacy bot behavior. The source-to-target parity gate remains open; see [the feature matrix](feature-matrix.md), [legacy behavior map](audits/legacy-behavior-map.json), and the local completion build plan provided with the project assets.

The six current identities are Kafka, Cyrene, Robin, Cipher, SilverWolf, and Himiko. `security` and `moderation` are modules served by the single Kafka gateway; they are not separate production identities in the current default roster.

## At a glance

| Bot | Main function | Command source |
|---|---|---|
| [Kafka](#kafka) | Security, moderation, audit/event logging | `apps/bots/kafka/src/index.ts`, security and moderation command modules |
| [Cyrene](#cyrene) | AI chat, persona and persistent conversation state, TTS | `apps/bots/ai/src/commands.ts`, `apps/bots/ai/src/tts.ts` |
| [Robin](#robin) | Music search, playback, voice and queue management | `apps/bots/music-py/src/main.py` |
| [Cipher](#cipher) | Service catalog, orders, payment claims, settlement, referrals | `apps/bots/commerce/src/commands.ts` |
| [SilverWolf](#silverwolf) | Welcome/leave, XP, cards, game, inventory, market and trades | `apps/bots/community/src/commands.ts` |
| [Himiko](#himiko) | Embed previews and announcements | `apps/bots/himiko/src/commands.ts` |

## Kafka

Kafka is the consolidated security, moderation, and logging bot. Slash command definitions are in the security and moderation modules and are registered by the Kafka gateway.

### Commands

| Command | Function |
|---|---|
| `/security status` | Show the guild's recorded security posture, lockdown state, recent incident count, and whitelist count. |
| `/security lockdown` | Record and request lockdown engage/clear with an optional reason. The status row can distinguish incomplete effects; live Discord enforcement remains an acceptance item. |
| `/security trust <user>` | Read the member's trust/risk information. |
| `/security whitelist add <user> <reason>` | Add a user to the guild's antinuke whitelist. |
| `/security whitelist remove <user>` | Remove a user from the whitelist. |
| `/security whitelist list` | List the guild's whitelisted users. |
| `/security snapshot create` | Capture and store a checksum-verified guild configuration snapshot. |
| `/security snapshot list` | List recent snapshots. |
| `/security snapshot plan <snapshot_id>` | Produce a non-mutating restore plan. |
| `/security snapshot restore <snapshot_id>` | Request owner-only configuration restoration from a snapshot. Supported restoration boundaries and live recovery remain to be accepted. |
| `/security incidents [limit]` | Show recent recorded security incidents, with a bounded result count. |
| `/warn <user> <reason>` | Record and issue a formal warning. |
| `/ban <user> <reason> [days]` | Ban a user and optionally delete up to seven days of message history. |
| `/unban <user_id> <reason>` | Unban a user by ID and record the moderation action. |
| `/timeout <user> <minutes> <reason>` | Apply a bounded member timeout. |
| `/purge <count>` | Bulk-delete up to 100 recent messages. |
| `/cases <user> [limit]` | List moderation cases for a target user. |
| `/note <user> <text>` | Add an internal staff note to the user's moderation record. |

### Other functions

- Detect join bursts and evaluate raid/antinuke signals against configured rules and allowlists.
- Record security incidents and moderation/logging events in PostgreSQL/outbox paths.
- Log message edits/deletions, member departures, channel creation/deletion, role creation/deletion, and voice-state changes.
- Reconcile due moderation expiry records and report gateway/readiness status.
- Apply command approval, guild allowlist, and role-control checks before dispatch; fleet-wide shared lifecycle adoption still needs acceptance.

## Cyrene

### Commands

| Command | Function |
|---|---|
| `/ask <prompt> [persona]` | Send a prompt through the configured AI provider router and persist conversation history. |
| `/persona [name]` | View or change the conversation persona. |
| `/reset [persona]` | Clear the current guild/user conversation history, optionally for a named persona. |
| `/usage` | Show today's recorded AI usage against the configured daily limit. |
| `/model` | Show configured AI provider/router status. |
| `/speak <text> [voice]` | Synthesize text and attempt playback in the caller's voice channel. Requires TTS provider configuration and platform acceptance. |
| `/tts-voice [voice]` | View or set the server's TTS voice preference. |
| `/tts-stop` | Stop active TTS playback and release the voice connection. |

### Other functions

- Route AI requests through a required primary provider and an optional all-or-nothing fallback URL/key/model configuration.
- Keep guild/user conversation threads, recent messages, summaries, persona preferences, and usage records in PostgreSQL.
- Bound synthesis concurrency, waiting queue size, text length, and provider deadline; coordinate voice admission with Robin through database leases.
- Fail clearly when the AI/TTS provider or voice dependencies are not configured. Search is listed as an intended module responsibility in the roster, but no `/search` command is defined in the current Cyrene command files.

## Robin

### Commands

| Command | Function |
|---|---|
| `/play <query>` | Resolve a URL or search query and enqueue/start playback. |
| `/search <query>` | Search for tracks and present a five-item selection menu when needed. |
| `/pause` | Pause current playback. |
| `/resume` | Resume paused playback. |
| `/skip` | Advance past the current track. |
| `/stop` | Stop playback, clear the queue, and leave voice. |
| `/seek <seconds>` | Seek within the current track. |
| `/autoplay <enabled>` | Enable or disable related-track autoplay when the queue drains. |
| `/queue` | Display upcoming tracks. |
| `/nowplaying` | Show current track details and progress. |
| `/shuffle` | Shuffle queued tracks while preserving the current track. |
| `/loop <mode>` | Set loop mode to off, current track, or queue. |
| `/volume <percent>` | Set playback volume (0–150%). |
| `/claimmaster <role> <scope>` | Assign or claim a DJ/Master playback-control role, subject to authorization. |
| `/masters` | List the guild's configured DJ/Master roles. |
| `/disconnect` | Disconnect Robin from the voice channel. |

### Other functions

- Resolve media using yt-dlp and stream through FFmpeg; bound metadata-resolution concurrency and voice sessions.
- Advance queues, maintain playback state, and support track/queue loop, seeking, autoplay, and search selection callbacks.
- Persist queue snapshots and playback position in PostgreSQL and restore saved queue state after restart.
- Maintain a size/TTL-bounded local audio cache and expose health/readiness status.

## Cipher

### Commands

| Command | Function |
|---|---|
| `/catalog` | List active services/packages with server-configured prices. |
| `/order create <sku>` | Create an order for an active catalog item and return payment instructions when checkout configuration is valid. |
| `/order status <order_id>` | Check order status. Access scoping needs the security remediation described in the audit before production use. |
| `/order claim <order_id> <proof>` | Submit a payment reference/UTR/transaction hash for staff review; a claim is not itself settlement. |
| `/settle <order_id>` | Allow authorized staff to settle a claimed order and trigger the configured fulfillment path. |
| `/referral code` | Create or retrieve a referral code/link. |
| `/referral stats` | Show referral activity and current-cycle rewards. |

### Other functions

- Create durable orders with server-authoritative catalog values and payment tokens; record claims and settlement state transactionally.
- Build UPI payment payloads and support configured UPI/USDT checkout information; production payment reconciliation and end-to-end parity remain open.
- Expose corresponding website API checkout, claim, status, and settlement flows through the web/API services.

## SilverWolf

### Commands

| Command | Function |
|---|---|
| `/setwelcome <channel> <message>` | Save the guild's join-message template and destination. |
| `/setleave <channel> <message>` | Save the guild's leave-message template and destination. |
| `/testwelcome [event]` | Preview the selected welcome/leave template. |
| `/xp [enabled] [amount] [cooldown]` | Configure message XP and cooldown. |
| `/setlevelchannel <channel>` | Select the level-up notification destination. |
| `/rank [user]` | Show a member's XP, level, and rank. |
| `/leaderboard` | Show the top members by XP. |
| `/cardinfo <instance_id>` | Inspect a card instance and its guild-scoped metadata. |
| `/cardstats [user]` | Show a user's card-collection statistics. |
| `/play` | Deal a five-card draw round against the house. |
| `/deck [reshuffle]` | Show or rebuild the member's five-card deck. |
| `/hand` | Show the last round's hand. |
| `/score` | Show the member's game score and record. |
| `/cards [page]` | Browse the card catalog. |
| `/inventory [page]` | List owned card instances. |
| `/packs` | List available card packs. |
| `/open <pack>` | Buy/open a pack at its server-defined price, subject to inventory and supply checks. |
| `/sell <instance> <price>` | Place a card instance into a market listing/escrow. |
| `/market [page]` | Browse open market listings. |
| `/buy <listing>` | Purchase an open listing transactionally. |
| `/unlist <listing>` | Cancel the caller's open listing. |
| `/trades [page]` | List the caller's pending and completed trades. |
| `/trade offer <recipient> [offered] [requested] [offered_amount] [requested_amount] [ttl]` | Create a trade offer containing cards and/or berries with an expiry. |
| `/trade accept <id>` | Accept a trade addressed to the caller. |
| `/trade cancel <id>` | Cancel or reject a trade offer. |
| `/balance` | Show the caller's berries balance. |
| `/cardadmin credit <user> <amount>` | Guild-owner action to grant berries. |
| `/cardadmin issue <user> <card>` | Guild-owner action to issue a card subject to supply limits. |
| `/cardadmin revoke <instance>` | Guild-owner action to revoke an unreserved card instance. |
| `/cardadmin define <json>` | Import a card definition with identity, rarity, artwork reference/checksum, and supply. |
| `/cardadmin pack <json>` | Configure a pack, price, size, access mode, and weighted card contents. |

### Other functions

- Render configured welcome/leave messages when members join or leave; send level notifications and update message XP.
- Run community outbox delivery for supported notifications.
- Enforce guild scope, guild-owner-only catalog/economy administration, transaction boundaries, inventory uniqueness, and trade/market contention checks.
- Keep economy balances, cards, game state, inventory, listings, trades, and operation receipts in PostgreSQL.

## Himiko

### Commands

| Command | Function |
|---|---|
| `/announce <channel> <title> <description> [color] [ping_role]` | Validate and queue a styled announcement for delivery to a text/announcement channel. |
| `/embed <title> <description> [color]` | Build and return a validated embed preview without choosing a destination channel. |

### Other functions

- Validate channel/role IDs, non-empty content, title/body limits, and six-digit hex colors before building payloads.
- Persist announcement intent and deliver through the dedicated delivery/worker path; scheduled delivery is not represented as a user-facing slash command in the current definitions.
- Report delivery/readiness state without treating an accepted queue operation as proof of live Discord delivery.

## API-key configuration count

The completion plan describes provider configuration but does not literally enumerate API-key variables. In the current runtime configuration there are **three provider-key slots**:

| Variable | Requirement | Used for |
|---|---|---|
| `AI_PROVIDER_PRIMARY_KEY` | Required when Cyrene's AI service is enabled | Primary AI provider authentication |
| `AI_PROVIDER_FALLBACK_KEY` | Optional; fallback URL, key, and model must be configured together | AI fallback provider authentication |
| `TTS_PROVIDER_KEY` | Required to use a configured TTS provider; TTS can remain unavailable without it | Cyrene speech synthesis authentication |

This count excludes Discord bot tokens, database credentials, payment addresses, and OAuth secrets because they are not provider API keys. See [.env.example](../.env.example) and the [bot identity runbook](bot-identities.md) for configuration context.

## Scope and verification status

This document follows the **current command definitions**, not the complete archived behavior inventory. The completion plan records 115 legacy command declarations across the included archives and keeps 114 initial behavior-map rows in `decision-required`; command-name similarity alone does not establish feature parity. Dynamic registration, archived aliases, components, website routes, scheduled work, and legacy functions may therefore be absent here. Use the source-linked behavior map and acceptance tests to close those gaps before treating the fleet as complete.
