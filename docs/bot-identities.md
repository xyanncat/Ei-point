# Bot identities — Kafka / Cyrene / Robin / Cipher / SilverWolf / Himiko

Source: operator roster (2026-10-12). Identity ≠ modules: `config.bots` + `BOT_KEY` env
assign modules to identities; no hard-coded bot lists in code.

| # | Identity | Modules | Responsibilities | Secret ref | Process today |
|---|---|---|---|---|---|
| 1 | Kafka | security, moderation, logging | Full security & moderation: antinuke, raid, trust, whitelist, lockdown, snapshots, warns/bans/timeouts/purge, mod roles, AutoMod, all event logs | `DISCORD_KAFKA_BOT_TOKEN` (fallback `DISCORD_SECURITY/MODERATION_BOT_TOKEN`) | `bot-security` + `bot-moderation`, both `BOT_KEY=kafka` (transitional; merge to single Kafka process is P0) |
| 2 | Cyrene | ai, search, tts | AI chat + TTS voice playback, persona, memory, search | `DISCORD_CYRENE_BOT_TOKEN` + `AI_PROVIDER_*` + `TTS_*` | `bot-ai` (`BOT_KEY=cyrene`); TTS is new scope — see below |
| 3 | Robin | music | Music and playback: picker, queue, loop/shuffle/seek/autoplay, masters/DJ, cache, 15s snapshots | `DISCORD_ROBIN_BOT_TOKEN` | `bot-music` (`BOT_KEY=robin`) |
| 4 | Cipher | commerce | Payment & referral: catalog, UPI/USDT QR, orders, claims, settlement, referrals, rewards | `DISCORD_CIPHER_BOT_TOKEN` + UPI/USDT config | `bot-commerce` (`BOT_KEY=cipher`) |
| 5 | SilverWolf | community, games | Welcome/leave, XP/levels/leaderboard, cards/packs/inventory/market/trades, balances | `DISCORD_SILVERWOLF_BOT_TOKEN` | `bot-community` (`BOT_KEY=silverwolf`) |
| 6 | Himiko | embed, announce | Embed messages & announcements composer, scheduled announcements | `DISCORD_HIMIKO_BOT_TOKEN` | Via dashboard API + workers outbox today; dedicated gateway process is P1 |

## Permissions (least-privilege target)

- Kafka: ViewAuditLog, ManageGuild (lockdown only), ModerateMembers, ManageMessages, BanMembers, KickMembers.
- Cyrene: SendMessages, EmbedLinks, AttachFiles, Connect, Speak (TTS voice playback only; no music queue control).
- Robin: Connect, Speak, UseVAD, SendMessages, EmbedLinks.
- Cipher: SendMessages, EmbedLinks, AttachFiles.
- SilverWolf: SendMessages, EmbedLinks, AddReactions, ManageMessages (purge-scoped if granted).
- Himiko: SendMessages, EmbedLinks, ManageMessages (announce edits only).

## Cyrene TTS v1 (voice playback) — scope agreed 2026-10-12

- Provider-agnostic TTS synthesis behind the existing AI provider router budgets (2 concurrent, 20 queued, 60s deadline).
- Bounded voice use: max 2 concurrent TTS voice sessions (shared §5 envelope with Robin — total 2 simultaneous voice sessions across Cyrene+Robin until VPS load test says otherwise).
- Cache synthesized clips by (provider, voice, text-hash) on the `music-cache`-style volume with LRU cap; never cache PII-bearing text longer than the retention window.
- Commands (new, to be added to `bot-ai`): `/speak` (join caller voice, speak text, leave on idle), `/tts-voice` (per-guild/per-user voice select), `/tts-stop`.
- Safety: fail closed on DB/provider outage (moderation/security unaffected), redact secrets from TTS input logs, cap input length (e.g. 500 chars), rate-limit per user/guild.
- Acceptance: TTS speaks in caller channel within deadline, concurrent Robin playback unaffected, restart drops voice but preserves AI memory, no unacknowledged interaction.

## Cutover checklist

1. Create 6 Discord applications; store IDs via `008_bot_identities.sql` seed update (replace `pending-*`).
2. Set the 6 `DISCORD_*_BOT_TOKEN` vars in test-guild `.env`; verify each process logs its `BOT_KEY` and leaves unapproved guilds.
3. Kafka merge (BUILT 2026-10-12, cutover profile): `apps/bots/kafka` serves
   security+moderation+logging on one gateway connection with `BOT_KEY=kafka`.
   Start with `docker compose --profile cutover up bot-kafka` (port 3108
   side-by-side), verify, then retire bot-security/bot-moderation and move Kafka to 3101.
4. Himiko process (BUILT 2026-10-12, cutover profile): `apps/bots/himiko`
   serves /announce + /embed with destination-channel permission checks.
   Start with `docker compose --profile cutover up bot-himiko` (port 3107).
5. Cyrene TTS (BUILT 2026-10-12, provider staging gate): `packages/modules/tts`
   + /speak + /tts-voice + /tts-stop wired in `apps/bots/ai`. Voice playback
   needs TTS_PROVIDER_URL/KEY and @discordjs/voice media (FFmpeg/opus) on the
   VPS image — verify audibly in the test guild before main cutover.
6. Remove legacy `DISCORD_SECURITY_*` etc. fallbacks after main-guild cutover.
