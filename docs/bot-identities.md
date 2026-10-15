# Bot identities — Kafka / Cyrene / Robin / Cipher / SilverWolf / Himiko

Source: operator roster (2026-10-12). Identity ≠ modules: `config.bots` + `BOT_KEY` env
assign modules to identities. The table describes intended responsibility and source entrypoints; it does not establish deployed feature parity. See [feature-matrix.md](feature-matrix.md) and [archive-command-inventory.json](archive-command-inventory.json) for the open source/acceptance traceability gate.

| # | Identity | Modules | Responsibilities | Secret ref | Process today |
|---|---|---|---|---|---|
| 1 | Kafka | security, moderation, logging | Full security & moderation: antinuke, raid, trust, whitelist, lockdown, snapshots, warns/bans/timeouts/purge, mod roles, AutoMod, all event logs | `DISCORD_KAFKA_BOT_TOKEN` (fallback `DISCORD_SECURITY/MODERATION_BOT_TOKEN`) | `apps/bots/kafka` is the consolidated gateway implementation (`BOT_KEY=kafka`); deployment must stop the legacy pair before using that identity |
| 2 | Cyrene | ai, search, tts | AI chat + TTS voice playback, persona, memory, search | `DISCORD_CYRENE_BOT_TOKEN` + `AI_PROVIDER_*` + `TTS_*` | `bot-ai` (`BOT_KEY=cyrene`), including TTS commands; provider/voice staging acceptance pending |
| 3 | Robin | music | Music and playback: picker, queue, loop/shuffle/seek/autoplay, masters/DJ, streaming, 15s snapshots | `DISCORD_ROBIN_BOT_TOKEN` | `bot-music` (`BOT_KEY=robin`) |
| 4 | Cipher | commerce | Payment & referral: catalog, UPI/USDT QR, orders, claims, settlement, referrals, rewards | `DISCORD_CIPHER_BOT_TOKEN` + UPI/USDT config | `bot-commerce` (`BOT_KEY=cipher`) |
| 5 | SilverWolf | community, games | Welcome/leave, XP/levels/leaderboard, cards/packs/inventory/market/trades, balances | `DISCORD_SILVERWOLF_BOT_TOKEN` | `bot-community` (`BOT_KEY=silverwolf`) |
| 6 | Himiko | embed, announce | Embed messages & announcements composer, scheduled announcements | `DISCORD_HIMIKO_BOT_TOKEN` | `apps/bots/himiko` provides a dedicated gateway; dashboard API and worker delivery are separate paths |

## Permissions (least-privilege target)

- Kafka: ViewAuditLog, ManageGuild (lockdown only), ModerateMembers, ManageMessages, BanMembers, KickMembers.
- Cyrene: SendMessages, EmbedLinks, AttachFiles, Connect, Speak (TTS voice playback only; no music queue control).
- Robin: Connect, Speak, UseVAD, SendMessages, EmbedLinks.
- Cipher: SendMessages, EmbedLinks, AttachFiles.
- SilverWolf: SendMessages, EmbedLinks, AddReactions, ManageMessages (purge-scoped if granted).
- Himiko: SendMessages, EmbedLinks, ManageMessages (announce edits only).

## Cyrene TTS v1 — implementation and remaining acceptance (2026-10-14)

- TTS uses its own injected provider queue: 2 concurrent syntheses, 10 waiting requests and a 30-second synthesis deadline. It does not currently share AI daily token accounting. Missing provider configuration or failures produce a failed response.
- Fleet voice admission uses PostgreSQL leases shared by Cyrene and Robin, with a total limit of 2 sessions. Local transaction tests establish admission behavior; audible coexistence and target-VPS load remain staging gates.
- Cache-key hashing is implemented, but no persistent synthesized-clip cache or LRU eviction is implemented. Robin now has a 10 GiB published-audio LRU/TTL cache with 50 MiB per-item staging, bounded subprocess downloads and active-file pins. Persistent synthesized TTS clip caching remains unimplemented.
- `/speak`, `/tts-voice` (per-guild default) and `/tts-stop` are implemented in `apps/bots/ai`; successful playback releases the voice connection. Input is capped at 500 characters and likely secrets are refused. Queue bounds do not establish per-user/guild rate limits.
- The AI image declares FFmpeg and an Opus encoder dependency; Robin declares Discord voice dependencies. These prerequisites still require a clean image build and audible playback on the target platform.
- Acceptance still needed: configured-provider synthesis, caller-channel playback within the deadline, concurrent Robin playback, restart recovery, per-user/guild rate-limit policy and no unacknowledged interactions.

## Cutover checklist

1. Create 6 Discord applications; store IDs via `008_bot_identities.sql` seed update (replace `pending-*`).
2. Set the 6 `DISCORD_*_BOT_TOKEN` vars in test-guild `.env`; verify each process logs its `BOT_KEY` and leaves unapproved guilds.
3. Use the consolidated `apps/bots/kafka` gateway for Kafka. Stop `bot-security` and `bot-moderation` before starting any replacement with the same application token. Side-by-side processes using one identity are not a safe cutover procedure; verify the selected release fleet and readiness before main-guild admission.
4. Include the dedicated `apps/bots/himiko` process deliberately in the release fleet and verify destination-channel permissions and delivery in the test guild.
5. Set AI primary-provider URL/key/model (`AI_PROVIDER_PRIMARY`, `AI_PROVIDER_PRIMARY_KEY`, `AI_PROVIDER_PRIMARY_MODEL`) and TTS provider URL/key for Cyrene. An optional AI fallback requires its URL/key/model together; the bot supplies the configured model without a default. Build the current image, verify FFmpeg/Opus voice prerequisites, then test `/speak`, `/tts-voice` and `/tts-stop` audibly alongside Robin. Source presence and unit tests do not certify playback.
6. Remove legacy `DISCORD_SECURITY_*` etc. fallbacks after main-guild cutover.
