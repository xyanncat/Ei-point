# Ei Royality — Operations (Phase 2 stub → expanded in Phase 9)

## Resource budget (§7) — enforced in compose + systemd slice

Slice `ei-royality.slice`: `CPUQuota=800% MemoryHigh=32G MemoryMax=40G MemorySwapMax=2G`.
Per-service CPU/RAM caps live in `infra/docker/compose.yml` (`deploy.resources.limits` + `mem_limit`).
Total: 8.00 CPU / 30 GiB; hard cap 40 GiB; swap is emergency headroom only.

## Storage envelope (§7) — 400 GB project envelope

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

## Deploy / rollback (§12)

1. Test-guild credentials + isolated data first. Never run legacy + replacement fleets unrestricted simultaneously.
2. Cutover: archive+verify legacy → fresh verified backup → stop legacy handlers → start pinned digests → verify commands/permissions/routes/flows → monitor latency/errors/CPU/RAM/disk/queues/gateway.
3. Rollback = previous image digests + backward-compatible migrations. DB restore is explicit recovery only, never auto-rollback.
