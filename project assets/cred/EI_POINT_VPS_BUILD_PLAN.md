# Ei Point — Complete VPS Build Plan

## Goal

Build a new private platform containing six Discord bots, one administration dashboard, and the public service/payment website. All live application services, databases, persistent bot memory, uploaded assets, and monitoring run on the existing VPS.

The old projects remain archived references. The new platform starts with fresh operational data.

This plan uses [VPS_BENCHMARK.md](VPS_BENCHMARK.md) as the capacity and reliability baseline. It is designed to prevent the known failure modes, but no system can honestly guarantee zero errors; launch is gated on measured tests and recovery drills.

## 1. VPS constraints and design response

| Benchmark constraint | Design response |
|---|---|
| 10 vCPU with no AVX, AVX2, AES-NI or SSE4.2 reported | Cap the project at 8 CPU cores; avoid CPU-only local AI inference; test images on the target VPS |
| 48 GB RAM plus 16 GB swap allocation model | Initial service limits total 30 GiB; aggregate hard limit 40 GiB; swap is emergency headroom only |
| 500 GB SSD, about 492 GB usable and 8% used | Reserve a 400 GB project envelope with explicit retention, cache and disk alerts |
| About 40 Mbps WAN download | Bound media downloads, asset sizes and backup bandwidth; measure upload separately |
| No public IP | Use outbound HTTPS ingress through the existing stable tunnel/funnel approach |
| Previous DNS failures | Keep the cached resolver and explicit Docker DNS configuration from day one |
| Unexpected power-offs/reboots | Use durable transactions, boot recovery, watchdogs, off-host backups and external availability checks |
| Existing CPU-sensitive database concern | Use local PostgreSQL for the new system; do not depend on MongoDB 7 or a hosted database |

Before production, rerun the benchmark and verify CPU flags, memory, disk, DNS, ingress, upload speed and actual container limits.

## 2. Six-bot architecture

Bot identities are separate from feature modules. A registry assigns modules, required permissions, guild access and secret references to each identity. Adding or removing a bot later must not require rewriting hard-coded bot lists.

| Bot | Responsibilities |
|---|---|
| Security | Antinuke, raid thresholds, trust scoring, whitelist, lockdown, security history, scans, server snapshots and restoration |
| Moderation & logging | Warnings, bans/unbans, timeouts, purge, moderator roles, AutoMod integration, and message/member/channel/role/voice logs |
| Community & games | Welcome/leave messages, announcements, embeds, utilities, XP, leaderboards, cards, packs, inventories, market and trades |
| AI & search | Assistant/persona conversations, model selection, persistent memory, reset, search and existing supported media features |
| Music | Search picker, URLs/playlists, playback, queue, loop, shuffle, seeking, autoplay, masters/DJ permissions, cache and restart recovery |
| Commerce | UPI/USDT QR generation, orders, payment claims, staff settlement, referral links, monthly cycles and rewards |

The feature inventory phase must map every command, subcommand, button, modal, background event, website route, dashboard control, scheduled task, asset and existing test to one of these modules.

## 3. Technology and repository structure

- TypeScript, Node.js 24 LTS and discord.js 14 for five bot identities and shared runtime code.
- Python 3.12, discord.py, yt-dlp and FFmpeg for the isolated music service.
- Next.js for the dashboard and public website.
- Fastify for server APIs.
- PostgreSQL 17 for durable state, jobs, configuration and bot memory.
- Nginx for same-origin routing and local asset delivery.
- Docker Compose and systemd for deployment and resource enforcement.
- Lockfiles, pinned patch versions and image digests for releases.

Suggested top-level layout:

```text
apps/
  dashboard/       Next.js dashboard and public website
  api/             Fastify API and auth/session routes
  bots/            six bot applications
  workers/         jobs, outbox, backup and maintenance workers
packages/
  flow/            Ei-Flow runtime: interaction lifecycle, authorization, queues, logging
  modules/         security, moderation, games, AI, music, commerce
  contracts/       OpenAPI types, event schemas and configuration schemas
infra/
  postgres/        migrations, roles, indexes and backup configuration
  docker/          compose files and health checks
  systemd/         slice, watchdog and backup timers
  nginx/           routing and security headers
docs/
  feature-matrix.md
  operations.md
  recovery-drills.md
```

Build images outside the production startup path. Production starts only prebuilt, tested images.

## 4. Database, memory and durable state

Use one local PostgreSQL instance with separate schemas and least-privilege service accounts.

| Domain | Durable records |
|---|---|
| Access | Approved guilds, owners, staff roles, sessions and permissions |
| Configuration | Bot registry, module assignments, versioned settings and change history |
| Security | Incidents, trust state, whitelist, lockdown state and server snapshots |
| Moderation | Cases, warnings, sanctions, expiry tasks and audit records |
| Community | Welcome templates, XP, levels and reward settings |
| Games | Card definitions, instances, balances, games, listings and trades |
| AI | Conversation threads, messages, summaries, preferences and usage accounting |
| Music | Queue snapshots, current position, loop/volume settings and permissions |
| Commerce | Catalog, orders, claims, settlements, referrals and reward reservations |
| Operations | Durable jobs, outbox events, service status and diagnostic events |

Use Discord snowflakes as strings. Store money as integer minor units or exact decimals. Enforce uniqueness and state transitions in PostgreSQL transactions so cards, balances, payments and referral rewards cannot be duplicated or double-spent.

Memory has three layers:

1. PostgreSQL is the source of truth for state that must survive crashes.
2. Each process has a bounded expiring cache; a cache failure never grants access or confirms a mutation.
3. VPS volumes store artwork, uploads, generated assets and a capped music cache, referenced by identifiers and checksums.

AI history persists locally by guild, user and persona. Prompts use a bounded recent window plus summaries. Music queue changes and playback position are persisted every 15 seconds; a reboot can restore the queue but cannot guarantee seamless Discord voice continuity.

## 5. Reliability and response design

All bots share one interaction lifecycle:

1. Acknowledge immediately when database or provider work may be slow.
2. Validate guild authorization and permissions before side effects.
3. Apply a deadline and cancellation signal.
4. Send exactly one result or an actionable error.
5. Record correlation ID, latency and failure category.

Discord interactions require an initial response within three seconds. Slow work must defer immediately and use a follow-up response.

Use a PostgreSQL-backed job table and transactional outbox. Jobs have leases, bounded retries, exponential backoff, jitter, idempotency keys and a visible failed-work state. PostgreSQL notifications wake workers, while periodic reconciliation handles missed notifications.

Initial limits:

- AI: two concurrent provider requests, twenty queued, sixty-second deadline.
- Music: two concurrent metadata resolutions and two simultaneous guild sessions.
- Rendering: one concurrent background job.
- Database pools: five connections per bot and ten per API/worker process; keep aggregate pools below eighty.
- Logging is isolated from moderation and security command capacity.

If PostgreSQL is unavailable, reject unsafe mutations without claiming success. If an AI provider fails, moderation and security remain available. Prevent unhandled promise rejections, double replies, stale component actions and indefinite loading states.

## 6. Dashboard and public website

The dashboard uses an anime-forward command-center design:

- Midnight indigo background `#101329`.
- Violet raised surfaces `#202445`.
- Warm white text `#F5F2FF`.
- Lavender primary accent `#B6A0FF`.
- Gold secondary accent `#E6BF75`.
- Locally hosted fonts, character art and restrained motion.
- Reduced-motion support, keyboard navigation and accessible contrast.

Persistent navigation contains the guild switcher, global search, incident indicator and account menu.

Dashboard screens:

- Overview: six bot cards, real service state, latency, incidents and recent actions.
- Bots: assignments, feature flags, permission checks, configuration and diagnostics.
- Security: threat timeline, whitelist, lockdown and snapshot recovery.
- Moderation: cases, sanctions and filtered event history.
- Community: welcome previews, announcements, XP and leveling.
- Cards: catalog, artwork, packs, inventory, market, trades and economy audit.
- AI: providers, usage caps, personas and memory controls.
- Music: player, queue, controls and cache health.
- Commerce: catalog, orders, claims, settlement and referrals.
- Infrastructure: CPU, RAM, disk, DNS, PostgreSQL, queues and restart metrics.
- Backups: last verified backup, archive lag, retention and restore-drill status.
- Access/settings: staff roles, guild approvals and credential replacement.

Every view needs loading, empty, failed, stale, saving and confirmed states. A saved setting is separate from a setting confirmed as applied by its bot.

The public website keeps marketing, game services, membership, referrals, payment QR and order verification in the same Next.js application. The server owns the catalog and prices; the browser cannot choose an amount or discount.

Use Discord OAuth, secure server-side sessions, CSRF protection and guild-scoped authorization. Publish an OpenAPI contract and generated client types.

## 7. VPS resource budget

Place all project services in one systemd slice with `CPUQuota=800%`, `MemoryHigh=32G`, `MemoryMax=40G` and `MemorySwapMax=2G`.

| Service group | CPU | RAM |
|---|---:|---:|
| Security bot | 1.00 | 2 GiB |
| Moderation/logging bot | 1.00 | 2 GiB |
| Community/games bot | 0.75 | 3 GiB |
| AI/search bot | 0.75 | 2 GiB |
| Music + FFmpeg | 1.00 | 3 GiB |
| Commerce bot | 0.50 | 2 GiB |
| PostgreSQL | 1.50 | 8 GiB |
| Web/API | 0.75 | 3 GiB |
| Workers | 0.50 | 2 GiB |
| Proxy/monitoring/backup | 0.25 | 3 GiB |
| **Total** | **8.00** | **30 GiB** |

Storage envelope:

- PostgreSQL and WAL: 100 GB.
- Artwork/uploads: 80 GB.
- Music cache: 10 GB.
- Logs/metrics: 20 GB.
- Local backup staging: 100 GB.
- Images/releases: 50 GB.
- Growth/temporary workspace: 40 GB.

Alert at 70% and 80% host-disk usage. At 90%, stop optional downloads/uploads. Do not delete financial data or WAL automatically.

## 8. Networking, health and security

- Use outbound Tailscale Funnel or Cloudflare Tunnel through Nginx.
- Expose no database or diagnostics ports publicly.
- Separate edge, application and data Docker networks.
- Use non-root containers, read-only roots where possible, dropped capabilities and bounded writable volumes.
- Limit Discord intents and permissions per bot.
- Validate key-based SSH access before disabling root/password SSH.
- Keep explicit Docker DNS configuration and test host/container resolution.

Health must distinguish process liveness, Discord gateway state, database readiness and provider availability. Compose health checks are combined with a host watchdog that has startup grace, consecutive-failure thresholds, bounded restart attempts and alerts. The watchdog may restart only approved project services and must never expose the Docker socket to the web app.

## 9. Backups and disaster recovery

- Use pgBackRest for PostgreSQL base backups and continuous WAL archiving.
- Use restic for durable file volumes and encrypted configuration backups.
- Store encrypted copies in off-host S3-compatible storage.
- Keep recovery keys outside the VPS.
- Exclude disposable music cache and ordinary container logs.
- Keep seven daily and four weekly file snapshots.
- Maintain a fourteen-day database recovery window.
- Run weekly isolated restore drills and a full replacement-host drill before launch.

Targets are a database recovery point within five minutes, durable files within twenty-four hours, and full-service restoration within two hours. Measure these targets during drills; do not assume them.

## 10. Build phases and release gates

### Phase 1 — Feature and failure inventory

Create `docs/feature-matrix.md` from all three source projects. Map every command, event, route, UI control, persistence behavior, asset and known issue to the new module and an acceptance test.

### Phase 2 — Foundation

Create the monorepo, toolchain pins, configuration validation, Docker Compose, PostgreSQL migrations, roles, indexes, secret references and local development environment. Prove a clean install and target-CPU-compatible images.

### Phase 3 — Reliable runtime

Implement the shared response lifecycle, authorization, queues, outbox, telemetry, graceful shutdown, health endpoints and job recovery. Test service restarts while commands are active.

### Phase 4 — Dashboard foundation

Implement the visual system, OAuth, permissions, guild navigation, service overview, status cards and error states before adding feature-specific forms.

### Phase 5 — Protection modules

Implement security, moderation and logging. Test permission denial, event storms, rate limits, audit trails and snapshot recovery.

### Phase 6 — Community and economy

Implement welcomes, XP, cards, packs, inventories, market and trades. Test concurrent operations and transaction rollback.

### Phase 7 — Commerce and website

Implement catalog, UPI/USDT QR, orders, claims, staff settlement, verification pages and referral cycles. Test duplicate claims, duplicate settlement, rejected payments and month-boundary expiry.

### Phase 8 — AI and music

Implement local AI memory with external providers, provider fallback and budgets. Implement music playback, cache, queue persistence and voice recovery.

### Phase 9 — Operations

Implement backups, watchdog, resolver checks, monitoring, deployment scripts, restore drills and external uptime monitoring.

### Phase 10 — Staging and launch

Run the complete six-bot fleet in the test guild first. Require a two-guild load test, a seventy-two-hour soak, verified backups and no unresolved critical/high defects before main-guild cutover.

## 11. Mandatory acceptance tests

### Responsiveness

- At the two-guild target workload, interaction acknowledgement p95 is below one second and p99 below two seconds under healthy network conditions.
- Twenty concurrent interactions are exercised while both music sessions play.
- No unacknowledged interaction occurs in the acceptance run.
- Provider deadlines always produce a clear response.

### Durability and concurrency

- Kill services during card trades, payment settlement, referral redemption and jobs.
- Confirm no duplicate financial effects, card transfers or rewards.
- Restore music queues and AI memory after restart.
- Restore database and files into an isolated environment and compare checksums/counts.

### Failure isolation

- Dashboard downtime does not stop Discord commands.
- AI provider failure does not affect moderation/security.
- PostgreSQL restart causes unsafe writes to fail clearly, then reconnects.
- A hung bot event loop triggers bounded watchdog recovery.
- Simulate Discord rate limits, DNS failure, missing permissions, stale buttons, full queues and low disk.

### Security and UI

- Test every command, component and dashboard workflow.
- Verify guild/role boundaries and secret redaction.
- Test OAuth, CSRF, order-token access and upload validation.
- Check keyboard navigation, reduced motion, mobile layouts and all error states.

## 12. Deployment and rollback

Deploy first with test-guild credentials and isolated data. Do not run unrestricted legacy and replacement fleets simultaneously.

Before main-guild cutover:

1. Archive and verify legacy project data.
2. Take and verify a fresh replacement backup.
3. Stop overlapping legacy handlers.
4. Start the approved six-bot release.
5. Verify command registration, permissions, public routes and critical flows.
6. Monitor latency, errors, CPU, memory, disk, queues and gateway state.

Keep previous image digests and use backward-compatible migrations. Application rollback must preserve new writes. Database restoration is an explicit recovery procedure, never an automatic response to an ordinary deploy failure.

The launch is complete only after real VPS measurements, Discord tests, backup restoration and the documented recovery targets have passed.
