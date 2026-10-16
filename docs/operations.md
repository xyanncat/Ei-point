# Ei Point — Operations (Phase 2 stub → expanded in Phase 9)

## Resource budget (§7) — enforced in compose + systemd slice

Slice `ei-point.slice`: `CPUQuota=900% MemorySwapMax=2G` (RAM uncapped — Ei Point is the only project on this host; owner decision 2026-10-16).
Per-service CPU/RAM caps live in `infra/docker/compose.yml` (`deploy.resources.limits` + `mem_limit`).
Allocation: runtime 7.45 CPU / 32.5 GiB; concurrent maximum 7.95 CPU / 33.75 GiB; project ceiling 9 CPU of 10, memory uncapped; swap is emergency headroom only.

## Verification entrypoint (§2B / §10A)

`node scripts/verify-project.mjs` (or `pnpm verify`) is the reproducible verification entrypoint. It runs every gate with a **separate** result and exits `0` only when all mandatory gates pass: `1` if a mandatory gate failed, `2` if a mandatory gate is **blocked** (for example `python` absent). A gate with no local runner (container/OS image scan) is reported `blocked` and executed by CI, never counted as passed. Use `--only <ids>` for a partial run (labelled "not a release verdict"), `--skip <id>` to omit, and `--json` for the machine-readable report used in the §10A evidence bundle.

`.github/workflows/verify.yml` runs the same gate list on pinned Node (`.nvmrc` → `setup-node`) with a frozen lockfile: pinned-runtime check, dependency scans, feature coverage, `pnpm test`, typecheck, browser acceptance and the Python music suites. Run it locally with `pnpm verify` (or a subset via `--only`).

Migrations are forward-only and serialized by a database advisory lock. `infra/postgres/run-migrations.mjs` exports `runMigrations(url, { dir, upTo })`; `tests/operations/migrations.test.mjs` proves a fresh database, an upgrade from a prior snapshot, a rolled-back failure that is not recorded and retried cleanly, and concurrent runners that never double-apply.

`scripts/check-openapi-sync.mjs` (the verifier's `openapi-sync` gate) regenerates `packages/contracts/src/dashboard-api.ts` from `apps/api/src/openapi.json` and fails on content drift, ignoring line-ending-only differences. `scripts/evidence-bundle.mjs` runs the verifier with `--json` and retains the §10A evidence bundle under `docs/audits/releases/<release-id>/` (revision, dirty state, toolchain versions, per-gate commands, timestamps, exits/counts and sanitized log hashes); a blocked mandatory gate is recorded as BLOCKED and blocks release.

## Storage envelope (§7) — dedicated host, uncapped (owner decision 2026-10-16)

The table below remains the working allocation target for planning, not a hard cap:

| Purpose | Cap | Volume |
|---|---|---|
| Postgres + WAL | 100 GB | `pgdata` |
| Artwork/uploads | 80 GB | `artwork` |
| Music cache | 10 GB | `music-cache` (disposable, excluded from backups) |
| Logs/metrics | 20 GB | `logs` (rotated, not snapshotted) |
| Backup staging | 100 GB | `backup-staging` |
| Images/releases | 50 GB | host docker store |
| Growth/tmp | 40 GB | `tmp` |

Alerts at 70% / 80% host disk; at 90% stop optional downloads/uploads (watchdog).
Never auto-delete financial data or WAL.

## Networking (§8)

- Ingress: outbound Tailscale Funnel or Cloudflare Tunnel → local nginx:8080. No DB/diagnostics ports public.
- Networks: `edge` (nginx+tunnel), `app` (bots/api/workers/web), `data` (postgres only).
- DNS: explicit `dns:` list in every service (cached resolver first, e.g. host resolver + 8.8.8.8 + 9.9.9.9 — NEVER 1.1.1.1 per finding #12). Verify with `infrastructure DNS check` in acceptance.
- Containers: non-root, read-only root where possible, dropped caps, bounded writable volumes.

## Health model (§8)

Liveness ≠ gateway ≠ DB readiness ≠ provider availability. Compose healthchecks + host watchdog (`infra/systemd/`) with startup grace, consecutive-failure threshold, bounded restarts, alerts. Watchdog restarts only approved project services; never mounts docker socket into web app.

## Operator surface (§9C)

`DATABASE_URL=... node scripts/ops-report.mjs [--backup-root DIR] [--json]` surfaces what authorized operators need in one report, failing (exit 1) on any breach: durable **queue lag** (oldest pending/leased job, dead jobs), **delivery failures** (unpublished outbox events past their age threshold), **service heartbeats** (stale or degraded `ops.service_status` rows) and **backup freshness/restore age** (latest snapshot verified with `verifyBackup`, including integrity). Model-service health stays with the host watchdog and `health-fleet.sh` — model containers have no database route by design. Startup order, bounded restarts, disk holds and release rollback are covered by `scripts/deploy.sh`/`rollback.sh` with hermetic tests in `tests/operations/`.

## Deploy / rollback (§12)

1. Test-guild credentials + isolated data first. Never run legacy + replacement fleets unrestricted simultaneously.
2. Cutover: archive+verify legacy → fresh verified backup → stop legacy handlers → start pinned digests → verify commands/permissions/routes/flows → monitor latency/errors/CPU/RAM/disk/queues/gateway.
3. Rollback = previous image digests + backward-compatible migrations. DB restore is explicit recovery only, never auto-rollback.
