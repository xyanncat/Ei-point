# Ei Point — Recovery Drills (Phase 2 stub → executed in Phase 9–10)

Targets (§9): DB RPO ≤ 5 min, files RPO ≤ 24 h, full-service RTO ≤ 2 h. Measure — don't assume.

## Weekly (isolated, automatic)

1. pgBackRest restore → temp postgres → checksum + row-count compare (all `commerce.*`, `games.*`, `ai.*` tables).
2. restic file restore → temp volume → checksum compare (artwork/uploads; music-cache excluded).
3. Record: backup time, restore time, counts, checksums, drill PASS/FAIL in the history table below
   (+ mirror as `ops.diagnostic_events` category=`drill`; `ops.service_status` holds only latest pointer).

## Pre-launch (replacement host)

Full rebuild from off-host copies + image digests on a clean host. Measure RTO end-to-end. Gate: §10 staging — no launch without a passing full drill.

## Kill-drills (§11 durability)

- Kill service mid card-trade / payment-settlement / referral-redeem / job → assert no duplicate financial effects (unique + tx enforced in `infra/postgres/`).
- `docker restart postgres` mid-write → unsafe mutations fail clearly, then reconnect (no claimed success).
- Kill music bot → queue + position restored from `music.queue_snapshots` (≤15 s loss); voice session rejoin is best-effort.
- Kill AI provider (firewall block) → moderation/security unaffected; AI returns actionable error within deadline.
- DNS blackout simulation → cached resolver path holds; failures are explicit, not hangs.
- Disk 90% simulation → optional downloads/uploads stop; financial/WAL writes never auto-deleted.

Log every drill in `docs/recovery-drills.md` history table below.

| Date | Drill | Result | RPO | RTO | Notes |
|---|---|---|---|---|---|
| — | — | — | — | — | no drills run yet |
