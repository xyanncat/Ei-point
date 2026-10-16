# Ei Point — Feature Matrix (Phase 1 — legacy-behavior ledger closed)

> Source: `EI_POINT_VPS_BUILD_PLAN.md` §2 + §10 Phase 1.
> Status: **Ledger closed (section 1A, 2026-10-16); the 54 curated rows remain requirements, not evidence.** The rows below are curated requirements grouped from the plan; they do not by themselves certify runtime parity.
> The reproducible file/hash and command-declaration inventory covers the three original ZIPs under explicit exclusions, and every detected declaration in `docs/audits/legacy-behavior-map.json` now has a reviewed disposition: retained with a traced target handler and named tests, or deliberately replaced with an approved decision in `docs/product/legacy-decisions.md`.

## Bot registry (target — 6 identities, operator roster 2026-10-12; see `docs/bot-identities.md`)

| Bot | Modules | Required Discord permissions (least-privilege) | Guild access | Secret refs |
|---|---|---|---|---|
| kafka (Security+Moderation) | security, moderation, logging | ViewAuditLog, ManageGuild (lockdown only), ModerateMembers, ManageMessages, BanMembers, KickMembers | approved guilds only | DISCORD_KAFKA_BOT_TOKEN |
| cyrene (AI+TTS+translate) | ai, search, tts, translate | SendMessages, EmbedLinks, AttachFiles, Connect, Speak (TTS only) | approved guilds only | DISCORD_CYRENE_BOT_TOKEN + AI_PROVIDER_* for mention chat + local Qwen/Hy-MT2 model and persona/reference mounts |
| robin (Music) | music | Connect, Speak, UseVAD, SendMessages, EmbedLinks | approved guilds only | DISCORD_ROBIN_BOT_TOKEN |
| cipher (Commerce) | commerce | SendMessages, EmbedLinks, AttachFiles | approved guilds only | DISCORD_CIPHER_BOT_TOKEN + UPI/USDT config |
| silverwolf (Games) | games | SendMessages, EmbedLinks, AddReactions | approved guilds only | DISCORD_SILVERWOLF_BOT_TOKEN |
| himiko (Community+Announcements) | embed, announce, welcome, community, leveling | SendMessages, EmbedLinks; callers need ManageGuild for community setup | approved guilds only | DISCORD_HIMIKO_BOT_TOKEN + Server Members Intent |

Rule: adding/removing a bot = one registry row + deploy. No hard-coded bot lists in code (enforced in Phase 3 runtime review).

## Curated requirements (54 grouped rows; implementation and parity require evidence)

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
| 28 | EI-point (luffy) | command | `/cardinfo` | games → community | `games.card_instances`, `games.card_definitions` | Guild-scoped metadata, circulation count and serial supply; verified by Phase 6 PostgreSQL integration test |
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

The per-behavior ledger gate is met (section 1A, 2026-10-16): every detected declaration carries a reviewed disposition — retained with a traced target handler and named tests, deliberately replaced with an approved decision, or omitted with an operator decision. The acceptance descriptions above remain requirements, not passing test evidence; runtime acceptance is proven phase by phase. Later phases may proceed independently, but this document does not certify their gates.

## Reproducible archive traceability (2026-10-15)

[archive-command-inventory.json](archive-command-inventory.json) records each included archive entry's path, byte length and SHA-256, plus detected capability declarations and source lines. [legacy-behavior-map.json](audits/legacy-behavior-map.json) links detected declarations to target candidates, tests and review status. Archive hashes identify the exact inputs. The original ZIPs are read in place; source bodies and environment/credential contents are not extracted or stored in these artifacts.

Regenerate with `node scripts/inventory-archives.mjs --archive-dir "<path-to-original-archives>"` (or set `LEGACY_ARCHIVE_DIR`). Run `node scripts/inventory-archives.mjs --self-test` and `node --test tests/feature-coverage.test.mjs` for parser/checker fixtures. Run `node scripts/check-feature-coverage.mjs` to identify unresolved rows; a nonzero exit is expected while mappings or acceptance tests remain open. The scripts need installed workspace TypeScript and Python. Paths can be changed with `--archive-dir` and `--output`.

| Archive | Included files | Source files | Command declarations | Other static declarations | Exact-name command candidates | No exact-name command candidate |
|---|---:|---:|---:|---:|---:|---:|
| Ei Paradise.zip | 69 | 34 | 12 | 27 | 3 | 9 |
| EI-point.zip | 531 | 350 | 85 | 33 | 47 | 38 |
| swish.zip | 37 | 25 | 18 | 4 | 16 | 2 |

These counts describe the scanner's scope and declarations, including subcommands and duplicate names in different source files. They are not counts of unique installed commands or completed migrations. Source files include JavaScript, TypeScript, Python, HTML, CSS, SQL, shell, YAML, PHP, Vue and Svelte; non-source assets also receive hashes. Dependencies, generated/build/cache files, agent state, environment files (including examples), potential credential/runtime files and unsafe paths are excluded by the rules embedded in the JSON and scanner. This differs from the earlier audit's narrower executable-source count.

JavaScript/TypeScript detection uses the TypeScript AST for root commands, subcommands/groups, literal descriptions, route-like HTTP calls, event listeners, custom IDs, scheduled-job calls and static asset paths. Python detection uses command/route/component/task decorators and `on_*` handlers. These are heuristic declaration candidates: dynamic registrations, parse/encoding limits, HTML/PHP/framework-specific routes, nested callback behavior and non-static asset paths remain explicit review gaps. No archive code is executed.

The behavior map contains 179 detected declarations: 115 commands, 58 event listeners and 6 route-like declarations. Section 1A resolved every row: 86 are `verified` (retained behavior traced to current handlers; each evidence note names the exact tests) and 93 are `replaced` (deliberately superseded with the decision recorded in [legacy-decisions.md](product/legacy-decisions.md)). No row remains `decision-required` or `implemented-unverified`. The archive's exact-name candidate count was only a hint: the evidence notes document the actual current handler and test layer, including rows whose tests exercise the surrounding mechanism (dispatch, persistence, module boundary) rather than exact event wiring. Archive SHA-256 values are unchanged after the 2026-10-16 refresh: Ei Paradise.zip `62dcf862c61ec2008b70d702097519cd11d88729f6109df6511674ca33d1265c`, EI-point.zip `c5dadd64aaa82351d3a759510948cbc0c2ecc7155fdeefbc27894765047c58ad`, swish.zip `f7a737622fef2915cae116aba271acd7e7cf39e18b5c77f833e9ffdc185538da`.

The ledger now links every detected declaration to a current target handler and test file, or an approved replacement decision. Verification commands: `node scripts/check-feature-coverage.mjs` (structural) and `node scripts/check-feature-coverage.mjs --mode release` both exit 0, and `node --test tests/feature-coverage.test.mjs` passes. The scanner remains heuristic (dynamic registrations, nested callbacks and non-static asset paths are explicit review gaps), so the inventory is a floor rather than an exhaustive proof of the legacy projects. Runtime acceptance for the 54 curated requirements above remains phase-by-phase work.
