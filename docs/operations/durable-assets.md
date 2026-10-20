# Durable-asset inventory and recovery contract (§9B / A19)

Every durable asset has an owner, runtime path, classification, backup or
reprovision method, integrity hash, retention and restore validation. The
machine-readable source of truth is `infra/backup/durable-assets.mjs`; this page
is the operator view. Both are checked by `infra/backup/durable-assets.test.mjs`
and `node infra/backup/durable-assets.mjs --validate`.

Classification drives the policy:

- **database** — the PostgreSQL cluster and its WAL/physical chain.
- **unique-private** — irreplaceable data; must be in the encrypted off-host
  restic set and in an integrity-checked backup.
- **reprovisionable** — public weights, rebuilt from a pinned manifest and never
  stored as a unique backup.
- **secret** — the deployment environment file, kept private (0600) and inside
  the encrypted off-host set.

## Inventory

| id | Owner | Classification | Runtime path | Backup / reprovision | Integrity | Retention | Restore validation | RPO |
|---|---|---|---|---|---|---|---|---|
| `database` | postgres | database | `pgdata` volume | `bundle.mjs` logical dump + roles; pgBackRest physical; WAL `archive-push` | pgBackRest manifest + dump hash | 28 logical snapshots; 14-day WAL | `scripts/restore-drill.sh`; pgBackRest physical restore | 15 min |
| `wal-archive` | postgres | database | `pgbackrest` volume | off-host restic (physical + WAL) | `backup.info`/`backup.manifest` | 14-day physical/WAL window | pgBackRest restore in isolation | 15 min |
| `artwork` | api/dashboard | unique-private | `artwork` volume | off-host restic; logical `artwork.tar.gz` | per-file sha256 in `backup.json` | 6h logical + 24h/7d/4w restic | `restore-drill.sh` byte-checks every file | 6 h |
| `cyrene-reference-audio` | cyrene (tts) | unique-private | `CYRENE_REFERENCE_AUDIO_PATH` | off-host restic (encrypted) | sha256 at provision time | restic tier (≤24 h copy age) | hash must match before Pocket voice-state preparation or Pocket fallback readiness | 6 h |
| `cyrene-persona-memory` | cyrene (bot-ai) | unique-private | `CYRENE_PERSONA_MEMORY_FILE` | off-host restic (encrypted) | sha256 at provision time | restic tier (≤24 h copy age) | bot-ai rejects unreadable/oversize persona (not-ready) | 6 h |
| `deployment-secret` | operator | secret | `ENV_FILE` (`.env`) | off-host restic (encrypted) | filesystem perms 600 | restic tier (≤24 h copy age) | restore to 0600 and re-run release health gates | 6 h |
| `pocket-tts-weights` | operator (pocket-tts) | reprovisionable | `POCKET_TTS_HF_CACHE_PATH` | `scripts/prepare_pocket_model.py --revision <sha>` | HF snapshot revision + manifest sha256 | n/a (public, gated) | Pocket loads pinned snapshot offline; `tts` ready | n/a |
| `cyrene-pocket-voice-state` | cyrene (pocket-tts) | unique-private | `POCKET_TTS_VOICE_STATE_PATH` | off-host restic (encrypted) | sha256 `c053f46f…` | restic tier (≤24 h copy age) | voice-state sha256 matches before `tts` starts ready | 6 h |
| `hy-mt2-weights` | operator (hy-mt2) | reprovisionable | `HY_MT2_MODEL_PATH` | `scripts/prepare_hymt2_model.py --revision <sha>` | `ei-point-model.json` + `.sha256` | n/a (public) | checksum check passes; `/health` ok | n/a |

`infra/backup/restic-backup.sh` resolves the unique/private and secret host paths
and the private Docker volumes from this inventory (`--list-private` and
`privateVolumes()`), so adding a private asset cannot silently drop it from the
off-host set. Public model directories are intentionally excluded. The script
fails closed when the inventory resolves no private paths or a required asset is
missing.

## Proposed RPO/RTO (targets, not achieved claims)

These numbers are **proposed targets**. They are not claimed as achieved until a
measured drill on the real VPS, informed by measured bandwidth, produces the
times (§9B, §10B). A completed logical drill persists a dated
`restore-verified.json` beside the snapshot it verified;
`scripts/ops-report.mjs` surfaces its age to operators.

- Database RPO **15 minutes** (WAL archiving + 6h logical tier).
- Unique-asset RPO **6 hours** (6h logical tier; restic timer).
- Independent off-host copy age **at most 24 hours**.
- Full-service RTO **2 hours** (bounded by `restore-drill.sh` `RTO_SECONDS`).

## Restore drills (require Docker + real artifacts)

- Logical bundle: `BACKUP_SNAPSHOT=<dir> bash scripts/restore-drill.sh` verifies
  hashes before any Docker call, restores into an isolated network-off container
  and byte-checks artwork.
- Physical/PITR: pgBackRest restore of a prior base backup plus WAL to the target
  time, into an isolated system identifier.
- Off-host restic: restore a snapshot to a fresh host and verify the
  `cyrene-reference-audio`, `cyrene-persona-memory`, `artwork`, `cyrene-pocket-voice-state` and `deployment-secret`
  hashes before starting any service.

No drill output is recorded as PASS unless the integrity checks pass; failures
and timeouts never publish a PASS record.
