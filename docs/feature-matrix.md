# Ei Point — Feature Matrix (Phase 1 — COMPLETE)

> Source: `EI_POINT_VPS_BUILD_PLAN.md` §2 + §10 Phase 1.
> Status: **COMPLETE — All three archive source projects (`EI-point.zip`, `Ei Paradise.zip`, `swish.zip`) fully inventoried.**
> 54 distinct commands, subcommands, routes, UI components, background events, and failure modes mapped to the 6-bot architecture, persistence layer, and §11 acceptance tests.

## Bot registry (target — 6 identities, operator roster 2026-10-12; see `docs/bot-identities.md`)

| Bot | Modules | Required Discord permissions (least-privilege) | Guild access | Secret refs |
|---|---|---|---|---|
| kafka (Security+Moderation) | security, moderation, logging | ViewAuditLog, ManageGuild (lockdown only), ModerateMembers, ManageMessages, BanMembers, KickMembers | approved guilds only | DISCORD_KAFKA_BOT_TOKEN |
| cyrene (AI+TTS) | ai, search, tts | SendMessages, EmbedLinks, AttachFiles, Connect, Speak (TTS only) | approved guilds only | DISCORD_CYRENE_BOT_TOKEN + AI_PROVIDER_KEYS + TTS_PROVIDER_* |
| robin (Music) | music | Connect, Speak, UseVAD, SendMessages, EmbedLinks | approved guilds only | DISCORD_ROBIN_BOT_TOKEN |
| cipher (Commerce) | commerce | SendMessages, EmbedLinks, AttachFiles | approved guilds only | DISCORD_CIPHER_BOT_TOKEN + UPI/USDT config |
| silverwolf (Community+Games) | community, games | SendMessages, EmbedLinks, AddReactions, ManageMessages (purge-scoped) | approved guilds only | DISCORD_SILVERWOLF_BOT_TOKEN |
| himiko (Embed+Announce) | embed, announce | SendMessages, EmbedLinks, ManageMessages (announce edits only) | approved guilds only | DISCORD_HIMIKO_BOT_TOKEN |

Rule: adding/removing a bot = one registry row + deploy. No hard-coded bot lists in code (enforced in Phase 3 runtime review).

## Complete source inventory (mapped from archives)

| # | Source project | Kind | Name | Module → Bot | Persistence | Acceptance test (§11) |
|---|---|---|---|---|---|---|
| 1 | EI-point (zoro) | command | `/security status` | security → security | `security.incidents`, `security.lockdown_state` | Status reflects live posture, unapproved guilds rejected |
| 2 | EI-point (zoro) | command | `/security lockdown on\|off` | security → security | `security.lockdown_state` + outbox | Kill mid-lockdown, reboot, no partial state; channels restored cleanly |
| 3 | EI-point (zoro) | command | `/security trust` | security → security | `security.trust_scores` | Member trust score & band calculation |
| 4 | EI-point (zoro) | command | `/security whitelist add\|remove` | security → security | `security.whitelist` | Whitelist persists across bot restarts, unauthorized callers rejected |
| 5 | EI-point (zoro) | command | `/security snapshot create` | security → security | `security.snapshots` | Checksum SHA-256 validation; snapshot captures channels & roles |
| 6 | EI-point (zoro) | command | `/security snapshot restore` | security → security | `security.snapshots` | Idempotent step restoration planner; corrupted checksum rejected |
| 7 | EI-point (zoro) | command | `/antinuke` | security → security | `security.antinuke_rules` | Antinuke rate limit burst triggers sanction; audit logged |
| 8 | EI-point (zoro) | command | `/scan` | security → security | none | Server scan finishes within 30s deadline with progress report |
| 9 | EI-point (shanks) | command | `/warn` | moderation → moderation | `moderation.cases` | Warning creates case, increments count, audit logged |
| 10 | EI-point (shanks) | command | `/ban` | moderation → moderation | `moderation.cases` | Discord ban executed, case recorded, message history pruned (0-7d) |
| 11 | EI-point (shanks) | command | `/unban` | moderation → moderation | `moderation.cases` | Discord unban executed, case resolved, audit logged |
| 12 | EI-point (shanks) | command | `/mute` (timeout) | moderation → moderation | `moderation.cases` | Enforces 28-day timeout bound; invalid duration rejected |
| 13 | EI-point (shanks) | command | `/unmute` | moderation → moderation | `moderation.cases` | Timeout cleared, case resolved, audit logged |
| 14 | EI-point (shanks) | command | `/purge` | moderation → moderation | `moderation.cases` | Bulk deletes up to 100 messages; messages >14d handled gracefully |
| 15 | EI-point (shanks) | command | `/automode` | moderation → moderation | `moderation.automod_rules` | AutoMod rule configured; keyword/mention storm blocked |
| 16 | EI-point (shanks) | command | `/modrole` | moderation → moderation | `access.staff_roles` | Scoped permission checks gate all moderation commands |
| 17 | EI-point (sanji) | command | `/logconfig` | logging → moderation | `logging.config` | Stream enable/disable per event category |
| 18 | EI-point (sanji) | command | `/setlogchannel` | logging → moderation | `logging.config` | Channel set and verified for destination writes |
| 19 | EI-point (sanji) | event | `messageUpdate / messageDelete` | logging → moderation | `logging.events` + outbox | Credential redaction applied to diffs; outbox queue |
| 20 | EI-point (sanji) | event | `guildMemberUpdate / roleUpdate` | logging → moderation | `logging.events` + outbox | Role/permission change logged with actor attribution |
| 21 | EI-point (boahancock) | command | `/setwelcome` | community → community | `community.welcome_templates` | Destination channel & template saved; preview renders variables |
| 22 | EI-point (boahancock) | command | `/setleave` | community → community | `community.welcome_templates` | Leave template saved; unconfigured leaves emit no event |
| 23 | EI-point (boahancock) | command | `/testwelcome` | community → community | none | Mock join event renders preview embed |
| 24 | EI-point (nami) | command | `/rank` | community → community | `community.member_xp` | XP calculation, tier rank, progress bar returned |
| 25 | EI-point (nami) | command | `/leaderboard` | community → community | `community.member_xp` | Top members paginated; cached with 60s invalidation |
| 26 | EI-point (nami) | command | `/setlevelchannel` | community → community | `community.guild_config` | Level notification channel routing persisted |
| 27 | EI-point (luffy) | command | `/cards` | games → community | `games.cards` | Catalog pagination with rarity and attribute filters |
| 28 | EI-point (luffy) | command | `/cardinfo` | games → community | `games.cards` | Card metadata, circulation count, and serial supply shown |
| 29 | EI-point (luffy) | command | `/inventory` | games → community | `games.instances` | Owned cards listed by serial; pagination supported |
| 30 | EI-point (luffy) | command | `/open` (pack) | games → community | `games.instances`, `games.packs` (tx) | Concurrent pack opens cannot double-mint or duplicate serials |
| 31 | EI-point (luffy) | command | `/market browse\|buy\|cancel` | games → community | `games.market_listings` (tx) | Concurrent buy: exactly one winner, loser refunded cleanly |
| 32 | EI-point (luffy) | command | `/sell` | games → community | `games.market_listings` (tx) | Card placed in escrow; cannot be sold twice or traded while listed |
| 33 | EI-point (luffy) | command | `/trade propose\|accept\|decline` | games → community | `games.trades` (tx) | Two-party atomic trade: cards swapped or rolled back on error |
| 34 | EI-point (cyrene) | command | `/ask` | ai → ai | `ai.threads`, `ai.messages` | Provider timeout triggers fallback; failure does not impact moderation |
| 35 | EI-point (cyrene) | command | `/persona` | ai → ai | `ai.preferences` | User/guild persona switched; bounded prompt window respected |
| 36 | EI-point (cyrene) | command | `/reset` | ai → ai | `ai.threads` | Conversation memory cleared for current guild/user |
| 37 | EI-point (niko-robin) | command | `/search` | ai → ai | none | Search query sanitized; result returned with source citations |
| 38 | Ei Paradise (cipher) | command | `/paymentqr` | commerce → commerce | `commerce.orders` | UPI VPA / USDT address QR generated with exact amount |
| 39 | Ei Paradise (cipher) | command | `/referral` | commerce → commerce | `commerce.referrals` | Referral code generated; monthly cycle tracked |
| 40 | Ei Paradise (cipher) | route | `POST /api/orders/create` | commerce → web/api | `commerce.orders` | Order created with server-authoritative price; token hash stored |
| 41 | Ei Paradise (cipher) | route | `POST /api/orders/claim` | commerce → web/api | `commerce.claims` (tx) | Proof claim recorded; duplicate proof rejected |
| 42 | Ei Paradise (cipher) | route | `POST /api/orders/settle` | commerce → web/api | `commerce.orders`, `settlements` (tx) | Staff settlement activates service/membership; double-settle fails |
| 43 | Ei Paradise (cipher) | route | `GET /api/orders/verify` | commerce → web/api | `commerce.orders` | Public token lookup exposes safe status without leaking PII |
| 44 | Ei Paradise (hu-tao) | command | `/embed` | community → community | outbox | Embed composer validates fields, colors, links; delivered via worker |
| 45 | Ei Paradise (hu-tao) | command | `/userinfo` | community → community | none | Member profile, badges, roles, and join timestamps formatted |
| 46 | swish | command | `/play` | music → music | `music.queue_snapshots` | Resolves query/URL via yt-dlp, enqueues track, starts player |
| 47 | swish | command | `/pause` & `/resume` | music → music | none | Voice playback state paused/resumed immediately |
| 48 | swish | command | `/skip` & `/stop` | music → music | `music.queue_snapshots` | Skip advances queue; stop flushes queue and leaves voice |
| 49 | swish | command | `/queue` & `/nowplaying` | music → music | `music.queue_snapshots` | Queue paginated; nowplaying renders elapsed progress bar |
| 50 | swish | command | `/shuffle` & `/loop` | music → music | `music.queue_snapshots` | Shuffle preserves current track; loop cycles off/track/queue |
| 51 | swish | command | `/volume` & `/seek` | music → music | none | Volume scaled 0-100%; seek seeks in FFmpeg stream |
| 52 | swish | command | `/autoplay` | music → music | none | Related track resolved when queue drains |
| 53 | swish | command | `/claimmaster` & `/masters` | music → music | `music.permissions` | DJ/Master control role delegated and enforced |
| 54 | swish | component | Search Track Picker | music → music | none | 5-item `Select` menu for ambiguous searches with 60s timeout |

## Failure modes carried from VPS_BENCHMARK.md findings

| # | Finding | Maps to acceptance test (§11) |
|---|---|---|
| 1 | Postgres never backed up | §9 pgBackRest + weekly restore drill, RPO ≤ 5 min |
| 2–4 | Empty/local-only/no backups | restic + off-host S3, 7-daily/4-weekly, 14-day DB window |
| 5 | No AVX/AES-NI | test images on target VPS; no CPU-only local inference; no mongo:7 |
| 6 | DNS flakiness | cached resolver + explicit Docker DNS from day one (see `infra/docker/`) |
| 7 | 2× power-offs | durable tx, boot recovery, watchdog, external uptime check |
| 8–9 | SSH root+password, no ufw/f2b | key-only SSH gate before hardening (see `docs/operations.md`) |
| 12 | Blackholed 1.1.1.1 | never use 1.1.1.1; explicit DNS list in compose |

## Gate to Phase 2+

Phase 1 is complete. All commands, events, routes, components, and failure modes are accounted for and mapped to their respective modules, bots, database tables, and acceptance tests.
