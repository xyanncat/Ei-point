# Phase 1 — audit status

- [x] Bot registry defined (6 identities, §2) in `docs/feature-matrix.md`
- [x] Failure modes mapped from `VPS_BENCHMARK.md` findings #1–12
- [ ] Full per-command inventory — BLOCKED: `project assets/bots/`, `project assets/web/`,
      `project assets/services/` and `project assets/Cards/` are empty (READMEs define drop contracts);
      need archived source projects + asset drops
- Gate: Phase 1 passes as template; full matrix required before Phase 5.

# Phase 2 — audit status

- [x] Monorepo layout per §3
- [x] Toolchain pins (Node 24.8.0, discord.js 14.16.3, Next 14.2.18, Fastify 5.3.0, Python 3.12, Postgres 17.5)
- [x] Config validation stub (`packages/runtime`)
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

- [x] Interaction lifecycle: ack → authorize → deadline → exactly-once reply → telemetry (`packages/runtime/src/lifecycle.ts`)
- [x] Guild allowlist + scopes (`auth.ts`); backoff/jitter + lease SQL (`jobs.ts`); outbox SQL (`outbox.ts`)
- [x] Graceful shutdown helper with explicit rejection-handler setup (`shutdown.ts`)
- [x] Worker LISTEN + reconciliation loop with graceful drain (`apps/workers/src/index.ts`)
- [x] API `readyz` DB probe with `finally` cleanup (`apps/api/src/index.ts`)
- [x] Migration `003_notifications.sql` (job/outbox NOTIFY triggers)
- [x] Unit tests 4/4 pass, `tsc` clean (verified in isolated env — no pnpm on this box)
- [x] Closing audit — self-review (CodeRabbit paused): drain/exit-code/import fixes verified, tests green

# Phase 4 — dashboard foundation (done, self-audited)

- [x] Visual system: theme tokens, globals, reduced-motion, skip-link, focus rings (`apps/dashboard/`)
- [x] OAuth login/callback/logout + signed sessions + CSRF gate (`apps/api/src/session|csrf|oauth.ts`, routes in `index.ts`)
- [x] Guild navigation endpoint (`GET /api/guilds`, session-required, approved-only)
- [x] Service overview endpoint (`GET /api/services`, six bot cards from `ops.service_status`)
- [x] Overview page with loading/empty/failed/stale states; saved≠confirmed states reserved for forms (Phases 5–8)
- [x] Contracts: `ServiceCard`, `GuildInfo`, `DataState`, `ErrorEnvelope`, `SessionClaims`
- [x] Tests 8/8 pass (session/csrf/oauth), `tsc` clean for api-auth + dashboard
- [x] Self-audit of route wiring: cookie-parse hardening, callback error logging, OAuth param fix — tests re-green

# Phase 5 — protection modules (done, self-audited)

- [x] Security: raid detection, trust scoring + bands, antinuke verdicts, whitelist/lockdown/incident/snapshot SQL,
      checksum-guarded snapshots + restore planner (`packages/modules/security/`)
- [x] Moderation: scoped permission checks, 28-day timeout bounds, purge planner (bulk/manual/rejected),
      case SQL with idempotency (`packages/modules/moderation/`)
- [x] Logging: stream allowlist, credential redaction, outbox-shaped events (`packages/modules/logging/`)
- [x] Tests 16/16 pass, `tsc` clean (isolated env)
- [x] DB tables already exist (`002_domain.sql`); bot command wiring lands with Phase 10 fleet integration

# Phase 6 — community + economy (done, self-audited)

- [x] Community: welcome renderer, limit-checked embed builder, triangular XP curve + level-ups,
      welcome/XP/leaderboard SQL (`packages/modules/community/`)
- [x] Games: seeded pack draws with rarity buckets, trade state machine, atomic market buy
      (row locks, fund check, self-buy guard, single open→sold transition) (`packages/modules/games/`)
- [x] Tests 10/10 pass, `tsc` clean — including one test-caught fix (negative XP floors at 0)
- [x] Completion audit: added card minting + inventory SQL, `withTransaction` with rollback test,
      and a lock-faithful concurrent double-buy test (exactly one winner, funds conserved) — 12/12 games+community tests green
- [x] DB tables already exist (`002_domain.sql`); load proof under real concurrency is a VPS/staging gate (§11)

# Phase 7 — commerce + website (done, self-audited)

- [x] Catalog/money rules, order token hashing, UPI payload builder, USDT (tron/erc20) validation
- [x] Order state machine, referral codes + YYYY-MM cycles + month-boundary expiry
- [x] Atomic claim (pending→claimed) and settlement (claimed→settled) with row locks;
      duplicates and wrong-state callers fail clearly, lost-update race returns already-settled
- [x] Public verification API (`GET /api/orders/verify`, hash lookup, safe fields) + verify page
- [x] Tests 9/9 pass, `tsc` clean — including one test-caught fix (TRON vector length)

# Phase 8 — AI + music (done, self-audited)

- [x] AI memory: bounded prompt window (count + char caps) with summary prefix; thread/message/
      summary/usage SQL (`packages/modules/ai/`)
- [x] Provider router: 2 concurrent, 20 queued then clean reject, 60 s deadline with abort,
      primary→fallback, budgets (`AI_CONCURRENT`/`AI_QUEUE_MAX`/`AI_DEADLINE_MS`)
- [x] Music queue: add/remove/shuffle (keeps current first)/loop modes/snapshot round-trip
      with clamping restore (`apps/bots/music-py/src/queue_state.py`, dependency-free)
- [x] Tests 7/7 (TS) + 6/6 (Python unittest) pass, `tsc` clean
- [x] Demo caught + fixed a real bug: `globals.css` pointed at `./theme.css` instead of `../theme.css`
- [ ] Voice playback + yt-dlp wiring remain VPS/hardware gates (Phase 10 fleet integration)

# Website — public site (done, self-audited; per @frontend-design)

- [x] Design plan: brief-pinned palette; angular clip panels + single beam sweep as the
      memorable element; sentence-case copy; left-aligned broken grid (no SaaS-card kit)
- [x] Routes: `/` landing, `/services` (server-priced catalog), `/membership`, `/referrals`,
      `/verify` (exists), `/dashboard` (staff overview moved from `/`)
- [x] API: `GET /api/catalog` (active rows, price-ordered) + `CatalogItem` contract
- [x] Demo proves all routes 200 with live fixture data; fixed two real relative-path bugs
      (`globals.css` theme import, nested `../../components` imports)
