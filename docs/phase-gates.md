# Phase 1 — audit status

- [x] Bot registry defined (6 identities, §2) in `docs/feature-matrix.md`
- [x] Failure modes mapped from `VPS_BENCHMARK.md` findings #1–12
- [ ] Full per-command inventory — BLOCKED: `project assets/bots/` and `project assets/web/` are empty; need 3 archived source projects
- Gate: Phase 1 passes as template; full matrix required before Phase 5.

# Phase 2 — audit status

- [x] Monorepo layout per §3
- [x] Toolchain pins (Node 24.8.0, discord.js 14.16.3, Next 14.2.18, Fastify 5.3.0, Python 3.12, Postgres 17.5)
- [x] Config validation stub (`packages/runtime`)
- [x] Compose with 8.0 CPU budget, explicit DNS, 3 networks, healthchecks
- [x] Postgres 001_core + 002_domain + roles
- [x] Nginx + systemd slice + watchdog
- [ ] Clean install proof (`pnpm install`) + target-CPU image test — must run on VPS (Debian), not this Windows dev box
