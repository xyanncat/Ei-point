# Ei Royality — Feature Matrix (Phase 1 — TEMPLATE)

> Source: `EI_ROYALITY_VPS_BUILD_PLAN.md` §2 + §10 Phase 1.
> Status: **BLOCKED — source projects not present in this workspace.**
> Workspace currently contains only `project assets/cred/*.md`; `project assets/bots/` and `project assets/web/` are empty.
> Once the three archived source projects are provided, expand each row below into one row per command / subcommand / button / modal / event / route / control / job / asset / test.

## Bot registry (target — 6 identities, §2)

| Bot | Modules | Required Discord permissions (least-privilege) | Guild access | Secret refs |
|---|---|---|---|---|
| security | security | ViewAuditLog, ManageGuild (lockdown only), ModerateMembers | approved guilds only | DISCORD_SECURITY_BOT_TOKEN |
| moderation | moderation, logging | ModerateMembers, ManageMessages, BanMembers, KickMembers, ViewAuditLog | approved guilds only | DISCORD_MODERATION_BOT_TOKEN |
| community | community, games | SendMessages, EmbedLinks, AddReactions, ManageMessages (purge-scoped) | approved guilds only | DISCORD_COMMUNITY_BOT_TOKEN |
| ai | ai, search | SendMessages, EmbedLinks, AttachFiles | approved guilds only | DISCORD_AI_BOT_TOKEN + AI_PROVIDER_KEYS |
| music | music | Connect, Speak, UseVAD, SendMessages, EmbedLinks | approved guilds only | DISCORD_MUSIC_BOT_TOKEN |
| commerce | commerce | SendMessages, EmbedLinks, AttachFiles | approved guilds only | DISCORD_COMMERCE_BOT_TOKEN + UPI/USDT config |

Rule: adding/removing a bot = one registry row + deploy. No hard-coded bot lists in code (enforced in Phase 3 runtime review).

## Inventory template (one row per item in source projects)

| # | Source project | Kind (command/subcommand/button/modal/event/route/control/job/asset/test) | Name | Module → Bot | Persistence (table/volume/none) | Acceptance test |
|---|---|---|---|---|---|---|
| — | TBD | | | | | |
| Security example | archive | command `/lockdown on` | security → security-bot | `security.lockdown_state` + outbox | kill mid-lockdown, reboot, no partial state |
| Moderation example | archive | command `/warn add` | moderation → moderation-bot | `moderation.cases` | expiry job, audit trail |
| Games example | archive | command `/pack open` | games → community-bot | `games.*` tx (no dupes) | concurrent opens, rollback |
| Commerce example | archive | command `/order claim` | commerce → commerce-bot | `commerce.orders/claims` idempotent | duplicate claim, double settlement |
| AI example | archive | command `/ai ask` | ai → ai-bot | `ai.threads/messages` | provider fail ≠ mod/sec down |
| Music example | archive | command `/play` | music → music-bot | `music.queue_snapshots` 15s | reboot restores queue |

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

## Gate to Phase 5+

Phase 1 is done when every row above is filled from the three archives and each row names its §11 acceptance test. Until then, Phases 2–4 proceed on the contract-first schemas in `packages/contracts/` + `infra/postgres/`.
