# Ei Point bot commands and functions

This catalog lists commands currently defined by the checked-in bot code, plus the non-command functions wired into each bot. It is a source-level reference, not proof that commands are registered in Discord, work in a live guild, or match every legacy bot behavior. The source-to-target parity gate remains open; see [the feature matrix](feature-matrix.md), [legacy behavior map](audits/legacy-behavior-map.json), and the local completion build plan provided with the project assets.

For the owner-approved command surface and command-by-command target behavior, see the [product command and runtime spec](product/bot-command-and-runtime-spec.md). That target spec is not an implementation-completion claim.

The six current identities are Kafka, Cyrene, Robin, Cipher, SilverWolf, and Himiko. `security` and `moderation` are modules served by the single Kafka gateway; they are not separate production identities in the current default roster.

## At a glance

| Bot | Main function | Command source |
|---|---|---|
| [Kafka](#kafka) | Security, moderation, audit/event logging | `apps/bots/kafka/src/index.ts`, security and moderation command modules |
| [Cyrene](#cyrene) | Mention chat, persona and conversation state, TTS, local translation | `apps/bots/ai/src/commands.ts`, `apps/bots/ai/src/tts.ts`, `apps/bots/ai/src/translate.ts` |
| [Robin](#robin) | Music search, playback, voice and queue management | `apps/bots/music-py/src/main.py` |
| [Cipher](#cipher) | Service catalog, orders, payment claims, settlement, referrals | `apps/bots/commerce/src/commands.ts` |
| [SilverWolf](#silverwolf) | Rank readout, cards, games, inventory, market and trades | `apps/bots/community/src/commands.ts` |
| [Himiko](#himiko) | Welcome/leave, XP, levels, leaderboard, embed previews and announcements | `apps/bots/himiko/src/community-commands.ts`, `apps/bots/himiko/src/commands.ts` |

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
| `/kick <user> <reason>` | Remove a manageable guild member and create a durable, idempotent audit case. |
| `/warn add <user> <reason>` | Record and issue a formal warning. |
| `/warn remove <case_id> <reason>` | Void a guild-scoped warning case and write a removal audit case. |
| `/ban <user> <reason> [days]` | Ban a user and optionally delete up to seven days of message history. |
| `/unban <user_id> <reason>` | Unban a user by ID and record the moderation action. |
| `/timeout apply <user> <minutes> <reason>` | Apply a bounded member timeout. |
| `/timeout remove <user> <reason>` | Clear a member timeout after persisting a durable moderation intent. |
| `/temp ban <user> <minutes> <reason>` | Apply a temporary ban and unban it through durable expiry reconciliation. |
| `/temp mute <user> <minutes> <reason>` | Apply a temporary Discord timeout, capped at 28 days. |
| `/temp role <user> <role> <minutes> <reason>` | Grant a manageable non-administrator role with a durable expiry record. |
| `/temp restriction <user> <channel> <minutes> <reason>` | Deny message and thread posting temporarily, snapshotting prior overwrite bits for restoration. |
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
| `/botinfo` | Show Cyrene's identity, responsibilities, server count, and uptime. |
| `/ping` | Show Discord gateway latency. |
| `/about` | Describe Ei Point and Ei-Flow and mention the configured owner. |
| Direct mention | Chat with Cyrene in an allowed text channel; old chat slash commands are no longer registered. |
| `/speak <text>` | Generate and attach an audio file, with text limited to 500 characters. |
| `/tts` | Join the caller's voice channel and read new text-chat messages aloud; bounded queue and idle-human departure are implemented. |
| `/leave` | End Cyrene's active voice session. |
| `/search <query>` | Asks Cyrene's AI model to answer the question (no external/web search source; owner decision 2026-10-16). Shares the mention conversation memory, daily token budget and provider router; unavailable/budget states are answered honestly. |
| `/translate <text> <target_language> [source_language]` | Translate up to 500 characters through the private local Hy-MT2 service. Source language is optional and auto-detected when omitted. |

### Other functions

- Route AI mentions through a configured OpenAI-compatible primary provider and optional fallback; local compatible endpoints may omit API keys.
- Keep guild/user conversation threads, recent messages, summaries, persona preferences, and usage records in PostgreSQL.
- Read new messages from the active voice channel's text chat, enforce Ei-Flow authorization, rate and queue limits, and coordinate voice admission with Robin through database leases.
- Synthesize through the private, offline local Qwen service. Provisioning model weights and target-VPS CPU/audible acceptance remain open.
- Translate through a separate offline local Hy-MT2 service with one inference slot, eight waiting requests and a 60-second request deadline. Translation text is not stored in Cyrene's conversation history; pinned model provisioning, target-VPS performance and language-quality acceptance remain open.

## Robin

### Commands

| Command | Function |
|---|---|
| `/botinfo` | Show Robin's identity and status. |
| `/ping` | Show Discord gateway latency. |
| `/about` | Describe Ei Point and Ei-Flow and mention the configured owner. |
| `/play <link>` | Play or enqueue a song or playlist link (owner requirement 2026-10-17): non-links are refused; a playlist link enqueues up to 50 tracks (bounded), each resolved lazily in order. Spotify track/playlist/album links resolve metadata through Spotify's public embed endpoint and play as bounded YouTube searches. |
| `/stop` | Stop playback, clear the queue, and leave voice. |
| `/queue` | Display upcoming tracks. |
| `/disconnect` | Disconnect Robin from the voice channel. |

Pause/resume, skip, shuffle, loop and volume are **live-panel buttons** now (owner decision 2026-10-18): one components-v2 panel message per session, with the controls rendered inside the panel block and themed per character.

### Other functions

- Resolve media using yt-dlp (plus Spotify public-embed metadata with lazy YouTube-search playback) and stream through FFmpeg; bound metadata-resolution concurrency and voice sessions. The next queued track is warmed in the background (pre-resolved and cached, owner feedback 2026-10-18) so songs start quickly, and cache downloads prefer the already-resolved direct URL.
- Advance queues, maintain playback state, and support track/queue loop modes. Search/nowplaying/seek/autoplay/DJ-administration and the panel-covered controls (pause/resume/skip/shuffle/loop/volume) are removed from public sync.
- Keep the queue session-scoped (owner decision 2026-10-18): leaving voice clears it and nothing is restored across restarts. The live music panel puts DJ-gated pause/resume, skip, shuffle, loop and volume controls inside one themed components-v2 message per session, using the character palette taken from each bot's own artwork.
- Maintain a size/TTL-bounded local audio cache and expose health/readiness status.

## Cipher

### Commands

| Command | Function |
|---|---|
| `/botinfo` | Show Cipher's identity and status. |
| `/ping` | Show Discord gateway latency. |
| `/about` | Describe Ei Point and Ei-Flow and mention the configured owner. |
| `/orders list` | List active services and server-set prices. |
| `/orders create <sku>` | Create an order with server-authoritative pricing and configured UPI instructions. |
| `/orders status <order_id>` | Check an order within buyer/staff authorization scope. |
| `/orders claim <order_id> <proof>` | Submit a payment reference for staff review; the claim is not confirmation. |
| `/orders settle <order_id>` | Settle a claimed order for authorized staff. |
| `/referral link` | Create or retrieve a referral code/link. |
| `/referral redeem <code>` | Save a valid guild-scoped referral code for the caller's next order. |
| `/referral status` | Show referral activity and current-cycle rewards. |
| `/payment` | Show which payment methods are configured; this deployment currently lacks card/wallet checkout. |

### Other functions

- Create durable orders with server-authoritative catalog values and payment tokens; record claims and settlement state transactionally.
- Build UPI payment payloads; Razorpay card/wallet checkout and production payment reconciliation remain unimplemented.
- Expose corresponding website API checkout, claim, status, and settlement flows through the web/API services.

## SilverWolf

### Commands

| Command | Function |
|---|---|
| `/rank [user]` | Show a member's XP, level, and rank. |
| `/cards [page]` | Browse the card catalog. |
| `/inventory [page]` | List owned card instances. |
| `/packs` | List available card packs. |
| `/open <pack>` | Buy/open a pack at its server-defined price, subject to inventory and supply checks. |
| `/sell <instance> <price>` | Place a card instance into a market listing/escrow. |
| `/market [page]` | Browse open market listings. |
| `/buy <listing>` | Purchase an open listing transactionally. |
| `/trade offer <recipient> [offered] [requested] [offered_amount] [requested_amount] [ttl]` | Create a trade offer containing cards and/or berries with an expiry. |
| `/trade accept <id>` | Accept a trade addressed to the caller. |
| `/trade cancel <id>` | Cancel or reject a trade offer. |
| `/balance` | Show the caller's berries balance. |
| `/botinfo` | Show SilverWolf's identity and status. |
| `/ping` | Show Discord gateway latency. |
| `/about` | Describe Ei Point and Ei-Flow and mention the configured owner. |

### Other functions

- Keep the `/rank` profile read-only; Himiko owns XP awards, welcome/leave events, and level announcements.
- Enforce guild scope, guild-owner-only catalog/economy administration, transaction boundaries, inventory uniqueness, and trade/market contention checks.
- Keep economy balances, cards, game state, inventory, listings, trades, and operation receipts in PostgreSQL.

## Himiko

### Commands

| Command | Function |
|---|---|
| `/botinfo` | Show Himiko's identity and status. |
| `/ping` | Show Discord gateway latency. |
| `/about` | Describe Ei Point and Ei-Flow and mention the configured owner. |
| `/announcement <channel> <title> <description> [color] [ping_role]` | Validate and queue a styled announcement for delivery to a text/announcement channel. |
| `/embed <title> <description> [color]` | Build and return a validated embed preview without choosing a destination channel. |
| `/setwelcome <channel> <message>` | Set the welcome destination and template. Requires Manage Server. |
| `/setleave <channel> <message>` | Set the leave destination and template. Requires Manage Server. |
| `/testwelcome [event]` | Preview the current welcome or leave template. Requires Manage Server. |
| `/xp [enabled] [amount] [cooldown] [voice_enabled] [voice_amount] [voice_interval]` | Configure text XP and opt-in voice XP, award sizes, and cooldown intervals. Requires Manage Server. |
| `/setlevelchannel <channel>` | Choose where level-up embeds are delivered. Requires Manage Server. |
| `/leaderboard` | Show the top ten members by XP. |

### Other functions

- Validate channel/role IDs, non-empty content, title/body limits, and six-digit hex colors before building payloads.
- Persist announcement intent and deliver through the dedicated delivery/worker path; scheduled delivery is not represented as a user-facing slash command in the current definitions.
- Own welcome/leave events, text XP and opt-in voice XP. Voice awards require at least two human members in a non-AFK channel; bots and self/server-deafened members do not earn voice XP. Text and voice use independent per-member cooldown timestamps, and awards persist transactionally.
- Deliver welcome, leave, and level-up notifications through a leased, retryable outbox and branded embeds.
- Report delivery/readiness state without treating an accepted queue operation as proof of live Discord delivery.

## API-key configuration count

The supplied completion plan names **zero specific third-party API keys** as required configuration; it refers to external credentials generally without naming providers. In the current `.env.example`, there are two optional provider-key slots:

| Variable | Requirement | Used for |
|---|---|---|
| `AI_PROVIDER_PRIMARY_KEY` | Optional for a local compatible endpoint | Primary AI provider authentication |
| `AI_PROVIDER_FALLBACK_KEY` | Optional for a local fallback endpoint | AI fallback provider authentication |

This count excludes Discord bot tokens, database credentials, payment addresses, and OAuth secrets because they are not provider API keys. See [.env.example](../.env.example) and the [bot identity runbook](bot-identities.md) for configuration context.

## Scope and verification status

This document follows the **current command definitions**, not the complete archived behavior inventory. The completion plan records 115 legacy command declarations across the included archives and keeps 114 initial behavior-map rows in `decision-required`; command-name similarity alone does not establish feature parity. Dynamic registration, archived aliases, components, website routes, scheduled work, and legacy functions may therefore be absent here. Use the source-linked behavior map and acceptance tests to close those gaps before treating the fleet as complete.
