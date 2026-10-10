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
