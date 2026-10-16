> Current status: the 2026-10-14 audit found gaps in these historical checklists. See `docs/audits/2026-10-15-remediation.md` for current fixes and remaining live acceptance gates. Checkmarks below describe implemented code, not production certification.

# Phase 1 — audit status

- [x] Bot registry defined (6 identities, §2) in `docs/feature-matrix.md`
- [x] Failure modes mapped from `VPS_BENCHMARK.md` findings #1–12
- [ ] Exhaustive semantic command/event/UI parity. All three ZIPs now have reproducible file/hash and command-declaration inventory; candidate matches still need behavior/test mapping.


- Gate remains open: inventory candidates are not proof of implemented semantic parity.

# Phase 2 — audit status

- [x] Monorepo layout per §3
- [x] Toolchain pins (Node 24.8.0, discord.js 14.16.3, Next 14.2.35, Fastify 5.12.7, Python 3.12, Postgres 17.5)
- [x] Config validation stub (`packages/flow`)
- [x] Compose with 8.0 CPU budget, explicit DNS, 3 networks, healthchecks
- [x] Postgres 001_core + 002_domain + roles
- [x] Nginx + systemd slice + watchdog
- [ ] Clean install proof (`pnpm install`) + target-CPU image test — must run on VPS (Debian), not this Windows dev box

# Workflow (single-branch)

- All work lands directly on `main` (remote: `xyanncat/Ei-point`). No long-lived branches.
- Each phase: implement → self-verify (typecheck/tests) → audit → fix → push.
  Next phase starts only on a clean gate (0 critical, 0 major).
- CodeRabbit is PAUSED by operator (cooldown). Until re-enabled, the audit step is a
  rigorous self-review: full file re-reads, isolated `tsc` + `node --test`, YAML/SQL checks.
- A phase gate closes only against a re-read of the plan's scope lines for that phase —
  never from memory of what was built (lesson 2026-10-10: Phase 6 closed early, user caught
  missing inventories/rollback/concurrency proof).

# Phase 3 — audit status

- [x] Shared interaction lifecycle helper: acknowledgement, guild approval, authorization boundary, deadline, exactly-once reply and telemetry (`packages/flow/src/lifecycle.ts`)
- [ ] Fleet adoption is incomplete: Himiko, community and commerce now use the shared lifecycle; Kafka, AI, moderation/security and music still require dispatcher integration and per-dispatcher acceptance tests.
- [x] Guild allowlist + scopes (`auth.ts`); backoff/jitter + lease SQL (`jobs.ts`); outbox SQL (`outbox.ts`)
- [x] Graceful shutdown helper with explicit rejection-handler setup (`shutdown.ts`)
- [x] Worker LISTEN + reconciliation loop with graceful drain (`apps/workers/src/index.ts`)
- [x] API `readyz` DB probe with `finally` cleanup (`apps/api/src/index.ts`)
- [x] Migration `003_notifications.sql` (job/outbox NOTIFY triggers)
- [x] Unit tests 4/4 pass, `tsc` clean (verified in isolated env — no pnpm on this box)
- [x] Closing audit — self-review (CodeRabbit paused): drain/exit-code/import fixes verified, tests green

# Phase 4 — dashboard foundation (implemented locally; staging gate open)

- [x] Responsive command-center UI, local fonts/artwork, guild switcher, fleet search, incident indicator, account/logout and bot detail modal.
- [x] Same-browser expiring OAuth state, encrypted PostgreSQL-backed sessions, revocation, secure cookies and CSRF-protected logout.
- [x] Current Discord membership/role authorization; approved guilds only. Anonymous users cannot read private services. Registry-driven scoped cards replace the fixed anonymous six-card endpoint.
- [x] Heartbeat freshness, process/gateway/DB/provider distinctions, scoped incidents/history, bounded requests and loading/empty/error/stale states.
- [x] OpenAPI foundation contract and generated client types; fixed same-origin API routing and supplied OAuth variables in Compose.
- [x] 20 API tests and a real PostgreSQL OAuth/session/registry/revocation integration test pass. Desktop/mobile browser flows validated using labeled demo fixtures.
- [ ] Live Discord OAuth/role verification, Linux standalone images and target-VPS CPU validation remain staging gates.
- [ ] Full-fleet latency, soak and backup/restore acceptance remain launch gates.
- Handoff: `docs/phase4-dashboard.md`. Feature-specific settings forms are outside this foundation phase.

# Phase 5 — protection modules (local repairs; live acceptance open)

- [x] Security: raid detection, trust scoring + bands, antinuke verdicts, whitelist/lockdown/incident/snapshot SQL,
      checksum-guarded snapshots + restore planner (`packages/modules/security/`)
- [x] Moderation: scoped permission checks, 28-day timeout bounds, purge planner (bulk/manual/rejected),
      durable kick/timeout/warning intents, warning removal audit history, and temporary ban/mute/role/restriction expiry (`packages/modules/moderation/`, `apps/bots/kafka/`)
- [x] Logging: stream allowlist, credential redaction, outbox-shaped events (`packages/modules/logging/`)
- [x] Tests 16/16 pass, `tsc` clean (isolated env)
- [x] DB tables already exist (`002_domain.sql`); Kafka registers and authorizes the current moderation/security command tree. Live disposable-guild recovery and role-restoration acceptance remain open.

# Phase 6 — community + economy (implemented locally; staging gate open)

- [x] Persisted welcome/leave configuration, cooldown/deduplicated XP, ranks, leaderboard and durable level notifications.
- [x] Catalog, finite supply/serials, packs, inventories, balances/ledger, reserved listings, purchases, cancellation and expiring two-party trades.
- [x] Runnable community Discord bot with 19 command schemas, permission/guild checks, acknowledgement before queries, health probes and retrying message outbox.
- [x] Forward migration `004_community_economy.sql`, frozen dependency lockfile and production package/Docker wiring.
- [x] Real PostgreSQL integration tests: 18/18 pass, including concurrent double-buy, trade acceptance, supply issuance and injected transaction rollback. Existing community/games tests: 14/14 pass. Full `pnpm test` passes.
- [x] Workspace typecheck passes; production community package imports and all command schemas validate.
- [ ] Linux image build and live Discord command/delivery verification. Docker is unavailable here. Phase 4 now passes the normal Windows workspace build; Linux standalone images remain unverified.
- [ ] Actual catalog/assets and archived-command parity: source archives and 19 service definitions are present; production card definitions/artwork and semantic command coverage remain open.
- [ ] VPS two-guild latency/load, 72-hour soak and backup/restore acceptance remain Phase 10 launch gates.
- Handoff and operator instructions: `docs/phase6-community-economy.md`. These replace the earlier premature gate based only on SQL/helpers and simulated concurrency.

# Phase 7 — commerce + website (local repairs; live acceptance open)

- [x] Catalog/money rules, order token hashing, UPI payload builder, USDT (tron/erc20) validation
- [x] Order state machine, referral codes + YYYY-MM cycles + month-boundary expiry
- [x] Atomic claim (pending→claimed) and settlement (claimed→settled) with row locks;
      duplicates and wrong-state callers fail clearly, lost-update race returns already-settled
- [x] Public verification API (`GET /api/orders/verify`, hash lookup, safe fields) + verify page
- [x] Tests 9/9 pass, `tsc` clean — including one test-caught fix (TRON vector length)

# Phase 8 — AI + music (local repairs; provider and voice acceptance open)

- [x] AI memory: bounded prompt window (count + char caps) with summary prefix; thread/message/
      summary/usage SQL (`packages/modules/ai/`)
- [x] Provider router: 2 concurrent, 20 queued then clean reject, 60 s deadline with abort,
      primary→fallback, budgets (`AI_CONCURRENT`/`AI_QUEUE_MAX`/`AI_DEADLINE_MS`)
- [x] Music queue: add/remove/shuffle (keeps current first)/loop modes/snapshot round-trip
      with clamping restore (`apps/bots/music-py/src/queue_state.py`, dependency-free)
- [x] Tests 7/7 (TS) + 6/6 (Python unittest) pass, `tsc` clean
- [x] Demo caught + fixed a real bug: `globals.css` pointed at `./theme.css` instead of `../theme.css`
- [x] Voice playback engine: discord.py VoiceClient + yt-dlp stream resolution + FFmpeg audio player with volume transformer, queue loop, and bounded concurrency (2 resolutions, 2 voice sessions)
- [x] Music commands & UI parity: 13 slash commands including /seek, /autoplay, /claimmaster, /masters, and Search Track Picker Select menu component (Matrix #54)
- [x] Periodic 15s snapshots persist real elapsed position_ms to music.queue_snapshots; queue restoration on restart
- [x] HTTP healthcheck on port 3105 distinguishing liveness and gateway/DB readiness; ops.service_status heartbeats
- [x] Robin response contract (A18, §8C): every success/error/empty path and the search-picker callback route through the configured embed/image helper (`embed_reply_helper`/`respond`, per-identity `EI_POINT_EMBED_IMAGE_ROBIN`); the approved-root surface, FFmpeg reconnect/failure routing, queue persistence and bounded cache are covered dependency-free (`apps/bots/music-py/tests/test_response_embeds.py`, `test_ffmpeg_playback.py`) — 28/28 Python. Cyrene `/search`/`/tts`/`/speak`/`/leave` contracts 19/19 TS (fake inference; audible Discord audio and model provisioning remain open).

# Website — public site (done, self-audited; per @frontend-design)

- [x] Design plan: brief-pinned palette; angular clip panels + single beam sweep as the
      memorable element; sentence-case copy; left-aligned broken grid (no SaaS-card kit)
- [x] Routes: `/` landing, `/services` (server-priced catalog), `/membership`, `/referrals`,
      `/verify` (exists), `/dashboard` (staff overview moved from `/`)
- [x] API: `GET /api/catalog` (active rows, price-ordered) + `CatalogItem` contract
- [x] Demo proves all routes 200 with live fixture data; fixed two real relative-path bugs
      (`globals.css` theme import, nested `../../components` imports)

# Phase 9 — Operations (tooling repaired; actual recovery acceptance open)

- [~] Reproducible foundation (§2B / A20, local scope): `scripts/verify-project.mjs` aggregates every gate with separate results and blocks (never passes) a gate whose mandatory tool is missing; `.github/workflows/verify.yml` runs the same list on pinned `.nvmrc` Node + frozen lockfile; `tests/operations/migrations.test.mjs` proves fresh DB, upgrade-from-snapshot, rolled-back failure and advisory-lock concurrency against real PostgreSQL; dependency/container scans are recorded by CI. Linux image build (Docker unavailable locally) and the container scan remain open.
- [~] Durable-asset recovery (§9B / A19, local scope): `infra/backup/durable-assets.mjs` is the machine-checked inventory (owner, runtime path, classification, backup/reprovision method, integrity, retention, restore validation) covering database/WAL, artwork, the private Cyrene reference audio + persona memory, the pinned model manifests and the deployment secret; `restic-backup.sh` resolves the private/secret set from the inventory and fails closed when a required asset is unset or missing; `docs/operations/durable-assets.md` documents the contract and the proposed RPO/RTO targets (DB 15 min, unique assets 6 h, off-host copy ≤24 h, RTO 2 h — targets, not achieved claims). Evidence: `infra/backup/durable-assets.test.mjs` 7/7 and `backup.test.mjs` 9/9 (new fail-closed case). Off-host/PITR restore drills remain measured-drill acceptance on the VPS.
- [~] Startup/rollback/alerts (§9C, local scope): migration locking and readiness ordering are proven without restart storms (`tests/operations/migrations.test.mjs` advisory-lock concurrency; `deploy.test.mjs` gates WAL init before migrations, immutable images, no down/build); rollback to a previous immutable release preserves data and never runs migrations (deploy.test.mjs rollback cases incl. model-service retirement); the host watchdog bounds restarts, honors grace and consumes disk holds (`watchdog.test.mjs`). New operator surface `scripts/ops-report.mjs` reports queue lag, delivery failures, service heartbeats and backup freshness/restore age with breach exits (`tests/operations/ops-report.test.mjs` 6/6 against real PostgreSQL). Cold reboot, DNS/ingress loss, expired credentials and live model-startup failure remain VPS acceptance.

- [x] Backups: pgBackRest configuration (`infra/backup/pgbackrest.conf`) for base backups and WAL streaming to off-host S3; restic file volume backup script (`infra/backup/restic-backup.sh`) with 7-daily/4-weekly retention and music-cache exclusions.
- [x] Local VPS tier (no outer source): `infra/backup/local-backup.sh` (pg_dump -Fc + roles + artwork tarball + manifest, 700/600 perms) on a 6h systemd timer (`infra/systemd/ei-point-local-backup.*`), 28-snapshot retention, atomic publish via `.partial` + rename.
- [x] Host Watchdog: startup grace check, consecutive-failure threshold, bounded hourly restart budget (`MAX_RESTARTS_PER_HOUR=3`), and disk usage alerts at 70/80/90% (`infra/systemd/ei-point-watchdog.sh`).
- [x] Resolver checks: DNS audit script asserting 1.1.1.1 is never used and probing fallback resolvers (`scripts/check-dns-resolvers.sh`).
- [x] Monitoring & Fleet Health: multi-service health probe covering all 6 bot HTTP ports, API, Nginx, and `ops.service_status` (`scripts/health-fleet.sh`).
- [x] Deployment: immutable-release deployment and application rollback scripts with pre-flight checks, schema migrations, asset validation, and health gating (`scripts/deploy.sh`).
- [x] Restore Drills: artifact-based logical restore drill with bounded readiness, strict SQL errors, artifact hashes and verified artwork extraction; real execution remains an operator staging gate (`scripts/restore-drill.sh`).

# Phase 10 — Staging and launch (fleet ready; VPS gates open)

- [x] Complete six-bot fleet applications implemented with health checks, least-privilege permissions, and graceful shutdown:
      `bot-security` (3101), `bot-moderation` (3102), `bot-community` (3103), `bot-ai` (3104), `bot-music` (3105), `bot-commerce` (3106).
- [x] Evidence bundle (§10A, local scope): `scripts/evidence-bundle.mjs` runs the aggregate verifier and retains proof under `docs/audits/releases/<release-id>/` — revision/dirty state, toolchain versions, command, timestamps, exits/counts, per-gate results and sanitized log SHA-256 hashes; the Linux image build and container/OS scan are recorded as BLOCKED (never passed) pending a Linux host. New mandatory `openapi-sync` gate regenerates the dashboard API contract and fails on drift (`scripts/check-openapi-sync.mjs`). Recorded npm audit triaged to a fix: `@playwright/test` 1.51.1 → 1.64.1 clears GHSA-7mvr-c777-76hp (CI-reachable install path; production images use `deploy --prod`); browser gate re-run 16/16. Retained bundles: `docs/audits/releases/20261016T211613Z-38b1fe28-dirty` and `20261016T212810Z-dfafe5b9-dirty` (all mandatory gates passed; python-audit scanner absent locally, recorded for CI).
- [x] Compose resource limits and networking strictly enforce the 9.00 CPU project ceiling (owner decision 2026-10-16; RAM/disk uncapped on the single-project host), explicit DNS, and internal database isolation.
- [ ] Staging Gate: deploy release in test guild on Debian VPS with target-CPU validation.
- [ ] Launch Gate: two-guild load test, 72-hour soak test, and verified off-host backup restore drill before main-guild cutover.
