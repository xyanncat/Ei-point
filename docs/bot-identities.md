# Bot identities — Kafka / Cyrene / Robin / Cipher / SilverWolf / Himiko

Source: operator roster (2026-10-12). Identity ≠ modules: `config.bots` + `BOT_KEY` env
assign modules to identities. The table describes intended responsibility and source entrypoints; it does not establish deployed feature parity. See [feature-matrix.md](feature-matrix.md) and [archive-command-inventory.json](archive-command-inventory.json) for the open source/acceptance traceability gate.

| # | Identity | Modules | Responsibilities | Secret ref | Process today |
|---|---|---|---|---|---|
| 1 | Kafka | security, moderation, logging | Full security & moderation: antinuke, raid, trust, whitelist, lockdown, snapshots, warns/bans/timeouts/purge, mod roles, AutoMod, all event logs | `DISCORD_KAFKA_BOT_TOKEN` (fallback `DISCORD_SECURITY/MODERATION_BOT_TOKEN`) | `apps/bots/kafka` is the consolidated gateway implementation (`BOT_KEY=kafka`); deployment must stop the legacy pair before using that identity |
| 2 | Cyrene | ai, search, tts, translate | AI chat + local Qwen TTS voice playback, local Hy-MT2 translation, persona, memory, search | `DISCORD_CYRENE_BOT_TOKEN` + `AI_PROVIDER_*` for chat; local Qwen/Hy-MT2 models and reference/persona mounts | `bot-ai` (`BOT_KEY=cyrene`) calls offline `tts-qwen` and `hy-mt2`; model and target-host acceptance pending |
| 3 | Robin | music | Music and playback: picker, queue, loop/shuffle/seek/autoplay, masters/DJ, streaming, 15s snapshots | `DISCORD_ROBIN_BOT_TOKEN` | `bot-music` (`BOT_KEY=robin`) |
| 4 | Cipher | commerce | Payment & referral: catalog, UPI/USDT QR, orders, claims, settlement, referrals, rewards | `DISCORD_CIPHER_BOT_TOKEN` + UPI/USDT config | `bot-commerce` (`BOT_KEY=cipher`) |
| 5 | SilverWolf | games | `/rank` readout plus cards/packs/inventory/market/trades and balances | `DISCORD_SILVERWOLF_BOT_TOKEN` | `bot-community` (`BOT_KEY=silverwolf`) |
| 6 | Himiko | embed, announce, welcome, community, leveling | Announcements, welcome/leave, text and opt-in voice XP, levels and leaderboard | `DISCORD_HIMIKO_BOT_TOKEN` | `apps/bots/himiko` owns the community gateway events and notification outbox |

## Permissions (least-privilege target)

- Kafka: ViewAuditLog, ManageGuild (lockdown only), ModerateMembers, ManageMessages, BanMembers, KickMembers.
- Cyrene: SendMessages, EmbedLinks, AttachFiles, Connect, Speak (TTS voice playback only; no music queue control).
- Robin: Connect, Speak, UseVAD, SendMessages, EmbedLinks.
- Cipher: SendMessages, EmbedLinks, AttachFiles.
- SilverWolf: SendMessages, EmbedLinks, AddReactions, ManageMessages (purge-scoped if granted).
- Himiko bot permissions: SendMessages and EmbedLinks. Callers of community setup commands need Manage Server; announcement callers need Manage Messages or the configured announce staff scope. Enable the privileged **Server Members Intent** for join/leave events and voice member state; message content is not required for XP awards.

## Cyrene TTS v1 — implementation and remaining acceptance (2026-10-14)

- TTS uses its own injected provider queue: 2 concurrent syntheses, 10 waiting requests and a 30-second synthesis deadline. It does not currently share AI daily token accounting. Missing provider configuration or failures produce a failed response.
- Fleet voice admission uses PostgreSQL leases shared by Cyrene and Robin, with a total limit of 2 sessions. Local transaction tests establish admission behavior; audible coexistence and target-VPS load remain staging gates.
- Cache-key hashing is implemented, but no persistent synthesized-clip cache or LRU eviction is implemented. Robin now has a 10 GiB published-audio LRU/TTL cache with 50 MiB per-item staging, bounded subprocess downloads and active-file pins. Persistent synthesized TTS clip caching remains unimplemented.
- `/speak`, `/tts`, and `/leave` are implemented in `apps/bots/ai`. `/speak` sends a generated audio file in the command channel; `/tts` joins the caller's voice channel and reads new messages from that voice channel's text chat, while `/leave` ends the session. Each read message is capped at 500 characters, the queue is bounded, and the session leaves when no human members remain. Queue bounds do not establish per-user/guild rate limits.
- The AI image declares FFmpeg and an Opus encoder dependency; Robin declares Discord voice dependencies. These prerequisites still require a clean image build and audible playback on the target platform.
- Acceptance still needed: configured-provider synthesis, caller-channel playback within the deadline, concurrent Robin playback, restart recovery, per-user/guild rate-limit policy and no unacknowledged interactions.

## Cutover checklist

1. Create 6 Discord applications; store IDs via `008_bot_identities.sql` seed update (replace `pending-*`).
2. Set the 6 `DISCORD_*_BOT_TOKEN` vars in test-guild `.env`; verify each process logs its `BOT_KEY` and leaves unapproved guilds.
3. Use the consolidated `apps/bots/kafka` gateway for Kafka. Stop `bot-security` and `bot-moderation` before starting any replacement with the same application token. Side-by-side processes using one identity are not a safe cutover procedure; verify the selected release fleet and readiness before main-guild admission.
4. Include the dedicated `apps/bots/himiko` process deliberately in the release fleet and verify destination-channel permissions and delivery in the test guild.
5. Set AI primary-provider URL/key/model (`AI_PROVIDER_PRIMARY`, `AI_PROVIDER_PRIMARY_KEY`, `AI_PROVIDER_PRIMARY_MODEL`) for Cyrene chat. Provision the pinned local Qwen model, Hy-MT2 model, user-supplied reference audio, and Cyrene persona memory. An optional AI fallback requires its URL/model and may require a key. Enable Himiko's Server Members Intent for join/leave event delivery. Build the current images, verify FFmpeg/Opus voice prerequisites, then test `/speak`, `/tts`, `/leave`, and `/translate` alongside Robin. Source presence and unit tests do not certify playback or target-CPU performance. See the [Qwen TTS](operations/qwen-tts.md) and [Hy-MT2 translation](operations/hy-mt2.md) guides.
6. Remove legacy `DISCORD_SECURITY_*` etc. fallbacks after main-guild cutover.
